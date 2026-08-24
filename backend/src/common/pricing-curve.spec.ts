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
  buyPctBpAt,
  interp,
  isBountyEffective,
  marketBracketOf,
  normalizePricingCurve,
  premiumFloorGuard,
  resolveBuyFromCurve,
  resolveSaleFromCurve,
  roundHalfUp,
  roundUp,
  saleMultiplierBpAt,
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
    expect(saleMultiplierBpAt(CURVE, 5000)).toBe(13955);
    expect(buyPctBpAt(CURVE, 30000)).toBe(4500);
  });

  it('criterio 80: una Common de cientos de pesos DEJA de recibir MX$0.50 (no hay bin de bulk)', () => {
    // Mercado $400 — la rareza NO entra al cálculo: el monto sale solo del mercado.
    expect(resolveBuyFromCurve(40000, CURVE).cents).toBe(19000); // 47.5 % de $400 = $190
  });
});

describe('pricing-curve — interpolación (criterio 81: nunca escalonada)', () => {
  it('tramos planos SOLO antes del primer punto y después del último', () => {
    expect(saleMultiplierBpAt(CURVE, 0)).toBe(16000);
    expect(saleMultiplierBpAt(CURVE, 1)).toBe(16000);
    expect(saleMultiplierBpAt(CURVE, 2500)).toBe(16000);
    expect(saleMultiplierBpAt(CURVE, 8000)).toBe(11500);
    expect(saleMultiplierBpAt(CURVE, 900000)).toBe(11500);
  });

  it('DENTRO del rango el markup cambia peso a peso (no hay meseta escalonada)', () => {
    const a = saleMultiplierBpAt(CURVE, 5000);
    const b = saleMultiplierBpAt(CURVE, 5100);
    expect(b).toBeLessThan(a); // baja conforme sube el valor
    expect(a - b).toBeLessThan(200); // sin saltos bruscos entre mercados casi iguales
  });

  it('el pct de COMPRA sube conforme sube el mercado (§N.1)', () => {
    expect(buyPctBpAt(CURVE, 2500)).toBe(3000);
    expect(buyPctBpAt(CURVE, 10000)).toBe(4000);
    expect(buyPctBpAt(CURVE, 50000)).toBe(5000);
    expect(buyPctBpAt(CURVE, 5000)).toBeGreaterThan(3000);
    expect(buyPctBpAt(CURVE, 5000)).toBeLessThan(4000);
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
    expect(saleMultiplierBpAt(CURVE, 5000)).toBe(13955);
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

describe('pricing-curve — invariantes VALIDABLES del setting (§4.36.3, V1–V8)', () => {
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
    c.buy.points = [
      { marketCents: 2500, pctBp: 3_000 },
      { marketCents: 10_000, pctBp: 10_000 },
      { marketCents: 50_000, pctBp: 3_000 },
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
