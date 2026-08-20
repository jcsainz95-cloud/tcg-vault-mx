import { Finish, Prisma } from '@prisma/client';
import { isPremiumRarity } from './money';

/**
 * card-order.ts (v1.22-variantes-orden) — ORDEN CANÓNICO de cartas y acabados.
 *
 * UN solo algoritmo, en un solo lugar (ARCHITECTURE §4.22b: «Prohibido que la clave persistida y
 * la función diverjan»). Lo consumen:
 *  - `CatalogSyncService.upsertCards`  → ESCRIBE `Card.numberSort` / `Card.numberPrefix` (M-26).
 *  - `CatalogService.searchAllCards`   → `orderBy` normativo de `GET /buylist/cards` (§4.22b).
 *  - `MasterSetService.binder/index`   → mismo `orderBy`, ordenando EN BD.
 *  - `prisma/seed*.ts`                 → siembra coherente (§4.22e).
 * El backfill SQL de la migración M-26 es el espejo 1:1 de `deriveNumberParts` (incluido el clamp).
 *
 * Este módulo NO depende de Nest ni de PrismaService (solo de tipos generados) para poder
 * importarse desde los seeds sin arrastrar el contenedor de DI.
 */

/** Base de orden para números NO-puros-numéricos (promos/subsets tipo TG/GG/SV) → van al FINAL. */
export const PROMO_SORT_BASE = 1_000_000;

/**
 * Tope de la parte numérica. Espejo del `LEAST(..., 999999)` del backfill SQL de M-26: evita
 * desbordar el `INTEGER` de Postgres con un `number` absurdamente largo (§4.22b).
 */
export const NUMBER_SORT_CLAMP = 999_999;

/**
 * Orden canónico del enum `Finish` (ARCHITECTURE §3.7, NORMATIVO desde v1.22). Es el orden en que
 * se PERSISTE `Card.availableFinishes` y en que se EMITE en todo DTO que lo exponga. De él sale,
 * sin `sort` en el front, el requisito del PO: **normal a la IZQUIERDA, reverse holo a la DERECHA**.
 */
export const FINISH_ORDER: Finish[] = [
  'normal',
  'reverse_holo',
  'holofoil',
  'first_edition_holofoil',
];

/** Deduplica y ordena una lista de acabados por `FINISH_ORDER` (nunca inventa acabados). */
export function orderFinishes(finishes: Iterable<Finish>): Finish[] {
  const set = new Set<Finish>(finishes);
  return FINISH_ORDER.filter((f) => set.has(f));
}

/**
 * v1.22-1 (ARCHITECTURE §4.22g) — FUNCIÓN PURA de la UNIÓN money-safe de la que deriva
 * `Card.availableFinishes`.
 *
 * v1.26 (§4.24a) — la ENTRADA estructural del lado catálogo CAMBIA: `catalogFinishes` era un PROXY
 * de precio (llaves presentes de `tcgplayer.prices` ∪ `cardmarket.reverseHolo*`) que el PO rechaza.
 * Se sustituye por `Card.structuralFinishes` —afirmación ESTRUCTURAL autoritativa DETECTADA de
 * TCGCSV—. La fórmula pasa a:
 *
 *   availableFinishes := orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']
 *
 *  - `structuralFinishes`      — «¿qué impresiones físicas existen?» (TCGCSV `subTypeName`; seed
 *    inicial desde pokemontcg.io). Estructura ≠ precio: una impresión sin `PriceReference` sigue
 *    contando (whitelist la admite ⇒ vendible tras precio), nunca se dropea ni se inventa.
 *  - `pricedFinishesSnapshot`  — Señal C: acabados que PPT reportó con `market>0` y ALIAS VERIFICADO.
 *    NO añade estructura (VAR-1): solo confirma precio de una impresión ya estructural.
 *
 * Determinista y RECOMPUTABLE: quitar un acabado de CUALQUIERA de las dos entradas y recomputar lo
 * ELIMINA (no es monótona-creciente, candado 1 de §4.22g). Nunca vacía: sin ninguna señal ⇒
 * `['normal']` (default seguro, idéntico a hoy; jamás una casilla de relleno inventada). Vive junto
 * a `orderFinishes` (sin DI) para reusarse desde el `FinishReconciler`, los seeds y los tests.
 *
 * El ÚNICO escritor de `Card.availableFinishes` (`catalog.FinishReconciler`) la usa; `price-ingest`,
 * `catalog-sync` y el resolver TCGCSV escriben SU columna de entrada y NUNCA `availableFinishes`.
 */
export function unionAvailableFinishes(
  structuralFinishes: Iterable<Finish>,
  pricedFinishesSnapshot: Iterable<Finish>,
): Finish[] {
  const merged = orderFinishes([...structuralFinishes, ...pricedFinishesSnapshot]);
  return merged.length > 0 ? merged : ['normal'];
}

/**
 * v1.22-2 / N-15 (ARCHITECTURE §4.22a-6) — `displayFinishes`: acabados que el FRONT PINTA como
 * casillas/tarjetas. Campo DERIVADO de DISPLAY, **separado** de la whitelist SEC-A1
 * `availableFinishes` (que sigue validando `finish` y derivando el monto server-side). Función PURA,
 * money-safe: SOLO RESTA acabados espurios, JAMÁS AÑADE (imposible que N-15 invente nada).
 *
 *   pricedFinishes := { f ∈ availableFinishes : hasPricedRef(card, f) }
 *   displayFinishes(card) :=
 *     if isPremiumRarity(rarity) === true  AND  pricedFinishes ≠ ∅:
 *          orderFinishes(pricedFinishes)   // premium de 1 impresión: SOLO acabados con market>0
 *     else:
 *          availableFinishes               // DEFAULT: sin supresión (comportamiento actual)
 *
 * Invariantes GARANTIZADAS por construcción:
 *  - `displayFinishes ⊆ availableFinishes` (el resultado se FILTRA de `availableFinishes`).
 *  - NUNCA vacío (≥ 1): la salvaguarda anti-cero-casillas devuelve `availableFinishes` si
 *    `pricedFinishes = ∅` (premium totalmente pendiente no se suprime — nunca deja una celda sin casillas).
 *  - Orden canónico `FINISH_ORDER` (se emite `orderFinishes(availableFinishes)`).
 *
 * `isPremiumRarity` se REUSA de `common/money.ts` (mismo clasificador chase del buylist Fase 0.1);
 * `isPremiumRarity(null) === false` ⇒ rareza null/desconocida ⇒ sin supresión. NO se inventa
 * `reverse_holo` por rareza (VAR-1 §9 intacto): la rareza es SOLO *gate* para ocultar, nunca para añadir.
 *
 * @param pricedFinishes conjunto de acabados con `hasPricedRef` (PriceReference raw/`raw:NM`,
 *   `priceMxnCents > 0`); el mismo por-acabado que resuelve `referenceValue`/quote. Puede incluir
 *   acabados fuera de `availableFinishes` — la intersección la hace el filtro (subset garantizado).
 */
export function computeDisplayFinishes(
  rarity: string | null,
  availableFinishes: Finish[] | null | undefined,
  pricedFinishes: Iterable<Finish>,
): Finish[] {
  const ordered = orderFinishes(availableFinishes ?? []);
  const base: Finish[] = ordered.length > 0 ? ordered : ['normal'];
  if (!isPremiumRarity(rarity)) return base;
  const pricedSet = new Set<Finish>(pricedFinishes);
  const priced = base.filter((f) => pricedSet.has(f));
  // Salvaguarda anti-cero-casillas: premium sin ningún acabado priceado ⇒ NO se suprime.
  return priced.length > 0 ? priced : base;
}

/**
 * ORDEN NATURAL (ARCHITECTURE §4.17a/§4.22b). `Card.number` es String → el orden lexicográfico
 * rompe ("10" < "2"; "TG12" mal ubicado). Deriva las CLAVES PERSISTIDAS (M-26):
 *  - número PURO ("4", "10", "191") → `numberSort` = su entero, `prefix` = '' (ordena PRIMERO,
 *    porque '' es el menor string);
 *  - número con letras ("TG12", "SV107", "GG50") → `numberSort` = PROMO_SORT_BASE + parte numérica
 *    y `prefix` = las letras → va al FINAL, agrupado por prefijo.
 * La parte numérica se CLAMPEA a `NUMBER_SORT_CLAMP` (igual que el backfill SQL).
 *
 * v1.22 — pasa de comparador en memoria a FUNCIÓN DE ESCRITURA CANÓNICA: `upsertCards` y los seeds
 * pueblan `Card.numberSort`/`Card.numberPrefix` con ella, y el servidor ordena por esas columnas.
 *
 * Casos borde documentados (parity con el comparador previo; §4.22b NO cambia la semántica aquí):
 * `"23a"` → prefix "a", numberSort 1_000_023 (cae con las promos); `""` → prefix "", 1_000_000.
 */
export function deriveNumberParts(raw: string): { numberSort: number; prefix: string; num: number } {
  if (/^\d+$/.test(raw)) {
    const n = Math.min(parseInt(raw, 10), NUMBER_SORT_CLAMP);
    return { numberSort: n, prefix: '', num: n };
  }
  const digits = raw.replace(/\D/g, '');
  const num = digits === '' ? 0 : Math.min(parseInt(digits, 10), NUMBER_SORT_CLAMP);
  const prefix = raw.replace(/[0-9]/g, '');
  return { numberSort: PROMO_SORT_BASE + num, prefix, num };
}

/**
 * Comparador de orden natural estable. Desde v1.22 se conserva SOLO como oráculo de tests y para
 * colecciones YA materializadas en memoria: el orden de producción lo aplica la BD (§4.22b).
 *  1. las cartas PURO-numéricas van primero, ordenadas por su entero ("2" < "10" < "200");
 *  2. las cartas con prefijo (promos/subsets TG/GG/SV) van al FINAL, agrupadas por prefijo
 *     alfabético (GG → SV → TG), y dentro del prefijo por su parte numérica ("TG2" < "TG12");
 *  3. desempate final por el `number` crudo.
 */
export function compareByNumber(a: { number: string }, b: { number: string }): number {
  const pa = deriveNumberParts(a.number);
  const pb = deriveNumberParts(b.number);
  const promoA = pa.prefix !== '';
  const promoB = pb.prefix !== '';
  if (promoA !== promoB) return promoA ? 1 : -1; // puro-numérico antes que promo
  if (!promoA) {
    // ambos puro-numéricos → por entero
    if (pa.num !== pb.num) return pa.num - pb.num;
    return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  }
  // ambos promos → agrupar por prefijo, luego por número
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
  if (pa.num !== pb.num) return pa.num - pb.num;
  return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
}

/**
 * `orderBy` NORMATIVO dentro de UN set (binder / master set / `GET /buylist/cards?setId=`).
 * API_CONTRACT §6 y ARCHITECTURE §4.22b. El `{ id: 'asc' }` final NO es cosmético: es el desempate
 * TOTAL que hace DETERMINISTA la paginación (sin él, dos filas empatadas pueden intercambiarse
 * entre dos consultas y producir filas repetidas o saltadas al cambiar de página).
 */
export const CARD_ORDER_BY_IN_SET: Prisma.CardOrderByWithRelationInput[] = [
  { numberPrefix: 'asc' },
  { numberSort: 'asc' },
  { number: 'asc' },
  { id: 'asc' },
];

/**
 * `orderBy` NORMATIVO SIN `setId` (búsqueda de texto sobre varios sets): nombre primero, orden
 * natural dentro. API_CONTRACT §6 / ARCHITECTURE §4.22b.
 */
export const CARD_ORDER_BY_GLOBAL: Prisma.CardOrderByWithRelationInput[] = [
  { name: 'asc' },
  { setId: 'asc' },
  { numberPrefix: 'asc' },
  { numberSort: 'asc' },
  { id: 'asc' },
];
