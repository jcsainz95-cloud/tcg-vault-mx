/**
 * §PROV-F4 — reglas PURAS de las solicitudes sugeridas (DECISIONES §PROV-F4). Sin Prisma: se prueban en unitario.
 * Dinero en centavos MXN enteros; el precio sale SIEMPRE de `effectiveUnitCents` (peso hacia abajo) y nunca supera el mercado (tope 100 %).
 */
import { effectiveUnitCents } from './supply.constants';
import { mxDayStart } from '../spend-alerts/mx-day';

/** Lock consultivo (bigint) de la corrida de `supply-suggest`: dos corridas simultáneas se serializan. Censo C-EQ-1. */
export const SUPPLY_SUGGEST_LOCK_KEY = 91_130_401;
/** `createdById` de las solicitudes publicadas por el job (sin FK; no es un usuario real). */
export const SUPPLY_SYSTEM_USER_ID = 'system:supply-suggest';
/** Bajo este mercado (10 MXN) el costo de recoger no lo paga: no se sugiere. */
export const SUGGEST_MIN_MARKET_CENTS = 1000;
/** Copias máximas por carta EN UN MAZO (saneo por deck; la suma entre decks ya no se topa en 4). */
export const MAX_COPIES = 4;
/** Salto de mercado vs la captura anterior que manda la carta a cuarentena (30 %). */
export const MARKET_JUMP_BPS = 3000;

/** `kind` solo `metadeck`: la fuente «rotación» no existe (DECISIONES §PROV-F4.1). Un elemento por deck que suma (§PROV-F4.2). */
export type SuggestReason = { kind: 'metadeck'; ref: string | null; rank: number | null; copies: number; mult: number };

export interface Need {
  cardId: string;
  need: number;
  reasons: SuggestReason[];
  /** Puesto del deck que más pesa en la carta (copies × mult; empate ⇒ mejor puesto). Sin puesto ⇒ Infinity. Orden del cupo abierto. */
  priorityRank: number;
}

/** Vista de una razón al leer: filas viejas (sin rank/copies/mult) salen con `null` explícito si no se pueden reconstruir. */
export type SuggestReasonView = { kind: 'metadeck'; ref: string | null; rank: number | null; copies: number | null; mult: number | null };


/** Normaliza `reasons` leídas de BD: solo cuenta `ref` (rank/copies/mult guardados se IGNORAN; el servicio los recalcula vigentes); basura ⇒ se descarta. */
export function normalizeReasons(raw: unknown): SuggestReasonView[] {
  if (!Array.isArray(raw)) return [];
  const out: SuggestReasonView[] = [];
  for (const r of raw as unknown[]) {
    if (r == null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    out.push({ kind: 'metadeck', ref: typeof o.ref === 'string' ? o.ref : null, rank: null, copies: null, mult: null });
  }
  return out;
}

/** Cota superior de los multiplicadores (F4-6): un valor mayor es un error de dedo, no una decisión. */
export const MAX_SUGGEST_MULT = 10;
export const MAX_TOP_RANK = 20;

/** Claves de `ConfigSetting` de los multiplicadores por puesto (§PROV-F4.2). */
export const SUGGEST_CFG_KEYS = ['supply.suggest.topRankMax', 'supply.suggest.topMult', 'supply.suggest.restMult'] as const;
export interface SuggestMult { topRankMax: number; topMult: number; restMult: number }
export const DEFAULT_SUGGEST_MULT: SuggestMult = { topRankMax: 5, topMult: 2, restMult: 1 };

/** Lee los 3 valores de ConfigSetting; ausente/inválido (no entero, mult fuera de 1..10 o topRankMax fuera de 0..20) ⇒ default del código. */
export function normalizeSuggestMult(rows: { key: string; valueJson: unknown }[]): SuggestMult {
  const get = (key: string): number | null => {
    const v = rows.find((r) => r.key === key)?.valueJson;
    return typeof v === 'number' && Number.isInteger(v) ? v : null;
  };
  const tr = get('supply.suggest.topRankMax');
  const tm = get('supply.suggest.topMult');
  const rm = get('supply.suggest.restMult');
  return {
    topRankMax: tr != null && tr >= 0 && tr <= MAX_TOP_RANK ? tr : DEFAULT_SUGGEST_MULT.topRankMax,
    topMult: tm != null && tm >= 1 && tm <= MAX_SUGGEST_MULT ? tm : DEFAULT_SUGGEST_MULT.topMult,
    restMult: rm != null && rm >= 1 && rm <= MAX_SUGGEST_MULT ? rm : DEFAULT_SUGGEST_MULT.restMult,
  };
}

/** Multiplicador del puesto: `rank ≤ topRankMax` ⇒ topMult; resto (o sin puesto) ⇒ restMult. */
export function multForRank(rank: number | null | undefined, m: SuggestMult): number {
  return rank != null && rank <= m.topRankMax ? m.topMult : m.restMult;
}

/** Energía BÁSICA (supertype Energy + subtipo Basic o nombre «Basic X Energy» / «Fire Energy»): se excluye siempre. */
export function isBasicEnergy(card: { supertype: string | null; name: string; subtypes: unknown }): boolean {
  if (card.supertype !== 'Energy') return false;
  const subs = Array.isArray(card.subtypes) ? (card.subtypes as unknown[]) : [];
  if (subs.includes('Basic')) return true;
  return /^Basic\b/i.test(card.name) || /^(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i.test(card.name);
}

/**
 * Necesidad por carta de los mazos: Σ sobre decks de min(copias en el deck, 4) × mult(rank). Cartas compartidas SUMAN (4×2 + 2×1 = 10).
 * Las líneas de una misma carta dentro de un deck se suman antes de acotar a 4 (saneo por deck).
 * Deck SIN puesto (`rank` null/undefined) ⇒ se EXCLUYE de la necesidad (el contrato exige `rank` entero y así nunca infla).
 */
export function needsFromDecks(
  lines: { cardId: string; quantity: number; deckSlug: string; rank?: number | null }[],
  mult: SuggestMult = DEFAULT_SUGGEST_MULT,
): Map<string, Need> {
  const perDeck = new Map<string, { cardId: string; deckSlug: string; rank: number | null; copies: number }>();
  for (const l of lines) {
    const q = Math.max(0, Math.floor(l.quantity));
    if (q <= 0 || l.rank == null || l.rank < 1) continue; // F4-8: puesto <1 (legado) = sin puesto
    const k = `${l.cardId}\u0000${l.deckSlug}`;
    const cur = perDeck.get(k);
    if (cur) cur.copies += q;
    else perDeck.set(k, { cardId: l.cardId, deckSlug: l.deckSlug, rank: l.rank ?? null, copies: q });
  }
  const out = new Map<string, Need>();
  const weight = new Map<string, number>();
  for (const d of perDeck.values()) {
    const copies = Math.min(MAX_COPIES, d.copies);
    const m = multForRank(d.rank, mult);
    const cur = out.get(d.cardId) ?? { cardId: d.cardId, need: 0, reasons: [], priorityRank: Number.POSITIVE_INFINITY };
    cur.need += copies * m;
    cur.reasons.push({ kind: 'metadeck', ref: d.deckSlug, rank: d.rank, copies, mult: m });
    const w = copies * m;
    const rk = d.rank ?? Number.POSITIVE_INFINITY;
    const bw = weight.get(d.cardId) ?? -1;
    if (w > bw || (w === bw && rk < cur.priorityRank)) { weight.set(d.cardId, w); cur.priorityRank = rk; }
    out.set(d.cardId, cur);
  }
  for (const n of out.values()) n.reasons.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || String(a.ref).localeCompare(String(b.ref)));
  return out;
}

/** Acabado a pedir: el de MENOR mercado con precio (empate ⇒ el primero de `finishes`, que llega en orden canónico: normal antes). */
export function pickFinish(
  finishes: readonly string[],
  marketOf: (finish: string) => number | null,
): { finish: string; marketCents: number | null } {
  let best: { finish: string; marketCents: number } | null = null;
  for (const f of finishes) {
    const m = marketOf(f);
    if (m != null && m > 0 && (best == null || m < best.marketCents)) best = { finish: f, marketCents: m };
  }
  if (best) return best;
  return { finish: finishes[0] ?? 'normal', marketCents: null };
}

/** Precio por pieza de una sugerida: pct × mercado, peso hacia abajo, NUNCA > mercado (tope duro). null = sin precio. */
export function suggestedUnitCents(marketCents: number | null, pctBps: number): number | null {
  if (marketCents == null || marketCents <= 0) return null;
  const pct = Math.min(Math.max(1, Math.floor(pctBps)), 10000);
  const u = effectiveUnitCents({ pctBps: pct, fixedCents: null }, marketCents);
  if (u == null || u > marketCents) return null;
  return u;
}

/** ¿Salto > 30 % entre la captura anterior y la actual? (dato dudoso ⇒ cuarentena). */
export function isMarketJump(prevCents: number | null | undefined, nowCents: number): boolean {
  if (prevCents == null || prevCents <= 0) return false;
  return Math.abs(nowCents - prevCents) * 10000 > prevCents * MARKET_JUMP_BPS;
}

/** Necesidad neta a pedir: lo que falta tras el stock y lo ya pedido/en camino. */
export function netTarget(need: number, stock: number, incomingOther: number): number {
  return Math.max(0, need - stock - incomingOther);
}

export interface BudgetCandidate {
  key: string;
  qty: number;
  unitCents: number;
  rank: number; // puesto del deck que más pesa (menor = antes); sin puesto ⇒ Infinity
}

/** Orden de prioridad al topar el cupo (§PROV-F4.2): menor puesto primero, luego mayor valor (qty × unit), luego clave (determinista). */
export function sortByPriority<T extends BudgetCandidate>(c: T[]): T[] {
  return [...c].sort((a, b) => a.rank - b.rank || b.qty * b.unitCents - a.qty * a.unitCents || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Reparte el presupuesto restante en orden de prioridad. Nunca publica una solicitud partida: si no cabe completa se REDUCE la cantidad
 * para caber (mínimo 1); si ni 1 pieza cabe ⇒ `budget` (queda borrador). Presupuesto ≤ 0 ⇒ nada se publica.
 * La suma de `unit × qty` publicado NUNCA excede `remainingCents`.
 */
export function allocateBudget(
  ordered: BudgetCandidate[],
  remainingCents: number,
): { publish: { key: string; qty: number }[]; budget: string[]; remainingCents: number } {
  let left = Math.max(0, Math.floor(remainingCents));
  const publish: { key: string; qty: number }[] = [];
  const budget: string[] = [];
  for (const c of ordered) {
    if (c.qty <= 0 || c.unitCents <= 0) continue;
    const fit = Math.min(c.qty, Math.floor(left / c.unitCents));
    if (fit >= 1) { publish.push({ key: c.key, qty: fit }); left -= fit * c.unitCents; }
    else budget.push(c.key);
  }
  return { publish, budget, remainingCents: left };
}

/** Lunes 00:00 CDMX de la semana de `now` (instante UTC). */
export function weekStartMx(now: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const back = (dow + 6) % 7; // lunes = 0
  const monday = new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
  return mxDayStart(monday);
}
