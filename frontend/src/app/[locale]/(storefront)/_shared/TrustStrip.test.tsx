import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { TrustStrip } from './TrustStrip';

// HECHOS 2026-11-01 «"Pago seguro" y correo de contacto en el Card Show»: el dueño, «Pago seguro» (D-E decidida).
describe('TrustStrip · texto de la franja de confianza (D-E)', () => {
  it('es: «Pago seguro · Envío a México · Quiénes somos»', () => {
    renderWithProviders(<TrustStrip />, 'es');
    expect(screen.getByTestId('about-strip')).toHaveTextContent('Pago seguro · Envío a México · Quiénes somos');
  });

  it('en: empieza por «Secure payment»', () => {
    renderWithProviders(<TrustStrip />, 'en');
    const strip = screen.getByTestId('about-strip');
    expect(strip.textContent?.startsWith('Secure payment · ')).toBe(true);
    expect(strip).not.toHaveTextContent(/card payment/i);
  });
});
