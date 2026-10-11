/**
 * C7 rev v1.80.1 — C7-22 (QA IMPORTANTE 1, invariante `C7-R`): un plazo de Redis vencido NO compra
 * intentos. La memoria es CACHÉ de la última respuesta de Redis + lo que Redis no vio, y la primera
 * operación que Redis vuelve a contestar lo repone en el mismo Lua de la reserva.
 * `API_CONTRACT §1` C7-22; `ARCHITECTURE §4.57.5`, §4.57.10.2. Cierra `SEC-C7-RDEG` y `D-C7-3`.
 *
 * Nivel `AuthService` con argon2 REAL espiado (la cuenta que importa: cuántos intentos llegan a
 * argon2). Redis SIMULADO (`FakeRedisAttemptStore`, misma semántica que el Lua); el Lua real se
 * prueba contra Redis en `test/integration/auth-password-attempts-redis.e2e-spec.ts`.
 *
 * Mutaciones que lo ponen en rojo: (a) memoria desde 0 al caer (el código de `8ea245f`) ⇒ 10 a
 * argon2; (b) no reponer al volver ⇒ el 7.º 401; (c) reponer sin `borrar` ⇒ el reset se pierde.
 */
jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';
import {
  MemoryLoginAttemptStore,
  ResilientLoginAttemptStore,
} from '../src/modules/auth/login-attempt.store';
import { FakeRedisAttemptStore } from './helpers/fake-redis-attempt-store';
import { attempt, BAD, GOOD, makeWorld } from './helpers/auth-c7-world';

jest.setTimeout(120_000);

const verifySpy = argon2.verify as unknown as jest.Mock;
beforeEach(() => verifySpy.mockClear());

function makeCachedWorld() {
  const clock = { t: Date.now() };
  const redis = new FakeRedisAttemptStore(() => clock.t);
  const memory = new MemoryLoginAttemptStore(() => clock.t);
  const store = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, () => clock.t);
  const world = makeWorld({ store, clock });
  return { ...world, redis, memory, resilient: store };
}

describe('C7-22 — Redis contesta 1–3, vence desde el 4.º: 4.º y 5.º 401, 6.º 429, argon2 = 5 (no 10); al volver, repone (N=3, 3/3)', () => {
  it.each([1, 2, 3])('corrida %i/3', async () => {
    const { svc, addUser, deps, clock, redis, resilient } = makeCachedWorld();
    const u = await addUser();
    const key = deps.attempts.accountKey(u.email);

    // 1–3: Redis contesta.
    for (let i = 1; i <= 3; i++) expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(401);
    expect(redis.calls).toBe(3);
    expect(redis.failures(key)).toBe(3);

    // Desde el 4.º Redis tarda más que el plazo (250 ms): 4.º y 5.º 401 (memoria DESDE LA FOTO f=3),
    // 6.º 429. argon2 = 5 en total, no 10.
    redis.mode = 'hang';
    const t0 = Date.now();
    expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(401);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240); // venció el plazo de verdad
    expect(resilient.degraded).toBe(true);
    expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(401);
    const sixth = await attempt(svc, { email: u.email, password: BAD });
    expect(sixth).toMatchObject({ status: 429, code: 'TOO_MANY_PASSWORD_ATTEMPTS', argon2: 0 });
    expect(verifySpy).toHaveBeenCalledTimes(5);
    const callsBefore = redis.calls; // 4 (el que venció)
    // Redis sigue con su estado viejo: f = 3, sin candado.
    expect(redis.failures(key)).toBe(3);
    expect(redis.lockPttl(key)).toBe(0);

    // +30 s: Redis contesta otra vez con su estado viejo ⇒ el 7.º SIGUE 429 y Redis queda con
    // f = 5 y el candado (se repuso en UN solo Lua: calls sube en 1).
    clock.t += 30_000;
    redis.mode = 'ok';
    const seventh = await attempt(svc, { email: u.email, password: BAD });
    expect(seventh).toMatchObject({ status: 429, argon2: 0 });
    expect(redis.calls).toBe(callsBefore + 1);
    expect(redis.failures(key)).toBe(5);
    expect(redis.lockPttl(key)).toBeGreaterThan(0);
    expect(redis.lockPttl(key)).toBeLessThanOrEqual(30_000); // el candado de 60 s puesto hace 30 s
    expect(redis.replays).toEqual([{ key, pending: { extra: 2, lockRestanteMs: 30_000, borrar: false } }]);
    expect(verifySpy).toHaveBeenCalledTimes(5);
  });
});

describe('C7-22 — un reset hecho en modo memoria se repone al volver Redis (borrar): cierra SEC-C7-RDEG', () => {
  it('4 fallos con Redis, acierto con Redis caído (reset en memoria) ⇒ al volver, las claves de Redis NO existen y el siguiente intento es el 1.º', async () => {
    const { svc, addUser, deps, clock, redis } = makeCachedWorld();
    const u = await addUser();
    const key = deps.attempts.accountKey(u.email);
    for (let i = 0; i < 4; i++) expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(401);
    expect(redis.failures(key)).toBe(4);

    redis.mode = 'hang';
    // Acierto en modo memoria: la reserva es el 5.º (candado en memoria), argon2 OK ⇒ reset en memoria.
    expect((await attempt(svc, { email: u.email, password: GOOD })).status).toBe(200);
    expect(redis.failures(key)).toBe(4); // Redis no se enteró de nada

    clock.t += 30_000;
    redis.mode = 'ok';
    // Vuelve Redis: el siguiente intento lleva `borrar` ⇒ DEL antes de reservar ⇒ f = 1, sin candado.
    const next = await attempt(svc, { email: u.email, password: BAD });
    expect(next.status).toBe(401);
    expect(redis.failures(key)).toBe(1);
    expect(redis.lockPttl(key)).toBe(0);
    expect(redis.replays).toEqual([{ key, pending: { extra: 0, lockRestanteMs: 0, borrar: true } }]);
    // Sin la reposición del `borrar` (mutación c), Redis tendría f = 5 + candado y esto sería 429.
    for (let i = 0; i < 3; i++) expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(401);
    expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(401); // 5.º ⇒ pone candado
    expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(429);
  });
});

describe('C7-22 — repetido con Redis caído de verdad (C7-13): misma cuenta, argon2 = 5', () => {
  it.each(['throw', 'hang'] as const)('primario «%s» desde el principio: 401×5, 429, argon2 = 5', async (mode) => {
    const { svc, addUser, redis } = makeCachedWorld();
    const u = await addUser();
    redis.mode = mode;
    const seq: number[] = [];
    for (let i = 0; i < 6; i++) seq.push((await attempt(svc, { email: u.email, password: BAD })).status);
    expect(seq).toEqual([401, 401, 401, 401, 401, 429]);
    expect(verifySpy).toHaveBeenCalledTimes(5);
  });
});

describe('C7-22 — el agregado por vía dispositivo también es caché + reposición (bump)', () => {
  it('29 intentos con Redis, 2 en memoria, al volver Redis el 32.º ya va al cubo de la cuenta (n = 32 > 30)', async () => {
    const { svc, addUser, deps, clock, redis } = makeCachedWorld();
    const u = await addUser();
    const d = (await attempt(svc, { email: u.email, password: GOOD })).body!.deviceToken;
    const agg = deps.attempts.deviceAggregateKey(u.id);
    // Cierra el cubo de la cuenta para que «ir al cubo de la cuenta» sea observable (429).
    for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
    // 29 aciertos por dispositivo (el acierto NO limpia el agregado; sí limpia el cubo del dispositivo).
    for (let i = 0; i < 29; i++) expect((await attempt(svc, { email: u.email, password: GOOD, deviceToken: d })).status).toBe(200);
    expect(redis.window(agg)?.count).toBe(29);
    redis.mode = 'hang';
    expect((await attempt(svc, { email: u.email, password: GOOD, deviceToken: d })).status).toBe(200); // 30 (memoria, desde la foto)
    expect((await attempt(svc, { email: u.email, password: GOOD, deviceToken: d })).status).toBe(429); // 31 ⇒ cubo de la cuenta
    clock.t += 30_000;
    redis.mode = 'ok';
    // Al volver: repone los 2 no vistos (29 + 2 + 1 = 32 > 30) ⇒ cubo de la cuenta ⇒ 429.
    expect((await attempt(svc, { email: u.email, password: GOOD, deviceToken: d })).status).toBe(429);
    expect(redis.window(agg)?.count).toBe(32);
  });
});
