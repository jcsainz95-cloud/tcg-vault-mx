/**
 * retiro-salida.e2e-spec.ts — §RETIRO-SALIDA contra Postgres REAL (DECISIONES §RETIRO-SALIDA, «Pruebas mínimas»).
 * Las piezas de un retiro salen (`in_custody → withdrawn`) al pasar a `enviado`; `entregado` ya no las toca.
 * Propiedad: backend.
 */
import { PrismaClient } from '@prisma/client';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { ShipmentsService } from '../../src/modules/shipments/shipments.service';
import { SpendWatchService } from '../../src/modules/spend-alerts/spend-watch.service';
import { runBackfill } from '../../scripts/backfill-retiro-salida';

const RUN = `rs${Date.now().toString(36)}`;

describe('§RETIRO-SALIDA — las piezas de un retiro salen al ENVIARSE', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;
  const enviadoMails = () => bandeja.filter((m) => /camino|shipped|on its way/i.test(m.subject));
  const moves = (id: string) => h.prisma.inventoryMovement.findMany({ where: { itemId: id }, orderBy: { createdAt: 'asc' } });
  const post = (path: string, token = db.opToken) => h.api('POST', path, { token, json: {} });

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

  /** Retiro en `guia` (preparado, con guía a mano capturada hace `capturedHoursAgo`) con `n` piezas del cliente. */
  const mkRetiro = async (n = 2, capturedHoursAgo = 0) => {
    const u = await db.mkUser('Cliente RS');
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { prices: Array(n).fill(10000), placement: 'placed', locationId: drawer.id });
    const w = await db.mkWithdrawal(u.id, vo.pieces.map((p) => p.id), 'guia', { picked: true, prepared: true });
    await h.prisma.shipmentRequest.update({
      where: { id: w.shipment.id },
      data: { carrier: 'DHL', trackingNumber: `T-${RUN}-${w.shipment.id.slice(0, 6)}`, labelSource: 'manual', labelCapturedAt: new Date(Date.now() - capturedHoursAgo * 3_600_000) },
    });
    return { u, ids: vo.pieces.map((p) => p.id), shipmentId: w.shipment.id };
  };

  it('PATCH enviado en un retiro ⇒ piezas withdrawn, 1 movimiento por pieza; `entregado` después ⇒ 0 movimientos nuevos', async () => {
    const r = await mkRetiro();
    for (const id of r.ids) expect((await db.piece(id)).status).toBe('in_custody'); // en `guia` NO han salido
    expect((await db.status(r.shipmentId, 'enviado')).status).toBe(200);
    for (const id of r.ids) {
      expect(await db.piece(id)).toMatchObject({ status: 'withdrawn', ownerType: 'customer', ownerUserId: r.u.id });
      const mv = (await moves(id)).filter((m) => m.reason === 'withdrawal');
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ fromStatus: 'in_custody', toStatus: 'withdrawn', note: `shipment ${r.shipmentId} shipped` });
    }
    const before = await h.prisma.inventoryMovement.count({ where: { itemId: { in: r.ids } } });
    expect((await db.status(r.shipmentId, 'entregado')).status).toBe(200);
    expect(await h.prisma.inventoryMovement.count({ where: { itemId: { in: r.ids } } })).toBe(before);
    for (const id of r.ids) expect((await db.piece(id)).status).toBe('withdrawn');
  });

  it('10 PATCH enviado concurrentes ⇒ 1 movimiento por pieza y 1 correo', async () => {
    const r = await mkRetiro();
    const rs = await Promise.all(Array.from({ length: 10 }, () => db.status(r.shipmentId, 'enviado')));
    // el que llega tarde (lee `enviado` antes de reclamar) recibe 409 CONFLICT: conducta previa y no tocada; el ganador es uno solo.
    expect(rs.filter((x) => x.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(rs.every((x) => x.status === 200 || x.status === 409)).toBe(true);
    for (const id of r.ids) expect((await moves(id)).filter((m) => m.reason === 'withdrawal')).toHaveLength(1);
    expect(enviadoMails()).toHaveLength(1);
  });

  it('sondeo/«Salida de hoy» (transitionFromProvider) dos veces ⇒ idempotente: 1 movimiento por pieza', async () => {
    const r = await mkRetiro();
    const svc = h.app.get(ShipmentsService);
    const run = () => h.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${r.shipmentId} FOR UPDATE`;
      return svc.transitionFromProvider(tx, r.shipmentId, 'enviado', { now: new Date() });
    });
    expect((await run()).shipped).toBe(true);
    expect((await run()).shipped).toBe(false);
    for (const id of r.ids) {
      expect((await db.piece(id)).status).toBe('withdrawn');
      expect((await moves(id)).filter((m) => m.reason === 'withdrawal')).toHaveLength(1);
    }
  });

  it('pieza `lost`/`missing` o de OTRO dueño ⇒ jamás pasa a withdrawn; la buena sí', async () => {
    const r = await mkRetiro(3);
    const other = await db.mkUser('Otro dueño RS');
    const [good, foreign, lost] = r.ids;
    await h.prisma.inventoryItem.update({ where: { id: foreign }, data: { ownerUserId: other.id } });
    await h.prisma.inventoryItem.update({ where: { id: lost }, data: { status: 'lost' } });
    await h.prisma.shipmentItem.updateMany({ where: { shipmentRequestId: r.shipmentId, inventoryItemId: lost }, data: { prepStatus: 'missing', missingReason: 'not_found' } });
    expect((await db.status(r.shipmentId, 'enviado')).status).toBe(200);
    expect((await db.piece(good)).status).toBe('withdrawn');
    expect((await db.piece(foreign)).status).toBe('in_custody');
    expect((await db.piece(lost)).status).toBe('lost');
    for (const id of [foreign, lost]) expect((await moves(id)).filter((m) => m.reason === 'withdrawal')).toHaveLength(0);
  });

  it('reembolso total del origen DESPUÉS de enviado ⇒ la pieza sigue withdrawn (already_withdrawn), sin refund_return', async () => {
    const r = await mkRetiro(1);
    expect((await db.status(r.shipmentId, 'enviado')).status).toBe(200);
    const order = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: r.ids[0] }, select: { id: true } });
    const oi = await h.prisma.orderItem.findFirstOrThrow({ where: { inventoryItemId: order.id }, select: { orderId: true } });
    const sin = await db.m3Refund(oi.orderId, { reason: 'x' });
    expect(sin.status).toBeGreaterThanOrEqual(400); // exige la confirmación explícita (ya salió)
    const ok = await db.m3Refund(oi.orderId, { reason: 'x', confirmPiecesWithCustomer: true });
    expect([200, 201]).toContain(ok.status);
    expect((await db.piece(r.ids[0])).status).toBe('withdrawn');
    expect((await moves(r.ids[0])).filter((m) => m.reason === 'refund_return')).toHaveLength(0);
  });

  it('deliverInPerson de un retiro ⇒ withdrawn UNA vez; 2 pulsaciones concurrentes ⇒ 1 movimiento por pieza', async () => {
    const u = await db.mkUser('Cliente RS persona');
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { placement: 'placed', locationId: drawer.id });
    const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id], 'picking', { picked: true, prepared: true });
    const path = `/admin/shipments/${w.shipment.id}/delivered-in-person`;
    const rs = await Promise.all([post(path), post(path)]);
    expect(rs.map((x) => x.status)).toEqual([200, 200]);
    expect((await db.piece(vo.pieces[0].id)).status).toBe('withdrawn');
    expect((await moves(vo.pieces[0].id)).filter((m) => m.reason === 'withdrawal')).toHaveLength(1);
  });

  // ================================================================ gates qa b70195d3 / seguridad 2c4ba1ac

  /** Retiro con 5 piezas: good, lostNotMissing, missingInCustody, foreign, platform (qa Q1). */
  const mkMatrix = async (status: 'guia' | 'picking' = 'guia') => {
    const u = await db.mkUser('RS matriz');
    const other = await db.mkUser('RS otro');
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { prices: Array(5).fill(10000), placement: 'placed', locationId: drawer.id });
    const w = await db.mkWithdrawal(u.id, vo.pieces.map((p) => p.id), status, { picked: true, prepared: true });
    if (status === 'guia') {
      await h.prisma.shipmentRequest.update({ where: { id: w.shipment.id }, data: { carrier: 'DHL', trackingNumber: `T-${RUN}-${w.shipment.id.slice(0, 6)}`, labelSource: 'manual' } });
    }
    const [good, lostNotMissing, missingInCustody, foreign, platform] = vo.pieces.map((p) => p.id);
    await h.prisma.inventoryItem.update({ where: { id: lostNotMissing }, data: { status: 'lost' } });
    await h.prisma.shipmentItem.updateMany({ where: { shipmentRequestId: w.shipment.id, inventoryItemId: missingInCustody }, data: { prepStatus: 'missing', missingReason: 'not_found' } });
    await h.prisma.inventoryItem.update({ where: { id: foreign }, data: { ownerUserId: other.id } });
    await h.prisma.inventoryItem.update({ where: { id: platform }, data: { ownerType: 'platform' } }); // ownerUserId sigue = dueño
    return { u, shipmentId: w.shipment.id, good, lostNotMissing, missingInCustody, foreign, platform };
  };
  const assertMatrix = async (m: Awaited<ReturnType<typeof mkMatrix>>) => {
    expect((await db.piece(m.good)).status).toBe('withdrawn');
    expect((await db.piece(m.lostNotMissing)).status).toBe('lost');
    for (const id of [m.missingInCustody, m.foreign, m.platform]) expect((await db.piece(id)).status).toBe('in_custody');
    for (const id of [m.lostNotMissing, m.missingInCustody, m.foreign, m.platform]) expect(await moves(id)).toHaveLength(0);
    expect((await moves(m.good)).filter((x) => x.reason === 'withdrawal')).toHaveLength(1);
  };

  describe('I2 — matriz de guardas separadas (lost sin missing, missing en custodia, plataforma, otro dueño)', () => {
    it('PATCH enviado y luego entregado ⇒ solo la buena sale, una vez', async () => {
      const m = await mkMatrix('guia');
      expect((await db.status(m.shipmentId, 'enviado')).status).toBe(200);
      await assertMatrix(m);
      expect((await db.status(m.shipmentId, 'entregado')).status).toBe(200);
      await assertMatrix(m);
    });
    it('deliverInPerson ⇒ misma matriz', async () => {
      const m = await mkMatrix('picking');
      expect((await post(`/admin/shipments/${m.shipmentId}/delivered-in-person`)).status).toBe(200);
      await assertMatrix(m);
    });
    it('retiro VIEJO (enviado con piezas in_custody) que pasa a entregado (B1) ⇒ sale la buena UNA vez; la matriz intacta', async () => {
      const m = await mkMatrix('guia');
      await h.prisma.shipmentRequest.update({ where: { id: m.shipmentId }, data: { status: 'enviado', shippedAt: new Date() } }); // regla vieja
      expect((await db.status(m.shipmentId, 'entregado')).status).toBe(200);
      await assertMatrix(m);
      expect((await moves(m.good)).find((x) => x.reason === 'withdrawal')?.note).toBe(`shipment ${m.shipmentId} delivered`);
    });
  });

  describe('AG-27 — guía manual sin marcar enviado (barrido; nunca mueve piezas)', () => {
    it('> 24 h ⇒ 1 aviso (2 corridas ⇒ 1), piezas intactas; < 24 h ⇒ ninguno; al enviarse se resuelve', async () => {
      const viejo = await mkRetiro(1, 25);
      const nuevo = await mkRetiro(1, 1);
      const watch = h.app.get(SpendWatchService);
      await watch.run();
      await watch.run();
      const rows = await h.prisma.spendAlert.findMany({ where: { kind: 'manual_label_unshipped', shipmentRequestId: { in: [viejo.shipmentId, nuevo.shipmentId] } } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ shipmentRequestId: viejo.shipmentId, dedupKey: `ag27:${viejo.shipmentId}`, severity: 'digest', resolvedAt: null });
      expect((await db.piece(viejo.ids[0])).status).toBe('in_custody');
      expect((await db.status(viejo.shipmentId, 'enviado')).status).toBe(200);
      await watch.run();
      expect((await h.prisma.spendAlert.findUniqueOrThrow({ where: { id: rows[0].id } })).resolvedAt).not.toBeNull();
    });

    it('I1: solo retiros (un directo con guía manual vieja ⇒ ninguno) y UNA vez por envío (resuelto y reabierto ⇒ no reavisa)', async () => {
      const d = await db.mkDirect({ userId: (await db.mkUser('Directo AG27')).id });
      await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { status: 'guia', preparedAt: new Date(), preparedByUserId: db.operatorId, carrier: 'DHL', trackingNumber: `TD-${RUN}`, labelSource: 'manual', labelCapturedAt: new Date(Date.now() - 30 * 3_600_000) } });
      const r = await mkRetiro(1, 30);
      const watch = h.app.get(SpendWatchService);
      await watch.run();
      expect(await h.prisma.spendAlert.count({ where: { kind: 'manual_label_unshipped', shipmentRequestId: d.shipment.id } })).toBe(0);
      expect(await h.prisma.spendAlert.count({ where: { kind: 'manual_label_unshipped', shipmentRequestId: r.shipmentId } })).toBe(1);
      await h.prisma.spendAlert.updateMany({ where: { kind: 'manual_label_unshipped', shipmentRequestId: r.shipmentId }, data: { resolvedAt: new Date() } });
      await watch.run();
      await watch.run();
      expect(await h.prisma.spendAlert.count({ where: { kind: 'manual_label_unshipped', shipmentRequestId: r.shipmentId } })).toBe(1);
    });

    it('capturar la guía a mano (POST tracking) sella labelCapturedAt', async () => {
      const u = await db.mkUser('Cliente RS tracking');
      const drawer = await db.mkDrawer();
      const vo = await db.mkVaultOrder(u.id, { placement: 'placed', locationId: drawer.id });
      const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id], 'picking', { picked: true, prepared: true });
      const res = await h.api('POST', `/admin/shipments/${w.shipment.id}/tracking`, { token: db.opToken, json: { carrier: 'DHL', trackingNumber: `TRK${RUN}` } });
      expect(res.status).toBeLessThan(300);
      expect((await db.shipment(w.shipment.id)).labelCapturedAt).not.toBeNull();
    });
  });

  describe('backfill-retiro-salida.ts', () => {
    const legacy = async () => {
      const r = await mkRetiro(2);
      await h.prisma.shipmentRequest.update({ where: { id: r.shipmentId }, data: { status: 'enviado', shippedAt: new Date() } }); // regla vieja: piezas in_custody
      return r;
    };
    const prisma = () => h.prisma as unknown as PrismaClient;

    it('--dry-run: 0 escrituras y lista el envío; --apply: mueve; 2.ª corrida ⇒ 0 movimientos; retiro en guia y piezas ajenas intactos', async () => {
      const a = await legacy();
      const enGuia = await mkRetiro(1);
      const ajeno = await legacy();
      const other = await db.mkUser('Otro backfill');
      await h.prisma.inventoryItem.update({ where: { id: ajeno.ids[0] }, data: { ownerUserId: other.id } });
      const snap = async () => ({ mv: await h.prisma.inventoryMovement.count(), it: JSON.stringify(await h.prisma.inventoryItem.findMany({ where: { id: { in: [...a.ids, ...enGuia.ids, ...ajeno.ids] } }, select: { id: true, status: true }, orderBy: { id: 'asc' } })) });
      const before = await snap();
      const dry = await runBackfill(prisma(), 'dry-run');
      expect(await snap()).toEqual(before);
      expect(dry.shipments.find((s) => s.shipmentId === a.shipmentId)).toMatchObject({ pieces: 2 });
      expect(dry.shipments.find((s) => s.shipmentId === enGuia.shipmentId)).toBeUndefined();
      const ap = await runBackfill(prisma(), 'apply');
      expect(ap.shipments.find((s) => s.shipmentId === a.shipmentId)).toMatchObject({ pieces: 2 });
      for (const id of a.ids) {
        expect((await db.piece(id)).status).toBe('withdrawn');
        const mv = (await moves(id)).filter((m) => m.reason === 'withdrawal');
        expect(mv).toHaveLength(1);
        expect(mv[0].note).toBe(`backfill RETIRO-SALIDA shipment ${a.shipmentId}`);
      }
      expect((await db.piece(enGuia.ids[0])).status).toBe('in_custody');
      expect((await db.piece(ajeno.ids[0])).status).toBe('in_custody'); // de otro dueño
      expect((await db.piece(ajeno.ids[1])).status).toBe('withdrawn');
      const mvAfter = await h.prisma.inventoryMovement.count();
      const again = await runBackfill(prisma(), 'apply');
      expect(again.piecesMoved).toBe(0);
      expect(await h.prisma.inventoryMovement.count()).toBe(mvAfter);
    });
  });
});
