import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';
import { TrustStrip } from './TrustStrip';

/**
 * Criterio 945 (reescrito 2026-11-03, `HECHOS.md` «Checkout y ficha: tres cambios aprobados…» (2)) — las cuatro
 * señales de 944, en ES y EN, sin pulsar nada: (a) solo tarjeta; (b) «4 a 10 días hábiles»; (c) WhatsApp 55 6489 3921
 * que abre WhatsApp; (d) Instagram @tcghunt.mx que abre el perfil. Más el enlace a «Quiénes somos y contacto».
 * «Pago seguro» se conserva (D-E, HECHOS 2026-11-01).
 */
describe('945 · franja de confianza: cuatro señales', () => {
  it('es: tarjeta, plazo, WhatsApp y Instagram, con sus enlaces', () => {
    renderWithProviders(<TrustStrip />, 'es');
    const strip = screen.getByTestId('about-strip');
    expect(within(strip).getByTestId('about-strip-payment')).toHaveTextContent('Pago seguro con tarjeta');
    expect(within(strip).getByTestId('about-strip-delivery')).toHaveTextContent('Entrega en 4 a 10 días hábiles');
    const wa = within(strip).getByRole('link', { name: 'WhatsApp 55 6489 3921' });
    expect(wa).toHaveAttribute('href', 'https://wa.me/525564893921');
    const ig = within(strip).getByRole('link', { name: 'Instagram @tcghunt.mx' });
    expect(ig).toHaveAttribute('href', 'https://www.instagram.com/tcghunt.mx/');
    expect(within(strip).getByRole('link', { name: 'Quiénes somos y contacto' })).toHaveAttribute('href', '/es/nosotros');
  });

  it('en: card, plazo en inglés, WhatsApp internacional e Instagram', () => {
    renderWithProviders(<TrustStrip />, 'en');
    const strip = screen.getByTestId('about-strip');
    expect(within(strip).getByTestId('about-strip-payment')).toHaveTextContent('Secure card payment');
    expect(within(strip).getByTestId('about-strip-delivery')).toHaveTextContent('Delivery in 4 to 10 business days');
    expect(within(strip).getByRole('link', { name: 'WhatsApp +52 55 6489 3921' })).toHaveAttribute('href', 'https://wa.me/525564893921');
    expect(within(strip).getByRole('link', { name: 'Instagram @tcghunt.mx' })).toBeInTheDocument();
  });

  it('los enlaces externos abren en otra pestaña sin filtrar el origen', () => {
    renderWithProviders(<TrustStrip />, 'es');
    for (const name of ['WhatsApp 55 6489 3921', 'Instagram @tcghunt.mx']) {
      const a = screen.getByRole('link', { name });
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toMatch(/noopener/);
      expect(a.getAttribute('rel')).toMatch(/noreferrer/);
    }
  });

  /** «Los mismos datos que Quiénes somos, sin otra fuente» (944/945): método y plazo son UNA clave cada uno. */
  it('un hecho, un sitio: la franja y «Quiénes somos» leen el mismo método y el mismo plazo', () => {
    for (const m of [es, en]) {
      expect(m.about.strip.payment).toContain('{method}');
      expect(m.about.buy.paymentValue).toContain('{method}');
      expect(m.about.strip.delivery).toContain('{days}');
      expect(m.about.buy.deliveryValue).toContain('{days}');
      for (const s of [m.about.strip.payment, m.about.strip.delivery, m.about.buy.paymentValue, m.about.buy.deliveryValue]) {
        expect(s).not.toMatch(/tarjeta|card|hábiles|business days/i);
      }
    }
  });
});

/**
 * CTA-F7 (API_CONTRACT §CTA.8/§CTA.9, P-CTA-6): el texto de pago de la franja (ficha y carrito usan este componente) y
 * de «Quiénes somos», en ES y EN, NO contiene «OXXO» y SÍ «tarjeta»/«card». Mutación: añadir OXXO.
 */
describe('CTA-F7 · solo tarjeta, nunca OXXO', () => {
  it.each([
    ['es', /tarjeta/],
    ['en', /card/],
  ] as const)('%s: la franja dice el método y no nombra OXXO', (locale, method) => {
    renderWithProviders(<TrustStrip />, locale);
    const strip = screen.getByTestId('about-strip');
    expect(strip.textContent).toMatch(method);
    expect(strip.textContent).not.toMatch(/oxxo/i);
  });

  it('el catálogo de textos de cliente: ninguna clave de «about» ni del checkout nombra OXXO', () => {
    for (const m of [es, en]) {
      const about = JSON.stringify(m.about);
      expect(about).not.toMatch(/oxxo/i);
      expect(JSON.stringify(m.checkout)).not.toMatch(/oxxo/i);
      expect(m.about.paymentMethod).toMatch(/^(tarjeta|card)$/);
    }
  });
});
