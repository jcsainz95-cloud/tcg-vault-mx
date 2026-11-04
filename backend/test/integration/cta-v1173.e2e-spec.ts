/**
 * 🔒 v1.117.3⟨cuenta-correo⟩ — API_CONTRACT §CTA.9 CTA-B19 y CTA-B20 (§CTA.13, §1 «Verificación de correo», CTA.4 paso 3, CTA.5),
 * Postgres real, por HTTP. Propiedad: backend. Deterministas (N=1).
 *
 * | Caso | Qué fija | Mutación que lo pone rojo |
 * |---|---|---|
 * | CTA-B19 | Por CADA vía de la lista de CTA.13 (incluida `change-password`): toda escritura de `AuthToken` y de `User.email`/`passwordHash`/`emailVerified`/`tokenVersion` va en una transacción cuya 1.ª sentencia es `pg_advisory_xact_lock(ACCOUNT_AUTH_GATE_NAMESPACE, hashtext(<id de la cuenta>))` | quitar el candado de una sola vía (`change-password`, `forgot-password`) |
 * | CTA-B20 (a) | `verify-email {token, password}` correcto tras 2 fallos C7 ⇒ 200 y el cubo de la cuenta en 0 (con 2 tras los fallos) | limpiar C7 sin acierto; no limpiar en el acierto |
 * | CTA-B20 (b) | doble clic `{token, password: cualquiera}` ⇒ 200 sin argon2, sin tocar C7 y sin escribir; con el correo cambiado ⇒ 422; `{token, newPassword}` usado ⇒ 422 | comprobar la contraseña en el doble clic; doble clic sin atadura |
 * | CTA-B20 (c) | cuenta bloqueada: contraseña correcta ⇒ 403, incorrecta ⇒ 401 | — (orden argon2 → estado) |
 * | CTA-B20 (d) | bloqueada en `verify-email` (dos modos), `reset-password` y `account-setup` ⇒ 403, `usedAt` nulo, cuenta igual; reactivada ⇒ el mismo enlace 200 | consumir fuera de la transacción que se deshace |
 * | CTA-B20 (e) | `forgot-password` con el correo cambiado entre la búsqueda y el candado ⇒ 0 `AuthToken` y 0 correos | emitir al correo actual |
 * | CTA-R4 | `change-password` con reset/logout/hash a mano/bloqueo intercalado entre el `argon2.verify` y la escritura ⇒ `401 UNAUTHENTICATED`, sin par, fila intacta | quitar del `where` la condición entera o cada una (hash, `tokenVersion`, `status`) |
 *
 * Espía de SQL: un `PrismaService` propio con `log: query` (eventos del motor, BEGIN/COMMIT incluidos) sustituye al de la app, como
 * IDS-B26. Las vías se ejecutan de una en una (nada concurrente), así que la secuencia de eventos de cada una es la de sus
 * transacciones. Gancho de (e): `prisma.$transaction` envuelto para escribir el correo nuevo justo antes de abrir la del candado.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuthTokenType, UserStatus } from '@prisma/client';

jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';
import { E2EHarness } from './helpers/e2e-app';
import { authBackgroundIdle, issueAuthToken } from './helpers/auth-tokens';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { GoogleIdentity, GoogleTokenVerifier } from '../../src/modules/auth/google-token-verifier';
import { ACCOUNT_AUTH_GATE_NAMESPACE } from '../../src/modules/auth/account-gate';
import { LOGIN_ATTEMPT_STORE, MemoryLoginAttemptStore } from '../../src/modules/auth/login-attempt.store';
import { PasswordAttemptsService } from '../../src/modules/auth/password-attempts.service';

jest.setTimeout(180_000);

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const PASSWORD = 'Termina123!';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const verifySpy = argon2.verify as unknown as jest.Mock;
const LINK_RE = /(account-setup|reset-password|verify-email)\?token=([^\s"&<]+)/;

interface QueryEvent {
  query: string;
  params: string;
}

/** Columnas de la credencial y del correo (CTA.13): una escritura de `User` que toca alguna debe ir bajo el candado. */
const GUARDED_USER_COLS = /"(email|passwordHash|emailVerified|tokenVersion)"\s*=/;

/** ¿Escritura que CTA.13 obliga a pasar por el candado? (`AuthToken` entera; `User` solo esas columnas; el alta no). */
function guardedWrite(q: string): boolean {
  if (/^(INSERT INTO|UPDATE|DELETE FROM) "public"\."AuthToken"/.test(q)) return true;
  if (/^UPDATE "public"\."User" SET /.test(q)) return GUARDED_USER_COLS.test(q.split(' WHERE ')[0]);
  return false;
}

function isAccountLock(e: QueryEvent | undefined, userId: string): boolean {
  if (!e || !/^SELECT pg_advisory_xact_lock\(/.test(e.query)) return false;
  return e.params === JSON.stringify([ACCOUNT_AUTH_GATE_NAMESPACE, userId]);
}

/**
 * Recorre los eventos de UNA vía. Devuelve las escrituras vigiladas y, de ellas, las que NO van en una transacción cuya 1.ª
 * sentencia sea el candado de `userId` (fuera de transacción, o en una abierta por otra cosa).
 */
function gateAudit(events: QueryEvent[], userId: string) {
  let tx: { first?: QueryEvent } | null = null;
  const writes: string[] = [];
  const bad: string[] = [];
  let locks = 0;
  for (const e of events) {
    const q = e.query.trim();
    if (q === 'BEGIN') {
      tx = {};
      continue;
    }
    if (q === 'COMMIT' || q === 'ROLLBACK') {
      tx = null;
      continue;
    }
    if (tx && tx.first === undefined) {
      tx.first = e;
      if (isAccountLock(e, userId)) locks += 1;
    }
    if (!guardedWrite(q)) continue;
    const tag = q.slice(0, 60);
    writes.push(tag);
    if (!tx) bad.push(`fuera de transacción: ${tag}`);
    else if (!isAccountLock(tx.first, userId)) bad.push(`tx sin candado de la cuenta (1.ª: ${tx.first?.query.slice(0, 50)}): ${tag}`);
  }
  return { writes, bad, locks };
}

describe('CTA v1.117.3 — B19 (cobertura del candado) y B20 (verify-email, cuenta bloqueada, forgot releído)', () => {
  let h: E2EHarness;
  let prisma: PrismaService;
  let adminToken: string;
  let seq = 0;
  let ipSeq = 0;
  const events: QueryEvent[] = [];
  const bandeja: MailMessage[] = [];
  const google: { identity: GoogleIdentity | null } = { identity: null };

  beforeAll(async () => {
    const spying = new PrismaService({ log: [{ emit: 'event', level: 'query' }] } as never);
    (spying as unknown as { $on: (e: 'query', cb: (ev: QueryEvent) => void) => void }).$on('query', (ev) => {
      events.push({ query: ev.query, params: ev.params });
    });
    h = await E2EHarness.create((b) =>
      b
        .overrideProvider(PrismaService)
        .useValue(spying)
        .overrideProvider(GoogleTokenVerifier)
        .useValue({
          verify: async () => {
            if (!google.identity) throw new Error('google: sin identidad guionizada');
            return google.identity;
          },
        }),
    );
    prisma = h.app.get(PrismaService);
    expect(prisma).toBe(spying);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  });

  afterAll(async () => {
    if (h) {
      await authBackgroundIdle(h);
      await h.close();
    }
  });

  // ───────────────────────────────────────────── utilidades ─────────────────────────────────────────────

  const nextEmail = (tag = 'u') => `cta1173.${RUN}.${tag}${(seq += 1)}@example.com`;
  const withIp = () => {
    ipSeq += 1;
    return { 'x-forwarded-for': `10.73.${(ipSeq >> 8) & 255}.${ipSeq & 255}` };
  };
  const post = (path: string, json?: Record<string, unknown>, token?: string) =>
    h.api('POST', path, { json, token, headers: withIp() });
  const userById = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
  const tokenRow = (clear: string) => prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(clear) } });
  const linksTo = (to: string, path: string, from = 0) =>
    bandeja
      .slice(from)
      .filter((m) => m.to === to)
      .map((m) => LINK_RE.exec(m.text ?? ''))
      .filter((x): x is RegExpExecArray => x !== null && x[1] === path)
      .map((x) => decodeURIComponent(x[2]));
  const lastLink = (to: string, path: string) => {
    const l = linksTo(to, path).pop();
    if (!l) throw new Error(`sin enlace ${path} para ${to}`);
    return l;
  };
  const store = () => h.app.get(LOGIN_ATTEMPT_STORE) as MemoryLoginAttemptStore;
  const c7 = (u: { id: string; email: string | null }) =>
    store().peek(h.app.get(PasswordAttemptsService).accountKeyForUser(u))?.failures ?? 0;
  /** Las escrituras (cualquier tabla) de una lista de eventos. */
  const writesIn = (evs: QueryEvent[]) => evs.map((e) => e.query.trim()).filter((q) => /^(INSERT|UPDATE|DELETE)\b/.test(q));

  async function register(tag: string, password = PASSWORD) {
    const email = nextEmail(tag);
    const r = await post('/auth/register', { email, password, name: 'Ana Pérez' });
    expect([r.status, r.text]).toEqual([201, r.text]);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { id: u.id, email, access: r.body.accessToken as string };
  }
  async function emailOnly(tag: string) {
    const email = nextEmail(tag);
    const r = await post('/auth/register/email-only', { email });
    expect([r.status, r.text]).toEqual([201, r.text]);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { id: u.id, email, access: r.body.accessToken as string };
  }
  /** Ejecuta `fn` con el espía limpio y devuelve los eventos que produjo (incluido el trabajo de fondo). */
  async function captured(fn: () => Promise<unknown>): Promise<QueryEvent[]> {
    await authBackgroundIdle(h);
    events.length = 0;
    await fn();
    await authBackgroundIdle(h);
    return events.splice(0);
  }

  // ───────────────────────────────────────────── CTA-B19 ─────────────────────────────────────────────

  describe('CTA-B19 — cada vía de CTA.13 escribe bajo el candado de SU cuenta (1.ª sentencia de la transacción)', () => {
    /**
     * Cada vía: prepara (fuera del espía) y devuelve `{ userId, act }` — o `{ email, act }` en las altas, donde la cuenta nace
     * en la vía y su id se lee después; `act` es lo que se mide.
     */
    type Prepared = { userId?: string; email?: string; act: () => Promise<unknown> };
    const VIAS: [string, () => Promise<Prepared>][] = [
      [
        'emisión tras register',
        async () => {
          const email = nextEmail('b19reg');
          return {
            email,
            act: async () => {
              const r = await post('/auth/register', { email, password: PASSWORD, name: 'Ana Pérez' });
              expect(r.status).toBe(201);
            },
          };
        },
      ],
      [
        'emisión tras email-only',
        async () => {
          const email = nextEmail('b19eo');
          return { email, act: async () => expect((await post('/auth/register/email-only', { email })).status).toBe(201) };
        },
      ],
      [
        'PATCH /users/me/email',
        async () => {
          const p = await emailOnly('b19patch');
          return {
            userId: p.id,
            act: async () =>
              expect((await h.api('PATCH', '/users/me/email', { token: p.access, json: { email: nextEmail('b19patchn') }, headers: withIp() })).status).toBe(200),
          };
        },
      ],
      [
        'verify-email/resend',
        async () => {
          const w = await register('b19rs');
          return { userId: w.id, act: async () => expect((await post('/auth/verify-email/resend', undefined, w.access)).status).toBe(200) };
        },
      ],
      [
        'verify-email {token, password}',
        async () => {
          const w = await register('b19vp');
          const token = lastLink(w.email, 'verify-email');
          return { userId: w.id, act: async () => expect((await post('/auth/verify-email', { token, password: PASSWORD })).status).toBe(200) };
        },
      ],
      [
        'verify-email {token, newPassword}',
        async () => {
          const w = await register('b19vn');
          const token = lastLink(w.email, 'verify-email');
          return { userId: w.id, act: async () => expect((await post('/auth/verify-email', { token, newPassword: 'OtraClave123' })).status).toBe(200) };
        },
      ],
      [
        'forgot-password',
        async () => {
          const w = await register('b19fg');
          return {
            userId: w.id,
            act: async () => {
              const from = bandeja.length;
              expect((await post('/auth/forgot-password', { email: w.email })).status).toBe(200);
              await authBackgroundIdle(h);
              expect(linksTo(w.email, 'reset-password', from)).toHaveLength(1);
            },
          };
        },
      ],
      [
        'reset-password',
        async () => {
          const w = await register('b19rp');
          const token = await issueAuthToken(h, w.id, AuthTokenType.password_reset);
          return { userId: w.id, act: async () => expect((await post('/auth/reset-password', { token, password: 'OtraClave123' })).status).toBe(200) };
        },
      ],
      [
        'account-setup',
        async () => {
          const p = await emailOnly('b19as');
          const token = lastLink(p.email, 'account-setup');
          return {
            userId: p.id,
            act: async () => expect((await post('/auth/account-setup', { token, name: 'Ana Pérez', password: PASSWORD })).status).toBe(200),
          };
        },
      ],
      [
        'set-password',
        async () => {
          const p = await emailOnly('b19sp');
          return { userId: p.id, act: async () => expect((await post('/auth/set-password', { newPassword: PASSWORD }, p.access)).status).toBe(200) };
        },
      ],
      [
        'change-password',
        async () => {
          const w = await register('b19cp');
          return {
            userId: w.id,
            act: async () =>
              expect((await post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'OtraClave123' }, w.access)).status).toBe(200),
          };
        },
      ],
      [
        'enlace de POST /auth/google (cuenta sin verificar)',
        async () => {
          const w = await register('b19g');
          return {
            userId: w.id,
            act: async () => {
              google.identity = { sub: `g-${randomUUID()}`, email: w.email, emailVerified: true, name: 'Ana Pérez' };
              try {
                expect((await post('/auth/google', { idToken: 'x' })).status).toBe(200);
              } finally {
                google.identity = null;
              }
            },
          };
        },
      ],
      [
        'reset del admin (§M6)',
        async () => {
          const w = await register('b19adm');
          return {
            userId: w.id,
            act: async () => expect((await h.api('POST', `/admin/users/${w.id}/reset-password`, { token: adminToken })).status).toBe(200),
          };
        },
      ],
    ];

    it.each(VIAS)('%s', async (via, prepare) => {
      const prep = await prepare();
      const evs = await captured(prep.act);
      // Las altas: la cuenta nace en la vía; su id sale de la BD después.
      const userId = prep.userId ?? (await prisma.user.findUniqueOrThrow({ where: { email: prep.email as string } })).id;
      const audit = gateAudit(evs, userId);
      process.stdout.write(`CTA-B19 ${via}: ${audit.writes.length} escrituras vigiladas, ${audit.locks} tx con candado, fuera de norma ${audit.bad.length}\n`);
      expect(audit.writes.length).toBeGreaterThan(0);
      expect(audit.locks).toBeGreaterThan(0);
      expect(audit.bad).toEqual([]);
    });

    it('el espía distingue: una escritura de la credencial fuera del candado sale en `bad` (canario del propio detector)', async () => {
      const w = await register('b19can');
      const evs = await captured(async () => {
        await prisma.user.update({ where: { id: w.id }, data: { tokenVersion: { increment: 1 } } });
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: w.id }, data: { emailVerified: true } });
        });
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACCOUNT_AUTH_GATE_NAMESPACE}::int, hashtext(${'otra-cuenta'}))`;
          await tx.user.update({ where: { id: w.id }, data: { emailVerified: false } });
        });
      });
      expect(gateAudit(evs, w.id).bad).toHaveLength(3);
    });
  });

  // ───────────────────────────────────────────── CTA-B20 ─────────────────────────────────────────────

  describe('CTA-B20 — verify-email, cuenta bloqueada y forgot-password releído', () => {
    it('(a) {token, password} correcto tras 2 fallos C7 ⇒ 200 y el cubo de la cuenta en 0', async () => {
      const w = await register('b20a');
      const token = lastLink(w.email, 'verify-email');
      for (let i = 0; i < 2; i += 1) {
        const r = await post('/auth/verify-email', { token, password: 'NoEsLaMia123' });
        expect([r.status, r.body?.error?.code]).toEqual([401, 'INVALID_CREDENTIALS']);
      }
      expect(c7(w)).toBe(2);
      const ok = await post('/auth/verify-email', { token, password: PASSWORD });
      expect([ok.status, ok.body]).toEqual([200, { verified: true }]);
      expect(c7(w)).toBe(0);
      expect((await userById(w.id)).emailVerified).toBe(true);
    });

    describe('(b) doble clic', () => {
      async function verified(tag: string) {
        const w = await register(tag);
        const token = lastLink(w.email, 'verify-email');
        // Un fallo previo deja el cubo en 1… y el acierto lo limpia; se mete otro fallo DESPUÉS con login para ver que el
        // doble clic no lo toca (ni lo cuenta ni lo limpia).
        expect((await post('/auth/verify-email', { token, password: PASSWORD })).status).toBe(200);
        expect((await post('/auth/login', { email: w.email, password: 'NoEsLaMia123' })).status).toBe(401);
        expect(c7(w)).toBe(1);
        return { ...w, token };
      }

      it('{token, password: cualquiera} ⇒ 200 {verified}, argon2.verify 0 llamadas, cubo C7 igual, 0 escrituras', async () => {
        const w = await verified('b20b1');
        const before = await userById(w.id);
        for (const password of [PASSWORD, 'CualquierCosa1', 'x'.repeat(12)]) {
          verifySpy.mockClear();
          const evs = await captured(async () => {
            const r = await post('/auth/verify-email', { token: w.token, password });
            expect([r.status, r.body]).toEqual([200, { verified: true }]);
          });
          expect(verifySpy).toHaveBeenCalledTimes(0);
          expect(writesIn(evs)).toEqual([]);
          expect(c7(w)).toBe(1);
        }
        expect(await userById(w.id)).toEqual(before);
      });

      it('con el correo cambiado en BD ⇒ 422 EMAIL_VERIFY_TOKEN_INVALID (la idempotencia exige la atadura)', async () => {
        const w = await verified('b20b2');
        await prisma.user.update({ where: { id: w.id }, data: { email: nextEmail('b20b2v') } });
        const r = await post('/auth/verify-email', { token: w.token, password: PASSWORD });
        expect([r.status, r.body?.error?.code]).toEqual([422, 'EMAIL_VERIFY_TOKEN_INVALID']);
      });

      it('{token, newPassword} con el token usado ⇒ 422 (no hace creer que fijó otra contraseña)', async () => {
        const w = await verified('b20b3');
        const before = await userById(w.id);
        const r = await post('/auth/verify-email', { token: w.token, newPassword: 'OtraClave123' });
        expect([r.status, r.body?.error?.code]).toEqual([422, 'EMAIL_VERIFY_TOKEN_INVALID']);
        expect((await userById(w.id)).passwordHash).toBe(before.passwordHash);
      });
    });

    it('(c) cuenta bloqueada: contraseña correcta ⇒ 403 USER_BLOCKED; incorrecta ⇒ 401', async () => {
      const w = await register('b20c');
      const token = lastLink(w.email, 'verify-email');
      await prisma.user.update({ where: { id: w.id }, data: { status: UserStatus.blocked } });
      const bad = await post('/auth/verify-email', { token, password: 'NoEsLaMia123' });
      expect([bad.status, bad.body?.error?.code]).toEqual([401, 'INVALID_CREDENTIALS']);
      const good = await post('/auth/verify-email', { token, password: PASSWORD });
      expect([good.status, good.body?.error?.code]).toEqual([403, 'USER_BLOCKED']);
      expect((await tokenRow(token)).usedAt).toBeNull();
      expect((await userById(w.id)).emailVerified).toBe(false);
    });

    describe('(d) bloqueada ⇒ 403, el enlace NO se quema y la cuenta no cambia; reactivada ⇒ el mismo enlace 200', () => {
      const CASES: [string, () => Promise<{ id: string; token: string; call: () => Promise<{ status: number; body: any; text: string }> }>][] = [
        [
          'verify-email {token, password}',
          async () => {
            const w = await register('b20dvp');
            const token = lastLink(w.email, 'verify-email');
            return { id: w.id, token, call: () => post('/auth/verify-email', { token, password: PASSWORD }) };
          },
        ],
        [
          'verify-email {token, newPassword}',
          async () => {
            const w = await register('b20dvn');
            const token = lastLink(w.email, 'verify-email');
            return { id: w.id, token, call: () => post('/auth/verify-email', { token, newPassword: 'OtraClave123' }) };
          },
        ],
        [
          'reset-password',
          async () => {
            const w = await register('b20drp');
            const token = await issueAuthToken(h, w.id, AuthTokenType.password_reset);
            return { id: w.id, token, call: () => post('/auth/reset-password', { token, password: 'OtraClave123' }) };
          },
        ],
        [
          'account-setup',
          async () => {
            const p = await emailOnly('b20das');
            const token = lastLink(p.email, 'account-setup');
            return { id: p.id, token, call: () => post('/auth/account-setup', { token, name: 'Ana Pérez', password: PASSWORD }) };
          },
        ],
      ];

      it.each(CASES)('%s', async (_via, make) => {
        const c = await make();
        await prisma.user.update({ where: { id: c.id }, data: { status: UserStatus.blocked } });
        const before = await userById(c.id);
        const blocked = await c.call();
        expect([blocked.status, blocked.body?.error?.code]).toEqual([403, 'USER_BLOCKED']);
        expect((await tokenRow(c.token)).usedAt).toBeNull();
        expect(await userById(c.id)).toEqual(before);
        await prisma.user.update({ where: { id: c.id }, data: { status: UserStatus.active } });
        const ok = await c.call();
        expect([ok.status, ok.text]).toEqual([200, ok.text]);
        expect((await tokenRow(c.token)).usedAt).not.toBeNull();
      });
    });

    it('(e) forgot-password con el correo cambiado entre la búsqueda y el candado ⇒ 0 AuthToken y 0 correos', async () => {
      const w = await register('b20e');
      const moved = nextEmail('b20ev');
      const tokensBefore = await prisma.authToken.count({ where: { userId: w.id } });
      const from = bandeja.length;
      const original = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
      let hooked = 0;
      // Gancho: la búsqueda (fuera) ya encontró la cuenta por `w.email`; antes de abrir la transacción del candado, el correo
      // pasa a otro (como un PATCH /users/me/email o el panel que ganan la carrera).
      const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (...args: unknown[]) => {
        if (hooked === 0 && typeof args[0] === 'function') {
          hooked += 1;
          await prisma.user.update({ where: { id: w.id }, data: { email: moved } });
        }
        return original(...args);
      }) as never);
      try {
        expect((await post('/auth/forgot-password', { email: w.email })).status).toBe(200);
        await authBackgroundIdle(h);
      } finally {
        spy.mockRestore();
      }
      expect(hooked).toBe(1);
      expect(await prisma.authToken.count({ where: { userId: w.id } })).toBe(tokensBefore);
      expect(bandeja.slice(from).filter((m) => m.to === w.email || m.to === moved)).toEqual([]);
    });
  });

  // ───────────────────────────────────────────── CTA-R4 ─────────────────────────────────────────────

  /**
   * R4 (techlead sobre `36f93c98`): `change-password` leía y verificaba FUERA del candado y dentro solo escribía, sin condición.
   * Quien tiene una sesión y la contraseña vieja lanza `change-password` a la vez que el dueño hace forgot+reset: su escritura
   * pisaba el hash del reset y se llevaba un par válido. Ahora la escritura es condicional a la fila leída (hash, tokenVersion,
   * activa) y 0 filas ⇒ el `401 UNAUTHENTICATED` del paso 1, sin par.
   *
   * Gancho determinista: `argon2.verify` (el paso 3, el único `verify` de la vía) hace el verify real y, ANTES de devolver, deja
   * ganar a la otra escritura. Cada caso tumba una condición distinta del `where` (ablación por condición).
   */
  describe('CTA-R4 — change-password con otra escritura de la cuenta intercalada entre el verify y la escritura', () => {
    const actualVerify = (jest.requireActual('argon2') as typeof argon2).verify;
    const CHANGE_PW = 'CambioPerdedor123';
    const RESET_PW = 'ResetGanador123';
    type Race = (w: { id: string; access: string }) => Promise<() => Promise<void>>;
    /** [caso, preparación, ¿el hash final debe ser el de RESET_PW?] */
    const RACES: [string, Race, boolean][] = [
      [
        'reset-password del dueño (hash y tokenVersion cambian)',
        async (w) => {
          const token = await issueAuthToken(h, w.id, AuthTokenType.password_reset);
          return async () => expect((await post('/auth/reset-password', { token, password: RESET_PW })).status).toBe(200);
        },
        true,
      ],
      [
        'logout (solo tokenVersion cambia)',
        async (w) => async () => expect((await post('/auth/logout', undefined, w.access)).status).toBeLessThan(300),
        false,
      ],
      [
        'hash cambiado a mano sin tocar tokenVersion (solo passwordHash cambia)',
        async (w) => async () => {
          await prisma.user.update({ where: { id: w.id }, data: { passwordHash: await argon2.hash(RESET_PW) } });
        },
        true,
      ],
      [
        'cuenta bloqueada por el panel (solo status cambia)',
        async (w) => async () => {
          await prisma.user.update({ where: { id: w.id }, data: { status: UserStatus.blocked } });
        },
        false,
      ],
    ];

    it.each(RACES)('%s ⇒ 401 UNAUTHENTICATED, sin par, sin escribir y sin auditar el cambio', async (_race, prepare, resetWins) => {
      const w = await register('r4');
      const interleave = await prepare(w);
      let hooked = 0;
      let mid: Awaited<ReturnType<typeof userById>> | null = null;
      verifySpy.mockImplementationOnce(async (hash: string, plain: string) => {
        const ok = await actualVerify(hash, plain);
        hooked += 1;
        await interleave();
        mid = await userById(w.id);
        return ok;
      });
      const r = await post('/auth/change-password', { currentPassword: PASSWORD, newPassword: CHANGE_PW }, w.access);
      expect(hooked).toBe(1);
      expect([r.status, r.body?.error?.code]).toEqual([401, 'UNAUTHENTICATED']);
      expect(r.body?.accessToken).toBeUndefined();
      expect(r.body?.refreshToken).toBeUndefined();
      // La fila queda EXACTAMENTE como la dejó la escritura intercalada: el cambio no pisó nada.
      expect(await userById(w.id)).toEqual(mid);
      const after = await userById(w.id);
      expect(await actualVerify(after.passwordHash as string, CHANGE_PW)).toBe(false);
      expect(await actualVerify(after.passwordHash as string, resetWins ? RESET_PW : PASSWORD)).toBe(true);
      expect(await prisma.auditLog.count({ where: { action: 'auth.password_changed', entityId: w.id } })).toBe(0);
    });

    it('sin carrera, el mismo camino sigue dando 200 con par nuevo (control del gancho)', async () => {
      const w = await register('r4ok');
      const r = await post('/auth/change-password', { currentPassword: PASSWORD, newPassword: CHANGE_PW }, w.access);
      expect([r.status, typeof r.body?.accessToken]).toEqual([200, 'string']);
      const after = await userById(w.id);
      expect(await actualVerify(after.passwordHash as string, CHANGE_PW)).toBe(true);
    });
  });
});
