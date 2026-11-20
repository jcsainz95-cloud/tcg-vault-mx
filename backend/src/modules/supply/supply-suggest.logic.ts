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
/** Copias máximas por carta en un mazo (excepto energía básica, que se excluye). */
export const MAX_COPIES = 4;
/** Salto de mercado vs la captura anterior que manda la carta a cuarentena (30 %). */
export const MARKET_JUMP_BPS = 3000;

export type SuggestReason = { kind: 'rotation' | 'metadeck'; ref: string | null };

export interface Need {
  cardId: string;
  need: number;
  reasons: SuggestReason[];
}

/** Energía BÁSICA (supertype Energy + subtipo Basic o nombre «Basic X Energy» / «Fire Energy»): se excluye siempre. */
export function isBasicEnergy(card: { supertype: string | null; name: string; subtypes: unknown }): boolean {
  if (card.supertype !== 'Energy') return false;
  const subs = Array.isArray(card.subtypes) ? (card.subtypes as unknown[]) : [];
  if (subs.includes('Basic')) return true;
  return /^Basic\b/i.test(card.name) || /^(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i.test(card.name);
}

/** Necesidad por carta de los mazos: el MÁXIMO de copias entre mazos (no la suma), acotado a 4. `ref` = slug del mazo que más copias pide. */
export function needsFromDecks(lines: { cardId: string; quantity: number; deckSlug: string }[]): Map<string, Need> {
  const out = new Map<string, Need>();
  for (const l of lines) {
    const q = Math.min(MAX_COPIES, Math.max(0, Math.floor(l.quantity)));
    if (q <= 0) continue;
    const cur = out.get(l.cardId);
    if (!cur) out.set(l.cardId, { cardId: l.cardId, need: q, reasons: [{ kind: 'metadeck', ref: l.deckSlug }] });
    else if (q > cur.need) { cur.need = q; cur.reasons = [{ kind: 'metadeck', ref: l.deckSlug }]; }
  }
  return out;
}

/** Unión de fuentes: `max` de la necesidad; `reasons` conserva las dos. */
export function mergeNeeds(...sources: Map<string, Need>[]): Map<string, Need> {
  const out = new Map<string, Need>();
  for (const src of sources) {
    for (const n of src.values()) {
      const cur = out.get(n.cardId);
      if (!cur) { out.set(n.cardId, { ...n, reasons: [...n.reasons] }); continue; }
      cur.need = Math.max(cur.need, n.need);
      for (const r of n.reasons) if (!cur.reasons.some((x) => x.kind === r.kind && x.ref === r.ref)) cur.reasons.push(r);
    }
  }
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
  signals: number; // nº de fuentes (2 ⇒ rotación + metadeck)
}

/** Orden de prioridad: señal de 2 fuentes, luego mayor valor (qty × unit), luego clave (determinista). */
export function sortByPriority<T extends BudgetCandidate>(c: T[]): T[] {
  return [...c].sort((a, b) => b.signals - a.signals || b.qty * b.unitCents - a.qty * a.unitCents || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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
