'use client';

import type { BuylistRule, SalesRule, TierId } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';

/** Orden canónico de los tiers (T0 Bulk → T4 Ultra/Grail). */
export const TIER_ORDER: TierId[] = ['T0', 'T1', 'T2', 'T3', 'T4'];

/** Modo de regla (idéntico en compra y venta). */
export type TierRuleMode = 'fixed' | 'pct';

/** Borrador CRUDO de una regla: value como texto (edición parcial/decimal/vaciado). */
export interface TierRuleDraft {
  mode: TierRuleMode;
  value: string;
}

/**
 * Texto CRUDO a mostrar para una regla del servidor: `fixed` = pesos (centavos/100), `pct` = tal
 * cual. Money-safe: no inventa 0 — un value 0 real se muestra como "0", no como vacío.
 */
export function ruleToRaw(rule: BuylistRule | SalesRule): string {
  return rule.mode === 'fixed' ? String(rule.value / 100) : String(rule.value);
}

/**
 * Extrae los pares infractores de un 422 PREMIUM_RARITY_FIXED_TIER (una rareza premium quedaría en
 * un tier de compra `fixed`). Devuelve `null` si el error no es ese código; `[]` si vino sin detalle.
 */
export function premiumFixedOffenders(
  error: unknown,
): { rarity: string; tierId: string }[] | null {
  if (!(error instanceof ApiClientError)) return null;
  if (error.code !== 'PREMIUM_RARITY_FIXED_TIER') return null;
  const details = error.details as { offending?: { rarity: string; tierId: string }[] } | undefined;
  return details?.offending ?? [];
}
