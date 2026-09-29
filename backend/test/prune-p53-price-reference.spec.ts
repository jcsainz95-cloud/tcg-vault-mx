import { planRunCollapse, PrunableRow } from '../prisma/prune-p53-price-reference';

/**
 * P-53 §6 · Poda/dedup de filas de SINGLES redundantes — la lógica PURA (money-critical).
 *
 * Contrato (canario de la operación de datos):
 *  - **T-7 (dedup segura):** un `key0` con runs de valor idéntico y ≥2 cambios reales ⇒ conserva
 *    EXACTAMENTE 1 fila por run (el `f0`, punto de cambio), con `evidenceDate = max(evidencia)` del run,
 *    y borra el resto. Cada cambio de USD sobrevive.
 *  - **Idempotencia:** re-planificar sobre el resultado (runs de 1 fila) no borra nada ni retrocede
 *    `evidenceDate`.
 *  - **T-8 (invariante de serie):** para TODO `asOf`, la fila vigente (más reciente `<= asOf`) conserva
 *    el mismo `priceUsdCents` antes y después de la poda ⇒ `computeSetValue` (forward-fill sobre USD)
 *    da el mismo total.
 */

function d(iso: string): Date {
  const x = new Date(`${iso}T00:00:00Z`);
  return x;
}

function row(id: string, captured: string, usd: number, evidence?: string, buffer = 3): PrunableRow {
  return {
    id,
    capturedDate: d(captured),
    evidenceDate: evidence ? d(evidence) : null,
    priceUsdCents: usd,
    fxBufferPct: buffer,
  };
}

/** Aplica un plan sobre un arreglo de filas (simula la mutación) para asertar invariantes de serie. */
function applyPlan(rows: PrunableRow[], plan: ReturnType<typeof planRunCollapse>): PrunableRow[] {
  const del = new Set(plan.deleteIds);
  const upd = new Map(plan.updates.map((u) => [u.id, u.evidenceDate]));
  return rows
    .filter((r) => !del.has(r.id))
    .map((r) => (upd.has(r.id) ? { ...r, evidenceDate: upd.get(r.id)! } : r));
}

/** «Fila vigente» a un `asOf`: la más reciente con `capturedDate <= asOf` (forward-fill de la serie). */
function vigenteUsdAt(rows: PrunableRow[], asOf: Date): number | null {
  const cands = rows
    .filter((r) => r.capturedDate.getTime() <= asOf.getTime())
    .sort((a, b) => b.capturedDate.getTime() - a.capturedDate.getTime());
  return cands[0]?.priceUsdCents ?? null;
}

describe('P-53 · planRunCollapse — dedup segura de singles', () => {
  it('T-7 · runs de valor idéntico con ≥2 cambios ⇒ 1 fila/run, evidenceDate=max, conserva los cambios', () => {
    // Valor 500 (17,18,19) → cambio a 600 (20,21) → cambio a 500 de nuevo (22): TRES runs (el último
    // 500 es un run APARTE del primero: no es contiguo).
    const rows = [
      row('a', '2026-09-17', 500),
      row('b', '2026-09-18', 500),
      row('c', '2026-09-19', 500),
      row('d', '2026-09-20', 600),
      row('e', '2026-09-21', 600),
      row('f', '2026-09-22', 500),
    ];
    const plan = planRunCollapse(rows);

    // Se borran las confirmaciones redundantes: b,c (run 500 #1) y e (run 600).
    expect(new Set(plan.deleteIds)).toEqual(new Set(['b', 'c', 'e']));
    // Los f0 de cada run: a (500), d (600), f (500) sobreviven ⇒ los 3 cambios preservados.
    const survivors = applyPlan(rows, plan);
    expect(survivors.map((r) => r.id).sort()).toEqual(['a', 'd', 'f']);
    // evidenceDate = último capturedDate del run: a→19, d→21, f→22.
    const byId = new Map(survivors.map((r) => [r.id, r.evidenceDate]));
    expect(byId.get('a')).toEqual(d('2026-09-19'));
    expect(byId.get('d')).toEqual(d('2026-09-21'));
    expect(byId.get('f')).toEqual(d('2026-09-22'));
  });

  it('idempotente · re-planificar sobre el resultado no borra nada ni retrocede evidenceDate', () => {
    const rows = [row('a', '2026-09-17', 500), row('b', '2026-09-18', 500), row('c', '2026-09-19', 500)];
    const survivors1 = applyPlan(rows, planRunCollapse(rows));
    expect(survivors1).toHaveLength(1);
    expect(survivors1[0].evidenceDate).toEqual(d('2026-09-19'));

    const plan2 = planRunCollapse(survivors1);
    expect(plan2.deleteIds).toEqual([]);
    expect(plan2.updates).toEqual([]); // la evidencia ya está fijada al max ⇒ no retrocede
    const survivors2 = applyPlan(survivors1, plan2);
    expect(survivors2[0].evidenceDate).toEqual(d('2026-09-19'));
  });

  it('T-8 · invariante de serie: la fila vigente a TODO asOf conserva su priceUsdCents tras la poda', () => {
    const rows = [
      row('a', '2026-09-17', 500),
      row('b', '2026-09-18', 500),
      row('c', '2026-09-19', 600),
      row('d', '2026-09-20', 600),
      row('e', '2026-09-21', 600),
      row('f', '2026-09-22', 750),
    ];
    const survivors = applyPlan(rows, planRunCollapse(rows));
    for (let day = 16; day <= 24; day += 1) {
      const asOf = d(`2026-09-${String(day).padStart(2, '0')}`);
      expect(vigenteUsdAt(survivors, asOf)).toBe(vigenteUsdAt(rows, asOf));
    }
  });

  it('el buffer distingue runs · mismo USD, buffer distinto ⇒ dos runs, ambos f0 sobreviven', () => {
    const rows = [row('a', '2026-09-17', 500, undefined, 3), row('b', '2026-09-18', 500, undefined, 5)];
    const plan = planRunCollapse(rows);
    expect(plan.deleteIds).toEqual([]); // valores distintos (buffer cambió) ⇒ nada que colapsar
  });

  it('respeta evidenceDate preexistente · el max no retrocede aunque una fila legada la traiga', () => {
    // f0 sin evidencia, pero una confirmación posterior YA tenía evidenceDate > su capturedDate.
    const rows = [row('a', '2026-09-17', 500), row('b', '2026-09-18', 500, '2026-09-25')];
    const plan = planRunCollapse(rows);
    expect(plan.deleteIds).toEqual(['b']);
    expect(plan.updates).toEqual([{ id: 'a', evidenceDate: d('2026-09-25') }]);
  });

  it('caso vacío / una sola fila · sin borrados; fija evidencia a su propia captura si falta', () => {
    expect(planRunCollapse([])).toEqual({ updates: [], deleteIds: [] });
    const one = [row('a', '2026-09-17', 500)];
    const plan = planRunCollapse(one);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'a', evidenceDate: d('2026-09-17') }]);
  });
});
