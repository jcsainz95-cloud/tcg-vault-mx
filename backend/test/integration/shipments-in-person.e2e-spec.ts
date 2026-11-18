/**
 * shipments-in-person.e2e-spec.ts — §PERSONA «Entregado en persona» contra Postgres REAL (DECISIONES §PERSONA, pruebas mínimas).
 * Propiedad: backend.
 */
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { pnlBuckets } from '../../src/modules/admin/pnl-core';
import { ShipPrepDb } from './helpers/ship-prep-db';

const RUN = `ip${Date.now().toString(36)}`;

describe('§PERSONA — entregado en persona', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;
  const post = (id: string, token = db.opToken) => h.api('POST', `/admin/shipments/${id}/delivered-in-person`, { token, json: {} });
  const avisos = () => bandeja.filter((m) => /Tu pedido fue entregado/.test(m.subject));

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (m: MailMessage) => {
      bandeja.push(m);
      return {};
    });
  });
  afterAll(async () => {
    spy?.mockRestore();
    await db.cleanup();
    await h?.close();
  });
  beforeEach(() => {
    bandeja = [];
  });

  const preparedDirect = async () => {
    const d = await db.mkDirect({ userId: (await db.mkUser('Cliente Persona')).id });
    for (const l of d.lines) expect((await db.mark(d.shipment.id, l.id, { status: 'picked' })).status).toBe(200);
    expect((await db.prepare(d.shipment.id, 0)).status).toBe(200);
    return d;
  };

  it('directo: 2 POST concurrentes ⇒ 1 correo, 1 movimiento por pieza, shippedAt NULL, piezas delivered, auditoría', async () => {
    const d = await preparedDirect();
    const rs = await Promise.all([post(d.shipment.id), post(d.shipment.id)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    for (const r of rs) expect(r.body).toMatchObject({ status: 'entregado', labelSource: 'in_person' });
    const row = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } });
    expect(row).toMatchObject({ status: 'entregado', labelSource: 'in_person', shippedAt: null, trackingNumber: null });
    expect(row.deliveredAt).not.toBeNull();
    expect(row.deliveredNoticeSentAt).not.toBeNull();
    for (const p of d.pieces) {
      expect((await db.piece(p.id)).status).toBe('delivered');
      const mv = await h.prisma.inventoryMovement.findMany({ where: { itemId: p.id }, orderBy: { createdAt: 'asc' } });
      expect(mv.filter((m) => m.toStatus === 'shipped')).toHaveLength(1);
      expect(mv.filter((m) => m.toStatus === 'delivered')).toHaveLength(1);
    }
    expect(avisos()).toHaveLength(1);
    expect(await h.prisma.auditLog.count({ where: { action: 'shipment.delivered_in_person', entityId: d.shipment.id } })).toBe(1);
    // repetición posterior: idempotente, sin correo ni movimiento nuevo
    expect((await post(d.shipment.id)).status).toBe(200);
    expect(avisos()).toHaveLength(1);
  });

  it('sin «preparado» ⇒ 409 SHIPMENT_NOT_PREPARED y cero escrituras', async () => {
    const d = await db.mkDirect({ userId: (await db.mkUser('Cliente Persona 2')).id });
    const r = await post(d.shipment.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SHIPMENT_NOT_PREPARED');
    expect((await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } })).status).toBe('picking');
    expect(avisos()).toHaveLength(0);
  });

  it('con guía ⇒ 409 SHIPMENT_HAS_LABEL', async () => {
    const d = await db.mkDirect({ userId: (await db.mkUser('Cliente Persona 3')).id });
    await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { preparedAt: new Date(), preparedByUserId: db.operatorId, trackingNumber: 'T-1', carrier: 'DHL', labelSource: 'manual' } });
    const r = await post(d.shipment.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SHIPMENT_HAS_LABEL');
  });

  it('PATCH status picking→entregado sigue 409', async () => {
    const d = await preparedDirect();
    const r = await db.status(d.shipment.id, 'entregado');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CONFLICT');
  });

  it('retiro de bóveda: pieza in_custody→withdrawn y un correo', async () => {
    const u = await db.mkUser('Cliente Retiro');
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { placement: 'placed', locationId: drawer.id });
    const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id], 'picking', { picked: true, prepared: true });
    const r = await post(w.shipment.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'entregado', labelSource: 'in_person' });
    expect((await db.piece(vo.pieces[0].id)).status).toBe('withdrawn');
    expect(avisos()).toHaveLength(1);
  });

  it('fuera de sondeo / por salir / guías por cancelar, y P&L sin «costo faltante»', async () => {
    const d = await preparedDirect();
    expect((await post(d.shipment.id)).status).toBe(200);
    const dep = await h.api('GET', '/admin/shipments/departure', { token: db.opToken });
    expect(JSON.stringify(dep.body)).not.toContain(d.shipment.id);
    const alerts = await h.api('GET', '/admin/shipments?alert=true', { token: db.opToken });
    expect(JSON.stringify(alerts.body)).not.toContain(d.shipment.id);
    const missing = async () => (await pnlBuckets(h.prisma, undefined, () => 'all')).get('all')?.shippingCostMissingCount ?? 0;
    const withInPerson = await missing();
    // contraste: la MISMA fila como guía manual sin costo SÍ cuenta como «costo faltante» (+1); `in_person` no.
    await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { labelSource: 'manual', deliveredNoticeSentAt: null } });
    expect(await missing()).toBe(withInPerson + 1);
  });
});
