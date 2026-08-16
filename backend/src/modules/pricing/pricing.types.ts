import { Card, Finish, ProductType } from '@prisma/client';

export type PriceSourceStr = 'pokemontcg_io' | 'pokemonpricetracker' | 'poketrace' | 'manual';

/**
 * v1.6-finish — mapeo Finish → llave de `tcgplayer.prices` (inverso de ARCHITECTURE §3.7).
 * El provider lee `prices[llave].market` de ESE acabado (deja de tomar el primero disponible).
 */
export const FINISH_TO_TCG_KEY: Record<Finish, string> = {
  normal: 'normal',
  reverse_holo: 'reverseHolofoil',
  holofoil: 'holofoil',
  first_edition_holofoil: '1stEditionHolofoil',
};

/**
 * v1.6-finish — mapeo llave de `tcgplayer.prices` → Finish (ARCHITECTURE §3.7). Las llaves
 * no listadas (`1stEditionNormal`, `unlimitedHolofoil`, …) se ignoran al derivar availableFinishes.
 */
export const TCG_KEY_TO_FINISH: Record<string, Finish> = {
  normal: 'normal',
  reverseHolofoil: 'reverse_holo',
  holofoil: 'holofoil',
  '1stEditionHolofoil': 'first_edition_holofoil',
};

/**
 * Deriva los acabados disponibles a partir de las llaves presentes en `tcgplayer.prices`.
 * Descarta las no mapeadas; ausente/vacío → [normal] (default seguro). ARCHITECTURE §3.7/§4.8.
 */
export function deriveAvailableFinishes(
  prices?: Record<string, unknown> | null,
): Finish[] {
  if (!prices) return ['normal'];
  const set = new Set<Finish>();
  for (const key of Object.keys(prices)) {
    const finish = TCG_KEY_TO_FINISH[key];
    if (finish) set.add(finish);
  }
  return set.size > 0 ? [...set] : ['normal'];
}

export interface PriceQuote {
  /** Precio en USD centavos (si la fuente da USD) o null. */
  priceUsdCents?: number | null;
  /** Precio en MXN centavos (si la fuente ya da MXN). */
  priceMxnCents?: number | null;
  source: PriceSourceStr;
}

export interface PricingProviderInput {
  card: Card;
  productType: ProductType;
  gradeKey: string;
  /** v1.6-finish: acabado pedido; el provider lee el market de ESE acabado. */
  finish: Finish;
}

/**
 * PricingProvider — Interfaz intercambiable. ARCHITECTURE §4.1.
 * fetchPrice devuelve el precio (USD o MXN) o null si la fuente no lo tiene.
 */
export interface PricingProvider {
  readonly source: PriceSourceStr;
  supports(productType: ProductType): boolean;
  fetchPrice(input: PricingProviderInput): Promise<PriceQuote | null>;
}

/** Normaliza el gradeKey usado en PriceReference (ARCHITECTURE §3.2). */
export function buildGradeKey(input: {
  productType: ProductType;
  rawCondition?: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
}): string {
  switch (input.productType) {
    case 'raw':
      return `raw:${input.rawCondition ?? 'NM'}`;
    case 'graded':
      return `graded:${input.gradingCompany ?? 'PSA'}:${input.gradeValue ?? '10'}`;
    case 'sealed':
      return 'sealed';
    default:
      return 'unknown';
  }
}
