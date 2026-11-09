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
 * Compuerta del apartado «Promos de la colección» (spec AUTO_CATALOGO §B/§F): el apartado Black Star NO se publica hasta que haya
 * medicion con >=30 promos y >=2 expansiones, cada una al 100 % de precision en sus `high`. Los sellos (Prerelease/Staff...) no dependen de ella.
 */
export const BLACK_STAR_GATE_MIN_PROMOS = 30;
export const BLACK_STAR_GATE_MIN_EXPANSIONS = 2;
/** Medicion vigente: NO alcanzada (solo fixture parcial N=7, 1 expansion). Subirla a `true` exige que `evaluateBlackStarGate` lo confirme con fixtures reales (prueba la vigila). */
export const BLACK_STAR_GATE_PASSED = false;
export interface GateMeasurement { expansion: string; promos: number; high: number; highWrong: number }
export function evaluateBlackStarGate(ms: readonly GateMeasurement[]): boolean {
  const perfect = ms.filter((m) => m.high > 0 && m.highWrong === 0);
  const total = ms.reduce((a, m) => a + m.promos, 0);
  return ms.every((m) => m.highWrong === 0) && perfect.length >= BLACK_STAR_GATE_MIN_EXPANSIONS && total >= BLACK_STAR_GATE_MIN_PROMOS;
}
