import {
  MAX_CENTS,
  clampCents,
  computeSalePriceForRarity,
  quoteAcquisitionForFinish,
  computeSealedSalePrice,
  usdToMxnCents,
  computeSalePriceCents,
  computeAportacionCostCents,
} from './money';

/**
 * BE-27 (money-safety) — clamp FINAL a MAX_CENTS (Int32) sobre los importes `*Cents` persistibles.
 * NO cambia la matemática ni el redondeo; solo acota la cota superior. Un `pct × market` con un
 * market gigantesco queda acotado a MAX_CENTS en vez de desbordar la columna Int al persistir.
 */
describe('BE-27 — clampCents y clamp final en money.ts', () => {
  it('MAX_CENTS es el techo Int32 de Postgres', () => {
    expect(MAX_CENTS).toBe(2_147_483_647);
  });

  it('clampCents acota solo por arriba; deja intacto lo normal', () => {
    expect(clampCents(500)).toBe(500);
    expect(clampCents(MAX_CENTS)).toBe(MAX_CENTS);
    expect(clampCents(MAX_CENTS + 1)).toBe(MAX_CENTS);
    expect(clampCents(9_999_999_999)).toBe(MAX_CENTS);
  });

  it('computeSalePriceForRarity (pct) con market gigante → acotado a MAX_CENTS', () => {
    const res = computeSalePriceForRarity('Ultra Rare', 'normal', 5_000_000_000, {}, 100);
    expect(res.salePriceCents).toBe(MAX_CENTS);
    expect(res.status).toBe('priced');
  });

  it('computeSalePriceForRarity normal (sin overflow) NO cambia el resultado', () => {
    // market 1000_00 con fallback 15% → round(100000 * 1.15) = 115000, intacto.
    const res = computeSalePriceForRarity('SomeRare', 'normal', 100000, {}, 15);
    expect(res.salePriceCents).toBe(115000);
  });

  it('quoteAcquisitionForFinish (pct) con market gigante → acotado a MAX_CENTS', () => {
    const res = quoteAcquisitionForFinish('SomeRare', 'normal', 5_000_000_000, {}, 100);
    expect(res.quotedPriceCents).toBe(MAX_CENTS);
  });

  it('computeSealedSalePrice (market×spread) gigante → acotado a MAX_CENTS', () => {
    const res = computeSealedSalePrice(null, 'box', 5_000_000_000, { box: 100 }, 25);
    expect(res.salePriceCents).toBe(MAX_CENTS);
  });

  it('usdToMxnCents con entrada absurda → acotado a MAX_CENTS', () => {
    expect(usdToMxnCents(1_000_000_000, 1000, 0)).toBe(MAX_CENTS);
    // caso normal intacto: 1000_00 USDcents × 18 × 1.03 = round(1854000) = 1854000
    expect(usdToMxnCents(100000, 18, 3)).toBe(1854000);
  });

  it('computeSalePriceCents / computeAportacionCostCents acotan por arriba sin tocar el caso normal', () => {
    expect(computeSalePriceCents(5_000_000_000, 0)).toBe(MAX_CENTS);
    expect(computeSalePriceCents(100000, 15)).toBe(115000);
    expect(computeAportacionCostCents(5_000_000_000, 100)).toBe(MAX_CENTS);
    expect(computeAportacionCostCents(100000, 70)).toBe(70000);
  });

  it('respeta null/pending: sin market un pct sigue pending (no se clava a 0)', () => {
    expect(computeSalePriceForRarity('SomeRare', 'normal', null, {}, 15).salePriceCents).toBeNull();
    expect(computeSealedSalePrice(null, 'box', null, { box: 20 }, 25).salePriceCents).toBeNull();
  });
});
