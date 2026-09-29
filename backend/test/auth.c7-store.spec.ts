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
  PrimaryLoginAttemptStore,
  AcquireResult,
} from '../src/modules/auth/login-attempt.store';
import {
  DEVICE_ROUTE_WINDOW_MS,
  PASSWORD_FAILURES_TTL_MS,
  PASSWORD_LOCK_MAX_MS,
  lockMsForFailures,
} from '../src/modules/auth/password-attempts.constants';
import { FakeRedisAttemptStore } from './helpers/fake-redis-attempt-store';

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

/** Almacén que siempre falla / nunca responde — para el respaldo. Implementa la interfaz PRIMARIA entera. */
function brokenStore(mode: 'throw' | 'hang'): PrimaryLoginAttemptStore & { calls: number } {
  const fail = <T>(): Promise<T> =>
    mode === 'throw' ? Promise.reject(new Error('down')) : new Promise<never>(() => undefined);
  const st = {
    calls: 0,
    acquire: () => (st.calls++, fail()),
    acquireSync: () => (st.calls++, fail()),
    bump: () => (st.calls++, fail()),
    bumpSync: () => (st.calls++, fail()),
    reset: () => (st.calls++, fail()),
    claimOnce: () => (st.calls++, fail()),
  };
  return st as unknown as PrimaryLoginAttemptStore & { calls: number };
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

  // v1.80.1 (C7-22): aquí decía «con Redis sano usa Redis (no la memoria)» y afirmaba lo contrario del
  // diseño (§4.57.5): la memoria es CACHÉ de la última respuesta de Redis. Se sustituye por orden del
  // contrato (`API_CONTRACT §1` C7-22, «se sustituye por…»).
  it('con Redis sano la memoria es la FOTO de Redis: tras acquire tiene failures = 1; un acquire con Redis vencido devuelve failures = 2 (C7-22)', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    const memory = new MemoryLoginAttemptStore(c.now);
    const s = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, c.now);
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 1 });
    expect(memory.peek('k')).toMatchObject({ failures: 1, unsynced: 0, resetPending: false });
    redis.mode = 'hang';
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 2 });
    expect(memory.peek('k')).toMatchObject({ failures: 2, unsynced: 1 });
  });

  it('reset con Redis sano: DEL en Redis y la foto desaparece; con Redis caído: reset pendiente en memoria', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    const memory = new MemoryLoginAttemptStore(c.now);
    const s = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, c.now);
    await s.acquire('k');
    await s.reset('k');
    expect(redis.failures('k')).toBeNull();
    expect(memory.peek('k')).toBeUndefined();
    await expect(s.acquire('k')).resolves.toMatchObject({ failures: 1 });
    redis.mode = 'throw';
    await s.reset('k');
    expect(memory.peek('k')).toMatchObject({ failures: 0, resetPending: true });
    await expect(s.acquire('k')).resolves.toMatchObject({ failures: 1 });
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

describe('bump — contador de ventana FIJA (el agregado por vía dispositivo, §4.57.10.1 b)', () => {
  it('memoria: cuenta desde 1, la ventana se fija al crear y NO se renueva; al vencer vuelve a 1', async () => {
    const c = fakeClock();
    const s = new MemoryLoginAttemptStore(c.now);
    expect(await s.bump('agg', 1000)).toBe(1);
    c.advance(600);
    expect(await s.bump('agg', 1000)).toBe(2);
    c.advance(399);
    expect(await s.bump('agg', 1000)).toBe(3); // a 999 ms del primero: viva
    c.advance(1); // 1000 ms desde el PRIMERO (una ventana deslizante seguiría viva: el último fue hace 1 ms)
    expect(await s.bump('agg', 1000)).toBe(1);
  });

  it('memoria: reset borra la ventana', async () => {
    const s = new MemoryLoginAttemptStore();
    await s.bump('agg', DEVICE_ROUTE_WINDOW_MS);
    await s.bump('agg', DEVICE_ROUTE_WINDOW_MS);
    await s.reset('agg');
    expect(await s.bump('agg', DEVICE_ROUTE_WINDOW_MS)).toBe(1);
  });

  it('resiliente: Redis manda; con Redis vencido sigue desde la foto; al volver repone lo no visto', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    const memory = new MemoryLoginAttemptStore(c.now);
    const s = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, c.now);
    expect(await s.bump('agg', 60_000)).toBe(1);
    expect(await s.bump('agg', 60_000)).toBe(2);
    redis.mode = 'hang';
    expect(await s.bump('agg', 60_000)).toBe(3); // memoria, desde la foto (2), no desde 0
    expect(await s.bump('agg', 60_000)).toBe(4);
    c.advance(30_000);
    redis.mode = 'ok';
    expect(await s.bump('agg', 60_000)).toBe(5); // 2 + extra 2 + 1
    expect(redis.window('agg')).toMatchObject({ count: 5 });
    expect(redis.replays).toEqual([{ key: 'agg', pending: { extra: 2, borrar: false } }]);
  });
});

describe('C7-22 (a nivel de almacén) — la memoria es caché de Redis + lo no visto, y se repone en el mismo Lua', () => {
  it('Redis contesta 1–3, vence 4–6 (4.º y 5.º permitidos, 6.º bloqueado); +30 s el 7.º sigue bloqueado y Redis queda con f = 5 y candado', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    const memory = new MemoryLoginAttemptStore(c.now);
    const s = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, c.now);
    for (let i = 1; i <= 3; i++) await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: i });
    redis.mode = 'hang';
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 4 });
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 5, lockedNow: true, lockSeconds: 60 });
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(redis.failures('k')).toBe(3);
    expect(redis.lockPttl('k')).toBe(0);
    const calls = redis.calls;
    c.advance(30_000);
    redis.mode = 'ok';
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 30 });
    expect(redis.calls).toBe(calls + 1);
    expect(redis.failures('k')).toBe(5);
    expect(redis.lockPttl('k')).toBe(30_000);
    // La foto vuelve a ser la de Redis: sin nada pendiente.
    expect(memory.peek('k')).toMatchObject({ failures: 5, unsynced: 0, resetPending: false });
    // Y la reposición NUNCA acorta un candado que Redis ya tenga: si Redis tuviera 50 s y la memoria 30 s, gana 50.
    c.advance(30_000); // el candado vence en los dos
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: true, failures: 6, lockSeconds: 120 });
  });

  it('el candado restante de la memoria no acorta uno más largo que Redis ya tenga', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    const memory = new MemoryLoginAttemptStore(c.now);
    const s = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, c.now);
    for (let i = 0; i < 5; i++) await s.acquire('k'); // Redis: f = 5, candado 60 s
    c.advance(60_000); // vence
    await expect(s.acquire('k')).resolves.toMatchObject({ failures: 6, lockSeconds: 120 }); // Redis: f = 6, candado 120 s
    expect(redis.lockPttl('k')).toBe(120_000);
    redis.mode = 'hang';
    await s.acquire('k'); // memoria: bloqueado (foto), nada que reponer salvo el candado restante (120 s)
    // Mientras tanto OTRA réplica alargó el candado en Redis a 200 s.
    redis.locks.set('k', c.now() + 200_000);
    c.advance(30_000);
    redis.mode = 'ok';
    // La memoria trae 90 s restantes; Redis tiene 170 s ⇒ gana Redis (nunca se acorta).
    await expect(s.acquire('k')).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 170 });
    expect(redis.lockPttl('k')).toBe(170_000);
    expect(memory.peek('k')).toMatchObject({ failures: 6, lockExpiresAt: c.now() + 170_000 });
  });

  it('una reposición que Redis ejecuta pero contesta tarde se cuenta dos veces (lado seguro, §4.57.5), nunca cero', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    const memory = new MemoryLoginAttemptStore(c.now);
    const s = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, c.now);
    await s.acquire('k');
    redis.mode = 'hang';
    await s.acquire('k'); // memoria: f = 2, unsynced 1
    c.advance(30_000);
    redis.mode = 'throw'; // vuelve a fallar en la primera reposición: lo pendiente se devuelve a la memoria
    await expect(s.acquire('k')).resolves.toMatchObject({ failures: 3 });
    expect(memory.peek('k')).toMatchObject({ failures: 3, unsynced: 2 });
    c.advance(30_000);
    redis.mode = 'ok';
    await expect(s.acquire('k')).resolves.toMatchObject({ failures: 4 }); // 1 + extra 2 + 1
    expect(redis.failures('k')).toBe(4);
  });
});
