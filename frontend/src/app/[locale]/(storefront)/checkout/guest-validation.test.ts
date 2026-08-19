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
    expect(errors.city).toBe('required');
    expect(errors.state).toBe('required');
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
});

describe('guest-validation · payload', () => {
  it('normaliza y fija país MX (envío solo nacional, criterio 31/48b)', () => {
    const payload = toAddressPayload({ ...VALID_ADDRESS, phone: '33 1234 5678', city: ' Guadalajara ' });
    expect(payload.country).toBe('MX');
    expect(payload.phone).toBe('3312345678');
    expect(payload.city).toBe('Guadalajara');
    expect(payload.line2).toBeUndefined();
  });
});
