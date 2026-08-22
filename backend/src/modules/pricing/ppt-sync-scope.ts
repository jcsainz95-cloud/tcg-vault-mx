import { CardSet } from '@prisma/client';
// v1.29 (§4.28e): la ÚNICA definición de «premium» vive en el catálogo canónico. Este módulo DELEGA
// (se RETIRA `PREMIUM_RARITY_TERMS`, que divergía de la de money.ts). Una sola verdad en el sistema.
import { isPremiumCanonicalRarity } from '../../common/rarity-catalog';

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
 * UMBRAL DE RAREZA (REFINAMIENTO DEL PO, 2026-08-19) — define de forma EXPLÍCITA y documentada qué
 * cuenta como carta PREMIUM/CHASE (de alto valor) en un set VIEJO. El objetivo es cazar SOLO el chase
 * de valor, NO el bulk ni el rare normal. Se evalúa sobre `Card.rarity` (string de pokemontcg.io).
 *
 * INCLUIR (SOLO premium/chase):
 *  - "Illustration Rare para arriba": Illustration Rare, Special Illustration Rare, Hyper/Rainbow Rare,
 *    Gold/Secret Rare.
 *  - Cartas tipo ex/EX/GX/V/VMAX/VSTAR (+ Mega/M-EX, V-UNION) y equivalentes chase: Full Art
 *    (pokemontcg.io: "Rare Ultra"), Lv.X, Prime, BREAK, LEGEND, Amazing/Radiant, Shiny/Shining,
 *    Prism Star.
 *  - **CAVEAT CROSS-ERA:** en sets MUY viejos (base/neo/e-card/EX era) NO existe "Illustration Rare";
 *    ahí el premium equivalente es **"Rare Holo"** (p. ej. Charizard Base = Rare Holo) y los "EX" de
 *    esa época. Por eso `holo` ES un término premium: nunca se excluye por accidente un holo valioso.
 *
 * EXCLUIR: `common`, `uncommon`, `rare` normal (no-holo). El **reverse holo NO cuenta como rareza**
 * (es un ACABADO, no un tier): jamás se incluye una carta de un set viejo solo por tener impresión
 * reverse holo. `Card.rarity` es la única señal aquí (no los acabados), así que una impresión reverse
 * holo NUNCA dispara la inclusión; el guard `reverse` es defensivo por si algún dato la trae como rareza.
 *
 * `null`/desconocida → NO premium (excluida de rares). Money-safe igual: si TENEMOS la carta
 * (InventoryItem activo) entra por esa vía sin importar la rareza; solo se descarta lo que NO
 * tenemos y cuya rareza no reconocemos como premium (no vale el gasto de un crédito a ciegas).
 */
/**
 * ¿La rareza es PREMIUM/CHASE (incluible en un set viejo) según la ÚNICA definición del sistema?
 *
 * v1.29 (§4.28e): DELEGA en `isPremiumCanonicalRarity` (catálogo canónico). Se RETIRAN
 * `PREMIUM_RARITY_TERMS`/`PREMIUM_RARITY_WORDS` (divergían de money.ts: p. ej. clasificaban «Rare
 * Holo» como premium mientras money.ts NO). Con TCGCSV gratis como fuente PRIMARIA de singles
 * (§4.27), racionar la API de paga dejó de ser el driver de este gate — de ahí que una sola verdad
 * (la del pricing buylist) baste. Consecuencia documentada: algunos holos de set viejo que antes
 * entraban al scope `partial` por su rareza ahora dependen de tener inventario activo; los cubre el
 * re-sync TCGCSV por set. Ver BACKEND_NOTES.
 */
export function isPremiumRarity(rarity: string | null | undefined): boolean {
  return isPremiumCanonicalRarity(rarity ?? null);
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
