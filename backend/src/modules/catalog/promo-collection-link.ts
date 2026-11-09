import { createHash } from 'crypto';
import { normalizeMatchText } from '../../common/card-version';

/**
 * AUTO-B (docs/specs/AUTO_CATALOGO.md §B) - liga INFERIDA promo -> expansion. Funciones PURAS y deterministas.
 *  Senal 1 (misma carta): clave exacta de contenido = nombre + HP + conjunto de ataques/habilidades (entrenador/energia: nombre + hash del texto).
 *  Senal 2 (ventana): [min productId de la expansion X, min de la siguiente) - hipotesis NO MEDIDA; sola NUNCA da `high`.
 * `high` = senal 1 con UN candidato, o varios y exactamente uno dentro de la ventana. `low` = solo ventana, o varios sin desempate.
 */
export interface ContentKeyInput {
  name: string;
  supertype?: string | null;
  hp?: string | number | null;
  attacks?: { name?: string | null }[] | null;
  abilities?: { name?: string | null }[] | null;
  rules?: string[] | null;
}

/** Clave de contenido, o `null` si no hay base suficiente (un Pokemon sin ataques ni habilidades no se liga: demasiado ambiguo). */
export function contentKeyOf(c: ContentKeyInput): string | null {
  const name = normalizeMatchText(c.name ?? '');
  if (name === '') return null;
  const st = (c.supertype ?? '').toLowerCase();
  if (st === 'trainer' || st === 'energy') {
    const text = (c.rules ?? []).map((r) => normalizeMatchText(r)).join(' ');
    if (text === '') return null;
    return `${st}|${name}|${createHash('sha1').update(text).digest('hex').slice(0, 16)}`;
  }
  const hp = String(c.hp ?? '').trim();
  const moves = [...(c.attacks ?? []), ...(c.abilities ?? [])]
    .map((a) => normalizeMatchText(a?.name ?? ''))
    .filter((n) => n !== '')
    .sort();
  if (hp === '' || moves.length === 0) return null;
  return `pokemon|${name}|${hp}|${[...new Set(moves)].join('~')}`;
}

export interface PromoForLink {
  cardId: string;
  contentKey: string | null;
  /** min `CardProduct.tcgplayerProductId` de la promo (null si no hay). */
  productId: number | null;
}
export interface ExpansionCardForLink {
  setId: string;
  contentKey: string | null;
}
export interface LinkResult {
  promoCardId: string;
  expansionSetId: string;
  confidence: 'high' | 'low';
  evidence: { signal: 'content' | 'window'; candidates?: number; windowOk?: boolean };
}

/** Ventanas [min, siguiente min) por expansion, a partir del minimo productId de cada una. */
export function buildWindows(minBySet: ReadonlyMap<string, number>): Map<string, { from: number; to: number | null }> {
  const sorted = [...minBySet.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const out = new Map<string, { from: number; to: number | null }>();
  sorted.forEach(([setId, from], i) => out.set(setId, { from, to: sorted[i + 1]?.[1] ?? null }));
  return out;
}

const inWindow = (pid: number, w: { from: number; to: number | null } | undefined): boolean =>
  w != null && pid >= w.from && (w.to == null || pid < w.to);

export function inferPromoLinks(input: {
  promos: readonly PromoForLink[];
  expansionCards: readonly ExpansionCardForLink[];
  minProductIdBySet: ReadonlyMap<string, number>;
}): LinkResult[] {
  const windows = buildWindows(input.minProductIdBySet);
  const setsByKey = new Map<string, Set<string>>();
  for (const c of input.expansionCards) {
    if (!c.contentKey) continue;
    const s = setsByKey.get(c.contentKey) ?? new Set<string>();
    s.add(c.setId);
    setsByKey.set(c.contentKey, s);
  }
  const out: LinkResult[] = [];
  for (const p of [...input.promos].sort((a, b) => a.cardId.localeCompare(b.cardId))) {
    const cands = p.contentKey ? [...(setsByKey.get(p.contentKey) ?? [])].sort() : [];
    const winSets = p.productId != null ? [...windows.keys()].filter((id) => inWindow(p.productId!, windows.get(id))).sort() : [];
    if (cands.length === 1) {
      out.push({ promoCardId: p.cardId, expansionSetId: cands[0], confidence: 'high', evidence: { signal: 'content', candidates: 1, windowOk: winSets.includes(cands[0]) } });
    } else if (cands.length > 1) {
      const inside = cands.filter((id) => winSets.includes(id));
      if (inside.length === 1) {
        out.push({ promoCardId: p.cardId, expansionSetId: inside[0], confidence: 'high', evidence: { signal: 'content', candidates: cands.length, windowOk: true } });
      } else {
        // sin desempate: la candidata mas reciente por ventana NO se adivina; se deja en `low` con la primera en orden estable.
        out.push({ promoCardId: p.cardId, expansionSetId: cands[0], confidence: 'low', evidence: { signal: 'content', candidates: cands.length, windowOk: false } });
      }
    } else if (winSets.length === 1) {
      out.push({ promoCardId: p.cardId, expansionSetId: winSets[0], confidence: 'low', evidence: { signal: 'window', windowOk: true } });
    }
    // sin senal => sin fila
  }
  return out;
}
