/**
 * review-vigente.ts — 💰 v1.114⟨portada⟩ (API_CONTRACT §DYN.5.9, ARCHITECTURE §4.DYN (e) y §4.PRE (d)): **qué es un caso de
 * revisión VIGENTE.** Un `PriceReviewCase` en `open` o `kept` retiene la variante: la venta usa su `baselineMxnCents` (sin base ⇒
 * `PRICE_PENDING`), el barrido congela su base y deduplica contra él, y el cotizador de compra la pone en «precio pendiente».
 * `keep` conserva el último sano y SIGUE reteniendo hasta que el barrido lo cierre `superseded`.
 *
 * Una sola definición para los cuatro lectores (`PricingService.vigenteReviewCases` —cuerpo de venta y base congelada del
 * barrido—, `PriceReviewService.recordArbiterDecision` y el gate de compra): si uno leyera solo `open`, `keep` volvería a
 * publicar el pico por ese camino (DYN-B24).
 */
import { PriceReviewStatus } from '@prisma/client';

export const VIGENTE_REVIEW_STATUSES: readonly PriceReviewStatus[] = [PriceReviewStatus.open, PriceReviewStatus.kept];

/** Filtro Prisma de «vigente» (para `where: { status: vigenteStatusWhere() }`). */
export function vigenteStatusWhere(): { in: PriceReviewStatus[] } {
  return { in: [...VIGENTE_REVIEW_STATUSES] };
}
