/**
 * bounty-progress.ts — v1.62 (API_CONTRACT §M2-B.1) — **el CUPO del bounty, en un solo cuerpo.**
 *
 * El contrato exige literalmente que esta cuenta **no se teclee dos veces**: la trae la vitrina
 * pública (`GET /buylist/bounties`, campo `remainingQty`) y la trae la consola de bounties
 * (`GET /admin/pricing/bounties`, objeto `progress`), y **son la MISMA**. Dos copias de una resta
 * divergen en cuanto una de las dos aprenda un borde (el piso 0 es justo uno de ellos).
 *
 * ⚠️ **`acquiredQty` NO es la posición de inventario** (§M2-B.1): `bountyAcquiredQty` cuenta piezas
 * compradas vía buylist PAGADA bajo bounty —lo que dispara el auto-apagado—, mientras que la
 * posición que la mesa de decisión compara contra el objetivo (D29) es otra cifra y vive en M5.
 * Este helper contesta *«¿cuánto llevo de esta cacería?»*, jamás *«¿cuántas tengo?»*.
 */

/** `progress` del `AdminBountyRowDTO` (§M2-B.1). */
export interface BountyProgress {
  targetQty: number | null;
  acquiredQty: number;
  remainingQty: number | null;
}

/**
 * `remainingQty = max(0, targetQty − acquiredQty)`; **`null` si no hay objetivo** (un bounty sin
 * meta no se auto-apaga y no tiene resto que enseñar — no se inventa un 0, que se leería como
 * *«ya está completo»*).
 */
export function bountyRemainingQty(targetQty: number | null, acquiredQty: number): number | null {
  return targetQty != null ? Math.max(0, targetQty - acquiredQty) : null;
}

/** El objeto entero que pide `AdminBountyRowDTO.progress`, construido sobre el cuerpo de arriba. */
export function bountyProgress(targetQty: number | null, acquiredQty: number): BountyProgress {
  return { targetQty, acquiredQty, remainingQty: bountyRemainingQty(targetQty, acquiredQty) };
}
