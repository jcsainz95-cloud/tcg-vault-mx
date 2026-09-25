import { MetaCardGroup, MetaMatchStatus } from '@prisma/client';

/**
 * Arte de la teja de Meta Battle Decks (`GET /decks-meta`, `imageUrl`). El contrato no fija la regla;
 * es decisión de implementación (docs/BACKEND_NOTES.md §«Arte del deck»). Pedido del dueño: «la EX
 * representativa del deck», «no cualquier carta».
 *
 * Regla, en orden (sólo líneas CASADAS, del grupo Pokémon, con imagen de catálogo):
 *  1. `imageCardId` configurado por el admin, si sigue en la lista.
 *  2. La Pokémon **ex** cuyo nombre aparece en el nombre del deck; si hay varias, la que aparece
 *     ANTES en el nombre («Gardevoir ex / Jellicent ex» ⇒ Gardevoir ex).
 *  2b. Si ninguna ex casa por nombre: la Pokémon NO-ex cuyo nombre aparece en el del deck
 *     (deck «Alakazam» ⇒ Alakazam, no una ex de apoyo como Fezandipiti ex).
 *  3. La ex con más copias en la lista (sumando impresiones).
 *  4. La Pokémon con más copias.
 *  5. null — nunca arte externo.
 *
 * Coincidencia por nombre: palabras completas tras normalizar (minúsculas, sin acentos, apóstrofo
 * tipográfico ⇒ recto, «ex»/«EX» suelto fuera). Primero se busca el nombre completo sin «ex»
 * («mega excadrill», «n's zoroark»); si no, la especie (última palabra: «Teal Mask Ogerpon ex» casa con
 * el deck «Ogerpon»). Los nombres de Limitless vienen SIN «ex» («Dragapult», «Mega Excadrill»).
 *
 * Desempates (deterministas, no dependen del orden de las líneas): coincidencia completa antes que por
 * especie; posición más temprana en el nombre del deck («Mega Excadrill» ⇒ «Mega Excadrill ex» casa en la
 * posición 0 y «Excadrill ex» en la 5); más copias; nombre normalizado ascendente. Entre impresiones de la MISMA carta: más
 * copias en su línea y luego `externalId` ascendente.
 */
export interface DeckImageCard {
  id: string;
  externalId: string;
  name: string;
  subtypes?: unknown;
  imageSmallUrl: string | null;
  imageLargeUrl: string | null;
}

export interface DeckImageLine {
  quantity: number;
  matchStatus: MetaMatchStatus;
  group: MetaCardGroup;
  matchedCard: DeckImageCard | null;
}

interface Candidate {
  key: string; // nombre normalizado completo (con «ex» si lo lleva) — agrupa impresiones
  base: string; // nombre normalizado sin «ex»
  species: string; // última palabra de `base`
  isEx: boolean;
  totalQty: number;
  best: { quantity: number; card: DeckImageCard };
}

const imageOf = (c: DeckImageCard): string | null => c.imageLargeUrl ?? c.imageSmallUrl ?? null;

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isExCard(card: DeckImageCard, normalized: string): boolean {
  if (/(^| )ex$/.test(normalized)) return true;
  return Array.isArray(card.subtypes) && card.subtypes.some((t) => typeof t === 'string' && t.toLowerCase() === 'ex');
}

function stripEx(normalized: string): string {
  return normalized.replace(/(^| )ex(?= |$)/g, ' ').trim().replace(/\s+/g, ' ');
}

function byQtyThenKey(a: Candidate, b: Candidate): number {
  return b.totalQty - a.totalQty || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Coincidencia por nombre: [tier, posición] (menor es mejor) o null si no aparece. */
function nameMatch(deckPadded: string, c: Candidate): [number, number] | null {
  if (c.base) {
    const p = deckPadded.indexOf(` ${c.base} `);
    if (p >= 0) return [0, p];
  }
  if (c.species && c.species !== c.base) {
    const p = deckPadded.indexOf(` ${c.species} `);
    if (p >= 0) return [1, p];
  }
  return null;
}

function pickByName(deckPadded: string, pool: Candidate[]): Candidate | null {
  let best: { c: Candidate; m: [number, number] } | null = null;
  for (const c of pool) {
    const m = nameMatch(deckPadded, c);
    if (m && (!best || isBetter(m, c, best.m, best.c))) best = { c, m };
  }
  return best?.c ?? null;
}

function isBetter(m: [number, number], c: Candidate, bm: [number, number], b: Candidate): boolean {
  if (m[0] !== bm[0]) return m[0] < bm[0];
  if (m[1] !== bm[1]) return m[1] < bm[1];
  return byQtyThenKey(c, b) < 0;
}

export function pickDeckImage(deckName: string, imageCardId: string | null, cards: DeckImageLine[]): string | null {
  const eligible = cards.filter(
    (l): l is DeckImageLine & { matchedCard: DeckImageCard } =>
      l.matchStatus === MetaMatchStatus.matched &&
      l.group === MetaCardGroup.pokemon &&
      l.matchedCard != null &&
      imageOf(l.matchedCard) != null,
  );

  if (imageCardId) {
    const configured = cards.find((l) => l.matchedCard?.id === imageCardId)?.matchedCard;
    if (configured && imageOf(configured)) return imageOf(configured);
  }

  const byKey = new Map<string, Candidate>();
  for (const l of eligible) {
    const key = normalizeName(l.matchedCard.name);
    const isEx = isExCard(l.matchedCard, key);
    const base = stripEx(key);
    const words = base.split(' ');
    let c = byKey.get(key);
    if (!c) {
      c = { key, base, species: words[words.length - 1] ?? '', isEx, totalQty: 0, best: { quantity: l.quantity, card: l.matchedCard } };
      byKey.set(key, c);
    } else {
      c.isEx = c.isEx || isEx;
      const b = c.best;
      if (
        l.quantity > b.quantity ||
        (l.quantity === b.quantity && l.matchedCard.externalId < b.card.externalId)
      ) {
        c.best = { quantity: l.quantity, card: l.matchedCard };
      }
    }
    c.totalQty += l.quantity;
  }
  const all = [...byKey.values()];
  if (all.length === 0) return null;
  const exs = all.filter((c) => c.isEx);
  const nonEx = all.filter((c) => !c.isEx);
  const deckPadded = ` ${stripEx(normalizeName(deckName))} `;

  const chosen =
    pickByName(deckPadded, exs) ??
    pickByName(deckPadded, nonEx) ??
    [...exs].sort(byQtyThenKey)[0] ??
    [...all].sort(byQtyThenKey)[0];
  return imageOf(chosen.best.card);
}
