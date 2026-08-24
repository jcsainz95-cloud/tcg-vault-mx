import { VariantPriceOverride } from '@prisma/client';
import { PriceBasis, computeSalePriceFromCurve, quoteAcquisitionFromCurve } from '../../common/money';
import { PricingCurve, isBountyEffective, premiumFloorGuard } from '../../common/pricing-curve';

/**
 * variant-pricing.ts — v1.28 (P-18/P-22) · v2.0 (P-48, ARCHITECTURE §4.36 / API_CONTRACT §DTOs).
 * COMPOSER PURO del `VariantPricingDTO`: la lectura de la consola de TRES precios por
 * (carta, variante). Sin dependencias de infra — el caller iza la CURVA/referencias/overrides en
 * LOTE (`loadPricingCurve` + `getReferencesBatch` + `getVariantOverridesBatch`) y compone por
 * variante con este único cuerpo. Lo usan:
 *  - `VariantControlsService` (respuesta resuelta del PUT variant-controls), y
 *  - `MasterSetService.binder` (campo `pricing?` de la variante, SOLO scope `platform`).
 *
 * v2.0 (P-48): el sugerido ya NO es «lo que da la regla» sino **lo que da la CURVA** para el valor de
 * mercado de la variante, y `source` deja de ser `rule|fallback` para ser el `PriceBasis` normativo
 * (`market | floor | override | bounty | pending`). **Ni la rareza ni el acabado entran al monto**
 * (criterio 84): el acabado ya eligió DE QUÉ VARIANTE se lee el mercado, antes de llegar aquí.
 *
 * Money-safe: `suggested`/`effective` = `null` cuando no resolubles (JAMÁS un 0 inventado);
 * `source='pending'` cuando ningún peldaño resolvió. La matemática de precedencias vive en
 * `common/money.ts` (`quoteAcquisitionFromCurve` / `computeSalePriceFromCurve`) — aquí solo se
 * proyecta al DTO del contrato, sin duplicar cuerpos.
 */

/** API_CONTRACT §DTOs (v1.28, actualizado v2.0 P-48). */
export interface VariantPricingDTO {
  buy: {
    /** Lo que da la CURVA hoy sobre el mercado de la variante (bin incluido). `null` = no resuelve. */
    suggestedCents: number | null;
    overrideCents: number | null;
    effectiveCents: number | null;
    /** v2.0: `PriceBasis` — `market|floor` sustituyen a `rule|fallback`. */
    source: PriceBasis;
    /**
     * v2.0 (§4.36.5) — el GUARDARRAÍL disparó en este eje: rareza premium que aterrizó en el piso/bin
     * ⇒ NO se publica / NO se cotiza y hay entrada `premium_at_floor` en la cola. Es lo que hace
     * VISIBLE el guardarraíl desde el back-office y permite detectar PISOS MAL CALIBRADOS.
     */
    premiumAtFloor: boolean;
  };
  sell: {
    suggestedCents: number | null;
    overrideCents: number | null;
    effectiveCents: number | null;
    source: PriceBasis;
    premiumAtFloor: boolean;
  };
  bounty?: {
    enabled: boolean;
    priceCents: number | null;
    targetQty: number | null;
    acquiredQty: number;
    completedAt: string | null;
    /**
     * v2.0 (§4.36.6, criterios 90/91) — **LA ALERTA DEL BINDER**. `false` ⇔ el bounty quedó por
     * debajo (o IGUAL) de la tarifa vigente ⇒ NO aplica en la cotización, NO se publica en la vitrina
     * y `buy.source` NO será `bounty`. Decisión del humano: basta el binder, SIN aviso proactivo por
     * correo/push/dashboard.
     */
    effective: boolean;
    /** La cotización de curva que lo rebasó. `null` = la curva no resuelve ⇒ el bounty SIGUE siendo efectivo. */
    curveQuoteCents: number | null;
  } | null;
}

/**
 * Compone el `VariantPricingDTO` de UNA variante. `referenceMxnCents` = la referencia de mercado
 * del ACABADO (ya FX-recomputada por `getReferencesBatch`/`getReference`; `null` = pending).
 * `override` = la fila M-30 de la variante o `null` (sin fila ⇒ solo sugeridos por curva).
 *
 * - `suggestedCents` = lo que da la CURVA hoy (sin override ni bounty) — el "sugerido" de la consola,
 *   y la cifra contra la que el dueño compara sus overrides heredados (§4.36.9c-5).
 * - `effectiveCents`/`source` = el precio RESUELTO con la precedencia normativa §4.36.6
 *   (COMPRA: bounty válido > override > curva > pending · VENTA: sellOverride > curva > pending; el
 *   `listPriceCents` POR PIEZA no viaja aquí — vive en el drill-down y gana para ESA pieza).
 * - `bounty` viene SOLO si existe fila M-30 (estado para la edición en consola, P-22).
 */
export function composeVariantPricing(
  referenceMxnCents: number | null,
  curve: PricingCurve,
  override: VariantPriceOverride | null,
  /**
   * v2.0 (§4.36.5) — rareza CANÓNICA de la carta, SOLO para el veredicto del guardarraíl. No entra al
   * monto (criterio 84): `premiumFloorGuard` devuelve un booleano de publicación, jamás una cantidad.
   */
  rarityCanonical: string | null = null,
): VariantPricingDTO {
  // COMPRA — un solo cuerpo: el resultado trae el efectivo Y lo que daría la curva sola.
  const buy = quoteAcquisitionFromCurve(referenceMxnCents, curve, override);
  // VENTA — efectivo A NIVEL VARIANTE (sellOverride > curva); el override por pieza no entra aquí.
  const sell = computeSalePriceFromCurve(referenceMxnCents, curve, override);

  const buyGuarded = premiumFloorGuard(rarityCanonical, buy.basis) === 'premium_at_floor';
  const sellGuarded = premiumFloorGuard(rarityCanonical, sell.basis) === 'premium_at_floor';

  return {
    buy: {
      suggestedCents: buy.curveQuoteCents, // lo que DARÍA la curva: el diagnóstico del piso mal calibrado
      overrideCents: override?.buyOverrideCents ?? null,
      // Con el guardarraíl disparado la variante NO se cotiza ⇒ efectivo nulo y `pending`, igual que
      // en runtime. El `suggestedCents` sigue visible para que el dueño vea POR QUÉ se bloqueó.
      effectiveCents: buyGuarded ? null : buy.priceCents,
      source: buyGuarded ? 'pending' : buy.basis,
      premiumAtFloor: buyGuarded,
    },
    sell: {
      suggestedCents: sell.curveQuoteCents,
      overrideCents: override?.sellOverrideCents ?? null,
      effectiveCents: sellGuarded ? null : sell.priceCents,
      source: sellGuarded ? 'pending' : sell.basis,
      premiumAtFloor: sellGuarded,
    },
    // Solo si existe fila M-30 (contrato §DTOs: "bounty viene (solo si existe fila)").
    ...(override
      ? {
          bounty: {
            enabled: override.bountyEnabled,
            priceCents: override.bountyPriceCents,
            targetQty: override.bountyTargetQty,
            acquiredQty: override.bountyAcquiredQty,
            completedAt: override.bountyCompletedAt ? override.bountyCompletedAt.toISOString() : null,
            // MISMO predicado que el runtime y que la vitrina (prohibido duplicarlo, §4.36.6).
            effective:
              override.bountyEnabled && isBountyEffective(override.bountyPriceCents, buy.curveQuoteCents),
            curveQuoteCents: buy.curveQuoteCents,
          },
        }
      : {}),
  };
}
