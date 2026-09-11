/**
 * account-profile.e2e-spec.ts — Integración/E2E contra Postgres real (v1.67, Stream A · B4).
 * Cubre `GET /users/me` (+`hasPassword`, +`nameSource`, +`mustChangePassword`, allowlist del guard de
 * contraseña temporal), `PATCH /users/me` (trim, 1..120, `nameSource='user'`, misma forma que el GET)
 * y la libreta con `recipientName` (obligatorio al crear, no vaciable al editar).
 * API_CONTRACT §0 `PASSWORD_CHANGE_REQUIRED`, §1 «Contraseña temporal obligatoria», `GET/PATCH /users/me`,
 * «Direcciones», §11 `AddressDTO`; ARCHITECTURE §4.47.2, §4.47.4, §4.47.5.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

/** Las 14 claves de `GET /users/me` (contrato §1, v1.67). */
const ME_KEYS = [
  'id', 'email', 'name', 'nameSource', 'phone', 'role', 'locale', 'kycStatus', 'status',
  'authProvider', 'emailVerified', 'avatarUrl', 'hasPassword', 'mustChangePassword',
].sort();

const ADDRESS_KEYS = [
  'id', 'recipientName', 'line1', 'line2', 'neighborhood', 'city', 'state', 'postalCode', 'country', 'phone', 'isDefault',
].sort();

const MX_ADDRESS = {
  line1: 'Calle Prueba 1',
  neighborhood: 'Roma',
  city: 'CDMX',
  state: 'CDMX',
  postalCode: '06700',
  country: 'MX',
  phone: '5512345678',
};

describe('E2E — Cuenta del cliente: /users/me y libreta (v1.67)', () => {
  let h: E2EHarness;
  let token: string;
  let userId: string;
  let original: { name: string; nameSource: string; passwordHash: string | null; mustChangePassword: boolean };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    // Se usa customer2 para no interferir con el retiro de vault-shipments (customer).
    token = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    userId = u!.id;
    original = {
      name: u!.name,
      nameSource: u!.nameSource,
      passwordHash: u!.passwordHash,
      mustChangePassword: u!.mustChangePassword,
    };
  });

  afterAll(async () => {
    // El seed NO restaura estos campos en el `update` del upsert: se restauran aquí.
    if (h && userId) {
      await h.prisma.user.update({ where: { id: userId }, data: { ...original, nameSource: original.nameSource as never } });
      await h.prisma.address.deleteMany({ where: { userId, line1: MX_ADDRESS.line1 } });
    }
    await h?.close();
  });

  describe('GET /users/me', () => {
    it('devuelve las 14 claves del contrato; hasPassword=true con hash local', async () => {
      const res = await h.api('GET', '/users/me', { token });
      expect(res.status).toBe(200);
      // `avatarUrl` es opcional y desaparece del JSON cuando es undefined.
      expect(Object.keys({ avatarUrl: undefined, ...res.body }).sort()).toEqual(ME_KEYS);
      expect(res.body.hasPassword).toBe(true);
      expect(res.body.mustChangePassword).toBe(false);
      expect(['user', 'google', 'derived']).toContain(res.body.nameSource);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('sin contraseña (passwordHash NULL, cuenta solo-Google) ⇒ hasPassword=false con la misma sesión', async () => {
      await h.prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
      try {
        const res = await h.api('GET', '/users/me', { token });
        expect(res.status).toBe(200);
        expect(res.body.hasPassword).toBe(false);
      } finally {
        await h.prisma.user.update({ where: { id: userId }, data: { passwordHash: original.passwordHash } });
      }
    });

    it('con mustChangePassword=true: GET /users/me sigue en 200 (allowlist) y PATCH /users/me ⇒ 403 PASSWORD_CHANGE_REQUIRED', async () => {
      await h.prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
      try {
        const get = await h.api('GET', '/users/me', { token });
        expect(get.status).toBe(200);
        expect(get.body.mustChangePassword).toBe(true);
        const patch = await h.api('PATCH', '/users/me', { token, json: { name: 'No Debe Pasar' } });
        expect(patch.status).toBe(403);
        expect(patch.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
        const addresses = await h.api('GET', '/users/me/addresses', { token });
        expect(addresses.status).toBe(403);
      } finally {
        await h.prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } });
      }
    });
  });

  describe('PATCH /users/me', () => {
    it('name con espacios ⇒ se recorta, nameSource pasa de derived a user, y la respuesta tiene la forma del GET', async () => {
      await h.prisma.user.update({ where: { id: userId }, data: { nameSource: 'derived' } });
      const res = await h.api('PATCH', '/users/me', { token, json: { name: '  Juan Carlos Sainz  ', nameSource: 'google' } });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Juan Carlos Sainz');
      expect(res.body.nameSource).toBe('user'); // el `nameSource` del body se descarta (whitelist)
      expect(Object.keys({ avatarUrl: undefined, ...res.body }).sort()).toEqual(ME_KEYS);
      const row = await h.prisma.user.findUnique({ where: { id: userId } });
      expect(row!.name).toBe('Juan Carlos Sainz');
      expect(row!.nameSource).toBe('user');
    });

    it('phone solo ⇒ no toca nameSource', async () => {
      await h.prisma.user.update({ where: { id: userId }, data: { nameSource: 'google' } });
      const res = await h.api('PATCH', '/users/me', { token, json: { phone: '5599990000' } });
      expect(res.status).toBe(200);
      expect(res.body.nameSource).toBe('google');
      await h.prisma.user.update({ where: { id: userId }, data: { phone: E2E_USERS.customer2.phone } });
    });

    it.each([['vacío', ''], ['solo espacios', '   '], ['121 chars', 'x'.repeat(121)]])(
      'name %s ⇒ 400 VALIDATION_ERROR details.field=name y el nombre no cambia',
      async (_l, name) => {
        const before = (await h.prisma.user.findUnique({ where: { id: userId } }))!.name;
        const res = await h.api('PATCH', '/users/me', { token, json: { name } });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.field).toBe('name');
        expect((await h.prisma.user.findUnique({ where: { id: userId } }))!.name).toBe(before);
      },
    );
  });

  describe('libreta de direcciones con recipientName', () => {
    let createdId: string;

    it('POST sin recipientName ⇒ 400 VALIDATION_ERROR (no se crea, no se deriva de User.name)', async () => {
      const before = await h.prisma.address.count({ where: { userId } });
      const res = await h.api('POST', '/users/me/addresses', { token, json: MX_ADDRESS });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await h.prisma.address.count({ where: { userId } })).toBe(before);
    });

    it('POST con recipientName vacío ⇒ 400 VALIDATION_ERROR details.field=recipientName', async () => {
      const res = await h.api('POST', '/users/me/addresses', { token, json: { ...MX_ADDRESS, recipientName: '   ' } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.field).toBe('recipientName');
    });

    it('POST con recipientName ⇒ 201 con AddressDTO completo y el nombre recortado', async () => {
      const res = await h.api('POST', '/users/me/addresses', {
        token,
        json: { ...MX_ADDRESS, recipientName: '  Oficina Roma  ' },
      });
      expect(res.status).toBe(201);
      expect(res.body.recipientName).toBe('Oficina Roma');
      expect(Object.keys(res.body).sort()).toEqual(ADDRESS_KEYS);
      expect(res.body).not.toHaveProperty('userId');
      createdId = res.body.id;
    });

    it('GET lista: toda fila trae la clave recipientName (string en la nueva, null en las anteriores a M-52)', async () => {
      const res = await h.api('GET', '/users/me/addresses', { token });
      expect(res.status).toBe(200);
      for (const a of res.body.data as any[]) {
        expect(a).toHaveProperty('recipientName');
        expect(a.recipientName === null || typeof a.recipientName === 'string').toBe(true);
      }
      expect((res.body.data as any[]).find((a) => a.id === createdId).recipientName).toBe('Oficina Roma');
    });

    it.each([['""', ''], ['null', null], ['121 chars', 'x'.repeat(121)]])(
      'PATCH recipientName %s ⇒ 400 y la dirección conserva su destinatario (no vaciable)',
      async (_l, recipientName) => {
        const res = await h.api('PATCH', `/users/me/addresses/${createdId}`, { token, json: { recipientName } });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.field).toBe('recipientName');
        const row = await h.prisma.address.findUnique({ where: { id: createdId } });
        expect(row!.recipientName).toBe('Oficina Roma');
      },
    );

    it('PATCH recipientName válido ⇒ 200 y se persiste recortado', async () => {
      const res = await h.api('PATCH', `/users/me/addresses/${createdId}`, { token, json: { recipientName: ' Recepción ' } });
      expect(res.status).toBe(200);
      expect(res.body.recipientName).toBe('Recepción');
    });
  });
});
