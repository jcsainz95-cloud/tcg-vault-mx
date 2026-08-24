/**
 * pricing-curve.spec.ts — E0 (ARCHITECTURE §4.36.11): la matemática pura de la curva, SIN cablear.
 *
 * Cubre:
 *  - la PRUEBA DE MESA normativa de §4.36.1 (criterios 79/80/82) con los diales iniciales de §N.2,
 *  - un caso por invariante V1–V8 del validador (§4.36.3 / criterio 87),
 *  - el guardarraíl (§4.36.5), el predicado de bounty (§4.36.6) y el bracket fijo (§4.36.7c).
 */
import {
  DEFAULT_PRICING_CURVE,
  PricingCurve,
  collectCurveViolations,
  interp,
  interpExact,
  rawCentsFromRational,
  saleBpPoints,
  explainSaleFromCurve,
  MAX_CENTS_CURVE,
  displayBpValue,
  saleBpPoints as saleBp,
  buyBpPoints,
  isBountyEffective,
  marketBracketOf,
  normalizePricingCurve,
  premiumFloorGuard,
  resolveBuyFromCurve,
  resolveSaleFromCurve,
  roundHalfUp,
  roundUp,
  sanitizePricingCurve,
  validatePricingCurve,
} from './pricing-curve';

const CURVE = DEFAULT_PRICING_CURVE;

/** Clona en profundidad el seed para poder mutarlo en los casos de invariante sin contaminar. */
function seed(): PricingCurve {
  return JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
}

describe('pricing-curve — PRUEBA DE MESA normativa (§4.36.1, criterios 79/80/82)', () => {
  // | Mercado | Venta esperada | Por qué |
  it.each([
    [114, 2500, 'floor', '$1.14 ⇒ $25.00 — gana el piso'],
    [2500, 4000, 'market', '$25 ⇒ $40.00 — 25×1.60 = 40 ⇒ ↑$5 = 40'],
    [5000, 7000, 'market', '$50 ⇒ $70.00 — markup interp ≈1.3955 ⇒ 69.77 ⇒ ↑$5'],
    [8000, 9500, 'market', '$80 ⇒ $95.00 — 80×1.15 = 92 ⇒ ↑$5'],
    [8600, 10000, 'market', '$86 ⇒ $100.00 — 98.90 ⇒ ↑$5'],
    [8700, 10500, 'market', '$87 ⇒ $105.00 — 100.05 ⇒ ↑$5 (NO $110: el paso de $5 llega a $200)'],
  ])('VENTA: mercado %i ⇒ %i (%s) — %s', (market, expected, basis) => {
    expect(resolveSaleFromCurve(market, CURVE)).toEqual({ cents: expected, basis });
  });

  it.each([
    [50, 100, 'floor', '$0.50 ⇒ $1.00 — gana el bin'],
    [1000, 300, 'market', '$10 ⇒ $3.00 — 30 % (tramo plano inicial)'],
    [2500, 750, 'market', '$25 ⇒ $7.50 — 30 %'],
    [10000, 4000, 'market', '$100 ⇒ $40.00 — 40 % (punto exacto)'],
    [30000, 13500, 'market', '$300 ⇒ $135.00 — pct interpolado 45 %'],
    [50000, 25000, 'market', '$500 ⇒ $250.00 — 50 % (punto exacto)'],
  ])('COMPRA: mercado %i ⇒ %i (%s) — %s', (market, expected, basis) => {
    expect(resolveBuyFromCurve(market, CURVE)).toEqual({ cents: expected, basis });
  });

  it('el markup interpolado en $50 es 1.3955× y el pct de compra en $300 es 45 %', () => {
    expect(saleBpForDisplay(CURVE, 5000)).toBe(13955);
    expect(buyBpForDisplay(CURVE, 30000)).toBe(4500);
  });

  it('criterio 80: una Common de cientos de pesos DEJA de recibir MX$0.50 (no hay bin de bulk)', () => {
    // Mercado $400 — la rareza NO entra al cálculo: el monto sale solo del mercado.
    expect(resolveBuyFromCurve(40000, CURVE).cents).toBe(19000); // 47.5 % de $400 = $190
  });
});

/**
 * v2.1.4 — `saleMultiplierBpAt`/`buyPctBpAt` se RETIRARON (trampa cargada: cero llamadores de
 * producción y valor cuantizado con nombre de operando). Estos helpers LOCALES del spec las
 * sustituyen: desenvuelven el `DisplayBp` explícitamente, que es justo el gesto que el tipo obliga a
 * hacer visible.
 */
const saleBpForDisplay = (c: PricingCurve, m: number) => displayBpValue(interp(saleBp(c.sale.points), m));
const buyBpForDisplay = (c: PricingCurve, m: number) => displayBpValue(interp(buyBpPoints(c.buy.points), m));

describe('pricing-curve — interpolación (criterio 81: nunca escalonada)', () => {
  it('tramos planos SOLO antes del primer punto y después del último', () => {
    expect(saleBpForDisplay(CURVE, 0)).toBe(16000);
    expect(saleBpForDisplay(CURVE, 1)).toBe(16000);
    expect(saleBpForDisplay(CURVE, 2500)).toBe(16000);
    expect(saleBpForDisplay(CURVE, 8000)).toBe(11500);
    expect(saleBpForDisplay(CURVE, 900000)).toBe(11500);
  });

  it('DENTRO del rango el markup cambia peso a peso (no hay meseta escalonada)', () => {
    const a = saleBpForDisplay(CURVE, 5000);
    const b = saleBpForDisplay(CURVE, 5100);
    expect(b).toBeLessThan(a); // baja conforme sube el valor
    // La propiedad que se protege es «SIN ESCALONES»: entre dos mercados contiguos el multiplicador se
    // mueve como la RECTA del tramo, no a saltos. Se compara contra la pendiente REAL del tramo en vez
    // de contra un umbral fijo (antes `< 200`), que estaba atado a la inclinación del seed vigente y se
    // habría roto al re-calibrar la curva — por una razón distinta de la que el test vigila.
    const [p0, p1] = [CURVE.sale.points[0], CURVE.sale.points[1]];
    const perCent = Math.abs(p1.multiplierBp - p0.multiplierBp) / (p1.marketCents - p0.marketCents);
    // Sobre el valor EXACTO (v2.1.2: `saleMultiplierBpAt` redondea, es solo-display) la caída es
    // exactamente la de la recta.
    const exactAt = (m: number) => {
      const { num, den } = interpExact(saleBpPoints(CURVE.sale.points), m);
      return num / den;
    };
    expect(exactAt(5000) - exactAt(5100)).toBeCloseTo(perCent * 100, 6);
    // Y el valor de display no se aleja del exacto más de lo que puede un redondeo a bp.
    expect(Math.abs(a - b - perCent * 100)).toBeLessThanOrEqual(1);
  });

  it('el pct de COMPRA sube conforme sube el mercado (§N.1)', () => {
    expect(buyBpForDisplay(CURVE, 2500)).toBe(3000);
    expect(buyBpForDisplay(CURVE, 10000)).toBe(4000);
    expect(buyBpForDisplay(CURVE, 50000)).toBe(5000);
    expect(buyBpForDisplay(CURVE, 5000)).toBeGreaterThan(3000);
    expect(buyBpForDisplay(CURVE, 5000)).toBeLessThan(4000);
  });

  it('barrido peso a peso $1–$300: la venta NUNCA cae por debajo del mercado y es monótona', () => {
    let prev = 0;
    for (let m = 100; m <= 30000; m += 1) {
      const sale = resolveSaleFromCurve(m, CURVE).cents as number;
      expect(sale).toBeGreaterThanOrEqual(m); // criterio 81: nunca por debajo del mercado
      expect(sale).toBeGreaterThanOrEqual(prev); // monótona creciente (incluido el redondeo)
      prev = sale;
    }
  });

  it('barrido peso a peso $1–$300: la compra queda SIEMPRE por debajo de la venta', () => {
    for (let m = 100; m <= 30000; m += 1) {
      const sale = resolveSaleFromCurve(m, CURVE).cents as number;
      const buy = resolveBuyFromCurve(m, CURVE).cents as number;
      expect(buy).toBeLessThan(sale);
    }
  });

  it('interp con lista vacía devuelve 1.00× (defensivo, nunca por debajo del mercado)', () => {
    expect(interp([], 12345)).toBe(10000);
  });
});

describe('pricing-curve — ROUND_HALF_UP fijado (§4.36.1): medio ALEJÁNDOSE DE CERO sobre el VALOR FINAL', () => {
  it('roundHalfUp: medio alejándose de cero en los dos signos', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3); // NO "half to even": 2, no 3, sería banker's rounding
    expect(roundHalfUp(-0.5)).toBe(-1); // el nativo de JS daría -0
    expect(roundHalfUp(-1590.5)).toBe(-1591); // el nativo de JS daría -1590
    expect(roundHalfUp(1733.4999)).toBe(1733);
  });

  it('MEDIO CENTAVO (obligatorio, E0): rawCents = 1733.5 ⇒ 1734', () => {
    // Curva de compra plana al 50 %: 3467 × 5000 / 10000 = 1733.5 EXACTO ⇒ hacia arriba.
    const curve: PricingCurve = {
      version: 1,
      sale: { floorCents: 2500, points: [{ marketCents: 1, multiplierBp: 16000 }], rounding: CURVE.sale.rounding },
      buy: { binCents: 100, points: [{ marketCents: 1, pctBp: 5000 }] },
    };
    expect(validatePricingCurve(curve)).toBeNull();
    expect(resolveBuyFromCurve(3467, curve).cents).toBe(1734);
    // Y medio centavo por debajo NO sube: 3466 × 50 % = 1733 exacto.
    expect(resolveBuyFromCurve(3466, curve).cents).toBe(1733);
  });

  it('MEDIO CENTAVO en interp: se redondea el VALOR FINAL, no el delta (el delta es negativo)', () => {
    // Tramo (0, 1.60×) → (2000, 1.50×): en m = 1001 el delta vale EXACTAMENTE -500.5.
    //   * redondear el DELTA con «medio alejándose de cero» daría 16000 - 501 = 15499 (INCORRECTO);
    //   * redondear el VALOR FINAL (15499.5, siempre >= 0) da 15500 (NORMATIVO, §4.36.1).
    const points = [
      { marketCents: 0, valueBp: 16000 },
      { marketCents: 2000, valueBp: 15000 },
    ];
    expect(interp(points, 1001)).toBe(15500);
    // Y el caso simétrico hacia abajo: en m = 999 el delta es -499.5 ⇒ final 15500.5 ⇒ 15501.
    expect(interp(points, 999)).toBe(15501);
  });

  it('la prueba de mesa NO se mueve con el redondeo fijado (regresión del fix)', () => {
    expect(saleBpForDisplay(CURVE, 5000)).toBe(13955);
    expect(resolveSaleFromCurve(5000, CURVE).cents).toBe(7000);
    expect(resolveBuyFromCurve(30000, CURVE).cents).toBe(13500);
  });
});

describe('pricing-curve — escalera de redondeo ↑ (§N.2 decisión 5; SOLO venta)', () => {
  const ladder = CURVE.sale.rounding;

  it('bandas semiabiertas: <$200 ⇒ $5 · [$200,$500) ⇒ $10 · ≥$500 ⇒ $25', () => {
    expect(roundUp(10005, ladder)).toBe(10500); // $100.05 ⇒ $105
    expect(roundUp(19999, ladder)).toBe(20000); // sigue en la banda de $5
    expect(roundUp(20001, ladder)).toBe(21000); // banda de $10
    expect(roundUp(49999, ladder)).toBe(50000);
    expect(roundUp(50001, ladder)).toBe(52500); // banda de $25
  });

  it('la banda se elige UNA SOLA VEZ (si el redondeo cruza el umbral, NO se re-evalúa)', () => {
    // $199.99 está en la banda de $5 ⇒ sube a $200 aunque $200 ya sería de la banda de $10.
    expect(roundUp(19999, ladder)).toBe(20000);
    // $499.99 está en la banda de $10 ⇒ sube a $500 (no a $525 de la banda de $25).
    expect(roundUp(49999, ladder)).toBe(50000);
  });

  it('un monto ya múltiplo del paso NO se mueve', () => {
    expect(roundUp(4000, ladder)).toBe(4000);
    expect(roundUp(50000, ladder)).toBe(50000);
  });

  it('la COMPRA no se redondea', () => {
    // 30 % de $12.34 = $3.702 ⇒ 370 centavos, sin subir a múltiplo de $5.
    expect(resolveBuyFromCurve(1234, CURVE).cents).toBe(370);
  });

  it('escalera vacía ⇒ no redondea (defensivo)', () => {
    expect(roundUp(12345, [])).toBe(12345);
  });
});

describe('pricing-curve — money-safe: sin mercado ⇒ pending (el piso/bin NO gana)', () => {
  it.each<[number | null, string]>([
    [null, 'null'],
    [0, 'cero'],
    [-1, 'negativo'],
  ])('mercado %s (%s) ⇒ basis pending y monto null en LOS DOS ejes', (market) => {
    expect(resolveSaleFromCurve(market, CURVE)).toEqual({ cents: null, basis: 'pending' });
    expect(resolveBuyFromCurve(market, CURVE)).toEqual({ cents: null, basis: 'pending' });
  });
});

describe('pricing-curve — EMPATE ⇒ market (§N.7, desempate fijado)', () => {
  it('venta: piso == mercado × markup ⇒ basis market (y SÍ se muestra el valor de mercado)', () => {
    // Mercado tal que market × 1.60 == floor 2500 ⇒ market = 1562.5 ⇒ se usa un piso exacto.
    const curve = seed();
    curve.sale.floorCents = 4000; // == 2500 × 1.60
    expect(resolveSaleFromCurve(2500, curve)).toEqual({ cents: 4000, basis: 'market' });
  });

  it('venta: piso ESTRICTAMENTE mayor ⇒ basis floor', () => {
    const curve = seed();
    curve.sale.floorCents = 4001;
    expect(resolveSaleFromCurve(2500, curve).basis).toBe('floor');
  });

  it('compra: bin == mercado × pct ⇒ basis market', () => {
    const curve = seed();
    curve.buy.binCents = 750; // == 30 % de $25
    expect(resolveBuyFromCurve(2500, curve)).toEqual({ cents: 750, basis: 'market' });
  });
});

describe('pricing-curve — invariantes VALIDABLES del setting (§4.36.3, V1–V9)', () => {
  it('el seed de §N.2 es VÁLIDO', () => {
    expect(validatePricingCurve(DEFAULT_PRICING_CURVE)).toBeNull();
  });

  it('V1 — CURVE_EMPTY: curva de venta sin puntos', () => {
    const c = seed();
    c.sale.points = [];
    expect(validatePricingCurve(c)).toMatchObject({ code: 'CURVE_EMPTY', details: { axis: 'sale' } });
  });

  it('V1 — CURVE_EMPTY: curva de compra sin puntos', () => {
    const c = seed();
    c.buy.points = [];
    expect(validatePricingCurve(c)).toMatchObject({ code: 'CURVE_EMPTY', details: { axis: 'buy' } });
  });

  it('V2 — DUPLICATE_BREAKPOINT: dos puntos con el mismo marketCents', () => {
    const c = seed();
    c.sale.points.push({ marketCents: 2500, multiplierBp: 15000 });
    const e = validatePricingCurve(c);
    expect(e).toMatchObject({ code: 'DUPLICATE_BREAKPOINT', details: { axis: 'sale', marketCents: 2500 } });
    // El error SEÑALA los renglones del editor (índices del request, no del array ordenado).
    expect(e?.details.index).toBe(2);
    expect(e?.details.index2).toBe(0);
  });

  it('V3 — VALIDATION_ERROR: rangos y tipos (marketCents, multiplierBp, pctBp, floorCents, binCents)', () => {
    const noInt = seed();
    noInt.sale.points[0].marketCents = 25.5;
    expect(validatePricingCurve(noInt)).toMatchObject({ code: 'VALIDATION_ERROR', details: { axis: 'sale', index: 0 } });

    const tooBig = seed();
    tooBig.sale.points[0].multiplierBp = 1_000_001;
    expect(validatePricingCurve(tooBig)).toMatchObject({ code: 'VALIDATION_ERROR', details: { axis: 'sale', index: 0 } });

    const pctOver = seed();
    pctOver.buy.points[0].pctBp = 10_001;
    expect(validatePricingCurve(pctOver)).toMatchObject({ code: 'VALIDATION_ERROR', details: { axis: 'buy', index: 0 } });

    const negFloor = seed();
    negFloor.sale.floorCents = -1;
    expect(validatePricingCurve(negFloor)).toMatchObject({ code: 'VALIDATION_ERROR', details: { axis: 'sale' } });

    const negBin = seed();
    negBin.buy.binCents = -1;
    expect(validatePricingCurve(negBin)).toMatchObject({ code: 'VALIDATION_ERROR', details: { axis: 'buy' } });
  });

  it('V4 — SALE_BELOW_MARKET: un punto con multiplierBp < 10000', () => {
    const c = seed();
    c.sale.points[1].multiplierBp = 9_999;
    expect(validatePricingCurve(c)).toMatchObject({
      code: 'SALE_BELOW_MARKET',
      details: { axis: 'sale', index: 1, multiplierBp: 9_999 },
    });
  });

  it('V5 — SALE_CURVE_NOT_MONOTONIC: el markup baja tan rápido que más mercado produce MENOS precio', () => {
    const c = seed();
    // $25 × 5.00× = $125 ; $80 × 1.00× = $80 ⇒ f decrece dentro del tramo.
    c.sale.points = [
      { marketCents: 2500, multiplierBp: 50_000 },
      { marketCents: 8000, multiplierBp: 10_000 },
    ];
    expect(validatePricingCurve(c)).toMatchObject({
      code: 'SALE_CURVE_NOT_MONOTONIC',
      details: { axis: 'sale', index: 0, index2: 1 },
    });
  });

  it('V5 — una pendiente fuerte pero todavía creciente SÍ se acepta', () => {
    const c = seed();
    // s = -1.0909 bp/centavo ⇒ f'(m0) = 20000 - 2727 > 0 y f'(m1) = 14000 - 8727 > 0: creciente en todo el tramo.
    c.sale.points = [
      { marketCents: 2500, multiplierBp: 20_000 },
      { marketCents: 8000, multiplierBp: 14_000 },
    ];
    expect(validatePricingCurve(c)).toBeNull();
  });

  it('V6 — BUY_ABOVE_SALE: la compra alcanza a la venta en algún punto del dominio', () => {
    const c = seed();
    c.sale.points = [{ marketCents: 2500, multiplierBp: 10_000 }]; // venta = mercado
    c.buy.points = [{ marketCents: 2500, pctBp: 10_000 }]; // compra = mercado ⇒ empate ⇒ prohibido
    expect(validatePricingCurve(c)).toMatchObject({ code: 'BUY_ABOVE_SALE', details: { marketCents: 2500 } });
  });

  it('V6 — se evalúa en la UNIÓN de los marketCents de AMBAS curvas (no solo los de una)', () => {
    const c = seed();
    // Venta plana a 1.00× (el mínimo permitido por V4). La compra solo ALCANZA a la venta en $100,
    // que es un nodo EXCLUSIVO de la curva de compra: en los nodos de venta (2500 y 50000) va al 30 %.
    c.sale.points = [
      { marketCents: 2500, multiplierBp: 10_000 },
      { marketCents: 50_000, multiplierBp: 10_000 },
    ];
    // El tramo final va PLANO a propósito: bajar el pct de vuelta a 30 % haría que este mismo fixture
    // violara además V9 (v2.1.4) —el pago absoluto caería entre $400 y $500— y el test dejaría de
    // aislar V6, que es lo que quiere comprobar.
    c.buy.points = [
      { marketCents: 2500, pctBp: 3_000 },
      { marketCents: 10_000, pctBp: 10_000 },
      { marketCents: 50_000, pctBp: 10_000 },
    ];
    expect(validatePricingCurve(c)).toMatchObject({ code: 'BUY_ABOVE_SALE', details: { marketCents: 10_000 } });
  });

  it('V7 — BIN_ABOVE_FLOOR: el bin alcanza o rebasa el piso', () => {
    const c = seed();
    c.buy.binCents = 2500; // == floorCents
    expect(validatePricingCurve(c)).toMatchObject({
      code: 'BIN_ABOVE_FLOOR',
      details: { binCents: 2500, floorCents: 2500 },
    });
  });

  it('V8 — ROUNDING_LADDER_INVALID: escalera vacía', () => {
    const c = seed();
    c.sale.rounding = [];
    expect(validatePricingCurve(c)).toMatchObject({ code: 'ROUNDING_LADDER_INVALID' });
  });

  it('V8 — ROUNDING_LADDER_INVALID: la última banda no es abierta', () => {
    const c = seed();
    c.sale.rounding = [
      { uptoCents: 20000, stepCents: 500 },
      { uptoCents: 50000, stepCents: 1000 },
    ];
    expect(validatePricingCurve(c)).toMatchObject({ code: 'ROUNDING_LADDER_INVALID', details: { index: 1 } });
  });

  it('V8 — ROUNDING_LADDER_INVALID: hay MÁS de una banda abierta', () => {
    const c = seed();
    c.sale.rounding = [
      { uptoCents: null, stepCents: 500 },
      { uptoCents: null, stepCents: 2500 },
    ];
    expect(validatePricingCurve(c)).toMatchObject({ code: 'ROUNDING_LADDER_INVALID', details: { index: 0 } });
  });

  it('V8 — ROUNDING_LADDER_INVALID: uptoCents no estrictamente crecientes', () => {
    const c = seed();
    c.sale.rounding = [
      { uptoCents: 50000, stepCents: 500 },
      { uptoCents: 20000, stepCents: 1000 },
      { uptoCents: null, stepCents: 2500 },
    ];
    expect(validatePricingCurve(c)).toMatchObject({ code: 'ROUNDING_LADDER_INVALID', details: { index: 1 } });
  });

  it('V8 — ROUNDING_LADDER_INVALID: stepCents < 1', () => {
    const c = seed();
    c.sale.rounding[0].stepCents = 0;
    expect(validatePricingCurve(c)).toMatchObject({ code: 'ROUNDING_LADDER_INVALID', details: { index: 0 } });
  });

  it('V8 (la sutil) — una frontera que NO es múltiplo del paso de su banda rompería la monotonía', () => {
    const c = seed();
    c.sale.rounding = [
      { uptoCents: 20300, stepCents: 500 }, // $203 no es múltiplo de $5
      { uptoCents: 50000, stepCents: 1000 },
      { uptoCents: null, stepCents: 2500 },
    ];
    expect(validatePricingCurve(c)).toMatchObject({
      code: 'ROUNDING_LADDER_INVALID',
      details: { index: 0, uptoCents: 20300, stepCents: 500 },
    });
  });

  it('forma inválida ⇒ VALIDATION_ERROR (no explota)', () => {
    expect(validatePricingCurve(null)).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(validatePricingCurve([])).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(validatePricingCurve({ version: 2 })).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(validatePricingCurve({ version: 1, sale: null, buy: null })).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(validatePricingCurve({ version: 1, sale: { points: {} }, buy: {} })).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('pricing-curve — normalización y lectura money-safe', () => {
  it('el PUT acepta la tabla DESORDENADA: se ordena por marketCents', () => {
    const c = seed();
    c.sale.points = [
      { marketCents: 8000, multiplierBp: 11500 },
      { marketCents: 2500, multiplierBp: 16000 },
    ];
    expect(validatePricingCurve(c)).toBeNull();
    expect(normalizePricingCurve(c).sale.points.map((p) => p.marketCents)).toEqual([2500, 8000]);
  });

  it('un valor persistido inválido cae al SEED (siempre hay curva) y lo reporta', () => {
    const bad = sanitizePricingCurve({ version: 1, sale: { floorCents: 0, points: [], rounding: [] }, buy: { binCents: 0, points: [] } });
    expect(bad.fellBack).toBe(true);
    expect(bad.curve).toEqual(normalizePricingCurve(DEFAULT_PRICING_CURVE));

    const ok = sanitizePricingCurve(DEFAULT_PRICING_CURVE);
    expect(ok.fellBack).toBe(false);
  });
});

describe('pricing-curve — guardarraíl premiumFloorGuard (§4.36.5)', () => {
  it('rareza premium + basis floor ⇒ premium_at_floor (NO se publica / NO se cotiza)', () => {
    expect(premiumFloorGuard('Illustration Rare', 'floor')).toBe('premium_at_floor');
    expect(premiumFloorGuard('Special Illustration Rare', 'floor')).toBe('premium_at_floor');
  });

  it('rareza NO premium en el piso ⇒ ok (una Common al piso sí se publica)', () => {
    expect(premiumFloorGuard('Common', 'floor')).toBe('ok');
    expect(premiumFloorGuard(null, 'floor')).toBe('ok');
  });

  it('NO dispara con market / override / bounty / pending (decisiones deliberadas del admin)', () => {
    for (const basis of ['market', 'override', 'bounty', 'pending'] as const) {
      expect(premiumFloorGuard('Illustration Rare', basis)).toBe('ok');
    }
  });
});

describe('pricing-curve — bounty revalidado isBountyEffective (§4.36.6, criterio 91)', () => {
  it('ESTRICTAMENTE mayor que la curva ⇒ efectivo', () => {
    expect(isBountyEffective(5001, 5000)).toBe(true);
  });

  it('IGUAL o MENOR que la curva ⇒ deja de ser bounty', () => {
    expect(isBountyEffective(5000, 5000)).toBe(false);
    expect(isBountyEffective(4999, 5000)).toBe(false);
  });

  it('curva sin resolver (null) ⇒ el bounty explícito manda', () => {
    expect(isBountyEffective(5000, null)).toBe(true);
  });

  it('bounty ausente o degenerado (<= 0) ⇒ nunca efectivo', () => {
    expect(isBountyEffective(null, 100)).toBe(false);
    expect(isBountyEffective(0, null)).toBe(false);
    expect(isBountyEffective(-1, null)).toBe(false);
  });
});

describe('pricing-curve — marketBracketOf: ESCALA FIJA (§4.36.7c)', () => {
  it.each([
    [1, 'lt_3'],
    [299, 'lt_3'],
    [300, 'r3_10'],
    [999, 'r3_10'],
    [1000, 'r10_25'],
    [2499, 'r10_25'],
    [2500, 'r25_80'],
    [7999, 'r25_80'],
    [8000, 'r80_300'],
    [29999, 'r80_300'],
    [30000, 'gte_300'],
    [999999, 'gte_300'],
  ])('mercado %i ⇒ %s', (market, bracket) => {
    expect(marketBracketOf(market)).toBe(bracket);
  });

  it('sin mercado ⇒ null (jamás un 0 inventado)', () => {
    expect(marketBracketOf(null)).toBeNull();
    expect(marketBracketOf(0)).toBeNull();
    expect(marketBracketOf(-5)).toBeNull();
  });
});

// ============================================================================
// E0-bis (v2.1.2) — REGRESIÓN PERMANENTE del hallazgo I1 de QA.
// ============================================================================

/**
 * El bug: §4.36.1 mandaba cuantizar el multiplicador interpolado a **bp entero**. Eso vuelve `k(m)`
 * una función ESCALONADA, y en cada escalón a la baja `m × round(k(m))` **cae** aunque `m` suba; la
 * escalera de redondeo de venta amplifica esa caída de unos centavos a **un peldaño completo**.
 *
 * QA lo reprodujo con tres curvas de diales perfectamente razonables, **las tres aceptadas por el
 * `PUT` con `200` y `violations: []`**. La peor pagaba **$25 menos por UN CENTAVO más de mercado** —
 * el sesgo exacto que §N.0 prohíbe (precio de menos = carta perdida, irrecuperable).
 *
 * La corrección NO debilita V5 ni lo sustituye por un barrido: elimina el redondeo intermedio, de
 * modo que el único redondeo de la cadena es el de centavos finales (monótono por definición) y V5
 * vuelve a ser una afirmación sobre **la función que cobra**.
 *
 * Estas tres curvas quedan como candado permanente: si alguien re-introduce la cuantización, el par
 * que rompía vuelve a romper aquí.
 */
describe('E0-bis — las TRES curvas de QA son monótonas con interpolación exacta (§4.36.1)', () => {
  const ladder = [
    { uptoCents: 20000, stepCents: 500 },
    { uptoCents: 50000, stepCents: 1000 },
    { uptoCents: null, stepCents: 2500 },
  ];
  const buy = { binCents: 100, points: [{ marketCents: 100, pctBp: 3000 }, { marketCents: 50000, pctBp: 5000 }] };
  const saleCurve = (points: { marketCents: number; multiplierBp: number }[]): PricingCurve => ({
    version: 1,
    sale: { floorCents: 2500, points, rounding: ladder },
    buy,
  });

  const QA_CURVES: Array<[string, PricingCurve, number]> = [
    [
      '2.00×@$10 → 1.05×@$500',
      saleCurve([
        { marketCents: 1000, multiplierBp: 20000 },
        { marketCents: 50000, multiplierBp: 10500 },
      ]),
      25611,
    ],
    [
      '1.60×@$25 → 1.15×@$80 → 1.05×@$1000',
      saleCurve([
        { marketCents: 2500, multiplierBp: 16000 },
        { marketCents: 8000, multiplierBp: 11500 },
        { marketCents: 100000, multiplierBp: 10500 },
      ]),
      71711,
    ],
    [
      '1.50×@$50 → 1.00×@$800',
      saleCurve([
        { marketCents: 5000, multiplierBp: 15000 },
        { marketCents: 80000, multiplierBp: 10000 },
      ]),
      38353,
    ],
  ];

  it.each(QA_CURVES)('«%s»: el par que rompía ya no rompe — P(m) ≥ P(m−1)', (_label, curve, m) => {
    const prev = resolveSaleFromCurve(m - 1, curve).cents!;
    const cur = resolveSaleFromCurve(m, curve).cents!;
    expect(cur).toBeGreaterThanOrEqual(prev);
  });

  it('el caso PEOR, con sus números exactos: $717.10 y $717.11 dan AMBOS $800.00 (antes $800 → $775)', () => {
    const curve = QA_CURVES[1][1];
    expect(resolveSaleFromCurve(71710, curve).cents).toBe(80000);
    expect(resolveSaleFromCurve(71711, curve).cents).toBe(80000);
  });

  it.each(QA_CURVES)('«%s»: monótona en TODO el entorno de la ruptura (±$50)', (_label, curve, m) => {
    let prev = -1;
    for (let x = m - 5000; x <= m + 5000; x++) {
      const c = resolveSaleFromCurve(x, curve).cents!;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it.each(QA_CURVES)('«%s»: las tres siguen siendo GUARDABLES (el bug no era de validación)', (_label, curve) => {
    expect(collectCurveViolations(curve).filter((e) => e.blocking)).toEqual([]);
  });

  /**
   * Caracterización, NO validación: este barrido vive en CI y jamás en el `PUT`. Barrer en cada
   * escritura cambiaría un invariante EXACTO por uno MUESTREADO — justo lo que no queremos (con paso
   * de 1 centavo costaría millones de evaluaciones por request; con cualquier paso mayor dejaría de
   * ser una demostración).
   */
  it('barrido del SEED ($0.01–$6 000): CERO rupturas de monotonía', () => {
    let prev = -1;
    let breaks = 0;
    for (let m = 1; m <= 600000; m++) {
      const c = resolveSaleFromCurve(m, DEFAULT_PRICING_CURVE).cents!;
      if (c < prev) breaks++;
      prev = c;
    }
    expect(breaks).toBe(0);
  });

  it('la COMPRA también es monótona en el seed (no la redondea la escalera, pero sí el centavo)', () => {
    let prev = -1;
    let breaks = 0;
    for (let m = 1; m <= 600000; m++) {
      const c = resolveBuyFromCurve(m, DEFAULT_PRICING_CURVE).cents!;
      if (c < prev) breaks++;
      prev = c;
    }
    expect(breaks).toBe(0);
  });
});

describe('E0-bis — `interpExact` es exacto y `rawCentsFromRational` es la ÚNICA multiplicación', () => {
  const pts = [
    { marketCents: 2500, valueBp: 16000 },
    { marketCents: 8000, valueBp: 11500 },
  ];

  it('devuelve el racional sin cuantizar: k($50) = 13954.545… ⇒ (num,den) exacto', () => {
    const { num, den } = interpExact(pts, 5000);
    // k = 16000 + (11500−16000)·(5000−2500)/5500 = 16000 − 4500·2500/5500
    expect(num).toBe(16000 * 5500 + (11500 - 16000) * 2500);
    expect(den).toBe(5500);
    expect(num / den).toBeCloseTo(13954.5454, 3);
    // …y NO es el entero que devolvería la versión display.
    expect(num % den).not.toBe(0);
  });

  it('tramos planos ⇒ racional (valor, 1), exacto por construcción', () => {
    expect(interpExact(pts, 1)).toMatchObject({ num: 16000, den: 1, segment: null });
    expect(interpExact(pts, 999999)).toMatchObject({ num: 11500, den: 1, segment: null });
  });

  it('`rawCentsFromRational` redondea medio ALEJÁNDOSE DE CERO (operando siempre ≥ 0)', () => {
    // 15 · 1/10000 con num/den = 10000/3 ⇒ exacto 0.5 ⇒ 1 (no 0).
    expect(rawCentsFromRational(1, 5000, 1)).toBe(1); // 1 × 0.5 = 0.5 ⇒ 1
    expect(rawCentsFromRational(3, 5000, 1)).toBe(2); // 1.5 ⇒ 2
    expect(rawCentsFromRational(10000, 10000, 1)).toBe(10000); // 1.00× exacto
  });

  it('NO pierde precisión con mercados grandes (por eso se calcula en BigInt, no en `number`)', () => {
    // m·num rebasa Number.MAX_SAFE_INTEGER: 2e9 × 1e12 = 2e21.
    const m = 2_000_000_000;
    const num = 16000 * 5500 + (11500 - 16000) * 2500; // ~7.5e7
    const den = 5500;
    // El resultado excede MAX_CENTS ⇒ se acota ANTES de volver a `number` (BE-27).
    expect(rawCentsFromRational(m, num, den)).toBe(2_147_483_647);
  });

  it('`interp` sigue existiendo pero es SOLO-DISPLAY: puede diferir del operando real del precio', () => {
    const display = interp(pts, 5000);
    const { num, den } = interpExact(pts, 5000);
    expect(displayBpValue(display)).toBe(roundHalfUp(num / den));
    // El precio EXACTO y el que saldría de recomponer desde el bp de display NO coinciden — que es
    // justo por qué `interp` devuelve `DisplayBp` y esa recomposición ya no compila sin la escotilla.
    const recomputedFromDisplay = roundHalfUp((5000 * displayBpValue(display)) / 10_000);
    expect(rawCentsFromRational(5000, num, den)).not.toBe(recomputedFromDisplay);
  });
});

describe('E0-bis — V6 exige ≥ 1 unidad de separación (margen cero prohibido, §N.3)', () => {
  const base = (pctBp: number): PricingCurve => ({
    version: 1,
    sale: {
      floorCents: 2500,
      points: [{ marketCents: 1000, multiplierBp: 10000 }],
      rounding: [{ uptoCents: null, stepCents: 500 }],
    },
    buy: { binCents: 100, points: [{ marketCents: 1000, pctBp }] },
  });

  it('separación de 1 bp: PASA (es el mínimo admitido)', () => {
    expect(collectCurveViolations(base(9999)).map((e) => e.code)).not.toContain('BUY_ABOVE_SALE');
  });

  it('separación 0 (compra == venta): RECHAZA — margen cero', () => {
    expect(collectCurveViolations(base(10000)).map((e) => e.code)).toContain('BUY_ABOVE_SALE');
  });

  it('con los rangos V3/V4, «compra ARRIBA de venta» es inalcanzable: el caso real es la separación < 1', () => {
    // `pctBp ≤ 10000 ≤ multiplierBp` por V3/V4 ⇒ `pct > mult` no existe; lo que sí existe (y es lo que
    // v2.1.2 cierra) es que la diferencia sea > 0 pero < 1 unidad, donde los DOS precios colapsan al
    // mismo centavo. Un `pctBp` fuera de rango lo ataja antes V3, con otro código.
    expect(collectCurveViolations(base(10001)).map((e) => e.code)).toContain('VALIDATION_ERROR');
  });

  it('separación FRACCIONARIA (0 < diff < 1): RECHAZA — los dos precios caerían en el mismo centavo', () => {
    const curve: PricingCurve = {
      version: 1,
      sale: {
        floorCents: 2500,
        // En $30 la venta interpola a 10000 + 1·(2000/9000) = 10000.222…
        points: [
          { marketCents: 1000, multiplierBp: 10000 },
          { marketCents: 10000, multiplierBp: 10001 },
        ],
        rounding: [{ uptoCents: null, stepCents: 500 }],
      },
      buy: { binCents: 100, points: [{ marketCents: 3000, pctBp: 10000 }] },
    };
    expect(collectCurveViolations(curve).map((e) => e.code)).toContain('BUY_ABOVE_SALE');
  });

  it('la separación se evalúa EXACTA en los nodos de AMBAS curvas (no sobre valores redondeados)', () => {
    // Nodo de compra en $30 donde la venta interpola a un racional NO entero.
    const curve: PricingCurve = {
      version: 1,
      sale: {
        floorCents: 2500,
        points: [
          { marketCents: 1000, multiplierBp: 12000 },
          { marketCents: 10000, multiplierBp: 10001 },
        ],
        rounding: [{ uptoCents: null, stepCents: 500 }],
      },
      buy: {
        binCents: 100,
        points: [
          { marketCents: 3000, pctBp: 9000 },
          { marketCents: 10000, pctBp: 10000 },
        ],
      },
    };
    // En $100 la venta vale 10001 y la compra 10000 ⇒ separación exacta de 1 ⇒ pasa.
    expect(collectCurveViolations(curve).map((e) => e.code)).not.toContain('BUY_ABOVE_SALE');
  });

  it('el seed de §N.2 conserva una separación de MILES de bp (coste práctico nulo)', () => {
    expect(collectCurveViolations(DEFAULT_PRICING_CURVE)).toEqual([]);
  });
});

// ============================================================================
// E0-ter (v2.1.4) — V9: la monotonía del eje de COMPRA, y el techo de `marketCents`.
// ============================================================================

/**
 * V5 solo iteraba `sale.points`. V6 ata la compra únicamente en RELATIVO (por debajo de la venta), así
 * que **nada impedía que el monto pagado bajara en absoluto mientras el mercado subía**. Es la misma
 * clase que I1 —«más mercado ⇒ menos dinero»— sin la amplificación de la escalera, porque la compra no
 * se redondea: no da el salto llamativo de un peldaño, solo **pierde dinero en silencio**. §N.0 aplica
 * simétricamente y con la misma dureza: pagar de menos ⇒ el vendedor no vende ⇒ carta perdida.
 */
describe('E0-ter — V9: la curva de COMPRA no puede pagar menos por más mercado (§4.36.3)', () => {
  const withBuy = (points: { marketCents: number; pctBp: number }[]): PricingCurve => {
    const c = JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
    c.buy.points = points;
    return c;
  };

  it('REGRESIÓN del techlead: `[{2500,5000},{10000,1000}]` ⇒ 422 BUY_CURVE_NOT_MONOTONIC en el tramo (0,1)', () => {
    const curve = withBuy([
      { marketCents: 2500, pctBp: 5000 },
      { marketCents: 10000, pctBp: 1000 },
    ]);
    expect(validatePricingCurve(curve)).toMatchObject({
      code: 'BUY_CURVE_NOT_MONOTONIC',
      details: { axis: 'buy', index: 0, index2: 1, marketCents: 2500, marketCentsTo: 10000 },
    });
  });

  it('y el pago que delataba el hueco: $25 ⇒ $12.50, $80 ⇒ $16.53, $100 ⇒ $10.00 (menos con MÁS mercado)', () => {
    const curve = withBuy([
      { marketCents: 2500, pctBp: 5000 },
      { marketCents: 10000, pctBp: 1000 },
    ]);
    // La matemática NO cambia (V9 valida al GUARDAR, no al resolver): se comprueba que el caso que
    // ahora se rechaza es exactamente el que pagaba de menos.
    expect(resolveBuyFromCurve(2500, curve).cents).toBe(1250);
    expect(resolveBuyFromCurve(8000, curve).cents).toBe(1653);
    expect(resolveBuyFromCurve(10000, curve).cents).toBe(1000); // ⛔ $89 más de mercado, $6.53 menos
  });

  it('el caso de QA con diales de tienda real (50 % @ $10 → 20 % @ $500): se RECHAZA', () => {
    const curve = withBuy([
      { marketCents: 1000, pctBp: 5000 },
      { marketCents: 50000, pctBp: 2000 },
    ]);
    // $410.90 pagaba $104.60 y $500.00 pagaba $100.00: con $89.10 más de valor, $4.60 menos.
    expect(resolveBuyFromCurve(41090, curve).cents).toBeGreaterThan(resolveBuyFromCurve(50000, curve).cents!);
    expect(validatePricingCurve(curve)?.code).toBe('BUY_CURVE_NOT_MONOTONIC');
  });

  it('el chequeo es de EXTREMOS, y es el DERECHO el que atrapa el caso (igual que en V5)', () => {
    // s = (1000−5000)/(10000−2500) = −0.5333…
    //   p0 + m0·s = 5000 − 1333.3 = +3666.7 ≥ 0  ✅  (el izquierdo NO lo atrapa)
    //   p1 + m1·s = 1000 − 5333.3 = −4333.3 < 0  ❌  (el derecho SÍ)
    const s = (1000 - 5000) / (10000 - 2500);
    expect(5000 + 2500 * s).toBeGreaterThanOrEqual(0);
    expect(1000 + 10000 * s).toBeLessThan(0);
  });

  it('un pct DECRECIENTE que igual paga más en absoluto es LEGÍTIMO (V9 es invariante de dinero, no de intención)', () => {
    // 50 % @ $25 → 40 % @ $500: el pct baja, pero el pago sube ($12.50 ⇒ $200). §N.1 «el pct sube» es
    // INTENCIÓN y vive como aviso NO bloqueante del previsualizador; V9 impone solo el invariante.
    const curve = withBuy([
      { marketCents: 2500, pctBp: 5000 },
      { marketCents: 50000, pctBp: 4000 },
    ]);
    expect(collectCurveViolations(curve).map((e) => e.code)).not.toContain('BUY_CURVE_NOT_MONOTONIC');
    expect(resolveBuyFromCurve(50000, curve).cents!).toBeGreaterThan(resolveBuyFromCurve(2500, curve).cents!);
  });

  /**
   * ⚠️ El caso que la spec manda cubrir EXPLÍCITAMENTE. En venta los tramos planos son crecientes
   * porque V4 garantiza `k ≥ 10000 > 0`; en compra NO hay V4 y `pctBp ∈ [0, 10000]`, así que la
   * justificación es otra: `p ≥ 0` de V3. Con `p = 0` el tramo es CONSTANTE (no decreciente) y el pago
   * se queda en el `bin`. Si alguien «simplifica» V9 copiando el razonamiento de venta, este test cae.
   */
  it('`pctBp = 0` DEBE PASAR: constante no es decreciente (la razón es `p ≥ 0` de V3, NO V4)', () => {
    const curve = withBuy([
      { marketCents: 2500, pctBp: 0 },
      { marketCents: 50000, pctBp: 0 },
    ]);
    expect(collectCurveViolations(curve).map((e) => e.code)).not.toContain('BUY_CURVE_NOT_MONOTONIC');
    // Y el pago se queda en el bin sobre todo el tramo (jamás MX$0: el `max` con el bin manda).
    expect(resolveBuyFromCurve(2500, curve).cents).toBe(DEFAULT_PRICING_CURVE.buy.binCents);
    expect(resolveBuyFromCurve(50000, curve).cents).toBe(DEFAULT_PRICING_CURVE.buy.binCents);
  });

  it('`pctBp = 0` seguido de un tramo que sube también pasa (0 → 30 % es creciente)', () => {
    const curve = withBuy([
      { marketCents: 2500, pctBp: 0 },
      { marketCents: 50000, pctBp: 3000 },
    ]);
    expect(collectCurveViolations(curve).map((e) => e.code)).not.toContain('BUY_CURVE_NOT_MONOTONIC');
  });

  it('el seed de §N.2 pasa V9 (su pct sube en todo el dominio)', () => {
    expect(collectCurveViolations(DEFAULT_PRICING_CURVE)).toEqual([]);
  });

  it('barrido: una curva que pasa V9 es monótona peso a peso en el pago', () => {
    const curve = withBuy([
      { marketCents: 1000, pctBp: 3000 },
      { marketCents: 50000, pctBp: 5000 },
    ]);
    expect(collectCurveViolations(curve)).toEqual([]);
    let prev = -1;
    for (let m = 1; m <= 600000; m++) {
      const c = resolveBuyFromCurve(m, curve).cents!;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

describe('E0-ter — V3 acota `marketCents` por ARRIBA (v2.1.4)', () => {
  it('un breakpoint de 9e9 se RECHAZA: `num` saldría del rango seguro dentro de `interpExact`', () => {
    const c = JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
    c.sale.points[1].marketCents = 9_000_000_000;
    expect(validatePricingCurve(c)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { axis: 'sale', marketCents: 9_000_000_000 },
    });
  });

  it('también en el eje de COMPRA', () => {
    const c = JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
    c.buy.points[1].marketCents = 9_000_000_000;
    expect(validatePricingCurve(c)).toMatchObject({ code: 'VALIDATION_ERROR', details: { axis: 'buy' } });
  });

  it('exactamente MAX_CENTS es válido (la cota es inclusiva, misma Int32 que todo monto del sistema)', () => {
    const c = JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
    c.sale.points[c.sale.points.length - 1].marketCents = MAX_CENTS_CURVE;
    c.buy.points[c.buy.points.length - 1].marketCents = MAX_CENTS_CURVE;
    expect(collectCurveViolations(c).filter((e) => e.blocking)).toEqual([]);
  });

  it('con la cota, `num` de `interpExact` sigue dentro de Number.MAX_SAFE_INTEGER', () => {
    // Peor caso: den ~ MAX_CENTS y salto de valor máximo (1e6 bp).
    const pts = [
      { marketCents: 0, valueBp: 1_000_000 },
      { marketCents: MAX_CENTS_CURVE, valueBp: 10_000 },
    ];
    const { num } = interpExact(pts, MAX_CENTS_CURVE - 1);
    expect(Number.isSafeInteger(num)).toBe(true);
  });
});

describe('rawCentsFromRational — ROUND_HALF_UP también con operandos NEGATIVOS (v2.1.4)', () => {
  /**
   * El docblock afirmaba «el operando es SIEMPRE ≥ 0 por construcción» y usaba `floor((2n+d)/2d)`, que
   * en BigInt trunca hacia cero. La premisa era FALSA: V3 no acota `multiplierBp` por abajo y V4 es
   * deliberadamente NO bloqueante, así que el previsualizador calcula con multiplicador negativo — es
   * justo el caso de curva rota que existe para explicar. Anti-patrón de I1 en miniatura: un atajo de
   * redondeo justificado por un invariante que no se cumple.
   */
  it('el caso de QA: `(5, -50000, 1)` es EXACTAMENTE −25, no −24 (medio alejándose de cero)', () => {
    expect(rawCentsFromRational(5, -50000, 1)).toBe(-25);
  });

  it('espeja la rama negativa de `roundHalfUp` (mismo modo fijado en el código, no en el insumo)', () => {
    expect(rawCentsFromRational(3, -5000, 1)).toBe(-2); // −1.5 ⇒ −2
    expect(rawCentsFromRational(1, -5000, 1)).toBe(-1); // −0.5 ⇒ −1
    expect(rawCentsFromRational(3, 5000, 1)).toBe(2); // +1.5 ⇒ +2 (simétrico)
    expect(roundHalfUp(-1.5)).toBe(-2);
  });

  it('el previsualizador de una curva ROTA (V4 no bloqueante) da la cifra correcta en pesos', () => {
    const broken = JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
    broken.sale.points[0].multiplierBp = -50_000; // absurdo, pero CALCULABLE ⇒ el preview lo pinta
    // V4 lo reporta, pero NO bloquea: la traza tiene que ser aritmética honesta.
    expect(collectCurveViolations(broken).map((e) => e.code)).toContain('SALE_BELOW_MARKET');
    const trace = explainSaleFromCurve(1000, broken);
    expect(trace.rawCents).toBe(-5000); // 1000 × (−50000/10000) = −5000, exacto
    // El precio cobrado NO se ve afectado: el `max` con el piso gana y el PUT rechazaría la curva.
    expect(trace.priceCents).toBe(2500);
    expect(trace.basis).toBe('floor');
  });

  it('acota por MAGNITUD en los dos signos (BE-27), sin desbordar al convertir a `number`', () => {
    expect(rawCentsFromRational(2_000_000_000, 1_000_000, 1)).toBe(MAX_CENTS_CURVE);
    expect(rawCentsFromRational(2_000_000_000, -1_000_000, 1)).toBe(-MAX_CENTS_CURVE);
  });
});

describe('DisplayBp — recomponer un monto desde el bp de display NO COMPILA (§4.36.8a, v2.1.4)', () => {
  /**
   * El techlead lo pidió como NORMA, no como convención: hasta v2.1.3 la puerta estaba cerrada por un
   * docblock («⛔ jamás como operando de un precio») y la lección de I1 es precisamente que las
   * garantías de dinero no pueden depender de que alguien recuerde una convención.
   *
   * El candado es de TIPO: `interp` y `CurveLegTrace.appliedBp` devuelven `DisplayBp`, que en runtime
   * es un `number` (el contrato no cambia) pero en compilación es opaco. Desenvolverlo exige
   * `displayBpValue`, que es explícito y **greppable**.
   */
  it('en runtime sigue siendo un número: el JSON del contrato no cambia', () => {
    const trace = explainSaleFromCurve(5000, DEFAULT_PRICING_CURVE);
    expect(typeof (trace.appliedBp as unknown)).toBe('number');
    expect(JSON.parse(JSON.stringify(trace)).appliedBp).toBe(13955);
  });

  it('la escotilla `displayBpValue` es el ÚNICO camino a un `number` (y por eso se puede auditar por grep)', () => {
    const trace = explainSaleFromCurve(5000, DEFAULT_PRICING_CURVE);
    expect(displayBpValue(trace.appliedBp!)).toBe(13955);
  });

  it('CANDADO: el `@ts-expect-error` falla si alguien vuelve a permitir la aritmética', () => {
    const trace = explainSaleFromCurve(5000, DEFAULT_PRICING_CURVE);
    // Éste es el bug que se quiere impedir: recomponer el precio desde el bp REDONDEADO (I1 literal).
    // @ts-expect-error — DisplayBp es opaco: no se puede multiplicar sin desenvolverlo a propósito.
    const reintroduceI1 = (5000 * trace.appliedBp!) / 10_000;
    // La línea de arriba no compila; en runtime se evalúa igual, y aquí se ve POR QUÉ importa: no
    // coincide con el crudo exacto (13954.5454… vs 13955).
    expect(reintroduceI1).not.toBe(explainSaleFromCurve(5000, DEFAULT_PRICING_CURVE).rawCents);
  });

  it('el crudo exacto y la recomposición desde display DIFIEREN — por eso el tipo, y no un comentario', () => {
    const trace = explainSaleFromCurve(5000, DEFAULT_PRICING_CURVE);
    const fromDisplay = roundHalfUp((5000 * displayBpValue(trace.appliedBp!)) / 10_000);
    expect(trace.rawCents).toBe(6977); // exacto: 5000 × 153500/11 / 10000
    expect(fromDisplay).toBe(6978); // con el bp redondeado: un centavo de más
  });
});
