import { normalizeMxPhone } from '../src/modules/card-show/phone.util';

/** ⭐M-84 (§CARDSHOW.1b) — teléfono MX se persiste como 10 dígitos; variantes +52/52/1 y separadores. */
describe('CARDSHOW · normalizeMxPhone', () => {
  it('10 dígitos con separadores ⇒ 10 dígitos', () => expect(normalizeMxPhone('55 1234 5678')).toBe('5512345678'));
  it('+52 1 + 10 dígitos ⇒ 10 dígitos', () => expect(normalizeMxPhone('+52 1 55 1234 5678')).toBe('5512345678'));
  it('52 + 10 dígitos ⇒ 10 dígitos', () => expect(normalizeMxPhone('52 55 1234 5678')).toBe('5512345678'));
  it('paréntesis/guiones ⇒ 10 dígitos', () => expect(normalizeMxPhone('(55) 1234-5678')).toBe('5512345678'));
  it('9 dígitos ⇒ null', () => expect(normalizeMxPhone('551234567')).toBeNull());
  it('texto sin dígitos ⇒ null', () => expect(normalizeMxPhone('abc')).toBeNull());
  it('14 dígitos ⇒ null', () => expect(normalizeMxPhone('12345678901234')).toBeNull());
});
