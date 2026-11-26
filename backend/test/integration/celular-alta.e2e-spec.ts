/**
 * celular-alta.e2e-spec.ts — §CELULAR-ALTA v2 (docs/API_CONTRACT_CELULAR.md §6) contra Postgres real: backfill diario
 * (idempotente, no pisa válidos, auditado), reclamo (copia / no pisa / 422 PHONE_REQUIRED), email-only y `google/complete`.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { VaultOrphansDb } from './helpers/vault-orphans-db';
import { UsersPhoneBackfillService } from '../../src/jobs/users-phone-backfill.service';

const RUN = Date.now().toString(36);

describe('§CELULAR-ALTA v2 — backfill, reclamo, alta solo-correo, google/complete', () => {
  let h: E2EHarness;
  let fx: VaultOrphansDb;
  const extraUsers: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    fx = new VaultOrphansDb(h, `ph${RUN}`);
    await fx.init();
  });
  afterAll(async () => {
    if (h) {
      await h.prisma.address.deleteMany({ where: { userId: { in: extraUsers } } });
      await fx.cleanup(extraUsers);
      await h.close();
    }
  });

  const mkUser = async (tag: string, phone: string | null) => {
    const u = await fx.user(tag);
    await h.prisma.user.update({ where: { id: u.id }, data: { phone } });
    return u;
  };
  const phoneOf = async (id: string) => (await h.prisma.user.findUniqueOrThrow({ where: { id } })).phone;

  it('backfill: pedido más reciente > dirección; no pisa válidos; basura no se copia; 2.ª corrida = 0 cambios; auditado enmascarado', async () => {
    const card = await fx.card('bf');
    const fromOrder = await mkUser('o', null);
    const fromAddr = await mkUser('a', '0000000000'); // basura
    const valid = await mkUser('v', '5587654321');
    const nothing = await mkUser('n', '');
    const junkOrder = await mkUser('j', null); // pedido con teléfono basura y dirección válida ⇒ dirección
    const piece = await fx.piece(card.id);
    const { order } = await fx.order({ userId: fromOrder.id, pieces: [piece], status: 'settled', pi: null });
    await h.prisma.order.update({ where: { id: order.id }, data: { shippingAddressSnapshot: { line1: 'x', phone: '+52 55-1111-2222' } } });
    const piece2 = await fx.piece(card.id);
    const { order: o2 } = await fx.order({ userId: junkOrder.id, pieces: [piece2], status: 'settled', pi: null });
    await h.prisma.order.update({ where: { id: o2.id }, data: { shippingAddressSnapshot: { line1: 'x', phone: '0000000000' } } });
    const addr = (userId: string, phone: string, isDefault = true) =>
      h.prisma.address.create({ data: { userId, recipientName: 'X', line1: 'Calle 1', neighborhood: 'Centro', city: 'CDMX', state: 'CDMX', postalCode: '06000', country: 'MX', phone, isDefault } });
    await addr(fromAddr.id, '5599998888');
    await addr(junkOrder.id, '5544443333');
    await addr(nothing.id, '123');
    extraUsers.push(fromOrder.id, fromAddr.id, valid.id, nothing.id, junkOrder.id);

    const svc = h.app.get(UsersPhoneBackfillService);
    const ids = [fromOrder.id, fromAddr.id, valid.id, nothing.id, junkOrder.id];
    const r1 = await svc.run({ onlyUserIds: ids });
    expect(r1).toEqual({ candidates: 4, filled: 3 });
    expect(await phoneOf(fromOrder.id)).toBe('5511112222');
    expect(await phoneOf(fromAddr.id)).toBe('5599998888');
    expect(await phoneOf(junkOrder.id)).toBe('5544443333');
    expect(await phoneOf(valid.id)).toBe('5587654321'); // no pisa válidos
    expect(await phoneOf(nothing.id)).toBe(''); // sin candidato válido ⇒ no hace nada
    const logs = await h.prisma.auditLog.findMany({ where: { action: 'user.phone.backfill', entityId: { in: ids } } });
    expect(logs).toHaveLength(3);
    expect(logs.find((l) => l.entityId === fromOrder.id)?.after).toEqual({ source: 'order', masked: '******2222', previousMasked: null });
    expect(JSON.stringify(logs)).not.toContain('5511112222');
    const r2 = await svc.run({ onlyUserIds: ids });
    expect(r2).toEqual({ candidates: 1, filled: 0 }); // idempotente: solo queda el que no tiene candidato
    expect(await h.prisma.auditLog.count({ where: { action: 'user.phone.backfill', entityId: { in: ids } } })).toBe(3);
  });

  describe('POST /orders/claim', () => {
    const guestOrder = async (email: string, snapshotPhone: string) => {
      const card = await fx.card('cl');
      const piece = await fx.piece(card.id);
      const { order } = await fx.order({ userId: null, pieces: [piece], status: 'settled', mode: 'direct_ship', pi: null, guestEmail: email });
      await h.prisma.order.update({ where: { id: order.id }, data: { shippingAddressSnapshot: { line1: 'x', phone: snapshotPhone } } });
      return order;
    };
    const asUser = async (tag: string, phone: string | null) => {
      const u = await mkUser(tag, phone);
      extraUsers.push(u.id);
      return { u, token: await h.login(u.email as string, E2E_USERS.customer.password) };
    };

    it('cuenta sin celular + pedido con celular válido ⇒ se copia en la misma operación; respuesta con phoneRequired:false', async () => {
      const { u, token } = await asUser('c1', null);
      const o = await guestOrder(u.email as string, '55 3333 4444');
      const res = await h.api('POST', '/orders/claim', { token, json: { orderIds: [o.id] } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ claimed: [o.id], phoneRequired: false });
      expect(await phoneOf(u.id)).toBe('5533334444');
      const log = await h.prisma.auditLog.findFirst({ where: { action: 'user.phone.backfill', entityId: u.id } });
      expect(log?.after).toEqual({ source: 'claim', masked: '******4444', previousMasked: null });
    });

    it('cuenta con celular válido ⇒ no se toca', async () => {
      const { u, token } = await asUser('c2', '5500001111');
      const o = await guestOrder(u.email as string, '5533334444');
      expect((await h.api('POST', '/orders/claim', { token, json: { orderIds: [o.id] } })).status).toBe(200);
      expect(await phoneOf(u.id)).toBe('5500001111');
    });

    it('ni cuenta ni pedido válidos ⇒ 422 PHONE_REQUIRED sin ligar nada; con `phone` en el cuerpo ⇒ liga y guarda', async () => {
      const { u, token } = await asUser('c3', null);
      const o = await guestOrder(u.email as string, '0000000000');
      const no = await h.api('POST', '/orders/claim', { token, json: { orderIds: [o.id] } });
      expect(no.status).toBe(422);
      expect(no.body.error).toMatchObject({ code: 'PHONE_REQUIRED', details: { field: 'phone' } });
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).userId).toBeNull();
      const bad = await h.api('POST', '/orders/claim', { token, json: { orderIds: [o.id], phone: '1234567890' } });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('PHONE_INVALID');
      const ok = await h.api('POST', '/orders/claim', { token, json: { orderIds: [o.id], phone: '+52 55 7777 8888' } });
      expect(ok.status).toBe(200);
      expect(ok.body.claimed).toEqual([o.id]);
      expect(await phoneOf(u.id)).toBe('5577778888');
    });
  });

  it('register/email-only exige celular válido; google/complete con token basura ⇒ 401 SIGNUP_EXPIRED', async () => {
    const email = `ph.eo.${RUN}@example.com`;
    const bad = await h.api('POST', '/auth/register/email-only', { json: { email } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('PHONE_INVALID');
    expect(await h.prisma.user.findUnique({ where: { email } })).toBeNull();
    const ok = await h.api('POST', '/auth/register/email-only', { json: { email, phone: '+52 55 1234 5679' } });
    expect(ok.status).toBe(201);
    extraUsers.push(ok.body.user.id);
    expect(await phoneOf(ok.body.user.id)).toBe('5512345679');
    const g = await h.api('POST', '/auth/google/complete', { json: { signupToken: 'basura', phone: '5512345679' } });
    expect(g.status).toBe(401);
    expect(g.body.error.code).toBe('SIGNUP_EXPIRED');
  });
});
