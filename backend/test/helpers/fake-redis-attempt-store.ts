/**
 * fake-redis-attempt-store.ts — v1.80.1 (C7-22): un «Redis» SIMULADO para el almacén de intentos,
 * con la MISMA semántica que los dos scripts Lua de `login-attempt.store.ts` (reserva con
 * reposición; `bump` de ventana fija) sobre mapas en memoria y un reloj falso, y un interruptor
 * para que deje de contestar (`hang`), falle (`throw`) o vuelva (`ok`). Propiedad: backend.
 *
 * Sirve para probar `ResilientLoginAttemptStore` (memoria = caché de Redis + reposición,
 * `ARCHITECTURE §4.57.5`, §4.57.10.2) sin infraestructura. El Lua REAL se prueba contra Redis
 * real en `test/integration/auth-password-attempts-redis.e2e-spec.ts`.
 */
import {
  AcquireResult,
  AttemptPhoto,
  PendingAcquire,
  PendingBump,
  PrimaryLoginAttemptStore,
} from '../../src/modules/auth/login-attempt.store';
import {
  PASSWORD_FAILURES_TTL_MS,
  lockMsForFailures,
} from '../../src/modules/auth/password-attempts.constants';

export type FakeRedisMode = 'ok' | 'hang' | 'throw';

interface Ttl {
  v: number;
  exp: number;
}

export class FakeRedisAttemptStore implements PrimaryLoginAttemptStore {
  mode: FakeRedisMode = 'ok';
  /** Llamadas recibidas (contestadas o no). */
  calls = 0;
  /** Bitácora de las reposiciones que llegaron con algo que reponer (para las aserciones de C7-22). */
  readonly replays: { key: string; pending: PendingAcquire | PendingBump }[] = [];
  readonly fails = new Map<string, Ttl>();
  readonly locks = new Map<string, number>();
  readonly windows = new Map<string, Ttl>();
  private readonly claims = new Map<string, number>();

  constructor(private readonly clock: () => number) {}

  /** Estado visible de una clave (como lo vería `redis-cli`): `null` si no existe. */
  failures(key: string): number | null {
    const e = this.fails.get(key);
    return e && e.exp > this.clock() ? e.v : null;
  }

  lockPttl(key: string): number {
    const exp = this.locks.get(key);
    return exp !== undefined && exp > this.clock() ? exp - this.clock() : 0;
  }

  window(key: string): { count: number; pttl: number } | null {
    const e = this.windows.get(key);
    return e && e.exp > this.clock() ? { count: e.v, pttl: e.exp - this.clock() } : null;
  }

  private gate<T>(fn: () => T): Promise<T> {
    this.calls++;
    if (this.mode === 'hang') return new Promise<never>(() => undefined);
    if (this.mode === 'throw') return Promise.reject(new Error('fake redis down'));
    return Promise.resolve(fn());
  }

  private incrFail(key: string, by: number, now: number): number {
    const e = this.fails.get(key);
    const v = (e && e.exp > now ? e.v : 0) + by;
    this.fails.set(key, { v, exp: now + PASSWORD_FAILURES_TTL_MS });
    return v;
  }

  acquireSync(key: string, pending: PendingAcquire): Promise<{ result: AcquireResult; photo: AttemptPhoto }> {
    return this.gate(() => {
      const now = this.clock();
      if (pending.borrar || pending.extra > 0 || pending.lockRestanteMs > 0) this.replays.push({ key, pending });
      // ── reposición (v1.80.1), en el mismo orden que el Lua ──
      if (pending.borrar) {
        this.fails.delete(key);
        this.locks.delete(key);
      }
      if (pending.extra > 0) this.incrFail(key, pending.extra, now);
      if (pending.lockRestanteMs > this.lockPttl(key)) this.locks.set(key, now + pending.lockRestanteMs);
      // ── reserva ──
      const pttl = this.lockPttl(key);
      if (pttl > 0) {
        const f = this.failures(key) ?? 0;
        return {
          result: { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(pttl / 1000)) },
          photo: { failures: f, lockMs: pttl },
        };
      }
      const f = this.incrFail(key, 1, now);
      const lockMs = lockMsForFailures(f);
      if (lockMs > 0) this.locks.set(key, now + lockMs);
      return {
        result: { allowed: true, failures: f, lockedNow: lockMs > 0, lockSeconds: Math.ceil(lockMs / 1000) },
        photo: { failures: f, lockMs },
      };
    });
  }

  async acquire(key: string): Promise<AcquireResult> {
    return (await this.acquireSync(key, { extra: 0, lockRestanteMs: 0, borrar: false })).result;
  }

  bumpSync(key: string, ttlMs: number, pending: PendingBump): Promise<{ count: number; windowMs: number }> {
    return this.gate(() => {
      const now = this.clock();
      if (pending.borrar || pending.extra > 0) this.replays.push({ key, pending });
      if (pending.borrar) this.windows.delete(key);
      const alive = (): Ttl | undefined => {
        const e = this.windows.get(key);
        return e && e.exp > now ? e : undefined;
      };
      const incr = (by: number) => {
        const e = alive();
        if (e) e.v += by;
        else this.windows.set(key, { v: by, exp: now + ttlMs }); // SET 0 PX ttl NX; INCRBY
      };
      if (pending.extra > 0) incr(pending.extra);
      incr(1);
      const e = alive()!;
      return { count: e.v, windowMs: e.exp - now };
    });
  }

  async bump(key: string, ttlMs: number): Promise<number> {
    return (await this.bumpSync(key, ttlMs, { extra: 0, borrar: false })).count;
  }

  reset(key: string): Promise<void> {
    return this.gate(() => {
      this.fails.delete(key);
      this.locks.delete(key);
      this.windows.delete(key);
    });
  }

  /** v1.80.9: `PTTL` del candado (como el `peekLockMs` de `RedisLoginAttemptStore`). */
  peekLockMs(key: string): Promise<number> {
    return this.gate(() => this.lockPttl(key));
  }

  claimOnce(key: string, ttlMs: number): Promise<boolean> {
    return this.gate(() => {
      const now = this.clock();
      const until = this.claims.get(key);
      if (until !== undefined && until > now) return false;
      this.claims.set(key, now + ttlMs);
      return true;
    });
  }
}
