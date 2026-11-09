import { createHash } from 'crypto';
import { normalizeMatchText } from '../../common/card-version';

/**
 * AUTO-B (docs/specs/AUTO_CATALOGO.md §B) - liga INFERIDA promo -> expansion. Funciones PURAS y deterministas.
 *  Senal 1 (misma carta): clave exacta de contenido = nombre + HP + conjunto de ataques/habilidades (entrenador/energia: nombre + hash del texto).
 *  Senal 2 (ventana): [min productId de la expansion X, min de la siguiente) - hipotesis NO MEDIDA; sola NUNCA da `high`.
 * `high` = contenido Y ventana coinciden en la MISMA expansion (unica con ventana coincidente). `low` = contenido solo, ventana sola o contradiccion (evidence registra ambas).
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
  evidence: { signal: 'content' | 'window'; candidates?: number; windowOk?: boolean; contentSets?: string[]; windowSets?: string[] };
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
    const evidence = (signal: 'content' | 'window') => ({ signal, candidates: cands.length, contentSets: cands, windowSets: winSets, windowOk: cands.some((id) => winSets.includes(id)) });
    if (cands.length > 0) {
      // `high` SOLO si contenido Y ventana coinciden en la MISMA expansion y es la unica con ventana coincidente.
      const inside = cands.filter((id) => winSets.includes(id));
      if (inside.length === 1) out.push({ promoCardId: p.cardId, expansionSetId: inside[0], confidence: 'high', evidence: evidence('content') });
      else out.push({ promoCardId: p.cardId, expansionSetId: cands[0], confidence: 'low', evidence: evidence('content') });
    } else if (winSets.length === 1) {
      out.push({ promoCardId: p.cardId, expansionSetId: winSets[0], confidence: 'low', evidence: evidence('window') });
    }
    // sin senal => sin fila
  }
  return out;
}

/**
 * Compuerta Black Star AUTOMATICA (spec AUTO_CATALOGO §B, decidido 2026-11-09): BACKTEST CIEGO sobre verdad que no depende de un
 * humano. Los SELLOS (CardProduct kind=stamped) ya colgados de una carta lisa conocen su expansion POR CONSTRUCCION. Se corre
 * `inferPromoLinks` sobre ellos IGNORANDO esa relacion (solo el contenido de su carta y la ventana de su `productId`) y se compara
 * con la expansion real. ABIERTA <=> k >= 30 `high` CORRECTOS en >= 2 expansiones y f = 0 falsos `high` (n solo se reporta); si no, CERRADA.
 * Constantes de umbral en codigo (no lista). Limite honesto: mide sobre todo la hipotesis de ventana; NO prueba que las Black Star se
 * listen con el mismo patron que los sellos.
 */
export const BLACK_STAR_GATE_MIN_PROMOS = 30;
export const BLACK_STAR_GATE_MIN_EXPANSIONS = 2;
export interface PromoGate {
  open: boolean;
  /** Sellos evaluables (con contenido y productId) que entraron al backtest. SOLO se reporta: no abre la compuerta. */
  n: number;
  /** De ellos, los que la inferencia dio `high` en SU expansion real. */
  k: number;
  /** Expansiones reales distintas entre los `high` CORRECTOS (las que el backtest realmente acerto). */
  expansions: number;
  /** Falsos `high` (high en otra expansion). Cualquiera > 0 cierra la compuerta. */
  falseHigh: number;
}
export interface GateStamp {
  /** Id estable del sello (p. ej. su tcgplayerProductId). */
  id: string;
  /** contentKey de SU carta lisa. */
  contentKey: string | null;
  /** tcgplayerProductId del sello. */
  productId: number | null;
  /** Expansion REAL (la del set de su carta lisa). */
  realSetId: string;
}
export function backtestBlackStarGate(input: {
  stamps: readonly GateStamp[];
  expansionCards: readonly ExpansionCardForLink[];
  minProductIdBySet: ReadonlyMap<string, number>;
}): PromoGate {
  const evaluable = input.stamps.filter((st) => st.contentKey != null && st.productId != null);
  const links = inferPromoLinks({
    promos: evaluable.map((st) => ({ cardId: st.id, contentKey: st.contentKey, productId: st.productId })),
    expansionCards: input.expansionCards,
    minProductIdBySet: input.minProductIdBySet,
  });
  const real = new Map(evaluable.map((st) => [st.id, st.realSetId]));
  let k = 0;
  let falseHigh = 0;
  const okSets = new Set<string>();
  for (const l of links) {
    if (l.confidence !== 'high') continue;
    if (real.get(l.promoCardId) === l.expansionSetId) {
      k += 1;
      okSets.add(l.expansionSetId);
    } else falseHigh += 1;
  }
  const n = evaluable.length;
  const expansions = okSets.size;
  return {
    open: k >= BLACK_STAR_GATE_MIN_PROMOS && expansions >= BLACK_STAR_GATE_MIN_EXPANSIONS && falseHigh === 0,
    n,
    k,
    expansions,
    falseHigh,
  };
}
