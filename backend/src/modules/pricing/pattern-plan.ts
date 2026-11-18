import { EffectiveVariantRow, effectiveVariantKey, effectiveVariantKeys, productPreferenceOf } from '../../common/variant-product';
import { RefRow, isBetterRef, isProductAmbiguous } from './pricing.service';

/**
 * §PRICE-PATTERN v2 (docs/DECISIONES.md puntos 6.1-6.4) — PLAN PURO de una corrida de `pattern-reclassify`. Sin BD: recibe las filas de mercado
 * vigentes por producto (con los candidatos ya marcados `kind: 'variant'`) y decide qué productos se reclasifican, qué combos se corrigen y cuáles
 * se difieren. Reglas fijas (constantes de código, sin dial ni pantalla):
 *  - SOLO BAJA: un combo es «expuesto» únicamente si el candidato vale > 1.5× el MAYOR precio base fresco (así, la lectura base nunca supera a la
 *    versión que hoy podría estar ganando: no hay forma de subir un precio).
 *  - Cuarentena (6.4c): sin base con precio, o la base tiene > 7 días ⇒ no se baja (se conserva el precio). Ratio ≤ 1.5 ⇒ tampoco.
 *  - Candidato ÚNICO de su acabado (sin base con precio) ⇒ combo «seguro»: pasa a `variant` y la lectura lo sigue usando como base (6.1).
 *  - Freno: como máximo {@link PATTERN_RUN_MAX} combos por corrida, los de MAYOR razón; el resto se difiere a la siguiente (se drena solo).
 *  - «Mismo conjunto que la lectura» (gates PP-7 / qa IMPORTANTE 2): la BASE de un combo es lo que la lectura REAL leería tras la reclasificación
 *    ({@link ReaderBaseRow}: las filas automáticas más frescas de TODOS los productos y fuentes del combo, sin colapsar, y el override manual). Con
 *    override manual el precio ya no depende del producto (combo «seguro», nada que corregir). Si esa lectura sería AMBIGUA (≥ 2 productos de
 *    preferencia 2 con diferencia > 25 %, `isProductAmbiguous`: la MISMA función de la lectura) ⇒ cuarentena: nunca se deja una carta sin precio.
 *  - Acoplamiento: un producto tiene UN `kind`; solo se reclasifica si TODOS sus combos con precio son seguros o están aplicados.
 */
export const PATTERN_RUN_MAX = 150;
export const PATTERN_RATIO_MIN = 1.5;
export const PATTERN_BASE_MAX_AGE_DAYS = 7;

export interface PlanRow extends EffectiveVariantRow {
  /** Frescura efectiva de la fila (`evidenceDate ?? capturedDate`). */
  observedAt: Date;
}

/** Una fila de mercado raw NM tal como la ve la lectura real (`getReferencesBatch`), sin colapsar por producto. */
export interface ReaderBaseRow {
  cardId: string;
  finish: string;
  cardProductId: string | null;
  productExtId: number | null;
  productName: string | null;
  cardName: string;
  cardTcgplayerId: string | null;
  source: string;
  isManual: boolean;
  /** `true` ⇒ es una fila de un producto CANDIDATO (hoy `set_base|other`; tras el flip deja de contar como base). */
  isCandidate?: boolean;
  priceMxnCents: number;
  capturedDate: Date;
  evidenceDate: Date | null;
}

/** Respaldo SOLO para pruebas unitarias del plan: deriva «lo que lee la lectura» de las filas ya cargadas (producción pasa las filas reales). */
export function readerBaseFromRows(rows: readonly PlanRow[], candidateIds: ReadonlySet<string> = new Set()): ReaderBaseRow[] {
  return rows
    .filter((r) => r.productType === 'raw' && r.gradeKey === 'raw:NM' && (r.kind !== 'variant' || (r.cardProductId != null && candidateIds.has(r.cardProductId))))
    .map((r) => ({
      cardId: r.cardId, finish: r.finish, cardProductId: r.cardProductId, productExtId: r.tcgplayerProductId, productName: null, cardName: '', cardTcgplayerId: null,
      source: 'tcgcsv_singles', isManual: false, isCandidate: r.cardProductId != null && candidateIds.has(r.cardProductId), priceMxnCents: r.cents,
      // respaldo de PRUEBA: el candidato es lo que la lectura devuelve hoy (peor caso: 1 ms más fresco ⇒ el único del día más fresco)
      capturedDate: new Date(r.observedAt.getTime() + (r.cardProductId != null && candidateIds.has(r.cardProductId) ? 1 : 0)), evidenceDate: null,
    }));
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
  readerBase?: readonly ReaderBaseRow[],
  /** Candidatos con precio de mercado FUERA de raw:NM (graded, etc.): la lectura aplica la «variante efectiva» a todos los tipos ⇒ cuarentena (PP/qa MENOR). */
  nonRawCandidateIds: ReadonlySet<string> = new Set(),
  /**
   * `cardId|finish` con ≥ 1 producto `variant` (NO candidato) cuyo `finishes` incluye el acabado: el MISMO `EXISTS` con que la lectura fija `variantCombo`
   * (qa MENOR 6.6: antes se deducía de las filas con precio y podía divergir). Sin él (pruebas unitarias del plan) se deduce de las filas como antes.
   */
  preVariantCombos?: ReadonlySet<string>,
): PatternPlan {
  const baseByCombo = new Map<string, ReaderBaseRow[]>();
  for (const b of readerBase ?? readerBaseFromRows(rows, candidateIds)) {
    const k = `${b.cardId}|${b.finish}`;
    const g = baseByCombo.get(k);
    if (g) g.push(b);
    else baseByCombo.set(k, [b]);
  }
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
    if (cands.some((c) => nonRawCandidateIds.has(c.cardProductId!))) {
      state.set(k, { kind: 'hold' }); // la lectura también cambiaría su precio graded/otro tipo, que este plan no mide ⇒ no se toca
      continue;
    }
    if (g.some((r) => r.cardProductId != null && effective.has(effectiveVariantKey({ cardProductId: r.cardProductId, productType: r.productType, gradeKey: r.gradeKey, finish: r.finish })))) {
      state.set(k, { kind: 'safe' });
      continue;
    }
    const rb = baseByCombo.get(k) ?? [];
    if (rb.some((r) => r.isManual)) {
      state.set(k, { kind: 'safe' }); // override manual: tier absoluto, el precio no depende de qué producto es `variant` ⇒ nada que corregir ni que informar
      continue;
    }
    const observed = (r: ReaderBaseRow) => (r.evidenceDate ?? r.capturedDate).getTime();
    // Lo que la lectura REAL conserva de un conjunto de filas: solo el día más fresco, de todos los productos y fuentes.
    const newestOf = (rs: ReaderBaseRow[]): ReaderBaseRow[] => {
      const m = rs.length > 0 ? Math.max(...rs.map(observed)) : -Infinity;
      return rs.filter((r) => observed(r) === m);
    };
    const toRef = (r: ReaderBaseRow, variantCombo: boolean): RefRow => ({
      priceMxnCents: r.priceMxnCents, priceUsdCents: null, isManualOverride: false, source: r.source, capturedDate: r.capturedDate, evidenceDate: r.evidenceDate,
      cardProductId: r.cardProductId, variantCombo,
      // sin `variant` en el combo la lectura NO pone preferencia ni id externo (desempate por uuid): se imita igual
      productExtId: variantCombo ? r.productExtId : null,
      productPref: variantCombo && r.cardProductId != null && r.productExtId != null && r.productName != null ? productPreferenceOf({ tcgplayerProductId: r.productExtId, name: r.productName }, { tcgplayerId: r.cardTcgplayerId, name: r.cardName }) : undefined,
    });
    const pick = (rs: RefRow[]): RefRow => rs.reduce((a, b) => (isBetterRef(b, a) ? b : a));
    // DESPUÉS del flip: la base son las filas NO candidatas del día más fresco; la carta tendrá `variant` en este acabado ⇒ rigen preferencia y ambigüedad.
    const post = newestOf(rb.filter((r) => !r.isCandidate));
    if (post.length === 0 || observed(post[0]) < cutoff || post.some((r) => !(r.priceMxnCents > 0))) {
      state.set(k, { kind: 'hold' });
      continue;
    }
    const postRefs = post.map((r) => toRef(r, true));
    const winner = pick(postRefs);
    if (isProductAmbiguous(winner, postRefs, (x) => x.priceMxnCents)) {
      state.set(k, { kind: 'hold' }); // la lectura quedaría en «pendiente»: jamás se deja una carta sin precio
      continue;
    }
    // ANTES del flip: lo que la lectura devuelve HOY (todos los productos, candidatos incluidos). Si el precio de después fuera MAYOR, no se toca (solo baja).
    const preCombo = preVariantCombos ? preVariantCombos.has(k) : g.some((r) => r.kind === 'variant' && r.cardProductId != null && !candidateIds.has(r.cardProductId));
    const preRefs = newestOf(rb).map((r) => toRef(r, preCombo));
    const preWinner = pick(preRefs);
    if (isProductAmbiguous(preWinner, preRefs, (x) => x.priceMxnCents)) {
      // HOY la lectura ya es «pendiente» (qa MENOR 6.6): no hay precio publicado que bajar, así que no hay «de» que informar (antes se inventaba el del
      // patrón). El flip solo le da precio (el de la base); la prueba lo mide igual. Combo «seguro»: nada que corregir ni que contar.
      state.set(k, { kind: 'safe' });
      continue;
    }
    if (preWinner.priceMxnCents < winner.priceMxnCents) {
      state.set(k, { kind: 'hold' });
      continue;
    }
    if (preWinner.priceMxnCents === winner.priceMxnCents) {
      state.set(k, { kind: 'safe' }); // el flip no cambia el precio (p. ej. la base ya ganaba por uuid): nada que corregir ni que informar
      continue;
    }
    const maxBase = Math.max(...post.map((r) => r.priceMxnCents));
    const top = cands.reduce((a, b) => (b.cents > a.cents ? b : a));
    const ratio = top.cents / maxBase;
    if (!(ratio > PATTERN_RATIO_MIN)) {
      state.set(k, { kind: 'hold' });
      continue;
    }
    state.set(k, { kind: 'exposed', combo: { cardId: top.cardId, finish: top.finish, fromCents: preWinner.priceMxnCents, toCents: winner.priceMxnCents, ratio, baseProductId: winner.productExtId ?? null } });
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
