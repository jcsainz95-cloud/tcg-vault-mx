import { closeRedisClient } from '../../common/redis-close';
import { Logger, OnModuleDestroy, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';
import { resolveRedisFamily } from '../../jobs/redis-connection.util';

/**
 * card-show-counter.store.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.4/.7, ARCHITECTURE §4.CARDSHOW.c/.g).
 *
 * El contador compartido de la landing: throttle por IP (C7), presupuesto global de envíos (C1) y los
 * «una sola vez» de las alertas. Vive en **Redis** (no en memoria por-instancia, que con N réplicas
 * mentiría). Dos implementaciones con la MISMA interfaz:
 *  - `RedisCardShowCounterStore`: atómico vía Lua, una ida y vuelta. Lanza si Redis no responde (el
 *    presupuesto lo traduce a fail-CLOSED: §CARDSHOW.7).
 *  - `MemoryCardShowCounterStore`: ventana fija sobre un `Map`, reloj inyectable para las pruebas con
 *    reloj simulado (topes por buzón, caducidades).
 *
 * `hit` es un contador de ventana FIJA: el TTL se fija solo al crear la clave y no se renueva (igual
 * que el `bump` de `login-attempt.store.ts`). `reserveBudget` reserva 1 contra dos topes (hora y día)
 * y hace rollback si cualquiera está lleno — ⛔ nunca deja 1 reservado sin conceder.
 */

export interface CardShowCounterStore {
  /** INCR de ventana FIJA. Devuelve la cuenta tras incrementar. Lanza si el backend no responde. */
  hit(key: string, ttlMs: number): Promise<number>;
  /** Lectura sin efectos de la cuenta de una clave (0 si no existe). */
  count(key: string): Promise<number>;
  /** ms que le quedan a la ventana de `key` (0 si no hay). */
  ttlMs(key: string): Promise<number>;
  /**
   * Reserva 1 envío contra dos topes GLOBALES (hora y día). Concede solo si AMBOS están por debajo de
   * su tope; si no, no incrementa nada. Devuelve `allowed` + las cuentas (tras el posible incremento).
   */
  reserveBudget(args: {
    hourKey: string;
    hourLimit: number;
    hourTtlMs: number;
    dayKey: string;
    dayLimit: number;
    dayTtlMs: number;
  }): Promise<{ allowed: boolean; hour: number; day: number }>;
  /**
   * Reserva 1 contra UN tope (ventana fija): incrementa SOLO si la cuenta está por debajo de `limit`.
   * Atómico. Devuelve `allowed` + la cuenta tras el posible incremento. Para topes por buzón/dominio.
   */
  reserve(key: string, limit: number, ttlMs: number): Promise<{ allowed: boolean; count: number }>;
  /** `true` la PRIMERA vez en `ttlMs` para esa clave; `false` las siguientes (dedup de alertas / gap). */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
  /** Pone una bandera persistente (corte de envíos C1/C6). Idempotente. */
  setFlag(key: string): Promise<void>;
  /** Quita una bandera (reabrir envíos: solo un humano, auditado). */
  clearFlag(key: string): Promise<void>;
  /** ¿Bandera puesta? */
  flag(key: string): Promise<boolean>;
}

type Clock = () => number;

interface Entry {
  value: number;
  expiresAt: number;
}

/** Almacén en memoria con reloj inyectable. Nunca lanza. */
export class MemoryCardShowCounterStore implements CardShowCounterStore {
  private readonly map = new Map<string, Entry>();

  constructor(private readonly clock: Clock = Date.now) {}

  private live(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.clock()) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  async hit(key: string, ttlMs: number): Promise<number> {
    const e = this.live(key);
    if (!e) {
      this.map.set(key, { value: 1, expiresAt: this.clock() + ttlMs });
      return 1;
    }
    e.value += 1; // ventana FIJA: no se renueva el expiresAt
    return e.value;
  }

  async count(key: string): Promise<number> {
    return this.live(key)?.value ?? 0;
  }

  async ttlMs(key: string): Promise<number> {
    const e = this.live(key);
    return e ? Math.max(0, e.expiresAt - this.clock()) : 0;
  }

  async reserveBudget(args: {
    hourKey: string;
    hourLimit: number;
    hourTtlMs: number;
    dayKey: string;
    dayLimit: number;
    dayTtlMs: number;
  }): Promise<{ allowed: boolean; hour: number; day: number }> {
    const h = this.live(args.hourKey)?.value ?? 0;
    const d = this.live(args.dayKey)?.value ?? 0;
    if (h >= args.hourLimit || d >= args.dayLimit) return { allowed: false, hour: h, day: d };
    const nh = await this.hit(args.hourKey, args.hourTtlMs);
    const nd = await this.hit(args.dayKey, args.dayTtlMs);
    return { allowed: true, hour: nh, day: nd };
  }

  async reserve(key: string, limit: number, ttlMs: number): Promise<{ allowed: boolean; count: number }> {
    const cur = this.live(key)?.value ?? 0;
    if (cur >= limit) return { allowed: false, count: cur };
    const n = await this.hit(key, ttlMs);
    return { allowed: true, count: n };
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.map.set(key, { value: 1, expiresAt: this.clock() + ttlMs });
    return true;
  }

  private readonly flags = new Set<string>();
  async setFlag(key: string): Promise<void> {
    this.flags.add(key);
  }
  async clearFlag(key: string): Promise<void> {
    this.flags.delete(key);
  }
  async flag(key: string): Promise<boolean> {
    return this.flags.has(key);
  }
}

const HIT_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

const RESERVE_LUA = `
local h = tonumber(redis.call('GET', KEYS[1]) or '0')
local d = tonumber(redis.call('GET', KEYS[2]) or '0')
if h >= tonumber(ARGV[1]) or d >= tonumber(ARGV[2]) then
  return {0, h, d}
end
local nh = redis.call('INCR', KEYS[1])
if nh == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
local nd = redis.call('INCR', KEYS[2])
if nd == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
return {1, nh, nd}
`;

const RESERVE1_LUA = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c >= tonumber(ARGV[1]) then
  return {0, c}
end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return {1, n}
`;

type RedisWithScripts = Redis & {
  csHit(key: string, ttlMs: number): Promise<number>;
  csReserve(hourKey: string, dayKey: string, ...args: (string | number)[]): Promise<number[]>;
  csReserve1(key: string, ...args: (string | number)[]): Promise<number[]>;
};

/**
 * Almacén Redis atómico. Lanza si Redis no responde (el llamador decide fail-open/closed).
 *
 * Es DUEÑO de su cliente (lo crea `cardShowCounterStoreProvider`) y lo cierra en `onModuleDestroy`.
 * Sin ese cierre, cada `app.close()` dejaba un socket a Redis abierto (y ioredis reconectándolo): la
 * integración del backend no terminaba nunca y CI la cancelaba a las 6 h (BACKEND_NOTES §Handles,
 * candado `test/integration/open-handles.teardown.ts`). En producción no cambia nada visible: `main.ts`
 * no llama `enableShutdownHooks`, así que un SIGTERM termina el proceso y el socket muere con él.
 */
export class RedisCardShowCounterStore implements CardShowCounterStore, OnModuleDestroy {
  private readonly client: RedisWithScripts;

  constructor(
    client: Redis,
    private readonly prefix: string = 'cardshow:',
  ) {
    this.client = client as RedisWithScripts;
    if (typeof this.client.csHit !== 'function') {
      this.client.defineCommand('csHit', { numberOfKeys: 1, lua: HIT_LUA });
    }
    if (typeof this.client.csReserve !== 'function') {
      this.client.defineCommand('csReserve', { numberOfKeys: 2, lua: RESERVE_LUA });
    }
    if (typeof this.client.csReserve1 !== 'function') {
      this.client.defineCommand('csReserve1', { numberOfKeys: 1, lua: RESERVE1_LUA });
    }
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  /** Cierra el cliente: `quit` ordenado con tope de 1 s; si no contesta, `disconnect` (helper común, TD-HND-3). */
  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client);
  }

  async hit(key: string, ttlMs: number): Promise<number> {
    return Number(await this.client.csHit(this.k(key), ttlMs));
  }

  async count(key: string): Promise<number> {
    return Number((await this.client.get(this.k(key))) ?? 0);
  }

  async ttlMs(key: string): Promise<number> {
    const pttl = Number(await this.client.pttl(this.k(key)));
    return pttl > 0 ? pttl : 0;
  }

  async reserveBudget(args: {
    hourKey: string;
    hourLimit: number;
    hourTtlMs: number;
    dayKey: string;
    dayLimit: number;
    dayTtlMs: number;
  }): Promise<{ allowed: boolean; hour: number; day: number }> {
    const r = await this.client.csReserve(
      this.k(args.hourKey),
      this.k(args.dayKey),
      args.hourLimit,
      args.dayLimit,
      args.hourTtlMs,
      args.dayTtlMs,
    );
    return { allowed: Number(r[0]) === 1, hour: Number(r[1]), day: Number(r[2]) };
  }

  async reserve(key: string, limit: number, ttlMs: number): Promise<{ allowed: boolean; count: number }> {
    const r = await this.client.csReserve1(this.k(key), limit, ttlMs);
    return { allowed: Number(r[0]) === 1, count: Number(r[1]) };
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    const r = await this.client.set(this.k(`once:${key}`), '1', 'PX', ttlMs, 'NX');
    return r === 'OK';
  }

  async setFlag(key: string): Promise<void> {
    await this.client.set(this.k(`flag:${key}`), '1');
  }
  async clearFlag(key: string): Promise<void> {
    await this.client.del(this.k(`flag:${key}`));
  }
  async flag(key: string): Promise<boolean> {
    return (await this.client.get(this.k(`flag:${key}`))) === '1';
  }
}

/** Token DI del almacén de contadores de la landing. */
export const CARD_SHOW_COUNTER_STORE = Symbol('CARD_SHOW_COUNTER_STORE');

/**
 * Selección del almacén: con `REDIS_URL` ⇒ Redis (cliente PROPIO, no el de BullMQ); sin ella ⇒ memoria
 * (dev/CI sin Redis). ⛔ El throttle y el presupuesto NUNCA se apagan: sin Redis la memoria por-instancia
 * es la red (holgada) y el presupuesto falla cerrado por su cuenta ante errores de Redis.
 */
export const cardShowCounterStoreProvider: Provider = {
  provide: CARD_SHOW_COUNTER_STORE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): CardShowCounterStore => {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      new Logger('CardShowCounterStore').warn('REDIS_URL ausente → contador en MEMORIA (solo dev/CI).');
      return new MemoryCardShowCounterStore();
    }
    const family = resolveRedisFamily(url, config.get<string>('REDIS_FAMILY'));
    const client = new IORedis(url, {
      commandTimeout: 250,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      ...(family !== undefined ? { family } : {}),
    });
    client.on('error', () => undefined);
    return new RedisCardShowCounterStore(client);
  },
};
