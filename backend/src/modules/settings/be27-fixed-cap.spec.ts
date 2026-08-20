import {
  FIXED_CENTS_MAX,
  isValidBuylistRule,
  isValidSalesRule,
  validateBuylistRules,
  validateSalesRules,
} from './settings.constants';

/**
 * BE-27 (money-safety) — una regla `fixed` sin cota superior deja pasar un value absurdo (p. ej. 1e12)
 * que desbordaría las columnas `*Cents` (Int32, máx 2_147_483_647) al persistir el importe cotizado.
 * Ambos validadores (venta y compra) aplican `FIXED_CENTS_MAX` y aceptan justo en el tope.
 */
describe('BE-27 — cota superior FIXED_CENTS_MAX en reglas fixed', () => {
  it('FIXED_CENTS_MAX está por debajo del techo Int32', () => {
    expect(FIXED_CENTS_MAX).toBe(100_000_000);
    expect(FIXED_CENTS_MAX).toBeLessThan(2_147_483_647);
  });

  describe('isValidSalesRule', () => {
    it('rechaza fixed > FIXED_CENTS_MAX', () => {
      expect(isValidSalesRule({ mode: 'fixed', value: FIXED_CENTS_MAX + 1 })).toBe(false);
      expect(isValidSalesRule({ mode: 'fixed', value: 1e12 })).toBe(false);
    });
    it('acepta fixed JUSTO en el tope y en 0', () => {
      expect(isValidSalesRule({ mode: 'fixed', value: FIXED_CENTS_MAX })).toBe(true);
      expect(isValidSalesRule({ mode: 'fixed', value: 0 })).toBe(true);
    });
  });

  describe('isValidBuylistRule', () => {
    it('rechaza fixed > FIXED_CENTS_MAX', () => {
      expect(isValidBuylistRule({ mode: 'fixed', value: FIXED_CENTS_MAX + 1 })).toBe(false);
      expect(isValidBuylistRule({ mode: 'fixed', value: 1e12 })).toBe(false);
    });
    it('acepta fixed JUSTO en el tope y en 0 (un fixed:0 de compra sigue siendo legítimo)', () => {
      expect(isValidBuylistRule({ mode: 'fixed', value: FIXED_CENTS_MAX })).toBe(true);
      expect(isValidBuylistRule({ mode: 'fixed', value: 0 })).toBe(true);
    });
  });

  it('los mensajes de mapa mencionan el tope', () => {
    const salesMsg = validateSalesRules({ R: { mode: 'fixed', value: FIXED_CENTS_MAX + 1 } });
    const buyMsg = validateBuylistRules({ R: { mode: 'fixed', value: FIXED_CENTS_MAX + 1 } });
    expect(salesMsg).toContain(String(FIXED_CENTS_MAX));
    expect(buyMsg).toContain(String(FIXED_CENTS_MAX));
  });
});
