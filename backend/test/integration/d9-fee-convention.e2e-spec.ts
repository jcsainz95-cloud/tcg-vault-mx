/**
 * d9-fee-convention.e2e-spec.ts — D9 (docs/specs/D9_COMISION.md §6) contra Postgres REAL + webhook Stripe firmado.
 * C2 (pedido nuevo = ΣP + envío, FEE_INCLUDED, comisión 0, el PaymentIntent cobra eso), costo real de Stripe guardado una vez
 * (idempotente), C8 (fila FEE_ON_TOP intacta), C10 (migración: backfill, 0 NULL, NOT NULL sin default; crear sin convención falla).
 * Determinista (N=1 por caso).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AdminService } from '../../src/modules/admin/admin.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { E2E_FOLIOS } from '../../prisma/e2e-fixtures';

jest.setTimeout(60_000);

const RUN = Date.now().toString(36);
const ADDRESS = {
  line1: 'Av. Reforma 100', line2: 'Depto 3', neighborhood: 'Juárez', city: 'Ciudad de México', state: 'CDMX',
  postalCode: '06600', country: 'MX', recipientName: 'Invitado D9', phone: '5512345678',
};
const SHIPPING_DISPLAY = 10000;
const ROLLBACK = Symbol('rollback');

describe('D9 · comisión de plataforma dentro del precio (Postgres real)', () => {
  let h: E2EHarness;
  let itemId: string;
  let orderId: string;
  let piId: string;
  let total: number;
  let unitPrice: number;

  beforeAll(async () => {
    h = await E2EHarness.create();
    (h.app.get(PaymentsService) as unknown as { feeRetryDelaysMs: number[] }).feeRetryDelaysMs = [5, 5]; // reintentos de 8.3 acelerados
    await seedE2E(h.prisma);
    const tpl = await h.prisma.inventoryItem.findUnique({ where: { folio: E2E_FOLIOS.listedCharizard } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = tpl as never as Record<string, unknown>;
    void _id; void _c; void _u;
    const created = await h.prisma.inventoryItem.create({ data: { ...(rest as object), folio: `E2E-D9-${RUN}`, status: 'listed' } as never });
    itemId = created.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('C2: la sesión de invitado cobra ΣP + envío; la fila nace FEE_INCLUDED con comisión 0 y costo de Stripe sin leer', async () => {
    const q = await h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [itemId], shippingAddress: ADDRESS } });
    expect(q.status).toBe(200);
    unitPrice = q.body.items[0].unitPriceCents;
    expect(unitPrice % 100).toBe(0); // P al peso hacia arriba (precio calculado de catálogo)
    const s = await h.api('POST', '/checkout/guest/session', {
      json: { inventoryItemIds: [itemId], email: `d9.${RUN}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' },
    });
    expect(s.status).toBe(201);
    orderId = s.body.orderId;
    // D9-4: valor exacto de P, con la fórmula escrita aparte (no la del código): P = ceilPeso(M / 0.95824), M = L × 1.16 (dial 100 %), con 0.95824 = 1 − 0.036 × 1.16.
    const oi = await h.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    // mercado 100000 (fixture) × margen del tramo gte_300 (+15 %) = L; M = L × 1.16 (traslación 100 %).
    expect(oi.marketMxnCents).toBe(100_000);
    const M = Math.round(oi.marketMxnCents! * 1.15 * 1.16);
    expect(unitPrice).toBe(Math.ceil(M / 100 / 0.95824 - 1e-9) * 100);
    expect(unitPrice).toBeGreaterThan(M);
    piId = s.body.stripe.paymentIntentId;
    total = s.body.breakdown.totalCents;
    expect(s.body.breakdown).toMatchObject({ subtotalCents: unitPrice, shippingFeeCents: SHIPPING_DISPLAY, processingFeeCents: 0, totalCents: unitPrice + SHIPPING_DISPLAY });
    expect(q.body.breakdown.totalCents).toBe(total); // quote y sesión dan igual total (D9-2)
    const row = await h.prisma.order.findUnique({ where: { id: orderId } });
    expect(row).toMatchObject({ feeConvention: 'FEE_INCLUDED', processingFeeCents: 0, totalCents: total, stripeFeeCents: null });
    const intents = h.stripe.createdIntents.filter((i) => i.metadata.orderId === orderId);
    expect(intents).toHaveLength(1);
    expect(intents[0].amountCents).toBe(unitPrice + SHIPPING_DISPLAY);
  });

  it('al liquidar se guarda el costo REAL de Stripe; el reintento del webhook no lo pisa', async () => {
    h.stripe.stripeFeeCentsToReturn = 1204;
    const ev = (id: string) => ({
      id,
      type: 'payment_intent.succeeded',
      data: { object: { id: piId, object: 'payment_intent', amount: total, amount_received: total, currency: 'mxn' } },
    });
    expect((await h.sendStripeWebhook(ev(`evt_d9_${RUN}_1`) as never)).status).toBe(200);
    expect((await h.prisma.order.findUnique({ where: { id: orderId } }))!).toMatchObject({ status: 'settled', stripeFeeCents: 1204 });
    h.stripe.stripeFeeCentsToReturn = 9999;
    expect((await h.sendStripeWebhook(ev(`evt_d9_${RUN}_2`) as never)).status).toBe(200);
    expect((await h.prisma.order.findUnique({ where: { id: orderId } }))!.stripeFeeCents).toBe(1204);
    h.stripe.stripeFeeCentsToReturn = null;
  });

  it('C8: una fila previa (FEE_ON_TOP) liquida igual y NO recibe `stripeFeeCents` (su comisión sigue siendo `processingFeeCents`)', async () => {
    const tpl = await h.prisma.inventoryItem.findUnique({ where: { folio: E2E_FOLIOS.listedCharizard } });
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = tpl as never as Record<string, unknown>;
    void _i; void _c; void _u;
    const item = await h.prisma.inventoryItem.create({ data: { ...(rest as object), folio: `E2E-D9-OLD-${RUN}`, status: 'listed' } as never });
    const s = await h.api('POST', '/checkout/guest/session', {
      json: { inventoryItemIds: [item.id], email: `d9.old.${RUN}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' },
    });
    expect(s.status).toBe(201);
    await h.prisma.order.update({ where: { id: s.body.orderId }, data: { feeConvention: 'FEE_ON_TOP' } });
    h.stripe.stripeFeeCentsToReturn = 555;
    const total0 = s.body.breakdown.totalCents;
    const res = await h.sendStripeWebhook({
      id: `evt_d9_old_${RUN}`,
      type: 'payment_intent.succeeded',
      data: { object: { id: s.body.stripe.paymentIntentId, object: 'payment_intent', amount: total0, amount_received: total0, currency: 'mxn' } },
    } as never);
    h.stripe.stripeFeeCentsToReturn = null;
    expect(res.status).toBe(200);
    expect(await h.prisma.order.findUnique({ where: { id: s.body.orderId } })).toMatchObject({ status: 'settled', feeConvention: 'FEE_ON_TOP', stripeFeeCents: null });
  });

  it('captureStripeFee (directo): escribe UNA vez, no pisa un valor ya guardado y no toca filas FEE_ON_TOP', async () => {
    const svc = h.app.get(PaymentsService) as unknown as { captureStripeFee: (k: 'order' | 'shipment', id: string, pi: string | null) => Promise<void> };
    const fresh = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await h.prisma.order.update({ where: { id: orderId }, data: { stripeFeeCents: null } });
    h.stripe.stripeFeeCentsToReturn = 700;
    await svc.captureStripeFee('order', orderId, fresh.stripePaymentIntentId);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBe(700);
    h.stripe.stripeFeeCentsToReturn = 800; // segunda lectura distinta: NO pisa
    await svc.captureStripeFee('order', orderId, fresh.stripePaymentIntentId);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBe(700);
    // fila previa: ni siquiera con NULL se le escribe
    await h.prisma.order.update({ where: { id: orderId }, data: { feeConvention: 'FEE_ON_TOP', stripeFeeCents: null } });
    await svc.captureStripeFee('order', orderId, fresh.stripePaymentIntentId);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBeNull();
    // sin dato de Stripe (null) ⇒ no escribe nada (jamás 0)
    await h.prisma.order.update({ where: { id: orderId }, data: { feeConvention: 'FEE_INCLUDED' } });
    h.stripe.stripeFeeCentsToReturn = null;
    await svc.captureStripeFee('order', orderId, fresh.stripePaymentIntentId);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBeNull();
    await h.prisma.order.update({ where: { id: orderId }, data: { stripeFeeCents: 1204 } });
  });

  it('8.3: si Stripe aún no lo tiene, 2 reintentos en segundo plano lo guardan sin bloquear (el primero devuelve null)', async () => {
    const svc = h.app.get(PaymentsService) as unknown as { captureStripeFee: (k: 'order' | 'shipment', id: string, pi: string | null) => Promise<void>; feeRetryDelaysMs: number[]; feeRetries: Set<Promise<void>> };
    const fresh = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await h.prisma.order.update({ where: { id: orderId }, data: { stripeFeeCents: null } });
    await Promise.all([...svc.feeRetries]); // los reintentos de pruebas anteriores (null) ya terminaron
    svc.feeRetryDelaysMs = [5, 5];
    h.stripe.stripeFeeCentsToReturn = null;
    await svc.captureStripeFee('order', orderId, fresh.stripePaymentIntentId); // vuelve YA, sin esperar los reintentos
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBeNull();
    expect(svc.feeRetries.size).toBe(1);
    h.stripe.stripeFeeCentsToReturn = 321; // Stripe ya lo tiene
    await Promise.all([...svc.feeRetries]);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBe(321);
    h.stripe.stripeFeeCentsToReturn = null;
  });

  it('8.3: la conciliación rellena solo FEE_INCLUDED con cobro de los últimos 30 días; un fee real de 0 se guarda; sin dato queda NULL', async () => {
    const svc = h.app.get(PaymentsService);
    const base = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    // (a) elegible, Stripe devuelve 0 ⇒ se guarda 0 (no se confunde con «sin dato»)
    await h.prisma.order.update({ where: { id: orderId }, data: { stripeFeeCents: null } });
    h.stripe.stripeFeeCentsToReturn = 0;
    const r1 = await svc.reconcileStripeFees();
    expect(r1.filled).toBeGreaterThanOrEqual(1);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBe(0);
    // (b) sin dato ⇒ queda NULL y se cuenta como faltante
    await h.prisma.order.update({ where: { id: orderId }, data: { stripeFeeCents: null } });
    h.stripe.stripeFeeCentsToReturn = null;
    const r2 = await svc.reconcileStripeFees();
    expect(r2.missing).toBeGreaterThanOrEqual(1);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBeNull();
    // (c) más de 30 días, FEE_ON_TOP y total 0 ⇒ ni se leen
    h.stripe.stripeFeeCentsToReturn = 555;
    await h.prisma.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) } });
    await svc.reconcileStripeFees();
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBeNull();
    await h.prisma.order.update({ where: { id: orderId }, data: { createdAt: base.createdAt, feeConvention: 'FEE_ON_TOP' } });
    await svc.reconcileStripeFees();
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBeNull();
    // (d) vuelve a elegible ⇒ se rellena (idempotente: una segunda vuelta no la pisa)
    await h.prisma.order.update({ where: { id: orderId }, data: { feeConvention: 'FEE_INCLUDED' } });
    await svc.reconcileStripeFees();
    h.stripe.stripeFeeCentsToReturn = 999;
    await svc.reconcileStripeFees();
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stripeFeeCents).toBe(555);
    h.stripe.stripeFeeCentsToReturn = null;
    await h.prisma.order.update({ where: { id: orderId }, data: { stripeFeeCents: 1204 } });
  });

  it('C10: 0 filas NULL, columna NOT NULL sin default, y crear sin `feeConvention` revienta (Order y ShipmentRequest)', async () => {
    for (const t of ['Order', 'ShipmentRequest']) {
      const nulls = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}" WHERE "feeConvention" IS NULL`);
      expect(Number(nulls[0].n)).toBe(0);
      const col = await h.prisma.$queryRaw<{ is_nullable: string; column_default: string | null }[]>`
        SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${t} AND column_name = 'feeConvention'`;
      expect(col).toEqual([{ is_nullable: 'NO', column_default: null }]);
      const sf = await h.prisma.$queryRaw<{ is_nullable: string }[]>`
        SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${t} AND column_name = 'stripeFeeCents'`;
      expect(sf).toEqual([{ is_nullable: 'YES' }]);
    }
    await expect(
      h.prisma.order.create({
        data: { orderNumber: `D9-NOFEE-${RUN}`, fulfillmentMode: 'vault', status: 'pending', subtotalCents: 1, processingFeeCents: 0, ivaCents: 0, totalCents: 1, priceConvention: 'IVA_INCLUSIVE' } as never,
      }),
    ).rejects.toThrow();
  });

  it('C10/C8: la migración rellena TODA fila existente con FEE_ON_TOP sin tocar un importe (texto de M-100 sobre estado previo, transacción deshecha)', async () => {
    const dir = readdirSync(join(__dirname, '..', '..', 'prisma', 'migrations')).find((d) => /_m100_fee_convention$/.test(d))!;
    const sql = readFileSync(join(__dirname, '..', '..', 'prisma', 'migrations', dir, 'migration.sql'), 'utf8').replace(/^\s*--.*$/gm, '');
    const stmts = sql.split(';').map((x) => x.trim()).filter(Boolean);
    const before = await h.prisma.order.findUnique({ where: { id: orderId }, select: { subtotalCents: true, processingFeeCents: true, totalCents: true } });
    await expect(
      h.prisma.$transaction(async (tx) => {
        // Estado ANTERIOR a la migración: sin las columnas ni el enum.
        await tx.$executeRawUnsafe(`ALTER TABLE "Order" DROP COLUMN "feeConvention", DROP COLUMN "stripeFeeCents"`);
        await tx.$executeRawUnsafe(`ALTER TABLE "ShipmentRequest" DROP COLUMN "feeConvention", DROP COLUMN "stripeFeeCents"`);
        await tx.$executeRawUnsafe(`DROP TYPE "FeeConvention"`);
        for (const st of stmts) await tx.$executeRawUnsafe(st);
        const bad = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "Order" WHERE "feeConvention" <> 'FEE_ON_TOP'`);
        expect(Number(bad[0].n)).toBe(0);
        const mine = await tx.$queryRawUnsafe<{ s: number; f: number; t: number; c: string }[]>(
          `SELECT "subtotalCents" s, "processingFeeCents" f, "totalCents" t, "feeConvention"::text c FROM "Order" WHERE id = '${orderId}'`,
        );
        expect(mine[0]).toEqual({ s: before!.subtotalCents, f: before!.processingFeeCents, t: before!.totalCents, c: 'FEE_ON_TOP' });
        // Idempotencia de lo que SÍ es re-ejecutable: el backfill no encuentra nada que rellenar.
        const again = await tx.$executeRawUnsafe(`UPDATE "Order" SET "feeConvention" = 'FEE_ON_TOP' WHERE "feeConvention" IS NULL`);
        expect(again).toBe(0);
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    void randomUUID;
  });
  it('spec §5: `pnlReport.feeIncludedSince` = MIN(createdAt) de los pedidos FEE_INCLUDED (ISO), null si no hay; con periodo ajeno no cambia', async () => {
    const admin = h.app.get(AdminService);
    const min = await h.prisma.order.aggregate({ where: { feeConvention: 'FEE_INCLUDED' }, _min: { createdAt: true } });
    expect(min._min.createdAt).not.toBeNull(); // este spec creó pedidos FEE_INCLUDED
    const r = await admin.pnlReport();
    expect(r.feeIncludedSince).toBe(min._min.createdAt!.toISOString());
    expect((await admin.pnlReport('2001-01-01', '2001-01-31')).feeIncludedSince).toBe(r.feeIncludedSince);
    // sin pedidos FEE_INCLUDED ⇒ null (se simula pasando todos a FEE_ON_TOP dentro de una transacción que se revierte)
    const ROLL = new Error('rollback');
    await expect(
      h.prisma.$transaction(async (tx) => {
        await tx.order.updateMany({ where: { feeConvention: 'FEE_INCLUDED' }, data: { feeConvention: 'FEE_ON_TOP' } });
        const spy = jest.spyOn(h.prisma.order, 'aggregate').mockImplementation(((a: never) => tx.order.aggregate(a)) as never);
        try {
          expect((await admin.pnlReport()).feeIncludedSince).toBeNull();
        } finally {
          spy.mockRestore();
        }
        throw ROLL;
      }),
    ).rejects.toBe(ROLL);
  });
});
