import { describe, it, expect } from 'vitest';
import { hasManualPrice } from './inventory';

describe('hasManualPrice · predicado money-safe del override (INV-3)', () => {
  it('raw/graded: cualquier listPriceCents no-nulo es override (incluye 0)', () => {
    expect(hasManualPrice({ productType: 'raw', listPriceCents: 250000 })).toBe(true);
    expect(hasManualPrice({ productType: 'graded', listPriceCents: 5335000 })).toBe(true);
    // catalog.service usa `!= null` para raw/graded: un 0 explícito cuenta como override manual.
    expect(hasManualPrice({ productType: 'raw', listPriceCents: 0 })).toBe(true);
  });

  it('sellado: el override cuenta SOLO si es > 0 (H-1, v1.24 — 0/negativo es degenerado ⇒ ausente)', () => {
    expect(hasManualPrice({ productType: 'sealed', listPriceCents: 350000 })).toBe(true);
    expect(hasManualPrice({ productType: 'sealed', listPriceCents: 0 })).toBe(false);
    expect(hasManualPrice({ productType: 'sealed', listPriceCents: -100 })).toBe(false);
  });

  it('sin listPriceCents (null/undefined) nunca es precio manual', () => {
    expect(hasManualPrice({ productType: 'raw', listPriceCents: null })).toBe(false);
    expect(hasManualPrice({ productType: 'sealed' })).toBe(false);
    expect(hasManualPrice({ productType: 'graded', listPriceCents: undefined })).toBe(false);
  });
});
