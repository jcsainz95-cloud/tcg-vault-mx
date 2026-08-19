import { computeSealedSalePrice } from '../src/common/money';

/**
 * v1.23-sealed-sales (ARCHITECTURE §4.23b) — precedencia money-safe del precio de venta del SELLADO:
 *   override > mercado×spread(subtype) > mercado×spread(global) > PRICE_PENDING (no publicable).
 * `pct` = markup ARRIBA de mercado. La condición NO altera el precio (el spread es por presentación).
 */
describe('computeSealedSalePrice — precedencia override > subtype > global > pending', () => {
  const SPREADS = { box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 };
  const FALLBACK = 25;

  it('override manual GANA siempre (aunque haya mercado y spread)', () => {
    const r = computeSealedSalePrice(99900, 'box', 500000, SPREADS, FALLBACK);
    expect(r).toEqual({ salePriceCents: 99900, status: 'priced', source: 'override', appliedSpreadPct: null });
  });

  it('override gana incluso SIN mercado (sellado no mapeado)', () => {
    const r = computeSealedSalePrice(45000, 'etb', null, SPREADS, FALLBACK);
    expect(r.salePriceCents).toBe(45000);
    expect(r.source).toBe('override');
  });

  it('sin override: mercado × spread de SU presentación (box 18%)', () => {
    const r = computeSealedSalePrice(null, 'box', 100000, SPREADS, FALLBACK);
    expect(r).toEqual({ salePriceCents: 118000, status: 'priced', source: 'subtype_spread', appliedSpreadPct: 18 });
  });

  it('sin override: cada presentación aplica SU spread (blister 35%)', () => {
    const r = computeSealedSalePrice(null, 'blister', 100000, SPREADS, FALLBACK);
    expect(r.salePriceCents).toBe(135000);
    expect(r.appliedSpreadPct).toBe(35);
  });

  it('sin subtype → spread GLOBAL de respaldo (25%)', () => {
    const r = computeSealedSalePrice(null, null, 100000, SPREADS, FALLBACK);
    expect(r).toEqual({ salePriceCents: 125000, status: 'priced', source: 'global_spread', appliedSpreadPct: 25 });
  });

  it('subtype presente pero SIN regla en el mapa → spread global (25%)', () => {
    const r = computeSealedSalePrice(null, 'tin', 100000, { box: 18 }, FALLBACK);
    expect(r.source).toBe('global_spread');
    expect(r.salePriceCents).toBe(125000);
  });

  it('MONEY-SAFE: sin override y sin mercado → pending (no publicable, NUNCA se inventa precio)', () => {
    const r = computeSealedSalePrice(null, 'box', null, SPREADS, FALLBACK);
    expect(r).toEqual({ salePriceCents: null, status: 'pending', source: 'subtype_spread', appliedSpreadPct: 18 });
  });

  it('MONEY-SAFE sin subtype ni mercado → pending con source global', () => {
    const r = computeSealedSalePrice(null, null, null, SPREADS, FALLBACK);
    expect(r.status).toBe('pending');
    expect(r.salePriceCents).toBeNull();
    expect(r.source).toBe('global_spread');
  });

  it('spread 0 (promo) vende a mercado sin margen (SUP-8, permitido)', () => {
    const r = computeSealedSalePrice(null, 'box', 100000, { box: 0 }, FALLBACK);
    expect(r.salePriceCents).toBe(100000);
    expect(r.appliedSpreadPct).toBe(0);
  });

  it('redondea a centavos (Math.round)', () => {
    // 100003 × 1.185 = 118503.555 → 118504
    const r = computeSealedSalePrice(null, null, 100003, {}, 18.5);
    expect(r.salePriceCents).toBe(118504);
  });

  // H-1 (v1.24): REGLA ÚNICA DE OVERRIDE — un override presente ⇔ `> 0`. Un override `<= 0` es
  // input DEGENERADO y se trata como AUSENTE (cae a mercado×spread; sin mercado → pending). Money-safe:
  // nunca se cobra un sellado gratis ni por debajo de mercado por un override mal capturado.
  it('override 0 es DEGENERADO → se ignora, cae a mercado×spread (NO cobra gratis)', () => {
    const r = computeSealedSalePrice(0, 'box', 100000, SPREADS, FALLBACK);
    expect(r.source).toBe('subtype_spread');
    expect(r.salePriceCents).toBe(118000); // 100000 × 1.18, NO 0
  });

  it('override 0 SIN mercado → pending (money-safe, no publicable), NO cobra 0', () => {
    const r = computeSealedSalePrice(0, 'box', null, SPREADS, FALLBACK);
    expect(r.status).toBe('pending');
    expect(r.salePriceCents).toBeNull();
  });

  it('override NEGATIVO es DEGENERADO → se ignora, cae a mercado×spread', () => {
    const r = computeSealedSalePrice(-500, 'box', 100000, SPREADS, FALLBACK);
    expect(r.source).toBe('subtype_spread');
    expect(r.salePriceCents).toBe(118000);
  });

  it('override POSITIVO (1 centavo) sí gana (presente ⇔ > 0)', () => {
    const r = computeSealedSalePrice(1, 'box', 100000, SPREADS, FALLBACK);
    expect(r.source).toBe('override');
    expect(r.salePriceCents).toBe(1);
  });
});
