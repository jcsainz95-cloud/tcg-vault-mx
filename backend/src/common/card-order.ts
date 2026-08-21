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
 * v1.27 (P-13, ARCHITECTURE §4.25a) — FUNCIÓN PURA de la COMPOSICIÓN de la que deriva
 * `Card.availableFinishes`. **El precio CONFIRMA, nunca AÑADE.**
 *
 * Historia: v1.22/§4.22g introdujo la unión `structural ∪ pricedFinishesSnapshot`; v1.26/§4.24a
 * cambió la entrada estructural a `Card.structuralFinishes` (TCGCSV autoritativo). La UNIÓN quedó
 * **DEROGADA en v1.27**: era el vector de las variantes fantasma — el barrido por-impresión de PPT
 * (`fetchPrintings`) atribuye el finish por la ETIQUETA del request (no por dato de la carta) y la
 * unión promovía ese `normal` CON precio a casilla, contra la doctrina VAR-1 que este mismo archivo
 * ya declaraba. Fórmula vigente (§4.25a-1, NORMATIVA):
 *
 *   availableFinishes :=
 *     structuralFinishes ≠ ∅ :  orderFinishes(structuralFinishes)  // TCGCSV es LA autoridad
 *     structuralFinishes = ∅ :  ['normal']                         // fallback legacy (§4.25a-3)
 *
 *  - `structuralFinishes` — «¿qué impresiones físicas existen?» (TCGCSV `subTypeName`; seed inicial
 *    desde pokemontcg.io en CREATE). Estructura ≠ precio: una impresión sin `PriceReference` sigue
 *    contando (whitelist la admite ⇒ vendible tras precio), nunca se dropea ni se inventa.
 *  - `pricedFinishesSnapshot` — **SALE de la composición**. Se conserva la columna solo como
 *    observabilidad/confirmación (log `pricedNotStructural` en el reconciliador); jamás compone.
 *
 * Fallback `['normal']` (opción b de §4.25a-3, ELEGIDA): conservador y fail-closed para dinero —
 * mejor «falta una casilla» que «sobra una falsa»; una carta legacy sin resolver TCGCSV da
 * `422 FINISH_NOT_AVAILABLE` al cotizar un acabado no declarado, hasta el re-sync forzado.
 *
 * Determinista y RECOMPUTABLE: quitar un acabado de `structuralFinishes` y recomputar lo ELIMINA
 * (no es monótona-creciente — así se limpian los fantasmas ya materializados). Nunca vacía. Vive
 * junto a `orderFinishes` (sin DI) para reusarse desde el `FinishReconciler`, los seeds y los tests.
 *
 * El ÚNICO escritor de `Card.availableFinishes` (`catalog.FinishReconciler`) la usa; `price-ingest`,
 * `catalog-sync` y el resolver TCGCSV escriben SU columna de entrada y NUNCA `availableFinishes`.
 */
export function composeAvailableFinishes(structuralFinishes: Iterable<Finish>): Finish[] {
  const ordered = orderFinishes(structuralFinishes);
  return ordered.length > 0 ? ordered : ['normal'];
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
