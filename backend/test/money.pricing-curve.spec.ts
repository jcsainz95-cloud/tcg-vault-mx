import {
  computeSalePriceFromCurve,
  quoteAcquisitionFromCurve,
  sealedPriceBasisOf,
  computeSealedSalePrice,
  MAX_CENTS,
  VariantPriceControls,
} from '../src/common/money';
import { DEFAULT_PRICING_CURVE, PricingCurve } from '../src/common/pricing-curve';

/**
 * E2 (ARCHITECTURE §4.36.11) — las DOS funciones de dinero de la curva, con `priceBasis` y las
 * precedencias de §4.36.6. Unitarios de PRECEDENCIA: override ABSOLUTO, empate ⇒ `market`, sin
 * mercado ⇒ `pending`, bounty revalidado contra la curva.
 *
 * Criterio 84 hecho tipo: ni `rarity` ni `finish` aparecen en la firma de estas funciones.
 */
const CURVE: PricingCurve = DEFAULT_PRICING_CURVE;

describe('E2 — computeSalePriceFromCurve: precedencia de VENTA (§4.36.6)', () => {
  it('sin controles: gana la CURVA (basis market) y devuelve el mercado crudo para la instrumentación', () => {
    expect(computeSalePriceFromCurve(5000, CURVE)).toEqual({
      priceCents: 7000,
      basis: 'market',
      marketMxnCents: 5000,
      curveQuoteCents: 7000,
    });
  });

  it('el PISO gana ⇒ basis floor (y por §N.7 la ficha NO muestra «Valor de mercado»)', () => {
    expect(computeSalePriceFromCurve(114, CURVE)).toMatchObject({ priceCents: 2500, basis: 'floor' });
  });

  it('EMPATE (piso == mercado × markup) ⇒ basis market (desempate fijado, §N.7)', () => {
    const curve: PricingCurve = { ...CURVE, sale: { ...CURVE.sale, floorCents: 4000 } };
    expect(computeSalePriceFromCurve(2500, curve)).toMatchObject({ priceCents: 4000, basis: 'market' });
  });

  it('sin mercado ⇒ pending y monto null: el PISO NO GANA (decisión LOCKED que corrige §N.2)', () => {
    expect(computeSalePriceFromCurve(null, CURVE)).toEqual({
      priceCents: null,
      basis: 'pending',
      marketMxnCents: null,
      curveQuoteCents: null,
    });
    expect(computeSalePriceFromCurve(0, CURVE).basis).toBe('pending');
  });

  it('sellOverrideCents gana sobre la curva ⇒ basis override', () => {
    const controls: VariantPriceControls = { sellOverrideCents: 12345 };
    expect(computeSalePriceFromCurve(5000, CURVE, controls)).toMatchObject({
      priceCents: 12345,
      basis: 'override',
    });
  });

  it('el override de VENTA es ABSOLUTO: POR DEBAJO de la curva se respeta VERBATIM (criterio 89)', () => {
    // La curva daría $70; el admin fija $30 deliberadamente ⇒ se publica en $30, NO se levanta.
    const res = computeSalePriceFromCurve(5000, CURVE, { sellOverrideCents: 3000 });
    expect(res.priceCents).toBe(3000);
    expect(res.basis).toBe('override');
    expect(res.curveQuoteCents).toBe(7000); // la curva sigue visible para el binder, pero NO manda
  });

  it('el override de VENTA es ABSOLUTO incluso POR DEBAJO DEL PISO (no se envuelve en un max)', () => {
    expect(computeSalePriceFromCurve(114, CURVE, { sellOverrideCents: 100 }).priceCents).toBe(100);
  });

  it('override SIN mercado: publica igual (no cae a pending) y el mercado crudo queda en null', () => {
    expect(computeSalePriceFromCurve(null, CURVE, { sellOverrideCents: 5000 })).toEqual({
      priceCents: 5000,
      basis: 'override',
      marketMxnCents: null,
      curveQuoteCents: null,
    });
  });

  it('un override <= 0 es input DEGENERADO ⇒ se trata como AUSENTE (H-1, jamás se vende gratis)', () => {
    expect(computeSalePriceFromCurve(5000, CURVE, { sellOverrideCents: 0 }).basis).toBe('market');
    expect(computeSalePriceFromCurve(5000, CURVE, { sellOverrideCents: -1 }).basis).toBe('market');
  });

  it('BE-27: el monto final se acota al techo Int32 (no desborda la columna al persistir)', () => {
    expect(computeSalePriceFromCurve(MAX_CENTS, CURVE).priceCents).toBe(MAX_CENTS);
    expect(computeSalePriceFromCurve(5000, CURVE, { sellOverrideCents: MAX_CENTS + 1000 }).priceCents).toBe(MAX_CENTS);
  });

  it('el basis "bounty" NUNCA aparece en el eje de VENTA (vive en compra)', () => {
    const controls: VariantPriceControls = { bountyEnabled: true, bountyPriceCents: 999999 };
    expect(computeSalePriceFromCurve(5000, CURVE, controls).basis).toBe('market');
  });
});

describe('E2 — quoteAcquisitionFromCurve: precedencia de COMPRA (§4.36.6)', () => {
  it('sin controles: gana la CURVA (basis market), SIN redondeo', () => {
    expect(quoteAcquisitionFromCurve(1234, CURVE)).toEqual({
      priceCents: 370,
      basis: 'market',
      marketMxnCents: 1234,
      curveQuoteCents: 370,
    });
  });

  it('el BIN gana ⇒ basis floor', () => {
    expect(quoteAcquisitionFromCurve(50, CURVE)).toMatchObject({ priceCents: 100, basis: 'floor' });
  });

  it('EMPATE (bin == mercado × pct) ⇒ basis market', () => {
    const curve: PricingCurve = { ...CURVE, buy: { ...CURVE.buy, binCents: 750 } };
    expect(quoteAcquisitionFromCurve(2500, curve)).toMatchObject({ priceCents: 750, basis: 'market' });
  });

  it('sin mercado ⇒ pending: el BIN NO GANA (no se cotiza; jamás MX$0)', () => {
    expect(quoteAcquisitionFromCurve(null, CURVE)).toEqual({
      priceCents: null,
      basis: 'pending',
      marketMxnCents: null,
      curveQuoteCents: null,
    });
  });

  it('buyOverrideCents gana sobre la curva ⇒ basis override', () => {
    expect(quoteAcquisitionFromCurve(10000, CURVE, { buyOverrideCents: 6000 })).toMatchObject({
      priceCents: 6000,
      basis: 'override',
    });
  });

  it('el override de COMPRA es ABSOLUTO: POR DEBAJO de la curva se paga EXACTAMENTE ese monto (criterio 89)', () => {
    // La curva pagaría $40 por un mercado de $100; el admin fija $5 a propósito ⇒ se paga $5.
    const res = quoteAcquisitionFromCurve(10000, CURVE, { buyOverrideCents: 500 });
    expect(res.priceCents).toBe(500);
    expect(res.basis).toBe('override');
    expect(res.curveQuoteCents).toBe(4000); // NO se levanta al nivel de la curva
  });

  it('override de compra SIN mercado: cotiza igual (el bounty/override no dependen de la referencia)', () => {
    expect(quoteAcquisitionFromCurve(null, CURVE, { buyOverrideCents: 2500 })).toMatchObject({
      priceCents: 2500,
      basis: 'override',
      marketMxnCents: null,
    });
  });

  it('bounty ESTRICTAMENTE mayor que la curva ⇒ gana el peldaño 1 (basis bounty)', () => {
    const controls: VariantPriceControls = { bountyEnabled: true, bountyPriceCents: 4001 };
    expect(quoteAcquisitionFromCurve(10000, CURVE, controls)).toMatchObject({
      priceCents: 4001,
      basis: 'bounty',
      curveQuoteCents: 4000,
    });
  });

  it('bounty IGUAL a la curva ⇒ DEJA DE SER BOUNTY: se paga la curva (criterio 91, empate rechazado)', () => {
    const controls: VariantPriceControls = { bountyEnabled: true, bountyPriceCents: 4000 };
    const res = quoteAcquisitionFromCurve(10000, CURVE, controls);
    expect(res.priceCents).toBe(4000);
    expect(res.basis).toBe('market'); // NUNCA "bounty"
  });

  it('bounty POR DEBAJO de la curva ⇒ deja de ser bounty y se paga la curva (más alta)', () => {
    const controls: VariantPriceControls = { bountyEnabled: true, bountyPriceCents: 100 };
    const res = quoteAcquisitionFromCurve(10000, CURVE, controls);
    expect(res.priceCents).toBe(4000);
    expect(res.basis).toBe('market');
  });

  it('bounty rebasado + override presente ⇒ cae al OVERRIDE (se salta solo el peldaño 1)', () => {
    const controls: VariantPriceControls = {
      bountyEnabled: true,
      bountyPriceCents: 100,
      buyOverrideCents: 6000,
    };
    expect(quoteAcquisitionFromCurve(10000, CURVE, controls)).toMatchObject({
      priceCents: 6000,
      basis: 'override',
    });
  });

  it('bounty con la curva SIN resolver ⇒ el bounty explícito manda (es donde más se necesita)', () => {
    const controls: VariantPriceControls = { bountyEnabled: true, bountyPriceCents: 5000 };
    expect(quoteAcquisitionFromCurve(null, CURVE, controls)).toMatchObject({
      priceCents: 5000,
      basis: 'bounty',
      curveQuoteCents: null,
    });
  });

  it('bounty apagado (`enabled:false`) o sin precio ⇒ no aplica aunque el monto exista', () => {
    expect(quoteAcquisitionFromCurve(10000, CURVE, { bountyEnabled: false, bountyPriceCents: 999999 }).basis).toBe(
      'market',
    );
    expect(quoteAcquisitionFromCurve(10000, CURVE, { bountyEnabled: true, bountyPriceCents: 0 }).basis).toBe('market');
    expect(quoteAcquisitionFromCurve(10000, CURVE, { bountyEnabled: true, bountyPriceCents: null }).basis).toBe(
      'market',
    );
  });
});

describe('E2 — la curva NO depende de la rareza ni del acabado (criterios 83/84)', () => {
  it('dos variantes de acabado distinto con el MISMO mercado producen el MISMO precio', () => {
    // No hay parámetro `finish`: es imposible que el monto difiera por acabado.
    const a = computeSalePriceFromCurve(6000, CURVE);
    const b = computeSalePriceFromCurve(6000, CURVE);
    expect(a.priceCents).toBe(b.priceCents);
    expect(quoteAcquisitionFromCurve(6000, CURVE).priceCents).toBe(quoteAcquisitionFromCurve(6000, CURVE).priceCents);
  });

  it('dos cartas de rarezas muy distintas con el mismo mercado cotizan IDÉNTICO', () => {
    // Una Common de $400 y una Secret Rare de $400 reciben lo mismo: el monto sale solo del mercado.
    expect(quoteAcquisitionFromCurve(40000, CURVE).priceCents).toBe(19000);
    expect(computeSalePriceFromCurve(40000, CURVE).priceCents).toBe(46000);
  });
});

describe('E2 — sellado: la matemática NO cambia, solo gana priceBasis DERIVADO (§4.36.7a, criterio 85)', () => {
  const spreads = { box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 };

  it('override ⇒ priceBasis override (y el monto es el mismo de siempre)', () => {
    const r = computeSealedSalePrice(90000, 'etb', 50000, spreads, 25);
    expect(r.salePriceCents).toBe(90000);
    expect(sealedPriceBasisOf(r)).toBe('override');
  });

  it('spread por presentación ⇒ priceBasis market', () => {
    const r = computeSealedSalePrice(null, 'etb', 50000, spreads, 25);
    expect(r.salePriceCents).toBe(61000); // 500 × 1.22 — IDÉNTICO a antes de v2.0
    expect(sealedPriceBasisOf(r)).toBe('market');
  });

  it('spread global ⇒ priceBasis market', () => {
    const r = computeSealedSalePrice(null, null, 50000, spreads, 25);
    expect(r.salePriceCents).toBe(62500);
    expect(sealedPriceBasisOf(r)).toBe('market');
  });

  it('sin precio ⇒ priceBasis pending', () => {
    const r = computeSealedSalePrice(null, 'etb', null, spreads, 25);
    expect(r.salePriceCents).toBeNull();
    expect(sealedPriceBasisOf(r)).toBe('pending');
  });
});
