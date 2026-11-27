import type { Finish, Prisma, PrismaClient } from '@prisma/client';

/** Clave de variante `cardId|finish` para el conjunto de «referencia previa TCGCSV» (§12.3). */
export const priorRefKey = (cardId: string, finish: Finish | string): string => `${cardId}|${finish}`;

/**
 * §12.3 — variantes `(cardId|finish)` de esas cartas que YA tienen una `PriceReference` de fuente `tcgcsv_singles` (cualquier día, cualquier
 * producto). Es lo que cuenta como «referencia previa» para `shouldRetainTcgcsvPrice`; una referencia de otra fuente (tcgdex) NO cuenta.
 */
export async function priorTcgcsvRefKeys(db: PrismaClient | Prisma.TransactionClient, cardIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(cardIds)];
  for (let i = 0; i < ids.length; i += 5000) {
    // MONEY-REF-EXEMPT: solo decide SI existe una referencia TCGCSV previa de la variante (retención B3, §12); no devuelve ningún monto que se cobre, ofrezca o valúe.
    const rows = await db.priceReference.findMany({
      where: { source: 'tcgcsv_singles', cardId: { in: ids.slice(i, i + 5000) } },
      select: { cardId: true, finish: true },
      distinct: ['cardId', 'finish'],
    });
    for (const r of rows) out.add(priorRefKey(r.cardId, r.finish));
  }
  return out;
}
