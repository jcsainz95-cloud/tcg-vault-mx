/**
 * staff-without-email.e2e-spec.ts — v1.80.9, usuarios de back-office SIN correo (`API_CONTRACT §M6-U`,
 * `ARCHITECTURE §4.58`, `PROJECT §U` criterios 256–270), punta a punta: app REAL de Nest, Postgres real (con la
 * migración M-63 aplicada), HTTP real. Pruebas `STF-*` de §M6-U.9 que viven aquí: 1–8, 10–15, 17, 18, 20, 23, 24,
 * 26–28, 30. Las de carrera (STF-6, STF-20) corren R = 10 rondas × N = 10 peticiones simultáneas y AFIRMAN 10/10.
 * Las demás piezas: `test/stf.*.spec.ts` (unitarias), `staff-throttle.e2e-spec.ts` (STF-21) y
 * `m63-migration.e2e-spec.ts` (STF-25).
 *
 * Identificadores aleatorios por corrida: la BD de la suite sobrevive entre corridas.
 */
import { randomBytes, randomUUID } from 'crypto';
import { AuthTokenType, Role, UserStatus } from '@prisma/client';

jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { LOGIN_ATTEMPT_STORE, LoginAttemptStore } from '../../src/modules/auth/login-attempt.store';

jest.setTimeout(300_000);

const verifySpy = argon2.verify as unknown as jest.Mock;
const BAD = 'mala-STF-000';
const NEW_PW = 'Nueva-STF-12345';

/** Nombre de usuario canónico y único por corrida: empieza con letra, minúsculas, ≤ 30. */
const uname = (p: string) => `${p}${randomBytes(5).toString('hex')}`.slice(0, 30);

describe('E2E — v1.80.9: usuarios de back-office sin correo (STF)', () => {
  let h: E2EHarness;
  let adminTok: string;
  let opTok: string;
  let opId: string;
  let mailSpy: jest.SpyInstance;
  let ip = 0;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminTok = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    opTok = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    opId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } })).id;
    const port = h.app.get<MailPort>(MAIL_PORT);
    mailSpy = jest.spyOn(port, 'send').mockImplementation(async (_m: MailMessage) => ({}));
  });

  afterAll(async () => {
    mailSpy?.mockRestore();
    await h?.close();
  });

  beforeEach(() => {
    mailSpy.mockClear();
    verifySpy.mockClear();
  });

  /** Cada intento desde una IP «distinta» (el throttle por IP no participa: está fuera bajo la suite). */
  function login(identifier: string, password: string) {
    ip += 1;
    return h.api('POST', '/auth/login', {
      json: { email: identifier, password },
      headers: { 'x-forwarded-for': `10.77.${(ip >> 8) & 255}.${ip & 255}` },
    });
  }

  function createUser(body: Record<string, unknown>, token = adminTok) {
    return h.api('POST', '/admin/users', { json: body, token });
  }

  /** Alta de staff sin correo por API; devuelve fila + contraseña temporal. */
  async function staff(prefix = 'ana', role: Role = Role.vault_operator) {
    const username = uname(prefix);
    const r = await createUser({ name: `STF ${prefix}`, username, role });
    expect([r.status, r.text]).toEqual([201, r.text]);
    return { id: r.body.user.id as string, username, temp: r.body.tempPassword as string };
  }

  /** Staff sin correo con la temporal YA cambiada: sesión utilizable fuera de la allowlist. */
  async function activeStaff(prefix = 'ana', role: Role = Role.vault_operator) {
    const s = await staff(prefix, role);
    const l = await login(s.username, s.temp);
    expect(l.status).toBe(200);
    const c = await h.api('POST', '/auth/change-password', {
      json: { currentPassword: s.temp, newPassword: NEW_PW },
      token: l.body.accessToken,
    });
    expect(c.status).toBe(200);
    return { ...s, password: NEW_PW, token: c.body.accessToken as string };
  }

  async function lock(identifier: string) {
    for (let i = 0; i < 5; i++) expect((await login(identifier, BAD)).status).toBe(401);
    expect((await login(identifier, BAD)).status).toBe(429);
  }

  async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 50));
      v = await fn();
    }
    return v;
  }

  const settle = () => new Promise((r) => setTimeout(r, 300));

  // ───────────────────────────────────────────── 256: alta ─────────────────────────────────────────────

  it('STF-1 — alta de staff sin correo: 201, email null, username, mustChangePassword, temporal; BD y bitácora', async () => {
    const username = uname('ana');
    const r = await createUser({ name: 'Ana Staff', username, role: 'vault_operator' });
    expect(r.status).toBe(201);
    expect(r.body.user.email).toBeNull();
    expect(r.body.user.username).toBe(username);
    expect(r.body.mustChangePassword).toBe(true);
    expect(typeof r.body.tempPassword).toBe('string');
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: r.body.user.id } });
    expect(row.email).toBeNull();
    expect(row.emailVerified).toBe(false);
    const audit = await h.prisma.auditLog.findMany({ where: { action: 'user.create', entityId: r.body.user.id } });
    expect(audit).toHaveLength(1);
    const after = audit[0].after as Record<string, unknown>;
    expect(after.username).toBe(username);
    expect(after.hasEmail).toBe(false);
    expect(Object.keys(after).filter((k) => /password/i.test(k) && k !== 'mustChangePassword')).toEqual([]);
    expect(JSON.stringify(after)).not.toContain(r.body.tempPassword);
  });

  it('STF-2 — staff con correo ⇒ 422 email; cliente con usuario ⇒ 422 username; cliente sin correo ⇒ 422; super_admin sin correo ⇒ 201', async () => {
    const withEmail = await createUser({ name: 'X', email: `stf2_${randomUUID().slice(0, 8)}@e2e.local`, username: uname('x'), role: 'vault_operator' });
    expect(withEmail.status).toBe(422);
    expect(withEmail.body.error.code).toBe('VALIDATION_ERROR');
    expect(withEmail.body.error.details).toMatchObject({ field: 'email', rule: 'staff_without_email' });
    const onlyEmail = await createUser({ name: 'X', email: `stf2_${randomUUID().slice(0, 8)}@e2e.local`, role: 'super_admin' });
    expect(onlyEmail.status).toBe(422);
    expect(onlyEmail.body.error.details.field).toBe('email');
    const custUser = await createUser({ name: 'X', email: `stf2_${randomUUID().slice(0, 8)}@e2e.local`, username: uname('c'), role: 'customer' });
    expect(custUser.status).toBe(422);
    expect(custUser.body.error.details.field).toBe('username');
    const custNoEmail = await createUser({ name: 'X', role: 'customer' });
    expect(custNoEmail.status).toBe(422);
    const sa = await createUser({ name: 'Super STF', username: uname('sa'), role: 'super_admin' });
    expect(sa.status).toBe(201);
    expect(sa.body.user.email).toBeNull();
    expect(sa.body.user.role).toBe('super_admin');
  });

  it('STF-3 — vault_operator POST /admin/users ⇒ 403 FORBIDDEN, una fila user.admin_action_denied, cero User', async () => {
    const username = uname('den');
    const before = await h.prisma.auditLog.count({ where: { action: 'user.admin_action_denied', actorUserId: opId } });
    const r = await createUser({ name: 'X', username, role: 'vault_operator' }, opTok);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    const rows = await h.prisma.auditLog.findMany({
      where: { action: 'user.admin_action_denied', actorUserId: opId },
      orderBy: { createdAt: 'desc' },
    });
    expect(rows.length).toBe(before + 1);
    expect(rows[0].actorRole).toBe('vault_operator');
    expect(rows[0].entityType).toBe('User');
    expect(rows[0].entityId).toBeNull();
    expect(rows[0].after).toEqual({ attempted: 'create' });
    expect(await h.prisma.user.count({ where: { username } })).toBe(0);
  });

  it('STF-4 — los CHECK de M-63 en SQL directo', async () => {
    const ins = (email: string | null, username: string | null, role: string, verified = false) =>
      h.prisma.$executeRawUnsafe(
        `INSERT INTO "User" ("id","email","username","name","role","emailVerified","updatedAt") VALUES ($1,$2,$3,'STF4',$4::"Role",$5,now())`,
        randomUUID(),
        email,
        username,
        role,
        verified,
      );
    const mail = () => `stf4_${randomUUID().slice(0, 8)}@e2e.local`;
    await expect(ins(null, null, 'customer')).rejects.toThrow(/user_customer_has_email|user_login_identity_xor/);
    await expect(ins(null, uname('c'), 'customer')).rejects.toThrow(/user_customer_has_email/);
    await expect(ins(mail(), uname('b'), 'vault_operator')).rejects.toThrow(/user_login_identity_xor/);
    await expect(ins(null, `Ana${randomBytes(3).toString('hex')}`, 'vault_operator')).rejects.toThrow(/user_username_canonical/);
    await expect(ins(null, uname('v'), 'vault_operator', true)).rejects.toThrow(/user_no_email_unverified/);
    const okId = randomUUID();
    await h.prisma.$executeRawUnsafe(
      `INSERT INTO "User" ("id","username","name","role","updatedAt") VALUES ($1,$2,'STF4','vault_operator',now())`,
      okId,
      uname('ok'),
    );
    await expect(
      h.prisma.$executeRawUnsafe(`UPDATE "User" SET "email"=$2, "username"=NULL, "lockNoticeAt"=now() WHERE "id"=$1`, okId, mail()),
    ).rejects.toThrow(/user_lock_notice_no_email/);
  });

  // ───────────────────────────────────────────── 257: forma y unicidad ─────────────────────────────────

  it('STF-5 — tabla de nombres de usuario: aceptan / rechazan con details.rule; mayúsculas ⇒ 409; canónico', async () => {
    const sfx = randomBytes(3).toString('hex'); // 6 car.
    const accept = [`ana${sfx}`, `luis.p${sfx}`, `op_2${sfx}`, `m-r${sfx}`, `a${sfx}${'x'.repeat(23)}`];
    expect(accept[4]).toHaveLength(30);
    for (const u of accept) {
      const r = await createUser({ name: 'T', username: u, role: 'vault_operator' });
      expect([u, r.status]).toEqual([u, 201]);
      expect(r.body.user.username).toBe(u);
    }
    const reject: [string, string][] = [
      ['ab', 'length'],
      [`a${'b'.repeat(30)}`, 'length'],
      ['a b', 'charset'],
      ['a@b', 'charset'],
      ['josé', 'charset'],
      ['niño', 'charset'],
      ['1ab', 'start'],
      ['.ab', 'start'],
      ['-ab', 'start'],
      ['_ab', 'start'],
      ['', 'required'],
    ];
    for (const [u, rule] of reject) {
      const r = await createUser({ name: 'T', username: u, role: 'vault_operator' });
      expect([u, r.status, r.body.error?.details?.rule, r.body.error?.details?.field]).toEqual([u, 422, rule, 'username']);
    }
    expect(await h.prisma.user.count({ where: { username: { in: reject.map(([u]) => u) } } })).toBe(0);
    const luis = `luis.p${sfx}`;
    for (const variant of [`Luis.P${sfx}`, `LUIS.P${sfx.toUpperCase()}`]) {
      const r = await createUser({ name: 'T', username: variant, role: 'vault_operator' });
      expect([variant, r.status, r.body.error?.code]).toEqual([variant, 409, 'USERNAME_TAKEN']);
    }
    expect(await h.prisma.user.count({ where: { username: luis } })).toBe(1);
    const q = await createUser({ name: 'T', username: `Luis.Q${sfx}`, role: 'vault_operator' });
    expect(q.status).toBe(201);
    expect(q.body.user.username).toBe(`luis.q${sfx}`);
  });

  it('STF-6 — carrera: 10 altas simultáneas del mismo usuario con mayúsculas variadas ⇒ 1×201 + 9×409; R = 10 ⇒ 10/10', async () => {
    const R = 10;
    const N = 10;
    let green = 0;
    const report: string[] = [];
    for (let round = 0; round < R; round++) {
      const base = uname('rafa');
      const variants = Array.from({ length: N }, (_, i) =>
        base
          .split('')
          .map((c, j) => ((i >> j % 4) & 1 ? c.toUpperCase() : c))
          .join(''),
      );
      const res = await Promise.all(variants.map((u) => createUser({ name: 'Rafa', username: u, role: 'vault_operator' })));
      const created = res.filter((r) => r.status === 201).length;
      const taken = res.filter((r) => r.status === 409 && r.body.error.code === 'USERNAME_TAKEN').length;
      const rows = await h.prisma.user.count({ where: { username: base } });
      const ok = created === 1 && taken === N - 1 && rows === 1;
      if (ok) green += 1;
      report.push(`r${round}:${created}/${taken}/${rows}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[STF-6] rondas verdes ${green}/${R} — ${report.join(' ')}`);
    expect(green).toBe(R);
  });

  // ───────────────────────────────────────────── 258: entrar ─────────────────────────────────────────────

  it('STF-7 — login con el usuario en MAYÚSCULAS ⇒ 200 (username, email null, rol); tras cambiar la temporal, GET /admin/users ⇒ 200', async () => {
    const s = await staff('ana');
    const r = await login(s.username.toUpperCase(), s.temp);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: s.username, email: null, role: 'vault_operator', mustChangePassword: true });
    const c = await h.api('POST', '/auth/change-password', { json: { currentPassword: s.temp, newPassword: NEW_PW }, token: r.body.accessToken });
    expect(c.status).toBe(200);
    expect((await h.api('GET', '/admin/users', { token: c.body.accessToken })).status).toBe(200);
  });

  it('STF-8 — register con "ana" ⇒ 400 y cero filas; un cliente entra por correo igual que hoy', async () => {
    const name = uname('ana');
    const r = await h.api('POST', '/auth/register', { json: { email: name, password: 'Password123!', name: 'Ana' } });
    expect(r.status).toBe(400);
    expect(await h.prisma.user.count({ where: { OR: [{ email: name }, { username: name }] } })).toBe(0);
    const c = await login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    expect(c.status).toBe(200);
    expect(c.body.user.email).toBe(E2E_USERS.customer.email);
    expect(c.body.user.username).toBeNull();
  });

  // ───────────────────────────────────────────── 259: cero enumeración ──────────────────────────────────

  it('STF-10 — cinco casos × 6 intentos ⇒ la misma secuencia 401×5, 429; cuerpos idénticos; mismo Retry-After', async () => {
    const existing = await staff('enu');
    const disabled = await staff('dis');
    await h.prisma.user.update({ where: { id: disabled.id }, data: { status: UserStatus.blocked } });
    const emailUser = await h.prisma.user.create({
      data: { email: `stf10_${randomUUID().slice(0, 8)}@e2e.local`, name: 'C', role: Role.customer, passwordHash: await argon2.hash('Algo-123456'), emailVerified: true },
    });
    const kinds: Record<string, string> = {
      usernameExisting: existing.username,
      usernameMissing: uname('nadie'),
      usernameDisabled: disabled.username,
      emailMissing: `stf10_nadie_${randomUUID().slice(0, 8)}@e2e.local`,
      emailExisting: emailUser.email!,
    };
    const seqs: Record<string, unknown[]> = {};
    for (const [k, id] of Object.entries(kinds)) {
      const s: unknown[] = [];
      for (let i = 0; i < 6; i++) {
        const before = verifySpy.mock.calls.length;
        const r = await login(id, BAD);
        s.push({ status: r.status, body: r.text, retryAfter: r.headers['retry-after'] ?? null, argon2: verifySpy.mock.calls.length - before });
      }
      seqs[k] = s;
    }
    const ref = seqs.emailExisting as { status: number }[];
    expect(ref.map((x) => x.status)).toEqual([401, 401, 401, 401, 401, 429]);
    for (const k of Object.keys(kinds)) expect([k, seqs[k]]).toEqual([k, seqs.emailExisting]);
  });

  it('STF-11 — argon2.verify: usuario inexistente ⇒ 1 llamada con el hash dummy; usuario existente ⇒ 1 con su hash', async () => {
    const s = await staff('arg');
    verifySpy.mockClear();
    await login(`stf11nadie@e2e.local`, BAD);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const dummy = verifySpy.mock.calls[0][0];
    verifySpy.mockClear();
    await login(uname('nadie'), BAD);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy.mock.calls[0][0]).toBe(dummy);
    expect(String(dummy).startsWith('$argon2id$')).toBe(true);
    verifySpy.mockClear();
    await login(s.username, BAD);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(verifySpy.mock.calls[0][0]).toBe(row.passwordHash);
  });

  it('STF-12 — forgot-password con un usuario existente ⇒ 200 {ok:true}, cero AuthToken, cero correos, mismo cuerpo que un correo inexistente', async () => {
    const s = await staff('fgt');
    const a = await h.api('POST', '/auth/forgot-password', { json: { email: s.username } });
    const b = await h.api('POST', '/auth/forgot-password', { json: { email: `nadie_${randomUUID().slice(0, 8)}@x.com` } });
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ ok: true });
    expect(a.text).toBe(b.text);
    expect(await h.prisma.authToken.count({ where: { userId: s.id } })).toBe(0);
    await settle();
    expect(mailSpy).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────── 260/261: temporal y reset ─────────────────────────────

  it('STF-13 — contraseña TECLEADA en el alta ⇒ mustChangePassword siempre; 403 hasta cambiarla; luego la inicial ⇒ 401', async () => {
    const username = uname('tec');
    const initial = 'Tecleada-STF-123';
    const r = await createUser({ name: 'T', username, role: 'vault_operator', password: initial });
    expect(r.status).toBe(201);
    expect(r.body.mustChangePassword).toBe(true);
    expect(r.body.tempPassword).toBeUndefined();
    const l = await login(username, initial);
    expect(l.status).toBe(200);
    expect(l.body.user.mustChangePassword).toBe(true);
    const blocked = await h.api('GET', '/admin/users', { token: l.body.accessToken });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const c = await h.api('POST', '/auth/change-password', { json: { currentPassword: initial, newPassword: NEW_PW }, token: l.body.accessToken });
    expect(c.status).toBe(200);
    expect((await h.api('GET', '/admin/users', { token: c.body.accessToken })).status).toBe(200);
    expect((await login(username, initial)).status).toBe(401);
  });

  it('STF-14 — reset por super_admin de una cuenta sin correo con candado y sesión: temporal ⇒ 200 (no 429), sesión vieja ⇒ 401, cero correos, bitácora sin contraseña', async () => {
    const s = await activeStaff('rst');
    await lock(s.username);
    const r = await h.api('POST', `/admin/users/${s.id}/reset-password`, { token: adminTok });
    expect(r.status).toBe(200);
    const temp = r.body.tempPassword as string;
    expect((await h.api('GET', '/users/me', { token: s.token })).status).toBe(401);
    const l = await login(s.username, temp);
    expect(l.status).toBe(200);
    expect(l.body.user.mustChangePassword).toBe(true);
    expect((await login(s.username, s.password)).status).toBe(401);
    await settle();
    expect(mailSpy).not.toHaveBeenCalled();
    const audit = await h.prisma.auditLog.findMany({ where: { action: 'user.reset_password', entityId: s.id } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(temp);
  });

  it('STF-15 — vault_operator reset-password ⇒ 403 + fila user.admin_action_denied {attempted:reset_password}; el hash no cambia', async () => {
    const s = await staff('rsd');
    const hash0 = (await h.prisma.user.findUniqueOrThrow({ where: { id: s.id } })).passwordHash;
    const r = await h.api('POST', `/admin/users/${s.id}/reset-password`, { token: opTok });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    const rows = await h.prisma.auditLog.findMany({ where: { action: 'user.admin_action_denied', entityId: s.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: opId, actorRole: 'vault_operator', entityType: 'User' });
    expect(rows[0].after).toEqual({ attempted: 'reset_password' });
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: s.id } })).passwordHash).toBe(hash0);
  });

  // ───────────────────────────────────────────── 263: cambio propio ────────────────────────────────────

  it('STF-17 — change-password de una cuenta sin correo: 422 mala/igual (sesión sigue); buena ⇒ 200 y la otra sesión ⇒ 401; nueva entra, vieja no; cero correos', async () => {
    const s = await activeStaff('chg');
    const other = await login(s.username, s.password);
    expect(other.status).toBe(200);
    const bad = await h.api('POST', '/auth/change-password', { json: { currentPassword: 'no-es-STF-999', newPassword: 'Otra-STF-98765' }, token: s.token });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect((await h.api('GET', '/users/me', { token: s.token })).status).toBe(200);
    const same = await h.api('POST', '/auth/change-password', { json: { currentPassword: s.password, newPassword: s.password }, token: s.token });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe('PASSWORD_SAME_AS_CURRENT');
    const good = await h.api('POST', '/auth/change-password', { json: { currentPassword: s.password, newPassword: 'Otra-STF-98765' }, token: s.token });
    expect(good.status).toBe(200);
    expect(typeof good.body.accessToken).toBe('string');
    expect((await h.api('GET', '/users/me', { token: other.body.accessToken })).status).toBe(401);
    expect((await h.api('GET', '/users/me', { token: good.body.accessToken })).status).toBe(200);
    expect((await login(s.username, 'Otra-STF-98765')).status).toBe(200);
    expect((await login(s.username, s.password)).status).toBe(401);
    await settle();
    expect(mailSpy).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────── 264: candado ──────────────────────────────────────────

  it('STF-18 — 3 fallos con "Ana…" + 2 con "ana…" ⇒ el 6.º, incluso con la contraseña correcta ⇒ 429', async () => {
    const s = await staff('ana');
    const upper = s.username.charAt(0).toUpperCase() + s.username.slice(1);
    for (let i = 0; i < 3; i++) expect((await login(upper, BAD)).status).toBe(401);
    for (let i = 0; i < 2; i++) expect((await login(s.username, BAD)).status).toBe(401);
    const sixth = await login(s.username, s.temp);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('TOO_MANY_PASSWORD_ATTEMPTS');
  });

  it('STF-20 — carrera: 10 intentos simultáneos con clave mala ⇒ exactamente 5 argon2 y 5×401 + 5×429; R = 10 ⇒ 10/10', async () => {
    const R = 10;
    const N = 10;
    let green = 0;
    const report: string[] = [];
    for (let round = 0; round < R; round++) {
      const s = await staff('car');
      verifySpy.mockClear();
      const res = await Promise.all(Array.from({ length: N }, () => login(s.username, BAD)));
      const c401 = res.filter((r) => r.status === 401).length;
      const c429 = res.filter((r) => r.status === 429).length;
      const calls = verifySpy.mock.calls.length;
      if (c401 === 5 && c429 === 5 && calls === 5) green += 1;
      report.push(`r${round}:${c401}/${c429}/${calls}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[STF-20] rondas verdes ${green}/${R} — ${report.join(' ')}`);
    expect(green).toBe(R);
  });

  // ───────────────────────────────────────────── 265: aviso y marca ────────────────────────────────────

  it('STF-23 — candado sobre una cuenta sin correo: panel (no correo), dismiss, tope 24 h; con correo ⇒ 1 correo; inexistente ⇒ nada', async () => {
    const s = await activeStaff('lck');
    await lock(s.username);
    const row = await waitFor(
      () => h.prisma.user.findUniqueOrThrow({ where: { id: s.id } }),
      (u) => u.lockNoticeAt !== null,
    );
    expect(row.lockNoticeAt).not.toBeNull();
    await settle();
    expect(mailSpy).not.toHaveBeenCalled();
    const me = await h.api('GET', '/users/me', { token: s.token });
    expect(me.status).toBe(200);
    expect(me.body.lockNotice).toEqual({ since: row.lockNoticeAt!.toISOString() });
    expect(me.body.username).toBe(s.username);
    expect(me.body.email).toBeNull();
    // §42.10 A-2 (ux-ui): el candado aparece en el historial `scope=target` de esa persona.
    const hist = await waitFor(
      () => h.api('GET', `/admin/users/${s.id}/audit?scope=target`, { token: adminTok }),
      (r) => JSON.stringify(r.body).includes('auth.password_lock'),
    );
    expect(hist.status).toBe(200);
    expect(JSON.stringify(hist.body)).toContain('auth.password_lock');
    const d = await h.api('POST', '/users/me/lock-notice/dismiss', { token: s.token });
    expect(d.status).toBe(204);
    expect((await h.api('POST', '/users/me/lock-notice/dismiss', { token: s.token })).status).toBe(204);
    expect((await h.api('GET', '/users/me', { token: s.token })).body.lockNotice).toBeNull();
    // Segundo candado en < 24 h (el reset limpia el cubo, no el tope del aviso) ⇒ sin aviso nuevo.
    expect((await h.api('POST', `/admin/users/${s.id}/reset-password`, { token: adminTok })).status).toBe(200);
    await lock(s.username);
    await settle();
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: s.id } })).lockNoticeAt).toBeNull();

    // Staff CON correo ⇒ 1 correo, sin aviso de panel (P-STF-5).
    const withEmail = await h.prisma.user.create({
      data: { email: `stf23_${randomUUID().slice(0, 8)}@e2e.local`, name: 'Op', role: Role.vault_operator, passwordHash: await argon2.hash('Algo-123456'), emailVerified: true },
    });
    mailSpy.mockClear();
    await lock(withEmail.email!);
    await waitFor(async () => mailSpy.mock.calls.length, (n) => n >= 1);
    await settle();
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect((mailSpy.mock.calls[0][0] as MailMessage).to).toBe(withEmail.email);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: withEmail.id } })).lockNoticeAt).toBeNull();

    // Usuario inexistente ⇒ ni bitácora ni escrituras.
    const locks0 = await h.prisma.auditLog.count({ where: { action: 'auth.password_lock' } });
    const notices0 = await h.prisma.user.count({ where: { lockNoticeAt: { not: null } } });
    await lock(uname('nadie'));
    await settle();
    expect(await h.prisma.auditLog.count({ where: { action: 'auth.password_lock' } })).toBe(locks0);
    expect(await h.prisma.user.count({ where: { lockNoticeAt: { not: null } } })).toBe(notices0);
  });

  it('STF-24 — lockedUntil en Usuarios: ∈ [ahora+55 s, ahora+60 s] tras 5 fallos; null tras el reset; almacén caído ⇒ 200 unavailable', async () => {
    const s = await staff('mrk');
    const other = await staff('mrk');
    for (let i = 0; i < 5; i++) expect((await login(s.username, BAD)).status).toBe(401);
    const t0 = Date.now();
    const list = await h.api('GET', `/admin/users?q=mrk&pageSize=100`, { token: adminTok });
    expect(list.status).toBe(200);
    expect(list.body.lockState).toBe('ok');
    const mine = list.body.data.find((u: any) => u.id === s.id);
    const theirs = list.body.data.find((u: any) => u.id === other.id);
    const until = Date.parse(mine.lockedUntil);
    expect(until).toBeGreaterThanOrEqual(t0 + 55_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(theirs.lockedUntil).toBeNull();
    for (const u of list.body.data) if (u.id !== s.id) expect([u.id, u.lockedUntil === null || typeof u.lockedUntil === 'string']).toEqual([u.id, true]);
    const detail = await h.api('GET', `/admin/users/${s.id}`, { token: adminTok });
    expect(detail.status).toBe(200);
    expect(Date.parse(detail.body.lockedUntil)).toBeGreaterThanOrEqual(t0 + 55_000);
    expect(detail.body.username).toBe(s.username);
    expect(detail.body.email).toBeNull();
    const opDetail = await h.api('GET', `/admin/users/${s.id}`, { token: opTok });
    expect(opDetail.status).toBe(200);
    expect(typeof opDetail.body.lockedUntil).toBe('string');

    expect((await h.api('POST', `/admin/users/${s.id}/reset-password`, { token: adminTok })).status).toBe(200);
    const after = await h.api('GET', `/admin/users?q=${s.username}`, { token: adminTok });
    expect(after.body.data.find((u: any) => u.id === s.id).lockedUntil).toBeNull();

    // Con candado puesto de nuevo y el almacén lanzando ⇒ el listado NO falla y no afirma «sin candado».
    for (let i = 0; i < 5; i++) await login(s.username, BAD);
    const store = h.app.get<LoginAttemptStore>(LOGIN_ATTEMPT_STORE);
    const spy = jest
      .spyOn(store as unknown as { peekLockMs: (k: string) => Promise<number> }, 'peekLockMs')
      .mockRejectedValue(new Error('store down'));
    try {
      const down = await h.api('GET', `/admin/users?q=mrk&pageSize=100`, { token: adminTok });
      expect(down.status).toBe(200);
      expect(down.body.lockState).toBe('unavailable');
      for (const u of down.body.data) expect(u.lockedUntil).toBeNull();
      const dd = await h.api('GET', `/admin/users/${s.id}`, { token: adminTok });
      expect(dd.status).toBe(200);
      expect(dd.body.lockedUntil).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  // ───────────────────────────────────────────── 267: correos ──────────────────────────────────────────

  it.each([Role.vault_operator, Role.super_admin])('STF-26 — %s sin correo: E-1 candado, E-2 forgot, E-3 resend ⇒ mismo resultado, cero correos, cero AuthToken', async (role) => {
    const s = await activeStaff('e1', role);
    await lock(s.username); // E-1
    const f = await h.api('POST', '/auth/forgot-password', { json: { email: s.username } }); // E-2
    expect(f.status).toBe(200);
    expect(f.body).toEqual({ ok: true });
    const r = await h.api('POST', '/auth/verify-email/resend', { token: s.token }); // E-3
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    await settle();
    expect(mailSpy).not.toHaveBeenCalled();
    expect(await h.prisma.authToken.count({ where: { userId: s.id, type: { in: [AuthTokenType.email_verification, AuthTokenType.password_reset] } } })).toBe(0);
  });

  // ───────────────────────────────────────────── 268: identificar ──────────────────────────────────────

  it('STF-27 — ?q= busca por usuario (sin mayúsculas, por fragmento); la fila trae "email": null y username; reporte de operadores con username', async () => {
    const s = await staff('ana');
    const frag = s.username.slice(3, 9);
    for (const q of [s.username.toUpperCase(), frag]) {
      const r = await h.api('GET', `/admin/users?q=${encodeURIComponent(q)}&pageSize=100`, { token: adminTok });
      expect(r.status).toBe(200);
      const row = r.body.data.find((u: any) => u.id === s.id);
      expect([q, row?.username]).toEqual([q, s.username]);
      expect(Object.prototype.hasOwnProperty.call(row, 'email')).toBe(true);
      expect(row.email).toBeNull();
    }
    const rep = await h.api('GET', '/admin/refunds/operator-summary', { token: adminTok });
    expect(rep.status).toBe(200);
    const rows = rep.body.operators;
    const mine = rows.find((x: any) => x.user.userId === s.id);
    expect(mine.user.username).toBe(s.username);
    expect(mine.user.email).toBeNull();
  });

  // ───────────────────────────────────────────── 269: no es cliente ────────────────────────────────────

  it('STF-28 — cuenta sin correo en las cinco rutas de cliente ⇒ 403 ACCOUNT_WITHOUT_EMAIL; cero filas; cero Stripe; I-STF-1 = 0', async () => {
    const s = await activeStaff('cli');
    const counts = async () => ({
      orders: await h.prisma.order.count({ where: { userId: s.id } }),
      sells: await h.prisma.sellRequest.count({ where: { userId: s.id } }),
      ships: await h.prisma.shipmentRequest.count({ where: { userId: s.id } }),
    });
    const c0 = await counts();
    const pi0 = h.stripe.createdIntents.length;
    const routes: [string, string][] = [
      ['POST', '/checkout/session'],
      ['POST', '/buylist/requests'],
      ['POST', '/shipments'],
      ['POST', '/orders/claim'],
      ['GET', '/orders/claimable'],
    ];
    for (const [m, p] of routes) {
      const r = await h.api(m, p, { token: s.token, ...(m === 'POST' ? { json: {} } : {}) });
      expect([p, r.status, r.body?.error?.code]).toEqual([p, 403, 'ACCOUNT_WITHOUT_EMAIL']);
    }
    expect(await counts()).toEqual(c0);
    expect(h.stripe.createdIntents.length).toBe(pi0);
    const broken = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(`
      SELECT count(*)::bigint AS n FROM "User" u WHERE u."email" IS NULL AND (
        EXISTS (SELECT 1 FROM "Order" x WHERE x."userId" = u.id) OR
        EXISTS (SELECT 1 FROM "SellRequest" x WHERE x."userId" = u.id) OR
        EXISTS (SELECT 1 FROM "ShipmentRequest" x WHERE x."userId" = u.id) OR
        EXISTS (SELECT 1 FROM "Dispute" x WHERE x."userId" = u.id) OR
        EXISTS (SELECT 1 FROM "InventoryItem" x WHERE x."ownerUserId" = u.id) OR
        EXISTS (SELECT 1 FROM "ManualRefund" x WHERE x."customerUserId" = u.id) OR
        EXISTS (SELECT 1 FROM "ReplacementCase" x WHERE x."customerUserId" = u.id))`);
    expect(Number(broken[0].n)).toBe(0);
  });

  // ───────────────────────────────────────────── anonimización ─────────────────────────────────────────

  it('STF-30 — soft-delete de un staff sin correo con transacciones ⇒ 200 soft, username null, correo deleted+…@anon.invalid', async () => {
    const s = await staff('del');
    // La transacción se siembra a mano (por API es inalcanzable: el guard la para, I-STF-1). Tras el borrado la cuenta
    // ya tiene correo anonimizado ⇒ la consulta I-STF-1 de STF-28 sigue en 0.
    await h.prisma.shipmentRequest.create({ data: { userId: s.id, addressSnapshot: {}, shippingFeeCents: 0, priceConvention: 'IVA_EXCLUSIVE' } });
    await h.prisma.user.update({ where: { id: s.id }, data: { lockNoticeAt: new Date() } });
    const r = await h.api('DELETE', `/admin/users/${s.id}`, { token: adminTok });
    expect([r.status, r.text]).toEqual([200, r.text]);
    expect(r.body.mode).toBe('soft');
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.username).toBeNull();
    expect(row.lockNoticeAt).toBeNull();
    expect(row.email).toMatch(/^deleted\+.+@anon\.invalid$/);
    expect(row.status).toBe('deleted');
  });
});
