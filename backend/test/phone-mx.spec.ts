import { isValidMxPhone, maskPhone, normalizeMxPhone, assertValidPhone } from '../src/modules/users/phone-mx';

/** §CELULAR (API_CONTRACT_CELULAR §1): tabla compartida con `frontend/src/lib/phone.ts`. */
describe('normalizeMxPhone', () => {
  const table: Array<[unknown, string | null]> = [
    ['55 1234 5678', '5512345678'],
    ['+52 55-1234-5678', '5512345678'],
    ['525512345678', '5512345678'],
    ['5215512345678', '5512345678'],
    ['(55) 1234.5678', '5512345678'],
    ['5212345678', '5212345678'], // 10 dígitos que empiezan en 52: no se recorta
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
  ];
  it.each(table)('%j -> %j', (raw, expected) => {
    expect(normalizeMxPhone(raw)).toBe(expected);
    expect(isValidMxPhone(raw)).toBe(expected !== null);
  });
  it('assertValidPhone: 422 PHONE_INVALID con details.field', () => {
    try {
      assertValidPhone('');
      throw new Error('no lanzó');
    } catch (e) {
      const err = e as { code?: string; getStatus?: () => number; details?: unknown };
      expect(err.code).toBe('PHONE_INVALID');
      expect(err.getStatus?.()).toBe(422);
      expect(err.details).toEqual({ field: 'phone' });
    }
  });
  it('maskPhone enmascara', () => {
    expect(maskPhone('5512345678')).toBe('******5678');
    expect(maskPhone(null)).toBe('******');
  });
});
