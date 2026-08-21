import {
  BuylistRule,
  SalesRule,
  MAX_CENTS,
  computeSalePriceForRarity,
  quoteAcquisitionForFinish,
} from '../src/common/money';

/**
 * v1.28 (P-18/P-22, ARCHITECTURE §4.26b) — precedencias NORMATIVAS del resolver con controles por
 * variante (M-30), en las DOS caras del dinero:
 *  - COMPRA: bounty > override > regla > precio_pendiente (bounty/override actúan como fixed:
 *    siempre 'cotizada', no dependen de la referencia).
 *  - VENTA:  sellOverride > regla > pending (el listPriceCents POR PIEZA lo aplican los callers
 *    ANTES — paso 1 de la precedencia, fuera de la función pura).
 * Regresión: SIN controls (omitido/null) el comportamiento es EXACTAMENTE el previo.
 * Money-safe: montos <= 0 en los controles son input degenerado ⇒ se tratan como AUSENTES.
 */

const BUY_RULES: Record<string, BuylistRule> = {
  Common: { mode: 'fixed', value: 50 },
  'Illustration Rare': { mode: 'pct', value: 40 },
};
const SELL_RULES: Record<string, SalesRule> = {
  Common: { mode: 'fixed', value: 500 },
  'Illustration Rare': { mode: 'pct', value: 15 },
};

describe('COMPRA — quoteAcquisitionForFinish + controls (§4.26b)', () => {
  it('1. bounty activo GANA a override y a la regla (fixed sintético, source=bounty)', () => {
    const q = quoteAcquisitionForFinish('Common', 'normal', 10000, BUY_RULES, 40, {
      bountyEnabled: true,
      bountyPriceCents: 7500,
      buyOverrideCents: 300,
    });
    expect(q.quotedPriceCents).toBe(7500);
    expect(q.status).toBe('cotizada');
    expect(q.ruleSource).toBe('bounty');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 7500 });
  });

  it('2. buyOverride pisa la regla cuando NO hay bounty activo (source=override)', () => {
    const q = quoteAcquisitionForFinish('Common', 'normal', 10000, BUY_RULES, 40, {
      bountyEnabled: false,
      bountyPriceCents: 7500, // persistido pero APAGADO ⇒ no juega
      buyOverrideCents: 300,
    });
    expect(q.quotedPriceCents).toBe(300);
    expect(q.ruleSource).toBe('override');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 300 });
  });

  it('bounty/override NO dependen de la referencia: sin market siguen siendo `cotizada`', () => {
    const bounty = quoteAcquisitionForFinish('Illustration Rare', 'holofoil', null, BUY_RULES, 40, {
      bountyEnabled: true,
      bountyPriceCents: 250000,
    });
    expect(bounty.status).toBe('cotizada');
    expect(bounty.quotedPriceCents).toBe(250000);

    const override = quoteAcquisitionForFinish('Illustration Rare', 'holofoil', null, BUY_RULES, 40, {
      buyOverrideCents: 120000,
    });
    expect(override.status).toBe('cotizada');
    expect(override.quotedPriceCents).toBe(120000);
  });

  it('3. sin controles útiles cae a la regla de SIEMPRE (source=rule) — empate de montos incluido', () => {
    // El override VALE lo mismo que la regla: la precedencia sigue eligiendo el peldaño superior
    // (override), no el monto — la fuente reportada distingue el peldaño.
    const tie = quoteAcquisitionForFinish('Common', 'normal', 10000, BUY_RULES, 40, {
      buyOverrideCents: 50,
    });
    expect(tie.quotedPriceCents).toBe(50);
    expect(tie.ruleSource).toBe('override');

    // Sin fila (null) y omitido → idéntico al comportamiento previo (regresión).
    const byRule = quoteAcquisitionForFinish('Common', 'normal', 10000, BUY_RULES, 40, null);
    const legacy = quoteAcquisitionForFinish('Common', 'normal', 10000, BUY_RULES, 40);
    expect(byRule).toEqual(legacy);
    expect(byRule.quotedPriceCents).toBe(50);
    expect(byRule.ruleSource).toBe('rule');
  });

  it('4. pct sin referencia y sin controles → precio_pendiente (JAMÁS inventar)', () => {
    const q = quoteAcquisitionForFinish('Illustration Rare', 'holofoil', null, BUY_RULES, 40, {
      bountyEnabled: false,
      buyOverrideCents: null,
      bountyPriceCents: null,
    });
    expect(q.quotedPriceCents).toBeNull();
    expect(q.status).toBe('precio_pendiente');
    expect(q.ruleSource).toBe('rule');
  });

  it('money-safe: bounty habilitado sin precio (>0) o con precio degenerado (<=0) se IGNORA', () => {
    // enabled sin precio → cae al siguiente peldaño (override).
    const noPrice = quoteAcquisitionForFinish('Common', 'normal', 10000, BUY_RULES, 40, {
      bountyEnabled: true,
      bountyPriceCents: null,
      buyOverrideCents: 300,
    });
    expect(noPrice.quotedPriceCents).toBe(300);
    expect(noPrice.ruleSource).toBe('override');
    // bounty 0 y override 0/negativo → todo degenerado ⇒ regla.
    const degenerate = quoteAcquisitionForFinish('Common', 'normal', 10000, BUY_RULES, 40, {
      bountyEnabled: true,
      bountyPriceCents: 0,
      buyOverrideCents: -100,
    });
    expect(degenerate.quotedPriceCents).toBe(50);
    expect(degenerate.ruleSource).toBe('rule');
  });

  it('BE-27: un monto de control por encima del techo Int32 se CLAMPA al persistible', () => {
    const q = quoteAcquisitionForFinish('Common', 'normal', null, BUY_RULES, 40, {
      buyOverrideCents: MAX_CENTS + 5,
    });
    expect(q.quotedPriceCents).toBe(MAX_CENTS);
  });
});

describe('VENTA — computeSalePriceForRarity + controls (§4.26b)', () => {
  it('2. sellOverride pisa la regla (fixed sintético, ruleSource=override, siempre priced)', () => {
    const s = computeSalePriceForRarity('Common', 'normal', 10000, SELL_RULES, 15, {
      sellOverrideCents: 9900,
    });
    expect(s.salePriceCents).toBe(9900);
    expect(s.status).toBe('priced');
    expect(s.ruleSource).toBe('override');
    expect(s.appliedRule).toEqual({ mode: 'fixed', value: 9900 });
  });

  it('sellOverride NO depende del mercado: pct sin referencia + override → priced', () => {
    const s = computeSalePriceForRarity('Illustration Rare', 'holofoil', null, SELL_RULES, 15, {
      sellOverrideCents: 480000,
    });
    expect(s.salePriceCents).toBe(480000);
    expect(s.status).toBe('priced');
    expect(s.ruleSource).toBe('override');
  });

  it('3./regresión: sin controls (omitido y null) el resultado es EXACTAMENTE el previo', () => {
    const withNull = computeSalePriceForRarity('Common', 'normal', 10000, SELL_RULES, 15, null);
    const legacy = computeSalePriceForRarity('Common', 'normal', 10000, SELL_RULES, 15);
    expect(withNull).toEqual(legacy);
    expect(withNull.salePriceCents).toBe(500); // fixed piso de la regla
    expect(withNull.ruleSource).toBe('rule');
  });

  it('4. no resoluble (pct sin market, sin override) → pending/null (PRICE_PENDING aguas abajo)', () => {
    const s = computeSalePriceForRarity('Illustration Rare', 'holofoil', null, SELL_RULES, 15, {
      sellOverrideCents: null,
    });
    expect(s.salePriceCents).toBeNull();
    expect(s.status).toBe('pending');
  });

  it('money-safe: sellOverride <= 0 es degenerado ⇒ AUSENTE (cae a la regla; BE-26 remata)', () => {
    const zero = computeSalePriceForRarity('Common', 'normal', 10000, SELL_RULES, 15, {
      sellOverrideCents: 0,
    });
    expect(zero.salePriceCents).toBe(500);
    expect(zero.ruleSource).toBe('rule');
    const negative = computeSalePriceForRarity('Common', 'normal', 10000, SELL_RULES, 15, {
      sellOverrideCents: -1,
    });
    expect(negative.salePriceCents).toBe(500);
    expect(negative.ruleSource).toBe('rule');
  });

  it('los controles de COMPRA no contaminan la VENTA (y viceversa)', () => {
    // Una fila M-30 completa: la cara de venta solo mira sellOverrideCents.
    const s = computeSalePriceForRarity('Common', 'normal', 10000, SELL_RULES, 15, {
      buyOverrideCents: 111,
      bountyEnabled: true,
      bountyPriceCents: 222,
      sellOverrideCents: null,
    });
    expect(s.salePriceCents).toBe(500); // regla, no 111 ni 222
    expect(s.ruleSource).toBe('rule');
  });
});
