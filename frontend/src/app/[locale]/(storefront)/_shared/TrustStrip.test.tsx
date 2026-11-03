import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';
import { TrustStrip } from './TrustStrip';

/** Candado (d) de CTA-UX.1: sin teléfono configurado no hay WhatsApp. `noPhone` lo enciende un caso. */
const noPhone = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/about', async (orig) => {
  const actual = await orig<typeof import('@/lib/about')>();
  return { ...actual, whatsappHref: (...a: Parameters<typeof actual.whatsappHref>) => (noPhone.on ? '' : actual.whatsappHref(...a)) };
});
afterEach(() => {
  noPhone.on = false;
});

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
    const wa = within(strip).getByRole('link', { name: 'WhatsApp 55 6489 3921 (se abre en otra pestaña)' });
    expect(wa).toHaveAttribute('href', 'https://wa.me/525564893921');
    const ig = within(strip).getByRole('link', { name: 'Instagram @tcghunt.mx (se abre en otra pestaña)' });
    expect(ig).toHaveAttribute('href', 'https://www.instagram.com/tcghunt.mx/');
    expect(within(strip).getByRole('link', { name: 'Quiénes somos y contacto' })).toHaveAttribute('href', '/es/nosotros');
  });

  it('en: card, plazo en inglés, WhatsApp internacional e Instagram', () => {
    renderWithProviders(<TrustStrip />, 'en');
    const strip = screen.getByTestId('about-strip');
    expect(within(strip).getByTestId('about-strip-payment')).toHaveTextContent('Secure card payment');
    expect(within(strip).getByTestId('about-strip-delivery')).toHaveTextContent('Delivery in 4 to 10 business days');
    expect(within(strip).getByRole('link', { name: 'WhatsApp +52 55 6489 3921 (opens in a new tab)' })).toHaveAttribute('href', 'https://wa.me/525564893921');
    expect(within(strip).getByRole('link', { name: 'Instagram @tcghunt.mx (opens in a new tab)' })).toBeInTheDocument();
  });

  it('los enlaces externos abren en otra pestaña sin filtrar el origen', () => {
    renderWithProviders(<TrustStrip />, 'es');
    for (const name of ['WhatsApp 55 6489 3921 (se abre en otra pestaña)', 'Instagram @tcghunt.mx (se abre en otra pestaña)']) {
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

/**
 * DESIGN_SYSTEM §CTA-UX.1 (vCTA-1, petición 2) — la forma de la franja. Lo que se mide aquí es la ESTRUCTURA que hace
 * imposible el defecto; el ancho real a 360 px lo mide `e2e/cuenta-correo.spec.ts` (candados (b) y (c) en navegador).
 *  - grupo con nombre «Pago, entrega y contacto»;
 *  - dos renglones: un `<p>` con los datos y un `<ul>` con los enlaces, SIN separadores entre enlaces;
 *  - el único « ·» es `aria-hidden` y va pegado al primer dato con espacio duro (nunca abre renglón);
 *  - WhatsApp e Instagram anuncian «se abre en otra pestaña» (y su nombre contiene el texto visible, WCAG 2.5.3);
 *  - enlaces ≥ 44 px (`min-h-[44px]`), cada uno entero (`whitespace-nowrap`);
 *  - (d) sin teléfono no hay WhatsApp ni hueco; (e) paridad ES/EN de `about.strip.*`.
 * Mutaciones: volver al `flex-wrap` de nueve hijos (separadores sueltos), quitar el `aria-label` del grupo, quitar el
 * aviso de pestaña, separar el « ·» del dato con espacio normal.
 */
describe('CTA-UX.1 · franja en dos renglones', () => {
  it.each([
    ['es', 'Pago, entrega y contacto'],
    ['en', 'Payment, delivery and contact'],
  ] as const)('%s: grupo con nombre, un renglón de datos y una lista de enlaces', (locale, name) => {
    renderWithProviders(<TrustStrip />, locale);
    const group = screen.getByRole('group', { name });
    expect(group).toHaveAttribute('data-testid', 'about-strip');
    const rows = Array.from(group.children);
    expect(rows.map((r) => r.tagName)).toEqual(['P', 'UL']);
    const links = within(rows[1] as HTMLElement).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
    // El renglón de enlaces no lleva separadores: el subrayado separa.
    expect(rows[1].textContent).not.toContain('·');
    expect(within(rows[0] as HTMLElement).queryAllByRole('link')).toHaveLength(0);
  });

  it('el « ·» es el único separador, aria-hidden y pegado al primer dato con espacio duro', () => {
    renderWithProviders(<TrustStrip />, 'es');
    const strip = screen.getByTestId('about-strip');
    expect((strip.textContent ?? '').match(/·/g)).toHaveLength(1);
    const sep = Array.from(strip.querySelectorAll('[aria-hidden]')).find((n) => n.textContent?.includes('·'))!;
    expect(sep).toBeTruthy();
    expect(sep.textContent).toBe('\u00a0·');
    // Mismo bloque irrompible que el primer dato: el salto de renglón solo puede caer DESPUÉS del « ·».
    const unit = sep.parentElement!;
    expect(unit).toHaveClass('whitespace-nowrap');
    expect(within(unit).getByTestId('about-strip-payment')).toBeInTheDocument();
    expect(unit.nextSibling?.textContent).toBe(' ');
  });

  it('enlaces de 44 px, enteros; WhatsApp e Instagram avisan la pestaña nueva y Quiénes somos no', () => {
    renderWithProviders(<TrustStrip />, 'en');
    const strip = screen.getByTestId('about-strip');
    for (const a of within(strip).getAllByRole('link')) {
      expect(a).toHaveClass('min-h-[44px]');
      expect(a).toHaveClass('whitespace-nowrap');
    }
    const ext = within(strip).getAllByRole('link').filter((a) => a.getAttribute('target') === '_blank');
    expect(ext).toHaveLength(2);
    for (const a of ext) {
      const sr = a.querySelector('.sr-only');
      expect(sr?.textContent).toBe(' (opens in a new tab)');
    }
    expect(within(strip).getByRole('link', { name: 'About us & contact' }).querySelector('.sr-only')).toBeNull();
  });

  it('(d) sin teléfono configurado: sin WhatsApp y sin hueco en la lista', () => {
    noPhone.on = true;
    renderWithProviders(<TrustStrip />, 'es');
    const strip = screen.getByTestId('about-strip');
    expect(within(strip).queryByRole('link', { name: /WhatsApp/ })).toBeNull();
    expect(within(strip).getAllByRole('listitem')).toHaveLength(2);
    expect(within(strip).getAllByRole('link')).toHaveLength(2);
  });

  it('(e) paridad ES/EN de about.strip.*', () => {
    expect(Object.keys(en.about.strip).sort()).toEqual(Object.keys(es.about.strip).sort());
    for (const m of [es, en]) {
      expect(m.about.strip.newTab).toMatch(/^ \(.+\)$/);
      expect(m.about.strip.groupLabel.length).toBeGreaterThan(0);
    }
  });
});
