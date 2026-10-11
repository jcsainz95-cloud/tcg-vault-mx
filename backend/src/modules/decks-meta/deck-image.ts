import { MetaCardGroup, MetaMatchStatus } from '@prisma/client';

/**
 * Arte de la teja de Meta Battle Decks (`GET /decks-meta`, `imageUrl`). Regla NORMATIVA desde la rev
 * `decks-portada` (API_CONTRACT §13 «Portada del deck (`imageUrl`) — regla normativa», ARCHITECTURE
 * §12.4.4). Decisión del dueño (2026-09-28): la imagen es la PORTADA que usa Limitless; si no se puede,
 * la regla por nombre con «manda el primero nombrado» (sea ex o no); la elección del admin sigue ganando.
 *
 * Primera regla que dé una carta CON imagen de catálogo:
 *  1. Admin — `imageCardId`, si alguna línea de la lista trae esa carta con imagen. SIN filtro de grupo
 *     ni de estado (puede ser entrenador): la elección explícita del operador manda sobre la heurística.
 *  2. Portada de Limitless — `coverCard` (la `MetaDeckList.coverCard` casada por el job). SIN filtro de
 *     grupo y ⛔ SIN exigir que esté entre las 60 (la portada puede ser otra impresión).
 *  3. Por nombre, en UN solo conjunto (ex y no-ex juntas): la Pokémon casada con imagen que aparece
 *     ANTES en el nombre del deck («Alakazam Mew» ⇒ Alakazam aunque Mew sea ex).
 *  4. La ex con más copias (sumando impresiones).
 *  5. La Pokémon con más copias.
 *  → null — nunca arte externo.
 * (Las reglas 3–5 miran sólo líneas CASADAS, del grupo Pokémon, con imagen de catálogo.)
 *
 * Coincidencia por nombre: palabras completas tras normalizar (minúsculas, sin acentos, apóstrofo
 * tipográfico ⇒ recto, «ex»/«EX» suelto fuera). Primero el nombre completo sin «ex» («mega excadrill»,
 * «n's zoroark»); si no, la especie (última palabra: «Teal Mask Ogerpon ex» casa con el deck «Ogerpon»).
 * Los nombres de Limitless vienen SIN «ex» («Dragapult», «Mega Excadrill»).
 *
 * Desempate de la regla 3 (determinista, no depende del orden de las líneas): (i) posición más
 * temprana en el nombre del deck; (ii) coincidencia completa antes que por especie; (iii) ex antes que
 * no-ex; (iv) más copias; (v) nombre normalizado ascendente. (ii) va antes que (iii): deck «Excadrill»
 * con `Excadrill` y `Mega Excadrill ex` ⇒ `Excadrill`; «Pikachu» con `Pikachu` y `Pikachu ex` ⇒ la ex.
 * Entre impresiones de la MISMA carta: más copias en su línea, luego `externalId` ascendente.
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

/** Imagen de catálogo de una carta: grande, si no pequeña, si no null. Nunca arte externo. */
export const imageOf = (c: Pick<DeckImageCard, 'imageLargeUrl' | 'imageSmallUrl'>): string | null =>
  c.imageLargeUrl ?? c.imageSmallUrl ?? null;

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019\u2018`\u00b4]/g, "'")
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

/** Coincidencia por nombre: [tier (0 completa, 1 especie), posición] o null si no aparece. */
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

/** Regla 3: UN solo conjunto (ex y no-ex juntas); gana la mejor según (i)…(v). */
function pickByName(deckPadded: string, pool: Candidate[]): Candidate | null {
  let best: { c: Candidate; m: [number, number] } | null = null;
  for (const c of pool) {
    const m = nameMatch(deckPadded, c);
    if (m && (!best || isBetter(m, c, best.m, best.c))) best = { c, m };
  }
  return best?.c ?? null;
}

function isBetter(m: [number, number], c: Candidate, bm: [number, number], b: Candidate): boolean {
  if (m[1] !== bm[1]) return m[1] < bm[1]; // (i) posición en el nombre
  if (m[0] !== bm[0]) return m[0] < bm[0]; // (ii) completa < especie
  if (c.isEx !== b.isEx) return c.isEx; // (iii) ex < no-ex
  return byQtyThenKey(c, b) < 0; // (iv) copias desc, (v) clave asc
}

export interface PickDeckImageInput {
  deckName: string;
  /** `MetaDeck.imageCardId` (elección del admin). */
  imageCardId: string | null;
  /** `MetaDeckList.coverCard` de la lista actual (sólo existe si la portada casó). */
  coverCard: DeckImageCard | null;
  cards: DeckImageLine[];
}

/** Firma-objeto (no posicional): ya se coló una mutación posicional que sobrevivía (§12.4.4). */
export function pickDeckImage({ deckName, imageCardId, coverCard, cards }: PickDeckImageInput): string | null {
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

  // Regla 2: portada de Limitless casada, con imagen. No se busca entre las 60 ni se filtra por grupo.
  if (coverCard && imageOf(coverCard)) return imageOf(coverCard);

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
  const deckPadded = ` ${stripEx(normalizeName(deckName))} `;

  const chosen =
    pickByName(deckPadded, all) ?? // 3
    [...exs].sort(byQtyThenKey)[0] ?? // 4
    [...all].sort(byQtyThenKey)[0]; // 5
  return imageOf(chosen.best.card);
}
