import { Finish, VariantPriceOverride } from '@prisma/client';
import {
  BuylistRule,
  SalesRule,
  computeSalePriceForRarity,
  quoteAcquisitionForFinish,
} from '../../common/money';

/**
 * variant-pricing.ts — v1.28 (P-18/P-22, ARCHITECTURE §4.26b / API_CONTRACT §DTOs).
 * COMPOSER PURO del `VariantPricingDTO`: la lectura de la consola de TRES precios por
 * (carta, variante). Sin dependencias de infra — el caller iza reglas/referencias/overrides en
 * LOTE (loadBuylistRules + loadSalesRules + getReferencesBatch + getVariantOverridesBatch) y
 * compone por variante con este único cuerpo. Lo usan:
 *  - `VariantControlsService` (respuesta resuelta del PUT variant-controls), y
 *  - `MasterSetService.binder` (campo `pricing?` de la variante, SOLO scope `platform`).
 *
 * Money-safe: `suggested`/`effective` = `null` cuando no resolubles (JAMÁS un 0 inventado);
 * `source='pending'` cuando ningún peldaño resolvió. La matemática de precedencias vive en
 * `common/money.ts` (`quoteAcquisitionForFinish` / `computeSalePriceForRarity`) — aquí solo se
 * proyecta al DTO del contrato, sin duplicar cuerpos.
 */

/** Contexto de reglas izado UNA vez por request (pago mínimo BE-25). */
export interface VariantPricingRulesCtx {
  buy: { rules: Record<string, BuylistRule>; fallbackPct: number };
  sell: { rules: Record<string, SalesRule>; fallbackPct: number };
}

/** API_CONTRACT §DTOs (v1.28) — VariantPricingDTO. */
export interface VariantPricingDTO {
  buy: {
    suggestedCents: number | null;
    overrideCents: number | null;
    effectiveCents: number | null;
    source: 'bounty' | 'override' | 'rule' | 'fallback' | 'pending';
  };
  sell: {
    suggestedCents: number | null;
    overrideCents: number | null;
    effectiveCents: number | null;
    source: 'override' | 'rule' | 'fallback' | 'pending';
  };
  bounty?: {
    enabled: boolean;
    priceCents: number | null;
    targetQty: number | null;
    acquiredQty: number;
    completedAt: string | null;
  } | null;
}

/**
 * Compone el `VariantPricingDTO` de UNA variante. `referenceMxnCents` = la referencia de mercado
 * del ACABADO (ya FX-recomputada por `getReferencesBatch`/`getReference`; `null` = pending).
 * `override` = la fila M-30 de la variante o `null` (sin fila ⇒ solo sugeridos por regla).
 *
 * - `suggestedCents` = lo que da la REGLA HOY (sin override) — es el "sugerido" de la consola.
 * - `effectiveCents`/`source` = el precio RESUELTO con la precedencia normativa §4.26b
 *   (COMPRA: bounty > override > regla > pending · VENTA: sellOverride > regla > pending; el
 *   `listPriceCents` POR PIEZA no viaja aquí — vive en el drill-down y gana para ESA pieza).
 * - `bounty` viene SOLO si existe fila M-30 (estado para la edición en consola, P-22).
 */
export function composeVariantPricing(
  rarity: string | null,
  finish: Finish,
  referenceMxnCents: number | null,
  rules: VariantPricingRulesCtx,
  override: VariantPriceOverride | null,
): VariantPricingDTO {
  // COMPRA — sugerido (regla sola) + efectivo (precedencia completa, mismo cuerpo único).
  const buySuggested = quoteAcquisitionForFinish(
    rarity,
    finish,
    referenceMxnCents,
    rules.buy.rules,
    rules.buy.fallbackPct,
  );
  const buyEffective = quoteAcquisitionForFinish(
    rarity,
    finish,
    referenceMxnCents,
    rules.buy.rules,
    rules.buy.fallbackPct,
    override,
  );

  // VENTA — sugerido (regla sola) + efectivo A NIVEL VARIANTE (sellOverride > regla).
  const sellSuggested = computeSalePriceForRarity(
    rarity,
    finish,
    referenceMxnCents,
    rules.sell.rules,
    rules.sell.fallbackPct,
  );
  const sellEffective = computeSalePriceForRarity(
    rarity,
    finish,
    referenceMxnCents,
    rules.sell.rules,
    rules.sell.fallbackPct,
    override,
  );

  return {
    buy: {
      suggestedCents: buySuggested.quotedPriceCents,
      overrideCents: override?.buyOverrideCents ?? null,
      effectiveCents: buyEffective.quotedPriceCents,
      source: buyEffective.quotedPriceCents == null ? 'pending' : buyEffective.ruleSource,
    },
    sell: {
      suggestedCents: sellSuggested.salePriceCents,
      overrideCents: override?.sellOverrideCents ?? null,
      effectiveCents: sellEffective.salePriceCents,
      source: sellEffective.salePriceCents == null ? 'pending' : sellEffective.ruleSource,
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
          },
        }
      : {}),
  };
}
