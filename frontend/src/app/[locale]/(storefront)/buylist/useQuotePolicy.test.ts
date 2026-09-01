import { describe, it, expect } from 'vitest';
import { minimumShortfallCents } from './useQuotePolicy';

/**
 * La ÚNICA resta autorizada en el cliente (contrato §6 · criterio 132a): `mínimo − total`.
 * Se prueba sola porque de ella dependen dos cosas de dinero: la cifra que el vendedor lee y el
 * gate del botón. El borde INCLUSIVO (158a) y el fail-open no son detalles: son la regla.
 */
describe('minimumShortfallCents · la resta autorizada del cotizador', () => {
  it('devuelve el faltante cuando el total queda por debajo del mínimo', () => {
    expect(minimumShortfallCents(50000, 38000)).toBe(12000);
  });

  it('borde INCLUSIVO: exactamente el mínimo NO tiene faltante (criterio 158a)', () => {
    expect(minimumShortfallCents(50000, 50000)).toBeNull();
    expect(minimumShortfallCents(50000, 50001)).toBeNull();
  });

  it('FAIL-OPEN: sin mínimo conocido no hay faltante que pintar y nada que inventar', () => {
    expect(minimumShortfallCents(undefined, 0)).toBeNull();
    expect(minimumShortfallCents(undefined, 999999)).toBeNull();
  });

  it('carrito vacío o todo en precio pendiente (total 0): el faltante es el mínimo entero', () => {
    expect(minimumShortfallCents(50000, 0)).toBe(50000);
  });
});
