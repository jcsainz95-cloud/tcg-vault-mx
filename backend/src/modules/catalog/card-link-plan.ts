import { CardProductKind } from '@prisma/client';
import { linkNameKey, parseTcgcsvCardName } from './tcgcsv-card-name';

/**
 * §PRECIO-SIN-ENLACE (fase 1) — PLAN PURO de enlace carta local ↔ producto TCGCSV del grupo.
 *
 * Reglas, por orden (la primera que aplica gana; si ninguna ⇒ NO se enlaza y se reporta; nunca se adivina):
 *   a. `Card.tcgplayerId == productId` (id externo).
 *   b. número + nombre normalizado (sin `NAME_PARENS`/«(30th Celebration)»), ÚNICO en AMBOS lados.
 *   c. solo número, ÚNICO en AMBOS lados (1 carta ↔ 1 producto) Y con nombre COMPATIBLE (G3-4): igual tras normalizar, o uno
 *      contenido en el otro por palabras completas; si no, `name_mismatch` y no se enlaza (hay números repetidos en la fuente:
 *      la unicidad sola no basta).
 * Un producto que YA tiene dueño NUNCA se mueve (si una carta SIN enlace lo habría tomado ⇒ `owner_conflict`, reportado como
 * `product_owned_by_other`). Solo en el modo `onlyUnlinked` (la reparación) una carta que ya tiene `CardProduct` nunca recibe
 * un producto base por número/nombre; en el sync manual normal el comportamiento de siempre se conserva. Los productos no base (variant/promo/deck_exclusive/stamped) conservan el
 * enrutado por número ÚNICO local de siempre (precio propio, no son «la» carta). Los de `variant`/promo no
 * cuentan para la unicidad de los base.
 */
export interface LinkProduct {
  productId: number;
  name: string;
  number: string | null;
  kind: CardProductKind;
}
export interface LinkCard {
  id: string;
  number: string;
  name: string;
  tcgplayerId: string | null;
  /** `CardProduct` que la carta tenía ANTES de esta corrida. */
  productCount: number;
}
export type LinkRule = 'existing' | 'tcgplayer_id' | 'number_name' | 'number' | 'number_unique_local';
export type UnlinkedReason =
  | 'collision'
  | 'owner_conflict'
  | 'card_already_linked'
  | 'no_local_card'
  | 'skipped_linked'
  | 'name_mismatch';

export interface LinkPlan {
  /** productId → carta dueña y regla que la decidió. */
  links: Map<number, { cardId: string; rule: LinkRule }>;
  /** Productos NO enlazados, con motivo (`collision` = número/nombre repetido en algún lado). */
  unlinked: { productId: number; reason: UnlinkedReason }[];
  collisions: number;
  /** No enlazados que no son colisión ni conflicto (sin carta local, carta ya enlazada, nombre incompatible). */
  omitted: number;
  /** Productos con OTRO dueño que una carta sin enlace habría tomado (`product_owned_by_other`). */
  conflicts: number;
}

/** Nombres (ya normalizados con `linkNameKey`) compatibles: iguales o uno contenido en el otro por palabras completas. */
export function namesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);
  if (wa.length === 0 || wb.length === 0) return false;
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const bigSet = new Set(big);
  return small.every((w) => bigSet.has(w));
}

const isBaseLike = (k: CardProductKind): boolean => k === 'set_base' || k === 'other';

export function planCardLinks(
  products: readonly LinkProduct[],
  cards: readonly LinkCard[],
  ownerOf: ReadonlyMap<number, string>,
  normalizeNumber: (raw: string) => string,
  opts: { onlyUnlinked?: boolean } = {},
): LinkPlan {
  const links = new Map<number, { cardId: string; rule: LinkRule }>();
  const unlinked: LinkPlan['unlinked'] = [];
  let collisions = 0;
  let omitted = 0;
  let conflicts = 0;
  const miss = (productId: number, reason: UnlinkedReason): void => {
    unlinked.push({ productId, reason });
    if (reason === 'collision') collisions += 1;
    else if (reason === 'owner_conflict') conflicts += 1;
    else if (reason !== 'skipped_linked') omitted += 1;
  };

  const nameOfProduct = (p: LinkProduct): string => {
    const parsed = parseTcgcsvCardName(p.name, p.number ?? '');
    return linkNameKey(parsed.ok ? parsed.name : p.name);
  };

  const byTcg = new Map<string, LinkCard>();
  const cardsByNum = new Map<string, LinkCard[]>();
  const cardsByKey = new Map<string, LinkCard[]>();
  for (const c of cards) {
    if (c.tcgplayerId) byTcg.set(c.tcgplayerId, c);
    const n = normalizeNumber(c.number);
    cardsByNum.set(n, [...(cardsByNum.get(n) ?? []), c]);
    const k = `${n}|${linkNameKey(c.name)}`;
    cardsByKey.set(k, [...(cardsByKey.get(k) ?? []), c]);
  }
  const prodsByNum = new Map<string, number>();
  const prodsByKey = new Map<string, number>();
  const keyOf = new Map<number, { n: string; k: string }>();
  for (const p of products) {
    if (!isBaseLike(p.kind) || p.number == null) continue;
    const n = normalizeNumber(p.number);
    const k = `${n}|${nameOfProduct(p)}`;
    keyOf.set(p.productId, { n, k });
    prodsByNum.set(n, (prodsByNum.get(n) ?? 0) + 1);
    prodsByKey.set(k, (prodsByKey.get(k) ?? 0) + 1);
  }

  const claimed = new Set<string>();
  // Modo reparación: SOLO cartas sin `CardProduct`; el resto no se toca (0 escrituras en cartas ya enlazadas).
  const eligible = (c: LinkCard): boolean => !claimed.has(c.id) && (opts.onlyUnlinked ? c.productCount === 0 : true);

  /** La carta SIN enlace que un producto (sin dueño) habría tomado por las reglas a/b/c, sin reclamarla. */
  const wouldTake = (p: LinkProduct): LinkCard | null => {
    const t = byTcg.get(String(p.productId));
    if (t) return t.productCount === 0 ? t : null;
    if (!isBaseLike(p.kind)) {
      const cands = p.number != null ? (cardsByNum.get(normalizeNumber(p.number)) ?? []) : [];
      return cands.length === 1 && cands[0].productCount === 0 ? cands[0] : null;
    }
    const kk = keyOf.get(p.productId);
    if (!kk) return null;
    const sameKey = cardsByKey.get(kk.k) ?? [];
    if (sameKey.length === 1 && prodsByKey.get(kk.k) === 1) return sameKey[0].productCount === 0 ? sameKey[0] : null;
    const sameNum = cardsByNum.get(kk.n) ?? [];
    if (sameNum.length === 1 && prodsByNum.get(kk.n) === 1 && namesCompatible(linkNameKey(sameNum[0].name), nameOfProduct(p))) {
      return sameNum[0].productCount === 0 ? sameNum[0] : null;
    }
    return null;
  };

  for (const p of products) {
    const owner = ownerOf.get(p.productId);
    const byTcgCard = byTcg.get(String(p.productId));
    if (owner != null) {
      const taker = opts.onlyUnlinked ? wouldTake(p) : null;
      if (byTcgCard && byTcgCard.id !== owner) miss(p.productId, 'owner_conflict');
      else if (taker && taker.id !== owner) miss(p.productId, 'owner_conflict'); // I-4: nunca en silencio
      else if (opts.onlyUnlinked) miss(p.productId, 'skipped_linked');
      else links.set(p.productId, { cardId: owner, rule: 'existing' });
      continue;
    }
    if (byTcgCard) {
      if (eligible(byTcgCard)) {
        claimed.add(byTcgCard.id);
        links.set(p.productId, { cardId: byTcgCard.id, rule: 'tcgplayer_id' });
      } else miss(p.productId, 'card_already_linked');
      continue;
    }
    if (!isBaseLike(p.kind)) {
      // Enrutado de siempre para variantes/promos/deck exclusives: número ÚNICO entre las cartas locales.
      const cands = p.number != null ? (cardsByNum.get(normalizeNumber(p.number)) ?? []) : [];
      if (cands.length === 1 && (!opts.onlyUnlinked || cands[0].productCount === 0)) {
        links.set(p.productId, { cardId: cands[0].id, rule: 'number_unique_local' });
      } else miss(p.productId, cands.length > 1 ? 'collision' : 'no_local_card');
      continue;
    }
    const kk = keyOf.get(p.productId);
    if (!kk) {
      miss(p.productId, 'no_local_card');
      continue;
    }
    const sameKey = cardsByKey.get(kk.k) ?? [];
    if (sameKey.length === 1 && prodsByKey.get(kk.k) === 1) {
      const c = sameKey[0];
      if (eligible(c)) {
        claimed.add(c.id);
        links.set(p.productId, { cardId: c.id, rule: 'number_name' });
      } else miss(p.productId, 'card_already_linked');
      continue;
    }
    const sameNum = cardsByNum.get(kk.n) ?? [];
    if (sameNum.length === 1 && prodsByNum.get(kk.n) === 1) {
      const c = sameNum[0];
      if (!namesCompatible(linkNameKey(c.name), nameOfProduct(p))) {
        miss(p.productId, 'name_mismatch');
        continue;
      }
      if (eligible(c)) {
        claimed.add(c.id);
        links.set(p.productId, { cardId: c.id, rule: 'number' });
      } else miss(p.productId, 'card_already_linked');
      continue;
    }
    // Sin carta local con ese número ⇒ omitido; con número/nombre repetido en algún lado ⇒ colisión.
    miss(p.productId, sameNum.length === 0 ? 'no_local_card' : 'collision');
  }
  return { links, unlinked, collisions, omitted, conflicts };
}
