import { Prisma } from '@prisma/client';
import { VariantPricingDTO } from './variant-pricing';

/**
 * bounty-state.ts — v1.62 (API_CONTRACT §M2-B.0, marca `<!-- CANON: estado-de-bounty -->`).
 *
 * **El ESTADO de un bounty, derivado y jamás persistido.** Depende de la curva y del mercado, que el
 * barrido mueve 2×/día: una columna `state` en la BD sería una copia sin fecha de caducidad que
 * empezaría a mentir en el primer barrido (§0-B.2 clase B). Aquí vive **la única** implementación
 * del servidor, y **no re-implementa el veredicto**: lo toma del `bounty.effective` que ya compuso
 * `composeVariantPricing` con `isBountyEffective` (§4.36.6 prohíbe duplicar ese cuerpo; esta pantalla
 * es su **cuarta seam**, no una quinta copia).
 */

/** Los CINCO valores del enum del contrato. No existe el vocabulario `outbid`/`active`/`off`. */
export const BOUNTY_STATE_VALUES = ['activa', 'rebasada', 'invalida', 'completada', 'apagada'] as const;
export type BountyState = (typeof BOUNTY_STATE_VALUES)[number];

/**
 * **Predicado de ALCANCE** (§M2-B.0): una fila `VariantPriceOverride` es *un bounty* si tiene
 * **historia de bounty**. Una fila que solo lleva `sellOverrideCents`/`buyOverrideCents` NO aparece.
 *
 * Va como fragmento suelto (se compone con `AND`) para no colisionar con el `OR` que el filtro `q`
 * pone sobre la carta — misma disciplina que `BASE_CARD_REF_WHERE` en `pricing.service.ts`.
 */
export const BOUNTY_SCOPE_WHERE: Prisma.VariantPriceOverrideWhereInput = {
  OR: [
    { bountyEnabled: true },
    { bountyPriceCents: { not: null } },
    { bountyCompletedAt: { not: null } },
    { bountyAcquiredQty: { gt: 0 } },
  ],
};

/** El bloque `bounty` del `VariantPricingDTO` ya compuesto (presente ⇔ hay fila M-30). */
type ComposedBounty = NonNullable<VariantPricingDTO['bounty']>;

/**
 * Tabla de §M2-B.0, en el mismo orden en que la escribe el contrato:
 *
 * | `state` | Predicado |
 * |---|---|
 * | `activa` | `bountyEnabled ∧ isBountyEffective(...)` |
 * | `rebasada` | `bountyEnabled ∧ priceCents > 0 ∧ ¬isBountyEffective(...)` |
 * | `invalida` | `bountyEnabled ∧ ¬(priceCents > 0)` — *fail-safe*: encendido sin precio utilizable |
 * | `completada` | `¬bountyEnabled ∧ completedAt IS NOT NULL` (se auto-apagó al alcanzar el objetivo) |
 * | `apagada` | `¬bountyEnabled ∧ completedAt IS NULL` (lo apagó una persona) |
 *
 * ⛔ **`completada` y `apagada` NO se colapsan**: comparten `enabled=false` y no significan lo mismo
 * —*«ya conseguí lo que quería»* vs *«alguien decidió dejar de ofrecer»*—, y fundirlas borra el
 * **porqué** dejó de pagarse, que es el dato que la pantalla existe para no perder.
 *
 * ⛔ **`invalida` no se cuela dentro de `activa`**: pintar *«está pagando»* sobre un bounty encendido
 * **sin precio utilizable** es exactamente la ceguera que este estado nació para evitar.
 */
export function deriveBountyState(bounty: ComposedBounty): BountyState {
  if (!bounty.enabled) return bounty.completedAt != null ? 'completada' : 'apagada';
  if (!(bounty.priceCents != null && bounty.priceCents > 0)) return 'invalida';
  // `effective` ya ES `enabled ∧ isBountyEffective(priceCents, curveQuoteCents)` (composer). Aquí NO
  // se vuelve a comparar contra la curva: hacerlo sería la quinta implementación del predicado.
  return bounty.effective ? 'activa' : 'rebasada';
}
