/**
 * auth-logout.e2e-spec.ts — v1.71 (SEC-CR-1). Integración/E2E contra Postgres real, app REAL de Nest
 * (misma cadena de guards/pipes que main.ts). Reproduce y cierra el hallazgo de `seguridad`
 * (docs/SECURITY_NOTES.md · SEC-CR-1): **`POST /auth/logout` no revocaba nada** — su cuerpo era
 * literalmente `return;`, así que un access o refresh COPIADO antes de cerrar sesión seguía dando 200
 * hasta caducar (15m / 30d). El navegador tiraba su copia; el atacante con la suya, no.
 *
 * Decisión de producto (dueño, 2026-09-14): cerrar sesión **revoca TODAS las sesiones de la cuenta**
 * (todos los dispositivos), no solo la actual. Encaja con la palanca que ya existe: `User.tokenVersion`
 * es por-persona, y el guard (jwt-auth.guard.ts:70) y `/auth/refresh` (auth.service.ts:456) ya comparan
 * el `tv` del JWT contra él. Logout ahora sigue el MISMO patrón que el reset del admin
 * (admin.service.ts:1331) y change-password (auth.service.ts:325): `tokenVersion +1`.
 *
 * Sobre `d50cfa4` (logout = `return;`) los cuatro `it` de aquí están ROJOS: el access viejo y el
 * refresh viejo seguían dando 200 tras logout. Ésta es la prueba que DEBE fallar antes del arreglo.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const ROUTE = '/vault/holdings'; // «cualquier ruta autenticada» (customer+)

describe('E2E — POST /auth/logout revoca TODAS las sesiones de la cuenta (SEC-CR-1, v1.71)', () => {
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
    const email = `lo_${randomUUID().slice(0, 8)}@e2e.local`;
    const password = 'Original123!';
    const reg = await h.api('POST', '/auth/register', { json: { email, password, name: 'Logout Test' } });
    expect(reg.status).toBe(201);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { email } });
    return {
      email,
      password,
      id: row.id,
      tokenVersion: row.tokenVersion,
      access: reg.body.accessToken as string,
      refresh: reg.body.refreshToken as string,
    };
  }

  it('tras logout: el access COPIADO ⇒ 401 y el refresh COPIADO ⇒ 401 (era el bug: ambos daban 200)', async () => {
    const u = await freshCustomer();

    // Antes de logout: la sesión opera con normalidad (access da 200, refresh da 200).
    expect((await h.api('GET', ROUTE, { token: u.access })).status).toBe(200);
    const preRefresh = await h.api('POST', '/auth/refresh', { json: { refreshToken: u.refresh } });
    expect(preRefresh.status).toBe(200);

    // Logout autenticado ⇒ 204 (sin cuerpo).
    const out = await h.api('POST', '/auth/logout', { token: u.access });
    expect(out.status).toBe(204);

    // ⭐ SEC-CR-1: el testigo copiado ANTES ya no vale. Access viejo ⇒ 401.
    const oldAccess = await h.api('GET', ROUTE, { token: u.access });
    expect(oldAccess.status).toBe(401);
    expect(oldAccess.body.error.code).toBe('UNAUTHENTICATED');

    // Y el refresh viejo ⇒ 401 (no puede resucitar la sesión con un access nuevo).
    const oldRefresh = await h.api('POST', '/auth/refresh', { json: { refreshToken: u.refresh } });
    expect(oldRefresh.status).toBe(401);

    // BD: la única palanca es tokenVersion +1 (revocación por-cuenta).
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.tokenVersion).toBe(u.tokenVersion + 1);
  });

  it('logout NO impide el re-login inmediato: un login nuevo emite tokens válidos (tv al día)', async () => {
    const u = await freshCustomer();
    expect((await h.api('POST', '/auth/logout', { token: u.access })).status).toBe(204);

    // Re-login en la misma cuenta: el par nuevo lleva el tokenVersion ya incrementado y funciona.
    const relogin = await h.api('POST', '/auth/login', { json: { email: u.email, password: u.password } });
    expect(relogin.status).toBe(200);
    expect((await h.api('GET', ROUTE, { token: relogin.body.accessToken })).status).toBe(200);
    expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: relogin.body.refreshToken } })).status).toBe(200);
    // La sesión vieja sigue muerta aunque haya una nueva viva.
    expect((await h.api('GET', ROUTE, { token: u.access })).status).toBe(401);
  });

  it('revoca TODAS las sesiones, no solo la que llamó a logout (decisión de producto: global por-cuenta)', async () => {
    const u = await freshCustomer();
    // Segunda sesión del mismo usuario (otro dispositivo).
    const second = await h.api('POST', '/auth/login', { json: { email: u.email, password: u.password } });
    expect(second.status).toBe(200);
    const secondAccess: string = second.body.accessToken;
    expect((await h.api('GET', ROUTE, { token: secondAccess })).status).toBe(200);

    // Logout desde la PRIMERA sesión.
    expect((await h.api('POST', '/auth/logout', { token: u.access })).status).toBe(204);

    // Ambas sesiones caen: la que llamó y la otra.
    expect((await h.api('GET', ROUTE, { token: u.access })).status).toBe(401);
    expect((await h.api('GET', ROUTE, { token: secondAccess })).status).toBe(401);
  });

  it('bajo PASSWORD_CHANGE_REQUIRED: logout revoca (allowlist) y el usuario puede volver a entrar', async () => {
    // Reset por admin ⇒ temporal + flag + tokenVersion+1; la sesión vieja del customer muere sola.
    const u = await freshCustomer();
    const reset = await h.api('POST', `/admin/users/${u.id}/reset-password`, { token: adminToken });
    expect(reset.status).toBe(200);
    const temp: string = reset.body.tempPassword;

    const login = await h.api('POST', '/auth/login', { json: { email: u.email, password: temp } });
    expect(login.status).toBe(200);
    const tempAccess: string = login.body.accessToken;
    const tempRefresh: string = login.body.refreshToken;

    // logout está en la allowlist de PASSWORD_CHANGE_REQUIRED (rendirse siempre se permite) ⇒ 204.
    expect((await h.api('POST', '/auth/logout', { token: tempAccess })).status).toBe(204);

    // Revoca: el access y el refresh de la sesión temporal caen (antes el refresh seguía en 200).
    expect((await h.api('GET', ROUTE, { token: tempAccess })).status).toBe(401);
    expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: tempRefresh } })).status).toBe(401);

    // Y no deja al usuario en estado incoherente: puede volver a entrar con la temporal (el flag sigue).
    const relogin = await h.api('POST', '/auth/login', { json: { email: u.email, password: temp } });
    expect(relogin.status).toBe(200);
    expect(relogin.body.user.mustChangePassword).toBe(true);
  });
});
