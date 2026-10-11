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
 *
 * ⭐ v1.80.1 (`ARCHITECTURE §4.57.10.2`, invariante `C7-R`): **la memoria NO es un contador aparte:
 * es CACHÉ de la última respuesta de Redis** por clave, más lo que Redis no vio (`unsynced`, el
 * candado restante, un `reset` pendiente). Redis manda cuando contesta y su respuesta sobrescribe
 * la foto; cuando no contesta manda la memoria **desde la foto**, no desde cero; y la primera
 * operación que Redis vuelve a contestar para esa clave lleva lo pendiente **en el mismo Lua de la
 * reserva** (`extra`, `lockRestanteMs`, `borrar`). Así el presupuesto de una clave es UNO aunque
 * Redis deje de contestar y vuelva cualquier número de veces (antes: QA midió 10 a argon2 en vez
 * de 5 con un plazo vencido bajo carga, `D-C7-3`).
 *
 * v1.80.1 también añade `bump`: contador de ventana FIJA para el tope agregado por vía dispositivo
 * (§4.57.10.1 b): `INCR` con TTL fijado solo al crear la clave.
 */

export type AcquireResult =
  | { allowed: true; failures: number; lockedNow: boolean; lockSeconds: number }
  | { allowed: false; retryAfterSeconds: number };

export interface LoginAttemptStore {
  /** ¿Candado puesto? ⇒ `allowed:false` SIN contar ni alargar (§4.57.2 #4). Si no, reserva el intento. */
  acquire(key: string): Promise<AcquireResult>;
  /** Borra contador y candado del cubo (y la ventana de `bump`, si la clave es un agregado). */
  reset(key: string): Promise<void>;
  /**
   * `true` la primera vez en `ttlMs` para esa clave; `false` las siguientes. Sirve al tope del
   * correo de aviso a staff (1 cada 24 h por cuenta, §4.57.2 #10). Extensión de la interfaz de
   * §4.57.5 (que solo nombra `acquire`/`reset`): el tope necesita un sitio donde vivir, y vive
   * junto al contador para no añadir estado nuevo a la BD. Mejor esfuerzo: no entra en la caché.
   */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
  /**
   * v1.80.1 — contador de ventana FIJA (§4.57.10.1 b): `INCR`; el TTL se fija solo al crear la
   * clave (NX) y NO se renueva. Devuelve el valor tras incrementar. Al vencer la ventana, vuelve a 1.
   */
  bump(key: string, ttlMs: number): Promise<number>;
  /**
   * v1.80.9 (§M6-U.4, §4.58.5) — ms que le quedan al candado de `key` (`0` sin candado). Lectura SIN efectos: no
   * cuenta, no alarga, no repone. Sirve a «bloqueado hasta HH:MM» en Usuarios: el almacén es la única fuente del
   * candado (ni columna ni bitácora).
   */
  peekLockMs(key: string): Promise<number>;
}

/** Token DI del almacén. */
export const LOGIN_ATTEMPT_STORE = Symbol('LOGIN_ATTEMPT_STORE');

/**
 * ⭐ v1.80.9.1 (errata D-4 + TD-9, `API_CONTRACT §M6-U.4`, `ARCHITECTURE §4.58.9`) — «el almacén no puede decir dónde
 * está el candado». La lanza `ResilientLoginAttemptStore.peekLockMs` en modo degradado o si Redis no contesta. Es la
 * ÚNICA excepción que `AdminService` traduce a `lockState:'unavailable'`; cualquier otra se propaga (fallar en alto).
 */
export class LoginAttemptStoreUnavailableError extends Error {
  constructor(reason: string) {
    super(`login-attempt store unavailable: ${reason}`);
    this.name = 'LoginAttemptStoreUnavailableError';
  }
}

/** Lo que Redis no vio de una clave de reserva mientras no contestaba (§4.57.5, v1.80.1). */
export interface PendingAcquire {
  /** Intentos contados solo en memoria. */
  extra: number;
  /** Candado restante según la memoria (ms); Redis nunca acorta uno más largo que ya tenga. */
  lockRestanteMs: number;
  /** Un `reset` hecho en modo memoria: `DEL` antes de nada. */
  borrar: boolean;
}

/** Lo que Redis no vio de una clave de `bump`. */
export interface PendingBump {
  extra: number;
  borrar: boolean;
}

/** La foto que Redis devuelve de una clave tras una reserva: contador y candado restante (ms, 0 si no hay). */
export interface AttemptPhoto {
  failures: number;
  lockMs: number;
}

export const NO_PENDING_ACQUIRE: Readonly<PendingAcquire> = Object.freeze({ extra: 0, lockRestanteMs: 0, borrar: false });
export const NO_PENDING_BUMP: Readonly<PendingBump> = Object.freeze({ extra: 0, borrar: false });

/**
 * El almacén PRIMARIO (Redis) visto por `ResilientLoginAttemptStore`: la misma interfaz más las dos
 * operaciones con reposición, que devuelven además la foto para la caché.
 */
export interface PrimaryLoginAttemptStore extends LoginAttemptStore {
  acquireSync(key: string, pending: PendingAcquire): Promise<{ result: AcquireResult; photo: AttemptPhoto }>;
  bumpSync(key: string, ttlMs: number, pending: PendingBump): Promise<{ count: number; windowMs: number }>;
}

type Clock = () => number;

interface MemoryEntry {
  failures: number;
  failExpiresAt: number;
  lockExpiresAt: number;
  /** v1.80.1: intentos que Redis no vio (solo tiene sentido bajo `ResilientLoginAttemptStore`). */
  unsynced: number;
  /** v1.80.1: un `reset` que Redis no vio. */
  resetPending: boolean;
}

interface WindowEntry {
  count: number;
  windowExpiresAt: number;
  unsynced: number;
  resetPending: boolean;
}

/**
 * Almacén en memoria — misma semántica que el Lua (mismo retroceso, mismos TTL), sobre un `Map`
 * con tope de `LOGIN_ATTEMPT_MEMORY_MAX_KEYS`. Al llenarse desaloja primero las caducadas y luego
 * las más viejas (orden de inserción; cada escritura re-inserta ⇒ «más vieja» = «menos reciente»).
 * ⚠️ Aceptado y escrito (§4.57.5): un atacante que inunde el mapa puede desalojar contadores ajenos;
 * es una degradación temporal.
 *
 * Solo (sin Redis) es el contador entero. Bajo `ResilientLoginAttemptStore` es la CACHÉ de Redis:
 * `syncAcquire`/`syncBump` sobrescriben la foto con lo que Redis contestó; `acquire`/`bump` en modo
 * memoria cuentan además en `unsynced`; `takePending*` entrega lo pendiente para reponerlo y
 * `giveBackPending*` lo devuelve si la reposición no llegó a Redis.
 *
 * `clock` inyectable: las pruebas de retroceso (C7-5/C7-6) usan un reloj falso.
 */
export class MemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly windows = new Map<string, WindowEntry>();
  private readonly claims = new Map<string, number>();
  private lastSweepAt = 0;

  constructor(
    private readonly clock: Clock = Date.now,
    private readonly maxKeys: number = LOGIN_ATTEMPT_MEMORY_MAX_KEYS,
  ) {}

  /** Número de claves vivas en el mapa de reservas (para pruebas del tope). */
  get size(): number {
    return this.entries.size;
  }

  /** Lectura sin efectos de la entrada de una clave (pruebas). */
  peek(key: string): Readonly<MemoryEntry> | undefined {
    const e = this.entries.get(key);
    return e ? { ...e } : undefined;
  }

  /** Lectura sin efectos de la ventana de `bump` de una clave (pruebas). */
  peekWindow(key: string): Readonly<WindowEntry> | undefined {
    const e = this.windows.get(key);
    return e ? { ...e } : undefined;
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
      unsynced: (e?.unsynced ?? 0) + 1,
      resetPending: e?.resetPending ?? false,
    };
    this.put(this.entries, key, next);
    this.evict(this.entries, now, entryExpired(now));
    return { allowed: true, failures, lockedNow: lockMs > 0, lockSeconds: Math.ceil(lockMs / 1000) };
  }

  async bump(key: string, ttlMs: number): Promise<number> {
    const now = this.clock();
    const e = this.windows.get(key);
    const alive = e !== undefined && e.windowExpiresAt > now;
    const next: WindowEntry = {
      count: (alive ? e.count : 0) + 1,
      windowExpiresAt: alive ? e.windowExpiresAt : now + ttlMs, // ventana FIJA: solo se fija al crear
      unsynced: (e?.unsynced ?? 0) + 1,
      resetPending: e?.resetPending ?? false,
    };
    this.put(this.windows, key, next);
    this.evict(this.windows, now, windowExpired(now));
    return next.count;
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
    this.windows.delete(key);
  }

  async peekLockMs(key: string): Promise<number> {
    const e = this.entries.get(key);
    if (!e) return 0;
    return Math.max(0, e.lockExpiresAt - this.clock());
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    const now = this.clock();
    const until = this.claims.get(key);
    if (until !== undefined && until > now) return false;
    this.put(this.claims, key, now + ttlMs);
    this.evict(this.claims, now, (v) => v <= now);
    return true;
  }

  // ── v1.80.1: la memoria como caché de Redis (solo la usa `ResilientLoginAttemptStore`) ──────────

  /** Redis contestó una reserva: su foto manda y sobrescribe la entrada; nada queda pendiente. */
  syncAcquire(key: string, photo: AttemptPhoto): void {
    const now = this.clock();
    this.put(this.entries, key, {
      failures: photo.failures,
      failExpiresAt: now + PASSWORD_FAILURES_TTL_MS,
      lockExpiresAt: photo.lockMs > 0 ? now + photo.lockMs : 0,
      unsynced: 0,
      resetPending: false,
    });
    this.evict(this.entries, now, entryExpired(now));
  }

  /** Redis contestó un `bump`: su cuenta y su ventana restante mandan. */
  syncBump(key: string, count: number, windowMs: number): void {
    const now = this.clock();
    this.put(this.windows, key, { count, windowExpiresAt: now + windowMs, unsynced: 0, resetPending: false });
    this.evict(this.windows, now, windowExpired(now));
  }

  /** Un `reset` que Redis NO vio: la entrada queda vacía con `resetPending` (se repone al volver). */
  markReset(key: string): void {
    const now = this.clock();
    this.put(this.entries, key, { failures: 0, failExpiresAt: 0, lockExpiresAt: 0, unsynced: 0, resetPending: true });
    this.put(this.windows, key, { count: 0, windowExpiresAt: 0, unsynced: 0, resetPending: true });
    this.evict(this.entries, now, entryExpired(now));
    this.evict(this.windows, now, windowExpired(now));
  }

  /**
   * Entrega lo pendiente de una clave de reserva para mandarlo a Redis, y lo da por entregado
   * (así dos operaciones simultáneas no reponen lo mismo dos veces). Si la reposición no llega,
   * `giveBackPendingAcquire` lo devuelve.
   */
  takePendingAcquire(key: string): PendingAcquire {
    const e = this.entries.get(key);
    if (!e) return { ...NO_PENDING_ACQUIRE };
    const pending: PendingAcquire = {
      extra: e.unsynced,
      lockRestanteMs: Math.max(0, e.lockExpiresAt - this.clock()),
      borrar: e.resetPending,
    };
    e.unsynced = 0;
    e.resetPending = false;
    return pending;
  }

  giveBackPendingAcquire(key: string, pending: PendingAcquire): void {
    if (pending.extra === 0 && !pending.borrar) return;
    const e = this.entries.get(key);
    if (!e) {
      this.put(this.entries, key, { failures: 0, failExpiresAt: 0, lockExpiresAt: 0, unsynced: pending.extra, resetPending: pending.borrar });
      return;
    }
    e.unsynced += pending.extra;
    e.resetPending = e.resetPending || pending.borrar;
  }

  takePendingBump(key: string): PendingBump {
    const e = this.windows.get(key);
    if (!e) return { ...NO_PENDING_BUMP };
    const pending: PendingBump = { extra: e.unsynced, borrar: e.resetPending };
    e.unsynced = 0;
    e.resetPending = false;
    return pending;
  }

  giveBackPendingBump(key: string, pending: PendingBump): void {
    if (pending.extra === 0 && !pending.borrar) return;
    const e = this.windows.get(key);
    if (!e) {
      this.put(this.windows, key, { count: 0, windowExpiresAt: 0, unsynced: pending.extra, resetPending: pending.borrar });
      return;
    }
    e.unsynced += pending.extra;
    e.resetPending = e.resetPending || pending.borrar;
  }

  private put<V>(map: Map<string, V>, key: string, value: V): void {
    map.delete(key);
    map.set(key, value);
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

/** Una entrada con algo pendiente de reponer NO cuenta como caducada (no se barre). */
const entryExpired =
  (now: number) =>
  (v: MemoryEntry): boolean =>
    v.failExpiresAt <= now && v.lockExpiresAt <= now && !v.resetPending && v.unsynced === 0;

const windowExpired =
  (now: number) =>
  (v: WindowEntry): boolean =>
    v.windowExpiresAt <= now && !v.resetPending && v.unsynced === 0;

/**
 * Script Lua — mirar el candado y reservar el intento en UNA operación (§4.57.5), reponiendo antes
 * lo que Redis no vio (v1.80.1). KEYS[1] = contador, KEYS[2] = candado.
 * ARGV = ttlContador, libres, baseCandado, topeCandado (ms), extra, lockRestanteMs, borrar.
 * Devuelve `{0, pttl, f}` (bloqueado) o `{1, f, lockMs}`.
 */
const ACQUIRE_LUA = `
local extra = tonumber(ARGV[5])
local lockRest = tonumber(ARGV[6])
if tonumber(ARGV[7]) == 1 then
  redis.call('DEL', KEYS[1], KEYS[2])
end
if extra > 0 then
  redis.call('INCRBY', KEYS[1], extra)
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
if lockRest > 0 and lockRest > redis.call('PTTL', KEYS[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', lockRest)
end
local pttl = redis.call('PTTL', KEYS[2])
if pttl > 0 then
  local cur = tonumber(redis.call('GET', KEYS[1])) or 0
  return {0, pttl, cur}
end
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

/**
 * Script Lua — `bump` de ventana FIJA (v1.80.1, §4.57.10.1 b): KEYS[1] = agregado.
 * ARGV = ttl (ms), extra, borrar. `SET 0 PX ttl NX` fija el TTL solo al crear; `INCRBY`/`INCR` no
 * lo tocan. Devuelve `{n, pttl}`.
 */
const BUMP_LUA = `
if tonumber(ARGV[3]) == 1 then
  redis.call('DEL', KEYS[1])
end
local extra = tonumber(ARGV[2])
if extra > 0 then
  redis.call('SET', KEYS[1], '0', 'PX', ARGV[1], 'NX')
  redis.call('INCRBY', KEYS[1], extra)
end
redis.call('SET', KEYS[1], '0', 'PX', ARGV[1], 'NX')
local n = redis.call('INCR', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return {n, pttl}
`;

type RedisWithScripts = Redis & {
  tcgAuthAcquire(failKey: string, lockKey: string, ...args: (string | number)[]): Promise<number[]>;
  tcgAuthBump(aggKey: string, ...args: (string | number)[]): Promise<number[]>;
};

/**
 * Las dos claves de Redis de un cubo `<k>`: `<prefix>f:<k>` (contador / ventana) y `<prefix>l:<k>`
 * (candado). Exportada para que el script de rescate (`prisma/reset-admin-password.ts`) borre
 * EXACTAMENTE lo que el almacén escribe, sin duplicar el formato a mano (contrato «Script de rescate»).
 */
export function loginAttemptRedisKeys(k: string, prefix: string = LOGIN_ATTEMPT_REDIS_PREFIX): [string, string] {
  return [`${prefix}f:${k}`, `${prefix}l:${k}`];
}

/**
 * Almacén Redis. El cliente lo construye `createLoginAttemptRedisClient` (propio, no el de BullMQ:
 * BullMQ exige reintentar para siempre, y un login no puede esperar para siempre — §4.57.2 #9).
 * `prefix` configurable para que la prueba directa (C7-12) use uno aleatorio por corrida.
 * Las claves son `<prefix>f:<k>` / `<prefix>l:<k>` y `<k>` nunca es el correo (es su HMAC).
 */
export class RedisLoginAttemptStore implements PrimaryLoginAttemptStore {
  private readonly client: RedisWithScripts;

  constructor(
    client: Redis,
    private readonly prefix: string = LOGIN_ATTEMPT_REDIS_PREFIX,
  ) {
    this.client = client as RedisWithScripts;
    if (typeof this.client.tcgAuthAcquire !== 'function') {
      this.client.defineCommand('tcgAuthAcquire', { numberOfKeys: 2, lua: ACQUIRE_LUA });
    }
    if (typeof this.client.tcgAuthBump !== 'function') {
      this.client.defineCommand('tcgAuthBump', { numberOfKeys: 1, lua: BUMP_LUA });
    }
  }

  private keys(k: string): [string, string] {
    return loginAttemptRedisKeys(k, this.prefix);
  }

  async acquireSync(key: string, pending: PendingAcquire): Promise<{ result: AcquireResult; photo: AttemptPhoto }> {
    const [failKey, lockKey] = this.keys(key);
    const r = await this.client.tcgAuthAcquire(
      failKey,
      lockKey,
      PASSWORD_FAILURES_TTL_MS,
      PASSWORD_FREE_ATTEMPTS,
      PASSWORD_LOCK_BASE_MS,
      PASSWORD_LOCK_MAX_MS,
      Math.max(0, Math.floor(pending.extra)),
      Math.max(0, Math.floor(pending.lockRestanteMs)),
      pending.borrar ? 1 : 0,
    );
    if (Number(r[0]) === 0) {
      const pttl = Number(r[1]);
      return {
        result: { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(pttl / 1000)) },
        photo: { failures: Number(r[2] ?? 0), lockMs: pttl },
      };
    }
    const failures = Number(r[1]);
    const lockMs = Number(r[2]);
    return {
      result: { allowed: true, failures, lockedNow: lockMs > 0, lockSeconds: Math.ceil(lockMs / 1000) },
      photo: { failures, lockMs },
    };
  }

  async acquire(key: string): Promise<AcquireResult> {
    return (await this.acquireSync(key, NO_PENDING_ACQUIRE)).result;
  }

  async bumpSync(key: string, ttlMs: number, pending: PendingBump): Promise<{ count: number; windowMs: number }> {
    const [aggKey] = this.keys(key);
    const r = await this.client.tcgAuthBump(aggKey, ttlMs, Math.max(0, Math.floor(pending.extra)), pending.borrar ? 1 : 0);
    return { count: Number(r[0]), windowMs: Number(r[1]) };
  }

  async bump(key: string, ttlMs: number): Promise<number> {
    return (await this.bumpSync(key, ttlMs, NO_PENDING_BUMP)).count;
  }

  async reset(key: string): Promise<void> {
    await this.client.del(...this.keys(key));
  }

  /** v1.80.9: `PTTL` de la clave de candado; `-2`/`-1` (no existe / sin TTL) ⇒ `0`. */
  async peekLockMs(key: string): Promise<number> {
    const [, lockKey] = this.keys(key);
    const pttl = Number(await this.client.pttl(lockKey));
    return pttl > 0 ? pttl : 0;
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    const r = await this.client.set(`${this.prefix}m:${key}`, '1', 'PX', ttlMs, 'NX');
    return r === 'OK';
  }
}

/** Rechaza si `p` no resuelve en `ms`. El comando puede completarse después: da igual (ver arriba). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`login-attempt store: timeout ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * Redis con respaldo en memoria (§4.57.2 #11). Cada operación contra Redis tiene `timeoutMs`; si
 * falla o vence, ESA operación y las de los `fallbackMs` siguientes van a memoria, con las mismas
 * reglas. ⛔ Nunca deja pasar sin contar (fail-open) ni lanza (fail-closed) — salvo `peekLockMs`, que es una
 * lectura del panel, no del login, y lanza `LoginAttemptStoreUnavailableError` (v1.80.9.1, D-4).
 *
 * v1.80.1 (§4.57.10.2): la memoria es la CACHÉ de Redis (`MemoryLoginAttemptStore.sync*`), arranca
 * de la foto cuando Redis no contesta, y lo que contó a solas se repone en la primera operación que
 * Redis vuelve a contestar para esa clave (`takePending*` → Lua). Un comando que Redis ejecutó pero
 * contestó tarde queda contado dos veces (una en Redis, otra en `unsynced`): falla hacia el lado
 * seguro y cuesta como mucho un intento por plazo vencido. Con réplicas > 1 cada una repone lo que
 * ella contó (`N-C7-6`). ⚠️ Lo pendiente de una clave que nadie vuelve a tocar no se repone (no hay
 * barrido de fondo): esa clave conserva su foto en memoria hasta caducar.
 */
export class ResilientLoginAttemptStore implements LoginAttemptStore, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LoginAttemptStore');
  private downUntil = 0;

  constructor(
    private readonly primary: PrimaryLoginAttemptStore,
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
          `intentos sigue en memoria DESDE LA FOTO durante ${this.fallbackMs / 1000}s y se repone al volver (C7-R, §4.57.10.2).`,
      );
    }
  }

  async acquire(key: string): Promise<AcquireResult> {
    if (this.degraded) return this.fallback.acquire(key);
    const pending = this.fallback.takePendingAcquire(key);
    try {
      const { result, photo } = await withTimeout(this.primary.acquireSync(key, pending), this.timeoutMs);
      this.fallback.syncAcquire(key, photo);
      return result;
    } catch (e) {
      this.markDown('acquire', e);
      this.fallback.giveBackPendingAcquire(key, pending);
      return this.fallback.acquire(key);
    }
  }

  async bump(key: string, ttlMs: number): Promise<number> {
    if (this.degraded) return this.fallback.bump(key, ttlMs);
    const pending = this.fallback.takePendingBump(key);
    try {
      const { count, windowMs } = await withTimeout(this.primary.bumpSync(key, ttlMs, pending), this.timeoutMs);
      this.fallback.syncBump(key, count, windowMs);
      return count;
    } catch (e) {
      this.markDown('bump', e);
      this.fallback.giveBackPendingBump(key, pending);
      return this.fallback.bump(key, ttlMs);
    }
  }

  async reset(key: string): Promise<void> {
    // Un reset supersede a todo lo pendiente de la clave. Si Redis lo ejecuta, la foto desaparece;
    // si no, queda `resetPending` y se repone (`borrar`) en la primera operación que Redis conteste.
    if (this.degraded) {
      this.fallback.markReset(key);
      return;
    }
    try {
      await withTimeout(this.primary.reset(key), this.timeoutMs);
      await this.fallback.reset(key);
    } catch (e) {
      this.markDown('reset', e);
      this.fallback.markReset(key);
    }
  }

  /**
   * ⭐ v1.80.9.1 (errata D-4, `API_CONTRACT §M6-U.4`, `ARCHITECTURE §4.58.9`) — la lectura del panel NO sigue la regla
   * de `acquire`:
   *  - degradado ⇒ lanza `LoginAttemptStoreUnavailableError` sin tocar Redis. ⛔ No lee la memoria: en este modo solo
   *    conoce las claves que tocó ESTA réplica (N-C7-6) y «sin candado» sería una afirmación que no puede sostener.
   *  - Redis falla o vence el plazo ⇒ lanza la misma clase y ⛔ NO llama a `markDown`: la lectura es «sin efectos»
   *    (interfaz, arriba) y una consulta del panel no puede cambiar por dónde decide el login.
   * (Hasta v1.80.9 leía la memoria y marcaba caído; descartado por el arquitecto, §4.58.9.)
   */
  async peekLockMs(key: string): Promise<number> {
    if (this.degraded) throw new LoginAttemptStoreUnavailableError('degraded (Redis down, reading memory is not the lock)');
    try {
      return await withTimeout(this.primary.peekLockMs(key), this.timeoutMs);
    } catch (e) {
      throw new LoginAttemptStoreUnavailableError(e instanceof Error ? e.message : String(e));
    }
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    // Mejor esfuerzo (§4.57.5): no entra en la caché ni se repone.
    if (this.degraded) return this.fallback.claimOnce(key, ttlMs);
    try {
      return await withTimeout(this.primary.claimOnce(key, ttlMs), this.timeoutMs);
    } catch (e) {
      this.markDown('claimOnce', e);
      return this.fallback.claimOnce(key, ttlMs);
    }
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
 * `lazyConnect`, y un listener de `'error'` que no tumba el proceso. Lo usa también el script de
 * rescate (mismo perfil, contrato «Script de rescate»).
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
