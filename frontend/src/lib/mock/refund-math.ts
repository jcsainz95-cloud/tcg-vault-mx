/**
 * MOCK · ESPEJO de la FORMA del reembolso del servidor (`backend/src/common/money.ts`, sección «refund»;
 * contrato `§M4-SHIP.4` / `§M4-SHIP.15.5`). ⛔ La pantalla NUNCA calcula un importe: esto existe porque el
 * servidor falso de `m4-ship.ts` tiene que responder las mismas cifras que el real, y antes las recalculaba a
 * mano y ya divergía (IVA `0` y comisión `0` en la fila SPEI — deuda §M4-SHIP (a) del techlead).
 *
 * ⛔⛔ **ESTE FICHERO NO CALCULA IVA** (`API_CONTRACT §M10-IVA.3`, candado `src/test/frontend-never-multiplies.test.ts`).
 * El reparto comisión / mercancía / compensación es aritmética de centavos sin IVA; el **IVA de la mercancía** NO se
 * deriva aquí: se LEE de `GOLDEN_MERCHANDISE_IVA_CENTS`, una tabla de vectores dorados precalculados por el servidor
 * (`merchandise − taxBaseCentsOf(merchandise, r)` de `money.ts`). Un importe que no esté sembrado responde
 * `501 MOCK_GOLDEN_VECTOR_MISSING` en vez de inventarse una cifra: el mock lleva estado, no fórmula fiscal.
 * (Decisión y alternativas en `docs/FRONTEND_NOTES.md` §M4-SHIP · «el mock no calcula IVA».)
 */
import { ApiFixtureError } from './fixtures';

/**
 * ⭐ Vectores DORADOS: `ivaRatePct → merchandiseCents → merchandiseIvaCents`, tal como los produce
 * `backend/src/common/money.ts` (`P − taxBaseCentsOf(P, r)`). Los que `backend/src/common/refund-math.spec.ts`
 * fija literalmente: 30000→4138. Los que fijan las pruebas del mock sobre sus fixtures: 32000→4414, 35000→4828,
 * 50000→6897 (PS-26/27). El resto, uno por `unitPriceCents` sembrado en `m4-ship.ts` + 25000 (mercancía del
 * reembolso parcial X=26215 sobre Q=52430). ⛔ Se copian, no se calculan: `refund-math.test.ts` exige que cada
 * precio sembrado tenga el suyo.
 */
export const GOLDEN_MERCHANDISE_IVA_CENTS: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  16: {
    20_000: 2_759,
    25_000: 3_448,
    28_000: 3_862,
    30_000: 4_138,
    32_000: 4_414,
    35_000: 4_828,
    42_000: 5_793,
    50_000: 6_897,
    55_000: 7_586,
    60_000: 8_276,
    65_000: 8_966,
    128_000: 17_655,
  },
};

/** El IVA CONGELADO de una mercancía, leído de la tabla dorada. `0` de mercancía ⇒ `0`; sin vector ⇒ 501. */
export function merchandiseIvaCentsOf(merchandiseCents: number, ivaRatePct: number): number {
  if (merchandiseCents === 0) return 0;
  const golden = GOLDEN_MERCHANDISE_IVA_CENTS[ivaRatePct]?.[merchandiseCents];
  if (golden === undefined) {
    throw new ApiFixtureError(
      501,
      'MOCK_GOLDEN_VECTOR_MISSING',
      `MOCK: sin vector dorado de IVA para mercancía ${merchandiseCents} a ${ivaRatePct} % — siémbralo en GOLDEN_MERCHANDISE_IVA_CENTS`,
      { merchandiseCents, ivaRatePct },
    );
  }
  return golden;
}

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

/** Las columnas de `Order` que el reparto lee: `S`, `E`, `F`, `r` (clave de la tabla dorada; ⛔ nunca un factor). */
export interface RefundOrderMoney {
  subtotalCents: number;
  shippingFeeCents: number;
  processingFeeCents: number;
  ivaCents: number;
  ivaRatePct: number;
  totalCents: number;
  priceConvention: 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE';
}

/** `floor(F·P/G)`; `Σ floor(F·Pᵢ/G) ≤ F` ⇒ nunca se devuelve más comisión de la cobrada (⛔ nunca `ceil`). */
export function itemFeeShareCents(o: Pick<RefundOrderMoney, 'subtotalCents' | 'shippingFeeCents' | 'processingFeeCents'>, unitPriceCents: number): number {
  const G = o.subtotalCents + o.shippingFeeCents;
  if (G <= 0 || unitPriceCents <= 0) return 0;
  return Math.floor((o.processingFeeCents * unitPriceCents) / G);
}

/** `item_missing`, SOLO el importe: `P + floor(F × P / G)` — sin desglose, así que no toca la tabla de IVA. */
export function itemMissingAmountCents(o: RefundOrderMoney, unitPriceCents: number): number {
  return unitPriceCents + itemFeeShareCents(o, unitPriceCents);
}

/** `item_missing`: UNA carta ⇒ `P + floor(F × P / G)`; mercancía `P` (su IVA, de la tabla dorada), envío `0`. */
export function itemMissingRefundComponents(o: RefundOrderMoney, unitPriceCents: number): RefundComponents {
  const fee = itemFeeShareCents(o, unitPriceCents);
  const merchandise = unitPriceCents;
  return {
    amountCents: merchandise + fee,
    merchandiseCents: merchandise,
    merchandiseIvaCents: merchandiseIvaCentsOf(merchandise, o.ivaRatePct),
    shippingCents: 0,
    shippingIvaCents: 0,
    processingFeeCents: fee,
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
      merchandiseIvaCents: merchandiseIvaCentsOf(merchandise, ctx.ivaRatePct),
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
    merchandiseIvaCents: merchandiseIvaCentsOf(P, ctx.ivaRatePct),
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
