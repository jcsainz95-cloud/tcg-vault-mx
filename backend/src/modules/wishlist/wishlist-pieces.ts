/**
 * wishlist-pieces.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.1 «Dónde casa una pieza con un deseo»). **El predicado
 * ÚNICO `wishlistPieceWhere`**, en SQL porque cruza `InventoryItem.cardProductId` (el `tcgplayerProductId`, ⛔ no el UUID)
 * con `CardProduct.kind`:
 *
 *   `ownerType='platform'` ∧ `productType='raw'` (raw es siempre NM) ∧ `cardId`/`finish` del deseo ∧ `status='listed'` ∧
 *   (`cardProductId IS NULL` ∨ su `CardProduct.kind ∈ {set_base, other}`).
 *
 * Graded, sellado, promo y deck_exclusive **no** casan; un `cardProductId` sin fila de `CardProduct` tampoco (no se puede
 * afirmar que sea de set). «A la venta» además exige vendible por el seam del catálogo (`CatalogService.sellableByIds`):
 * aquí solo se filtra el estado; el precio lo decide el catálogo.
 * ⛔ Solo LEE `InventoryItem` (censo WSH-T15).
 */
import { Finish, Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * ⭐ v1.87.3⟨wishlist⟩ (M-1 de QA, API_CONTRACT §WSH.4 «Se quita sola»): el predicado se parte en dos y ésta es la ÚNICA copia
 * de «producto de set», sobre el alias `ii` (pieza) y `cp` (LEFT JOIN a `CardProduct`): `raw` ∧ (`cardProductId` nulo ∨ su
 * `CardProduct.kind ∈ {set_base, other}`). La leen el aviso (dentro de `PIECE_PREDICATE`) y la baja al pagar
 * (`WishlistService.consumeForSettledOrder`): lo que quita el deseo es exactamente lo que lo habría avisado. Promo,
 * exclusivo de deck, `cardProductId` huérfano, graded y sellado no son «esa carta» para la lista. Candado WSH-T43.
 */
export const SET_PRODUCT_PREDICATE = Prisma.sql`
  ii."productType"::text = 'raw'
  AND (ii."cardProductId" IS NULL OR cp."kind"::text IN ('set_base', 'other'))`;

/** «A la venta» (solo el estado; el precio lo decide el catálogo con `sellableByIds`). */
const FOR_SALE_PREDICATE = Prisma.sql`
  ii."ownerType"::text = 'platform'
  AND ii."status"::text = 'listed'`;

/** El predicado completo del aviso = producto de set ∧ a la venta. */
const PIECE_PREDICATE = Prisma.sql`${SET_PRODUCT_PREDICATE} AND ${FOR_SALE_PREDICATE}`;

/** Piezas `listed` que casan con UN (carta, acabado). */
export async function listedPiecesFor(db: Db, cardId: string, finish: Finish): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT ii."id"
    FROM "InventoryItem" ii
    LEFT JOIN "CardProduct" cp ON cp."tcgplayerProductId" = ii."cardProductId"
    WHERE ii."cardId" = ${cardId} AND ii."finish"::text = ${finish} AND ${PIECE_PREDICATE}`);
  return rows.map((r) => r.id);
}

/** Piezas `listed` que casan, para VARIAS (carta, acabado) a la vez. */
export async function listedPiecesForKeys(
  db: Db,
  keys: { cardId: string; finish: Finish }[],
): Promise<{ id: string; cardId: string; finish: Finish }[]> {
  if (keys.length === 0) return [];
  const cardIds = [...new Set(keys.map((k) => k.cardId))];
  const rows = await db.$queryRaw<{ id: string; cardId: string; finish: Finish }[]>(Prisma.sql`
    SELECT ii."id", ii."cardId", ii."finish"::text AS "finish"
    FROM "InventoryItem" ii
    LEFT JOIN "CardProduct" cp ON cp."tcgplayerProductId" = ii."cardProductId"
    WHERE ii."cardId" IN (${Prisma.join(cardIds)}) AND ${PIECE_PREDICATE}`);
  const wanted = new Set(keys.map((k) => `${k.cardId}|${k.finish}`));
  return rows.filter((r) => wanted.has(`${r.cardId}|${r.finish}`));
}

/**
 * Detección (§WSH.5 paso 2): pares (deseo, pieza `listed` que casa) SIN fila de aviso para esa cuenta. A TODAS las cuentas,
 * quepa o no («ya avisamos a todos»). La vendibilidad la filtra después el llamador con `sellableByIds`.
 */
export async function undetectedMatches(
  db: Db,
): Promise<{ wishlistItemId: string; userId: string; inventoryItemId: string }[]> {
  return db.$queryRaw(Prisma.sql`
    SELECT wi."id" AS "wishlistItemId", wi."userId", ii."id" AS "inventoryItemId"
    FROM "WishlistItem" wi
    JOIN "InventoryItem" ii ON ii."cardId" = wi."cardId" AND ii."finish" = wi."finish"
    LEFT JOIN "CardProduct" cp ON cp."tcgplayerProductId" = ii."cardProductId"
    WHERE ${PIECE_PREDICATE}
      AND NOT EXISTS (
        SELECT 1 FROM "WishlistNotice" wn WHERE wn."userId" = wi."userId" AND wn."inventoryItemId" = ii."id"
      )`);
}
