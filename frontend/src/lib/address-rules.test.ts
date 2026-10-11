import { describe, it, expect } from 'vitest';
import {
  isMxPhone,
  isPostalCode,
  LINE2_MAX,
  matchNeighborhood,
  normalizeColonia,
  normalizeMxPhone,
  REFERENCES_MAX,
} from './address-rules';

/**
 * Fase C (`API_CONTRACT §M4-SHIP.19.5`) + errata v1.80.12.3 (§19.23.4): las cotas de forma que
 * comparten libreta, invitado y «Capturar guía».
 */
describe('address-rules · cotas de la fase C', () => {
  it('CP de 5 dígitos y teléfono de 10 (tras quitar separadores y lada 52/521)', () => {
    expect(isPostalCode('44100')).toBe(true);
    expect(isPostalCode('4410')).toBe(false);
    expect(isPostalCode('441000')).toBe(false);
    expect(isMxPhone('33 1234 5678')).toBe(true);
    expect(isMxPhone('+52 33 1234 5678')).toBe(true);
    expect(isMxPhone('331234567')).toBe(false);
    expect(normalizeMxPhone('+521 55 4017 0606')).toBe('5540170606');
  });

  it('references ≤ 70 y line2 0..200 (el 0..120 de §19.20.1 era de transcripción)', () => {
    expect(REFERENCES_MAX).toBe(70);
    expect(LINE2_MAX).toBe(200);
  });

  it('normalizeColonia = la del servidor: sin acentos, espacios colapsados, mayúsculas', () => {
    expect(normalizeColonia('  jardines   de la  montaña ')).toBe('JARDINES DE LA MONTANA');
    expect(normalizeColonia('Juárez')).toBe(normalizeColonia('JUAREZ'));
  });

  it('matchNeighborhood devuelve la grafía CANÓNICA de la lista, o vacío si no está', () => {
    const list = ['Juárez', 'Roma Norte'];
    expect(matchNeighborhood('juarez', list)).toBe('Juárez');
    expect(matchNeighborhood(' roma  norte', list)).toBe('Roma Norte');
    expect(matchNeighborhood('Centro', list)).toBe('');
    expect(matchNeighborhood('', list)).toBe('');
    expect(matchNeighborhood(null, list)).toBe('');
  });
});
