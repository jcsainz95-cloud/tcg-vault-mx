/**
 * 🔒 v1.117⟨cuenta-correo⟩ — CTA-B4 (API_CONTRACT §CTA.4 «Límite contra enumeración»), por HTTP contra la app real con el
 * throttler ENCENDIDO (`E2E_ENABLE_THROTTLER=true`, como `auth-throttle.e2e-spec.ts`).
 *
 * El throttler `signup` es UNO para `POST /auth/register` y `POST /auth/register/email-only`: 5/min por IP ENTRE LOS DOS
 * (no 5 + 5). Misma IP (última entrada de `X-Forwarded-For`, `trust proxy = 1`): 3 `register` + 2 `email-only` pasan y el
 * 6.º (cualquiera de los dos) es `429 RATE_LIMITED` con `Retry-After` y `details.retryAfterSeconds`. Otra IP no comparte cubo.
 * Mutación que lo pone rojo: throttlers separados por ruta (el `generateKey` por defecto de Nest lleva clase+handler).
 * La mitad de 24 h (`signup-day`, 30/24 h, reloj falso) está en `test/cta.account-setup.spec.ts`.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { SignupConflictTelemetry } from '../../src/modules/auth/signup-telemetry';

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

describe('CTA-B4 — throttler `signup` compartido entre register y register/email-only (§CTA.4)', () => {
  let h: E2EHarness;
  let prev: string | undefined;
  let n = 0;

  beforeAll(async () => {
    prev = process.env.E2E_ENABLE_THROTTLER;
    process.env.E2E_ENABLE_THROTTLER = 'true';
    h = await E2EHarness.create();
  });

  afterAll(async () => {
    await h?.close();
    if (prev === undefined) delete process.env.E2E_ENABLE_THROTTLER;
    else process.env.E2E_ENABLE_THROTTLER = prev;
  });

  const ipOf = (k: number) => `10.117.${(k >> 8) & 255}.${k & 255}`;
  const email = () => `cta4.${RUN}.${(n += 1)}@example.com`;
  const register = (ip: string) =>
    h.api('POST', '/auth/register', { json: { email: email(), password: 'Termina123!', name: 'Ana' }, headers: { 'x-forwarded-for': ip } });
  const emailOnly = (ip: string) => h.api('POST', '/auth/register/email-only', { json: { email: email() }, headers: { 'x-forwarded-for': ip } });

  it.each([
    ['email-only', 'el 6.º es email-only'],
    ['register', 'el 6.º es register'],
  ])('3 register + 2 email-only desde una IP ⇒ el 6.º (%s) es 429 RATE_LIMITED', async (sixth) => {
    const ip = ipOf(1000 + (sixth === 'register' ? 2 : 1) + (Date.now() % 200) * 3);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await register(ip)).status);
    for (let i = 0; i < 2; i += 1) statuses.push((await emailOnly(ip)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201]);
    const r = sixth === 'register' ? await register(ip) : await emailOnly(ip);
    expect([r.status, r.body?.error?.code]).toEqual([429, 'RATE_LIMITED']);
    const retryAfter = Number(r.headers['retry-after']);
    expect(Number.isInteger(retryAfter) && retryAfter > 0).toBe(true);
    expect(r.body.error.details).toEqual({ retryAfterSeconds: retryAfter });
    // Otra IP no comparte el cubo.
    expect((await emailOnly(ipOf(2000 + (Date.now() % 200)))).status).toBe(201);
  });

  it('un 409 y un 400 también gastan cupo (el guard corre antes que el handler)', async () => {
    const ip = ipOf(3000 + (Date.now() % 200));
    const taken = email();
    expect((await h.api('POST', '/auth/register/email-only', { json: { email: taken }, headers: { 'x-forwarded-for': ip } })).status).toBe(201);
    const statuses: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      statuses.push((await h.api('POST', '/auth/register/email-only', { json: { email: taken }, headers: { 'x-forwarded-for': ip } })).status);
    }
    for (let i = 0; i < 2; i += 1) {
      statuses.push((await h.api('POST', '/auth/register/email-only', { json: { email: 'no-es-correo' }, headers: { 'x-forwarded-for': ip } })).status);
    }
    expect(statuses).toEqual([409, 409, 400, 400]);
    expect((await emailOnly(ip)).status).toBe(429);
  });

  /**
   * 🔒 CTA-B17 (v1.117.2, PT-CTA-3, D-CTA-13): `PATCH /users/me/email` gasta el MISMO cubo `signup` que el alta (y `signup-day`,
   * cuya mitad de 24 h con reloj falso está en `test/cta.account-setup.spec.ts`), y cada `409` pasa por la telemetría del alta con
   * la IP y sale sin `user`, tokens ni correo. Mutaciones: cubo propio del `PATCH`; `409` sin telemetría.
   */
  it('CTA-B17 — misma IP: 3 register + 2 email-only ⇒ el PATCH siguiente 429 RATE_LIMITED', async () => {
    const session = await h.api('POST', '/auth/register/email-only', { json: { email: email() }, headers: { 'x-forwarded-for': ipOf(5000 + (Date.now() % 200)) } });
    expect(session.status).toBe(201);
    const ip = ipOf(5300 + (Date.now() % 200));
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await register(ip)).status);
    for (let i = 0; i < 2; i += 1) statuses.push((await emailOnly(ip)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201]);
    const r = await h.api('PATCH', '/users/me/email', { token: session.body.accessToken, json: { email: email() }, headers: { 'x-forwarded-for': ip } });
    expect([r.status, r.body?.error?.code]).toEqual([429, 'RATE_LIMITED']);
  });

  it('CTA-B17 — cada 409 del PATCH pasa por la telemetría con la IP y sale sin user, tokens ni correo', async () => {
    const record = jest.spyOn(SignupConflictTelemetry.prototype, 'record');
    try {
      const taken = email();
      expect((await h.api('POST', '/auth/register/email-only', { json: { email: taken }, headers: { 'x-forwarded-for': ipOf(5600 + (Date.now() % 200)) } })).status).toBe(201);
      const s = await h.api('POST', '/auth/register/email-only', { json: { email: email() }, headers: { 'x-forwarded-for': ipOf(5800 + (Date.now() % 200)) } });
      expect(s.status).toBe(201);
      const ip = ipOf(6000 + (Date.now() % 200));
      record.mockClear();
      for (let i = 0; i < 2; i += 1) {
        const r = await h.api('PATCH', '/users/me/email', { token: s.body.accessToken, json: { email: taken }, headers: { 'x-forwarded-for': ip } });
        expect([r.status, r.body?.error?.code]).toEqual([409, 'EMAIL_TAKEN']);
        expect(Object.keys(r.body)).toEqual(['error']);
        expect(r.text).not.toMatch(/accessToken|refreshToken|"user"|@example\.com/);
      }
      expect(record.mock.calls.map((c) => c[0])).toEqual([ip, ip]);
    } finally {
      record.mockRestore();
    }
  });
});
