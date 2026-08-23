import { CardProductKind, Finish, Prisma } from '@prisma/client';

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
 * v1.29 (ARCHITECTURE §4.27c) — FUNCIÓN PURA de la que deriva `Card.availableFinishes`: la lista
 * blanca SEC-A1 se lee DIRECTO de los productos de la carta (sin heurística), **matando el fantasma
 * por construcción**. Deroga `composeAvailableFinishes` (unión `structural ∪ snapshot − {normal|premium}`)
 * y `computeDisplayFinishes`/N-15.
 *
 *   availableFinishes(card) := orderFinishes( ⋃ { p.finishes : p ∈ CardProduct(card),
 *                                                  p.kind ∈ {set_base, other} } )  ||  ['normal']
 *
 *  - Solo los productos `set_base`/`other` componen la carta de set. Los `deck_exclusive`/`promo` son
 *    PRODUCTOS VENDIBLES SEPARADOS (§4.27e); sus acabados NUNCA se funden con la carta base — por eso
 *    la energía especial queda EXACTA (holofoil + reverse_holo = 2 casillas, NO 3): el `normal`
 *    fantasma ya no puede aparecer porque el producto de set nunca trajo `Normal` en sus `subTypeName`.
 *  - NO se resta `normal` por rareza: si el set_base no trae `Normal`, `normal` simplemente no está.
 *    El filtro heurístico `isPremiumRarity` desaparece de la composición (sigue vivo SOLO en el
 *    pricing buylist).
 *  - Fallback `['normal']` fail-closed (§4.27c): mejor «falta una casilla» que «sobra una falsa» —
 *    una carta legacy sin productos resueltos da `422 FINISH_NOT_AVAILABLE` hasta el re-sync forzado.
 *
 * Determinista y RECOMPUTABLE (no monótona: recomputar con menos productos ELIMINA casillas fantasma
 * ya materializadas). El ÚNICO escritor de `Card.availableFinishes` (`catalog.FinishReconciler`) la usa.
 */
export function deriveAvailableFinishesFromProducts(
  products: Iterable<{ kind: CardProductKind; finishes: Finish[] }>,
): Finish[] {
  const union = new Set<Finish>();
  for (const p of products) {
    // set_base y other componen la carta de set; deck_exclusive/promo son productos aparte (§4.27c/e).
    if (p.kind === 'set_base' || p.kind === 'other') {
      for (const f of p.finishes) union.add(f);
    }
  }
  const ordered = orderFinishes(union);
  return ordered.length > 0 ? ordered : ['normal'];
}

/**
 * v1.29 (§4.27c) — `displayFinishes` queda DEPRECADO: como ya no hay casilla espuria que ocultar tras
 * §4.27, `displayFinishes := availableFinishes` SIEMPRE (sin supresión N-15). Se conserva como shim
 * PURO para los callers de contrato (DTO) hasta el retiro del campo en la siguiente rev de front.
 * Ignora `rarity`/`pricedFinishes` a propósito (la supresión heurística fue el síntoma, no la cura).
 */
export function computeDisplayFinishes(
  _rarity: string | null,
  availableFinishes: Finish[] | null | undefined,
  _pricedFinishes: Iterable<Finish>,
): Finish[] {
  const ordered = orderFinishes(availableFinishes ?? []);
  return ordered.length > 0 ? ordered : ['normal'];
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
 *
 * v1.40 (Enmienda B, P-41-mejora) — DESEMPATE POR SET MÁS NUEVO: cuando varias cartas comparten el
 * mismo `name` (la misma carta reimpresa en varios sets, p. ej. 6 «Tropius»), el segundo criterio pasa
 * de `{ setId: 'asc' }` (uuid ALEATORIO ⇒ orden arbitrario, podía dejar la impresión nueva fuera del
 * top-N) a `{ set: { releaseDate: 'desc', nulls: 'last' } }` ⇒ la impresión del set MÁS RECIENTE sale
 * primero, y un set con `releaseDate = null` queda al FINAL del grupo de ese nombre. Prisma añade el
 * JOIN a `CardSet` SOLO para ordenar (sin `include`; transparente para los callers). `CARD_ORDER_BY_IN_SET`
 * NO cambia. Nota de rendimiento (TECH_DEBT): ordenar por columna de la relación no usa el índice
 * `@@index([setId, ...])`; índice de apoyo a evaluar si el plan lo pide (ARCHITECTURE §4.22b).
 */
export const CARD_ORDER_BY_GLOBAL: Prisma.CardOrderByWithRelationInput[] = [
  { name: 'asc' },
  { set: { releaseDate: { sort: 'desc', nulls: 'last' } } },
  { numberPrefix: 'asc' },
  { numberSort: 'asc' },
  { id: 'asc' },
];
