/**
 * shipments-in-person.e2e-spec.ts — §PERSONA «Entregado en persona» contra Postgres REAL (DECISIONES §PERSONA, pruebas mínimas).
 * Propiedad: backend.
 */
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { pnlBuckets } from '../../src/modules/admin/pnl-core';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ShipmentTrackingPollJob } from '../../src/modules/shipments/tracking-poll.job';
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

  it('AG-25: flete > 0 y actor no dueño ⇒ 1 aviso immediate ag25:<id> con facts completos, correo enviado y sin PII; repetir no duplica; dueño ⇒ ninguno', async () => {
    const admin = await h.prisma.user.findUniqueOrThrow({ where: { email: 'admin@e2e.local' } });
    await h.prisma.user.update({ where: { id: admin.id }, data: { isOwner: true } });
    try {
      const d = await db.mkDirect({ userId: (await db.mkUser('Cliente AG25')).id });
      for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
      expect((await db.prepare(d.shipment.id, 0)).status).toBe(200);
      expect((await post(d.shipment.id)).status).toBe(200);
      expect((await post(d.shipment.id)).status).toBe(200);
      const rows = await h.prisma.spendAlert.findMany({ where: { kind: 'in_person_with_fee', shipmentRequestId: d.shipment.id } });
      expect(rows).toHaveLength(1);
      const done = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } });
      expect(rows[0]).toMatchObject({ severity: 'immediate', dedupKey: `ag25:${d.shipment.id}`, amountCents: 15000, subjectUserId: db.operatorId, occurrenceCount: 1, mailStatus: 'sent' });
      expect(rows[0].facts).toEqual({
        shippingFeeChargedCents: 15000,
        folio: done.folio,
        actorUserId: db.operatorId,
        deliveredAt: done.deliveredAt!.toISOString(),
        fulfillment: 'direct_ship',
      });
      expect(JSON.stringify(rows[0].facts)).not.toMatch(/@|Cliente|Destinatario/);
      const mail = bandeja.filter((m) => /envío|shipment/i.test(m.subject + m.text) && m.to === admin.email);
      expect(mail.length).toBeGreaterThanOrEqual(1);
      expect(mail[0].text).toContain(`envío ${done.folio}`);
      // total de la bandeja del cliente: UN correo (AV-20), ningún AV-4/AV-5
      expect(bandeja.filter((m) => m.to !== admin.email)).toHaveLength(1);
      // dueño ⇒ solo bitácora
      const d2 = await preparedDirect();
      expect((await post(d2.shipment.id, db.adminToken)).status).toBe(200);
      expect(await h.prisma.spendAlert.count({ where: { kind: 'in_person_with_fee', shipmentRequestId: d2.shipment.id } })).toBe(0);
    } finally {
      await h.prisma.user.update({ where: { id: admin.id }, data: { isOwner: false } });
    }
  });

  it('retiro: AG-25 con fulfillment vault_withdrawal y flete de la fila del envío', async () => {
    const u = await db.mkUser('Cliente Retiro AG25');
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { placement: 'placed', locationId: drawer.id });
    const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id], 'picking', { picked: true, prepared: true });
    expect((await post(w.shipment.id)).status).toBe(200);
    const [row] = await h.prisma.spendAlert.findMany({ where: { kind: 'in_person_with_fee', shipmentRequestId: w.shipment.id } });
    expect(row.amountCents).toBe(20300);
    expect(row.facts).toMatchObject({ fulfillment: 'vault_withdrawal', shippingFeeChargedCents: 20300 });
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

  // ---- gate §PERSONA (seguridad PERS-1/PERS-2, qa QA-PER-*) ----
  it('PERS-1: POST × /tracking, 30 carreras ⇒ jamás entregado/manual, jamás 500; el que pierde recibe 409', async () => {
    let tracked = 0;
    let delivered = 0;
    for (let i = 0; i < 30; i += 1) {
      const d = await preparedDirect();
      bandeja = [];
      const [a, b] = await Promise.all([post(d.shipment.id), db.tracking(d.shipment.id)]);
      expect([a.status, b.status].filter((x) => x >= 500)).toEqual([]);
      const row = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } });
      if (row.status === 'entregado') {
        delivered += 1;
        expect({ labelSource: row.labelSource, trackingNumber: row.trackingNumber }).toEqual({ labelSource: 'in_person', trackingNumber: null });
        expect(b.status).toBe(409);
        expect(avisos()).toHaveLength(1);
      } else {
        tracked += 1;
        expect(row).toMatchObject({ status: 'guia', labelSource: 'manual' });
        expect(a.status).toBe(409);
        expect(a.body.error.code).toBe('SHIPMENT_HAS_LABEL');
        expect(avisos()).toHaveLength(0);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[PERS-1] entregado=${delivered}/30 guia=${tracked}/30`);
  });

  it('PERS-1 secuencial: /tracking sobre una entrega en persona ⇒ 409 (no 500) y nada cambia', async () => {
    const d = await preparedDirect();
    expect((await post(d.shipment.id)).status).toBe(200);
    const r = await db.tracking(d.shipment.id);
    expect(r.status).toBe(409);
    const row = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } });
    expect({ status: row.status, labelSource: row.labelSource, trackingNumber: row.trackingNumber }).toEqual({ status: 'entregado', labelSource: 'in_person', trackingNumber: null });
  });

  it('QA-PER-FILTRO: ?labelSource=in_person devuelve SOLO entregas en persona y ?manual no las incluye', async () => {
    const d = await preparedDirect();
    expect((await post(d.shipment.id)).status).toBe(200);
    const other = await db.mkDirect({ userId: (await db.mkUser('Cliente Filtro')).id });
    const r = await h.api('GET', '/admin/shipments?labelSource=in_person&pageSize=100', { token: db.opToken });
    expect(r.status).toBe(200);
    const ids = (r.body.data ?? r.body.items ?? []).map((x: { id: string }) => x.id);
    expect(ids).toContain(d.shipment.id);
    expect(ids).not.toContain(other.shipment.id);
    const rows = (r.body.data ?? r.body.items) as { labelSource: string }[];
    expect(rows.every((x) => x.labelSource === 'in_person')).toBe(true);
    const man = await h.api('GET', '/admin/shipments?labelSource=manual&pageSize=100', { token: db.opToken });
    expect((man.body.data ?? man.body.items).map((x: { id: string }) => x.id)).not.toContain(d.shipment.id);
  });

  it('QA-PER-CHECK: el CHECK rechaza un aviso de entregado sin origen (labelSource NULL) y con origen manual', async () => {
    const d = await db.mkDirect({ userId: (await db.mkUser('Cliente Check')).id });
    await expect(h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { deliveredNoticeSentAt: new Date() } })).rejects.toThrow();
    await expect(h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { deliveredNoticeSentAt: new Date(), labelSource: 'manual' } })).rejects.toThrow();
  });

  it('QA-PER-GUIA: un envío en `guia` (sin número) ⇒ 409 SHIPMENT_HAS_LABEL', async () => {
    const d = await preparedDirect();
    expect((await db.status(d.shipment.id, 'guia')).status).toBe(200);
    const r = await post(d.shipment.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SHIPMENT_HAS_LABEL');
  });

  it('PERS-2: pedido no liquidado ⇒ 409 ORDER_NOT_SETTLED; cliente y proveedor ⇒ 403; sin sesión ⇒ 401', async () => {
    const d = await preparedDirect();
    await h.prisma.order.update({ where: { id: d.order.id }, data: { status: 'chargeback' } });
    const r = await post(d.shipment.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ORDER_NOT_SETTLED');
    expect((await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } })).status).toBe('picking');
    const d2 = await preparedDirect();
    const cust = await db.mkUser('Cliente Rol');
    const customer = await db.loginCustomer(cust.email!);
    expect((await post(d2.shipment.id, customer)).status).toBe(403);
    const sup = await db.mkUser('Proveedor Persona');
    await h.prisma.user.update({ where: { id: sup.id }, data: { role: 'supplier' } });
    const supplier = await h.prisma.supplier.create({ data: { userId: sup.id, email: sup.email!, businessName: `Tienda ${RUN}`, status: 'active', activatedAt: new Date() } });
    expect((await post(d2.shipment.id, await db.loginCustomer(sup.email!))).status).toBe(403);
    await h.prisma.supplier.delete({ where: { id: supplier.id } });
    expect((await h.api('POST', `/admin/shipments/${d2.shipment.id}/delivered-in-person`, { json: {} })).status).toBe(401);
    expect((await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d2.shipment.id } })).status).toBe('picking');
  });

  it('QA-PER-E2E: sondeo no toca la fila, y «por salir»/«guías por cancelar» la excluyen', async () => {
    const d = await preparedDirect();
    expect((await post(d.shipment.id)).status).toBe(200);
    const job = h.app.get(ShipmentTrackingPollJob);
    const polled = await job.run({ shipmentId: d.shipment.id }).catch((e: unknown) => e);
    if (!(polled instanceof Error)) expect((polled as { polled?: number }).polled ?? 0).toBe(0);
    const dep = await h.api('GET', '/admin/shipments/departure', { token: db.opToken });
    expect(JSON.stringify(dep.body)).not.toContain(d.shipment.id);
    const alerts = await h.api('GET', '/admin/shipments?alert=true&pageSize=100', { token: db.opToken });
    expect(JSON.stringify(alerts.body)).not.toContain(d.shipment.id);
  });

  it('QA-PER-AUDIT: la bitácora va dentro de la tx de la entrega (si falla, no hay entrega a medias)', async () => {
    const d = await preparedDirect();
    const audit = h.app.get(AuditService);
    expect((await post(d.shipment.id)).status).toBe(200);
    expect(await h.prisma.auditLog.count({ where: { action: 'shipment.delivered_in_person', entityId: d.shipment.id, actorUserId: db.operatorId } })).toBe(1);
    // rollback: un fallo al escribir la bitácora deshace la entrega y deja reintentar
    const d2 = await preparedDirect();
    await h.prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION public.zz_audit_down() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit down'; END $$ LANGUAGE plpgsql`);
    await h.prisma.$executeRawUnsafe(`CREATE TRIGGER zz_audit_down BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.action = 'shipment.delivered_in_person') EXECUTE FUNCTION public.zz_audit_down()`);
    let bad;
    try {
      bad = await post(d2.shipment.id);
    } finally {
      await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS zz_audit_down ON "AuditLog"`);
      await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.zz_audit_down()`);
    }
    expect(bad.status).toBeGreaterThanOrEqual(500);
    expect(audit).toBeDefined();
    expect((await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d2.shipment.id } })).status).toBe('picking');
    expect(await db.piece(d2.pieces[0].id).then((p) => p.status)).toBe('picking');
    expect((await post(d2.shipment.id)).status).toBe(200);
    expect(await h.prisma.auditLog.count({ where: { action: 'shipment.delivered_in_person', entityId: d2.shipment.id } })).toBe(1);
  });
});
