import {
  DEFAULT_PRICING_CURVE,
  MAX_CURVE_CONSTANT_CENTS,
  PricingCurve,
  collectCurveViolations,
  validatePricingCurve,
} from '../src/common/pricing-curve';

/**
 * E0-quater (v2.1.5, API_CONTRACT §M2) — **`details` NORMADO campo por campo. Se acabó el «…».**
 *
 * ### Por qué existe este archivo
 * El contrato decía `details: { axis, index, marketCents, … }` y dejaba **el segundo extremo del
 * tramo dentro del «…»**. Backend emitía `index2`/`marketCentsTo`; frontend declaró
 * `toIndex`/`toMarketCents` —nombres que inventó y que **nadie podía contradecir**— y el segundo
 * extremo **nunca se marcó** en el editor. No fue un fallo de V9: afectaba a
 * `SALE_CURVE_NOT_MONOTONIC` y `DUPLICATE_BREAKPOINT` **desde E9**, y la auditoría encontró cuatro
 * códigos más con el mismo hueco latente.
 *
 * **El contrato no mintió: no dijo.** Un hueco de especificación hizo el mismo daño que una
 * equivocada, con el agravante de que **ningún test de contrato podía cazarlo** — porque todos los
 * tests existentes assertaban el `code` y **nada más**.
 *
 * Éste es el test que sí lo habría cazado: assertea los **campos EXACTOS** de `details` por código.
 * Convención transversal que sale de aquí: **ningún campo que un consumidor deba leer puede vivir
 * dentro de un «…»**.
 */

const clone = (): PricingCurve => JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;

/** Campos EXACTOS que el contrato (§M2) declara por código. */
const CONTRACT_FIELDS: Record<string, string[]> = {
  VALIDATION_ERROR: ['axis', 'index', 'field'],
  CURVE_EMPTY: ['axis'],
  DUPLICATE_BREAKPOINT: ['axis', 'index', 'index2', 'marketCents'],
  SALE_BELOW_MARKET: ['axis', 'index', 'marketCents', 'multiplierBp'],
  SALE_CURVE_NOT_MONOTONIC: ['axis', 'index', 'marketCents', 'index2', 'marketCentsTo'],
  BUY_CURVE_NOT_MONOTONIC: ['axis', 'index', 'marketCents', 'index2', 'marketCentsTo'],
  BUY_ABOVE_SALE: ['marketCents', 'multiplierBp', 'pctBp'],
  BIN_ABOVE_FLOOR: ['binCents', 'floorCents'],
  ROUNDING_LADDER_INVALID: ['axis', 'bandIndex', 'uptoCents', 'stepCents'],
};

function expectContractShape(code: string, details: Record<string, unknown> | undefined) {
  expect(details).toBeDefined();
  for (const field of CONTRACT_FIELDS[code]) {
    // `toHaveProperty` y no `!= null`: un campo NORMADO tiene que ESTAR, aunque su valor sea `null`.
    expect(details).toHaveProperty(field);
  }
}

describe('§M2 — `details` por código: los campos EXACTOS que el contrato declara', () => {
  it('VALIDATION_ERROR: { axis, index, field } — el editor marca EL CAMPO inline (§21.4a)', () => {
    const c = clone();
    c.sale.points[0].multiplierBp = -5000; // v2.1.5: V3 (representabilidad) lo corta, bloqueante
    const e = validatePricingCurve(c)!;
    expect(e.code).toBe('VALIDATION_ERROR');
    expectContractShape(e.code, e.details);
    expect(e.details).toMatchObject({ axis: 'sale', index: 0, field: 'multiplierBp' });
    expect(e.blocking).toBe(true);
  });

  it('VALIDATION_ERROR: `field` distingue QUÉ campo del punto está mal', () => {
    const bad = clone();
    bad.buy.points[0].pctBp = 99_999;
    expect(validatePricingCurve(bad)!.details).toMatchObject({ axis: 'buy', field: 'pctBp' });

    const badMarket = clone();
    badMarket.sale.points[0].marketCents = -1;
    expect(validatePricingCurve(badMarket)!.details).toMatchObject({ axis: 'sale', field: 'marketCents' });
  });

  it('CURVE_EMPTY: { axis } — «La curva de {venta|compra} se quedó sin puntos»', () => {
    const c = clone();
    c.buy.points = [];
    const e = validatePricingCurve(c)!;
    expect(e.code).toBe('CURVE_EMPTY');
    expectContractShape(e.code, e.details);
    expect(e.details).toMatchObject({ axis: 'buy' });
  });

  it('DUPLICATE_BREAKPOINT: { axis, index, index2, marketCents } — marca LAS DOS filas colisionadas', () => {
    const c = clone();
    c.sale.points = [
      { marketCents: 2500, multiplierBp: 16000 },
      { marketCents: 2500, multiplierBp: 11500 },
    ];
    const e = validatePricingCurve(c)!;
    expect(e.code).toBe('DUPLICATE_BREAKPOINT');
    expectContractShape(e.code, e.details);
    // Los DOS índices, no uno: marcar una sola fila deja al dueño sin la mitad del problema.
    expect(e.details!.index).not.toBe(e.details!.index2);
    expect(e.details).toMatchObject({ axis: 'sale', marketCents: 2500 });
  });

  it('SALE_BELOW_MARKET: { axis, index, marketCents, multiplierBp } — y NO bloquea (§4.36.8a(c))', () => {
    const c = clone();
    c.sale.points[0].multiplierBp = 5000; // calculable, pero vende bajo mercado
    const v = collectCurveViolations(c).find((x) => x.code === 'SALE_BELOW_MARKET')!;
    expect(v).toBeDefined();
    expectContractShape(v.code, v.details);
    expect(v.details).toMatchObject({ axis: 'sale', index: 0, multiplierBp: 5000 });
    expect(v.blocking).toBe(false);
  });

  it('SALE_CURVE_NOT_MONOTONIC: los DOS extremos del tramo (`index2`/`marketCentsTo`)', () => {
    const c = clone();
    c.sale.points = [
      { marketCents: 1000, multiplierBp: 1_000_000 },
      { marketCents: 50000, multiplierBp: 10000 },
    ];
    const v = collectCurveViolations(c).find((x) => x.code === 'SALE_CURVE_NOT_MONOTONIC')!;
    expect(v).toBeDefined();
    expectContractShape(v.code, v.details);
    expect(v.details).toMatchObject({ axis: 'sale', index: 0, marketCents: 1000, index2: 1, marketCentsTo: 50000 });
  });

  it('BUY_CURVE_NOT_MONOTONIC: ídem en el eje de compra (V9, v2.1.4)', () => {
    const c = clone();
    c.buy.points = [
      { marketCents: 2500, pctBp: 5000 },
      { marketCents: 10000, pctBp: 1000 },
    ];
    const v = collectCurveViolations(c).find((x) => x.code === 'BUY_CURVE_NOT_MONOTONIC')!;
    expect(v).toBeDefined();
    expectContractShape(v.code, v.details);
    expect(v.details).toMatchObject({ axis: 'buy', index: 0, marketCents: 2500, index2: 1, marketCentsTo: 10000 });
  });

  /**
   * El que más importa: su copy lleva `{pct}` y `{mult}`. Sin estos campos el front tenía que
   * ADIVINARLOS o RECALCULARLOS — o sea, **interpolar en el cliente**, que es exactamente la
   * duplicación de fórmula que el `preview` existe para eliminar.
   */
  it('BUY_ABOVE_SALE: { marketCents, multiplierBp, pctBp } — el copy ya NO tiene que recalcular nada', () => {
    const c = clone();
    c.sale.points = [{ marketCents: 2500, multiplierBp: 10000 }];
    c.buy.points = [{ marketCents: 2500, pctBp: 10000 }]; // separación 0 ⇒ margen cero
    const v = collectCurveViolations(c).find((x) => x.code === 'BUY_ABOVE_SALE')!;
    expect(v).toBeDefined();
    expectContractShape(v.code, v.details);
    expect(v.details).toMatchObject({ marketCents: 2500, multiplierBp: 10000, pctBp: 10000 });
  });

  it('BUY_ABOVE_SALE: `saleIndex`/`buyIndex` por separado (el nodo puede ser de UNA sola curva)', () => {
    const c = clone();
    c.sale.points = [
      { marketCents: 2500, multiplierBp: 10000 },
      { marketCents: 50000, multiplierBp: 10000 },
    ];
    // $100 es nodo EXCLUSIVO de la curva de compra.
    c.buy.points = [
      { marketCents: 2500, pctBp: 3000 },
      { marketCents: 10000, pctBp: 10000 },
      { marketCents: 50000, pctBp: 10000 },
    ];
    const v = collectCurveViolations(c).find((x) => x.code === 'BUY_ABOVE_SALE')!;
    expect(v.details).toMatchObject({ marketCents: 10000, buyIndex: 1 });
    // No hay punto de VENTA en $100 ⇒ `saleIndex` se omite en vez de inventar un índice.
    expect(v.details).not.toHaveProperty('saleIndex');
    // Y `axis`/`index` NO viajan: serían ambiguos entre las dos caras.
    expect(v.details).not.toHaveProperty('index');
  });

  it('BIN_ABOVE_FLOOR: { binCents, floorCents } — SIN axis/index (es una pareja de constantes)', () => {
    const c = clone();
    // v2.1.9 (Q-D1): el bin debe quedar DENTRO del techo de cordura (MX$2,000) para que la infracción
    // que se ejercita sea `BIN_ABOVE_FLOOR` y no V3. Antes era `999_999`, que con el techo nuevo lo
    // corta V3 (bloqueante, `field: 'binCents'`) y este caso nunca se alcanzaba. Sigue siendo un bin
    // MUY por encima del piso de la semilla (MX$25), que es lo que el test viene a ejercitar.
    const bin = MAX_CURVE_CONSTANT_CENTS;
    c.buy.binCents = bin;
    const v = collectCurveViolations(c).find((x) => x.code === 'BIN_ABOVE_FLOOR')!;
    expect(v).toBeDefined();
    expectContractShape(v.code, v.details);
    expect(v.details).toMatchObject({ binCents: bin, floorCents: DEFAULT_PRICING_CURVE.sale.floorCents });
    expect(v.details).not.toHaveProperty('index');
    expect(v.details).not.toHaveProperty('axis');
  });

  it('ROUNDING_LADDER_INVALID: `bandIndex` (NO `index`) + uptoCents + stepCents', () => {
    const c = clone();
    c.sale.rounding = [
      { uptoCents: 20300, stepCents: 500 }, // $203 no es múltiplo de $5
      { uptoCents: 50000, stepCents: 1000 },
      { uptoCents: null, stepCents: 2500 },
    ];
    const v = collectCurveViolations(c).find((x) => x.code === 'ROUNDING_LADDER_INVALID')!;
    expect(v).toBeDefined();
    expectContractShape(v.code, v.details);
    expect(v.details).toMatchObject({ axis: 'sale', bandIndex: 0, uptoCents: 20300, stepCents: 500 });
    // `bandIndex` indexa `rounding[]`, NO `points[]`: un `index` ambiguo entre dos colecciones sería
    // el mismo hueco de especificación otra vez.
    expect(v.details).not.toHaveProperty('index');
  });

  it('la escalera ESTRUCTURALMENTE rota también nombra su banda', () => {
    const c = clone();
    c.sale.rounding = [
      { uptoCents: 20000, stepCents: 500 },
      { uptoCents: 50000, stepCents: 1000 },
    ]; // ninguna banda abierta
    const e = validatePricingCurve(c)!;
    expect(e.code).toBe('ROUNDING_LADDER_INVALID');
    expectContractShape(e.code, e.details);
    expect(e.details).toMatchObject({ bandIndex: 1 });
  });
});

/**
 * V3 y V4 eran **el mismo predicado con manejos opuestos**: V3 exigía `multiplierBp >= 10000`
 * BLOQUEANTE y V4 exige lo mismo NO bloqueante. Un `5000` era simultáneamente ambas cosas, y como V3
 * bloquea primero, **V4 nunca podía dispararse**: el previsualizador jamás podía enseñar en pesos
 * «esto vendería por debajo del mercado», que es exactamente el caso para el que se diseñó el reparto
 * 422/200. La validación existía y estaba muerta.
 */
describe('E0-quater — V4 es ALCANZABLE: V3 baja su piso a 0 (v2.1.5)', () => {
  it('`multiplierBp = 0` CALCULA (gana el piso, basis `floor`) y reporta SALE_BELOW_MARKET — NO 422', () => {
    const c = clone();
    c.sale.points = [{ marketCents: 2500, multiplierBp: 0 }];
    const violations = collectCurveViolations(c);
    // No hay NINGUNA bloqueante ⇒ el preview responde 200 y pinta el precio en pesos.
    expect(violations.filter((v) => v.blocking)).toEqual([]);
    expect(violations.map((v) => v.code)).toContain('SALE_BELOW_MARKET');
  });

  it('`multiplierBp = 0` es CALCULABLE de verdad: el piso gana y el precio sale en pesos', async () => {
    const { explainSaleFromCurve } = await import('../src/common/pricing-curve');
    const c = clone();
    c.sale.points = [{ marketCents: 2500, multiplierBp: 0 }];
    const trace = explainSaleFromCurve(100000, c);
    expect(trace.rawCents).toBe(0);
    expect(trace.basis).toBe('floor'); // el piso gana ⇒ el dueño VE por qué
    expect(trace.priceCents).toBe(2500);
  });

  it('`multiplierBp = -5000` sigue BLOQUEANDO en V3 (no es una calibración: es un error de signo)', () => {
    const c = clone();
    c.sale.points[0].multiplierBp = -5000;
    const blocking = collectCurveViolations(c).filter((v) => v.blocking);
    expect(blocking.map((v) => v.code)).toEqual(['VALIDATION_ERROR']);
  });

  it('el PUT rechaza igual las dos (V4 no bloquea el PREVIEW, pero sí impide GUARDAR)', () => {
    const zero = clone();
    zero.sale.points = [{ marketCents: 2500, multiplierBp: 0 }];
    expect(validatePricingCurve(zero)?.code).toBe('SALE_BELOW_MARKET');
    const negative = clone();
    negative.sale.points[0].multiplierBp = -5000;
    expect(validatePricingCurve(negative)?.code).toBe('VALIDATION_ERROR');
  });

  it('cada invariante en SU superficie: V3 al campo (§21.4a), V4 al resumen en pesos (§21.4)', () => {
    const belowMarket = clone();
    belowMarket.sale.points[0].multiplierBp = 5000;
    const v4 = collectCurveViolations(belowMarket).find((v) => v.code === 'SALE_BELOW_MARKET')!;
    expect(v4.blocking).toBe(false); // resumen, con precios visibles

    const outOfRange = clone();
    outOfRange.sale.points[0].multiplierBp = 2_000_000;
    const v3 = collectCurveViolations(outOfRange)[0];
    expect(v3.code).toBe('VALIDATION_ERROR');
    expect(v3.blocking).toBe(true); // campo inline
    expect(v3.details).toMatchObject({ field: 'multiplierBp' });
  });
});

describe('§M2 — un campo normado ESTÁ aunque su valor sea nulo (no se omite)', () => {
  it('VALIDATION_ERROR de una CONSTANTE (`floorCents`) trae `index: null`, no ausente', () => {
    const c = clone();
    c.sale.floorCents = -1;
    const e = validatePricingCurve(c)!;
    expect(e.code).toBe('VALIDATION_ERROR');
    // El consumidor puede leer `details.index` sin ramificar por «existe o no»: siempre está.
    expect(e.details).toHaveProperty('index');
    expect(e.details).toMatchObject({ axis: 'sale', index: null, field: 'floorCents' });
  });

  it('ídem con `binCents` en el eje de compra', () => {
    const c = clone();
    c.buy.binCents = -5;
    expect(validatePricingCurve(c)!.details).toMatchObject({ axis: 'buy', index: null, field: 'binCents' });
  });
});
