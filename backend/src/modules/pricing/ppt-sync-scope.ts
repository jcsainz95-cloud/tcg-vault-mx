import { CardSet } from '@prisma/client';

/**
 * ppt-sync-scope.ts — REGLA DE SCOPE del PO para la ingesta de precios de PokemonPriceTracker
 * (WS-A fix-ppt, 2026-08-19). Causa #2 del incidente: un barrido de los 174 sets (~26k créditos)
 * EXCEDE el plan Pro (20,000 créditos/día) → `429 daily`. Por eso NO se sincroniza todo el catálogo.
 *
 * Regla del PO (impleméntala tal cual):
 *  - **(a) Set con `releaseDate` año ≥ {@link SCOPE_YEAR_THRESHOLD}** → `full`: TODAS sus cartas.
 *  - **(b) Set con año < umbral** → `partial`: SOLO las cartas con `InventoryItem` activo ∪ las
 *    cartas RARAS (por `rarity`). En sets viejos NO se trae el bulk de comunes; solo inventario + rares.
 *  - Un set viejo SIN inventario activo y SIN cartas raras → `skip` (no se pide nada: ahorra créditos).
 *
 * El `year` sale de `CardSet.releaseDate` (formato pokemontcg.io `yyyy/MM/dd`, p. ej. `2024/11/08`).
 * Si un set no tiene `releaseDate` parseable, se trata como año DESCONOCIDO → `partial` (conservador:
 * no se asume que es moderno y se limita a inventario+rares, en vez de barrer todo el set a ciegas).
 */

/** Año-frontera de la regla (a)/(b) del PO. Sets con releaseDate ≥ este año → full; < → partial. */
export const SCOPE_YEAR_THRESHOLD = 2020;

export type SetScope = 'full' | 'partial' | 'skip';

/** Año de `releaseDate` (`yyyy/MM/dd` o `yyyy-MM-dd`), o null si falta/no parsea. */
export function releaseYear(set: Pick<CardSet, 'releaseDate'>): number | null {
  const raw = set.releaseDate;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4})/);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

/**
 * ¿El set es MODERNO (año ≥ umbral)? Un año desconocido cuenta como NO-moderno (conservador).
 * `full` para modernos; los demás son `partial` o `skip` según tengan cartas en scope.
 */
export function isModernSet(set: Pick<CardSet, 'releaseDate'>): boolean {
  const year = releaseYear(set);
  return year != null && year >= SCOPE_YEAR_THRESHOLD;
}

/**
 * UMBRAL DE RAREZA — define, de forma EXPLÍCITA y documentada, qué cuenta como carta "rara" (con
 * valor de mercado real) en un set VIEJO, para excluir el bulk de comunes/uncommons. La lista se
 * evalúa sobre `Card.rarity` (string de pokemontcg.io), normalizada a minúsculas.
 *
 * EXCLUIDAS (bulk que NO se pide en sets viejos): `common`, `uncommon`, y sus variantes de nombre.
 * TODO lo demás (holo rare, ultra rare, secret, illustration/special/hyper rare, amazing, radiant,
 * promo, LEGEND, prime, BREAK, ACE SPEC, trainer gallery, shiny, gold, …) cuenta como RARA. Se toma
 * el criterio INCLUSIVO (raro = no-bulk) en vez de una allow-list cerrada de rarezas raras, porque
 * pokemontcg.io inventa nombres de rareza nuevos cada set: una allow-list cerrada dejaría fuera
 * rarezas nuevas valiosas (falso "bulk"), mientras que la deny-list de bulk es estable y pequeña.
 */
const BULK_RARITIES = new Set<string>([
  'common',
  'uncommon',
  // Variantes/typos tolerados (normalizados a minúsculas, sin puntuación gestionada abajo).
  'commoncard',
  'uncommoncard',
]);

/**
 * ¿La rareza es RARA (no-bulk) según el umbral documentado? `null`/desconocida cuenta como RARA
 * (conservador money-safe: ante duda se INCLUYE — nunca se descarta una carta potencialmente valiosa
 * por no reconocer su rareza; a lo sumo se gasta un crédito de más, jamás se pierde un precio real).
 */
export function isRareRarity(rarity: string | null | undefined): boolean {
  if (rarity == null) return true;
  const key = rarity.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key === '') return true;
  return !BULK_RARITIES.has(key);
}

/**
 * Clasifica un set según el scope, dado un CONTEO de cuántas cartas suyas están "en scope" para el
 * caso partial (= inventario activo ∪ rares). El conteo lo calcula el llamador con la BD:
 *  - moderno → `full` (todas las cartas; el conteo no aplica).
 *  - viejo con `inScopeCardCount > 0` → `partial`.
 *  - viejo con `inScopeCardCount === 0` → `skip`.
 */
export function classifySet(set: Pick<CardSet, 'releaseDate'>, inScopeCardCount: number): SetScope {
  if (isModernSet(set)) return 'full';
  return inScopeCardCount > 0 ? 'partial' : 'skip';
}
