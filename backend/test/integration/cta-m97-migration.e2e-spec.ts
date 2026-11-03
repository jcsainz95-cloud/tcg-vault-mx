/**
 * 🔒 CTA-B14m (v1.117.2⟨cuenta-correo⟩, API_CONTRACT §CTA.13 «M-97», ARCHITECTURE §16.4) — M-97 contra Postgres REAL, en las dos
 * direcciones y con datos. Propiedad: backend.
 *
 * Sobre una base sembrada en el estado ANTERIOR a M-97 (se deshace con la reversa de su cabecera): vivos duplicados por
 * `(userId, type)`, un vivo de una cuenta sin correo, un usado, y correos con `+`, acentos y mayúsculas guardadas. Se aplica el
 * TEXTO de M-97 y se mide:
 *  - queda vivo solo el más nuevo por `(userId, type)` (`createdAt DESC, id DESC`); el de la cuenta sin correo queda usado;
 *  - el `emailHash` que calcula SQL es bit a bit el `sha256hex` de Node (`createHash('sha256').update(email, 'utf8')`);
 *  - un segundo vivo o un vivo sin `emailHash` ⇒ error de BD (índice parcial y CHECK);
 *  - la reversa deja la tabla como antes (sin columna, índice ni CHECK) y M-97 se vuelve a aplicar.
 * Mutaciones que la ponen roja: relleno con `lower()` o sin `convert_to`; sin índice; sin CHECK.
 *
 * Todo corre en UNA transacción que SIEMPRE se deshace: la BD compartida queda como estaba. Determinista (N=1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

jest.setTimeout(60_000);

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const M97_DIR = readdirSync(MIGRATIONS).find((d) => /_m97_auth_token_email_binding$/.test(d));
const M97 = M97_DIR ? readFileSync(join(MIGRATIONS, M97_DIR, 'migration.sql'), 'utf8') : '';
const ROLLBACK = Symbol('rollback');
const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Sentencias del SQL, sin comentarios (M-97 no lleva bloques `$$`). */
function statements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** La reversa de la cabecera (`-- REVERSA:BEGIN` … `-- REVERSA:END`), sin tocar `_prisma_migrations`. */
function reversal(sql: string): string[] {
  const m = /--\s*REVERSA:BEGIN\n([\s\S]*?)--\s*REVERSA:END/.exec(sql);
  if (!m) return [];
  const body = m[1]
    .split('\n')
    .map((l) => l.replace(/^--\s?/, ''))
    .filter((l) => !l.includes('_prisma_migrations'))
    .join('\n');
  return statements(body);
}

describe('CTA-B14m — M-97 (`AuthToken.emailHash`, uno vivo por cuenta y tipo, CHECK)', () => {
  const db = new PrismaClient();
  const run = randomUUID().slice(0, 8);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('la migración existe, va después de M-96 y trae su reversa', () => {
    expect(M97_DIR).toBeDefined();
    const dirs = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
    const m96 = dirs.findIndex((d) => /_m96_auth_token_account_setup$/.test(d));
    expect(dirs.indexOf(M97_DIR!)).toBeGreaterThan(m96);
    expect(reversal(M97).length).toBeGreaterThanOrEqual(2);
  });

  it('reversa → siembra → M-97: el más nuevo vivo, hash = sha256hex de Node, índice y CHECK muerden; reversa y re-aplicación', async () => {
    expect(M97_DIR).toBeDefined();
    const outcome = await db
      .$transaction(
        async (tx) => {
          const exec = async (list: string[]) => {
            for (const s of list) await tx.$executeRawUnsafe(s);
          };
          // 1. Estado anterior a M-97.
          await exec(reversal(M97));
          const cols0 = await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM information_schema.columns WHERE table_name = 'AuthToken' AND column_name = 'emailHash'`;
          expect(Number(cols0[0].n)).toBe(0);

          // 2. Siembra: correos guardados tal cual (con `+`, acentos y mayúsculas), cuenta sin correo.
          const emails = [`Ána+Promo.${run}@Ejemplo.MX`, `josé.${run}@correo.mx`, `plain.${run}@example.com`];
          const users: string[] = [];
          for (const email of emails) {
            const u = await tx.user.create({ data: { email, name: 'M97', role: 'customer' } });
            users.push(u.id);
          }
          const staff = await tx.user.create({
            data: { email: null, username: `m97.${run}`, name: 'Staff', role: 'vault_operator', passwordHash: 'x' },
          });
          const t0 = Date.now() - 60_000;
          const tok = async (userId: string, type: string, ageMs: number, usedAt: Date | null = null, id = randomUUID()) => {
            await tx.$executeRawUnsafe(
              `INSERT INTO "AuthToken" ("id","userId","type","tokenHash","expiresAt","usedAt","createdAt")
               VALUES ($1,$2,$3::"AuthTokenType",$4,$5,$6,$7)`,
              id,
              userId,
              type,
              sha256hex(`${run}:${id}`),
              new Date(Date.now() + 3_600_000),
              usedAt,
              new Date(t0 - ageMs),
            );
            return id;
          };
          // u0: tres `account_setup` vivos (duplicados) + un `password_reset` vivo + uno usado.
          const dupOld = await tok(users[0], 'account_setup', 30_000);
          const dupMid = await tok(users[0], 'account_setup', 20_000);
          const dupNew = await tok(users[0], 'account_setup', 10_000);
          const reset0 = await tok(users[0], 'password_reset', 5_000);
          const used0 = await tok(users[0], 'email_verification', 1_000, new Date(t0));
          // u1: dos vivos con el MISMO createdAt ⇒ gana el `id` mayor.
          const [idA, idB] = [randomUUID(), randomUUID()].sort();
          await tok(users[1], 'email_verification', 7_000, null, idA);
          await tok(users[1], 'email_verification', 7_000, null, idB);
          // u2: uno vivo, sin duplicados.
          const single = await tok(users[2], 'password_reset', 3_000);
          // staff sin correo: un vivo ⇒ queda usado (no se puede atar).
          const staffTok = await tok(staff.id, 'password_reset', 2_000);

          // 3. M-97.
          await exec(statements(M97));

          const rows = await tx.$queryRawUnsafe<{ id: string; usedAt: Date | null; emailHash: string | null }[]>(
            `SELECT "id","usedAt","emailHash" FROM "AuthToken" WHERE "userId" = ANY($1::text[])`,
            [...users, staff.id],
          );
          const byId = new Map(rows.map((r) => [r.id, r]));
          const liveIds = rows.filter((r) => r.usedAt === null).map((r) => r.id).sort();
          expect(liveIds).toEqual([dupNew, reset0, idB, single].sort());
          expect(byId.get(dupOld)!.usedAt).not.toBeNull();
          expect(byId.get(dupMid)!.usedAt).not.toBeNull();
          expect(byId.get(idA)!.usedAt).not.toBeNull();
          expect(byId.get(staffTok)!.usedAt).not.toBeNull();
          expect(byId.get(used0)!.usedAt).not.toBeNull();
          // El hash de SQL es el de Node, sobre el correo TAL COMO ESTÁ GUARDADO.
          expect(byId.get(dupNew)!.emailHash).toBe(sha256hex(emails[0]));
          expect(byId.get(reset0)!.emailHash).toBe(sha256hex(emails[0]));
          expect(byId.get(idB)!.emailHash).toBe(sha256hex(emails[1]));
          expect(byId.get(single)!.emailHash).toBe(sha256hex(emails[2]));
          expect(sha256hex(emails[0])).not.toBe(sha256hex(emails[0].toLowerCase()));

          // 4. El índice parcial y el CHECK muerden (cada intento en un SAVEPOINT para no abortar la tx).
          const fails = async (sql: string, ...args: unknown[]) => {
            await tx.$executeRawUnsafe('SAVEPOINT m97');
            try {
              await tx.$executeRawUnsafe(sql, ...args);
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT m97');
              return 'ok';
            } catch (e) {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT m97');
              return String((e as Error).message);
            }
          };
          const ins = `INSERT INTO "AuthToken" ("id","userId","type","tokenHash","expiresAt","emailHash") VALUES ($1,$2,$3::"AuthTokenType",$4,$5,$6)`;
          const second = await fails(ins, randomUUID(), users[2], 'password_reset', `${run}-2nd`, new Date(Date.now() + 3_600_000), sha256hex(emails[2]));
          // Postgres no nombra el índice en el mensaje: 23505 (unique_violation) sobre la clave ("userId", type).
          expect(second).toMatch(/23505/);
          expect(second).toMatch(/\(\\?"userId\\?", type\)/);
          const noHash = await fails(ins, randomUUID(), users[2], 'account_setup', `${run}-nohash`, new Date(Date.now() + 3_600_000), null);
          expect(noHash).toMatch(/AuthToken_live_has_email_hash/);
          // Un usado sin hash sí entra (el CHECK solo mira los vivos).
          const usedOk = await fails(
            `INSERT INTO "AuthToken" ("id","userId","type","tokenHash","expiresAt","usedAt") VALUES ($1,$2,'account_setup'::"AuthTokenType",$3,$4,now())`,
            randomUUID(),
            users[2],
            `${run}-used`,
            new Date(Date.now() + 3_600_000),
          );
          expect(usedOk).toBe('ok');

          // 5. Reversa: sin columna, índice ni CHECK; y M-97 se vuelve a aplicar.
          await exec(reversal(M97));
          const after = await tx.$queryRaw<{ col: bigint; idx: bigint; chk: bigint }[]>`
            SELECT
              (SELECT count(*) FROM information_schema.columns WHERE table_name = 'AuthToken' AND column_name = 'emailHash')::bigint AS col,
              (SELECT count(*) FROM pg_indexes WHERE indexname = 'AuthToken_one_live_per_user_type')::bigint AS idx,
              (SELECT count(*) FROM pg_constraint WHERE conname = 'AuthToken_live_has_email_hash')::bigint AS chk`;
          expect(after[0]).toEqual({ col: BigInt(0), idx: BigInt(0), chk: BigInt(0) });
          await exec(statements(M97));
          throw ROLLBACK;
        },
        { timeout: 50_000, maxWait: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      )
      .catch((e: unknown) => (e === ROLLBACK ? 'rolled-back' : Promise.reject(e)));
    expect(outcome).toBe('rolled-back');
  });
});
