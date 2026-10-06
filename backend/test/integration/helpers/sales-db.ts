/**
 * sales-db.ts — 💰 la fixture de la analítica de ventas (§AN, API_CONTRACT §15.6) contra Postgres REAL. Propiedad: backend.
 *
 * Vive en una VENTANA PROPIA del calendario (febrero–marzo de **2021**, sin cambio de horario en México: el de 2021 empezó
 * el 4 de abril) para que ninguna otra suite caiga en ella: `pnl()`, `ivaReport()` y `launchMetrics()` barren TODA la base
 * por fecha. `assertWindowEmpty()` lo comprueba antes de sembrar (si otra suite cayera aquí, el cuadre mediría basura).
 *
 * IDs FIJOS (no aleatorios): la instantánea de AN-B-13 lleva `orderId` en el IVA, y una instantánea con ids aleatorios no
 * se puede comparar entre corridas. `seedSales()` borra antes lo que haya quedado de una corrida rota.
 *
 * El periodo P = **lunes 2021-03-01 … domingo 2021-03-07** (días de México). Lo que siembra, en llano:
 *
 * | Pedido | Quién | Cobrado (día MX, hora) | Convención / destino | subtotal · envío · IVA · comisión · total | Piezas | Después |
 * |---|---|---|---|---|---|---|
 * | O0  | A          | 2021-02-20 12:00 | EXCL · bóveda  |  7000 ·     0 · 1120 ·  400 ·  8520 | 1 | — (compra anterior: A recurrente) |
 * | O0b | B          | 2021-02-25 12:00 | EXCL · bóveda  |  9000 ·     0 · 1440 ·  450 · 10890 | 1 | — (periodo anterior de P) |
 * | O1  | A          | 03-01 lun 10:00  | EXCL · bóveda  | 10000 ·     0 · 1600 ·  500 · 12100 | 1 | — |
 * | O3  | B          | 03-01 lun 12:00  | INCL · bóveda  | 11601 ·     0 · 1600 ·  600 · 12201 | 1 | reembolso TOTAL el mié 03-03 ⇒ `refunded` |
 * | O2  | invitado g1| 03-01 lun 23:30  | INCL · directo | 23200 · 11600 · 4800 · 1500 · 36300 | 2 (misma carta, 2 acabados) | guía (picking 03-02), ajuste 03-06 |
 * | O4  | A          | 03-02 mar 00:10  | EXCL · bóveda  | 20000 ·     0 · 3200 ·  900 · 24100 | 2 (sellado + gradeada) | reembolso parcial por tarjeta (jue 03-04) |
 * | O5  | invitado g2| 03-05 vie 18:00  | EXCL · directo |  5000 ·     0 ·  800 ·  300 ·  6100 | 1 | contracargo ⇒ `chargeback` |
 * | O8  | invitado con el correo de B | 03-07 dom 20:00 | EXCL · directo | 3000 · 0 · 480 · 200 · 3680 | 1 | — (B recurrente) |
 * | O6/O7 | A        | sin cobrar (`failed` / `pending`) | — | — | 1 c/u | no cuentan |
 *
 * Además: un retiro de bóveda (S9, `enviado`, picking 03-04, sin costo capturado) con un SPEI `withdrawal_delivered` pagado
 * el sáb 03-06, un `ShipmentRequest` `solicitado` que no cuenta, un `PaymentRefund` `failed` del vie 03-05 (no cuenta), dos
 * `SellRequest` `pagada` (03-05 con `payoutNetCents = 40000`, 03-06 con `null`) y tres usuarios dados de alta el 2021-02-10.
 * (Invitado ⇒ siempre `direct_ship`: CHECK `Order_guest_is_direct_ship_chk`.)
 */
import type { PrismaClient } from '@prisma/client';
import { mxDayStart } from '../../../src/modules/spend-alerts/mx-day';

const P = 'a1e5a1e5-0000-4000-8000-';
const id = (n: number) => `${P}${String(n).padStart(12, '0')}`;

/** Ids fijos de la fixture. */
export const SID = {
  userA: id(1),
  userB: id(2),
  userC: id(3),
  set1: id(10),
  set2: id(11),
  cardX: id(20),
  cardY: id(21),
  cardZ: id(22),
  cardS: id(23),
  sealed: id(30),
  o0: id(100),
  o0b: id(101),
  o1: id(102),
  o3: id(103),
  o2: id(104),
  o4: id(105),
  o5: id(106),
  o8: id(107),
  o6: id(108),
  o7: id(109),
  s2: id(200),
  s9: id(201),
  sPending: id(202),
  s9line: id(203),
  adj: id(210),
  refO3: id(300),
  refO4: id(301),
  refFailed: id(302),
  mrO4: id(310),
  sr1: id(400),
  sr2: id(401),
  // Mayo de 2021 (`seedSalesMay`, horario de verano: UTC−5): AN-B-1/2/8.
  m1: id(501),
  m2: id(502),
  m3: id(503),
  m4: id(504),
  m5: id(505),
  m6: id(506),
  m7: id(507),
  m8: id(508),
  m9: id(509),
  m10: id(510),
  m11: id(511),
  w1: id(601),
  w2: id(602),
  w3: id(603),
  w4: id(604),
  w5: id(605),
  w6: id(606),
  w7: id(607),
  w8: id(608),
} as const;

export const EMAIL = {
  a: 'an-fixture-a@example.test',
  b: 'an-fixture-b@example.test',
  c: 'an-fixture-c@example.test',
  g1: 'an-fixture-g1@example.test',
  g2: 'an-fixture-g2@example.test',
};

/** Un instante a la hora `hh:mm` de México del día `ymd`. */
export function mx(ymd: string, hh: number, mm = 0): Date {
  return new Date(mxDayStart(ymd).getTime() + (hh * 60 + mm) * 60000);
}

/** La ventana que la fixture ocupa en exclusiva. */
export const WINDOW = { gte: new Date('2021-01-01T00:00:00.000Z'), lt: new Date('2021-06-01T00:00:00.000Z') };

/** Ninguna otra suite tiene filas de dinero en la ventana (si las tuviera, los cuadres medirían basura). */
export async function assertWindowEmpty(db: PrismaClient): Promise<void> {
  const w = WINDOW;
  const counts = await Promise.all([
    db.order.count({ where: { settledAt: w, NOT: { id: { startsWith: P } } } }),
    db.shipmentRequest.count({ where: { pickingAt: w, NOT: { id: { startsWith: P } } } }),
    db.shipmentCostAdjustment.count({ where: { chargedAt: w, NOT: { id: { startsWith: P } } } }),
    db.paymentRefund.count({ where: { submittedAt: w, NOT: { id: { startsWith: P } } } }),
    db.manualRefund.count({ where: { paidAt: w, NOT: { id: { startsWith: P } } } }),
    db.sellRequest.count({ where: { paidAt: w, NOT: { id: { startsWith: P } } } }),
    db.user.count({ where: { createdAt: w, role: 'customer', NOT: { id: { startsWith: P } } } }),
  ]);
  if (counts.some((c) => c > 0)) throw new Error(`sales-db: la ventana 2021 no está vacía (${counts.join(',')})`);
}

export async function cleanupSales(db: PrismaClient): Promise<void> {
  const ids = Object.values(SID);
  await db.manualRefund.deleteMany({ where: { id: { in: ids } } });
  await db.paymentRefund.deleteMany({ where: { id: { in: ids } } });
  await db.shipmentCostAdjustment.deleteMany({ where: { id: { in: ids } } });
  await db.shipmentItem.deleteMany({ where: { id: { in: ids } } });
  await db.shipmentRequest.deleteMany({ where: { id: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.inventoryItem.deleteMany({ where: { folio: { startsWith: 'AN-FIX-' } } });
  await db.sellRequest.deleteMany({ where: { id: { in: ids } } });
  await db.sealedProduct.deleteMany({ where: { id: { in: ids } } });
  await db.card.deleteMany({ where: { id: { in: ids } } });
  await db.cardSet.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

type Conv = 'IVA_EXCLUSIVE' | 'IVA_INCLUSIVE';
interface ItemSpec {
  card: string;
  productType: 'raw' | 'graded' | 'sealed';
  unit: number;
  acq: number;
  finish?: 'normal' | 'reverse_holo' | 'holofoil';
  sealedProductId?: string;
}

let folio = 0;
export async function mkOrder(
  db: PrismaClient,
  o: {
    id: string;
    userId?: string | null;
    guestEmail?: string | null;
    status: 'settled' | 'refunded' | 'chargeback' | 'failed' | 'pending';
    settledAt: Date | null;
    conv: Conv;
    mode?: 'vault' | 'direct_ship';
    subtotal: number;
    shipping?: number;
    iva: number;
    fee: number;
    total: number;
    items: ItemSpec[];
  },
): Promise<string[]> {
  await db.order.create({
    data: {
      id: o.id,
      userId: o.userId ?? null,
      guestEmail: o.guestEmail ?? null,
      orderNumber: `AN-FIX-${o.id.slice(-4)}`,
      status: o.status,
      settledAt: o.settledAt,
      createdAt: o.settledAt ?? mx('2021-03-03', 9),
      priceConvention: o.conv,
      fulfillmentMode: o.mode ?? 'vault',
      shippingAddressSnapshot: o.mode === 'direct_ship' ? { street: 'Calle Fixture 1', city: 'CDMX', postalCode: '01000' } : undefined,
      subtotalCents: o.subtotal,
      shippingFeeCents: o.shipping ?? 0,
      ivaCents: o.iva,
      processingFeeCents: o.fee,
      totalCents: o.total,
      ivaRatePct: 16,
    },
  });
  const itemIds: string[] = [];
  for (const it of o.items) {
    folio += 1;
    const inv = await db.inventoryItem.create({
      data: {
        folio: `AN-FIX-${o.id.slice(-4)}-${folio}`,
        cardId: it.card,
        productType: it.productType,
        acquisitionType: 'compra',
        acquisitionCostCents: it.acq,
        status: 'in_custody',
        finish: it.finish ?? 'normal',
        ...(it.productType === 'sealed' ? { sealedSubtype: 'box', sealedProductId: it.sealedProductId ?? null } : {}),
        ...(it.productType === 'graded' ? { gradingCompany: 'PSA', gradeValue: '10' } : {}),
        ...(it.productType === 'raw' ? { rawCondition: 'NM' } : {}),
      } as never,
    });
    const oi = await db.orderItem.create({
      data: { orderId: o.id, inventoryItemId: inv.id, cardSnapshot: { name: 'snapshot-con-nombre' }, unitPriceCents: it.unit, finish: it.finish ?? null },
    });
    itemIds.push(oi.id);
  }
  return itemIds;
}

/** Siembra la fixture (borrando antes lo que hubiera quedado). Devuelve los ids de los renglones por pedido. */
export async function seedSales(db: PrismaClient): Promise<Record<string, string[]>> {
  await cleanupSales(db);
  await assertWindowEmpty(db);
  const born = new Date('2021-02-10T18:00:00.000Z');
  await db.user.createMany({
    data: [
      { id: SID.userA, email: EMAIL.a, name: 'Ana Fixture Nombre', createdAt: born },
      { id: SID.userB, email: EMAIL.b, name: 'Beto Fixture Nombre', createdAt: born },
      { id: SID.userC, email: EMAIL.c, name: 'Caro Fixture Nombre', createdAt: born },
    ],
  });
  await db.cardSet.createMany({
    data: [
      { id: SID.set1, externalId: 'an-fix-set1', name: 'Set Uno AN' },
      { id: SID.set2, externalId: 'an-fix-set2', name: 'Set Dos AN' },
    ],
  });
  await db.card.createMany({
    data: [
      { id: SID.cardX, externalId: 'an-fix-x', setId: SID.set1, name: 'Carta Equis', number: '1' },
      { id: SID.cardY, externalId: 'an-fix-y', setId: SID.set1, name: 'Carta Ye', number: '2' },
      { id: SID.cardZ, externalId: 'an-fix-z', setId: SID.set2, name: 'Carta Zeta', number: '3' },
      { id: SID.cardS, externalId: 'an-fix-s', setId: SID.set2, name: 'Caja Placeholder', number: '0' },
    ] as never,
  });
  await db.sealedProduct.create({
    data: { id: SID.sealed, setId: SID.set2, tcgplayerProductId: 990001, tcgplayerGroupId: 990001, name: 'Caja de Refuerzos AN', subtype: 'box' },
  });

  const items: Record<string, string[]> = {};
  items.o0 = await mkOrder(db, { id: SID.o0, userId: SID.userA, status: 'settled', settledAt: mx('2021-02-20', 12), conv: 'IVA_EXCLUSIVE', subtotal: 7000, iva: 1120, fee: 400, total: 8520, items: [{ card: SID.cardY, productType: 'raw', unit: 7000, acq: 3000 }] });
  items.o0b = await mkOrder(db, { id: SID.o0b, userId: SID.userB, status: 'settled', settledAt: mx('2021-02-25', 12), conv: 'IVA_EXCLUSIVE', subtotal: 9000, iva: 1440, fee: 450, total: 10890, items: [{ card: SID.cardY, productType: 'raw', unit: 9000, acq: 4000 }] });
  items.o1 = await mkOrder(db, { id: SID.o1, userId: SID.userA, status: 'settled', settledAt: mx('2021-03-01', 10), conv: 'IVA_EXCLUSIVE', subtotal: 10000, iva: 1600, fee: 500, total: 12100, items: [{ card: SID.cardX, productType: 'raw', unit: 10000, acq: 6000 }] });
  items.o3 = await mkOrder(db, { id: SID.o3, userId: SID.userB, status: 'refunded', settledAt: mx('2021-03-01', 12), conv: 'IVA_INCLUSIVE', subtotal: 11601, iva: 1600, fee: 600, total: 12201, items: [{ card: SID.cardY, productType: 'raw', unit: 11601, acq: 7000, finish: 'holofoil' }] });
  items.o2 = await mkOrder(db, {
    id: SID.o2, guestEmail: EMAIL.g1, status: 'settled', settledAt: mx('2021-03-01', 23, 30), conv: 'IVA_INCLUSIVE', mode: 'direct_ship',
    subtotal: 23200, shipping: 11600, iva: 4800, fee: 1500, total: 36300,
    items: [
      { card: SID.cardX, productType: 'raw', unit: 11600, acq: 5000, finish: 'normal' },
      { card: SID.cardX, productType: 'raw', unit: 11600, acq: 5000, finish: 'reverse_holo' },
    ],
  });
  items.o4 = await mkOrder(db, {
    id: SID.o4, userId: SID.userA, status: 'settled', settledAt: mx('2021-03-02', 0, 10), conv: 'IVA_EXCLUSIVE',
    subtotal: 20000, iva: 3200, fee: 900, total: 24100,
    items: [
      { card: SID.cardS, productType: 'sealed', unit: 12000, acq: 8000, sealedProductId: SID.sealed },
      { card: SID.cardZ, productType: 'graded', unit: 8000, acq: 4000 },
    ],
  });
  items.o5 = await mkOrder(db, { id: SID.o5, guestEmail: EMAIL.g2, status: 'chargeback', settledAt: mx('2021-03-05', 18), conv: 'IVA_EXCLUSIVE', mode: 'direct_ship', subtotal: 5000, iva: 800, fee: 300, total: 6100, items: [{ card: SID.cardY, productType: 'raw', unit: 5000, acq: 2000 }] });
  items.o8 = await mkOrder(db, { id: SID.o8, guestEmail: EMAIL.b, status: 'settled', settledAt: mx('2021-03-07', 20), conv: 'IVA_EXCLUSIVE', mode: 'direct_ship', subtotal: 3000, iva: 480, fee: 200, total: 3680, items: [{ card: SID.cardZ, productType: 'raw', unit: 3000, acq: 1000 }] });
  items.o6 = await mkOrder(db, { id: SID.o6, userId: SID.userA, status: 'failed', settledAt: null, conv: 'IVA_EXCLUSIVE', subtotal: 4000, iva: 640, fee: 200, total: 4840, items: [{ card: SID.cardY, productType: 'raw', unit: 4000, acq: 1000 }] });
  items.o7 = await mkOrder(db, { id: SID.o7, userId: SID.userA, status: 'pending', settledAt: null, conv: 'IVA_EXCLUSIVE', subtotal: 4000, iva: 640, fee: 200, total: 4840, items: [{ card: SID.cardY, productType: 'raw', unit: 4000, acq: 1000 }] });

  const addr = { street: 'Calle Fixture 1', city: 'CDMX', postalCode: '01000' };
  // El envío del directo O2: tarifa dentro de la orden (`shippingFeeCents = 0` aquí, D-IVA-5), costo de guía capturado.
  // TD-AN-5: con seguro de 5.80 (informativo, YA va dentro de `shippingCostCents`) para que AN-B-13 lo cubra.
  await db.shipmentRequest.create({
    data: { id: SID.s2, orderId: SID.o2, addressSnapshot: addr, status: 'picking', pickingAt: mx('2021-03-02', 9), shippingFeeCents: 0, ivaCents: 0, processingFeeCents: 0, shippingCostCents: 9280, shippingCostIvaCents: 1280, insuranceCostCents: 580, priceConvention: 'IVA_INCLUSIVE' } as never,
  });
  // Un retiro de bóveda de A (cobro propio), sin costo capturado ⇒ cuenta en `shippingCostMissingCount`.
  await db.shipmentRequest.create({
    data: { id: SID.s9, userId: SID.userA, addressSnapshot: addr, status: 'enviado', pickingAt: mx('2021-03-04', 11), shippingFeeCents: 15000, ivaCents: 2400, processingFeeCents: 700, totalCents: 18100, priceConvention: 'IVA_EXCLUSIVE' } as never,
  });
  // Un retiro sin pagar: no cuenta.
  await db.shipmentRequest.create({
    data: { id: SID.sPending, userId: SID.userA, addressSnapshot: addr, status: 'solicitado', shippingFeeCents: 15000, priceConvention: 'IVA_EXCLUSIVE' } as never,
  });
  await db.shipmentCostAdjustment.create({
    data: { id: SID.adj, shipmentRequestId: SID.s2, kind: 'overweight', providerChargeId: 'an-fix-charge-1', providerChargeType: 'overweight', amountCents: 2320, ivaCents: 320, ivaSource: 'provider', chargedAt: mx('2021-03-06', 10) },
  });

  // Reembolso TOTAL de O3 el miércoles (la orden pasó a `refunded`; `settledAt` intacto).
  await db.paymentRefund.create({
    data: { id: SID.refO3, idempotencyKey: 'an-fix-ref-o3', kind: 'order_full', status: 'succeeded', orderId: SID.o3, amountCents: 12201, merchandiseCents: 11601, merchandiseIvaCents: 1600, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 600, requestedByUserId: SID.userC, requestedByRole: 'super_admin', stripeRefundId: 're_an_fix_o3', submittedAt: mx('2021-03-03', 12), succeededAt: mx('2021-03-03', 12) },
  });
  // Reembolso de UNA carta de O4 (la gradeada) el jueves: la orden sigue `settled`. ⚠️ `kind: 'order_remaining'` parcial y no
  // `item_missing`: éste exige línea de envío y motivo (CHECK de M-61), y ni M7 ni AN leen el `kind` — leen el importe y la fecha.
  await db.paymentRefund.create({
    data: { id: SID.refO4, idempotencyKey: 'an-fix-ref-o4', kind: 'order_remaining', status: 'submitted', orderId: SID.o4, amountCents: 9670, merchandiseCents: 8000, merchandiseIvaCents: 1280, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 1670, requestedByUserId: SID.userC, requestedByRole: 'super_admin', stripeRefundId: 're_an_fix_o4', submittedAt: mx('2021-03-04', 10) },
  });
  // Un reembolso que Stripe rechazó en definitiva el viernes: ⛔ no cuenta.
  await db.paymentRefund.create({
    data: { id: SID.refFailed, idempotencyKey: 'an-fix-ref-failed', kind: 'order_remaining', status: 'failed', orderId: SID.o1, amountCents: 5800, merchandiseCents: 5000, merchandiseIvaCents: 800, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 800, requestedByUserId: SID.userC, requestedByRole: 'super_admin', submittedAt: mx('2021-03-05', 9), failedAt: mx('2021-03-05', 10) },
  });
  // SPEI pagado el sábado: UNA carta del retiro S9 llegó dañada (`withdrawal_delivered`, la única fuente SPEI sin caso).
  folio += 1;
  const wPiece = await db.inventoryItem.create({
    data: { folio: `AN-FIX-W-${folio}`, cardId: SID.cardY, productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'shipped' } as never,
  });
  const line = await db.shipmentItem.create({ data: { id: SID.s9line, shipmentRequestId: SID.s9, inventoryItemId: wPiece.id } as never });
  await db.manualRefund.create({
    data: { id: SID.mrO4, idempotencyKey: 'an-fix-mr-w', source: 'withdrawal_delivered', status: 'paid', customerUserId: SID.userA, shipmentItemId: line.id, deliveredReason: 'arrived_damaged', deliveredNote: 'nota de prueba', amountCents: 6000, merchandiseCents: 5000, merchandiseIvaCents: 800, processingFeeCents: 0, compensationCents: 1000, createdByUserId: SID.userC, paidAt: mx('2021-03-06', 15), paidByUserId: SID.userC },
  });

  await db.sellRequest.create({ data: { id: SID.sr1, userId: SID.userC, status: 'pagada', paidAt: mx('2021-03-05', 13), payoutNetCents: 40000 } as never });
  await db.sellRequest.create({ data: { id: SID.sr2, userId: SID.userC, status: 'pagada', paidAt: mx('2021-03-06', 13), payoutNetCents: null } as never });
  return items;
}

/**
 * Mayo de 2021 (horario de verano en México: UTC−5) — lo que AN-B-1, AN-B-2 y AN-B-8 necesitan sin tocar la fixture de marzo
 * (la instantánea de AN-B-13 es de marzo). Requiere `seedSales` antes (usuarios, cartas).
 *
 * | Pedido | Quién | Cobrado (MX) | Destino | total | Renglones |
 * |---|---|---|---|---|---|
 * | M1 | A | 05-10 10:00 | directo | 11600 | X normal 10000 |
 * | M2 | B | 05-10 11:00 | bóveda  | 23200 | Y normal ×4 a 5000 |
 * | M3 | invitado g1 | 05-10 12:00 | directo | 5800 | Z raw 5000 |
 * | M4 / M5 | A | sin cobrar (`failed` / `pending`) | — | — | — |
 * | M6 | A | 05-11 09:00 | bóveda | 11600 | Z graded 10000 |
 * | M7 | B | 05-11 10:00 | bóveda | 23200 | Z raw 20000 |
 * | M11 | A | 05-12 08:00 | bóveda | 928 | W1…W8 a 100 (8 cartas distintas) |
 * | M8 | A | 05-12 14:59 | bóveda | 11600 | X normal 10000 |
 * | M9 | A | 05-12 23:59:59.999 | bóveda | 11600 | X normal 10000 |
 * | M10 | A | 05-13 00:00:00.000 | bóveda | 11600 | X normal 10000 (⛔ fuera de un periodo que termina el 12) |
 */
export async function seedSalesMay(db: PrismaClient): Promise<void> {
  const w = [SID.w1, SID.w2, SID.w3, SID.w4, SID.w5, SID.w6, SID.w7, SID.w8];
  await db.card.createMany({ data: w.map((cid, i) => ({ id: cid, externalId: `an-fix-w${i + 1}`, setId: SID.set2, name: `Carta W${i + 1}`, number: `W${i + 1}` })) as never });
  const ex = (subtotal: number) => ({ conv: 'IVA_EXCLUSIVE' as const, subtotal, iva: (subtotal * 16) / 100, fee: 0, total: subtotal + (subtotal * 16) / 100 });
  await mkOrder(db, { id: SID.m1, userId: SID.userA, status: 'settled', settledAt: mx('2021-05-10', 10), mode: 'direct_ship', ...ex(10000), items: [{ card: SID.cardX, productType: 'raw', unit: 10000, acq: 1 }] });
  await mkOrder(db, { id: SID.m2, userId: SID.userB, status: 'settled', settledAt: mx('2021-05-10', 11), ...ex(20000), items: [1, 2, 3, 4].map(() => ({ card: SID.cardY, productType: 'raw' as const, unit: 5000, acq: 1 })) });
  await mkOrder(db, { id: SID.m3, guestEmail: EMAIL.g1, status: 'settled', settledAt: mx('2021-05-10', 12), mode: 'direct_ship', ...ex(5000), items: [{ card: SID.cardZ, productType: 'raw', unit: 5000, acq: 1 }] });
  await mkOrder(db, { id: SID.m4, userId: SID.userA, status: 'failed', settledAt: null, ...ex(10000), items: [{ card: SID.cardX, productType: 'raw', unit: 10000, acq: 1 }] });
  await mkOrder(db, { id: SID.m5, userId: SID.userA, status: 'pending', settledAt: null, ...ex(10000), items: [{ card: SID.cardX, productType: 'raw', unit: 10000, acq: 1 }] });
  await mkOrder(db, { id: SID.m6, userId: SID.userA, status: 'settled', settledAt: mx('2021-05-11', 9), ...ex(10000), items: [{ card: SID.cardZ, productType: 'graded', unit: 10000, acq: 1 }] });
  await mkOrder(db, { id: SID.m7, userId: SID.userB, status: 'settled', settledAt: mx('2021-05-11', 10), ...ex(20000), items: [{ card: SID.cardZ, productType: 'raw', unit: 20000, acq: 1 }] });
  await mkOrder(db, { id: SID.m11, userId: SID.userA, status: 'settled', settledAt: mx('2021-05-12', 8), ...ex(800), items: w.map((cid) => ({ card: cid, productType: 'raw' as const, unit: 100, acq: 1 })) });
  await mkOrder(db, { id: SID.m8, userId: SID.userA, status: 'settled', settledAt: mx('2021-05-12', 14, 59), ...ex(10000), items: [{ card: SID.cardX, productType: 'raw', unit: 10000, acq: 1 }] });
  await mkOrder(db, { id: SID.m9, userId: SID.userA, status: 'settled', settledAt: new Date(mx('2021-05-13', 0).getTime() - 1), ...ex(10000), items: [{ card: SID.cardX, productType: 'raw', unit: 10000, acq: 1 }] });
  await mkOrder(db, { id: SID.m10, userId: SID.userA, status: 'settled', settledAt: mx('2021-05-13', 0), ...ex(10000), items: [{ card: SID.cardX, productType: 'raw', unit: 10000, acq: 1 }] });
}
