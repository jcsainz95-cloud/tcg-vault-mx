/**
 * auth-authz.e2e-spec.ts — Integración/E2E contra Postgres real.
 * Cubre: registro/login/refresh, autorización por rol (customer/vault_operator/
 * super_admin) y el `MoneyOutGuard` (dinero saliente solo super_admin + auditoría).
 * API_CONTRACT §1, §10; ARCHITECTURE §7; PROJECT criterios 25/26.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

describe('E2E — Auth y autorización por rol', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('registro / login / refresh', () => {
    it('registra un nuevo customer y emite tokens', async () => {
      const email = `new_${randomUUID().slice(0, 8)}@e2e.local`;
      const res = await h.api('POST', '/auth/register', {
        json: { email, password: 'Secret123!', name: 'New User' },
      });
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ email, role: 'customer', locale: 'es' });
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });

    it('rechaza email duplicado con 409 EMAIL_TAKEN', async () => {
      const res = await h.api('POST', '/auth/register', {
        json: { email: E2E_USERS.customer.email, password: 'Secret123!', name: 'Dup' },
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('login correcto e incorrecto', async () => {
      const ok = await h.api('POST', '/auth/login', {
        json: { email: E2E_USERS.customer.email, password: E2E_USERS.customer.password },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.user.role).toBe('customer');

      const bad = await h.api('POST', '/auth/login', {
        json: { email: E2E_USERS.customer.email, password: 'wrong-password' },
      });
      expect(bad.status).toBe(401);
      expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('refresh entrega un nuevo par de tokens', async () => {
      const login = await h.api('POST', '/auth/login', {
        json: { email: E2E_USERS.customer.email, password: E2E_USERS.customer.password },
      });
      const res = await h.api('POST', '/auth/refresh', {
        json: { refreshToken: login.body.refreshToken },
      });
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });

    it('GET /users/me con token válido devuelve el perfil', async () => {
      const token = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
      const res = await h.api('GET', '/users/me', { token });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ email: E2E_USERS.customer.email, role: 'customer' });
    });

    it('sin token, una ruta protegida devuelve UNAUTHENTICATED', async () => {
      const res = await h.api('GET', '/users/me');
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('autorización por rol', () => {
    it('un customer NO puede entrar al back-office (403 FORBIDDEN)', async () => {
      const token = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
      const res = await h.api('GET', '/admin/orders', { token });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('un vault_operator SÍ puede leer M3 (órdenes)', async () => {
      const token = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
      const res = await h.api('GET', '/admin/orders', { token });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('finanzas (M7) están vedadas al operador y abiertas al super_admin', async () => {
      const opToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
      const opRes = await h.api('GET', '/admin/finance/pnl', { token: opToken });
      expect(opRes.status).toBe(403);

      const adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
      const adminRes = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      expect(adminRes.status).toBe(200);
    });
  });

  describe('MoneyOutGuard — dinero saliente solo super_admin', () => {
    it('un operador que intenta un reembolso recibe MONEY_OUT_FORBIDDEN y queda AUDITADO', async () => {
      const opToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
      const opUser = await h.prisma.user.findUnique({ where: { email: E2E_USERS.operator.email } });
      const res = await h.api('POST', `/admin/orders/${randomUUID()}/refund`, {
        token: opToken,
        json: { reason: 'test' },
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MONEY_OUT_FORBIDDEN');

      const audit = await h.prisma.auditLog.findFirst({
        where: { actorUserId: opUser!.id, action: 'money_out.blocked' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
    });

    it('el super_admin SÍ pasa el guard de dinero saliente (llega al handler)', async () => {
      const adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
      // Orden inexistente → el guard PASA y el handler responde 404 (no MONEY_OUT_FORBIDDEN).
      const res = await h.api('POST', `/admin/orders/${randomUUID()}/refund`, {
        token: adminToken,
        json: { reason: 'test' },
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).not.toBe('MONEY_OUT_FORBIDDEN');
    });
  });
});
