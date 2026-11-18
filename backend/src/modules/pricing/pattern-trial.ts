import { Finish, ProductType } from '@prisma/client';

/** Referencia vigente de un combo (carta × tipo × grado × acabado) medida con la lectura EN VIVO; `cents` = `null` si no hay precio. */
export type RefSnap = { cardId: string; productType: ProductType; gradeKey: string; finish: Finish; cents: number | null };

/**
 * §PRICE-PATTERN 6.6 — «solo baja, nunca sin precio» MEDIDO con la lectura en vivo (función PURA): por carta, los motivos de violación entre `before` y
 * `after`. Referencia raw NM: desaparece/0/NULL o SUBE. Cualquier otro tipo/grado (la lectura aplica la «variante efectiva» a todos): CUALQUIER cambio, también
 * la baja. Un combo que no tenía precio antes (`cents == null`) no se juzga. El `ListingPrice` no entra: se recalcula DESPUÉS del commit desde esta lectura.
 */
export function assessTrial(before: Map<string, RefSnap>, after: Map<string, RefSnap>): Map<string, string[]> {
  const bad = new Map<string, string[]>();
  const add = (cardId: string, why: string) => bad.set(cardId, [...(bad.get(cardId) ?? []), why]);
  for (const [k, b] of before) {
    if (b.cents == null) continue;
    const a = after.get(k)?.cents ?? null;
    const rawNm = b.productType === 'raw' && b.gradeKey === 'raw:NM';
    if (a == null || a <= 0) add(b.cardId, `${b.productType}/${b.gradeKey}/${b.finish}: ${b.cents} → sin precio`);
    else if (rawNm ? a > b.cents : a !== b.cents) add(b.cardId, `${b.productType}/${b.gradeKey}/${b.finish}: ${b.cents} → ${a}`);
  }
  return bad;
}
