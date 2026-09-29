/**
 * MOCK · ESPEJO de la fórmula del reembolso del servidor (`backend/src/common/money.ts`, sección «refund»;
 * contrato `§M4-SHIP.4` / `§M4-SHIP.15.5`). ⛔ La pantalla NUNCA calcula un importe: esto existe porque el
 * servidor falso de `m4-ship.ts` tiene que responder las mismas cifras que el real, y antes las recalculaba a
 * mano y ya divergía (IVA `0` y comisión `0` en la fila SPEI — deuda §M4-SHIP (a) del techlead).
 *
 * Los vectores dorados de `backend/src/common/refund-math.spec.ts` (31458, 52430, 15729, 99617; PS-26/27) se
 * repiten en `refund-math.test.ts`: si el servidor cambia la fórmula, esa prueba es la que se pone roja aquí.
 */

/** Los componentes CONGELADOS de una fila `PaymentRefund` (identidad del CHECK de M-61). */
export interface RefundComponents {
  amountCents: number;
  merchandiseCents: number;
  merchandiseIvaCents: number;
  shippingCents: number;
  shippingIvaCents: number;
  processingFeeCents: number;
  compensationCents: number;
}

/** Las columnas de `Order` que la fórmula lee: `S`, `E`, `F`, `r`, `total`, `ivaCents`. */
export interface RefundOrderMoney {
  subtotalCents: number;
  shippingFeeCents: number;
  processingFeeCents: number;
  ivaCents: number;
  ivaRatePct: number;
  totalCents: number;
  priceConvention: 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE';
}

/** `taxBase = round(gross × 100 / (100 + r))`. Flecha en UN sentido: precio → desglose (regla R3). */
export function taxBaseCentsOf(grossAmountCents: number, ivaRatePct: number): number {
  return Math.round((grossAmountCents * 100) / (100 + ivaRatePct));
}

/** `floor(F·P/G)`; `Σ floor(F·Pᵢ/G) ≤ F` ⇒ nunca se devuelve más comisión de la cobrada (⛔ nunca `ceil`). */
export function itemFeeShareCents(o: Pick<RefundOrderMoney, 'subtotalCents' | 'shippingFeeCents' | 'processingFeeCents'>, unitPriceCents: number): number {
  const G = o.subtotalCents + o.shippingFeeCents;
  if (G <= 0 || unitPriceCents <= 0) return 0;
  return Math.floor((o.processingFeeCents * unitPriceCents) / G);
}

/** `item_missing`: UNA carta ⇒ `P + floor(F × P / G)`; mercancía `P` (IVA dentro), envío `0`. */
export function itemMissingRefundComponents(o: RefundOrderMoney, unitPriceCents: number): RefundComponents {
  const fee = itemFeeShareCents(o, unitPriceCents);
  const merchandise = unitPriceCents;
  return {
    amountCents: merchandise + fee,
    merchandiseCents: merchandise,
    merchandiseIvaCents: merchandise - taxBaseCentsOf(merchandise, o.ivaRatePct),
    shippingCents: 0,
    shippingIvaCents: 0,
    processingFeeCents: fee,
    compensationCents: 0,
  };
}

/** `order_remaining`: `totalCents − Σ amountCents` no fallidas; el envío absorbe el centavo del IVA. */
export function orderRemainingRefundComponents(
  o: RefundOrderMoney,
  nonFailedRows: { amountCents: number; merchandiseIvaCents: number }[],
): RefundComponents {
  const refunded = nonFailedRows.reduce((a, r) => a + r.amountCents, 0);
  const refundedIva = nonFailedRows.reduce((a, r) => a + r.merchandiseIvaCents, 0);
  const amount = o.totalCents - refunded;
  const shipping = o.shippingFeeCents;
  return {
    amountCents: amount,
    merchandiseCents: 0,
    merchandiseIvaCents: 0,
    shippingCents: shipping,
    shippingIvaCents: o.ivaCents - refundedIva,
    processingFeeCents: amount - shipping,
    compensationCents: 0,
  };
}

/** Lo que el súper-admin ve al capturar un reembolso de caso: `Q = P + floor(F·P/G)` («lo pagado»). */
export interface CaseRefundContext {
  unitPriceCents: number;
  paidCents: number;
  feeShareCents: number;
  ivaRatePct: number;
}

export function caseRefundContextOf(o: RefundOrderMoney, unitPriceCents: number): CaseRefundContext {
  const fQ = itemFeeShareCents(o, unitPriceCents);
  return { unitPriceCents, paidCents: unitPriceCents + fQ, feeShareCents: fQ, ivaRatePct: o.ivaRatePct };
}

/**
 * `caseRefundComponents(X)`, UN cuerpo, MONÓTONO en cada componente:
 *  - `X ≤ Q`: `fee = floor(X × fQ / Q)`, `merchandise = X − fee`, IVA de esa mercancía, compensación `0`.
 *  - `X > Q`: los componentes EXACTOS de `item_missing` sobre `P` + `compensation = X − Q`.
 */
export function caseRefundComponents(x: number, ctx: CaseRefundContext): RefundComponents {
  if (x <= 0) {
    return { amountCents: 0, merchandiseCents: 0, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, compensationCents: 0 };
  }
  const Q = ctx.paidCents;
  if (x <= Q) {
    const fee = Q > 0 ? Math.floor((x * ctx.feeShareCents) / Q) : 0;
    const merchandise = x - fee;
    return {
      amountCents: x,
      merchandiseCents: merchandise,
      merchandiseIvaCents: merchandise - taxBaseCentsOf(merchandise, ctx.ivaRatePct),
      shippingCents: 0,
      shippingIvaCents: 0,
      processingFeeCents: fee,
      compensationCents: 0,
    };
  }
  const P = ctx.unitPriceCents;
  return {
    amountCents: x,
    merchandiseCents: P,
    merchandiseIvaCents: P - taxBaseCentsOf(P, ctx.ivaRatePct),
    shippingCents: 0,
    shippingIvaCents: 0,
    processingFeeCents: ctx.feeShareCents,
    compensationCents: x - Q,
  };
}

/** `a − b` componente a componente (la fila SPEI de un reembolso de caso, §M4-SHIP.15.5). */
export function subtractRefundComponents(a: RefundComponents, b: RefundComponents): RefundComponents {
  return {
    amountCents: a.amountCents - b.amountCents,
    merchandiseCents: a.merchandiseCents - b.merchandiseCents,
    merchandiseIvaCents: a.merchandiseIvaCents - b.merchandiseIvaCents,
    shippingCents: a.shippingCents - b.shippingCents,
    shippingIvaCents: a.shippingIvaCents - b.shippingIvaCents,
    processingFeeCents: a.processingFeeCents - b.processingFeeCents,
    compensationCents: a.compensationCents - b.compensationCents,
  };
}

/** Los cuatro componentes que `ManualRefundDTO.components` expone (sin envío: una transferencia de caso nunca lo lleva). */
export function manualRefundComponentsOf(c: RefundComponents): {
  merchandiseCents: number;
  merchandiseIvaCents: number;
  processingFeeCents: number;
  compensationCents: number;
} {
  return {
    merchandiseCents: c.merchandiseCents,
    merchandiseIvaCents: c.merchandiseIvaCents,
    processingFeeCents: c.processingFeeCents,
    compensationCents: c.compensationCents,
  };
}
