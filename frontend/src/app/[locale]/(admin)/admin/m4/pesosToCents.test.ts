import { describe, it, expect } from 'vitest';
import { pesosToCents } from './M4View';

// Cobertura del helper que alimenta el input de costo de envío (M4, v1.4-finance).
// El costo se envía a POST /admin/shipments/:id/tracking como shippingCostCents (entero ≥ 0).
describe('pesosToCents · captura de costo de envío (M4)', () => {
  it('vacío o solo espacios → null (no se envía el campo)', () => {
    expect(pesosToCents('')).toBeNull();
    expect(pesosToCents('   ')).toBeNull();
  });

  it('cero → 0 centavos (envío gratis capturado explícitamente)', () => {
    expect(pesosToCents('0')).toBe(0);
    expect(pesosToCents('0.00')).toBe(0);
  });

  it('entero de pesos → centavos', () => {
    expect(pesosToCents('150')).toBe(15_000);
  });

  it('decimales → redondeo a centavos', () => {
    expect(pesosToCents('318.00')).toBe(31_800);
    expect(pesosToCents('12.5')).toBe(1250);
    expect(pesosToCents('12.345')).toBe(1235); // redondeo al centavo más cercano
  });

  it('separador de miles con coma se ignora', () => {
    expect(pesosToCents('1,250.50')).toBe(125_050);
  });

  it('negativo se parsea (la UI lo marca inválido aparte)', () => {
    expect(pesosToCents('-5')).toBe(-500);
  });

  it('texto no numérico → null', () => {
    expect(pesosToCents('abc')).toBeNull();
    expect(pesosToCents('$100')).toBeNull();
  });
});
