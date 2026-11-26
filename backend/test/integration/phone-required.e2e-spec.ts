/**
 * phone-required.e2e-spec.ts — §CELULAR (docs/API_CONTRACT_CELULAR.md) contra Postgres real.
 * Registro, alta solo-correo, login/me (`phoneRequired`), `PATCH /users/me` (no se puede vaciar), guard `@RequirePhone()`
 * en las 4 rutas de dinero (cotizar, pagar, retiro, solicitud de buylist) y `PATCH /admin/users/:id/phone` con
 * auditoría enmascarada.
 */
import { AuditService } from '../../src/modules/audit/audit.service';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

describe('E2E — §CELULAR obligatorio', () => {
  let h: E2EHarness;
  const run = Math.random().toString(36).slice(2, 8);
  const email = `cel-${run}@e2e.local`;
  const password = 'Celular123!';
  let userId: string;
  let token: string;

  const phoneOf = async (id: string) => (await h.prisma.user.findUnique({ where: { id } }))!.phone;
  const setPhone = (phone: string | null) => h.prisma.user.update({ where: { id: userId }, data: { phone } });

  beforeAll(async () => {
    h = await E2EHarness.create();
  });
  afterAll(async () => {
    await h?.prisma.user.deleteMany({ where: { email: { contains: `-${run}@e2e.local` } } });
    await h?.close();
  });

  describe('POST /auth/register', () => {
    it.each([undefined, null, '', 'abc', '0000000000', '1234567890', 5512345678])(
      'phone %j ⇒ 422 PHONE_INVALID y NO crea la cuenta',
      async (phone) => {
        const res = await h.api('POST', '/auth/register', { json: { email: `bad-${run}@e2e.local`, password, name: 'Bad', phone } });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PHONE_INVALID');
        expect(res.body.error.details).toEqual({ field: 'phone' });
        expect(await h.prisma.user.count({ where: { email: `bad-${run}@e2e.local` } })).toBe(0);
      },
    );

    it('phone con +52 y guiones ⇒ 201, se guarda normalizado y phoneRequired=false', async () => {
      const res = await h.api('POST', '/auth/register', {
        json: { email, password, name: 'Cel', phone: '+52 55-1234-5678' },
      });
      expect(res.status).toBe(201);
      expect(res.body.user.phoneRequired).toBe(false);
      userId = res.body.user.id;
      expect(await phoneOf(userId)).toBe('5512345678');
      // Para las rutas de dinero (que exigen correo verificado) la cuenta se marca verificada.
      await h.prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
      token = await h.login(email, password);
    });
  });

  describe('POST /auth/register/email-only', () => {
    it('con celular válido del domicilio ⇒ se guarda normalizado; phoneRequired=false', async () => {
      const e = `eo1-${run}@e2e.local`;
      const res = await h.api('POST', '/auth/register/email-only', { json: { email: e, phone: '525512345678' } });
      expect(res.status).toBe(201);
      expect(res.body.user.phoneRequired).toBe(false);
      expect(await phoneOf(res.body.user.id)).toBe('5512345678');
    });
    it.each([undefined, '', '0000000000', 'abc'])('phone %j ⇒ 422 PHONE_INVALID y NO se crea la cuenta (§CELULAR-ALTA v2 §6.3)', async (phone) => {
      const e = `eo2-${String(phone).length}-${run}@e2e.local`;
      const res = await h.api('POST', '/auth/register/email-only', { json: { email: e, phone } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PHONE_INVALID');
      expect(await h.prisma.user.findUnique({ where: { email: e } })).toBeNull();
    });
  });

  describe('phoneRequired en login y GET /users/me', () => {
    it.each([[null, true], ['0000000000', true], ['5512345678', false]] as const)('phone guardado %j ⇒ phoneRequired=%s', async (stored, expected) => {
      await setPhone(stored);
      const login = await h.api('POST', '/auth/login', { json: { email, password } });
      expect(login.body.user.phoneRequired).toBe(expected);
      const me = await h.api('GET', '/users/me', { token });
      expect(me.body.phoneRequired).toBe(expected);
      expect(me.body.phone).toBe(stored); // tal cual está guardado
    });
  });

  describe('guard @RequirePhone() en las 4 rutas de dinero', () => {
    const routes: Array<[string, string]> = [
      ['POST', '/checkout/quote'],
      ['POST', '/checkout/session'],
      ['POST', '/shipments'],
      ['POST', '/buylist/requests'],
    ];
    it.each(routes)('%s %s ⇒ 422 PHONE_REQUIRED sin celular o con basura; con celular válido ya no', async (method, path) => {
      for (const bad of [null, '', '0000000000', 'abc']) {
        await setPhone(bad);
        const res = await h.api(method, path, { token, json: {} });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PHONE_REQUIRED');
        expect(res.body.error.details).toEqual({ field: 'phone' });
      }
      await setPhone('5512345678');
      const ok = await h.api(method, path, { token, json: {} });
      expect(ok.body?.error?.code).not.toBe('PHONE_REQUIRED');
    });

    it('las lecturas y PATCH /users/me quedan libres sin celular', async () => {
      await setPhone(null);
      expect((await h.api('GET', '/users/me', { token })).status).toBe(200);
      expect((await h.api('GET', '/users/me/addresses', { token })).status).toBe(200);
    });
  });

  describe('PATCH /users/me — el celular no se puede borrar', () => {
    beforeAll(() => setPhone('5512345678'));
    it.each(['', '   ', null, 'abc', '0000000000', 123, {}])('phone %j ⇒ 422 PHONE_INVALID y la BD no cambia', async (phone) => {
      const res = await h.api('PATCH', '/users/me', { token, json: { phone } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PHONE_INVALID');
      expect(res.body.error.details).toEqual({ field: 'phone' });
      expect(await phoneOf(userId)).toBe('5512345678');
    });
    it('otro válido ⇒ 200, normalizado, phoneRequired=false; sin `phone` no lo toca', async () => {
      const res = await h.api('PATCH', '/users/me', { token, json: { phone: '+52 55 9876 5432' } });
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('5598765432');
      expect(res.body.phoneRequired).toBe(false);
      expect(await phoneOf(userId)).toBe('5598765432');
      const r2 = await h.api('PATCH', '/users/me', { token, json: { locale: 'en' } });
      expect(r2.status).toBe(200);
      expect(await phoneOf(userId)).toBe('5598765432');
    });
    it('una cuenta con celular basura puede corregirlo (no queda atrapada)', async () => {
      await setPhone('0000000000');
      const res = await h.api('PATCH', '/users/me', { token, json: { phone: '5512345678' } });
      expect(res.status).toBe(200);
      expect(res.body.phoneRequired).toBe(false);
    });
  });

  describe('PATCH /admin/users/:id/phone', () => {
    let admin: string;
    beforeAll(async () => {
      admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    });
    it('super_admin ⇒ 200, normalizado, con auditoría ENMASCARADA (nunca el número completo)', async () => {
      await setPhone('5512345678');
      const res = await h.api('PATCH', `/admin/users/${userId}/phone`, { token: admin, json: { phone: '+52 55 4444 3210' } });
      expect(res.status).toBe(200);
      expect(await phoneOf(userId)).toBe('5544443210');
      const rows = await h.prisma.auditLog.findMany({ where: { action: 'user.phone.update', entityId: userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].before).toEqual({ phone: '******5678' });
      expect(rows[0].after).toEqual({ phone: '******3210' });
      expect(JSON.stringify(rows[0])).not.toContain('5544443210');
      expect(JSON.stringify(rows[0])).not.toContain('5512345678');
    });
    it.each(['', null, 'abc', '1234567890', 5512345678])('phone %j ⇒ 422 PHONE_INVALID, sin cambio', async (phone) => {
      const before = await phoneOf(userId);
      const res = await h.api('PATCH', `/admin/users/${userId}/phone`, { token: admin, json: { phone } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PHONE_INVALID');
      expect(await phoneOf(userId)).toBe(before);
    });
    it('un cliente (IDOR) ⇒ 403 y no escribe; sin sesión ⇒ 401; id inexistente ⇒ 404', async () => {
      const before = await phoneOf(userId);
      const res = await h.api('PATCH', `/admin/users/${userId}/phone`, { token, json: { phone: '5511112222' } });
      expect(res.status).toBe(403);
      expect((await h.api('PATCH', `/admin/users/${userId}/phone`, { json: { phone: '5511112222' } })).status).toBe(401);
      expect((await h.api('PATCH', '/admin/users/no-existe/phone', { token: admin, json: { phone: '5511112222' } })).status).toBe(404);
      expect(await phoneOf(userId)).toBe(before);
    });
    it('I-2: si la auditoría falla, el celular NO cambia (misma transacción)', async () => {
      const orig = await phoneOf(userId);
      await setPhone('5512345678');
      const spy = jest.spyOn(h.app.get(AuditService), 'log').mockRejectedValueOnce(new Error('audit down'));
      try {
        const res = await h.api('PATCH', `/admin/users/${userId}/phone`, { token: admin, json: { phone: '5599887766' } });
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        spy.mockRestore();
      }
      expect(await phoneOf(userId)).toBe('5512345678');
      await setPhone(orig);
      expect(await h.prisma.auditLog.count({ where: { action: 'user.phone.update', entityId: userId, after: { equals: { phone: '******7766' } } } })).toBe(0);
    });
    it('SC-3: una cuenta anonimizada ⇒ 422 USER_DELETED y no se le escribe celular', async () => {
      const anon = await h.prisma.user.create({ data: { email: `anon-${run}@e2e.local`, name: 'Anon', role: 'customer', anonymizedAt: new Date() }, select: { id: true } });
      const res = await h.api('PATCH', `/admin/users/${anon.id}/phone`, { token: admin, json: { phone: '5599887766' } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('USER_DELETED');
      expect((await h.prisma.user.findUniqueOrThrow({ where: { id: anon.id } })).phone).toBeNull();
    });
    it('GET /admin/users/:id devuelve phone y phoneRequired', async () => {
      const res = await h.api('GET', `/admin/users/${userId}`, { token: admin });
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('5544443210');
      expect(res.body.phoneRequired).toBe(false);
    });
  });

  describe('POST /admin/users — alta de cliente M6', () => {
    let admin: string;
    beforeAll(async () => {
      admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    });
    it.each([undefined, null, '', 'abc', '0000000000', 5512345678])('cliente con phone %j ⇒ 422 PHONE_INVALID y no crea', async (phone) => {
      const e = `m6bad-${run}@e2e.local`;
      const res = await h.api('POST', '/admin/users', { token: admin, json: { email: e, name: 'M6', role: 'customer', password: 'Celular123!', phone } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PHONE_INVALID');
      expect(await h.prisma.user.findFirst({ where: { email: e } })).toBeNull();
    });
    it('cliente con celular válido ⇒ 201 y se guarda normalizado', async () => {
      const e = `m6ok-${run}@e2e.local`;
      const res = await h.api('POST', '/admin/users', { token: admin, json: { email: e, name: 'M6', role: 'customer', password: 'Celular123!', phone: '+52 55 2222 3333' } });
      expect(res.status).toBe(201);
      expect((await h.prisma.user.findFirst({ where: { email: e } }))!.phone).toBe('5522223333');
    });
    // Hallazgo cerrado (dueño: «obligatorio para TODOS»): el alta M6 de EQUIPO tampoco puede omitir el celular.
    it.each(['vault_operator', 'super_admin'])('equipo (%s) sin celular o con celular inválido ⇒ 422 PHONE_INVALID y no crea', async (role) => {
      for (const phone of [undefined, null, '', '0000000000']) {
        const username = `stfbad.${role.slice(0, 3)}.${run}`.toLowerCase();
        const res = await h.api('POST', '/admin/users', { token: admin, json: { username, name: 'Staff', role, password: 'Celular123!', phone } });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PHONE_INVALID');
        expect(await h.prisma.user.findFirst({ where: { username } })).toBeNull();
      }
    });
    it('equipo con celular válido ⇒ 201 y se guarda normalizado', async () => {
      const username = `stfok.${run}`.toLowerCase();
      const res = await h.api('POST', '/admin/users', { token: admin, json: { username, name: 'Staff', role: 'vault_operator', password: 'Celular123!', phone: '+52 55 3333 4444' } });
      expect(res.status).toBe(201);
      expect((await h.prisma.user.findFirst({ where: { username } }))!.phone).toBe('5533334444');
    });
  });
});
