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
