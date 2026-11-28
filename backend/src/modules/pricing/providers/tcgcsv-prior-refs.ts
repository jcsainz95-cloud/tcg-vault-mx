import type { Finish, Prisma, PrismaClient } from '@prisma/client';

/** Clave de «referencia previa TCGCSV» (§13.1): `productId|subtipo` — el PRODUCTO TCGCSV y su subtipo de impresión (acabado persistido), no la carta. */
export const priorRefKey = (productId: number, finish: Finish | string): string => `${productId}|${finish}`;

/**
 * §13.1 — claves `productId|subtipo` de esos productos que YA tienen una `PriceReference` de fuente `tcgcsv_singles` (cualquier día). Es lo que
 * cuenta como «referencia previa» para `shouldRetainTcgcsvPrice` de la fila que se va a emitir: una referencia de OTRO producto (liga, promo, otro
 * grupo) de la misma carta/acabado NO libera nada; una de otra fuente (tcgdex) tampoco.
 */
export async function priorTcgcsvRefKeys(db: PrismaClient | Prisma.TransactionClient, productIds: readonly number[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 5000) {
    // MONEY-REF-EXEMPT: solo decide SI existe una referencia TCGCSV previa del producto+subtipo (retención B3, §13); no devuelve ningún monto que se cobre, ofrezca o valúe.
    const rows = await db.priceReference.findMany({
      where: { source: 'tcgcsv_singles', cardProduct: { is: { tcgplayerProductId: { in: ids.slice(i, i + 5000) } } } },
      select: { finish: true, cardProduct: { select: { tcgplayerProductId: true } } },
      distinct: ['cardProductId', 'finish'],
    });
    for (const r of rows) if (r.cardProduct) out.add(priorRefKey(r.cardProduct.tcgplayerProductId, r.finish));
  }
  return out;
}
