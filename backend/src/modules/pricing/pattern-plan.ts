import { EffectiveVariantRow, effectiveVariantKey, effectiveVariantKeys } from '../../common/variant-product';

/**
 * §PRICE-PATTERN v2 (docs/DECISIONES.md puntos 6.1-6.4) — PLAN PURO de una corrida de `pattern-reclassify`. Sin BD: recibe las filas de mercado
 * vigentes por producto (con los candidatos ya marcados `kind: 'variant'`) y decide qué productos se reclasifican, qué combos se corrigen y cuáles
 * se difieren. Reglas fijas (constantes de código, sin dial ni pantalla):
 *  - SOLO BAJA: un combo es «expuesto» únicamente si el candidato vale > 1.5× el MAYOR precio base fresco (así, la lectura base nunca supera a la
 *    versión que hoy podría estar ganando: no hay forma de subir un precio).
 *  - Cuarentena (6.4c): sin base con precio, o la base tiene > 7 días ⇒ no se baja (se conserva el precio). Ratio ≤ 1.5 ⇒ tampoco.
 *  - Candidato ÚNICO de su acabado (sin base con precio) ⇒ combo «seguro»: pasa a `variant` y la lectura lo sigue usando como base (6.1).
 *  - Freno: como máximo {@link PATTERN_RUN_MAX} combos por corrida, los de MAYOR razón; el resto se difiere a la siguiente (se drena solo).
 *  - Acoplamiento: un producto tiene UN `kind`; solo se reclasifica si TODOS sus combos con precio son seguros o están aplicados.
 */
export const PATTERN_RUN_MAX = 150;
export const PATTERN_RATIO_MIN = 1.5;
export const PATTERN_BASE_MAX_AGE_DAYS = 7;

export interface PlanRow extends EffectiveVariantRow {
  /** Frescura efectiva de la fila (`evidenceDate ?? capturedDate`). */
  observedAt: Date;
}

export interface PlannedCombo {
  cardId: string;
  finish: string;
  /** Producto candidato más caro del combo y su precio (de donde se baja). */
  fromCents: number;
  /** Precio de la base más fresca (a donde se baja). */
  toCents: number;
  ratio: number;
  /** `tcgplayerProductId` de la base más fresca. */
  baseProductId: number | null;
}

export interface PatternPlan {
  /** Productos que se reclasifican a `variant` en esta corrida. */
  flipIds: string[];
  /** Combos expuestos que SE corrigen ahora, de mayor a menor razón. */
  applied: PlannedCombo[];
  /** Combos expuestos que esperan a la siguiente corrida, de mayor a menor razón. */
  deferred: PlannedCombo[];
  /** Combos en cuarentena (base vencida, sin base fresca o razón ≤ 1.5): el precio se conserva. */
  held: number;
  /** Combos en los que el patrón es el ÚNICO producto con precio (se conserva su precio como base). */
  safe: number;
}

export function planPatternRun(
  rows: readonly PlanRow[],
  candidateIds: ReadonlySet<string>,
  now: Date,
  max: number = PATTERN_RUN_MAX,
): PatternPlan {
  const groups = new Map<string, PlanRow[]>();
  for (const r of rows) {
    if (!(r.cents > 0) || r.productType !== 'raw' || r.gradeKey !== 'raw:NM') continue;
    const k = `${r.cardId}|${r.finish}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const cutoff = now.getTime() - PATTERN_BASE_MAX_AGE_DAYS * 86_400_000;
  type State = { kind: 'safe' } | { kind: 'hold' } | { kind: 'exposed'; combo: PlannedCombo };
  const state = new Map<string, State>();
  const productCombos = new Map<string, string[]>(); // candidato → combos con precio
  const comboProducts = new Map<string, string[]>(); // combo → candidatos con precio ahí
  // ⭐ la MISMA función única de «variante efectiva» (6.1) decide qué combos son «seguros» (patrón único con precio): ni un segundo cálculo aquí.
  const effective = effectiveVariantKeys(rows);
  for (const [k, g] of groups) {
    const cands = g.filter((r) => r.cardProductId != null && candidateIds.has(r.cardProductId));
    if (cands.length === 0) continue;
    for (const c of cands) {
      productCombos.set(c.cardProductId!, [...(productCombos.get(c.cardProductId!) ?? []), k]);
      comboProducts.set(k, [...(comboProducts.get(k) ?? []), c.cardProductId!]);
    }
    const base = g.filter((r) => r.kind !== 'variant');
    if (g.some((r) => r.cardProductId != null && effective.has(effectiveVariantKey({ cardProductId: r.cardProductId, productType: r.productType, gradeKey: r.gradeKey, finish: r.finish })))) {
      state.set(k, { kind: 'safe' });
      continue;
    }
    const fresh = base.filter((r) => r.observedAt.getTime() >= cutoff);
    if (fresh.length === 0) {
      state.set(k, { kind: 'hold' });
      continue;
    }
    const maxBase = Math.max(...fresh.map((r) => r.cents));
    const top = cands.reduce((a, b) => (b.cents > a.cents ? b : a));
    const ratio = top.cents / maxBase;
    if (!(ratio > PATTERN_RATIO_MIN)) {
      state.set(k, { kind: 'hold' });
      continue;
    }
    const freshest = [...fresh].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || a.cents - b.cents)[0];
    state.set(k, { kind: 'exposed', combo: { cardId: top.cardId, finish: top.finish, fromCents: top.cents, toCents: freshest.cents, ratio, baseProductId: freshest.tcgplayerProductId } });
  }

  // Cierre de un combo por productos compartidos (un producto = un `kind`): todos los combos que se mueven con él.
  const closureOf = (k: string): Set<string> => {
    const closure = new Set<string>();
    const stack = [k];
    while (stack.length > 0) {
      const c = stack.pop()!;
      if (closure.has(c)) continue;
      closure.add(c);
      for (const p of comboProducts.get(c) ?? []) for (const c2 of productCombos.get(p) ?? []) if (!closure.has(c2)) stack.push(c2);
    }
    return closure;
  };
  // Un combo expuesto se puede aplicar solo si nada de su cierre está en cuarentena.
  const blocked = (k: string): boolean => [...closureOf(k)].some((c) => state.get(c)?.kind === 'hold');
  const exposedKeys = [...state.entries()].filter(([, s]) => s.kind === 'exposed').map(([k]) => k);
  const free = exposedKeys.filter((k) => !blocked(k));
  const byRatio = (a: string, b: string) => (state.get(b) as { combo: PlannedCombo }).combo.ratio - (state.get(a) as { combo: PlannedCombo }).combo.ratio || a.localeCompare(b);
  free.sort(byRatio);

  const selected = new Set<string>();
  for (const k of free) {
    if (selected.has(k)) continue;
    const exposedInClosure = [...closureOf(k)].filter((c) => state.get(c)?.kind === 'exposed');
    if (selected.size + exposedInClosure.length <= max) for (const c of exposedInClosure) selected.add(c);
  }

  const flipIds: string[] = [];
  for (const id of candidateIds) {
    const combos = productCombos.get(id) ?? [];
    const ok = combos.every((c) => {
      const s = state.get(c);
      return s?.kind === 'safe' || (s?.kind === 'exposed' && selected.has(c));
    });
    if (ok) flipIds.push(id);
  }
  const applied = [...selected].sort(byRatio).map((k) => (state.get(k) as { combo: PlannedCombo }).combo);
  const deferred = free.filter((k) => !selected.has(k)).map((k) => (state.get(k) as { combo: PlannedCombo }).combo);
  const held = [...state.values()].filter((s) => s.kind === 'hold').length + exposedKeys.filter((k) => blocked(k)).length;
  const safe = [...state.values()].filter((s) => s.kind === 'safe').length;
  return { flipIds, applied, deferred, held, safe };
}
