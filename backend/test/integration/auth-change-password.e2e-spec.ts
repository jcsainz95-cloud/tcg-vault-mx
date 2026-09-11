/**
 * auth-change-password.e2e-spec.ts — v1.67 (Stream A · B7). Integración/E2E contra Postgres real,
 * app REAL de Nest (misma cadena de guards que main.ts). Contrato §1 «Cambiar la propia contraseña»
 * y «Contraseña temporal OBLIGATORIA»; ARCHITECTURE §4.47.1–4.47.2. Decisión del dueño: BLOQUEA.
 *
 * Ciclo completo, en el orden en que lo vive el usuario:
 *   reset por admin → la sesión vieja cae en 401 (y su refresh también)
 *   → login con la temporal responde 200 con `user.mustChangePassword: true`
 *   → cualquier ruta autenticada (bóveda, PATCH /users/me, resend) ⇒ 403 PASSWORD_CHANGE_REQUIRED
 *   → logout (allowlist) ⇒ 204 · refresh (@Public) sigue funcionando
 *   → change-password: 422 CURRENT_PASSWORD_INCORRECT (no 401) · 422 PASSWORD_SAME_AS_CURRENT · 400 nueva corta
 *   → change-password correcta ⇒ 200 con par NUEVO
 *   → la misma ruta con el par nuevo ⇒ 200 · con la temporal ⇒ 401 · refresh viejo ⇒ 401, nuevo ⇒ 200
 *   → BD: mustChangePassword=false, emailVerified INTACTO, tokenVersion +1, AuditLog auth.password_changed.
 * Aparte: cuenta solo-Google (passwordHash NULL) ⇒ 422 PASSWORD_NOT_SET.
 *
 * `GET /users/me` (tercera ruta de la allowlist) vive en el módulo `users` (B4, agente A2, `87c0509`):
 * aquí solo se asevera que con la temporal responde 200 con los dos campos que la pantalla de cambio
 * necesita (`mustChangePassword`, `hasPassword`); el resto de su forma es de su propio spec.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { AuthService } from '../../src/modules/auth/auth.service';

const ROUTE = '/vault/holdings'; // «cualquier ruta autenticada» (customer+)

describe('E2E — contraseña temporal OBLIGATORIA y POST /auth/change-password (v1.67)', () => {
  let h: E2EHarness;
  let adminToken: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  });

  afterAll(async () => {
    await h?.close();
  });

  async function freshCustomer() {
    const email = `cp_${randomUUID().slice(0, 8)}@e2e.local`;
    const password = 'Original123!';
    const reg = await h.api('POST', '/auth/register', {
      json: { email, password, name: 'Change Pwd' },
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user.mustChangePassword).toBe(false);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { email } });
    return { email, password, id: row.id, access: reg.body.accessToken as string, refresh: reg.body.refreshToken as string };
  }

  it('ciclo completo: reset admin → 401 → login temporal (flag) → 403 → cambio 200 con par nuevo → 200 / par viejo 401', async () => {
    const u = await freshCustomer();
    const before = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });

    // Sesión vieja operando con normalidad.
    expect((await h.api('GET', ROUTE, { token: u.access })).status).toBe(200);

    // 1) Reset por admin ⇒ temporal + flag + tokenVersion+1.
    const reset = await h.api('POST', `/admin/users/${u.id}/reset-password`, { token: adminToken });
    expect(reset.status).toBe(200);
    const temp: string = reset.body.tempPassword;
    expect(typeof temp).toBe('string');
    expect(reset.body.mustChangePassword).toBe(true);

    // 2) La sesión vieja muere: petición y refresh ⇒ 401 (cadena documentada, sin mecanismo nuevo).
    const oldReq = await h.api('GET', ROUTE, { token: u.access });
    expect(oldReq.status).toBe(401);
    expect(oldReq.body.error.code).toBe('UNAUTHENTICATED');
    const oldRefresh = await h.api('POST', '/auth/refresh', { json: { refreshToken: u.refresh } });
    expect(oldRefresh.status).toBe(401);

    // 3) Login con la temporal: 200 con el flag (login NO rechaza: sin sesión no hay cambio posible).
    const login = await h.api('POST', '/auth/login', { json: { email: u.email, password: temp } });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const tempAccess: string = login.body.accessToken;
    const tempRefresh: string = login.body.refreshToken;

    // 4) Cualquier ruta autenticada fuera de la allowlist ⇒ 403 PASSWORD_CHANGE_REQUIRED, details {}.
    for (const [method, path, json] of [
      ['GET', ROUTE, undefined],
      ['PATCH', '/users/me', { name: 'Nuevo' }],
      ['POST', '/auth/verify-email/resend', undefined],
      ['GET', '/users/me/addresses', undefined],
    ] as const) {
      const res = await h.api(method, path, { token: tempAccess, json });
      expect([method, path, res.status]).toEqual([method, path, 403]);
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect(res.body.error.details).toEqual({});
    }

    // 5) Allowlist: GET /users/me ⇒ 200 (hidratación de sesión + pantalla de cambio); logout ⇒ 204.
    //    refresh es @Public ⇒ sigue funcionando (el front lo necesita).
    const me = await h.api('GET', '/users/me', { token: tempAccess });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ mustChangePassword: true, hasPassword: true });
    expect((await h.api('POST', '/auth/logout', { token: tempAccess })).status).toBe(204);
    const refreshDuring = await h.api('POST', '/auth/refresh', { json: { refreshToken: tempRefresh } });
    expect(refreshDuring.status).toBe(200);

    // 6) change-password: errores en el orden normativo, sin tocar la BD.
    const wrong = await h.api('POST', '/auth/change-password', {
      token: tempAccess,
      json: { currentPassword: 'NoEsLaTemporal1!', newPassword: 'Definitiva456!' },
    });
    expect(wrong.status).toBe(422); // ⛔ no 401: el cliente cerraría la sesión
    expect(wrong.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(wrong.body.error.details).toEqual({ field: 'currentPassword' });

    const same = await h.api('POST', '/auth/change-password', {
      token: tempAccess,
      json: { currentPassword: temp, newPassword: temp },
    });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe('PASSWORD_SAME_AS_CURRENT');
    expect(same.body.error.details).toEqual({ field: 'newPassword' });

    const short = await h.api('POST', '/auth/change-password', {
      token: tempAccess,
      json: { currentPassword: temp, newPassword: 'corta' },
    });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');

    const missing = await h.api('POST', '/auth/change-password', {
      token: tempAccess,
      json: { newPassword: 'Definitiva456!' },
    });
    expect(missing.status).toBe(400);

    const stillFlagged = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stillFlagged.mustChangePassword).toBe(true);
    expect((await h.api('GET', ROUTE, { token: tempAccess })).status).toBe(403);

    // 7) Cambio correcto ⇒ 200 con par NUEVO.
    const NEW = 'Definitiva456!';
    const ok = await h.api('POST', '/auth/change-password', {
      token: tempAccess,
      json: { currentPassword: temp, newPassword: NEW },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(typeof ok.body.accessToken).toBe('string');
    expect(typeof ok.body.refreshToken).toBe('string');
    expect(ok.body.accessToken).not.toBe(tempAccess);

    // 8) Ésta continúa con el par nuevo; la temporal (misma sesión, tv viejo) cae.
    expect((await h.api('GET', ROUTE, { token: ok.body.accessToken })).status).toBe(200);
    expect((await h.api('PATCH', '/users/me', { token: ok.body.accessToken, json: { phone: '5512345678' } })).status).toBe(200);
    const oldTemp = await h.api('GET', ROUTE, { token: tempAccess });
    expect(oldTemp.status).toBe(401);
    expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: tempRefresh } })).status).toBe(401);
    expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: ok.body.refreshToken } })).status).toBe(200);

    // 9) Login con la nueva funciona; con la temporal ya no; el flag viene apagado.
    const relogin = await h.api('POST', '/auth/login', { json: { email: u.email, password: NEW } });
    expect(relogin.status).toBe(200);
    expect(relogin.body.user.mustChangePassword).toBe(false);
    expect((await h.api('POST', '/auth/login', { json: { email: u.email, password: temp } })).status).toBe(401);

    // 10) BD: una escritura, emailVerified INTACTO, tokenVersion = reset(+1) + cambio(+1), auditoría.
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(after.emailVerified).toBe(before.emailVerified); // register nace sin verificar; aquí no hubo inbox
    expect(after.authProvider).toBe(before.authProvider);
    expect(after.tokenVersion).toBe(before.tokenVersion + 2);
    const audit = await h.prisma.auditLog.findFirst({
      where: { actorUserId: u.id, action: 'auth.password_changed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.entityType).toBe('User');
    expect(audit!.entityId).toBe(u.id);
    expect(audit!.actorRole).toBe('customer');
    expect(JSON.stringify(audit)).not.toContain(NEW);
    expect(JSON.stringify(audit)).not.toContain(temp);
  });

  it('el operador (staff) recorre el mismo ciclo: reset → temporal → 403 en /admin/* → cambio → 200', async () => {
    const email = `op_${randomUUID().slice(0, 8)}@e2e.local`;
    const created = await h.api('POST', '/admin/users', {
      token: adminToken,
      json: { email, name: 'Op Temp', role: 'vault_operator' }, // sin password ⇒ autogenerada + flag
    });
    expect(created.status).toBe(201);
    const temp: string = created.body.tempPassword;
    expect(created.body.mustChangePassword).toBe(true);

    const login = await h.api('POST', '/auth/login', { json: { email, password: temp } });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const tempAccess: string = login.body.accessToken;

    const blocked = await h.api('GET', '/admin/orders', { token: tempAccess });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED'); // y no FORBIDDEN de rol: el guard va antes

    const ok = await h.api('POST', '/auth/change-password', {
      token: tempAccess,
      json: { currentPassword: temp, newPassword: 'OperadorNuevo789!' },
    });
    expect(ok.status).toBe(200);
    expect((await h.api('GET', '/admin/orders', { token: ok.body.accessToken })).status).toBe(200);
    expect((await h.api('GET', '/admin/orders', { token: tempAccess })).status).toBe(401);
  });

  it('sin flag: change-password también sirve (no depende de la temporal) y revoca las OTRAS sesiones', async () => {
    const u = await freshCustomer();
    const second = await h.api('POST', '/auth/login', { json: { email: u.email, password: u.password } });
    const ok = await h.api('POST', '/auth/change-password', {
      token: u.access,
      json: { currentPassword: u.password, newPassword: 'OtraDistinta321!' },
    });
    expect(ok.status).toBe(200);
    expect((await h.api('GET', ROUTE, { token: ok.body.accessToken })).status).toBe(200);
    expect((await h.api('GET', ROUTE, { token: second.body.accessToken })).status).toBe(401);
    expect((await h.api('GET', ROUTE, { token: u.access })).status).toBe(401);
  });

  it('cuenta solo-Google (passwordHash NULL) ⇒ 422 PASSWORD_NOT_SET; no se crea contraseña', async () => {
    const email = `goog_${randomUUID().slice(0, 8)}@e2e.local`;
    const user = await h.prisma.user.create({
      data: {
        email,
        passwordHash: null,
        name: email.split('@')[0],
        nameSource: 'derived',
        role: 'customer',
        authProvider: 'google',
        googleId: `g_${randomUUID()}`,
        emailVerified: true,
      },
    });
    const { accessToken } = await h.app.get(AuthService).issueTokens(user);
    const res = await h.api('POST', '/auth/change-password', {
      token: accessToken,
      json: { currentPassword: 'cualquiera', newPassword: 'Definitiva456!' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PASSWORD_NOT_SET');
    expect(res.body.error.details).toEqual({});
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBeNull();
    expect(after.tokenVersion).toBe(user.tokenVersion);
  });

  it('sin sesión ⇒ 401 UNAUTHENTICATED (el endpoint es autenticado)', async () => {
    const res = await h.api('POST', '/auth/change-password', {
      json: { currentPassword: 'a', newPassword: 'Definitiva456!' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
