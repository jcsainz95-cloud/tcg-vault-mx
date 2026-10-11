/**
 * pnl-core.ts — 💰 el cuerpo de M7 `pnl()` PARTIDO en cubos (API_CONTRACT §15.8, ARCHITECTURE §4.64.4, fase B de §AN).
 *
 * ⛔ Es el MISMO cuerpo que vivía en `AdminService.pnl()` (las mismas cinco consultas, los mismos predicados, los mismos
 * helpers de `common/money.ts`), movido aquí SIN cambiar una cifra. Lo único nuevo es que cada componente se acumula en el
 * cubo de SU fecha (`keyOf`), la misma que M7 usa para acotarlo al periodo:
 *
 *   | componente                         | fecha que lo acota y lo pone en su cubo |
 *   |------------------------------------|------------------------------------------|
 *   | ingreso, comisión, costo de venta,  | `Order.settledAt` (órdenes `status: 'settled'`) |
 *   |   envío cobrado dentro de la orden |                                          |
 *   | envío (ingreso, costo, seguro, fee) | `ShipmentRequest.pickingAt`              |
 *   | ajustes de paquetería              | `ShipmentCostAdjustment.chargedAt`       |
 *   | reembolsos tarjeta / SPEI          | `PaymentRefund.submittedAt` / `ManualRefund.paidAt` |
 *   | buylist: tarifa retenida, margen,  | `SellRequest.paidAt` (solicitudes `pagada`) — §BSD.16 |
 *   |   guías manuales sin costo         |                                          |
 *   | buylist: guía de Skydropx (entrada)| `ShipmentRequest.labelPurchasedAt` (`INBOUND_ONLY`) — §BSD.16 (a) |
 *   | buylist: guía manual con costo     | `coalesce(SellRequest.guideSentAt, shipmentConfirmedAt)` — §BSD.18 (b) |
 *
 * 💰 Fusión con #78 (rev BSD-1, B-4): las cuatro filas del buylist que #78 metió en `pnl()` viven aquí, cada una en el cubo
 * de la fecha con la que #78 la acota; las reglas por fila siguen en `pnl-buylist.ts` (una sola regla para M7 y el cubo).
 * El envío de VENTA sigue `OUTBOUND_ONLY` (censo BSD-B23): una guía de entrada en `guia` no es costo de envío de venta.
 *
 * ⇒ Σ cubos = `pnl()` del periodo **por construcción** (todas las cifras son sumas de enteros; `profitCents` es lineal).
 * `AdminService.pnl(from, to)` = `pnlBuckets(db, range(from, to), () => 'all')` — un solo cubo, bit a bit lo de antes
 * (candado AN-B-13, `test/integration/sales-analytics-pnl-parity.e2e-spec.ts`).
 *
 * ⚠️ `range` es un `Prisma.DateTimeFilter` tal cual: M7 le pasa el `{gte, lte}` de `range()` de admin (D-AN-2, sin
 * cambio: criterio 613) y la analítica le pasa el semiabierto `{gte, lt}` de `mx-day.ts`.
 * ⚠️ Hereda D-AN-1: el ingreso es de órdenes que SIGUEN `settled` (la doble resta de un reembolso total). Se alinea sola
 * cuando §W 277/278 cambie ESTE fichero.
 */
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  netRevenueCents,
  netShippingCostCents,
  netShippingRevenueCents,
  shipmentNetRevenueCents,
} from '../../common/money';
import { INBOUND_ONLY, OUTBOUND_ONLY } from '../shipments/label-subject';
import { guideCostOfRequest, isSkydropxInbound, retainedShippingFeeCents, skydropxInboundGuideCostCents } from './pnl-buylist';

/**
 * Las cifras de M7 `GET /admin/finance/pnl` (mismo orden de claves que el DTO de hoy). `type` y no `interface`: el tipo de
 * `pnl()` sigue siendo asignable a `Record<string, number>` como antes del refactor (lo usan suites existentes).
 */
export type PnlComponents = {
  incomeCents: number;
  shippingRevenueCents: number;
  cogsCents: number;
  stripeFeesCents: number;
  shippingCostCents: number;
  shippingCostMissingCount: number;
  shippingAdjustmentsCents: number;
  shippingInsuranceCents: number;
  refundsCents: number;
  refundedFeesCents: number;
  compensationsCents: number;
  profitCents: number;
  // 💰 §BSD.16 (#78): AL FINAL del objeto, en el orden del DTO y del CSV de M7.
  buylistShippingFeeRetainedCents: number;
  buylistGuideCostCents: number;
  buylistGuideMarginCents: number;
  buylistGuideCostMissingCount: number;
};

/** Un cubo sin movimientos. */
export function zeroPnl(): PnlComponents {
  return {
    incomeCents: 0,
    shippingRevenueCents: 0,
    cogsCents: 0,
    stripeFeesCents: 0,
    shippingCostCents: 0,
    shippingCostMissingCount: 0,
    shippingAdjustmentsCents: 0,
    shippingInsuranceCents: 0,
    refundsCents: 0,
    refundedFeesCents: 0,
    compensationsCents: 0,
    profitCents: 0,
    buylistShippingFeeRetainedCents: 0,
    buylistGuideCostCents: 0,
    buylistGuideMarginCents: 0,
    buylistGuideCostMissingCount: 0,
  };
}

type Db = Pick<PrismaService, 'order' | 'shipmentRequest' | 'shipmentCostAdjustment' | 'paymentRefund' | 'manualRefund' | 'sellRequest'>;

/**
 * 💰 v1.86⟨accesorios⟩ (§AC.12) — costo de venta de los renglones `sold` de una orden: `Σ unitCostCents × (quantity −
 * missingQty)` del suelto y, en paquete, `Σ componente.unitCostCents × quantity` (entero o nada: el paquete faltante al
 * preparar no salió). `null ⇒ 0`. ⛔ El paquete NO tiene costo propio (CHECK `order_accessory_line_money`): su costo vive
 * SOLO en los componentes, así no se cuenta dos veces.
 */
export function accessoryCogsCents(
  lines: readonly {
    kind: string;
    quantity: number;
    unitCostCents: number | null;
    shipmentLine: { missingQty: number } | null;
    components: readonly { quantity: number; unitCostCents: number | null }[];
  }[],
): number {
  let cogs = 0;
  for (const l of lines) {
    const out = Math.max(0, l.quantity - (l.shipmentLine?.missingQty ?? 0));
    if (out === 0) continue;
    if (l.kind === 'energy_bundle') {
      for (const c of l.components) cogs += (c.unitCostCents ?? 0) * c.quantity;
    } else {
      cogs += (l.unitCostCents ?? 0) * out;
    }
  }
  return cogs;
}

/** Una fila de dinero devuelto, con la fecha que la pone en su periodo. */
export interface RefundRow {
  channel: 'card' | 'spei';
  at: Date | null;
  amountCents: number;
  /** Lo que M7 llama `refundsCents` de esta fila: mercancía + envío NETOS (SPEI: sin envío). */
  netCents: number;
  processingFeeCents: number;
  compensationCents: number;
  ivaCents: number;
}

/**
 * ⭐ v1.80.2 — lo devuelto en el periodo, fila por fila: las filas del libro aceptadas por Stripe (`submitted|succeeded`,
 * por `submittedAt`) y las transferencias SPEI `paid` (por `paidAt`). ⛔ `requested`/`failed` y `pending`/`cancelled` no
 * cuentan; la sustituta SPEI de una fila `failed` cuenta una vez (la `failed` no).
 */
export async function refundRowsInPeriod(db: Db, period?: Prisma.DateTimeFilter): Promise<RefundRow[]> {
  const [stripeRows, speiRows] = await Promise.all([
    db.paymentRefund.findMany({
      where: { status: { in: ['submitted', 'succeeded'] }, ...(period ? { submittedAt: period } : {}) },
      select: { amountCents: true, merchandiseCents: true, merchandiseIvaCents: true, shippingCents: true, shippingIvaCents: true, processingFeeCents: true, compensationCents: true, submittedAt: true },
    }),
    db.manualRefund.findMany({
      where: { status: 'paid', ...(period ? { paidAt: period } : {}) },
      select: { amountCents: true, merchandiseCents: true, merchandiseIvaCents: true, processingFeeCents: true, compensationCents: true, paidAt: true },
    }),
  ]);
  const rows: RefundRow[] = [];
  for (const r of stripeRows) {
    rows.push({
      channel: 'card',
      at: r.submittedAt ?? null,
      amountCents: r.amountCents ?? 0,
      netCents: r.merchandiseCents - r.merchandiseIvaCents + r.shippingCents - r.shippingIvaCents,
      processingFeeCents: r.processingFeeCents,
      compensationCents: r.compensationCents,
      ivaCents: r.merchandiseIvaCents + r.shippingIvaCents,
    });
  }
  for (const r of speiRows) {
    rows.push({
      channel: 'spei',
      at: r.paidAt ?? null,
      amountCents: r.amountCents ?? 0,
      netCents: r.merchandiseCents - r.merchandiseIvaCents,
      processingFeeCents: r.processingFeeCents,
      compensationCents: r.compensationCents,
      ivaCents: r.merchandiseIvaCents,
    });
  }
  return rows;
}

/**
 * ⭐ v1.80.2 — un cuerpo para el P&L y el IVA: lo devuelto en el periodo. `refundsCents` = mercancía + envío NETOS;
 * `refundedFeesCents` = comisión devuelta; `compensationsCents` = compensaciones por carta perdida; `ivaRefundedCents`
 * = el IVA que iba dentro de lo devuelto.
 */
export async function refundsInPeriod(db: Db, period?: Prisma.DateTimeFilter) {
  const acc = { refundsCents: 0, refundedFeesCents: 0, compensationsCents: 0, ivaRefundedCents: 0 };
  for (const r of await refundRowsInPeriod(db, period)) {
    acc.refundsCents += r.netCents;
    acc.refundedFeesCents += r.processingFeeCents;
    acc.compensationsCents += r.compensationCents;
    acc.ivaRefundedCents += r.ivaCents;
  }
  return acc;
}

/**
 * 💰 El P&L de M7 por cubos. `keyOf(fecha)` decide el cubo de cada componente (ver la tabla de la cabecera); un cubo
 * sin movimientos NO aparece en el mapa (quien llama rellena con `zeroPnl()`).
 *
 * Los comentarios de dinero de cada línea son los que vivían en `AdminService.pnl()` (v1.4-finance, v1.64, D2f, v1.80):
 * se conservan aquí porque aquí vive ahora la regla.
 */
export async function pnlBuckets(
  db: Db,
  range: Prisma.DateTimeFilter | undefined,
  keyOf: (d: Date | null) => string,
): Promise<Map<string, PnlComponents>> {
  const out = new Map<string, PnlComponents>();
  const at = (d: Date | null | undefined): PnlComponents => {
    const k = keyOf(d ?? null);
    let b = out.get(k);
    if (!b) {
      b = zeroPnl();
      out.set(k, b);
    }
    return b;
  };

  // ⭐⭐ v1.64-iva-inclusive (§4.44.j, criterio 191) — TODO INGRESO PASA POR `netRevenueCents`, decidido por fila y desde
  // columnas persistidas, ⛔ jamás desde el dial vivo (criterio 190, candado IVA-5).
  // ⭐ v1.64 `D-IVA-5`: el envío cobrado DENTRO de la orden (`direct_ship`) es INGRESO DE ENVÍO, ⛔ no de mercancía, y se
  // acota por `settledAt` (el mismo predicado de la orden).
  const settledOrders = await db.order.findMany({
    where: { status: 'settled', ...(range ? { settledAt: range } : {}) },
    include: {
      items: { include: { inventoryItem: true } },
      // 💰 v1.86⟨accesorios⟩ (§AC.12, criterio 723): los renglones VENDIDOS con su costo congelado, su faltante y, en
      // paquete, el costo de cada componente. ⛔ `restocked`/`released` no cuentan.
      accessoryLines: {
        where: { status: 'sold' },
        select: {
          kind: true,
          quantity: true,
          unitCostCents: true,
          shipmentLine: { select: { missingQty: true } },
          components: { select: { quantity: true, unitCostCents: true } },
        },
      },
    },
  });
  for (const o of settledOrders) {
    const b = at(o.settledAt);
    // El ingreso NO cambia de fórmula: `subtotalCents` ya incluye accesorios y paquetes (I-AC-1).
    b.incomeCents += netRevenueCents(o);
    b.stripeFeesCents += o.processingFeeCents;
    if (o.fulfillmentMode === 'direct_ship') {
      b.shippingRevenueCents += netShippingRevenueCents(o);
    }
    for (const it of o.items) {
      b.cogsCents += it.inventoryItem.acquisitionCostCents ?? 0;
    }
    b.cogsCents += accessoryCogsCents(o.accessoryLines ?? []);
  }

  // Fix correctness #3: los envíos se acotan por su liquidación (`pickingAt`). v1.4-finance: INGRESO (lo que paga el
  // cliente) y COSTO (lo que la plataforma paga al carrier) del MISMO conjunto de envíos, para que caigan en el mismo lapso.
  const shipments = await db.shipmentRequest.findMany({
    where: {
      // 💰 rev BSD-1 (§BSD.5, censo BSD-B23): sin esto una guía de ENTRADA en `guia` entraría como costo de envío de venta.
      ...OUTBOUND_ONLY,
      status: { in: ['picking', 'guia', 'enviado', 'entregado'] },
      ...(range ? { pickingAt: range } : {}),
    },
  });
  for (const s of shipments) {
    const b = at(s.pickingAt);
    // v1.64 (§4.44.j, sitio 2): neteado por la convención de ESTA `ShipmentRequest` (helper propio: no tiene `ivaRatePct`).
    b.shippingRevenueCents += shipmentNetRevenueCents(s);
    // ⭐⭐ §M10-IVA.8 / IVA-11(a) — NETO contra NETO: una RESTA del crédito congelado, ⛔ jamás una división.
    b.shippingCostCents += netShippingCostCents(s);
    // ⭐ IVA-11(b) — que el `0` no signifique dos cosas: un costo `0` sin guía de Skydropx se SEÑALA (D2f §19.11).
    if (s.shippingCostCents === 0 && s.labelSource !== 'skydropx') b.shippingCostMissingCount += 1;
    // 💰 D2f (§19.11): el seguro es INFORMATIVO (ya va DENTRO de `shippingCostCents`).
    b.shippingInsuranceCents += s.insuranceCostCents ?? 0;
    b.stripeFeesCents += s.processingFeeCents;
  }

  // 💰 D2f (§19.11, pregunta 89, `HECHOS.md:41`): los AJUSTES de costo cuentan en el periodo de su CARGO (`chargedAt`),
  // netos (resta del IVA congelado), sin filtrar por el estado del envío; van DENTRO de `shippingCostCents` y aparte en
  // `shippingAdjustmentsCents`.
  const adjustments = await db.shipmentCostAdjustment.findMany({
    where: range ? { chargedAt: range } : {},
    select: { amountCents: true, ivaCents: true, chargedAt: true },
  });
  for (const a of adjustments) {
    const b = at(a.chargedAt);
    const net = a.amountCents - a.ivaCents;
    b.shippingAdjustmentsCents += net;
    b.shippingCostCents += net;
  }

  // ⭐ v1.80 / v1.80.2 (§M4-SHIP, PS-40) — EL DINERO QUE VUELVE resta en el periodo en que SALIÓ.
  for (const r of await refundRowsInPeriod(db, range)) {
    const b = at(r.at);
    b.refundsCents += r.netCents;
    b.refundedFeesCents += r.processingFeeCents;
    b.compensationsCents += r.compensationCents;
  }

  // 💰 rev BSD-1, errata BSD-1.2 (§BSD.16): la tarifa retenida a los vendedores SUMA y la guía de entrada RESTA, cada fila
  // en el cubo de SU fecha. ⛔ `shippingCostCents` (envío de VENTA) no cambia: su sumador sigue `OUTBOUND_ONLY`.
  const buylist = await buylistRowsInPeriod(db, range);
  for (const g of buylist.skydropxGuides) at(g.labelPurchasedAt).buylistGuideCostCents += skydropxInboundGuideCostCents(g);
  for (const sr of buylist.manualGuides) {
    if (!isSkydropxInbound(sr.inboundShipment)) at(sr.guideSentAt ?? sr.shipmentConfirmedAt).buylistGuideCostCents += sr.guideActualCostCents ?? 0;
  }
  for (const sr of buylist.paid) {
    const b = at(sr.paidAt);
    const retained = retainedShippingFeeCents(sr);
    const guide = guideCostOfRequest(sr);
    b.buylistShippingFeeRetainedCents += retained;
    // Margen POR SOLICITUD, en el cubo de su pago (⛔ resta de los dos renglones: viven en periodos distintos).
    b.buylistGuideMarginCents += retained - guide.costCents;
    if (guide.missing) b.buylistGuideCostMissingCount += 1;
  }

  // ⛔ `profitCents` conserva sus términos, resta lo devuelto y suma/resta el buylist; por cubo (lineal ⇒ Σ cubos = total).
  for (const b of out.values()) {
    b.profitCents =
      b.incomeCents + b.shippingRevenueCents - b.cogsCents - b.stripeFeesCents - b.shippingCostCents -
      b.refundsCents - b.refundedFeesCents - b.compensationsCents +
      b.buylistShippingFeeRetainedCents - b.buylistGuideCostCents;
  }
  return out;
}

/**
 * 💰 rev BSD-1, errata BSD-1.2 (API_CONTRACT §BSD.16, ARCHITECTURE §4.BSD (l)) — las tres lecturas de los renglones del
 * buylist (el cuerpo que #78 tenía en `AdminService.pnlBuylistGuides`), con la fecha de cada fila para su cubo:
 *  - (a) guías de Skydropx de ENTRADA por `labelPurchasedAt` (`INBOUND_ONLY`, censo BSD-B23 / BSD-1.3 punto 6);
 *  - (b) guías MANUALES con costo capturado por `coalesce(guideSentAt, shipmentConfirmedAt)` (errata BSD-1.4 punto 12:
 *    `adminConfirmShipment` acepta el costo SIN guía y lo escribe con `shipmentConfirmedAt`; sin la segunda rama ese costo
 *    no entraba en ningún mes — BSD-B43). Los dos nulos ⇒ solo en el P&L sin periodo;
 *  - las solicitudes `pagada` por `paidAt` (tarifa retenida, margen por solicitud y guías manuales sin costo).
 */
export async function buylistRowsInPeriod(db: Db, period?: Prisma.DateTimeFilter) {
  const inboundRow = { select: { labelSource: true, providerCancelConfirmedAt: true, shippingCostCents: true, shippingCostIvaCents: true } } as const;
  const [skydropxGuides, manualGuides, paid] = await Promise.all([
    // (a) — `inbound_only`. La cancelación confirmada la decide `skydropxInboundGuideCostCents` (la misma regla del margen).
    db.shipmentRequest.findMany({
      where: { ...INBOUND_ONLY, labelSource: 'skydropx', ...(period ? { labelPurchasedAt: period } : {}) },
      select: { ...inboundRow.select, labelPurchasedAt: true },
    }),
    // (b) — la fila de entrada viaja para descartar las de Skydropx con la MISMA regla (`isSkydropxInbound`).
    db.sellRequest.findMany({
      where: {
        guideActualCostCents: { not: null },
        ...(period ? { OR: [{ guideSentAt: period }, { guideSentAt: null, shipmentConfirmedAt: period }] } : {}),
      },
      select: { guideActualCostCents: true, guideSentAt: true, shipmentConfirmedAt: true, inboundShipment: { select: { labelSource: true } } },
    }),
    db.sellRequest.findMany({
      where: { status: 'pagada', ...(period ? { paidAt: period } : {}) },
      select: {
        paidAt: true,
        approvedTotalCents: true,
        offerGrossCents: true,
        quotedTotalCents: true,
        payoutNetCents: true,
        guideSentAt: true,
        guideActualCostCents: true,
        inboundShipment: inboundRow,
      },
    }),
  ]);
  return { skydropxGuides, manualGuides, paid };
}
