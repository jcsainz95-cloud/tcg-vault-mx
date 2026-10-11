/**
 * m63-migration.e2e-spec.ts — v1.80.9, STF-25 (`API_CONTRACT §M6-U.9`, criterio 266): el staff que YA existe con
 * correo no cambia. Dos mitades:
 *  (a) La migración M-63 (`prisma/migrations/20261005120000_m63_staff_username/migration.sql`, el FICHERO tal cual)
 *      se aplica sobre una tabla `User` con la forma de M-62 en un esquema temporal, con un operador sembrado ANTES:
 *      tras migrar, su correo es el mismo, `username` y `lockNoticeAt` nacen `null`, y los cinco CHECK existen.
 *      Un backfill de `username` en la migración pone esto rojo (y viola el CHECK 1).
 *  (b) Ese tipo de cuenta (staff con correo) entra con su correo, `forgot-password` le manda 1 correo y el candado,
 *      1 correo — como hoy (P-STF-2, P-STF-5).
 */
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

jest.setTimeout(120_000);

const MIGRATION = join(__dirname, '../../prisma/migrations/20261005120000_m63_staff_username/migration.sql');

/** Sentencias del fichero, sin comentarios de línea (ninguna sentencia de M-63 lleva `;` dentro de un literal). */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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

  it('(a) migración sobre la forma M-62 con un operador sembrado antes: correo igual, username/lockNoticeAt null, 5 CHECK', async () => {
    const schema = `stf25_${randomBytes(4).toString('hex')}`;
    const opId = randomUUID();
    const email = `op_${randomBytes(3).toString('hex')}@e2e.local`;
    try {
      const out = await h.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`CREATE TABLE "${schema}"."User" (LIKE public."User" INCLUDING DEFAULTS)`);
        // La forma de M-62: sin las columnas nuevas y con `email NOT NULL` + su índice único.
        await tx.$executeRawUnsafe(`ALTER TABLE "${schema}"."User" DROP COLUMN "username", DROP COLUMN "lockNoticeAt"`);
        await tx.$executeRawUnsafe(`ALTER TABLE "${schema}"."User" ALTER COLUMN "email" SET NOT NULL`);
        await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX "User_email_key" ON "${schema}"."User"("email")`);
        await tx.$executeRawUnsafe(
          `INSERT INTO "${schema}"."User" ("id","email","name","role","emailVerified","updatedAt") VALUES ($1,$2,'Op','vault_operator',true,now())`,
          opId,
          email,
        );
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
        for (const s of statements(readFileSync(MIGRATION, 'utf8'))) await tx.$executeRawUnsafe(s);
        const rows = await tx.$queryRawUnsafe<{ email: string | null; username: string | null; lockNoticeAt: Date | null; emailVerified: boolean }[]>(
          `SELECT "email","username","lockNoticeAt","emailVerified" FROM "${schema}"."User" WHERE "id" = $1`,
          opId,
        );
        const checks = await tx.$queryRawUnsafe<{ conname: string }[]>(
          `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND c.contype = 'c' ORDER BY 1`,
          schema,
        );
        const notNull = await tx.$queryRawUnsafe<{ is_nullable: string }[]>(
          `SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'User' AND column_name = 'email'`,
          schema,
        );
        return { rows, checks: checks.map((c) => c.conname), emailNullable: notNull[0].is_nullable };
      });
      expect(out.rows).toEqual([{ email, username: null, lockNoticeAt: null, emailVerified: true }]);
      expect(out.emailNullable).toBe('YES');
      expect(out.checks).toEqual(
        expect.arrayContaining([
          'user_customer_has_email',
          'user_lock_notice_no_email',
          'user_login_identity_xor',
          'user_no_email_unverified',
          'user_username_canonical',
        ]),
      );
    } finally {
      await h.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
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
