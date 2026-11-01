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
import AboutPage, { generateMetadata } from './page';

afterEach(() => {
  cleanup();
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

  it('L-7 · ninguna fila vacía; sin razón social ni la nota «solo por teléfono» (el texto de Contacto ya lo dice)', async () => {
    for (const locale of ['es', 'en'] as const) {
      const { container } = await renderPage(locale);
      for (const r of rows(container)) expect((r.querySelector('dd') ?? r).textContent?.trim(), r.dataset.aboutRow).not.toBe('');
      const ids = rows(container).map((r) => r.dataset.aboutRow);
      expect(ids, locale).not.toContain('legal-entity');
      expect(ids, locale).not.toContain('story');
      expect(container.textContent).not.toMatch(/DATO DEL DUEÑO|EJEMPLO|\[.*pendiente.*\]/i);
      expect(container.textContent).not.toMatch(/solo por teléfono|by phone only/i);
      expect(container.querySelector('a[href^="tel:"]')).toBeNull();
      cleanup();
    }
  });

  it('WhatsApp (HECHOS 2026-11-01): fila con enlace wa.me y el número como lo dio marketing; telephone en el JSON-LD', async () => {
    for (const [locale, shown] of [
      ['es', '55 6489 3921'],
      ['en', '+52 55 6489 3921'],
    ] as const) {
      const { container } = await renderPage(locale);
      const row = container.querySelector('[data-about-row="whatsapp"]')!;
      expect(row, locale).not.toBeNull();
      expect(row.querySelector('dt')?.textContent).toBe('WhatsApp');
      const a = row.querySelector('a')!;
      expect(a.getAttribute('href')).toBe('https://wa.me/525564893921');
      expect(a.textContent).toBe(shown);
      const org = graph(container).find((x) => x['@type'] === 'Organization')!;
      expect((org.contactPoint as Record<string, unknown>).telephone).toBe('+52-55-6489-3921');
      cleanup();
    }
  });

  it('filas en el orden del texto final, con las filas fijas de la tienda conservadas', async () => {
    const { container } = await renderPage('es');
    expect(rows(container).map((r) => r.dataset.aboutRow)).toEqual([
      'city',
      'what',
      'review',
      'account',
      'payment',
      'shipping',
      'delivery',
      'guarantee',
      'invoice',
      'email',
      'whatsapp',
      'instagram',
      'orders',
      'card-show',
    ]);
    expect(container.querySelector('[data-about-row="orders"] a')?.getAttribute('href')).toBe('mailto:soporte@tcghunt.mx');
    expect(container.querySelector('[data-about-row="email"] a')?.getAttribute('href')).toBe('mailto:contacto@tcghunt.mx');
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

/**
 * Texto final de marketing (HECHOS 2026-11-01 «WhatsApp público, plazo de entrega y texto de Quiénes somos»; fuente
 * `tcg-hunt-marketing` @ 6fed1dd `piezas/2026-11-tienda-nosotros/copy-final.md`), LITERAL. Si alguien edita una clave,
 * esta prueba se pone roja: el texto se cambia en marketing, no aquí.
 */
const FINAL = {
  es: {
    lead: 'TCG HUNT es una tienda en línea de cartas Pokémon TCG en NM, de Ciudad de México a todo México. Te vendemos las que buscas y te compramos las tuyas en NM.',
    what: ['Qué hacemos', 'Somos una tienda en línea hecha para quien colecciona y juega Pokémon TCG. Tenemos cartas sueltas en NM y producto sellado. ¿Quieres vender? El cotizador te dice al momento cuánto te pagamos por cada carta en NM, sin cuenta y sin compromiso; el sellado nos lo mandas en fotos por correo. Y organizamos el Card Show CDMX: mesas, cartas y torneos.'],
    city: ['Ciudad', 'Ciudad de México'],
    buyIntro: 'Compras desde tu celular o tu compu, sin vueltas. Si abres cuenta, tus cartas se guardan a tu nombre en tu bóveda: las vas juntando y pides un solo envío cuando tú quieras.',
    delivery: ['Plazo de entrega', 'De 4 a 10 días hábiles desde tu compra o desde que pides el envío de tu bóveda.'],
    contactIntro: 'No atendemos en persona, pero aquí estamos: mándanos mensaje o escríbenos y te ayudamos con tu pedido, tu venta o tu duda de cartas.',
    email: ['Correo', 'contacto@tcghunt.mx'],
    whatsapp: ['WhatsApp', '55 6489 3921'],
    instagram: ['Instagram', '@tcghunt.mx: novedades, cartas y el Card Show.'],
    description: 'Cartas Pokémon TCG en NM desde Ciudad de México: quiénes somos, cómo compras y cómo hablar con nosotros.',
    // Títulos de bloque: el texto aprobado los escribe en VERSALES; la página los guarda en tipo oración y los
    // pone en mayúsculas por CSS (`uppercase`). Se compara lo guardado y su forma en mayúsculas contra el aprobado.
    titles: [['Quién está detrás', 'QUIÉN ESTÁ DETRÁS'], ['Cómo compras con nosotros', 'CÓMO COMPRAS CON NOSOTROS'], ['Contacto', 'CONTACTO']],
  },
  en: {
    lead: "TCG HUNT is an online store for NM Pokémon TCG cards, from Mexico City to all of Mexico. We sell you the ones you're hunting and buy yours in NM.",
    what: ['What we do', "We're an online store made for people who collect and play Pokémon TCG. We carry NM single cards and sealed product. Want to sell? The quote tool tells you right away what we pay for each NM card, no account and no commitment; for sealed, email us photos. And we run the Card Show CDMX: tables, cards and tournaments."],
    city: ['City', 'Mexico City'],
    buyIntro: 'Shop from your phone or computer, no hassle. With an account, your cards are kept in your name in your vault: build up your pile and request a single shipment whenever you want.',
    delivery: ['Delivery time', '4 to 10 business days from your purchase or from when you request your vault shipment.'],
    contactIntro: "We don't do in-person service, but we're here: message us on WhatsApp or email us and we'll help with your order, your sale or your card question.",
    email: ['Email', 'contacto@tcghunt.mx'],
    whatsapp: ['WhatsApp', '+52 55 6489 3921'],
    instagram: ['Instagram', '@tcghunt.mx: news, cards and the Card Show.'],
    description: 'NM Pokémon TCG cards from Mexico City: who we are, how buying works and how to reach us.',
    titles: [['Who we are', 'WHO WE ARE'], ['How buying works', 'HOW BUYING WORKS'], ['Contact', 'CONTACT']],
  },
} as const;

describe('/nosotros · texto final de marketing, literal (HECHOS 2026-11-01)', () => {
  for (const locale of ['es', 'en'] as const) {
    it(`${locale}: lead, títulos de bloque, intros, filas y description tal cual`, async () => {
      const f = FINAL[locale];
      const { container } = await renderPage(locale);
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      expect(norm(container.querySelector('[data-about-lead]')?.textContent)).toBe(f.lead);
      expect(norm(container.querySelector('[data-about-intro="buy"]')?.textContent)).toBe(f.buyIntro);
      expect(norm(container.querySelector('[data-about-intro="contact"]')?.textContent)).toBe(f.contactIntro);
      for (const [id, [label, value]] of [
        ['what', f.what],
        ['city', f.city],
        ['delivery', f.delivery],
        ['email', f.email],
        ['whatsapp', f.whatsapp],
        ['instagram', f.instagram],
      ] as const) {
        const r = container.querySelector(`[data-about-row="${id}"]`);
        expect(norm(r?.querySelector('dt')?.textContent), `${locale}/${id}`).toBe(label);
        expect(norm(r?.querySelector('dd')?.textContent), `${locale}/${id}`).toBe(value);
      }
      const h2 = [...container.querySelectorAll('h2')];
      expect(h2.map((h) => norm(h.textContent)), `${locale}/títulos`).toEqual(f.titles.map(([stored]) => stored));
      for (const [i, [, approved]] of f.titles.entries()) {
        expect(norm(h2[i].textContent).toLocaleUpperCase(locale), `${locale}/título ${i}`).toBe(approved);
        expect(h2[i].className.split(/\s+/), `${locale}/título ${i} en versales por CSS`).toContain('uppercase');
      }
      const m = await generateMetadata({ params: Promise.resolve({ locale }) });
      expect(m.description).toBe(f.description);
      expect(norm(container.textContent)).not.toMatch(/\biva\b|patrocin|sponsor/i);
    });
  }
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
