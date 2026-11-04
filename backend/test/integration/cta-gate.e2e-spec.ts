/**
 * 🔒 v1.117.2⟨cuenta-correo⟩ — API_CONTRACT §CTA.9 CTA-B14, B14r, B15, B16 y B18 (§CTA.13, D-CTA-11/12/14), Postgres real, por
 * HTTP. Escritas ANTES del código, sobre `64589a56` (contrato v1.117.2), y rojas allí por la razón de cada fila:
 *
 * | Caso | Qué fija | Mutación que lo pone rojo |
 * |---|---|---|
 * | CTA-B14 | PT-CTA-1: 5 `PATCH /users/me/email` a la vez (uno a V retrasado δ) ⇒ ningún enlace mandado a otro correo canjea; ≤ 1 vivo; vivo atado al correo final; sin 5xx. N=30 por δ | v1.117.3, ablación de referencia «forma de antes» (sin candado, sin atadura, sin índice, emisión en otra tx tras el commit y correo releído) ⇒ (a) en δ=25 (≥ 3/30, si no se sube N). Candado + atadura con el resto intacto NO muerde y no se exige; cada capa tiene su prueba: solo la atadura ⇒ el determinista; solo el candado ⇒ B16 y CTA-B19 (`cta-v1173.e2e-spec.ts`) |
 * | CTA-B14 det. | token emitido a A, correo cambiado a V en BD ⇒ `account-setup`, `reset-password` y `verify-email` dan su 422 sin escribir | quitar la atadura |
 * | CTA-B14r | 10 `resend` + 10 `forgot-password` a la vez ⇒ ≤ 1 vivo por tipo, sin 5xx. N=30 | rotación fuera del candado y sin el índice de M-97 |
 * | CTA-B15 | PT-CTA-2 (AUTH-PRE-2), dos vías: `verify-email` exige `password` o `newPassword`; `newPassword` revoca, sustituye el hash y el re-login del creador da 401 | aceptar `{token}`; `newPassword` sin `tokenVersion +1`; sin reemplazar el hash |
 * | CTA-B16 | PT-CTA-4: K=5 y K=20 `PATCH` a la vez (1 emisión previa) ⇒ exactamente 2 `200`, 3 emitidos y 3 correos. N=30 por K | contar el tope fuera del candado |
 * | CTA-B18 | PT-CTA-5: `forgot-password` responde con la búsqueda y el correo colgados; cero consultas en la petición; el fallo se registra sin correo | `await` del trabajo en la petición |
 *
 * N por variable de entorno (`CTA_B14_N`, `CTA_B14R_N`, `CTA_B16_N`; por defecto 30) para subirla en una ablación (§CTA.9: «si
 * muerde < 3/30 se sube N»). Cada proporción se imprime por `process.stdout` con su N. Datos propios: `ctag.<RUN>.<n>@example.com`.
 */
import { createHash, randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import { AuthTokenType } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';

jest.setTimeout(600_000);

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const PASSWORD = 'Termina123!';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const envN = (name: string, def: number) => {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : def;
};
const out = (line: string) => process.stdout.write(`${line}\n`);

/** Enlaces con token que salen por correo: `<ruta>?token=<claro>`. */
const LINK_RE = /(account-setup|reset-password|verify-email)\?token=([^\s"&<]+)/;

describe('CTA §13 — candado de la cuenta, token atado al correo, verify-email con credencial, forgot-password sin oráculo', () => {
  let h: E2EHarness;
  let seq = 0;
  let ipSeq = 0;
  const bandeja: MailMessage[] = [];
  let hasEmailHash = false;

  beforeAll(async () => {
    h = await E2EHarness.create();
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
    const cols = await h.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM information_schema.columns WHERE table_name = 'AuthToken' AND column_name = 'emailHash'`;
    hasEmailHash = Number(cols[0].n) === 1;
  });

  afterAll(async () => {
    await idle();
    await h?.close();
  });

  // ───────────────────────────────────────────── utilidades ─────────────────────────────────────────────

  const nextEmail = (tag = 'u') => `ctag.${RUN}.${tag}${(seq += 1)}@example.com`;
  const nextIp = () => {
    ipSeq += 1;
    return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
  };
  const withIp = (ip?: string) => ({ 'x-forwarded-for': ip ?? nextIp() });
  /** El trabajo de fondo de `forgot-password` (D-CTA-14). En el código de antes no existe y el envío es síncrono. */
  async function idle(): Promise<void> {
    const svc = h?.app.get(AuthService) as unknown as { backgroundIdle?: () => Promise<void> };
    await svc?.backgroundIdle?.();
  }
  async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5_000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`waitFor: ${ms} ms sin cumplirse`);
      await sleep(20);
    }
  }
  /** `{to, path, clear}` de cada correo con enlace desde la posición `from` de la bandeja. */
  const linksSince = (from: number) =>
    bandeja
      .slice(from)
      .map((m) => ({ m, x: LINK_RE.exec(m.text ?? '') }))
      .filter((r): r is { m: MailMessage; x: RegExpExecArray } => r.x !== null)
      .map(({ m, x }) => ({ to: m.to as string, path: x[1], clear: decodeURIComponent(x[2]) }));
  const lastLink = (to: string, path: string) => {
    const l = linksSince(0).filter((x) => x.to === to && x.path === path).pop();
    if (!l) throw new Error(`sin enlace ${path} para ${to}`);
    return l.clear;
  };

  const emailOnly = (email: string, ip?: string) =>
    h.api('POST', '/auth/register/email-only', { json: { email }, headers: withIp(ip) });
  const register = (email: string, password = PASSWORD) =>
    h.api('POST', '/auth/register', { json: { email, password, name: 'Ana Pérez' }, headers: withIp() });
  const patchEmail = (token: string, email: string, ip?: string) =>
    h.api('PATCH', '/users/me/email', { token, json: { email }, headers: withIp(ip) });
  const accountSetup = (json: Record<string, unknown>) => h.api('POST', '/auth/account-setup', { json, headers: withIp() });
  const verifyEmail = (json: Record<string, unknown>) => h.api('POST', '/auth/verify-email', { json, headers: withIp() });
  const resetPassword = (json: Record<string, unknown>) => h.api('POST', '/auth/reset-password', { json, headers: withIp() });
  const forgot = (email: string, ip?: string) => h.api('POST', '/auth/forgot-password', { json: { email }, headers: withIp(ip) });
  const resend = (token: string, ip?: string) => h.api('POST', '/auth/verify-email/resend', { token, headers: withIp(ip) });
  const login = (email: string, password: string) =>
    h.api('POST', '/auth/login', { json: { email, password }, headers: withIp() });
  const me = (token: string) => h.api('GET', '/users/me', { token });
  const userById = (id: string) => h.prisma.user.findUniqueOrThrow({ where: { id } });
  const live = (userId: string, type: AuthTokenType) => h.prisma.authToken.count({ where: { userId, type, usedAt: null } });
  /** `emailHash` de los vivos (solo si la columna existe: antes de M-97 no). */
  async function liveHashes(userId: string, type: AuthTokenType): Promise<(string | null)[]> {
    const rows = await h.prisma.$queryRawUnsafe<{ h: string | null }[]>(
      `SELECT "emailHash" AS h FROM "AuthToken" WHERE "userId" = $1 AND "type" = $2::"AuthTokenType" AND "usedAt" IS NULL`,
      userId,
      type,
    );
    return rows.map((r) => r.h);
  }

  /** Alta con solo el correo ⇒ `{ id, email, access, refresh }`. */
  async function pending(tag: string) {
    const email = nextEmail(tag);
    const r = await emailOnly(email);
    expect([r.status, r.text]).toEqual([201, r.text]);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { email } });
    return { id: u.id, email, access: r.body.accessToken as string, refresh: r.body.refreshToken as string };
  }
  async function withPassword(tag: string, password = PASSWORD) {
    const email = nextEmail(tag);
    const r = await register(email, password);
    expect([r.status, r.text]).toEqual([201, r.text]);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { email } });
    return { id: u.id, email, access: r.body.accessToken as string, refresh: r.body.refreshToken as string };
  }

  // ───────────────────────────────────────────── CTA-B14 ─────────────────────────────────────────────

  describe('CTA-B14 — PT-CTA-1: carrera de correcciones del correo', () => {
    const N = envN('CTA_B14_N', 30);

    /** Una ronda. Devuelve qué invariante rompió (a, b, c, d). */
    async function round(delta: number) {
      const from = bandeja.length;
      const a0 = await pending('b14a');
      const V = nextEmail('b14v');
      const mine = [0, 1, 2, 3].map(() => nextEmail('b14x'));
      const reqs = [
        (async () => {
          if (delta > 0) await sleep(delta);
          return patchEmail(a0.access, V);
        })(),
        ...mine.map((e) => patchEmail(a0.access, e)),
      ];
      const res = await Promise.all(reqs);
      const final = (await userById(a0.id)).email as string;
      // (b) ≤ 1 vivo; (c) el vivo, atado al correo final — se miden ANTES de canjear nada.
      const b = (await live(a0.id, AuthTokenType.account_setup)) > 1;
      const c = hasEmailHash ? (await liveHashes(a0.id, AuthTokenType.account_setup)).some((x) => x !== sha256(final)) : null;
      const d = res.some((r) => r.status >= 500);
      // (a) todo enlace mandado a un correo ≠ final ⇒ 422 y la cuenta sin cambios.
      let a = false;
      for (const l of linksSince(from).filter((x) => x.path === 'account-setup' && x.to !== final)) {
        const r = await accountSetup({ token: l.clear, name: 'Atacante', password: PASSWORD });
        const u = await userById(a0.id);
        if (r.status !== 422 || u.passwordHash !== null || u.emailVerified) a = true;
      }
      return { a, b, c, d, final: final === V ? 'V' : 'A', statuses: res.map((r) => r.status).join('') };
    }

    it.each([0, 10, 25, 50])(`δ=%i ms, N=${N} rondas ⇒ (a)(b)(c)(d) en 0/N`, async (delta) => {
      // `aV` = la forma de PT-CTA-1 que midió el pentester: correo final = V y un enlace mandado a otro buzón canjea.
      const tally = { a: 0, aV: 0, b: 0, c: 0, d: 0, finalV: 0 };
      const codes = new Map<string, number>();
      for (let i = 0; i < N; i += 1) {
        const r = await round(delta);
        if (r.a) tally.a += 1;
        if (r.a && r.final === 'V') tally.aV += 1;
        if (r.b) tally.b += 1;
        if (r.c) tally.c += 1;
        if (r.d) tally.d += 1;
        if (r.final === 'V') tally.finalV += 1;
        codes.set(r.statuses, (codes.get(r.statuses) ?? 0) + 1);
      }
      out(
        `CTA-B14 δ=${delta} N=${N}: (a) enlace ajeno canjea ${tally.a}/${N} [con final=V: ${tally.aV}/${N}] · (b) >1 vivo ${tally.b}/${N} · ` +
          `(c) vivo no atado al final ${hasEmailHash ? `${tally.c}/${N}` : 'n/a (sin columna emailHash)'} · (d) 5xx ${tally.d}/${N} · ` +
          `final=V ${tally.finalV}/${N} · estados ${[...codes].map(([k, v]) => `${k}×${v}`).join(' ')}`,
      );
      expect({ a: tally.a, b: tally.b, d: tally.d }).toEqual({ a: 0, b: 0, d: 0 });
      expect(hasEmailHash).toBe(true);
      expect(tally.c).toBe(0);
    });

    describe('determinista: token emitido a A, correo cambiado a V por escritura directa ⇒ 422 sin escribir (los tres tipos)', () => {
      it('account_setup ⇒ account-setup 422 ACCOUNT_SETUP_TOKEN_INVALID', async () => {
        const p = await pending('b14d1');
        const clear = lastLink(p.email, 'account-setup');
        await h.prisma.user.update({ where: { id: p.id }, data: { email: nextEmail('b14dv') } });
        const r = await accountSetup({ token: clear, name: 'Atacante', password: PASSWORD });
        expect([r.status, r.body?.error?.code]).toEqual([422, 'ACCOUNT_SETUP_TOKEN_INVALID']);
        expect(await userById(p.id)).toMatchObject({ passwordHash: null, emailVerified: false });
        expect(await live(p.id, AuthTokenType.account_setup)).toBe(1);
      });

      it('password_reset ⇒ reset-password 422 RESET_TOKEN_INVALID', async () => {
        const w = await withPassword('b14d2');
        const before = await userById(w.id);
        expect((await forgot(w.email)).status).toBe(200);
        await idle();
        const clear = await waitFor(async () => linksSince(0).find((l) => l.to === w.email && l.path === 'reset-password')?.clear);
        await h.prisma.user.update({ where: { id: w.id }, data: { email: nextEmail('b14dv') } });
        const r = await resetPassword({ token: clear, password: 'OtraClave123' });
        expect([r.status, r.body?.error?.code]).toEqual([422, 'RESET_TOKEN_INVALID']);
        const after = await userById(w.id);
        expect(after.passwordHash).toBe(before.passwordHash);
        expect(after.tokenVersion).toBe(before.tokenVersion);
        expect(after.emailVerified).toBe(false);
      });

      it('email_verification ⇒ verify-email 422 EMAIL_VERIFY_TOKEN_INVALID (con `password` y con `newPassword`)', async () => {
        const w = await withPassword('b14d3');
        const before = await userById(w.id);
        const clear = lastLink(w.email, 'verify-email');
        await h.prisma.user.update({ where: { id: w.id }, data: { email: nextEmail('b14dv') } });
        const r1 = await verifyEmail({ token: clear, password: PASSWORD });
        expect([r1.status, r1.body?.error?.code]).toEqual([422, 'EMAIL_VERIFY_TOKEN_INVALID']);
        const r2 = await verifyEmail({ token: clear, newPassword: 'OtraClave123' });
        expect([r2.status, r2.body?.error?.code]).toEqual([422, 'EMAIL_VERIFY_TOKEN_INVALID']);
        const after = await userById(w.id);
        expect(after).toMatchObject({ emailVerified: false, passwordHash: before.passwordHash, tokenVersion: before.tokenVersion });
      });
    });
  });

  // ───────────────────────────────────────────── CTA-B14r ─────────────────────────────────────────────

  it('CTA-B14r — 10 resend + 10 forgot-password a la vez (cuenta con contraseña sin verificar) ⇒ ≤ 1 vivo por tipo y sin 5xx, N=30', async () => {
    const N = envN('CTA_B14R_N', 30);
    let multi = 0;
    let fivexx = 0;
    for (let i = 0; i < N; i += 1) {
      const w = await withPassword('b14r');
      const res = await Promise.all([
        ...Array.from({ length: 10 }, () => resend(w.access)),
        ...Array.from({ length: 10 }, () => forgot(w.email)),
      ]);
      await idle();
      const lv = await live(w.id, AuthTokenType.email_verification);
      const lr = await live(w.id, AuthTokenType.password_reset);
      if (lv > 1 || lr > 1) multi += 1;
      if (res.some((r) => r.status >= 500)) fivexx += 1;
    }
    out(`CTA-B14r N=${N}: >1 vivo por tipo ${multi}/${N} · 5xx ${fivexx}/${N}`);
    expect({ multi, fivexx }).toEqual({ multi: 0, fivexx: 0 });
  });

  // ───────────────────────────────────────────── CTA-B15 ─────────────────────────────────────────────

  describe('CTA-B15 — PT-CTA-2 (AUTH-PRE-2): verify-email pide la credencial', () => {
    /** Vía (1) `register(V, Pa)`; vía (2) email-only V + `set-password(Pa)`. Devuelve la sesión del atacante. */
    async function viaRegister() {
      const w = await withPassword('b15r', 'AtacanteClave1');
      return { ...w, pa: 'AtacanteClave1' };
    }
    async function viaSetPassword() {
      const p = await pending('b15s');
      const s = await h.api('POST', '/auth/set-password', { token: p.access, json: { newPassword: 'AtacanteClave1' } });
      expect([s.status, s.text]).toEqual([200, s.text]);
      return { id: p.id, email: p.email, access: s.body.accessToken as string, refresh: s.body.refreshToken as string, pa: 'AtacanteClave1' };
    }

    it.each([
      ['register(V, Pa)', viaRegister],
      ['email-only V + set-password(Pa)', viaSetPassword],
    ])('%s ⇒ {token} 400; {token, password: otra} 401; {token, newPassword} 200 y el atacante fuera (re-login 401)', async (_via, make) => {
      const atk = await make();
      const from = bandeja.length;
      const rs = await resend(atk.access);
      expect([rs.status, rs.body]).toEqual([200, { ok: true }]);
      const sent = linksSince(from).filter((l) => l.to === atk.email);
      expect(sent.map((l) => l.path)).toEqual(['verify-email']);
      const token = sent[0].clear;
      const hashOf = async () => h.prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });

      // {token} solo ⇒ 400 sin tocar el token.
      const r0 = await verifyEmail({ token });
      expect([r0.status, r0.body?.error?.code]).toEqual([400, 'VALIDATION_ERROR']);
      expect((await hashOf()).usedAt).toBeNull();
      // Los dos a la vez ⇒ 400 sin tocar el token.
      const r0b = await verifyEmail({ token, password: atk.pa, newPassword: 'DuenoReal123' });
      expect(r0b.status).toBe(400);
      expect((await hashOf()).usedAt).toBeNull();
      // Contraseña equivocada ⇒ 401, sin verificar, token vivo.
      const r1 = await verifyEmail({ token, password: 'NoEsLaMia123' });
      expect([r1.status, r1.body?.error?.code]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect((await userById(atk.id)).emailVerified).toBe(false);
      expect((await hashOf()).usedAt).toBeNull();

      // El dueño del buzón no sabe la contraseña: fija otra.
      const before = await userById(atk.id);
      const r2 = await verifyEmail({ token, newPassword: 'DuenoReal123' });
      expect([r2.status, r2.text]).toEqual([200, r2.text]);
      expect(Object.keys(r2.body).sort()).toEqual(['deviceToken', 'verified']);
      expect(r2.body.verified).toBe(true);
      const after = await userById(atk.id);
      expect(after.emailVerified).toBe(true);
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
      expect((await me(atk.access)).status).toBe(401);
      expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: atk.refresh } })).status).toBe(401);
      // El re-login del creador con SU contraseña ⇒ 401 (el candado viejo de §16.5 no lo miraba).
      const l1 = await login(atk.email, atk.pa);
      expect([l1.status, l1.body?.error?.code]).toEqual([401, 'INVALID_CREDENTIALS']);
      const l2 = await login(atk.email, 'DuenoReal123');
      expect(l2.status).toBe(200);
      // `newPassword` con un token usado ⇒ 422 (no hace creer que fijó otra contraseña).
      const r3 = await verifyEmail({ token, newPassword: 'OtraMas12345' });
      expect([r3.status, r3.body?.error?.code]).toEqual([422, 'EMAIL_VERIFY_TOKEN_INVALID']);
    });

    it('legítimo: register(E, P) + {token, password: P} ⇒ 200 {verified}; tokenVersion igual; su sesión sigue; doble clic 200', async () => {
      const w = await withPassword('b15l');
      const token = lastLink(w.email, 'verify-email');
      const before = await userById(w.id);
      const r = await verifyEmail({ token, password: PASSWORD });
      expect([r.status, r.body]).toEqual([200, { verified: true }]);
      const after = await userById(w.id);
      expect(after.emailVerified).toBe(true);
      expect(after.tokenVersion).toBe(before.tokenVersion);
      expect(after.passwordHash).toBe(before.passwordHash);
      expect((await me(w.access)).status).toBe(200);
      // Doble clic (modo `password`): token usado de una cuenta ya verificada ⇒ 200 sin escribir.
      const again = await verifyEmail({ token, password: PASSWORD });
      expect([again.status, again.body]).toEqual([200, { verified: true }]);
    });
  });

  // ───────────────────────────────────────────── CTA-B16 ─────────────────────────────────────────────

  describe('CTA-B16 — PT-CTA-4: el tope 3/h se cuenta dentro del candado', () => {
    const N = envN('CTA_B16_N', 30);
    it.each([5, 20])(`K=%i PATCH a la vez, IPs distintas, N=${N} ⇒ exactamente 2 × 200, 3 emitidos, 3 correos`, async (K) => {
      let bad = 0;
      const seen = new Map<string, number>();
      for (let i = 0; i < N; i += 1) {
        const from = bandeja.length;
        const p = await pending('b16');
        const targets = Array.from({ length: K }, () => nextEmail('b16t'));
        const res = await Promise.all(targets.map((e) => patchEmail(p.access, e)));
        const ok = res.filter((r) => r.status === 200).length;
        const limited = res.filter((r) => r.status === 429 && r.body?.error?.code === 'RATE_LIMITED').length;
        const issued = await h.prisma.authToken.count({
          where: { userId: p.id, type: AuthTokenType.account_setup, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
        });
        const mails = linksSince(from).filter((l) => l.path === 'account-setup').length;
        const key = `200×${ok} 429×${limited} emit=${issued} mails=${mails}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (!(ok === 2 && limited === K - 2 && issued === 3 && mails === 3)) bad += 1;
      }
      out(`CTA-B16 K=${K} N=${N}: fuera de norma ${bad}/${N} · ${[...seen].map(([k, v]) => `${k} (${v})`).join(' | ')}`);
      expect(bad).toBe(0);
    });
  });

  // ───────────────────────────────────────────── CTA-B18 ─────────────────────────────────────────────

  describe('CTA-B18 — PT-CTA-5: forgot-password responde antes de buscar la cuenta', () => {
    /**
     * Promesa colgada que la prueba SUELTA al terminar (rechazándola): con el arreglo, el trabajo de fondo queda esperándola, y
     * sin soltarla `backgroundIdle()` (afterAll) esperaría para siempre.
     */
    const pendingHangs: ((e: Error) => void)[] = [];
    const hang = () => new Promise<never>((_resolve, reject) => pendingHangs.push(reject));
    const releaseHangs = () => {
      for (const r of pendingHangs.splice(0)) r(new Error('colgado soltado por la prueba'));
    };
    afterEach(async () => {
      releaseHangs();
      await idle();
    });
    const within = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, sleep(ms).then(() => 'TIMEOUT' as const)]);

    it('con user.findUnique colgado: el servicio responde {ok} sin haber consultado; la búsqueda corre después', async () => {
      const prisma = h.app.get(PrismaService);
      const svc = h.app.get(AuthService);
      const spy = jest.spyOn(prisma.user, 'findUnique').mockImplementation(hang as never);
      try {
        const res = await within(svc.forgotPassword(nextEmail('b18a'), '10.18.0.1'), 2_000);
        const callsAtResponse = spy.mock.calls.length;
        expect(res).toEqual({ ok: true });
        expect(callsAtResponse).toBe(0);
        await waitFor(async () => spy.mock.calls.length > 0, 2_000);
      } finally {
        spy.mockRestore();
      }
    });

    it('por HTTP con la búsqueda y el adaptador de correo colgados ⇒ 200 {ok:true} igual', async () => {
      const prisma = h.app.get(PrismaService);
      const port = h.app.get<MailPort>(MAIL_PORT);
      const w = await withPassword('b18h');
      const sendSpy = jest.spyOn(port, 'send').mockImplementation(hang as never);
      try {
        const r1 = await within(forgot(w.email), 3_000);
        expect(r1 === 'TIMEOUT' ? 'TIMEOUT' : [r1.status, r1.body]).toEqual([200, { ok: true }]);
        const spy = jest.spyOn(prisma.user, 'findUnique').mockImplementation(hang as never);
        try {
          const r2 = await within(forgot(nextEmail('b18x')), 3_000);
          expect(r2 === 'TIMEOUT' ? 'TIMEOUT' : [r2.status, r2.body]).toEqual([200, { ok: true }]);
        } finally {
          spy.mockRestore();
        }
      } finally {
        sendSpy.mockRestore();
        jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
          bandeja.push(msg);
          return {};
        });
      }
    });

    it('un fallo del trabajo de fondo se registra sin el correo ni el token', async () => {
      const prisma = h.app.get(PrismaService);
      const svc = h.app.get(AuthService);
      const email = nextEmail('b18f');
      const errors: string[] = [];
      const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
      });
      const spy = jest.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error(`db caída buscando ${email}`) as never);
      try {
        const res = await within(svc.forgotPassword(email, '10.18.0.2'), 2_000);
        expect(res).toEqual({ ok: true });
        await idle();
        await waitFor(async () => errors.length > 0, 2_000);
        const all = errors.join('\n');
        expect(all).toMatch(/forgot-password/);
        expect(all).not.toContain(email);
        expect(all).not.toMatch(/token=/);
      } finally {
        spy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });
});
