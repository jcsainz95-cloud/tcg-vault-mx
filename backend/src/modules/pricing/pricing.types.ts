import { Card, CardSet, Finish, PriceSource, ProductType } from '@prisma/client';

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

// ============================================================================
// WS-A (v1.14-price-ingest, ARCHITECTURE §4.15b) — Interfaz de INGESTA MASIVA.
// Distinta del `PricingProvider` per-carta de arriba (que se conserva para el
// refresco per-carta de bóveda y los stubs graded/sealed). NO colisiona con él.
// ============================================================================

/**
 * Fila NORMALIZADA por carta+acabado que devuelve un `BulkPriceProvider` (ARCHITECTURE §4.15b).
 * El adapter YA validó/omitió las entradas mal formadas (money-safe) antes de devolverla:
 * `marketCents` es un entero de centavos > 0 y `finish` YA está mapeado a nuestro enum canónico.
 * La resolución carta↔BD (externalId primario, (set,number) fallback) la hace el
 * `PriceIngestService` con estos campos identificadores (ARCHITECTURE §4.15c/§4.15d).
 */
export interface BulkPriceRow {
  /** id pokemontcg.io de la carta (mapeo PRIMARIO → `Card.externalId`, @unique). */
  externalId?: string | null;
  /** mapeo FALLBACK: `(setExternalId, number)` → `Card`. */
  setExternalId?: string | null;
  number?: string | null;
  /** YA mapeado a nuestro enum (normal|reverse_holo|holofoil|first_edition_holofoil). */
  finish: Finish;
  /** entero de centavos, > 0 (validado por el adapter). */
  marketCents: number;
  /** moneda de ORIGEN del market (defensivo; se verifica en la 1ª corrida, §4.15h). */
  currency: 'USD' | 'MXN';
}

export interface BulkPriceResult {
  /** Filas VÁLIDAS por (carta, acabado). */
  rows: BulkPriceRow[];
  /** Entradas crudas recibidas del proveedor (observabilidad). */
  fetchedRaw: number;
  /** Entradas OMITIDAS por el mapeo defensivo del adapter (money-safe). */
  skipped: number;
}

/**
 * BulkPriceProvider — proveedor de descarga MASIVA de precios por SET (ARCHITECTURE §4.15b).
 * El adapter mapea el payload crudo → `BulkPriceRow[]` DEFENSIVAMENTE (valida y OMITE entradas
 * mal formadas ANTES de devolver: nunca NaN/negativo/cero/acabado desconocido).
 */
export interface BulkPriceProvider {
  readonly source: PriceSource;
  fetchPricesForSet(input: { set: CardSet }): Promise<BulkPriceResult>;
}

/**
 * WS-A (§4.15d) — Normaliza una variante/acabado CRUDO del proveedor de paga a nuestro enum
 * `Finish`, o `null` si es DESCONOCIDA (money-safe: NUNCA se atribuye un precio holo a `normal`;
 * variante desconocida → se OMITE la fila). La normalización quita mayúsculas y todo lo no
 * alfanumérico, para tolerar `"Reverse Holo"`, `"reverse_holo"`, `"reverseHolofoil"`, etc.
 *
 * SUPUESTO (a verificar en la 1ª corrida en Railway, §4.15h): estas son las llaves reales de
 * `tcgplayer.prices` (mirror de TCG_KEY_TO_FINISH) MÁS alias probables del proveedor de paga. El
 * `1st Edition` NORMAL (sin holo) NO tiene enum propio y se OMITE (conservador). Si la 1ª corrida
 * revela otros nombres de variante, se AMPLÍA este mapa (no se relaja a "desconocido → normal").
 */
const BULK_VARIANT_TO_FINISH: Record<string, Finish> = {
  // Llaves reales de tcgplayer.prices (mirror de TCG_KEY_TO_FINISH):
  normal: 'normal',
  holofoil: 'holofoil',
  reverseholofoil: 'reverse_holo',
  '1steditionholofoil': 'first_edition_holofoil',
  // Alias legibles / probables del proveedor de paga (SUPUESTO — verificar 1ª corrida):
  holo: 'holofoil',
  foil: 'holofoil',
  reverse: 'reverse_holo',
  reverseholo: 'reverse_holo',
  firsteditionholofoil: 'first_edition_holofoil',
  '1steditionholo': 'first_edition_holofoil',
  firsteditionholo: 'first_edition_holofoil',
};

/** Normaliza el nombre de variante crudo (quita mayúsculas y no-alfanuméricos). */
export function normalizeFinishAlias(raw: unknown): Finish | null {
  if (typeof raw !== 'string') return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return BULK_VARIANT_TO_FINISH[key] ?? null;
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
