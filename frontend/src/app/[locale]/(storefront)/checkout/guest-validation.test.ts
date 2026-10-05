import { describe, it, expect } from 'vitest';
import {
  EMPTY_GUEST_ADDRESS,
  isValidEmail,
  suggestEmailTypo,
  toAddressPayload,
  validateGuestForm,
} from './guest-validation';

const VALID_ADDRESS = {
  ...EMPTY_GUEST_ADDRESS,
  recipientName: 'Juan Pérez',
  line1: 'Av. Vallarta 1234',
  neighborhood: 'Guadalajara Centro',
  city: 'Guadalajara',
  state: 'Jalisco',
  postalCode: '44100',
  phone: '3312345678',
};

describe('guest-validation · correo (criterio 47)', () => {
  it('rechaza vacío y formatos inválidos, acepta uno bien formado', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('sin-arroba')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('juan@dominio.com')).toBe(true);
  });

  it('sugiere erratas de dominio sin rechazar el correo', () => {
    expect(suggestEmailTypo('juan@gmial.com')).toBe('juan@gmail.com');
    expect(isValidEmail('juan@gmial.com')).toBe(true); // la sugerencia NO bloquea
    expect(suggestEmailTypo('juan@gmail.com')).toBeNull();
  });
});

describe('guest-validation · formulario completo', () => {
  it('correo inválido o sin confirmar impide avanzar al pago', () => {
    expect(
      validateGuestForm({
        email: 'no-es-correo',
        emailConfirmed: true,
        acceptedTerms: true,
        address: VALID_ADDRESS,
      }).email,
    ).toBe('invalid');

    expect(
      validateGuestForm({
        email: 'juan@dominio.com',
        emailConfirmed: false,
        acceptedTerms: true,
        address: VALID_ADDRESS,
      }).emailConfirmed,
    ).toBe('unconfirmed');
  });

  it('exige los campos que el contrato marca obligatorios en GuestAddressInput (§4-G.1)', () => {
    const errors = validateGuestForm({
      email: 'juan@dominio.com',
      emailConfirmed: true,
      acceptedTerms: true,
      address: EMPTY_GUEST_ADDRESS,
    });
    expect(errors.recipientName).toBe('required');
    expect(errors.line1).toBe('required');
    expect(errors.postalCode).toBe('invalid'); // ^\d{5}$
    expect(errors.phone).toBe('invalid'); // 10 dígitos MX
  });

  it('sin aceptación explícita de términos no se puede pagar (acceptedTerms del contrato)', () => {
    expect(
      validateGuestForm({
        email: 'juan@dominio.com',
        emailConfirmed: true,
        acceptedTerms: false,
        address: VALID_ADDRESS,
      }).terms,
    ).toBe('required');
  });

  it('un formulario completo no produce errores', () => {
    expect(
      validateGuestForm({
        email: 'juan@dominio.com',
        emailConfirmed: true,
        acceptedTerms: true,
        address: VALID_ADDRESS,
      }),
    ).toEqual({});
  });

  // N-3: el teléfono con lada de país +52 / +521 y separadores ya NO revienta en silencio.
  it.each(['+52 55 4017 0606', '+525540170606', '+521 55 4017 0606', '(55) 4017-0606'])(
    'acepta el teléfono MX escrito como "%s"',
    (phone) => {
      const errors = validateGuestForm({
        email: 'juan@dominio.com',
        emailConfirmed: true,
        acceptedTerms: true,
        address: { ...VALID_ADDRESS, phone },
      });
      expect(errors.phone).toBeUndefined();
    },
  );
});

describe('guest-validation · payload', () => {
  it('normaliza y fija país MX (envío solo nacional, criterio 31/48b)', () => {
    const payload = toAddressPayload({ ...VALID_ADDRESS, phone: '33 1234 5678', city: ' Guadalajara ' });
    expect(payload.country).toBe('MX');
    expect(payload.phone).toBe('3312345678');
    expect(payload.city).toBe('Guadalajara');
    expect(payload.line2).toBeUndefined();
  });

  it('N-3: normaliza la lada de país +52/+521 a los 10 dígitos nacionales', () => {
    expect(toAddressPayload({ ...VALID_ADDRESS, phone: '+52 55 4017 0606' }).phone).toBe('5540170606');
    expect(toAddressPayload({ ...VALID_ADDRESS, phone: '+521 55 4017 0606' }).phone).toBe('5540170606');
  });
});

/** Fase C (`API_CONTRACT §M4-SHIP.19.5`) + errata v1.80.12.3 (§19.23.4). */
describe('guest-validation · colonia, referencias y número interior (v1.81)', () => {
  const base = { email: 'juan@dominio.com', emailConfirmed: true, acceptedTerms: true };

  it('con CP válido la colonia es OBLIGATORIA; ciudad y estado ya no son campos que se validen', () => {
    const errors = validateGuestForm({ ...base, address: { ...VALID_ADDRESS, neighborhood: '', city: '', state: '' } });
    expect(errors.neighborhood).toBe('required');
    expect(Object.keys(errors)).toEqual(['neighborhood']);
  });

  it('con CP inválido el error es del CP (la colonia no se puede elegir todavía)', () => {
    const errors = validateGuestForm({ ...base, address: { ...VALID_ADDRESS, postalCode: '441', neighborhood: '' } });
    expect(errors.postalCode).toBe('invalid');
    expect(errors.neighborhood).toBeUndefined();
  });

  it('referencias: 70 pasan, 71 no', () => {
    expect(validateGuestForm({ ...base, address: { ...VALID_ADDRESS, references: 'r'.repeat(70) } }).references).toBeUndefined();
    expect(validateGuestForm({ ...base, address: { ...VALID_ADDRESS, references: 'r'.repeat(71) } }).references).toBe('tooLong');
  });

  it('número interior: 200 pasan, 201 no (el 0..120 de §19.20.1 era de transcripción)', () => {
    expect(validateGuestForm({ ...base, address: { ...VALID_ADDRESS, line2: 'x'.repeat(200) } }).line2).toBeUndefined();
    expect(validateGuestForm({ ...base, address: { ...VALID_ADDRESS, line2: 'x'.repeat(201) } }).line2).toBe('tooLong');
  });

  it('el payload lleva la colonia y las referencias (vacías ⇒ no viajan)', () => {
    const p = toAddressPayload({ ...VALID_ADDRESS, neighborhood: ' Guadalajara Centro ', references: ' portón negro ' });
    expect(p.neighborhood).toBe('Guadalajara Centro');
    expect(p.references).toBe('portón negro');
    expect(toAddressPayload({ ...VALID_ADDRESS, references: '  ' }).references).toBeUndefined();
  });
});
