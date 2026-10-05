import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_LIST_PRICE_CENTS, marginPreview, SEALED_FINAL_PRICE_INVALIDATES } from './sealed-final-price';

/**
 * Techlead s5 D-8 — la cota del precio final es una COPIA de la del servidor. El contrato no la declara todavía
 * (solicitud al arquitecto); el ancla documental que el front consume es `DESIGN_SYSTEM §39` («`MAX_LIST_PRICE_CENTS =
 * 100_000_000`»). Si cualquiera de los dos se mueve sin el otro, esto se pone rojo.
 */
const DS_PATH = join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'docs', 'DESIGN_SYSTEM.md');

describe('MAX_LIST_PRICE_CENTS ↔ DESIGN_SYSTEM §39', () => {
  it('la cifra del front es la que cita el sistema de diseño', () => {
    const ds = readFileSync(DS_PATH, 'utf8');
    const m = /`MAX_LIST_PRICE_CENTS = ([\d_]+)`/.exec(ds);
    expect(m, 'DESIGN_SYSTEM ya no cita MAX_LIST_PRICE_CENTS').not.toBeNull();
    expect(Number(m![1].replace(/_/g, ''))).toBe(MAX_LIST_PRICE_CENTS);
  });
});

/**
 * 💰 **UX-SP-8 = parte de F-SP-7** (`DESIGN_SYSTEM §70.7`, `API_CONTRACT §M11-SP.12.5`): el margen en vivo del editor es
 * la ÚNICA cuenta de dinero del cliente (N-4) y usa la aritmética del contrato: `N = round(P·100/(100+r))`,
 * `cents = N − avg`, `bps = round(cents·10000/N)`. Los cuatro vectores son los mismos de SP-10 (backend).
 * Canarios: margen sobre `P` (`(145000,90000,16)` daría `55000`); `r` fijo en 16 (rompe el cuarto vector).
 */
describe('UX-SP-8 · marginPreview(displayCents, avgCostCents, ivaRatePct)', () => {
  it.each([
    [145000, 90000, 16, { netCents: 125000, cents: 35000, bps: 2800 }],
    [129900, 100000, 16, { netCents: 111983, cents: 11983, bps: 1070 }],
    [700, 500, 16, { netCents: 603, cents: 103, bps: 1708 }],
    [150000, 110000, 8, { netCents: 138889, cents: 28889, bps: 2080 }],
  ])('P=%i, avg=%i, r=%i', (p, avg, r, expected) => {
    expect(marginPreview(p, avg, r)).toEqual(expected);
  });

  it('sin costo o sin tasa ⇒ null (⛔ ni con un r = 16 supuesto)', () => {
    expect(marginPreview(145000, null, 16)).toBeNull();
    expect(marginPreview(145000, 90000, null)).toBeNull();
    expect(marginPreview(145000, 90000, undefined)).toBeNull();
  });

  it('costo 0 es válido: margen = N', () => {
    expect(marginPreview(116000, 0, 16)).toEqual({ netCents: 100000, cents: 100000, bps: 10000 });
  });

  it('pérdida: cents y bps negativos', () => {
    expect(marginPreview(116000, 104000, 16)).toEqual({ netCents: 100000, cents: -4000, bps: -400 });
  });
});

describe('SP-F-7 · la hoja se invalida con cualquier precio de sellado', () => {
  it("SEALED_FINAL_PRICE_INVALIDATES incluye 'sealed-price-sheet'", () => {
    expect(SEALED_FINAL_PRICE_INVALIDATES).toContain('sealed-price-sheet');
  });
});
