import { Card, ProductType } from '@prisma/client';

export type PriceSourceStr = 'pokemontcg_io' | 'pokemonpricetracker' | 'poketrace' | 'manual';

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
