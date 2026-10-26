/**
 * discounts.pure.spec.ts — 💰 códigos de descuento, la parte PURA (API_CONTRACT §DSC.2–§DSC.4, §DSC.8; pruebas DCO-B1,
 * DCO-B2 y la mitad pura de DCO-B4/DCO-B17). Propiedad: backend. Deterministas (N=1 dicho como tal).
 *
 *  DCO-B1 `allocateDiscount`: 1, 2, 3 y 7 líneas con precios primos ⇒ Σ q·u = D, toda unidad ≥ 1, no elegibles en 0;
 *         33333/33333/33334 ⇒ 3333/3333/3334; energías 3×1000 con 1000 ⇒ D = 999; P = 2·10⁹ con 100 % sin pérdida (BigInt).
 *  DCO-B2 `discountOf` + el cálculo: 891, 893, 894, 904, 919.
 *  DCO-B4 (puro) umbral sobre S', envío gratis ⇒ E = 0 y shippingWaivedCents = E_clase, NO_SHIPPING, LARGE_BOX,
 *         ALREADY_FREE_SHIPPING; I-2: el desglose es LA MISMA llamada con S'.
 *  DCO-B17 (puro) el retiro solo acepta envío gratis sin filtros.
 */
import {
  DiscountCartLine,
  DiscountTerms,
  allocateDiscount,
  computeCartBreakdown,
  computeDirectShipBreakdown,
  discountOf,
} from '../src/common/money';
import {
  DISCOUNT_MIN_TOTAL_CENTS,
  priceDirectShipCartWithCode,
  priceVaultCartWithCode,
  withdrawalCodeOutcome,
} from '../src/modules/discounts/discount-pricing';
import { StripeService } from '../src/modules/payments/stripe.service';
import { normalizeDiscountCode } from '../src/modules/discounts/discounts.service';
import type { BoxChoice } from '../src/modules/orders/box-fit';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const DIALS = { cardsFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000 };

const terms = (t: Partial<DiscountTerms> & Pick<DiscountTerms, 'kind'>): DiscountTerms => ({
  percentPct: null,
  amountCents: null,
  maxDiscountCents: null,
  minSubtotalCents: null,
  productScopes: [],
  destinations: [],
  ...t,
});
const piece = (id: string, P: number, type: 'raw' | 'graded' | 'sealed' = 'raw'): DiscountCartLine => ({ id, group: 'piece', type, unitPriceCents: P, quantity: 1 });
const accessory = (id: string, P: number, q: number): DiscountCartLine => ({ id, group: 'accessory', type: 'accessory', unitPriceCents: P, quantity: q });
const bundle = (id: string, P: number): DiscountCartLine => ({ id, group: 'bundle', type: 'energy_bundle', unitPriceCents: P, quantity: 1 });

/** Las comprobaciones de DCO-B1 que valen para CUALQUIER reparto. */
function assertAllocation(lines: DiscountCartLine[], D0: number) {
  const r = allocateDiscount(lines, D0);
  const sum = lines.reduce((s, l) => s + l.quantity * (r.unitDiscountCents.get(l.id) ?? 0), 0);
  expect(sum).toBe(r.discountCents);
  expect(r.discountCents).toBeLessThanOrEqual(D0);
  for (const l of lines) {
    const u = r.unitDiscountCents.get(l.id) ?? 0;
    expect(u).toBeGreaterThanOrEqual(0);
    expect(l.unitPriceCents - u).toBeGreaterThanOrEqual(1);
  }
  return r;
}

describe('DCO-B1 — allocateDiscount: reparto por unidad al centavo (§DSC.3)', () => {
  const PRIMES = [10007, 20011, 30011, 40009, 50021, 60013, 70001];

  it.each([1, 2, 3, 7])('%i línea(s) con precios primos y 10 %% ⇒ Σ q·u = D exacto, toda unidad ≥ 1 centavo', (n) => {
    const lines = PRIMES.slice(0, n).map((P, i) => piece(`p${i}`, P));
    const d = discountOf(lines, terms({ kind: 'percent', percentPct: 10 }), { destination: 'vault' });
    if (!d.ok) throw new Error('fixture');
    const r = assertAllocation(lines, d.nominalCents);
    // Con q = 1 en todas, el residuo siempre cabe ⇒ D = D0 (nunca menos).
    expect(r.discountCents).toBe(d.nominalCents);
  });

  it('7 líneas con monto fijo primo (12347) ⇒ Σ q·u = 12347', () => {
    const lines = PRIMES.map((P, i) => piece(`p${i}`, P));
    const d = discountOf(lines, terms({ kind: 'fixed_amount', amountCents: 12347 }), { destination: 'vault' });
    if (!d.ok) throw new Error('fixture');
    expect(assertAllocation(lines, d.nominalCents).discountCents).toBe(12347);
  });

  it('33333 + 33333 + 33334 con MX$100.00 fijo ⇒ 3333 + 3333 + 3334 (residuo a la línea de mayor resto)', () => {
    const lines = [piece('a', 33333), piece('b', 33333), piece('c', 33334)];
    const r = assertAllocation(lines, 10000);
    expect([r.unitDiscountCents.get('a'), r.unitDiscountCents.get('b'), r.unitDiscountCents.get('c')]).toEqual([3333, 3333, 3334]);
    expect(r.discountCents).toBe(10000);
  });

  it('3 energías de 1000 con MX$10.00 fijo ⇒ u = 333, D = 999 (R = 1 no cabe en q = 3)', () => {
    const lines = [accessory('e', 1000, 3)];
    const d = discountOf(lines, terms({ kind: 'fixed_amount', amountCents: 1000 }), { destination: 'direct_ship' });
    if (!d.ok) throw new Error('fixture');
    const r = assertAllocation(lines, d.nominalCents);
    expect(r.unitDiscountCents.get('e')).toBe(333);
    expect(r.discountCents).toBe(999);
  });

  it('P = 2·10⁹ (dos líneas) con 100 % ⇒ cada unidad cobra 1 centavo, D exacto (BigInt: D0·P ≈ 8·10¹⁸ > 2⁵³)', () => {
    const lines = [piece('a', 2_000_000_000), piece('b', 2_000_000_000)];
    const d = discountOf(lines, terms({ kind: 'percent', percentPct: 100 }), { destination: 'vault' });
    if (!d.ok) throw new Error('fixture');
    expect(d.nominalCents).toBe(4_000_000_000 - 2); // I-4: B − U
    const r = assertAllocation(lines, d.nominalCents);
    expect(r.unitDiscountCents.get('a')).toBe(1_999_999_999);
    expect(r.unitDiscountCents.get('b')).toBe(1_999_999_999);
  });

  it('el tope Pᵢ − 1 muerde: [1, 1000] con 100 % ⇒ la línea de 1 centavo NO recibe el residuo (sigue cobrando 1)', () => {
    const lines = [piece('a', 1), piece('b', 1000)];
    const d = discountOf(lines, terms({ kind: 'percent', percentPct: 100 }), { destination: 'vault' });
    if (!d.ok) throw new Error('fixture');
    expect(d.nominalCents).toBe(999);
    const r = assertAllocation(lines, d.nominalCents);
    // `a` tiene el mayor resto (999) pero no puede bajar de 1 centavo ⇒ el residuo va a `b`.
    expect([r.unitDiscountCents.get('a'), r.unitDiscountCents.get('b')]).toEqual([0, 999]);
    expect(r.discountCents).toBe(999);
  });

  it('las no elegibles quedan fuera del reparto (paquete de energías ⇒ 0)', () => {
    const lines = [piece('p', 50000), bundle('b', 2000)];
    const d = discountOf(lines, terms({ kind: 'percent', percentPct: 10 }), { destination: 'direct_ship' });
    if (!d.ok) throw new Error('fixture');
    const r = allocateDiscount(d.eligible, d.nominalCents);
    expect(r.unitDiscountCents.has('b')).toBe(false);
    expect(r.unitDiscountCents.get('p')).toBe(5000);
  });

  it('el orden canónico no depende del orden de entrada (piezas por id asc, luego accesorios)', () => {
    const a = [piece('z', 33334), accessory('acc', 33333, 1), piece('a', 33333)];
    const b = [accessory('acc', 33333, 1), piece('a', 33333), piece('z', 33334)];
    const ra = allocateDiscount(a, 10000);
    const rb = allocateDiscount(b, 10000);
    expect([...ra.unitDiscountCents.entries()].sort()).toEqual([...rb.unitDiscountCents.entries()].sort());
  });
});

describe('DCO-B2 — discountOf y el monto (§DSC.2)', () => {
  it('891: 10 % de 100000 ⇒ 10000', () => {
    const p = priceVaultCartWithCode([piece('a', 100000)], terms({ kind: 'percent', percentPct: 10 }), 16, FEE);
    expect(p.outcome).toBe('applied');
    if (p.outcome !== 'applied') return;
    expect(p.discountCents).toBe(10000);
    expect(p.breakdown.subtotalCents).toBe(90000);
  });

  it('893: monto fijo 15000 sobre 100000 ⇒ 85000 de mercancía', () => {
    const p = priceVaultCartWithCode([piece('a', 100000)], terms({ kind: 'fixed_amount', amountCents: 15000 }), 16, FEE);
    if (p.outcome !== 'applied') throw new Error(JSON.stringify(p));
    expect(p.breakdown.subtotalCents).toBe(85000);
  });

  it('893 (segunda frase, §DSC.12): un monto fijo que cubre todo lo elegible deja 1 centavo por unidad (I-4)', () => {
    const d = discountOf([piece('a', 10000)], terms({ kind: 'fixed_amount', amountCents: 50000 }), { destination: 'direct_ship' });
    if (!d.ok) throw new Error('fixture');
    expect(d.nominalCents).toBe(9999);
  });

  it('894: 20 % con tope 30000 sobre 200000 ⇒ 30000', () => {
    const d = discountOf([piece('a', 200000)], terms({ kind: 'percent', percentPct: 20, maxDiscountCents: 30000 }), { destination: 'vault' });
    expect(d).toMatchObject({ ok: true, nominalCents: 30000 });
  });

  it('904: mínimo 200000 inclusivo — B = 200000 aplica; 199999 ⇒ MIN_SUBTOTAL { missingCents: 1 }', () => {
    const t = terms({ kind: 'percent', percentPct: 10, minSubtotalCents: 200000 });
    expect(discountOf([piece('a', 200000)], t, { destination: 'vault' })).toMatchObject({ ok: true, nominalCents: 20000 });
    expect(discountOf([piece('a', 199999)], t, { destination: 'vault' })).toEqual({
      ok: false,
      reason: 'MIN_SUBTOTAL',
      // v1.110.3 (§DSC.6 `details` mínimos, pentest DSC-1): solo `missingCents` (antes también `minSubtotalCents`).
      details: { missingCents: 1 },
    });
  });

  it('[D7] el mínimo se mide ANTES del descuento: 105000 con 10 % y mínimo 100000 ⇒ aplica', () => {
    expect(discountOf([piece('a', 105000)], terms({ kind: 'percent', percentPct: 10, minSubtotalCents: 100000 }), { destination: 'vault' }).ok).toBe(true);
  });

  it('919: 50000 de cartas + paquete 2000 con 10 % ⇒ D = 5000 y el paquete queda en 2000', () => {
    const p = priceDirectShipCartWithCode(
      [piece('a', 50000), bundle('b', 2000)],
      terms({ kind: 'percent', percentPct: 10 }),
      { kind: 'sealed', dials: DIALS, choice: null },
      16,
      FEE,
    );
    if (p.outcome !== 'applied') throw new Error(JSON.stringify(p));
    expect(p.discountCents).toBe(5000);
    expect(p.unitDiscountCents.get('b') ?? 0).toBe(0);
    expect(p.breakdown.subtotalCents).toBe(50000 + 2000 - 5000);
  });

  it('919: código solo `accessory` con el paquete como único accesorio ⇒ NO_ELIGIBLE_ITEMS', () => {
    const d = discountOf([piece('a', 50000), bundle('b', 2000)], terms({ kind: 'percent', percentPct: 10, productScopes: ['accessory'] }), { destination: 'direct_ship' });
    expect(d).toEqual({ ok: false, reason: 'NO_ELIGIBLE_ITEMS', details: { productScopes: ['accessory'] } });
  });

  it('filtro por destino ⇒ DESTINATION', () => {
    const d = discountOf([piece('a', 50000)], terms({ kind: 'percent', percentPct: 10, destinations: ['direct_ship'] }), { destination: 'vault' });
    // v1.110.3 (§DSC.6): `DESTINATION` se pinta por pantalla ⇒ `details: {}` (antes `{ destinations }`).
    expect(d).toEqual({ ok: false, reason: 'DESTINATION', details: {} });
  });

  it('TOTAL_BELOW_MINIMUM: el total con descuento bajo MX$10.00 no acepta el código (no se recorta)', () => {
    expect(DISCOUNT_MIN_TOTAL_CENTS).toBe(StripeService.MIN_CHARGE_CENTS);
    const p = priceVaultCartWithCode([piece('a', 2000)], terms({ kind: 'fixed_amount', amountCents: 1500 }), 16, FEE);
    expect(p).toEqual({ outcome: 'not_applicable', reason: 'TOTAL_BELOW_MINIMUM', details: { minTotalCents: 1000 } });
  });

  it('normalizeDiscountCode: trim + mayúsculas; vacío ⇒ ausente', () => {
    expect(normalizeDiscountCode('  verano-10 ')).toBe('VERANO-10');
    expect(normalizeDiscountCode('   ')).toBeNull();
    expect(normalizeDiscountCode(undefined)).toBeNull();
  });
});

describe('DCO-B4 (puro) — umbral sobre S′ y envío gratis (§DSC.4)', () => {
  const ship = (kind: 'cards_only' | 'sealed', choice: BoxChoice | null = null) => ({ kind, dials: DIALS, choice });

  it('895: 420000 con 10 % ⇒ S′ = 378000 ⇒ E = 10000 (sale del umbral)', () => {
    const p = priceDirectShipCartWithCode([piece('a', 420000)], terms({ kind: 'percent', percentPct: 10 }), ship('cards_only'), 16, FEE);
    if (p.outcome !== 'applied') throw new Error(JSON.stringify(p));
    expect(p.breakdown.subtotalCents).toBe(378000);
    expect(p.breakdown.shippingFeeCents).toBe(10000);
    // I-2: la MISMA llamada de hoy con S′ y la E resultante.
    expect(p.breakdown).toEqual(computeDirectShipBreakdown(378000, 10000, 16, FEE));
  });

  it('895: 450000 con 10 % ⇒ S′ = 405000 ⇒ E = 0', () => {
    const p = priceDirectShipCartWithCode([piece('a', 450000)], terms({ kind: 'percent', percentPct: 10 }), ship('cards_only'), 16, FEE);
    if (p.outcome !== 'applied') throw new Error(JSON.stringify(p));
    expect(p.breakdown).toEqual(computeDirectShipBreakdown(405000, 0, 16, FEE));
  });

  it('envío gratis en cartas a domicilio ⇒ E = 0 y shippingWaivedCents = 10000; desglose = la llamada de hoy con E = 0', () => {
    const p = priceDirectShipCartWithCode([piece('a', 50000)], terms({ kind: 'free_shipping' }), ship('cards_only'), 16, FEE);
    if (p.outcome !== 'applied') throw new Error(JSON.stringify(p));
    expect(p.discountCents).toBe(0);
    expect(p.shippingWaivedCents).toBe(10000);
    expect(p.freeShippingByCode).toBe(true);
    expect(p.breakdown).toEqual(computeDirectShipBreakdown(50000, 0, 16, FEE));
  });

  it('envío gratis en sellado ⇒ shippingWaivedCents = 17500', () => {
    const p = priceDirectShipCartWithCode([piece('a', 50000, 'sealed')], terms({ kind: 'free_shipping' }), ship('sealed'), 16, FEE);
    expect(p).toMatchObject({ outcome: 'applied', shippingWaivedCents: 17500 });
  });

  it('envío gratis a bóveda ⇒ NO_SHIPPING', () => {
    expect(priceVaultCartWithCode([piece('a', 50000)], terms({ kind: 'free_shipping' }), 16, FEE)).toEqual({ outcome: 'not_applicable', reason: 'NO_SHIPPING', details: {} });
  });

  it('caja grande de 35000 ⇒ LARGE_BOX (la caja se cobra completa)', () => {
    const choice = { box: { code: 'XL', label: 'XL', customerFeeCents: 35000 }, review: false } as unknown as BoxChoice;
    expect(priceDirectShipCartWithCode([accessory('x', 5000, 1)], terms({ kind: 'free_shipping' }), ship('sealed', choice), 16, FEE)).toEqual({
      outcome: 'not_applicable',
      reason: 'LARGE_BOX',
      details: {},
    });
  });

  it('S ≥ T ya ⇒ ALREADY_FREE_SHIPPING', () => {
    expect(priceDirectShipCartWithCode([piece('a', 400000)], terms({ kind: 'free_shipping' }), ship('cards_only'), 16, FEE)).toEqual({
      outcome: 'not_applicable',
      reason: 'ALREADY_FREE_SHIPPING',
      details: {},
    });
  });

  it('I-2 en bóveda: el desglose con descuento ES computeCartBreakdown(S′)', () => {
    const p = priceVaultCartWithCode([piece('a', 100000), piece('b', 50000)], terms({ kind: 'percent', percentPct: 10 }), 16, FEE);
    if (p.outcome !== 'applied') throw new Error(JSON.stringify(p));
    expect(p.breakdown).toEqual(computeCartBreakdown(135000, 16, FEE));
    // 902: cobrados 90000 y 45000.
    expect(p.unitDiscountCents.get('a')).toBe(10000);
    expect(p.unitDiscountCents.get('b')).toBe(5000);
  });
});

describe('DCO-B17 (puro) — el retiro solo acepta envío gratis sin filtros (§DSC.8)', () => {
  it('envío gratis ⇒ aplica y perdona la tarifa de hoy (20300)', () => {
    expect(withdrawalCodeOutcome(terms({ kind: 'free_shipping' }), 20300)).toEqual({ outcome: 'applied', shippingWaivedCents: 20300 });
    expect(withdrawalCodeOutcome(terms({ kind: 'free_shipping', destinations: ['direct_ship'] }), 20300).outcome).toBe('applied');
  });
  it('% o monto ⇒ WITHDRAWAL_ONLY_FREE_SHIPPING; mínimo o tipos ⇒ WITHDRAWAL_FILTERED', () => {
    expect(withdrawalCodeOutcome(terms({ kind: 'percent', percentPct: 10 }), 20300)).toMatchObject({ reason: 'WITHDRAWAL_ONLY_FREE_SHIPPING' });
    expect(withdrawalCodeOutcome(terms({ kind: 'fixed_amount', amountCents: 100 }), 20300)).toMatchObject({ reason: 'WITHDRAWAL_ONLY_FREE_SHIPPING' });
    expect(withdrawalCodeOutcome(terms({ kind: 'free_shipping', minSubtotalCents: 1 }), 20300)).toMatchObject({ reason: 'WITHDRAWAL_FILTERED' });
    expect(withdrawalCodeOutcome(terms({ kind: 'free_shipping', productScopes: ['raw'] }), 20300)).toMatchObject({ reason: 'WITHDRAWAL_FILTERED' });
  });
});
