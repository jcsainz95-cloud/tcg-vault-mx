import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_LIST_PRICE_CENTS } from './sealed-final-price';

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
