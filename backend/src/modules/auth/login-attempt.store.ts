import { Logger, OnModuleDestroy, OnModuleInit, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';
import { resolveRedisFamily } from '../../jobs/redis-connection.util';
import { isLoginAttemptRedisDisabled } from '../../config/test-env';
import {
  LOGIN_ATTEMPT_MEMORY_MAX_KEYS,
  LOGIN_ATTEMPT_REDIS_FALLBACK_MS,
  LOGIN_ATTEMPT_REDIS_PREFIX,
  LOGIN_ATTEMPT_REDIS_TIMEOUT_MS,
  PASSWORD_FAILURES_TTL_MS,
  PASSWORD_FREE_ATTEMPTS,
  PASSWORD_LOCK_BASE_MS,
  PASSWORD_LOCK_MAX_MS,
  lockMsForFailures,
} from './password-attempts.constants';

/**
 * login-attempt.store.ts — C7 (v1.80), `ARCHITECTURE §4.57.5`: dónde vive el contador de intentos.
 *
 * Tres piezas y una regla: **la comprobación del candado y la reserva del intento son UNA sola
 * operación atómica** (§4.57.2 #2). Si fueran dos con un `await` entre medias, 20 peticiones
 * simultáneas verían todas «sin candado» y las 20 llegarían a `argon2` (prueba C7-4).
 *  - `MemoryLoginAttemptStore`: el cuerpo de `acquire` es síncrono ⇒ atómico en el bucle de eventos.
 *  - `RedisLoginAttemptStore`: un script Lua ⇒ atómico en Redis, una ida y vuelta.
 *  - `ResilientLoginAttemptStore`: Redis con plazo de 250 ms; si falla o vence, esa operación y las
 *    de los 30 s siguientes van a memoria (§4.57.2 #11: ni fail-open ni fail-closed).
 */

export type AcquireResult =
  | { allowed: true; failures: number; lockedNow: boolean; lockSeconds: number }
  | { allowed: false; retryAfterSeconds: number };

export interface LoginAttemptStore {
  /** ¿Candado puesto? ⇒ `allowed:false` SIN contar ni alargar (§4.57.2 #4). Si no, reserva el intento. */
  acquire(key: string): Promise<AcquireResult>;
  /** Borra contador y candado del cubo. */
  reset(key: string): Promise<void>;
  /**
   * `true` la primera vez en `ttlMs` para esa clave; `false` las siguientes. Sirve al tope del
   * correo de aviso a staff (1 cada 24 h por cuenta, §4.57.2 #10). Extensión de la interfaz de
   * §4.57.5 (que solo nombra `acquire`/`reset`): el tope necesita un sitio donde vivir, y vive
   * junto al contador para no añadir estado nuevo a la BD.
   */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
}

/** Token DI del almacén. */
export const LOGIN_ATTEMPT_STORE = Symbol('LOGIN_ATTEMPT_STORE');

type Clock = () => number;

interface MemoryEntry {
  failures: number;
  failExpiresAt: number;
  lockExpiresAt: number;
}

/**
 * Almacén en memoria — misma semántica que el Lua (mismo retroceso, mismos TTL), sobre un `Map`
 * con tope de `LOGIN_ATTEMPT_MEMORY_MAX_KEYS`. Al llenarse desaloja primero las caducadas y luego
 * las más viejas (orden de inserción; cada escritura re-inserta ⇒ «más vieja» = «menos reciente»).
 * ⚠️ Aceptado y escrito (§4.57.5): un atacante que inunde el mapa puede desalojar contadores ajenos;
 * es una degradación temporal.
 *
 * `clock` inyectable: las pruebas de retroceso (C7-5/C7-6) usan un reloj falso.
 */
export class MemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly claims = new Map<string, number>();
  private lastSweepAt = 0;

  constructor(
    private readonly clock: Clock = Date.now,
    private readonly maxKeys: number = LOGIN_ATTEMPT_MEMORY_MAX_KEYS,
  ) {}

  /** Número de claves vivas en el mapa (para pruebas del tope). */
  get size(): number {
    return this.entries.size;
  }

  // ⚠️ `async` por la interfaz, pero el cuerpo NO tiene ningún `await`: mirar y reservar ocurren en
  // el mismo tick. Meter un `await` aquí rompería la atomicidad (mutación de C7-4).
  async acquire(key: string): Promise<AcquireResult> {
    const now = this.clock();
    const e = this.entries.get(key);
    if (e && e.lockExpiresAt > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((e.lockExpiresAt - now) / 1000) };
    }
    const failures = (e && e.failExpiresAt > now ? e.failures : 0) + 1;
    const lockMs = lockMsForFailures(failures);
    const next: MemoryEntry = {
      failures,
      failExpiresAt: now + PASSWORD_FAILURES_TTL_MS,
      lockExpiresAt: lockMs > 0 ? now + lockMs : 0,
    };
    this.entries.delete(key);
    this.entries.set(key, next);
    this.evict(this.entries, now, (v) => v.failExpiresAt <= now && v.lockExpiresAt <= now);
    return { allowed: true, failures, lockedNow: lockMs > 0, lockSeconds: Math.ceil(lockMs / 1000) };
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    const now = this.clock();
    const until = this.claims.get(key);
    if (until !== undefined && until > now) return false;
    this.claims.delete(key);
    this.claims.set(key, now + ttlMs);
    this.evict(this.claims, now, (v) => v <= now);
    return true;
  }

  private evict<V>(map: Map<string, V>, now: number, expired: (v: V) => boolean): void {
    if (map.size <= this.maxKeys) return;
    // Barrer caducadas cuesta O(n): como mucho una vez por segundo, para que una inundación no
    // convierta cada intento en un recorrido de 50 000 claves.
    if (now - this.lastSweepAt >= 1000) {
      this.lastSweepAt = now;
      for (const [k, v] of map) if (expired(v)) map.delete(k);
    }
    while (map.size > this.maxKeys) {
      const oldest = map.keys().next().value as string;
      map.delete(oldest);
    }
  }
}

/**
 * Script Lua — mirar el candado y reservar el intento en UNA operación (§4.57.5).
 * KEYS[1] = contador, KEYS[2] = candado. ARGV = ttlContador, libres, baseCandado, topeCandado (ms).
 * Devuelve `{0, pttl}` (bloqueado) o `{1, f, lockMs}`.
 */
const ACQUIRE_LUA = `
local pttl = redis.call('PTTL', KEYS[2])
if pttl > 0 then return {0, pttl} end
local f = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
local free = tonumber(ARGV[2])
local lockMs = 0
if f >= free then
  local exp = f - free
  if exp >= 6 then
    lockMs = tonumber(ARGV[4])
  else
    lockMs = math.min(tonumber(ARGV[3]) * (2 ^ exp), tonumber(ARGV[4]))
  end
  lockMs = math.floor(lockMs)
  redis.call('SET', KEYS[2], '1', 'PX', lockMs)
end
return {1, f, lockMs}
`;

type RedisWithAcquire = Redis & {
  tcgAuthAcquire(failKey: string, lockKey: string, ...args: (string | number)[]): Promise<number[]>;
};

/**
 * Almacén Redis. El cliente lo construye `createLoginAttemptRedisClient` (propio, no el de BullMQ:
 * BullMQ exige reintentar para siempre, y un login no puede esperar para siempre — §4.57.2 #9).
 * `prefix` configurable para que la prueba directa (C7-12) use uno aleatorio por corrida.
 * Las claves son `<prefix>f:<k>` / `<prefix>l:<k>` y `<k>` nunca es el correo (es su HMAC).
 */
export class RedisLoginAttemptStore implements LoginAttemptStore {
  private readonly client: RedisWithAcquire;

  constructor(
    client: Redis,
    private readonly prefix: string = LOGIN_ATTEMPT_REDIS_PREFIX,
  ) {
    this.client = client as RedisWithAcquire;
    if (typeof this.client.tcgAuthAcquire !== 'function') {
      this.client.defineCommand('tcgAuthAcquire', { numberOfKeys: 2, lua: ACQUIRE_LUA });
    }
  }

  private failKey(k: string): string {
    return `${this.prefix}f:${k}`;
  }

  private lockKey(k: string): string {
    return `${this.prefix}l:${k}`;
  }

  async acquire(key: string): Promise<AcquireResult> {
    const r = await this.client.tcgAuthAcquire(
      this.failKey(key),
      this.lockKey(key),
      PASSWORD_FAILURES_TTL_MS,
      PASSWORD_FREE_ATTEMPTS,
      PASSWORD_LOCK_BASE_MS,
      PASSWORD_LOCK_MAX_MS,
    );
    if (Number(r[0]) === 0) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(Number(r[1]) / 1000)) };
    }
    const lockMs = Number(r[2]);
    return {
      allowed: true,
      failures: Number(r[1]),
      lockedNow: lockMs > 0,
      lockSeconds: Math.ceil(lockMs / 1000),
    };
  }

  async reset(key: string): Promise<void> {
    await this.client.del(this.failKey(key), this.lockKey(key));
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    const r = await this.client.set(`${this.prefix}m:${key}`, '1', 'PX', ttlMs, 'NX');
    return r === 'OK';
  }
}

/** Rechaza si `p` no resuelve en `ms`. El comando puede completarse después: da igual (ver arriba). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`login-attempt store: timeout ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * Redis con respaldo en memoria (§4.57.2 #11). Cada operación contra Redis tiene `timeoutMs`; si
 * falla o vence, ESA operación y las de los `fallbackMs` siguientes van a memoria, con las mismas
 * reglas. ⛔ Nunca deja pasar sin contar (fail-open) ni lanza (fail-closed).
 * Con `numReplicas: 1` la memoria es un contador completo; con réplicas > 1 cuenta por réplica
 * (`N-C7-6`, aceptado como degradación temporal).
 */
export class ResilientLoginAttemptStore implements LoginAttemptStore, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LoginAttemptStore');
  private downUntil = 0;

  constructor(
    private readonly primary: LoginAttemptStore,
    private readonly fallback: MemoryLoginAttemptStore,
    private readonly client?: Redis,
    private readonly timeoutMs: number = LOGIN_ATTEMPT_REDIS_TIMEOUT_MS,
    private readonly fallbackMs: number = LOGIN_ATTEMPT_REDIS_FALLBACK_MS,
    private readonly clock: Clock = Date.now,
  ) {}

  /** `true` mientras las operaciones van a memoria por un fallo reciente de Redis. */
  get degraded(): boolean {
    return this.clock() < this.downUntil;
  }

  private markDown(op: string, e: unknown): void {
    const wasUp = !this.degraded;
    this.downUntil = this.clock() + this.fallbackMs;
    if (wasUp) {
      this.logger.warn(
        `Redis no respondió en ${op} (${e instanceof Error ? e.message : String(e)}): el contador de ` +
          `intentos va a memoria durante ${this.fallbackMs / 1000}s (C7, §4.57.2 #11).`,
      );
    }
  }

  private async run<T>(op: string, viaRedis: () => Promise<T>, viaMemory: () => Promise<T>): Promise<T> {
    if (this.degraded) return viaMemory();
    try {
      return await withTimeout(viaRedis(), this.timeoutMs);
    } catch (e) {
      this.markDown(op, e);
      return viaMemory();
    }
  }

  acquire(key: string): Promise<AcquireResult> {
    return this.run('acquire', () => this.primary.acquire(key), () => this.fallback.acquire(key));
  }

  async reset(key: string): Promise<void> {
    // La memoria se limpia SIEMPRE (puede tener intentos de una caída anterior); Redis, si está.
    await this.fallback.reset(key);
    if (this.degraded) return;
    try {
      await withTimeout(this.primary.reset(key), this.timeoutMs);
    } catch (e) {
      this.markDown('reset', e);
    }
  }

  claimOnce(key: string, ttlMs: number): Promise<boolean> {
    return this.run(
      'claimOnce',
      () => this.primary.claimOnce(key, ttlMs),
      () => this.fallback.claimOnce(key, ttlMs),
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) return;
    // `lazyConnect` + `enableOfflineQueue:false`: sin conectar, todo comando falla al instante. Se
    // conecta al arrancar, con plazo, y SIN tumbar el arranque si Redis no está (va a memoria).
    try {
      await withTimeout(this.client.connect(), 2000);
    } catch (e) {
      this.markDown('connect', e);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await withTimeout(this.client.quit(), 1000);
    } catch {
      this.client.disconnect();
    }
  }
}

/**
 * Cliente Redis PROPIO del contador (§4.57.5): `family` de `resolveRedisFamily` (arreglo IPv6 de
 * Railway), `commandTimeout: 250`, `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`,
 * `lazyConnect`, y un listener de `'error'` que no tumba el proceso.
 */
export function createLoginAttemptRedisClient(url: string, envFamily?: string): Redis {
  const family = resolveRedisFamily(url, envFamily);
  const client = new IORedis(url, {
    commandTimeout: LOGIN_ATTEMPT_REDIS_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    ...(family !== undefined ? { family } : {}),
  });
  client.on('error', () => undefined);
  return client;
}

/**
 * Selección del almacén (§4.57.5, §4.57.6):
 *  - bajo la suite (`isLoginAttemptRedisDisabled()`): SIEMPRE memoria, nueva por cada `AppModule`
 *    (en CI hay `REDIS_URL` y un Redis compartido dejaría contadores vivos entre specs);
 *  - con `REDIS_URL`: Redis con respaldo en memoria;
 *  - sin `REDIS_URL`: memoria.
 * ⛔ En ningún caso se apaga el candado.
 */
export const loginAttemptStoreProvider: Provider = {
  provide: LOGIN_ATTEMPT_STORE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): LoginAttemptStore => {
    const memory = new MemoryLoginAttemptStore();
    if (isLoginAttemptRedisDisabled()) return memory;
    const url = config.get<string>('REDIS_URL');
    if (!url) return memory;
    const client = createLoginAttemptRedisClient(url, config.get<string>('REDIS_FAMILY'));
    return new ResilientLoginAttemptStore(new RedisLoginAttemptStore(client), memory, client);
  },
};
