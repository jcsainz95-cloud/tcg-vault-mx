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

  describe('return-received (aislado; el dueño aún no lo confirma)', () => {
    const sent = async (n = 2) => {
      const r = await mkRetiro(n);
      expect((await db.status(r.shipmentId, 'enviado')).status).toBe(200);
      return r;
    };
    const url = (id: string) => `/admin/shipments/${id}/return-received`;

    it('2 envíos concurrentes ⇒ 1 reversa: withdrawn→in_custody, movimiento withdrawal_return, returnedAt, status intacto', async () => {
      const r = await sent();
      const rs = await Promise.all([post(url(r.shipmentId)), post(url(r.shipmentId))]);
      expect(rs.map((x) => x.status)).toEqual([200, 200]);
      expect(rs.map((x) => x.body.won).sort()).toEqual([false, true]);
      expect(rs.map((x) => x.body.restored).sort()).toEqual([0, 2]);
      for (const id of r.ids) {
        expect((await db.piece(id)).status).toBe('in_custody');
        expect((await moves(id)).filter((m) => m.reason === 'withdrawal_return')).toHaveLength(1);
      }
      const row = await db.shipment(r.shipmentId);
      expect(row.status).toBe('enviado'); // conserva su estado
      expect(row.returnedAt).not.toBeNull();
      expect(rs.find((x) => x.body.won)?.body.shipment.returnedAt).toBe(row.returnedAt!.toISOString());
      expect(await h.prisma.auditLog.count({ where: { action: 'shipment.return_received', entityId: r.shipmentId } })).toBe(1);
      expect((await post(url(r.shipmentId))).status).toBe(200); // idempotente
      expect((await moves(r.ids[0])).filter((m) => m.reason === 'withdrawal_return')).toHaveLength(1);
    });

    it('0 piezas restaurables y sin returnedAt ⇒ 409 RETURN_NOTHING_TO_RESTORE y cero escrituras', async () => {
      const r = await sent(1);
      await h.prisma.inventoryItem.update({ where: { id: r.ids[0] }, data: { ownerType: 'platform', ownerUserId: null } });
      const x = await post(url(r.shipmentId));
      expect([x.status, x.body.error.code]).toEqual([409, 'RETURN_NOTHING_TO_RESTORE']);
      expect((await db.shipment(r.shipmentId)).returnedAt).toBeNull();
      expect(await h.prisma.auditLog.count({ where: { action: 'shipment.return_received', entityId: r.shipmentId } })).toBe(0);
    });

    it('AG-28 abierto de ese envío ⇒ return-received lo resuelve', async () => {
      const r = await sent(2);
      const { SpendAlertsService } = await import('../../src/modules/spend-alerts/spend-alerts.service');
      await h.app.get(SpendAlertsService).raise(h.prisma, { kind: 'retiro_parcel_returned', severity: 'immediate', dedupKey: `ag28:${r.shipmentId}`, shipmentRequestId: r.shipmentId, orderId: null, amountCents: null, facts: { folio: 'F', carrierStatus: 'in_return', observedAt: new Date().toISOString(), pieceCount: 2 } }, new Date());
      expect((await post(url(r.shipmentId))).status).toBe(200);
      expect((await h.prisma.spendAlert.findFirstOrThrow({ where: { dedupKey: `ag28:${r.shipmentId}` } })).resolvedAt).not.toBeNull();
    });

    it('solo piezas withdrawn del dueño y no missing; envío directo, guia y cancelado ⇒ 409', async () => {
      const r = await sent(3);
      const other = await db.mkUser('Otro RS');
      const [good, foreign, lost] = r.ids;
      await h.prisma.inventoryItem.update({ where: { id: foreign }, data: { ownerUserId: other.id } });
      await h.prisma.inventoryItem.update({ where: { id: lost }, data: { status: 'lost' } });
      await h.prisma.shipmentItem.updateMany({ where: { shipmentRequestId: r.shipmentId, inventoryItemId: lost }, data: { prepStatus: 'missing', missingReason: 'not_found' } });
      // `foreign` quedó withdrawn al enviar solo si era del dueño: lo forzamos withdrawn para probar la guarda de dueño
      await h.prisma.inventoryItem.update({ where: { id: foreign }, data: { status: 'withdrawn' } });
      expect((await post(url(r.shipmentId))).status).toBe(200);
      expect((await db.piece(good)).status).toBe('in_custody');
      expect((await db.piece(foreign)).status).toBe('withdrawn');
      expect((await db.piece(lost)).status).toBe('lost');
      const g = await mkRetiro(1);
      const rg = await post(url(g.shipmentId));
      expect([rg.status, rg.body.error.code]).toEqual([409, 'RETURN_NOT_APPLICABLE']); // en guia
      expect((await db.piece(g.ids[0])).status).toBe('in_custody');
      const d = await db.mkDirect({ userId: (await db.mkUser('Directo RS')).id });
      expect((await post(url(d.shipment.id))).body.error.code).toBe('RETURN_NOT_APPLICABLE');
      expect((await post(url('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
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
