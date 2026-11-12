import { adjustedUnitCents, conditionAtLeast, effectiveUnitCents, floorToPeso } from '../src/modules/supply/supply.constants';

describe('§PROV F1 — reglas de dinero (centavos enteros)', () => {
  it('precio = pct × mercado redondeado al peso hacia abajo; el fijo manda; sin mercado y sin fijo no hay precio', () => {
    expect(effectiveUnitCents({ pctBps: 7000, fixedCents: null }, 12345)).toBe(8600);
    expect(effectiveUnitCents({ pctBps: 7000, fixedCents: 9000 }, 12345)).toBe(9000);
    expect(effectiveUnitCents({ pctBps: 7000, fixedCents: null }, null)).toBeNull();
    expect(effectiveUnitCents({ pctBps: null, fixedCents: 5000 }, null)).toBe(5000);
    expect(effectiveUnitCents({ pctBps: 10000, fixedCents: null }, 12345)).toBe(12300); // jamás arriba del mercado
    expect(floorToPeso(199)).toBe(100);
  });
  it('un ajuste nunca sube y usa floor', () => {
    expect(adjustedUnitCents(7000, 8333)).toBe(5833);
    expect(adjustedUnitCents(7000, 9999)).toBeLessThan(7000);
    expect(Number.isInteger(adjustedUnitCents(1234, 3333))).toBe(true);
  });
  it('orden de estados', () => {
    expect(conditionAtLeast('NM', 'LP')).toBe(true);
    expect(conditionAtLeast('MP', 'LP')).toBe(false);
    expect(conditionAtLeast('DMG', 'DMG')).toBe(true);
  });
});
