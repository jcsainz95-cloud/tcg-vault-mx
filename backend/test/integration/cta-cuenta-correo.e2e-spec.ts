/**
 * 🔒 v1.117⟨cuenta-correo⟩ — API_CONTRACT §CTA.9 (CTA-B1…B3, B5…B13), Postgres real, por HTTP. ARCHITECTURE §16.
 * Escritas ANTES del código (debían fallar sobre d31201bf: la ruta `register/email-only` no existía).
 *
 * | Caso | Qué fija | Mutación que lo pone rojo |
 * |---|---|---|
 * | CTA-B1 | alta ⇒ 201, cuenta sin prueba de nada, UN `account_setup` de 24 h con `tokenHash = sha256(claro del correo)` | emitir `email_verification`; exigir `password` |
 * | CTA-B2 | correo existente (4 estados) ⇒ 409 sin sesión, 0 correos, 0 tokens, 0 filas | devolver la sesión del existente; mandar correo |
 * | CTA-B3 | `"  X@Y.COM "` contra `x@y.com` ⇒ 409 | quitar `normalizeEmail` |
 * | CTA-B5 | `setupPending` compra (201 con PI); las otras cuatro rutas ⇒ 403 EMAIL_NOT_VERIFIED | dejar `'verified'` en `session` |
 * | CTA-B6 | (974) pedido de invitado: sin enlace ⇒ 403 y 0 `Address`; tras `account-setup` + login ⇒ lo lista y lo gana | nacer con `emailVerified=true` |
 * | CTA-B7 | (973) login `setupPending` ⇒ 401 con argon2 ficticio, igual que cuenta inexistente | cortocircuitar sin argon2 |
 * | CTA-B8 | `account-setup` completo (tokenVersion, un uso, 24 h, tipos cruzados, anulación, cuerpo antes del token, 5-bis) | ver el caso |
 * | CTA-B9 | ningún log con el claro o el enlace; bitácora sin correo ni token; BD solo con el hash | registrar el enlace |
 * | CTA-B10 | `set-password` (I-4) + concurrencia N=30 (subido de 10, ver el caso) ⇒ exactamente un 200 | leer y luego escribir sin condición |
 * | CTA-B11 | `PATCH /users/me/email` (anula, reenvía, 409, 422, tope 3/h sin escribir); tope en dos casos: (a) alta de hace > 1 h ⇒ 4.º `429`; (b) alta de hace minutos ⇒ 3.º `429` | no anular; tope después de escribir; contar solo las emisiones de la corrección (b) |
 * | CTA-B12 | `forgot-password` y `verify-email/resend` con `setupPending` ⇒ `account_setup` | rama ausente |
 * | CTA-B13 | (AUTH-PRE-1) Google sobre cuenta sin verificar revoca sesiones y borra la contraseña | no subir `tokenVersion` |
 *
 * CTA-B4 (throttlers) vive en `cta-signup-throttle.e2e-spec.ts` (necesita el throttler encendido) y en
 * `test/cta.account-setup.spec.ts` (reloj falso de 24 h). Datos propios: `cta.<RUN>.<n>@example.com`.
 */
jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { AuthTokenType, Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_FOLIOS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { GoogleTokenVerifier, GoogleIdentity } from '../../src/modules/auth/google-token-verifier';
import { authBackgroundIdle, issueAuthToken } from './helpers/auth-tokens';
import { AuthService } from '../../src/modules/auth/auth.service';

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const PASSWORD = 'Termina123!';
const HOUR = 60 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const SNAP = {
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
  references: 'Portón negro',
};

describe('CTA · cuenta con solo el correo y «Termina tu cuenta» (§CTA.9)', () => {
  let h: E2EHarness;
  let seq = 0;
  const bandeja: MailMessage[] = [];
  const logged: string[] = [];
  const logSpies: jest.SpyInstance[] = [];
  /** Todo token en claro que la suite vio salir por correo (CTA-B9 los busca en los logs). */
  const clears = new Set<string>();
  const google: { identity: GoogleIdentity | null } = { identity: null };
  const pieces: string[] = [];
  let sendSpy: jest.SpyInstance;

  beforeAll(async () => {
    h = await E2EHarness.create((b) =>
      b.overrideProvider(GoogleTokenVerifier).useValue({
        verify: async () => {
          if (!google.identity) throw new Error('google: sin identidad guionizada');
          return google.identity;
        },
      }),
    );
    const port = h.app.get<MailPort>(MAIL_PORT);
    sendSpy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      const m = /account-setup\?token=([^\s"&<]+)/.exec(msg.text ?? '');
      if (m) clears.add(decodeURIComponent(m[1]));
      return {};
    });
    const capture = (...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      logSpies.push(jest.spyOn(Logger.prototype, m).mockImplementation(capture as never));
    }
    for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      logSpies.push(jest.spyOn(console, m).mockImplementation(capture as never));
    }
  });

  afterAll(async () => {
    for (const s of logSpies) s.mockRestore();
    if (h && pieces.length) {
      await h.prisma.order.updateMany({
        where: { status: 'pending', items: { some: { inventoryItemId: { in: pieces } } } },
        data: { status: 'failed' },
      });
      await h.prisma.inventoryItem.updateMany({
        where: { id: { in: pieces } },
        data: { status: 'withdrawn', ownerType: 'platform', ownerUserId: null, ownershipStatus: null, reservedByOrderId: null, reservedUntil: null },
      });
    }
    await h?.close();
  });

  // ───────────────────────────────────────────── utilidades ─────────────────────────────────────────────

  const nextEmail = (tag = 'u') => `cta.${RUN}.${tag}${(seq += 1)}@example.com`;
  const emailOnly = (email: string, extra: Record<string, unknown> = {}) =>
    h.api('POST', '/auth/register/email-only', { json: { email, ...extra } });
  const accountSetup = (json: Record<string, unknown>) => h.api('POST', '/auth/account-setup', { json });
  const me = (token: string) => h.api('GET', '/users/me', { token });
  const userBy = (email: string) => h.prisma.user.findUniqueOrThrow({ where: { email } });
  const tokensOf = (userId: string, type?: AuthTokenType) =>
    h.prisma.authToken.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: { createdAt: 'asc' } });
  const mailsTo = (to: string) => bandeja.filter((m) => m.to === to);

  /** El claro del ÚLTIMO enlace «Termina tu cuenta» mandado a `to`. */
  function lastSetupClear(to: string): string {
    const m = mailsTo(to)
      .map((x) => /account-setup\?token=([^\s"&<]+)/.exec(x.text ?? ''))
      .filter((x): x is RegExpExecArray => x !== null)
      .pop();
    if (!m) throw new Error(`sin enlace account-setup para ${to}`);
    return decodeURIComponent(m[1]);
  }

  /** Alta con solo el correo ⇒ `{ id, email, access, refresh, clear }`. */
  async function pending(tag = 'p') {
    const email = nextEmail(tag);
    const r = await emailOnly(email);
    expect([r.status, r.text]).toEqual([201, r.text]);
    const u = await userBy(email);
    return { id: u.id, email, access: r.body.accessToken as string, refresh: r.body.refreshToken as string, clear: lastSetupClear(email) };
  }

  /** Cuenta con contraseña (`register`) ⇒ `{ id, email, access }`. */
  async function withPassword(tag = 'w', verified = false) {
    const email = nextEmail(tag);
    const r = await h.api('POST', '/auth/register', { json: { email, password: PASSWORD, name: 'Ana Pérez' } });
    expect(r.status).toBe(201);
    const u = await h.prisma.user.update({ where: { email }, data: { emailVerified: verified } });
    return { id: u.id, email, access: r.body.accessToken as string, refresh: r.body.refreshToken as string };
  }

  /** Cuenta solo-Google (sin hash) con una sesión acuñada por el servicio real. */
  async function googleOnly(tag = 'g') {
    const email = nextEmail(tag);
    const u = await h.prisma.user.create({
      data: { email, passwordHash: null, name: 'G', nameSource: 'google', role: 'customer', authProvider: 'google', googleId: `g-${randomUUID()}`, emailVerified: true },
    });
    const pair = await h.app.get(AuthService).issueTokens(u);
    return { id: u.id, email, access: pair.accessToken };
  }

  async function guestOrder(email: string) {
    seq += 1;
    const o = await h.prisma.order.create({
      data: {
        guestEmail: email,
        orderNumber: `CTA-${RUN}-${seq}`,
        fulfillmentMode: 'direct_ship',
        shippingAddressSnapshot: SNAP as Prisma.InputJsonObject,
        status: 'settled',
        settledAt: new Date(),
        subtotalCents: 10000,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents: 10000,
        priceConvention: 'IVA_INCLUSIVE',
      },
    });
    return o.id;
  }

  const defaultAddress = (userId: string) =>
    h.prisma.address.create({
      data: { userId, recipientName: 'Plantada', line1: 'Calle Falsa 123', neighborhood: 'Centro', city: 'CDMX', state: 'CDMX', postalCode: '06000', country: 'MX', phone: '5500000000', isDefault: true },
    });

  // ───────────────────────────────────────────── CTA-B1 ─────────────────────────────────────────────

  it('CTA-B1 — alta con correo nuevo ⇒ 201; User sin prueba de nada; UN account_setup de 24 h con el hash del claro; un correo; accountSetupPending', async () => {
    const email = nextEmail('b1');
    const before = Date.now();
    // Llaves extra (`password`, `name`, `phone`) se descartan: ⛔ el alta no las acepta.
    const r = await emailOnly(email, { password: 'NoSeUsa12345', name: 'Intruso', phone: '5511111111', locale: 'en' });
    expect([r.status, r.text]).toEqual([201, r.text]);
    expect(Object.keys(r.body).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(r.body.user).toMatchObject({ email, emailVerified: false, mustChangePassword: false, role: 'customer', locale: 'en' });

    const u = await userBy(email);
    expect(u).toMatchObject({
      emailVerified: false,
      passwordHash: null,
      phone: null,
      googleId: null,
      name: email.split('@')[0],
      nameSource: 'derived',
      authProvider: 'local',
      role: 'customer',
      status: 'active',
      locale: 'en',
    });

    const toks = await tokensOf(u.id);
    expect(toks.map((t) => t.type)).toEqual(['account_setup']);
    const exp = toks[0].expiresAt.getTime();
    expect(Math.abs(exp - (before + 24 * HOUR))).toBeLessThanOrEqual(60_000);
    expect(toks[0].usedAt).toBeNull();
    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    const clear = lastSetupClear(email);
    expect(toks[0].tokenHash).toBe(sha256(clear));
    expect(toks[0].tokenHash).not.toBe(clear);
    expect(mails[0].text).toContain(`/en/account-setup?token=`);

    const m = await me(r.body.accessToken);
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ hasPassword: false, accountSetupPending: true, nameSource: 'derived', phone: null, emailVerified: false });
    const audit = await h.prisma.auditLog.findMany({ where: { action: 'auth.register_email_only', entityId: u.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].entityType).toBe('User');
  });

  // ───────────────────────────────────────────── CTA-B2 ─────────────────────────────────────────────

  it('CTA-B2 — (970) correo existente en cuatro estados ⇒ 409 EMAIL_TAKEN sin sesión; 0 AuthToken, 0 correos, 0 User', async () => {
    const conPass = await withPassword('b2a');
    const goo = await googleOnly('b2b');
    const pend = await pending('b2c');
    const bloq = await withPassword('b2d');
    await h.prisma.user.update({ where: { id: bloq.id }, data: { status: 'blocked' } });

    for (const [estado, email] of [
      ['con contraseña', conPass.email],
      ['Google', goo.email],
      ['setupPending', pend.email],
      ['bloqueada', bloq.email],
    ] as const) {
      const users0 = await h.prisma.user.count();
      const toks0 = await h.prisma.authToken.count();
      const mails0 = bandeja.length;
      const r = await emailOnly(email);
      expect([estado, r.status, r.body?.error?.code]).toEqual([estado, 409, 'EMAIL_TAKEN']);
      expect(Object.keys(r.body)).toEqual(['error']);
      expect(r.text).not.toMatch(/accessToken|refreshToken|"user"/);
      expect(await h.prisma.user.count()).toBe(users0);
      expect(await h.prisma.authToken.count()).toBe(toks0);
      expect(bandeja.length).toBe(mails0);
    }
  });

  // ───────────────────────────────────────────── CTA-B3 ─────────────────────────────────────────────

  it('CTA-B3 — "  X@Y.COM " contra x@y.com existente ⇒ 409 (normalizeEmail antes de validar)', async () => {
    const email = nextEmail('b3');
    expect((await emailOnly(email)).status).toBe(201);
    const shouty = `  ${email.toUpperCase()} `;
    const r = await emailOnly(shouty);
    expect([r.status, r.body?.error?.code]).toEqual([409, 'EMAIL_TAKEN']);
    // Y un correo NUEVO con mayúsculas y espacios se guarda normalizado.
    const fresh = nextEmail('b3n');
    const r2 = await emailOnly(`  ${fresh.toUpperCase()}  `);
    expect(r2.status).toBe(201);
    expect((await userBy(fresh)).email).toBe(fresh);
    // Vacío o inválido ⇒ 400.
    for (const bad of ['', '   ', 'no-es-correo']) {
      expect((await emailOnly(bad)).status).toBe(400);
    }
  });

  // ───────────────────────────────────────────── CTA-B5 ─────────────────────────────────────────────

  it('CTA-B5 — cuenta setupPending: checkout/session 201 con PI; shipments, buylist/requests, claimable y claim ⇒ 403 EMAIL_NOT_VERIFIED', async () => {
    const p = await pending('b5');
    const template = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard } });
    const piece = await h.prisma.inventoryItem.create({
      data: {
        folio: `E2E-CTA-${RUN}-${(seq += 1)}`,
        cardId: template.cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 70000,
        locationId: template.locationId,
      },
    });
    pieces.push(piece.id);
    const pi0 = h.stripe.createdIntents.length;
    const s = await h.api('POST', '/checkout/session', { token: p.access, json: { inventoryItemIds: [piece.id] } });
    expect([s.status, s.text]).toEqual([201, s.text]);
    expect(h.stripe.createdIntents.length).toBe(pi0 + 1);

    const routes: [string, string][] = [
      ['POST', '/shipments'],
      ['POST', '/buylist/requests'],
      ['GET', '/orders/claimable'],
      ['POST', '/orders/claim'],
    ];
    for (const [m, path] of routes) {
      const r = await h.api(m, path, { token: p.access, ...(m === 'POST' ? { json: {} } : {}) });
      expect([path, r.status, r.body?.error?.code]).toEqual([path, 403, 'EMAIL_NOT_VERIFIED']);
    }
  });

  // ───────────────────────────────────────────── CTA-B6 ─────────────────────────────────────────────

  it('CTA-B6 — (974) pedido de invitado con E + alta email-only con E ⇒ 403 y 0 Address; tras account-setup y login ⇒ claimable lo lista y claim lo gana', async () => {
    const email = nextEmail('b6');
    const orderId = await guestOrder(email);
    const r = await emailOnly(email);
    expect(r.status).toBe(201);
    const userId = (await userBy(email)).id;

    const c1 = await h.api('GET', '/orders/claimable', { token: r.body.accessToken });
    expect([c1.status, c1.body?.error?.code]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
    const k1 = await h.api('POST', '/orders/claim', { token: r.body.accessToken, json: { orderIds: [orderId] } });
    expect([k1.status, k1.body?.error?.code]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
    expect(await h.prisma.address.count({ where: { userId } })).toBe(0);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).userId).toBeNull();

    const s = await accountSetup({ token: lastSetupClear(email), name: 'Ana López', password: PASSWORD });
    expect([s.status, s.text]).toEqual([200, s.text]);
    const tok = await h.login(email, PASSWORD);
    const c2 = await h.api('GET', '/orders/claimable', { token: tok });
    expect(c2.status).toBe(200);
    expect(c2.body.data.map((o: { orderId?: string; id?: string }) => o.orderId ?? o.id)).toContain(orderId);
    const k2 = await h.api('POST', '/orders/claim', { token: tok, json: { orderIds: [orderId] } });
    expect(k2.status).toBe(200);
    expect(k2.body.claimed).toEqual([orderId]);
    expect(await h.prisma.address.count({ where: { userId } })).toBe(1);
  });

  // ───────────────────────────────────────────── CTA-B7 ─────────────────────────────────────────────

  it('CTA-B7 — (973) login de una cuenta setupPending ⇒ 401 INVALID_CREDENTIALS con argon2 ficticio, misma forma que cuenta inexistente', async () => {
    const p = await pending('b7');
    const verify = argon2.verify as unknown as jest.Mock;
    verify.mockClear();
    const r = await h.api('POST', '/auth/login', { json: { email: p.email, password: 'CualquierCosa1' } });
    expect([r.status, r.body?.error?.code]).toEqual([401, 'INVALID_CREDENTIALS']);
    expect(verify).toHaveBeenCalledTimes(1);
    verify.mockClear();
    const ghost = await h.api('POST', '/auth/login', { json: { email: nextEmail('b7x'), password: 'CualquierCosa1' } });
    expect(verify).toHaveBeenCalledTimes(1);
    expect([ghost.status, ghost.body]).toEqual([r.status, r.body]);
  });

  // ───────────────────────────────────────────── CTA-B8 ─────────────────────────────────────────────

  describe('CTA-B8 — POST /auth/account-setup', () => {
    it('válido ⇒ 200 {ok, deviceToken}; hash, name, nameSource=user, emailVerified, tokenVersion+1; sesión vieja 401; segundo uso 422; 5-bis', async () => {
      const p = await pending('b8');
      const before = await userBy(p.email);
      const planted = await defaultAddress(p.id);
      const r = await accountSetup({ token: p.clear, name: '  Ana López  ', password: PASSWORD });
      expect([r.status, r.text]).toEqual([200, r.text]);
      expect(Object.keys(r.body).sort()).toEqual(['deviceToken', 'ok']);
      expect(r.body.ok).toBe(true);
      const after = await userBy(p.email);
      expect(after.passwordHash).not.toBeNull();
      expect(await argon2.verify(after.passwordHash!, PASSWORD)).toBe(true);
      expect(after).toMatchObject({ name: 'Ana López', nameSource: 'user', emailVerified: true, mustChangePassword: false });
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
      expect((await me(p.access)).status).toBe(401);
      expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: p.refresh } })).status).toBe(401);
      // 5-bis: lo cargado antes de probar el buzón no queda como destino por defecto.
      expect((await h.prisma.address.findUniqueOrThrow({ where: { id: planted.id } })).isDefault).toBe(false);
      const again = await accountSetup({ token: p.clear, name: 'Otro', password: 'OtraClave123' });
      expect([again.status, again.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_TOKEN_INVALID']);
      expect(await h.login(p.email, PASSWORD)).toEqual(expect.any(String));
      const audit = await h.prisma.auditLog.findMany({ where: { action: 'auth.account_setup_completed', entityId: p.id } });
      expect(audit).toHaveLength(1);
    });

    it('caducado (reloj +24 h +1 s) ⇒ 422 sin escribir', async () => {
      const p = await pending('b8t');
      jest.useFakeTimers({
        now: Date.now() + 24 * HOUR + 1000,
        doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
      });
      try {
        const r = await accountSetup({ token: p.clear, name: 'Ana', password: PASSWORD });
        expect([r.status, r.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_TOKEN_INVALID']);
      } finally {
        jest.useRealTimers();
      }
      expect((await userBy(p.email)).passwordHash).toBeNull();
    });

    it('tipos cruzados: password_reset en account-setup ⇒ 422; account_setup en reset-password ⇒ 422 RESET_TOKEN_INVALID', async () => {
      const p = await pending('b8x');
      const reset = await issueAuthToken(h, p.id, AuthTokenType.password_reset);
      const a = await accountSetup({ token: reset, name: 'Ana', password: PASSWORD });
      expect([a.status, a.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_TOKEN_INVALID']);
      const b = await h.api('POST', '/auth/reset-password', { json: { token: p.clear, password: PASSWORD } });
      expect([b.status, b.body?.error?.code]).toEqual([422, 'RESET_TOKEN_INVALID']);
      // Los dos siguen sin usar (cada uno es de su tipo).
      expect((await h.prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(reset) } })).usedAt).toBeNull();
      expect((await h.prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(p.clear) } })).usedAt).toBeNull();
      expect((await userBy(p.email)).passwordHash).toBeNull();
    });

    it('anula los otros account_setup y password_reset pendientes de la cuenta', async () => {
      const p = await pending('b8a');
      const reset = await issueAuthToken(h, p.id, AuthTokenType.password_reset);
      const r = await accountSetup({ token: p.clear, name: 'Ana', password: PASSWORD });
      expect(r.status).toBe(200);
      const pend = await h.prisma.authToken.count({ where: { userId: p.id, usedAt: null, type: { in: ['account_setup', 'password_reset'] as AuthTokenType[] } } });
      expect(pend).toBe(0);
      const b = await h.api('POST', '/auth/reset-password', { json: { token: reset, password: 'OtraClave123' } });
      expect([b.status, b.body?.error?.code]).toEqual([422, 'RESET_TOKEN_INVALID']);
    });

    it('cuerpo inválido (400) NO consume el token', async () => {
      const p = await pending('b8v');
      for (const body of [
        { token: p.clear, name: '   ', password: PASSWORD },
        { token: p.clear, name: 'Ana', password: 'corta' },
        { token: p.clear, name: 'x'.repeat(121), password: PASSWORD },
        { token: p.clear, password: PASSWORD },
      ]) {
        const r = await accountSetup(body);
        expect([JSON.stringify(body).slice(0, 40), r.status]).toEqual([JSON.stringify(body).slice(0, 40), 400]);
        expect((await h.prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(p.clear) } })).usedAt).toBeNull();
      }
      expect((await accountSetup({ token: p.clear, name: 'Ana', password: PASSWORD })).status).toBe(200);
    });

    it('cuenta bloqueada ⇒ 403 USER_BLOCKED', async () => {
      const p = await pending('b8b');
      await h.prisma.user.update({ where: { id: p.id }, data: { status: 'blocked' } });
      const r = await accountSetup({ token: p.clear, name: 'Ana', password: PASSWORD });
      expect([r.status, r.body?.error?.code]).toEqual([403, 'USER_BLOCKED']);
      expect((await userBy(p.email)).passwordHash).toBeNull();
    });
  });

  // ───────────────────────────────────────────── CTA-B10 ─────────────────────────────────────────────

  describe('CTA-B10 — POST /auth/set-password', () => {
    const setPassword = (token: string, json: Record<string, unknown>) => h.api('POST', '/auth/set-password', { token, json });

    it('setupPending ⇒ 200 con par nuevo; refresh viejo 401; emailVerified sigue false y claimable 403', async () => {
      const p = await pending('b10');
      const before = await userBy(p.email);
      const r = await setPassword(p.access, { newPassword: PASSWORD, name: '  Ana Set ' });
      expect([r.status, r.text]).toEqual([200, r.text]);
      expect(Object.keys(r.body).sort()).toEqual(['accessToken', 'ok', 'refreshToken']);
      const after = await userBy(p.email);
      expect(await argon2.verify(after.passwordHash!, PASSWORD)).toBe(true);
      expect(after).toMatchObject({ emailVerified: false, name: 'Ana Set', nameSource: 'user' });
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
      expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: p.refresh } })).status).toBe(401);
      expect((await me(p.access)).status).toBe(401);
      const m = await me(r.body.accessToken);
      expect(m.body).toMatchObject({ hasPassword: true, accountSetupPending: false });
      const c = await h.api('GET', '/orders/claimable', { token: r.body.accessToken });
      expect([c.status, c.body?.error?.code]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
      expect(await h.prisma.auditLog.count({ where: { action: 'auth.password_set_from_session', entityId: p.id } })).toBe(1);
    });

    it('con contraseña ⇒ 422 ACCOUNT_SETUP_NOT_PENDING sin escribir; Google sin hash ⇒ 422', async () => {
      const w = await withPassword('b10w');
      const h0 = (await userBy(w.email)).passwordHash;
      const r = await setPassword(w.access, { newPassword: 'OtraClave123' });
      expect([r.status, r.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_NOT_PENDING']);
      const u = await userBy(w.email);
      expect(u.passwordHash).toBe(h0);
      const g = await googleOnly('b10g');
      const r2 = await setPassword(g.access, { newPassword: 'OtraClave123' });
      expect([r2.status, r2.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_NOT_PENDING']);
      expect((await userBy(g.email)).passwordHash).toBeNull();
    });

    it('contraseña corta ⇒ 400 sin escribir', async () => {
      const p = await pending('b10c');
      const r = await setPassword(p.access, { newPassword: 'corta' });
      expect(r.status).toBe(400);
      expect((await userBy(p.email)).passwordHash).toBeNull();
    });

    /**
     * Concurrencia (I-4): dos set-password simultáneos por ronda ⇒ exactamente un 200 en TODAS (autor: backend).
     * §CTA.9 pide N=10 «y si la mutación no muerde ≥ 5/10, se sube N». Medido (backend, copia de 6ea7f0e3, Postgres 16,
     * load ~10): la mutación «leer y luego escribir sin condición» deja dos 200 en 2/10 rondas (3 corridas: 2/10, 2/10,
     * 2/10) ⇒ por ronda muerde ~20 % < 50 %. Se sube a N=30: P(no morder en una corrida) ≈ 0.8³⁰ ≈ 0.1 %.
     */
    it('concurrencia: dos set-password a la vez, N=30 ⇒ exactamente un 200 en 30/30', async () => {
      const N = 30;
      const rounds: string[] = [];
      let ok = 0;
      for (let i = 0; i < N; i += 1) {
        const p = await pending('b10r');
        const [a, b] = await Promise.all([
          setPassword(p.access, { newPassword: 'PrimeraClave1' }),
          setPassword(p.access, { newPassword: 'SegundaClave2' }),
        ]);
        const statuses = [a.status, b.status].sort();
        rounds.push(statuses.join('+'));
        if (statuses.filter((s) => s === 200).length === 1) ok += 1;
      }
      // `process.stdout` y no `console`: el espía de logs de CTA-B9 se traga `console.*`.
      process.stdout.write(`CTA-B10 concurrencia: ${ok}/${N} rondas con exactamente un 200 (${rounds.join(',')})\n`);
      expect(ok).toBe(N);
    });
  });

  // ───────────────────────────────────────────── CTA-B11 ─────────────────────────────────────────────

  it('CTA-B11 — PATCH /users/me/email: corrige, anula el enlace viejo, reenvía; 409; 422 con contraseña; 4.º en la hora ⇒ 429 sin cambiar', async () => {
    const p = await pending('b11');
    // El token del alta se emitió hace más de una hora (el tope cuenta `account_setup` de la última hora).
    await h.prisma.authToken.updateMany({ where: { userId: p.id }, data: { createdAt: new Date(Date.now() - 2 * HOUR) } });
    const patch = (token: string, email: string) => h.api('PATCH', '/users/me/email', { token, json: { email } });

    // Igual al actual ⇒ 200 sin escribir ni mandar correo.
    const mails0 = bandeja.length;
    const same = await patch(p.access, p.email);
    expect(same.status).toBe(200);
    expect(bandeja.length).toBe(mails0);

    // Un `password_reset` pendiente (de cualquier vía) también deja de valer: la anulación es de los TRES tipos y va en la
    // tx de la escritura (la rotación de `issue` solo cubre `account_setup`, y es post-commit y best-effort).
    const strayReset = await issueAuthToken(h, p.id, AuthTokenType.password_reset);
    const e1 = nextEmail('b11n');
    const r1 = await patch(p.access, `  ${e1.toUpperCase()} `);
    expect([r1.status, r1.text]).toEqual([200, r1.text]);
    expect(r1.body).toMatchObject({ email: e1, accountSetupPending: true, emailVerified: false });
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } })).email).toBe(e1);
    const old = await accountSetup({ token: p.clear, name: 'Ana', password: PASSWORD });
    expect([old.status, old.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_TOKEN_INVALID']);
    const stray = await h.api('POST', '/auth/reset-password', { json: { token: strayReset, password: 'OtraClave123' } });
    expect([stray.status, stray.body?.error?.code]).toEqual([422, 'RESET_TOKEN_INVALID']);
    expect(mailsTo(e1)).toHaveLength(1);
    const c1 = lastSetupClear(e1);
    expect(c1).not.toBe(p.clear);
    expect((await h.prisma.auditLog.findMany({ where: { action: 'user.email_corrected', entityId: p.id } })).length).toBe(1);

    // Correo tomado ⇒ 409, sin cambiar.
    const taken = await withPassword('b11t');
    const r409 = await patch(p.access, taken.email);
    expect([r409.status, r409.body?.error?.code]).toEqual([409, 'EMAIL_TAKEN']);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } })).email).toBe(e1);

    // Cuenta con contraseña ⇒ 422.
    const r422 = await patch(taken.access, nextEmail('b11z'));
    expect([r422.status, r422.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_NOT_PENDING']);
    expect((await userBy(taken.email)).email).toBe(taken.email);

    // Dos cambios más (3 `account_setup` en la hora) y el 4.º ⇒ 429 sin escribir.
    const e2 = nextEmail('b11n');
    expect((await patch(p.access, e2)).status).toBe(200);
    const e3 = nextEmail('b11n');
    expect((await patch(p.access, e3)).status).toBe(200);
    const e4 = nextEmail('b11n');
    const mails4 = bandeja.length;
    const r429 = await patch(p.access, e4);
    expect([r429.status, r429.body?.error?.code]).toEqual([429, 'RATE_LIMITED']);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } })).email).toBe(e3);
    expect(bandeja.length).toBe(mails4);
    // El enlace vigente (del correo e3) termina la cuenta.
    expect((await accountSetup({ token: lastSetupClear(e3), name: 'Ana', password: PASSWORD })).status).toBe(200);
  });

  /**
   * CTA-B11 caso (b) (v1.117.1, D-CTA-9; techlead R1 sobre `e9c4c316`): el ALTA cuenta para el tope. Alta por el endpoint en
   * esta misma prueba (su `account_setup` es de hace segundos, NO se atrasa) ⇒ cambios 1-2 `200`, el 3.º `429` sin escribir ni
   * emitir. Mutación que lo pone rojo: contar solo las emisiones de la corrección (el caso (a) no la ve: allí el alta ya salió
   * de la hora y las dos cuentas coinciden).
   */
  it('CTA-B11 (b) — alta por el endpoint hace minutos ⇒ cambios 1-2 200, el 3.º ⇒ 429 sin cambiar el correo ni emitir', async () => {
    const p = await pending('b11b');
    const patch = (email: string) => h.api('PATCH', '/users/me/email', { token: p.access, json: { email } });
    const setupTokens = () => h.prisma.authToken.count({ where: { userId: p.id, type: AuthTokenType.account_setup } });
    // Precondición: el token del alta está DENTRO de la hora (si no, esto sería el caso (a)).
    const alta = await tokensOf(p.id, AuthTokenType.account_setup);
    expect(alta).toHaveLength(1);
    expect(Date.now() - alta[0].createdAt.getTime()).toBeLessThan(HOUR / 2);

    const e1 = nextEmail('b11b');
    const r1 = await patch(e1);
    expect([r1.status, r1.text]).toEqual([200, r1.text]);
    const e2 = nextEmail('b11b');
    const r2 = await patch(e2);
    expect([r2.status, r2.text]).toEqual([200, r2.text]);
    expect(await setupTokens()).toBe(3);

    const e3 = nextEmail('b11b');
    const mails3 = bandeja.length;
    const r429 = await patch(e3);
    expect([r429.status, r429.body?.error?.code]).toEqual([429, 'RATE_LIMITED']);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } })).email).toBe(e2);
    expect(bandeja.length).toBe(mails3);
    expect(await setupTokens()).toBe(3);
    expect(mailsTo(e3)).toHaveLength(0);
    // El enlace vigente (del correo e2) sigue terminando la cuenta: el 429 no anuló nada.
    expect((await accountSetup({ token: lastSetupClear(e2), name: 'Ana', password: PASSWORD })).status).toBe(200);
  });

  // ───────────────────────────────────────────── CTA-B12 ─────────────────────────────────────────────

  it('CTA-B12 — forgot-password y verify-email/resend con setupPending ⇒ account_setup (respuesta idéntica); con contraseña ⇒ como hoy', async () => {
    const p = await pending('b12');
    const f = await h.api('POST', '/auth/forgot-password', { json: { email: p.email } });
    const ghost = await h.api('POST', '/auth/forgot-password', { json: { email: nextEmail('b12x') } });
    await authBackgroundIdle(h); // v1.117.2 (D-CTA-14): forgot-password emite y envía tras responder.
    expect([f.status, f.body]).toEqual([ghost.status, ghost.body]);
    expect(f.body).toEqual({ ok: true });
    let toks = await tokensOf(p.id);
    expect(toks.map((t) => t.type)).toEqual(['account_setup', 'account_setup']);
    expect(mailsTo(p.email)).toHaveLength(2);
    expect(mailsTo(p.email)[1].text).toContain('/account-setup?token=');

    const rs = await h.api('POST', '/auth/verify-email/resend', { token: p.access });
    expect([rs.status, rs.body]).toEqual([200, { ok: true }]);
    toks = await tokensOf(p.id);
    expect(toks.map((t) => t.type)).toEqual(['account_setup', 'account_setup', 'account_setup']);
    expect(toks.filter((t) => t.usedAt === null)).toHaveLength(1);

    const w = await withPassword('b12w');
    await h.api('POST', '/auth/forgot-password', { json: { email: w.email } });
    await authBackgroundIdle(h);
    await h.api('POST', '/auth/verify-email/resend', { token: w.access });
    const wt = await tokensOf(w.id);
    expect(wt.map((t) => t.type).sort()).toEqual(['email_verification', 'email_verification', 'password_reset']);
  });

  // ───────────────────────────────────────────── CTA-B13 ─────────────────────────────────────────────

  describe('CTA-B13 — (AUTH-PRE-1) Google que enlaza una cuenta sin verificar', () => {
    const googleLogin = (email: string) => {
      google.identity = { sub: `g-${randomUUID()}`, email, emailVerified: true, name: 'Dueño Real' } as GoogleIdentity;
      return h.api('POST', '/auth/google', { json: { idToken: 'x' } });
    };

    it('cuenta email-only con sesión S ⇒ Google enlaza; access y refresh de S ⇒ 401; tokens anulados; libreta sin predeterminada', async () => {
      const p = await pending('b13');
      const planted = await defaultAddress(p.id);
      const before = await userBy(p.email);
      const g = await googleLogin(p.email);
      expect([g.status, g.text]).toEqual([200, g.text]);
      const after = await userBy(p.email);
      expect(after).toMatchObject({ emailVerified: true, passwordHash: null, mustChangePassword: false });
      expect(after.googleId).not.toBeNull();
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
      expect((await me(p.access)).status).toBe(401);
      expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: p.refresh } })).status).toBe(401);
      expect((await me(g.body.accessToken)).status).toBe(200);
      expect(await h.prisma.authToken.count({ where: { userId: p.id, usedAt: null } })).toBe(0);
      expect((await h.prisma.address.findUniqueOrThrow({ where: { id: planted.id } })).isDefault).toBe(false);
      const audit = await h.prisma.auditLog.findMany({ where: { action: 'auth.google_link', entityId: p.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toEqual({ wasUnverified: true });
    });

    it('cuenta de register sin verificar ⇒ tras Google, login con la contraseña vieja ⇒ 401', async () => {
      const w = await withPassword('b13w');
      expect((await googleLogin(w.email)).status).toBe(200);
      const l = await h.api('POST', '/auth/login', { json: { email: w.email, password: PASSWORD } });
      expect([l.status, l.body?.error?.code]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect((await me(w.access)).status).toBe(401);
    });

    it('cuenta ya verificada ⇒ las sesiones siguen vivas y la contraseña se conserva', async () => {
      const w = await withPassword('b13v', true);
      const before = await userBy(w.email);
      expect((await googleLogin(w.email)).status).toBe(200);
      expect((await me(w.access)).status).toBe(200);
      const after = await userBy(w.email);
      expect(after.tokenVersion).toBe(before.tokenVersion);
      expect(after.passwordHash).toBe(before.passwordHash);
    });
  });

  // ───────────────────────────────────────────── CTA-B9 (al final: mira lo que dejó toda la suite) ─────────────────────────────────────────────

  /**
   * CTA-B9 ampliada (TL-CTA-10, I-6): el proveedor de correo falla con un mensaje que LLEVA el enlace (p. ej. un SMTP que devuelve
   * el cuerpo rechazado). El log del fallo dice la clase del error y la cuenta, ⛔ nunca el mensaje. Cubre los dos sitios que
   * registraban `String(e)`: la verificación (`verify-email/resend`) y el reset (`forgot-password` con contraseña).
   * Mutación que lo pone rojo: volver a registrar `String(e)` en cualquiera de los dos.
   */
  it('CTA-B9 (TL-CTA-10) — un fallo del correo cuyo mensaje lleva el enlace no lo deja en el log (verificación y reset)', async () => {
    const w = await withPassword('b9f');
    const links: string[] = [];
    const failOnce = () =>
      sendSpy.mockImplementationOnce(async (msg: MailMessage) => {
        const m = /\S*(?:verify-email|reset-password)\?token=[^\s"<]+/.exec(msg.text ?? '');
        if (!m) throw new Error('el correo fallido no traía enlace: la prueba no mide nada');
        links.push(m[0]);
        throw new Error(`smtp 550 rechazado: ${msg.text}`);
      });
    const before = logged.length;

    failOnce();
    expect((await h.api('POST', '/auth/verify-email/resend', { token: w.access })).status).toBe(200);
    failOnce();
    expect((await h.api('POST', '/auth/forgot-password', { json: { email: w.email } })).status).toBe(200);
    await authBackgroundIdle(h);

    expect(links).toHaveLength(2);
    const fresh = logged.slice(before).join('\n');
    // El fallo SÍ se registró (si no, el «no contiene» sería vacío).
    expect(fresh).toContain(`No se pudo enviar el correo de verificación a ${w.id}`);
    expect(fresh).toContain(`No se pudo enviar el correo de reset a ${w.id}`);
    for (const l of links) {
      const clear = decodeURIComponent((/token=([^\s"&<]+)/.exec(l) as RegExpExecArray)[1]);
      expect(fresh.includes(l)).toBe(false);
      expect(fresh.includes(clear)).toBe(false);
      expect(fresh.includes(encodeURIComponent(clear))).toBe(false);
    }
    expect(fresh).not.toMatch(/(verify-email|reset-password)\?token=/);
    expect(fresh).not.toContain('smtp 550 rechazado');
  });

  it('CTA-B9 — ningún log contiene el claro ni el enlace; bitácora de las acciones nuevas sin correo ni token; la BD solo guarda el hash', async () => {
    expect(clears.size).toBeGreaterThanOrEqual(10);
    const all = logged.join('\n');
    for (const c of clears) {
      expect(all.includes(c)).toBe(false);
      expect(all.includes(encodeURIComponent(c))).toBe(false);
    }
    expect(all).not.toMatch(/account-setup\?token=/);
    const users = await h.prisma.user.findMany({ where: { email: { contains: `.${RUN}.` } }, select: { id: true, email: true } });
    expect(users.length).toBeGreaterThan(0);
    const rows = await h.prisma.auditLog.findMany({
      where: {
        action: { in: ['auth.register_email_only', 'auth.account_setup_sent', 'auth.account_setup_completed', 'auth.password_set_from_session', 'user.email_corrected'] },
        entityId: { in: users.map((u) => u.id) },
      },
    });
    expect(new Set(rows.map((r) => r.action)).size).toBe(5);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(`.${RUN}.`);
    expect(dump).not.toContain('@example.com');
    for (const c of clears) expect(dump.includes(c)).toBe(false);
    const stored = await h.prisma.authToken.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { tokenHash: true } });
    const hashes = new Set(stored.map((s) => s.tokenHash));
    for (const c of clears) expect(hashes.has(c)).toBe(false);
  });
});
