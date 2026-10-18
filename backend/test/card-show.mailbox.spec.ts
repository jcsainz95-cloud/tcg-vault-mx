import { canonicalizeMailbox, emailDomain, normalizeEmail } from '../src/modules/card-show/mailbox.util';

/**
 * §CARDSHOW.8 (C2) — la clave de BUZÓN. `normalizeEmail` da la UNICIDAD (fila por correo);
 * `canonicalizeMailbox` da el TOPE (un buzón, aunque haya +etiqueta y puntos de Gmail).
 */
describe('CARDSHOW · canonicalización de buzón (C2)', () => {
  it('normalizeEmail: minúsculas + trim; ⛔ NO quita +etiqueta ni puntos', () => {
    expect(normalizeEmail('  Email@Dominio.MX ')).toBe('email@dominio.mx');
    expect(normalizeEmail('victima+1@gmail.com')).toBe('victima+1@gmail.com');
    expect(normalizeEmail('v.ictima@gmail.com')).toBe('v.ictima@gmail.com');
  });

  it('canonicalizeMailbox: victima, victima+1, victima+2 y v.ictima@gmail ⇒ MISMO buzón', () => {
    const canonical = canonicalizeMailbox('victima@gmail.com');
    expect(canonicalizeMailbox('victima+1@gmail.com')).toBe(canonical);
    expect(canonicalizeMailbox('victima+2@gmail.com')).toBe(canonical);
    expect(canonicalizeMailbox('v.ictima@gmail.com')).toBe(canonical);
    expect(canonicalizeMailbox('V.I.C.T.I.M.A+etiqueta@gmail.com')).toBe(canonical);
    expect(canonical).toBe('victima@gmail.com');
  });

  it('canonicalizeMailbox: en un dominio NO-Gmail los puntos SÍ cuentan (buzones distintos)', () => {
    expect(canonicalizeMailbox('a.b@dominio.mx')).toBe('a.b@dominio.mx');
    expect(canonicalizeMailbox('ab@dominio.mx')).toBe('ab@dominio.mx');
    expect(canonicalizeMailbox('a.b@dominio.mx')).not.toBe(canonicalizeMailbox('ab@dominio.mx'));
    // el +etiqueta sí se quita en cualquier dominio
    expect(canonicalizeMailbox('a.b+promo@dominio.mx')).toBe('a.b@dominio.mx');
  });

  it('canonicalizeMailbox: googlemail.com se trata como Gmail', () => {
    expect(canonicalizeMailbox('v.ictima+x@googlemail.com')).toBe('victima@googlemail.com');
  });

  it('emailDomain', () => {
    expect(emailDomain('Email@Dominio.MX')).toBe('dominio.mx');
    expect(emailDomain('no-arroba')).toBe('');
  });
});
