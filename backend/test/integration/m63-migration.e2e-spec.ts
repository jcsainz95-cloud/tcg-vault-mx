/**
 * m63-migration.e2e-spec.ts — v1.80.9, STF-25 (`API_CONTRACT §M6-U.9`, criterio 266): el staff que YA existe con
 * correo no cambia. La mitad (a) —el fichero de la migración M-63 sobre un esquema temporal— se retiró
 * (HEAP-INTEG-94: la migración ya está en production, inmutable). Queda:
 *  (b) Ese tipo de cuenta (staff con correo) entra con su correo, `forgot-password` le manda 1 correo y el candado,
 *      1 correo — como hoy (P-STF-2, P-STF-5).
 */
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { authBackgroundIdle } from './helpers/auth-tokens';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

jest.setTimeout(120_000);

describe('E2E — STF-25: M-63 no toca al staff que ya existe con correo', () => {
  let h: E2EHarness;
  let mailSpy: jest.SpyInstance;

  beforeAll(async () => {
    h = await E2EHarness.create();
    mailSpy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (_m: MailMessage) => ({}));
  });

  afterAll(async () => {
    mailSpy?.mockRestore();
    await h?.close();
  });

  it('(b) staff con correo: entra con su correo; forgot ⇒ 1 correo; candado ⇒ 1 correo', async () => {
    const pw = 'Op-STF25-12345';
    const op = await h.prisma.user.create({
      data: { email: `stf25_${randomBytes(4).toString('hex')}@e2e.local`, name: 'Op', role: Role.vault_operator, passwordHash: await argon2.hash(pw), emailVerified: true },
    });
    expect(op.username).toBeNull();
    const ok = await h.api('POST', '/auth/login', { json: { email: op.email, password: pw } });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: op.email, username: null, role: 'vault_operator' });
    mailSpy.mockClear();
    expect((await h.api('POST', '/auth/forgot-password', { json: { email: op.email } })).status).toBe(200);
    await authBackgroundIdle(h); // v1.117.2 (D-CTA-14): el correo sale tras responder.
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect((mailSpy.mock.calls[0][0] as MailMessage).to).toBe(op.email);
    mailSpy.mockClear();
    for (let i = 0; i < 5; i++) expect((await h.api('POST', '/auth/login', { json: { email: op.email, password: 'mala' } })).status).toBe(401);
    const t0 = Date.now();
    while (mailSpy.mock.calls.length < 1 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 300));
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect((mailSpy.mock.calls[0][0] as MailMessage).to).toBe(op.email);
  });
});
