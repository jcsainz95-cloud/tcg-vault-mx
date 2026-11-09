import { quarantinedGrades } from '../src/common/graded-estimate';

/** AUTO-D (docs/specs/AUTO_CATALOGO.md §D): cuarentena automatica de estimados AUTOMATICOS fuera de cota dura; manuales intactos. */
const est = (gradeValue: string, mxnCents: number, isManual = false) => ({
  gradeValue,
  mxnCents,
  capturedDate: '2026-11-01',
  isManual,
  refKind: 'graded_estimate' as const,
});
const base = { maxRawMultiple: 10 };

describe('quarantinedGrades (AUTO-D)', () => {
  it('D1 psa10 automatico > raw x tope ⇒ en cuarentena', () => {
    const q = quarantinedGrades({ ...base, estimates: [est('10', 1_100_000), est('9', 500_000)], rawSalePriceCents: 100_000 });
    expect([...q]).toEqual(['10']);
  });
  it('un psa10 dentro de cota NO se pone en cuarentena (D5: el umbral importa)', () => {
    expect(quarantinedGrades({ ...base, estimates: [est('10', 1_000_000), est('9', 500_000)], rawSalePriceCents: 100_000 }).size).toBe(0);
    expect(quarantinedGrades({ ...base, estimates: [est('10', 1_000_001)], rawSalePriceCents: 100_000 }).has('10')).toBe(true);
  });
  it('NOT_ABOVE_RAW: psa10 <= raw ⇒ cuarentena', () => {
    expect(quarantinedGrades({ ...base, estimates: [est('10', 90_000)], rawSalePriceCents: 100_000 }).has('10')).toBe(true);
  });
  it('GRADE_ORDER_INVERTED: psa10 < psa9 ⇒ las automaticas de la pareja', () => {
    const q = quarantinedGrades({ ...base, estimates: [est('10', 300_000), est('9', 400_000)], rawSalePriceCents: 100_000 });
    expect([...q].sort()).toEqual(['10', '9']);
  });
  it('NO_RAW: sin raw del acabado ⇒ todas las automaticas', () => {
    expect([...quarantinedGrades({ ...base, estimates: [est('10', 300_000), est('9', 200_000)], rawSalePriceCents: null })].sort()).toEqual(['10', '9']);
  });
  it('D3 los MANUALES no cambian de comportamiento aunque la cifra sea la misma', () => {
    const q = quarantinedGrades({ ...base, estimates: [est('10', 1_100_000, true), est('9', 500_000, true)], rawSalePriceCents: 100_000 });
    expect(q.size).toBe(0);
    expect(quarantinedGrades({ ...base, estimates: [est('10', 300_000, true)], rawSalePriceCents: null }).size).toBe(0);
  });
  it('D2 al corregirse el dato (raw sube / estimado baja) la cifra reaparece sola: sin estado guardado', () => {
    const e = [est('10', 1_100_000)];
    expect(quarantinedGrades({ ...base, estimates: e, rawSalePriceCents: 100_000 }).has('10')).toBe(true);
    expect(quarantinedGrades({ ...base, estimates: e, rawSalePriceCents: 120_000 }).has('10')).toBe(false);
  });
});
