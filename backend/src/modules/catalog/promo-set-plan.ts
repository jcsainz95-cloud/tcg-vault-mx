/**
 * promo-set-plan.ts — P-PROMOS-VIEJAS (ARCHITECTURE §5.13): PLAN PURO (sin BD ni red) de cómo cuelgan los productos de un
 * grupo TCGCSV de promos de las cartas de pokemontcg.io del mismo set. Lo ejecuta `PromoSetProductsService`.
 *
 * Reglas (por número = `promoNumberKey`, BW004 = BW04, XY67a ≠ XY67):
 *  - sin sello ⇒ `set_base` de la carta de ese número; con sello ⇒ `stamped` (tipo + etiqueta) colgado de ella;
 *  - «solo con sello» (ninguna plana): el ÚNICO producto con sello que no es Staff pasa a `set_base` (se vende a su precio
 *    de mercado, con el nombre de pokemontcg.io); los [Staff] cuelgan `stamped`. 2+ candidatos ⇒ todos `stamped`,
 *    `ambiguous_base` y la carta queda pendiente. 2+ planas ⇒ ninguna es base (`ambiguous_base`);
 *  - sin carta local ⇒ `no_card` (aquí NUNCA se crea carta); número repetido en el set local ⇒ `ambiguous_number`;
 *    sello no listado ⇒ `unknown_stamp` (se omite, jamás se mezcla con la plana).
 */
import { StampType } from '@prisma/client';
import { TcgcsvCardProductRef } from '../pricing/pricing.types';
import { parseTcgcsvCardName } from './tcgcsv-card-name';
import { promoNumberKey } from './promo-set-groups';

export type PromoSkipReason = 'no_card' | 'unknown_stamp' | 'ambiguous_base' | 'ambiguous_number';
export interface PromoSkipped {
  number: string;
  reason: PromoSkipReason;
}
export interface PromoPlanItem {
  product: TcgcsvCardProductRef;
  cardId: string;
  kind: 'set_base' | 'stamped';
  stamp: { type: StampType; label: string } | null;
}
export interface PromoPlan {
  items: PromoPlanItem[];
  skipped: PromoSkipped[];
}

export function planPromoSet(
  localCards: readonly { id: string; number: string }[],
  products: readonly TcgcsvCardProductRef[],
  numberPrefix: string,
): PromoPlan {
  const cardsByKey = new Map<string, string[]>();
  for (const c of localCards) {
    const key = promoNumberKey(c.number, numberPrefix);
    if (key == null) continue;
    const l = cardsByKey.get(key);
    if (l) l.push(c.id);
    else cardsByKey.set(key, [c.id]);
  }

  const skipped: PromoSkipped[] = [];
  const seenSkip = new Set<string>();
  const skip = (number: string, reason: PromoSkipReason) => {
    const k = `${number}|${reason}`;
    if (seenSkip.has(k)) return;
    seenSkip.add(k);
    skipped.push({ number, reason });
  };

  type Cand = { product: TcgcsvCardProductRef; stamp: { type: StampType; label: string } | null };
  const byKey = new Map<string, Cand[]>();
  for (const p of products) {
    const ext = (p.number ?? '').trim();
    if (ext === '') continue; // sellado u otro: no es carta (lo atiende su módulo)
    const key = promoNumberKey(ext, numberPrefix);
    if (key == null) {
      skip(ext, 'no_card'); // número de OTRO set («134/142») o ilegible: no casa con ninguna promo
      continue;
    }
    const parsed = parseTcgcsvCardName(p.name, ext, { staffOverPrerelease: true });
    if (!parsed.ok) {
      if (parsed.reason === 'unknown_stamp') skip(ext, 'unknown_stamp');
      else if (parsed.reason !== 'no_number') skip(ext, 'ambiguous_number'); // el nombre y el número del producto no coinciden
      continue;
    }
    const local = cardsByKey.get(key);
    if (!local || local.length === 0) {
      skip(ext, 'no_card');
      continue;
    }
    if (local.length > 1) {
      skip(ext, 'ambiguous_number');
      continue;
    }
    const l = byKey.get(key);
    const cand = { product: p, stamp: parsed.stamp };
    if (l) l.push(cand);
    else byKey.set(key, [cand]);
  }

  const items: PromoPlanItem[] = [];
  for (const [key, cands] of byKey) {
    const cardId = (cardsByKey.get(key) as string[])[0];
    const plain = cands.filter((c) => c.stamp == null);
    const stamped = cands.filter((c) => c.stamp != null);
    const hang = (c: Cand) =>
      items.push({ product: c.product, cardId, kind: 'stamped', stamp: c.stamp });
    const num = (cands[0].product.number ?? key).trim();
    if (plain.length === 1) {
      items.push({ product: plain[0].product, cardId, kind: 'set_base', stamp: null });
      stamped.forEach(hang);
    } else if (plain.length > 1) {
      skip(num, 'ambiguous_base');
      stamped.forEach(hang);
    } else {
      const promotable = stamped.filter((c) => c.stamp?.type !== 'staff');
      if (promotable.length === 1) {
        items.push({ product: promotable[0].product, cardId, kind: 'set_base', stamp: null });
        stamped.filter((c) => c !== promotable[0]).forEach(hang);
      } else {
        if (promotable.length > 1) skip(num, 'ambiguous_base');
        stamped.forEach(hang);
      }
    }
  }
  return { items, skipped };
}
