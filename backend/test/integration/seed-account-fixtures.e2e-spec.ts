/**
 * seed-account-fixtures.e2e-spec.ts — Integración contra Postgres real (v1.67.1, Stream A · gates).
 *
 * ARCHITECTURE §4.47.10.4 (a) — condición de release: el seed sintético siembra los TRES actores que la
 * suite E2E necesita y no tenía (techlead F2-1 / QA):
 *   1. usuario con contraseña TEMPORAL (cliente y operador): login ⇒ `mustChangePassword:true` ⇒
 *      `403 PASSWORD_CHANGE_REQUIRED` fuera de la allowlist ⇒ `change-password` ⇒ `200` con el par
 *      nuevo; la sesión vieja ⇒ `401`. Y la SIGUIENTE siembra restaura la temporal (E2E-1).
 *   2. cuenta SOLO-GOOGLE: `hasPassword:false`, `nameSource:'derived'`, `change-password` ⇒
 *      `422 PASSWORD_NOT_SET`; y sigue sin poder hacer login por contraseña.
 *   3. pedido de INVITADO sin reclamar con el correo del `customer`: `GET /orders/claimable` no vacío
 *      ⇒ reclamo ⇒ aparece en `/orders` ⇒ la siguiente siembra lo vuelve a dejar reclamable.
 * El seed NO siembra `BillingProfile` (el `404` es el caso a probar; el `PUT` lo crea en el test).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_ACCOUNT_FIXTURES, E2E_GUEST_ORDER, E2E_USERS } from '../../prisma/e2e-fixtures';
import { AuthService } from '../../src/modules/auth/auth.service';

const ROUTE = '/vault/holdings'; // «cualquier ruta autenticada» fuera de la allowlist

describe('E2E — seed: los tres actores de cuenta de §4.47.10.4 (v1.67.1)', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('1. contraseña temporal', () => {
    it('cliente: login ⇒ mustChangePassword:true; ruta normal ⇒ 403; GET /users/me ⇒ 200; cambio ⇒ 200 y la sesión vieja ⇒ 401', async () => {
      const f = E2E_ACCOUNT_FIXTURES.temporalCustomer;
      const login = await h.api('POST', '/auth/login', { json: { email: f.email, password: f.password } });
      expect(login.status).toBe(200);
      expect(login.body.user).toMatchObject({ email: f.email, role: 'customer', mustChangePassword: true });
      const temp = login.body.accessToken as string;

      const blocked = await h.api('GET', ROUTE, { token: temp });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const me = await h.api('GET', '/users/me', { token: temp });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ mustChangePassword: true, hasPassword: true, nameSource: 'user' });

      const ok = await h.api('POST', '/auth/change-password', {
        token: temp,
        json: { currentPassword: f.password, newPassword: 'DefinitivaCliente2026!' },
      });
      expect(ok.status).toBe(200);
      expect((await h.api('GET', ROUTE, { token: ok.body.accessToken })).status).toBe(200);
      expect((await h.api('GET', ROUTE, { token: temp })).status).toBe(401);
      const row = await h.prisma.user.findUniqueOrThrow({ where: { email: f.email } });
      expect(row.mustChangePassword).toBe(false);
    });

    it('operador: login ⇒ mustChangePassword:true y /admin/* ⇒ 403 PASSWORD_CHANGE_REQUIRED (no FORBIDDEN de rol)', async () => {
      const f = E2E_ACCOUNT_FIXTURES.temporalOperator;
      const login = await h.api('POST', '/auth/login', { json: { email: f.email, password: f.password } });
      expect(login.status).toBe(200);
      expect(login.body.user).toMatchObject({ role: 'vault_operator', mustChangePassword: true });
      const blocked = await h.api('GET', '/admin/orders', { token: login.body.accessToken });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('E2E-1: volver a sembrar RESTAURA la temporal y el flag del cliente que ya la cambió', async () => {
      const f = E2E_ACCOUNT_FIXTURES.temporalCustomer;
      // Tras el caso anterior la temporal ya no sirve:
      expect((await h.api('POST', '/auth/login', { json: { email: f.email, password: f.password } })).status).toBe(401);
      await seedE2E(h.prisma);
      const login = await h.api('POST', '/auth/login', { json: { email: f.email, password: f.password } });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
    });
  });

  describe('2. cuenta solo-Google', () => {
    it('sin contraseña: login por contraseña ⇒ 401; GET /users/me ⇒ hasPassword:false + nameSource:derived; change-password ⇒ 422 PASSWORD_NOT_SET', async () => {
      const g = E2E_ACCOUNT_FIXTURES.googleOnly;
      expect((await h.api('POST', '/auth/login', { json: { email: g.email, password: 'cualquiera' } })).status).toBe(401);

      const user = await h.prisma.user.findUniqueOrThrow({ where: { email: g.email } });
      expect(user).toMatchObject({
        passwordHash: null,
        authProvider: 'google',
        googleId: g.googleId,
        nameSource: 'derived',
        name: g.email.split('@')[0],
        emailVerified: true,
      });
      const { accessToken } = await h.app.get(AuthService).issueTokens(user);
      const me = await h.api('GET', '/users/me', { token: accessToken });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ hasPassword: false, nameSource: 'derived', authProvider: 'google', mustChangePassword: false });

      const res = await h.api('POST', '/auth/change-password', {
        token: accessToken,
        json: { currentPassword: 'cualquiera', newPassword: 'Definitiva456!' },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PASSWORD_NOT_SET');
    });
  });

  describe('3. pedido de invitado sin reclamar (customer@e2e.local)', () => {
    let token: string;
    let orderId: string;

    beforeAll(async () => {
      token = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    });

    it('GET /orders/claimable NO viene vacío: trae el pedido del seed (settled, 1 línea)', async () => {
      const res = await h.api('GET', '/orders/claimable', { token });
      expect(res.status).toBe(200);
      const row = (res.body.data as any[]).find((o) => o.orderNumber === E2E_GUEST_ORDER.orderNumber);
      expect(row).toMatchObject({ status: 'settled', itemCount: 1, totalCents: E2E_GUEST_ORDER.totalCents });
      orderId = row.orderId;
    });

    it('el pedido NO está en /orders antes de reclamar, y SÍ después (y desaparece de claimable)', async () => {
      const before = await h.api('GET', '/orders', { token });
      expect((before.body.data as any[]).some((o) => o.id === orderId)).toBe(false);

      const claim = await h.api('POST', '/orders/claim', { token, json: { orderIds: [orderId] } });
      expect(claim.status).toBe(200);
      expect(claim.body).toEqual({ claimed: [orderId], failed: [] });

      const after = await h.api('GET', '/orders', { token });
      expect((after.body.data as any[]).some((o) => o.id === orderId)).toBe(true);
      const claimable = await h.api('GET', '/orders/claimable', { token });
      expect((claimable.body.data as any[]).some((o) => o.orderId === orderId)).toBe(false);
    });

    it('E2E-1: volver a sembrar lo deja otra vez SIN reclamar (una sola fila con ese orderNumber)', async () => {
      await seedE2E(h.prisma);
      const rows = await h.prisma.order.findMany({ where: { orderNumber: E2E_GUEST_ORDER.orderNumber } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: null, claimedAt: null, guestEmail: E2E_USERS.customer.email });
      const res = await h.api('GET', '/orders/claimable', { token });
      expect((res.body.data as any[]).some((o) => o.orderNumber === E2E_GUEST_ORDER.orderNumber)).toBe(true);
      // Y su pieza sigue siendo de plataforma (un invitado nunca tiene bóveda, §4-G.0-1).
      const item = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_GUEST_ORDER.folio } });
      expect(item).toMatchObject({ ownerType: 'platform', ownerUserId: null, status: 'delivered' });
    });
  });

  it('el seed NO siembra BillingProfile: el 404 es el vacío que la sección prueba', async () => {
    const token = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const res = await h.api('GET', '/users/me/billing-profile', { token });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
