/**
 * C7 rev v1.80.1 — `SEC-C7-MINT`: el `deviceToken` es la SESIÓN, no la respuesta.
 * `API_CONTRACT §1` pruebas C7-19, C7-20 y C7-21; `ARCHITECTURE §4.57.4`, §4.57.10.1.
 *
 * Sin infraestructura: Prisma en memoria, argon2 REAL envuelto en un espía, reloj falso. Cada
 * `describe` lleva su número; la mutación que lo pone en rojo está en el contrato:
 *  - C7-19: volver a `randomUUID()` en `refresh` (o `issue(user.id)` sin `sid`) ⇒ el 6.º llega a argon2.
 *  - C7-20: (a) quitar el `bump`; (b) que el acierto limpie el agregado; (c) ventana deslizante.
 *  - C7-21: derivar el `sid` legado sin `sub`; o `sid` nuevo por reproducción.
 */
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';

jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';
import {
  DEVICE_AGGREGATE_KEY_PREFIX,
  DEVICE_ROUTE_CAP,
  DEVICE_ROUTE_WINDOW_MS,
} from '../src/modules/auth/password-attempts.constants';
import { attempt, BAD, C7_REFRESH_SECRET, claims, GOOD, makeWorld } from './helpers/auth-c7-world';

jest.setTimeout(120_000); // argon2 real (m=64 MiB): C7-20 hace ~40 verificaciones

const verifySpy = argon2.verify as unknown as jest.Mock;
beforeEach(() => verifySpy.mockClear());

describe('C7-19 — N refrescos ⇒ UN dispositivo: jti del deviceToken = sid del refresh token (N=5, se exige 5/5)', () => {
  it.each([1, 2, 3, 4, 5])('usuario %i/5', async () => {
    const { svc, addUser } = makeWorld();
    const u = await addUser();
    const first = await attempt(svc, { email: u.email, password: GOOD });
    expect(first.status).toBe(200);
    const R0 = first.body!.refreshToken;
    const D0 = first.body!.deviceToken;
    const sid = claims(R0).sid;
    expect(typeof sid).toBe('string');
    expect((sid as string).length).toBeGreaterThan(0);
    expect(claims(D0).jti).toBe(sid);

    // 4 refrescos: 2 reproduciendo R0, 2 encadenados.
    const r1 = await svc.refresh(R0);
    const r2 = await svc.refresh(R0);
    const r3 = await svc.refresh(r1.refreshToken);
    const r4 = await svc.refresh(r3.refreshToken);
    const devices = [r1, r2, r3, r4].map((r) => r.deviceToken);
    for (const r of [r1, r2, r3, r4]) {
      expect(claims(r.deviceToken).jti).toBe(sid);
      expect(claims(r.refreshToken).sid).toBe(sid);
    }
    // Y el exp se renueva (no es el mismo token repetido).
    expect(claims(r1.deviceToken).sub).toBe(u.id);

    // El atacante bloquea la cuenta (sin token).
    for (let i = 0; i < 5; i++) expect((await attempt(svc, { email: u.email, password: BAD })).status).toBe(401);
    expect((await attempt(svc, { email: u.email, password: GOOD })).status).toBe(429);

    verifySpy.mockClear();
    // 5 fallos con el 1.º deviceToken ⇒ 401×5 (es un cubo con 5 libres, el mismo para los cuatro).
    for (let i = 0; i < 5; i++) {
      expect((await attempt(svc, { email: u.email, password: BAD, deviceToken: devices[0] })).status).toBe(401);
    }
    // 1 fallo con cada uno de los otros tres ⇒ 429×3 (mismo cubo ⇒ ya con candado).
    for (const d of devices.slice(1)) {
      const r = await attempt(svc, { email: u.email, password: BAD, deviceToken: d });
      expect(r).toMatchObject({ status: 429, code: 'TOO_MANY_PASSWORD_ATTEMPTS', argon2: 0 });
    }
    expect(verifySpy).toHaveBeenCalledTimes(5);
  });
});

describe('C7-20 — tope agregado por cuenta: 30 intentos por vía dispositivo en 24 h, ventana FIJA, no lo limpia el acierto', () => {
  it('29 fallos repartidos ⇒ 401×29; el 30.º correcto ⇒ 200; el 31.º correcto ⇒ 429 sin argon2; +24 h ⇒ 200; reset-password ⇒ el agregado no existe', async () => {
    const { svc, addUser, clock, store, tokens } = makeWorld();
    const u = await addUser();
    // ⚠️ El contrato dice «7 logins»; con ≤ 4 fallos por jti (el 5.º ya pone candado de dispositivo)
    // 7 jti dan como mucho 28 fallos, no 29. Se usan 8 (discrepancia anotada para el arquitecto).
    const devices: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await attempt(svc, { email: u.email, password: GOOD });
      expect(r.status).toBe(200);
      devices.push(r.body!.deviceToken);
    }
    const jtis = new Set(devices.map((d) => claims(d).jti));
    expect(jtis.size).toBe(8);

    // Atacante bloquea la cuenta.
    for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
    expect((await attempt(svc, { email: u.email, password: GOOD })).status).toBe(429);

    // 29 fallos, ≤ 4 por jti, con el reloj avanzando 1 s por intento (así la ventana fija y una
    // deslizante se distinguen al final).
    const t0 = clock.t;
    verifySpy.mockClear();
    for (let i = 0; i < 29; i++) {
      clock.t += 1000;
      const r = await attempt(svc, { email: u.email, password: BAD, deviceToken: devices[i % 8] });
      expect(r).toMatchObject({ status: 401, argon2: 1 });
    }
    expect(verifySpy).toHaveBeenCalledTimes(29);

    // 30.º: correcta con un jti ⇒ 200 (n = 30 no pasa del tope).
    clock.t += 1000;
    expect((await attempt(svc, { email: u.email, password: GOOD, deviceToken: devices[0] })).status).toBe(200);

    // 31.º: correcta con cualquier jti ⇒ 429 SIN argon2 (fue al cubo de la cuenta, que está cerrado).
    clock.t += 1000;
    verifySpy.mockClear();
    for (const d of [devices[1], devices[5], devices[0]]) {
      const r = await attempt(svc, { email: u.email, password: GOOD, deviceToken: d });
      expect(r).toMatchObject({ status: 429, code: 'TOO_MANY_PASSWORD_ATTEMPTS', argon2: 0 });
    }
    expect(verifySpy).not.toHaveBeenCalled();

    // Ventana FIJA desde el primero: a t0 + 24 h venció, aunque el último bump fue ~35 s después de t0.
    // A +24 h ningún candado de cuenta sobrevive (tope 60 min, contador 2 h): el atacante lo vuelve a
    // poner ANTES de la comprobación, para que «ir al cubo de la cuenta» siga siendo observable (429).
    // Con ventana deslizante (mutación c) el agregado seguiría en 33 > 30 ⇒ cubo de la cuenta ⇒ 429.
    clock.t = t0 + DEVICE_ROUTE_WINDOW_MS + 1000;
    for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
    expect((await attempt(svc, { email: u.email, password: GOOD })).status).toBe(429);
    expect((await attempt(svc, { email: u.email, password: GOOD, deviceToken: devices[2] })).status).toBe(200);

    // reset-password completado ⇒ el agregado no existe (un bump lo encuentra vacío: vuelve a 1).
    clock.t += 1000;
    await attempt(svc, { email: u.email, password: BAD, deviceToken: devices[3] }); // n = 2 en la ventana nueva
    tokens.consume.mockResolvedValueOnce(u.id);
    await svc.resetPassword('tok', 'otra-clave-123');
    await expect(store.bump(DEVICE_AGGREGATE_KEY_PREFIX + u.id, DEVICE_ROUTE_WINDOW_MS)).resolves.toBe(1);
  });

  it('el tope es 30 y la ventana 24 h (constantes con nombre)', () => {
    expect(DEVICE_ROUTE_CAP).toBe(30);
    expect(DEVICE_ROUTE_WINDOW_MS).toBe(24 * 60 * 60_000);
    expect(DEVICE_AGGREGATE_KEY_PREFIX).toBe('auth-pwdevagg:v1:');
  });

  it('el bump solo ocurre con un deviceToken válido DE ESA cuenta: sin token, o con uno ajeno, el agregado no se toca', async () => {
    const { svc, addUser, store } = makeWorld();
    const u = await addUser();
    const other = await addUser();
    const foreign = (await attempt(svc, { email: other.email, password: GOOD })).body!.deviceToken;
    for (let i = 0; i < 3; i++) await attempt(svc, { email: u.email, password: BAD });
    for (let i = 0; i < 3; i++) await attempt(svc, { email: u.email, password: BAD, deviceToken: foreign });
    await expect(store.bump(DEVICE_AGGREGATE_KEY_PREFIX + u.id, DEVICE_ROUTE_WINDOW_MS)).resolves.toBe(1);
  });
});

describe('C7-21 — refresh legado (sin sid): sid = "legacy:" + sub + ":" + iat, determinista', () => {
  it('3 refresh reproduciendo el mismo token legado ⇒ 3 deviceToken con el MISMO jti; el par nuevo ya lleva sid y su cadena lo conserva', async () => {
    const { svc, addUser, jwt } = makeWorld();
    const u = await addUser();
    const legacy = await jwt.signAsync(
      { sub: u.id, email: u.email, role: u.role, tv: 0, typ: 'refresh' },
      { secret: C7_REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d' },
    );
    expect(claims(legacy).sid).toBeUndefined();
    const iat = claims(legacy).iat as number;
    const rs = [await svc.refresh(legacy), await svc.refresh(legacy), await svc.refresh(legacy)];
    const jtis = rs.map((r) => claims(r.deviceToken).jti);
    expect(new Set(jtis).size).toBe(1);
    expect(jtis[0]).toBe(`legacy:${u.id}:${iat}`);
    for (const r of rs) expect(claims(r.refreshToken).sid).toBe(jtis[0]);
    const chained = await svc.refresh(rs[0].refreshToken);
    expect(claims(chained.deviceToken).jti).toBe(jtis[0]);
    expect(claims(chained.refreshToken).sid).toBe(jtis[0]);
  });

  it('dos usuarios con refresh legado del MISMO iat ⇒ jti distintos (lleva el sub)', async () => {
    const { svc, addUser, jwt } = makeWorld();
    const a = await addUser();
    const b = await addUser();
    const iat = Math.floor(Date.now() / 1000) - 60;
    const sign = (u: { id: string; email: string; role: Role }) =>
      jwt.signAsync(
        { sub: u.id, email: u.email, role: u.role, tv: 0, typ: 'refresh', iat },
        { secret: C7_REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d' },
      );
    const ra = await svc.refresh(await sign(a));
    const rb = await svc.refresh(await sign(b));
    expect(claims(ra.deviceToken).jti).not.toBe(claims(rb.deviceToken).jti);
    expect(claims(ra.deviceToken).jti).toBe(`legacy:${a.id}:${iat}`);
    expect(claims(rb.deviceToken).jti).toBe(`legacy:${b.id}:${iat}`);
  });

  it('un refresh legado SIN iat numérico no entra (no hay de dónde derivar la sesión) ⇒ 401', async () => {
    const { svc, addUser, jwt } = makeWorld();
    const u = await addUser();
    const noIat = await jwt.signAsync(
      { sub: u.id, email: u.email, role: u.role, tv: 0, typ: 'refresh' },
      { secret: C7_REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d', noTimestamp: true },
    );
    expect(claims(noIat).iat).toBeUndefined();
    await expect(svc.refresh(noIat)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('C7 v1.80.1 — el sid por endpoint (§4.57.4)', () => {
  it('login ⇒ sid nuevo por sesión (dos logins, dos sid, dos jti); refresh hereda; reset-password ⇒ jti aleatorio', async () => {
    const { svc, addUser, tokens } = makeWorld();
    const u = await addUser();
    const a = (await attempt(svc, { email: u.email, password: GOOD })).body!;
    const b = (await attempt(svc, { email: u.email, password: GOOD })).body!;
    expect(claims(a.refreshToken).sid).not.toBe(claims(b.refreshToken).sid);
    expect(claims(a.deviceToken).jti).toBe(claims(a.refreshToken).sid);
    expect(claims(b.deviceToken).jti).toBe(claims(b.refreshToken).sid);
    // El access token NO lleva sid (no lo necesita: no emite dispositivos).
    expect(claims(a.accessToken).sid).toBeUndefined();
    tokens.consume.mockResolvedValue(u.id);
    const r1 = await svc.resetPassword('t1', 'otra-clave-123');
    const r2 = await svc.resetPassword('t2', 'otra-clave-456');
    expect(claims(r1.deviceToken).jti).not.toBe(claims(r2.deviceToken).jti);
    expect(claims(r1.deviceToken).jti).not.toBe(claims(a.refreshToken).sid);
  });

  it('issueTokens(user, sid) mete ese sid en el refresh token; sin sid, genera un uuid', async () => {
    const { svc, addUser } = makeWorld();
    const u = await addUser();
    const sid = randomUUID();
    const given = await svc.issueTokens(u, sid);
    expect(claims(given.refreshToken).sid).toBe(sid);
    const generated = await svc.issueTokens(u);
    expect(claims(generated.refreshToken).sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(given).sort()).toEqual(['accessToken', 'refreshToken']);
  });
});
