import {
  MAX_CENTS,
  clampCents,
  computeSalePriceFromCurve,
  quoteAcquisitionFromCurve,
  computeSealedSalePrice,
  usdToMxnCents,
  computeSalePriceCents,
  computeAportacionCostCents,
} from './money';
import { DEFAULT_PRICING_CURVE, PricingCurve } from './pricing-curve';

/** Curva con el markup topado (100×) para forzar el desbordamiento con un mercado absurdo. */
const EXTREME_CURVE: PricingCurve = {
  ...DEFAULT_PRICING_CURVE,
  sale: { ...DEFAULT_PRICING_CURVE.sale, points: [{ marketCents: 1, multiplierBp: 1_000_000 }] },
  buy: { ...DEFAULT_PRICING_CURVE.buy, points: [{ marketCents: 1, pctBp: 10_000 }] },
};

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

  it('v2.0 — la CURVA de venta con mercado gigante → acotada a MAX_CENTS', () => {
    const res = computeSalePriceFromCurve(5_000_000_000, EXTREME_CURVE);
    expect(res.priceCents).toBe(MAX_CENTS);
    expect(res.basis).toBe('market');
  });

  it('v2.0 — la CURVA de venta normal (sin overflow) NO cambia el resultado', () => {
    // $1,000 de mercado × 1.15 = $1,150 (múltiplo de $25: el redondeo no lo mueve).
    expect(computeSalePriceFromCurve(100000, DEFAULT_PRICING_CURVE).priceCents).toBe(115000);
  });

  it('v2.0 — la CURVA de compra con mercado gigante → acotada a MAX_CENTS', () => {
    expect(quoteAcquisitionFromCurve(5_000_000_000, EXTREME_CURVE).priceCents).toBe(MAX_CENTS);
  });

  it('v2.0 — un override absurdo también se acota (BE-27 en el peldaño de override)', () => {
    expect(
      computeSalePriceFromCurve(100000, DEFAULT_PRICING_CURVE, { sellOverrideCents: MAX_CENTS + 5 }).priceCents,
    ).toBe(MAX_CENTS);
    expect(
      quoteAcquisitionFromCurve(100000, DEFAULT_PRICING_CURVE, { buyOverrideCents: MAX_CENTS + 5 }).priceCents,
    ).toBe(MAX_CENTS);
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

  it('respeta null/pending: SIN mercado el precio queda null (nunca se clava a 0)', () => {
    expect(computeSalePriceFromCurve(null, DEFAULT_PRICING_CURVE).priceCents).toBeNull();
    expect(quoteAcquisitionFromCurve(null, DEFAULT_PRICING_CURVE).priceCents).toBeNull();
    expect(computeSealedSalePrice(null, 'box', null, { box: 20 }, 25).salePriceCents).toBeNull();
  });
});
