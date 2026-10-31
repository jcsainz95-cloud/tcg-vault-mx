import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';

/*
 * DESIGN_SYSTEM MKT-CONV.4 / MKT-CONV.6 L-5, L-7 (B2, criterios 944–946) — «Quiénes somos y contacto» renderizada como
 * la sirve Next (componente de servidor entero, traducciones reales). El HTTP 200, el sitemap y el HTML crudo los mide
 * `e2e/seo-raw-html.spec.ts` (`@real`).
 */
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: locale === 'en' ? en : es, namespace } as never),
}));
vi.mock('@/components/i18n/RouteMessages', () => ({
  RouteMessages: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const rule = vi.hoisted(() => ({
  current: { cardsOnlyFeeCents: 10000, sealedFeeCents: 20000, freeFromCents: 400000, currency: 'MXN' } as null | Record<
    string,
    unknown
  >,
}));
vi.mock('@/lib/catalog-ssr', () => ({ loadShippingRuleForSSR: async () => rule.current }));
const about = vi.hoisted(() => ({ phone: '' }));
vi.mock('@/lib/about', async (orig) => {
  const real = await orig<typeof import('@/lib/about')>();
  return {
    ...real,
    get CONTACT_PHONE() {
      return about.phone;
    },
  };
});

import AboutPage, { generateMetadata } from './page';

afterEach(() => {
  cleanup();
  about.phone = '';
  rule.current = { cardsOnlyFeeCents: 10000, sealedFeeCents: 20000, freeFromCents: 400000, currency: 'MXN' };
});

async function renderPage(locale: 'es' | 'en') {
  const ui = await AboutPage({ params: Promise.resolve({ locale }) });
  return render(ui);
}

function graph(container: HTMLElement): Record<string, unknown>[] {
  const s = container.querySelector('script[type="application/ld+json"]')!;
  return (JSON.parse(s.innerHTML) as { '@graph': Record<string, unknown>[] })['@graph'];
}

const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-about-row]')];

describe('/nosotros · Quiénes somos y contacto (MKT-CONV.4)', () => {
  it('un h1, lead y los datos del dueño: Ciudad de México, contacto@, Instagram y 4 a 10 días hábiles', async () => {
    const { container } = await renderPage('es');
    const h1 = container.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe('Quiénes somos y contacto');
    const text = container.textContent ?? '';
    expect(text).toContain('Ciudad de México');
    expect(text).toContain('4 a 10 días hábiles');
    expect(container.querySelector('a[href="mailto:contacto@tcghunt.mx"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://www.instagram.com/tcghunt.mx/"]')?.textContent).toBe('@tcghunt.mx');
    // El envío sale de la regla pública viva, no de un literal.
    expect(text).toContain('MX$100.00');
    expect(text).toContain('MX$4,000.00');
  });

  it('L-7 · ninguna fila vacía: sin razón social ni teléfono del dueño, esas filas NO existen', async () => {
    const { container } = await renderPage('es');
    for (const r of rows(container)) expect((r.querySelector('dd') ?? r).textContent?.trim(), r.dataset.aboutRow).not.toBe('');
    const ids = rows(container).map((r) => r.dataset.aboutRow);
    expect(ids).not.toContain('phone');
    expect(ids).not.toContain('legal-entity');
    expect(container.textContent).not.toMatch(/DATO DEL DUEÑO|EJEMPLO|\[.*pendiente.*\]/i);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it('teléfono preparado: con número en `CONTACT_PHONE`, fila con tel: y «Atención solo por teléfono»; y en el JSON-LD', async () => {
    about.phone = '+52 55 1234 5678';
    const { container } = await renderPage('es');
    expect(rows(container).map((r) => r.dataset.aboutRow)).toContain('phone');
    expect(container.querySelector('a[href="tel:+525512345678"]')).not.toBeNull();
    expect(container.textContent).toContain('Atención solo por teléfono');
    const org = graph(container).find((x) => x['@type'] === 'Organization')!;
    expect((org.contactPoint as Record<string, unknown>).telephone).toBe('+52 55 1234 5678');
  });

  it('sin regla de envío a tiempo, la fila de envío se omite (ningún importe a mano)', async () => {
    rule.current = null;
    const { container } = await renderPage('es');
    expect(rows(container).map((r) => r.dataset.aboutRow)).not.toContain('shipping');
  });

  it('JSON-LD: AboutPage + Organization con contactPoint (correo, MX, es/en) y sameAs Instagram (944/946)', async () => {
    const { container } = await renderPage('es');
    const g = graph(container);
    expect(g.find((n) => n['@type'] === 'AboutPage')).toBeTruthy();
    const org = g.find((n) => n['@type'] === 'Organization')!;
    expect(org.sameAs).toEqual(['https://www.instagram.com/tcghunt.mx/']);
    expect(org.contactPoint).toMatchObject({ email: 'contacto@tcghunt.mx', areaServed: 'MX', availableLanguage: ['es', 'en'] });
  });

  it('en: la misma página en inglés, sin español mezclado en los rótulos', async () => {
    const { container } = await renderPage('en');
    expect(container.querySelector('h1')?.textContent).toBe('About us & contact');
    expect(container.textContent).toContain('Mexico City');
    expect(container.textContent).toContain('4 to 10 business days');
  });

  it('metadata propia: título, descripción sin IVA y canonical /{locale}/nosotros', async () => {
    const m = await generateMetadata({ params: Promise.resolve({ locale: 'es' }) });
    expect(m.title).toBe('Quiénes somos y contacto · TCG HUNT');
    expect(String(m.description)).not.toMatch(/\biva\b/i);
    expect(m.alternates?.canonical).toBe('https://tcghunt.mx/es/nosotros');
  });
});

/** L-5 / L-7 sobre los ficheros de mensajes: paridad es/en de las claves nuevas y ningún hueco publicado. */
describe('mensajes de MKT-CONV (L-5, L-7)', () => {
  const keys = (o: unknown, p = ''): string[] =>
    o && typeof o === 'object'
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k))
      : [p];

  it('paridad es/en: about.*, catalog.vaultNote, catalog.soldOutCard, seo.nav.about', () => {
    expect(keys(es.about).sort()).toEqual(keys(en.about).sort());
    for (const m of [es, en]) {
      expect(m.catalog.vaultNote).toBeTruthy();
      expect(m.catalog.soldOutCard).toBeTruthy();
      expect(m.seo.nav.about).toBeTruthy();
    }
    for (const v of keys(es.about).map((k) => k.split('.').reduce<unknown>((o, s) => (o as Record<string, unknown>)[s], es.about)))
      expect(String(v).trim()).not.toBe('');
  });

  it('T2 = texto B de MKT-CONV.3 (D-C = B) literal en los dos idiomas', () => {
    expect(es.catalog.vaultNote).toBe('Con cuenta, junta cartas en tu bóveda y pide un solo envío. Sin cuenta, te la enviamos a casa.');
    expect(en.catalog.vaultNote).toBe('With an account, keep cards in your vault and ship them together. Without one, we ship this to you.');
  });

  it('el banner conserva sus textos aprobados (HECHOS 2026-10-26): B1 solo cambió la forma', () => {
    expect(es.consent.text).toBe('Usamos cookies para entenderte mejor y mejorar tu experiencia.');
    expect([es.consent.accept, es.consent.necessary, es.consent.customize]).toEqual(['Aceptar', 'Solo lo necesario', 'Configurar']);
    expect(en.consent.text).toBe('We use cookies to understand you better and improve your experience.');
    expect([en.consent.accept, en.consent.necessary, en.consent.customize]).toEqual(['Accept', 'Necessary only', 'Customize']);
  });

  it('L-7 · ningún «DATO DEL DUEÑO» en messages/*.json', () => {
    for (const l of ['es', 'en']) {
      const raw = readFileSync(join(__dirname, `../../../../../messages/${l}.json`), 'utf8');
      expect(raw, l).not.toMatch(/DATO DEL DUEÑO/i);
    }
  });

  it('B6b · «Comprar» de la ficha y la frase de sistema salen del catálogo de mensajes (sin otro uso)', () => {
    for (const m of [es, en] as Record<string, Record<string, unknown>>[]) {
      expect(m.catalog).not.toHaveProperty('buyNow');
      expect(m.card).not.toHaveProperty('referenceExplainerNoMarket');
    }
  });
});
