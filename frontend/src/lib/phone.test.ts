import { describe, it, expect } from 'vitest';
import { normalizeMxPhone, isValidMxPhone, formatMxPhone } from './phone';

describe('normalizeMxPhone (tabla de API_CONTRACT_CELULAR §1)', () => {
  it.each([
    ['55 1234 5678', '5512345678'],
    ['+52 55-1234-5678', '5512345678'],
    ['525512345678', '5512345678'],
    ['5215512345678', '5512345678'],
    ['5212345678', '5212345678'],
  ])('%s → %s', (raw, out) => expect(normalizeMxPhone(raw)).toBe(out));

  it.each(['0000000000', '1234567890', '1555555555', 'abc', '', null, '123', 5512345678])('%s es inválido', (raw) => {
    expect(normalizeMxPhone(raw)).toBeNull();
    expect(isValidMxPhone(raw)).toBe(false);
  });

  it('formatMxPhone agrupa para mostrar', () => {
    expect(formatMxPhone('5548214739')).toBe('+52 55 4821 4739');
  });
});

/**
 * PARIDAD con `backend/test/phone-mx.spec.ts` (misma tabla, copiada; SC-2 de seguridad). Si una cambia, cambia la otra.
 * Más los casos que el servidor acepta/rechaza y la tabla del backend aún no lista.
 */
describe('paridad con el servidor', () => {
  const table: Array<[unknown, string | null]> = [
    ['55 1234 5678', '5512345678'],
    ['+52 55-1234-5678', '5512345678'],
    ['525512345678', '5512345678'],
    ['5215512345678', '5512345678'],
    ['(55) 1234.5678', '5512345678'],
    ['5212345678', '5212345678'],
    ['5512345678', '5512345678'],
    ['0000000000', null],
    ['5555555555', null],
    ['1234567890', null],
    ['0123456789', null],
    ['1555555555', null],
    ['0551234567', null],
    ['abc', null],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
    [5512345678, null],
    [{}, null],
    ['123', null],
    ['55123456789', null],
    ['55123456a8', null],
    ['+34 55 1234 5678', null],
    // Casos del servidor (`phone-mx.ts`) fuera de su tabla:
    ['+52 1 55 1234 5678', '5512345678'],
    ['+5215512345678', '5512345678'],
    ['ab5512345678', null],
    ['55 1234 5678 x', null],
  ];
  it.each(table)('%j -> %j', (raw, expected) => {
    expect(normalizeMxPhone(raw)).toBe(expected);
    expect(isValidMxPhone(raw)).toBe(expected !== null);
  });
});
