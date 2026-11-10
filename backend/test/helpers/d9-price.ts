/**
 * d9-price.ts — D9: el precio exhibido `P` con la comisión de plataforma DENTRO, para fixtures y expectativas de las pruebas.
 * Mismos diales de hoy (traslación 100 %, IVA 16 %, `stripe_fee_pct` 0.036). Pasa por `saleDisplayCentsOf` (la ÚNICA puerta del
 * servidor), nunca reimplementa la fórmula: una prueba que repite la fórmula del código no mide el código.
 */
import { IvaDials, saleDisplayCentsOf } from '../../src/common/money';

export const D9_DIALS: IvaDials = { ivaTransferPct: 100, ivaRatePct: 16, stripeFeePct: 0.036 };

/** `P` (con comisión dentro) de una pieza con precio de lista neto `L`. */
export const pOfL = (L: number, dials: IvaDials = D9_DIALS): number =>
  saleDisplayCentsOf({ listPriceCents: L, fixedDisplayCents: null }, dials);

/** El menor `L` cuyo `P` es ≥ `cents` (`pOfL` es monótona no decreciente). */
export function lForAtLeastP(cents: number, dials: IvaDials = D9_DIALS): number {
  let L = Math.max(1, Math.floor(cents / 1.3) - 2);
  while (pOfL(L, dials) < cents) L += 1;
  return L;
}
