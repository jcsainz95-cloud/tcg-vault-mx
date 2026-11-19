/**
 * ship-quote-gate.ts — 💰 §ENV3 (DECISIONES punto 17(6), ENV3-3): control GLOBAL de las llamadas vivas a Skydropx.
 *  - Disyuntor: `MAX_FAILURES` fallos (timeouts y 5xx; ⛔ no 4xx) en `WINDOW_S` ⇒ abierto `OPEN_S`. Su estado vive en Redis (no por instancia).
 *  - Tope global `ship_skydropx_max_per_min` llamadas/min y `MAX_INFLIGHT` en vuelo (semáforo Redis). Excedido ⇒ el llamador usa la tabla.
 *  - El sondeo nocturno pide `lowPriority`: solo pasa si el minuto va por debajo de la mitad del tope.
 * Sin Redis (dev/CI) o con Redis caído: memoria por proceso (nunca fail-open sin límite).
 */
import { Logger, OnModuleDestroy, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';
import { closeRedisClient } from '../../common/redis-close';
import { resolveRedisFamily } from '../../jobs/redis-connection.util';

export const SHIP_QUOTE_CONTROL = Symbol('SHIP_QUOTE_CONTROL');
export const BREAKER_MAX_FAILURES = 5;
export const BREAKER_WINDOW_S = 60;
export const BREAKER_OPEN_S = 120;
export const MAX_INFLIGHT = 8;
const INFLIGHT_SAFETY_TTL_S = 30;

export interface ShipQuoteControl {
  isOpen(): Promise<boolean>;
  recordFailure(): Promise<void>;
  recordSuccess(): Promise<void>;
  /** Reserva una llamada: cuenta contra el tope del minuto y toma un lugar del semáforo. `false` ⇒ no llamar. */
  acquire(maxPerMin: number, opts?: { lowPriority?: boolean }): Promise<boolean>;
  release(): Promise<void>;
}

export class MemoryShipQuoteControl implements ShipQuoteControl {
  private failures: number[] = [];
  private openUntil = 0;
  private minute = 0;
  private calls = 0;
  private inflight = 0;
  constructor(private readonly now: () => number = Date.now) {}

  async isOpen(): Promise<boolean> {
    return this.now() < this.openUntil;
  }
  async recordFailure(): Promise<void> {
    const t = this.now();
    this.failures = this.failures.filter((x) => t - x < BREAKER_WINDOW_S * 1000);
    this.failures.push(t);
    if (this.failures.length >= BREAKER_MAX_FAILURES) {
      this.openUntil = t + BREAKER_OPEN_S * 1000;
      this.failures = [];
    }
  }
  async recordSuccess(): Promise<void> {
    this.failures = [];
  }
  async acquire(maxPerMin: number, opts: { lowPriority?: boolean } = {}): Promise<boolean> {
    const m = Math.floor(this.now() / 60_000);
    if (m !== this.minute) {
      this.minute = m;
      this.calls = 0;
    }
    const cap = opts.lowPriority ? Math.floor(maxPerMin / 2) : maxPerMin;
    if (this.calls >= cap || this.inflight >= MAX_INFLIGHT) return false;
    this.calls += 1;
    this.inflight += 1;
    return true;
  }
  async release(): Promise<void> {
    this.inflight = Math.max(0, this.inflight - 1);
  }
}

// KEYS: 1 calls(min) 2 inflight · ARGV: 1 cap 2 maxInflight 3 safetyTtl
const ACQUIRE_LUA = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c >= tonumber(ARGV[1]) then return 0 end
local f = tonumber(redis.call('GET', KEYS[2]) or '0')
if f >= tonumber(ARGV[2]) then return 0 end
c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], 70) end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`;
// KEYS: 1 fails 2 open · ARGV: 1 max 2 window 3 open
const FAIL_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if n >= tonumber(ARGV[1]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
  redis.call('DEL', KEYS[1])
end
return n`;
const RELEASE_LUA = `
local f = tonumber(redis.call('GET', KEYS[1]) or '0')
if f > 0 then redis.call('DECR', KEYS[1]) end
return 1`;

export class RedisShipQuoteControl implements ShipQuoteControl, OnModuleDestroy {
  private readonly logger = new Logger('ShipQuoteControl');
  private readonly mem: MemoryShipQuoteControl;
  constructor(
    private readonly client: Redis,
    private readonly prefix = 'shipq:gate:',
    now: () => number = Date.now,
  ) {
    this.mem = new MemoryShipQuoteControl(now);
    this.now = now;
  }
  private readonly now: () => number;
  private k(s: string): string {
    return `${this.prefix}${s}`;
  }
  private async safe<T>(op: string, redis: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await redis();
    } catch (e) {
      this.logger.warn(`ship_quote_gate ${op} falló (memoria local): ${e instanceof Error ? e.message : String(e)}`);
      return fallback();
    }
  }
  isOpen(): Promise<boolean> {
    return this.safe('isOpen', async () => (await this.client.exists(this.k('open'))) === 1, () => this.mem.isOpen());
  }
  recordFailure(): Promise<void> {
    return this.safe(
      'fail',
      async () => {
        await this.client.eval(FAIL_LUA, 2, this.k('fails'), this.k('open'), BREAKER_MAX_FAILURES, BREAKER_WINDOW_S, BREAKER_OPEN_S);
      },
      () => this.mem.recordFailure(),
    );
  }
  recordSuccess(): Promise<void> {
    return this.safe('ok', async () => void (await this.client.del(this.k('fails'))), () => this.mem.recordSuccess());
  }
  acquire(maxPerMin: number, opts: { lowPriority?: boolean } = {}): Promise<boolean> {
    const cap = opts.lowPriority ? Math.floor(maxPerMin / 2) : maxPerMin;
    const minute = Math.floor(this.now() / 60_000);
    return this.safe(
      'acquire',
      async () => (await this.client.eval(ACQUIRE_LUA, 2, this.k(`calls:${minute}`), this.k('inflight'), cap, MAX_INFLIGHT, INFLIGHT_SAFETY_TTL_S)) === 1,
      () => this.mem.acquire(maxPerMin, opts),
    );
  }
  release(): Promise<void> {
    return this.safe('release', async () => void (await this.client.eval(RELEASE_LUA, 1, this.k('inflight'))), () => this.mem.release());
  }
  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client);
  }
}

export const shipQuoteControlProvider: Provider = {
  provide: SHIP_QUOTE_CONTROL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ShipQuoteControl => {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      new Logger('ShipQuoteControl').warn('REDIS_URL ausente → disyuntor y tope de Skydropx en MEMORIA (solo dev/CI).');
      return new MemoryShipQuoteControl();
    }
    const family = resolveRedisFamily(url, config.get<string>('REDIS_FAMILY'));
    const client = new IORedis(url, { commandTimeout: 250, maxRetriesPerRequest: 1, enableOfflineQueue: false, ...(family !== undefined ? { family } : {}) });
    client.on('error', () => undefined);
    return new RedisShipQuoteControl(client);
  },
};
