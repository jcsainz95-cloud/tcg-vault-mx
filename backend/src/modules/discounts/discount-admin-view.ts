/**
 * discount-admin-view.ts — 💰 lo DERIVADO que ve el dueño en `/admin/codes` (API_CONTRACT §DSC.7). PURO.
 *
 *  - `codeStateOf` / `batchStateOf`: la partición computada `state` (⛔ sin columna): `paused > expired > scheduled >
 *    exhausted > live`. Un código está agotado con `reserved + consumed ≥ maxTotalUses` (la MISMA cuenta que la validez de
 *    §DSC.5); un lote, cuando todos sus códigos están `consumed`.
 *  - `generateBatchCodes`: `PREFIJO-` + 10 de `BATCH_ALPHABET` por `crypto.randomInt` (30¹⁰ ≈ 5.9·10¹⁴); ⛔ sin 0/O/1/I/L/U.
 *  - `buildDiscountReport` / `reportCsv` / `batchCodesCsv`: `DiscountReportDTO` y sus CSV (pesos con dos decimales como §15.7
 *    `centsToPesosCell`, `\n` y sin BOM como ese CSV; toda celda de texto con la defensa contra fórmulas de `cell-safety.ts`).
 */
import { randomInt } from 'crypto';
import type { DiscountCodeStatus, DiscountRedemptionStatus } from '@prisma/client';
import { csvRow, csvTextCell } from '../marketing/export/cell-safety';
import { centsToPesosCell } from '../sales-analytics/sales-figures';

export type DiscountCodeState = 'scheduled' | 'live' | 'paused' | 'expired' | 'exhausted';
/** §0-Q clase L del `?state=` de `GET /admin/discount-codes` (canónico en §DSC.7; `paused` es `?status=`). */
export const DISCOUNT_CODE_STATE_FILTER_VALUES = ['scheduled', 'live', 'expired', 'exhausted'] as const;
export type DiscountCodeStateFilter = (typeof DISCOUNT_CODE_STATE_FILTER_VALUES)[number];

/** §DSC.7: 30 símbolos, sin los que se confunden al dictar (0/O, 1/I/L) ni la U. */
export const BATCH_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const BATCH_SUFFIX_LENGTH = 10;

export function codeStateOf(
  c: { status: DiscountCodeStatus; startsAt: Date; endsAt: Date | null; maxTotalUses: number | null },
  inUse: number,
  now: Date,
): DiscountCodeState {
  if (c.status === 'paused') return 'paused';
  if (c.endsAt !== null && now.getTime() >= c.endsAt.getTime()) return 'expired';
  if (now.getTime() < c.startsAt.getTime()) return 'scheduled';
  if (c.maxTotalUses !== null && inUse >= c.maxTotalUses) return 'exhausted';
  return 'live';
}

/**
 * El `status` de un lote: `paused` ⇔ ningún código SIN USAR está `active` (§DSC.7). Sin códigos sin usar (todos usados o
 * apartados), la regla sería vacía ⇒ se mira el lote entero: `paused` ⇔ todos pausados.
 */
export function batchStatusOf(codes: readonly { status: DiscountCodeStatus; used: boolean }[]): DiscountCodeStatus {
  const unused = codes.filter((c) => !c.used);
  const pool = unused.length > 0 ? unused : codes;
  return pool.some((c) => c.status === 'active') ? 'active' : 'paused';
}

export function batchStateOf(
  b: { status: DiscountCodeStatus; startsAt: Date; endsAt: Date | null },
  consumedCodes: number,
  quantity: number,
  now: Date,
): DiscountCodeState {
  if (b.status === 'paused') return 'paused';
  if (b.endsAt !== null && now.getTime() >= b.endsAt.getTime()) return 'expired';
  if (now.getTime() < b.startsAt.getTime()) return 'scheduled';
  if (quantity > 0 && consumedCodes >= quantity) return 'exhausted';
  return 'live';
}

/** Un sufijo aleatorio criptográfico (`rand(n)` ∈ [0, n), por defecto `crypto.randomInt`). */
export function batchSuffix(rand: (n: number) => number = randomInt): string {
  let s = '';
  for (let i = 0; i < BATCH_SUFFIX_LENGTH; i += 1) s += BATCH_ALPHABET[rand(BATCH_ALPHABET.length)];
  return s;
}

/** `n` textos distintos `PREFIJO-XXXXXXXXXX` que no estén en `taken` (colisión ⇒ se regenera). */
export function generateBatchCodes(prefix: string, n: number, taken: ReadonlySet<string> = new Set(), rand?: (n: number) => number): string[] {
  const out = new Set<string>();
  let guard = 0;
  while (out.size < n) {
    const c = `${prefix}-${batchSuffix(rand)}`;
    if (!taken.has(c)) out.add(c);
    guard += 1;
    if (guard > n * 1000) throw new Error('generateBatchCodes: el generador no produce textos nuevos');
  }
  return [...out];
}

// ================================================================ reporte (§DSC.7, criterio 913)

/** Lo que el reporte lee de un uso (y de su pedido o retiro). */
export interface ReportRedemption {
  code: string;
  status: DiscountRedemptionStatus;
  createdAt: Date;
  consumedAt: Date | null;
  lateConsumed: boolean;
  customerEmail: string | null;
  order: { orderNumber: string | null; id: string; discountCents: number; shippingWaivedCents: number; totalCents: number; refundedCents: number } | null;
  withdrawal: { folio: string; shippingWaivedCents: number; totalCents: number } | null;
}

export interface DiscountReportRow {
  at: string;
  kind: 'order' | 'withdrawal';
  folio: string;
  customerEmail: string | null;
  code: string;
  discountCents: number;
  shippingWaivedCents: number;
  totalCents: number;
  refundedCents: number;
  status: DiscountRedemptionStatus;
}

export interface DiscountReportDTO {
  consumed: number;
  reservedNow: number;
  limit: number | null;
  paidOrders: number;
  discountGivenCents: number;
  shippingWaivedOrdersCents: number;
  shippingWaivedWithdrawalsCents: number;
  withdrawals: number;
  salesCollectedCents: number;
  refundedOrders: number;
  refundedCents: number;
  lateConsumed: number;
  rows: DiscountReportRow[];
  usedCodes?: { code: string; at: string }[];
}

/** El instante de un uso: cuándo se consumió; si no, cuándo se apartó. */
export const redemptionAt = (r: { consumedAt: Date | null; createdAt: Date }): Date => r.consumedAt ?? r.createdAt;

/**
 * `DiscountReportDTO`. Las cifras de dinero cuentan SOLO usos `consumed` (lo cobrado con el código); `reservedNow` es la foto
 * de AHORA (sin rango). `discountGivenCents = Σ Order.discountCents` de esos pedidos: por construcción, la suma de las líneas
 * «Descuento» que Ventas muestra para ellos (913). `refundedCents` = Σ `PaymentRefund.amountCents` `succeeded` de esos pedidos.
 */
export function buildDiscountReport(
  inRange: readonly ReportRedemption[],
  reservedNow: number,
  limit: number | null,
  opts: { batch?: boolean } = {},
): DiscountReportDTO {
  const consumed = inRange.filter((r) => r.status === 'consumed');
  const orders = consumed.filter((r) => r.order !== null);
  const withdrawals = consumed.filter((r) => r.withdrawal !== null);
  const sum = (xs: readonly ReportRedemption[], f: (r: ReportRedemption) => number) => xs.reduce((s, r) => s + f(r), 0);
  const rows = [...inRange]
    .sort((a, b) => redemptionAt(a).getTime() - redemptionAt(b).getTime() || a.code.localeCompare(b.code))
    .map(
      (r): DiscountReportRow => ({
        at: redemptionAt(r).toISOString(),
        kind: r.order ? 'order' : 'withdrawal',
        folio: r.order ? (r.order.orderNumber ?? r.order.id) : (r.withdrawal?.folio ?? ''),
        customerEmail: r.customerEmail,
        code: r.code,
        discountCents: r.order?.discountCents ?? 0,
        shippingWaivedCents: r.order?.shippingWaivedCents ?? r.withdrawal?.shippingWaivedCents ?? 0,
        totalCents: r.order?.totalCents ?? r.withdrawal?.totalCents ?? 0,
        refundedCents: r.order?.refundedCents ?? 0,
        status: r.status,
      }),
    );
  const dto: DiscountReportDTO = {
    consumed: consumed.length,
    reservedNow,
    limit,
    paidOrders: orders.length,
    discountGivenCents: sum(orders, (r) => r.order!.discountCents),
    shippingWaivedOrdersCents: sum(orders, (r) => r.order!.shippingWaivedCents),
    shippingWaivedWithdrawalsCents: sum(withdrawals, (r) => r.withdrawal!.shippingWaivedCents),
    withdrawals: withdrawals.length,
    salesCollectedCents: sum(orders, (r) => r.order!.totalCents),
    refundedOrders: orders.filter((r) => r.order!.refundedCents > 0).length,
    refundedCents: sum(orders, (r) => r.order!.refundedCents),
    lateConsumed: consumed.filter((r) => r.lateConsumed).length,
    rows,
  };
  if (opts.batch) {
    dto.usedCodes = consumed
      .map((r) => ({ code: r.code, at: redemptionAt(r).toISOString() }))
      .sort((a, b) => a.at.localeCompare(b.at) || a.code.localeCompare(b.code));
  }
  return dto;
}

const REPORT_HEADER = ['at', 'kind', 'folio', 'customerEmail', 'code', 'discountMxn', 'shippingWaivedMxn', 'totalMxn', 'refundedMxn', 'status'];

/**
 * El CSV del reporte: una fila por uso y una última `total` con las cifras de los `consumed` (= el JSON al centavo). Pesos con
 * dos decimales (`centsToPesosCell`, aritmética entera); texto entrecomillado y con `'` delante de `= + - @` (fórmulas).
 */
export function reportCsv(r: DiscountReportDTO): string {
  const lines = [csvRow(REPORT_HEADER.map(csvTextCell))];
  for (const x of r.rows) {
    lines.push(
      csvRow([
        csvTextCell(x.at),
        csvTextCell(x.kind),
        csvTextCell(x.folio),
        csvTextCell(x.customerEmail ?? ''),
        csvTextCell(x.code),
        centsToPesosCell(x.discountCents),
        centsToPesosCell(x.shippingWaivedCents),
        centsToPesosCell(x.totalCents),
        centsToPesosCell(x.refundedCents),
        csvTextCell(x.status),
      ]),
    );
  }
  lines.push(
    csvRow([
      csvTextCell('total'),
      csvTextCell(''),
      csvTextCell(''),
      csvTextCell(''),
      csvTextCell(''),
      centsToPesosCell(r.discountGivenCents),
      centsToPesosCell(r.shippingWaivedOrdersCents + r.shippingWaivedWithdrawalsCents),
      centsToPesosCell(r.salesCollectedCents),
      centsToPesosCell(r.refundedCents),
      csvTextCell('consumed'),
    ]),
  );
  return `${lines.join('\n')}\n`;
}

/** `GET /admin/discount-code-batches/:id/codes.csv` — `code,status,usedAt` (status = el `state` del código). */
export function batchCodesCsv(rows: readonly { code: string; state: DiscountCodeState; usedAt: Date | null }[]): string {
  const lines = [csvRow(['code', 'status', 'usedAt'].map(csvTextCell))];
  for (const r of rows) lines.push(csvRow([csvTextCell(r.code), csvTextCell(r.state), csvTextCell(r.usedAt ? r.usedAt.toISOString() : '')]));
  return `${lines.join('\n')}\n`;
}
