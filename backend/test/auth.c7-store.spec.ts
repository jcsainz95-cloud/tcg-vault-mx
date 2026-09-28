/**
 * C7 (v1.80) — el ALMACÉN del contador de intentos (`login-attempt.store.ts`), sin infraestructura.
 * `API_CONTRACT §1` «Límite de intentos por cuenta» (pruebas C7-4 memoria, C7-5, C7-6, C7-13 a nivel
 * de almacén); `ARCHITECTURE §4.57.5`. El almacén Redis se prueba contra Redis real en
 * `test/integration/auth-password-attempts-redis.e2e-spec.ts` (C7-12, C7-4 con Redis).
 */
import * as net from 'net';
import {
  MemoryLoginAttemptStore,
  RedisLoginAttemptStore,
  ResilientLoginAttemptStore,
  createLoginAttemptRedisClient,
  LoginAttemptStore,
  AcquireResult,
} from '../src/modules/auth/login-attempt.store';
import {
  PASSWORD_FAILURES_TTL_MS,
  PASSWORD_LOCK_MAX_MS,
  lockMsForFailures,
} from '../src/modules/auth/password-attempts.constants';

const MIN = 60_000;

function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('C7 — la fórmula del candado (constantes con nombre)', () => {
  it('60 s · 2^(f−5), tope 3600 s; sin candado antes del 5.º', () => {
    expect([1, 2, 3, 4].map(lockMsForFailures)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 10, 11, 12, 13, 1000].map((f) => lockMsForFailures(f) / 1000)).toEqual([
      60, 120, 240, 480, 960, 1920, 3600, 3600, 3600, 3600,
    ]);
  });

  it('el TTL del contador (2 h) es MAYOR que el tope del candado (60 min) — C7-6', () => {
    expect(PASSWORD_FAILURES_TTL_MS).toBe(2 * 60 * MIN);
    expect(PASSWORD_LOCK_MAX_MS).toBe(60 * MIN);
    expect(PASSWORD_FAILURES_TTL_MS).toBeGreaterThan(PASSWORD_LOCK_MAX_MS);
  });
});

describe('C7-5 — retroceso con reloj falso (almacén en memoria)', () => {
  it('candados de 60, 120, 240, 480, 960, 1920, 3600, 3600 s; los intentos durante el candado no cambian nada', async () => {
    const c = fakeClock();
    const s = new MemoryLoginAttemptStore(c.now);
    const k = 'k-backoff';
    for (let i = 1; i <= 4; i++) {
      await expect(s.acquire(k)).resolves.toEqual({ allowed: true, failures: i, lockedNow: false, lockSeconds: 0 });
    }
    const seen: number[] = [];
    for (let f = 5; f <= 12; f++) {
      const r = (await s.acquire(k)) as Extract<AcquireResult, { allowed: true }>;
      expect(r).toMatchObject({ allowed: true, failures: f, lockedNow: true });
      seen.push(r.lockSeconds);
      // Durante el candado: 3 intentos repartidos ⇒ 429 con el Retry-After que corresponde, y ni el
      // contador ni el TTL del candado se mueven (mutación (a): contar durante el candado).
      const third = Math.floor((r.lockSeconds * 1000) / 3);
      for (let j = 1; j <= 3; j++) {
        const b = await s.acquire(k);
        expect(b).toEqual({ allowed: false, retryAfterSeconds: Math.ceil((r.lockSeconds * 1000 - (j - 1) * third) / 1000) });
        c.advance(third);
      }
      c.advance(r.lockSeconds * 1000 - 3 * third); // justo al expirar
    }
    expect(seen).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600]);
  });
});

describe('C7-6 — el contador sobrevive al candado de 60 min y se olvida tras 2 h sin intentos', () => {
  it('tras un candado de 60 min, el siguiente intento vuelve a llevar candado', async () => {
    const c = fakeClock();
    const s = new MemoryLoginAttemptStore(c.now);
    let last: AcquireResult | undefined;
    for (let i = 0; i < 11; i++) {
      last = await s.acquire('k');
      if (last.allowed && last.lockSeconds) c.advance(last.lockSeconds * 1000);
    }
    expect(last).toMatchObject({ failures: 11, lockSeconds: 3600 });
    // El candado de 60 min expiró (el reloj ya avanzó). El contador sigue: el 12.º vuelve a candado.
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 12, lockedNow: true, lockSeconds: 3600 });
  });

  it('2 h sin intentos ⇒ 5 libres otra vez', async () => {
    const c = fakeClock();
    const s = new MemoryLoginAttemptStore(c.now);
    for (let i = 0; i < 5; i++) await s.acquire('k');
    c.advance(PASSWORD_FAILURES_TTL_MS);
    for (let i = 1; i <= 4; i++) {
      await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: i, lockedNow: false });
    }
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 5, lockedNow: true });
  });

  it('justo ANTES de las 2 h el contador sigue vivo', async () => {
    const c = fakeClock();
    const s = new MemoryLoginAttemptStore(c.now);
    for (let i = 0; i < 4; i++) await s.acquire('k');
    c.advance(PASSWORD_FAILURES_TTL_MS - 1);
    await expect(s.acquire('k')).resolves.toMatchObject({ failures: 5, lockedNow: true });
  });
});

describe('C7-4 (almacén en memoria) — 20 reservas simultáneas: exactamente 5 pasan', () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('corrida %i/10', async (run) => {
    const s = new MemoryLoginAttemptStore();
    const rs = await Promise.all(Array.from({ length: 20 }, () => s.acquire(`k-${run}`)));
    expect(rs.filter((r) => r.allowed)).toHaveLength(5);
    expect(rs.filter((r) => !r.allowed)).toHaveLength(15);
  });
});

describe('almacén en memoria — reset, claimOnce y tope de claves', () => {
  it('reset borra contador y candado', async () => {
    const s = new MemoryLoginAttemptStore();
    for (let i = 0; i < 5; i++) await s.acquire('k');
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: false });
    await s.reset('k');
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 1 });
  });

  it('claimOnce: verdadero una vez por ventana', async () => {
    const c = fakeClock();
    const s = new MemoryLoginAttemptStore(c.now);
    await expect(s.claimOnce('m', 1000)).resolves.toBe(true);
    await expect(s.claimOnce('m', 1000)).resolves.toBe(false);
    c.advance(1000);
    await expect(s.claimOnce('m', 1000)).resolves.toBe(true);
  });

  it('con el mapa lleno desaloja primero las caducadas y luego las más viejas; nunca pasa del tope', async () => {
    const c = fakeClock();
    const s = new MemoryLoginAttemptStore(c.now, 3);
    await s.acquire('old');
    c.advance(PASSWORD_FAILURES_TTL_MS + 1); // «old» caducó
    await s.acquire('a');
    await s.acquire('b');
    c.advance(1500);
    await s.acquire('c'); // 4 > 3 ⇒ barre la caducada
    expect(s.size).toBe(3);
    await s.acquire('d'); // sin caducadas ⇒ la más vieja («a»)
    expect(s.size).toBe(3);
    await expect(s.acquire('b')).resolves.toMatchObject({ failures: 2 });
    await expect(s.acquire('a')).resolves.toMatchObject({ failures: 1 });
  });
});

/** Almacén que siempre falla / nunca responde — para el respaldo. */
function brokenStore(mode: 'throw' | 'hang'): LoginAttemptStore & { calls: number } {
  const st = {
    calls: 0,
    acquire() {
      st.calls++;
      return mode === 'throw' ? Promise.reject(new Error('down')) : new Promise<never>(() => undefined);
    },
    reset() {
      st.calls++;
      return mode === 'throw' ? Promise.reject(new Error('down')) : new Promise<never>(() => undefined);
    },
    claimOnce() {
      st.calls++;
      return mode === 'throw' ? Promise.reject(new Error('down')) : new Promise<never>(() => undefined);
    },
  };
  return st as unknown as LoginAttemptStore & { calls: number };
}

describe('C7-13 (a nivel de almacén) — Redis que falla o no responde ⇒ memoria, ni fail-open ni fail-closed', () => {
  it.each(['throw', 'hang'] as const)('primario «%s»: 5 permitidos, el 6.º bloqueado, cada operación ≤ 250 ms + margen', async (mode) => {
    const primary = brokenStore(mode);
    const s = new ResilientLoginAttemptStore(primary, new MemoryLoginAttemptStore());
    const t0 = Date.now();
    const first = await s.acquire('k');
    expect(Date.now() - t0).toBeLessThan(250 + 200);
    expect(first).toMatchObject({ allowed: true, failures: 1 });
    for (let i = 2; i <= 5; i++) await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: i });
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: false });
    // Tras el primer fallo, 30 s en memoria: el primario no se vuelve a tocar.
    expect(primary.calls).toBe(1);
    expect(s.degraded).toBe(true);
  });

  it('pasados 30 s vuelve a intentar Redis', async () => {
    const c = fakeClock();
    const primary = brokenStore('throw');
    const s = new ResilientLoginAttemptStore(primary, new MemoryLoginAttemptStore(c.now), undefined, 250, 30_000, c.now);
    await s.acquire('k');
    await s.acquire('k');
    expect(primary.calls).toBe(1);
    c.advance(30_000);
    await s.acquire('k');
    expect(primary.calls).toBe(2);
  });

  it('con Redis sano usa Redis (no la memoria)', async () => {
    const memory = new MemoryLoginAttemptStore();
    const primary = new MemoryLoginAttemptStore();
    const s = new ResilientLoginAttemptStore(primary, memory);
    await s.acquire('k');
    await expect(primary.acquire('k')).resolves.toMatchObject({ failures: 2 });
    await expect(memory.acquire('k')).resolves.toMatchObject({ failures: 1 });
  });

  it('reset limpia la memoria SIEMPRE y Redis si está', async () => {
    const memory = new MemoryLoginAttemptStore();
    const primary = new MemoryLoginAttemptStore();
    const s = new ResilientLoginAttemptStore(primary, memory);
    await memory.acquire('k');
    await primary.acquire('k');
    await s.reset('k');
    await expect(memory.acquire('k')).resolves.toMatchObject({ failures: 1 });
    await expect(primary.acquire('k')).resolves.toMatchObject({ failures: 1 });
  });

  it('cliente ioredis REAL contra un puerto que acepta y nunca contesta ⇒ memoria, sin colgar', async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((sock) => sockets.push(sock)); // agujero negro
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const client = createLoginAttemptRedisClient(`redis://127.0.0.1:${port}`);
    const s = new ResilientLoginAttemptStore(new RedisLoginAttemptStore(client, 'tcg:test:'), new MemoryLoginAttemptStore(), client);
    try {
      const t0 = Date.now();
      await s.onModuleInit(); // `connect()` sí conecta (TCP), pero Redis nunca responde
      const results: AcquireResult[] = [];
      for (let i = 0; i < 6; i++) results.push(await s.acquire('k'));
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
      expect(results[5]).toMatchObject({ allowed: false });
    } finally {
      client.disconnect();
      sockets.forEach((x) => x.destroy());
      await new Promise((r) => server.close(r));
    }
  });

  it('cliente ioredis REAL contra un puerto CERRADO ⇒ memoria, sin colgar', async () => {
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise((r) => probe.close(r)); // ahora está cerrado
    const client = createLoginAttemptRedisClient(`redis://127.0.0.1:${port}`);
    const s = new ResilientLoginAttemptStore(new RedisLoginAttemptStore(client, 'tcg:test:'), new MemoryLoginAttemptStore(), client);
    try {
      const t0 = Date.now();
      await s.onModuleInit();
      const results: AcquireResult[] = [];
      for (let i = 0; i < 6; i++) results.push(await s.acquire('k'));
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
      expect(results[5]).toMatchObject({ allowed: false });
    } finally {
      client.disconnect();
    }
  });
});
