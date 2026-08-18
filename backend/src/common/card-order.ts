import { Finish, Prisma } from '@prisma/client';

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
