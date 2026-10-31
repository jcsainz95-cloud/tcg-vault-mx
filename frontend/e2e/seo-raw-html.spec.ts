import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { realOnly } from './utils/auth';
import { resolveApiBaseUrl } from './utils/env';
import { t } from './utils/i18n';

/**
 * BRIEF_MKT Ola 2 · C1/C2/C4/C5/C6 — lo que ve un bot SIN JavaScript (GPTBot, ClaudeBot, la primera ola de Google):
 * el HTML CRUDO que sirve `next start`, leído con `request.get` (no se ejecuta nada), contra el stack REAL sembrado
 * (`E2E_REAL=1`). Criterios 949, 950, 952, 953 y 954 de `PROJECT.md`.
 *
 * Datos DESCUBIERTOS por la API pública (nunca ids de fixture): una carta suelta, una gradeada, un sellado y una
 * carta sin piezas a la venta («agotada», 200 con `listings: []`, WSH-T37).
 *
 * Mutaciones que lo ponen rojo (medidas en FRONTEND_NOTES §MKT-OLA2): quitar `initialData` de la ficha (C1: sin `<h1>`
 * ni precio), no leer el catálogo en el servidor (C2: 0 enlaces), quitar `generateMetadata` de una lista (C4),
 * quitar `shippingDetails` (C5), quitar el JSON-LD de la portada o volver a `lastModified: now` (C6).
 */

const MONEY = /MX\$[\d,]+\.\d{2}/;
const UUID_LINK = /href="\/es\/(catalog|sellado)\/[0-9a-f-]{36}"/g;

/** Texto visible del HTML crudo: sin `<script>`/`<style>`/`<template>` ni etiquetas, con entidades básicas. */
function visibleText(html: string): string {
  const body = html.split(/<body[^>]*>/)[1] ?? html;
  return body
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto de cada `<h1>` del HTML crudo. */
function h1s(html: string): string[] {
  return [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(`<body>${m[1]}`));
}

function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );
}

/** Nodos `@type` dentro de los bloques JSON-LD (con o sin `@graph`). */
function ldNodes(html: string, type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (r['@type'] === type) out.push(r);
      Object.values(r).forEach(walk);
    }
  };
  jsonLd(html).forEach(walk);
  return out;
}

function headTag(html: string, re: RegExp): string | undefined {
  return re.exec(html)?.[1];
}

/** Errores de hidratación de React en la consola (el HTML del servidor no coincide con el primer render cliente). */
function hydrationErrors(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat|#418|#423|#425/i.test(m.text())) out.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => {
    if (/hydrat|#418|#423|#425/i.test(e.message)) out.push(e.message.slice(0, 200));
  });
  return out;
}

async function raw(request: APIRequestContext, path: string): Promise<{ status: number; html: string }> {
  const res = await request.get(path, { maxRedirects: 0 });
  return { status: res.status(), html: await res.text() };
}

interface Group {
  card: { id: string; name: string; setName: string; number: string };
  productType: 'raw' | 'graded';
  displayPriceCents: number | null;
  gradingCompany?: string;
  gradeValue?: string;
}

async function api<T>(path: string): Promise<T> {
  const base = await resolveApiBaseUrl();
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`GET ${path} ⇒ ${res.status}`);
  return (await res.json()) as T;
}

test.describe('@real SEO · HTML crudo del servidor (sin JavaScript)', () => {
  test.beforeEach(() => realOnly('lee el HTML que sirve next start contra el backend sembrado'));

  test('@real C1 · ficha suelta, gradeada, sellada y agotada: <h1> nombre · set · número, precio, condición y texto', async ({
    request,
  }) => {
    const cards = await api<{ data: Group[] }>('/catalog/cards?pageSize=50');
    const rawG = cards.data.find((g) => g.productType === 'raw' && g.displayPriceCents != null);
    const graded = cards.data.find((g) => g.productType === 'graded' && g.displayPriceCents != null);
    const sealed = (await api<{
      data: { representativeItemId: string; productName: string; card: { setName: string } }[];
    }>('/catalog/sealed')).data[0];
    const listed = new Set(cards.data.map((g) => g.card.id));
    const candidates = (await api<{ data: { id: string; name: string }[] }>('/buylist/cards?q=E2E&pageSize=50')).data;
    let soldOut: { id: string; name: string; setName: string; number: string } | undefined;
    for (const c of candidates.filter((x) => !listed.has(x.id))) {
      const d = await api<{ card: { id: string; name: string; setName: string; number: string }; listings: unknown[] }>(
        `/catalog/cards/${c.id}`,
      );
      if (d.listings.length === 0) {
        soldOut = d.card;
        break;
      }
    }
    expect(rawG, 'el catálogo trae una carta suelta con precio').toBeTruthy();
    expect(graded, 'el catálogo trae una gradeada con precio').toBeTruthy();
    expect(sealed, 'hay un sellado publicado').toBeTruthy();
    expect(soldOut, 'hay una carta sin piezas a la venta').toBeTruthy();

    for (const g of [rawG!, graded!]) {
      const { status, html } = await raw(request, `/es/catalog/${g.card.id}`);
      expect(status).toBe(200);
      const [h1] = h1s(html);
      expect(h1, `<h1> de ${g.card.name}`).toContain(g.card.name);
      expect(h1).toContain(g.card.setName);
      expect(h1).toMatch(new RegExp(`\\b0*${g.card.number}\\b`));
      const text = visibleText(html);
      // El precio que se pinta es el `displayPriceCents` del DTO: el mismo que se cobra.
      const priceText = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(g.displayPriceCents! / 100);
      expect(text).toContain(`MX$${priceText}`);
      if (g.productType === 'graded') expect(text).toContain(`${g.gradingCompany} ${g.gradeValue}`);
      else expect(text).toContain(t('es', 'catalog.condition.nm.label'));
      // MKT-CONV.2 (B6b): sin la frase de sistema; la pila de avisos (T8) da el texto bajo el precio.
      expect(text).not.toContain('El precio de venta es el precio publicado');
      expect(text).toContain(t('es', 'checkout.refundPromise'));
      expect(text.length).toBeGreaterThan(600);
    }

    const s = await raw(request, `/es/sellado/${sealed.representativeItemId}`);
    expect(s.status).toBe(200);
    // Sellado: `<h1>` nombre · set, como raw y gradeada (el sellado no lleva número de carta).
    const [h1s0] = h1s(s.html);
    expect(h1s0).toContain(sealed.productName);
    expect(h1s0).toContain(` · ${sealed.card.setName}`);
    expect(visibleText(s.html)).toMatch(MONEY);

    const o = await raw(request, `/es/catalog/${soldOut!.id}`);
    expect(o.status).toBe(200);
    const [h1o] = h1s(o.html);
    expect(h1o).toContain(soldOut!.name);
    expect(h1o).toContain(soldOut!.setName);
    expect(visibleText(o.html)).toContain(t('es', 'wishlist.card.notHere'));
  });

  /**
   * C3 (criterio 951; MKT-3 (a), HECHOS 2026-10-31). Mutaciones medidas (FRONTEND_NOTES §MKT-CONV2): quitar el
   * `notFound()` de la ficha ⇒ la inexistente vuelve a 200 con el título de la portada; quitar `soldOutOfferJsonLd` ⇒
   * la agotada pierde `offers`.
   */
  test('@real C3 · ficha inexistente ⇒ 404 con su propio título; agotada ⇒ 200, «Agotada», OutOfStock sin precio, indexable', async ({
    request,
  }) => {
    const home = await raw(request, '/es');
    const homeTitle = headTag(home.html, /<title>([^<]*)<\/title>/);
    for (const path of ['/es/catalog/00000000-0000-0000-0000-000000000000', '/en/catalog/00000000-0000-0000-0000-000000000000', '/es/sellado/00000000-0000-0000-0000-000000000000']) {
      const r = await raw(request, path);
      expect(r.status, path).toBe(404);
      const title = headTag(r.html, /<title>([^<]*)<\/title>/);
      expect(title, `${path}: título propio`).toBeTruthy();
      expect(title, `${path}: no es el de la portada`).not.toBe(homeTitle);
      expect(r.html, `${path}: noindex`).toMatch(/<meta name="robots" content="[^"]*noindex/);
    }

    const cards = await api<{ data: Group[] }>('/catalog/cards?pageSize=50');
    const listed = new Set(cards.data.map((g) => g.card.id));
    const candidates = (await api<{ data: { id: string }[] }>('/buylist/cards?q=E2E&pageSize=50')).data;
    let soldOutId: string | undefined;
    for (const c of candidates.filter((x) => !listed.has(x.id))) {
      const d = await api<{ listings: unknown[] }>(`/catalog/cards/${c.id}`);
      if (d.listings.length === 0) {
        soldOutId = c.id;
        break;
      }
    }
    expect(soldOutId, 'hay una carta sin piezas a la venta').toBeTruthy();
    const o = await raw(request, `/es/catalog/${soldOutId}`);
    expect(o.status).toBe(200);
    expect(visibleText(o.html)).toContain(t('es', 'catalog.soldOutCard'));
    expect(o.html).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
    const [product] = ldNodes(o.html, 'Product');
    const offer = product.offers as Record<string, unknown>;
    expect(offer.availability).toBe('https://schema.org/OutOfStock');
    expect(offer).not.toHaveProperty('price');
  });

  /** B2 (criterios 944–946, MKT-CONV.6 L-6/L-7) y C6/C8 (954, 956) en el HTML crudo. */
  test('@real B2 · /es y /en/nosotros: 200, un h1, Organization+contactPoint+sameAs, sin huecos; en el sitemap; enlazada en pie y franja', async ({
    request,
  }) => {
    for (const locale of ['es', 'en'] as const) {
      const r = await raw(request, `/${locale}/nosotros`);
      expect(r.status, locale).toBe(200);
      expect(h1s(r.html), locale).toEqual([t(locale, 'about.title')]);
      expect(r.html).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
      const [org] = ldNodes(r.html, 'Organization');
      expect(org.sameAs).toEqual(['https://www.instagram.com/tcghunt.mx/']);
      expect(org.contactPoint).toMatchObject({ '@type': 'ContactPoint', areaServed: 'MX', availableLanguage: ['es', 'en'] });
      const text = visibleText(r.html);
      expect(text).not.toMatch(/DATO DEL DUEÑO|EJEMPLO/);
      expect(text).toContain(t(locale, 'about.buy.deliveryValue'));
      // L-7: ninguna fila con valor vacío.
      for (const m of r.html.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)) expect(visibleText(`<body>${m[1]}`)).not.toBe('');
      // El pie enlaza «Quiénes somos y contacto» en los dos idiomas (L-6).
      const home = await raw(request, `/${locale}`);
      expect(home.html).toContain(`href="/${locale}/nosotros"`);
      expect(visibleText(home.html)).toContain(t(locale, 'seo.nav.about'));
    }
    const sm = await (await request.get('/sitemap.xml')).text();
    expect(sm).toMatch(/<loc>[^<]*\/es\/nosotros<\/loc>\s*<lastmod>/);

    // La franja de la ficha enlaza a una ruta que responde 200 (L-6).
    const cards = await api<{ data: Group[] }>('/catalog/cards?pageSize=1');
    const ficha = await raw(request, `/es/catalog/${cards.data[0].card.id}`);
    const strip = /data-testid="about-strip"[\s\S]*?<\/p>/.exec(ficha.html)?.[0] ?? '';
    const href = /href="([^"]+)"/.exec(strip)?.[1];
    expect(href).toBe('/es/nosotros');
    expect((await request.get(href!, { maxRedirects: 0 })).status()).toBe(200);
  });

  test('@real C8/C6 · sin «IVA» en meta-descripciones ni en llms.txt; llms.txt enlaza Instagram y Quiénes somos', async ({
    request,
  }) => {
    const cards = await api<{ data: Group[] }>('/catalog/cards?pageSize=1');
    const sealed = (await api<{ data: { representativeItemId: string }[] }>('/catalog/sealed')).data[0];
    for (const locale of ['es', 'en'] as const) {
      for (const p of ['', '/catalog', `/catalog/${cards.data[0].card.id}`, '/sellado', `/sellado/${sealed.representativeItemId}`, '/buylist', '/nosotros', '/preguntas', '/como-funciona', '/terminos']) {
        const { html } = await raw(request, `/${locale}${p}`);
        for (const re of [/<meta name="description" content="([^"]*)"/, /<meta property="og:description" content="([^"]*)"/]) {
          const d = headTag(html, re);
          // Palabra completa: «privacidad»/«privacy» contienen «iva» y no son el impuesto.
          if (d) expect(d, `${locale}${p}`).not.toMatch(/\biva\b|\bvat\b|16 ?%/i);
        }
      }
    }
    const llms = await (await request.get('/llms.txt')).text();
    expect(llms).not.toMatch(/\biva\b/i);
    expect(llms).toContain('https://www.instagram.com/tcghunt.mx/');
    expect(llms).toMatch(/\[Quiénes somos y contacto\]\([^)]*\/es\/nosotros\)/);
  });

  test('@real C1 · la ficha no vuelve a pedir en el navegador lo que mandó el servidor', async ({ page }) => {
    const cards = await api<{ data: Group[] }>('/catalog/cards?pageSize=5');
    const id = cards.data[0].card.id;
    const reads: string[] = [];
    page.on('request', (r) => {
      if (new RegExp(`/api/v1/catalog/cards/${id}(\\?|$)`).test(r.url())) reads.push(r.url());
    });
    const hydration = hydrationErrors(page);
    await page.goto(`/es/catalog/${id}`);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(cards.data[0].card.name) })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(reads, 'lecturas de la ficha desde el navegador').toEqual([]);
    expect(hydration, 'errores de hidratación').toEqual([]);
  });

  test('@real C2 · el catálogo tampoco repite en el navegador la página que mandó el servidor', async ({
    page,
    request,
  }) => {
    // B-R2 (§MKT-R2B): la vista relee SOLO si la copia de la caché de datos tiene > 30 s. Esta prueba mide la carga
    // FRESCA: se calienta antes (la primera visita puede servir una copia vencida y releerla en segundo plano), para que
    // el resultado no dependa de cuánto tiempo pasó desde la última visita de otra prueba. La copia vieja la cubre
    // `e2e/catalog-freshness.spec.ts`.
    await request.get('/es/catalog');
    await page.waitForTimeout(1500);
    await request.get('/es/catalog');
    const reads: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/v1\/catalog\/cards(\?|$)/.test(r.url())) reads.push(r.url());
    });
    const hydration = hydrationErrors(page);
    await page.goto('/es/catalog');
    await expect(page.locator('a[href^="/es/catalog/"]').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(reads, 'lecturas de la rejilla desde el navegador').toEqual([]);
    expect(hydration, 'errores de hidratación').toEqual([]);
  });

  test('@real C2 · catálogo y portada con <a href> a fichas; ?page= lo pide el servidor', async ({ request }) => {
    const first = await api<{ data: Group[]; total: number; pageSize: number }>('/catalog/cards?sort=newest');
    expect(first.total).toBeGreaterThan(0);

    const cat = await raw(request, '/es/catalog');
    expect(cat.status).toBe(200);
    const catLinks = new Set([...cat.html.matchAll(UUID_LINK)].map((m) => m[0]));
    expect(catLinks.size, 'enlaces a fichas en /es/catalog').toBeGreaterThan(0);
    for (const g of first.data) expect(cat.html).toContain(`href="/es/catalog/${g.card.id}"`);
    expect(visibleText(cat.html)).not.toContain(t('es', 'catalog.emptyTitle'));
    // Criterio 950: no dice «Sin publicaciones disponibles» (la rama `=0` del conteo) si hay publicaciones.
    const zeroCount = /=0 \{([^}]*)\}/.exec(t('es', 'catalog.piecesAvailable'))![1];
    expect(visibleText(cat.html)).not.toContain(zeroCount);

    const home = await raw(request, '/es');
    expect([...home.html.matchAll(UUID_LINK)].length, 'enlaces a fichas en /es').toBeGreaterThan(0);

    // `?page=2`: el servidor pide la página 2 (la API dice qué trae) y el HTML la refleja.
    const second = await api<{ data: Group[] }>('/catalog/cards?sort=newest&page=2');
    const p2 = await raw(request, '/es/catalog?page=2');
    expect(p2.status).toBe(200);
    const p2Ids = new Set([...p2.html.matchAll(/href="\/es\/catalog\/([0-9a-f-]{36})"/g)].map((m) => m[1]));
    expect([...p2Ids].sort()).toEqual([...new Set(second.data.map((g) => g.card.id))].sort());
    if (first.total > first.pageSize) {
      // Con más de una página, el paginador es un enlace rastreable.
      expect(cat.html).toMatch(/href="\/es\/catalog\?page=2"/);
    } else {
      test.info().annotations.push({
        type: 'C2',
        description: `seed con ${first.total} grupos ≤ ${first.pageSize}: sin paginador (lo cubre Paginator.c2.test.tsx)`,
      });
    }
  });

  test('@real C4 · las páginas públicas tienen título y descripción propios y canonical', async ({ request }) => {
    const cards = await api<{ data: Group[] }>('/catalog/cards?pageSize=1');
    const sealed = (await api<{ data: { representativeItemId: string }[] }>('/catalog/sealed')).data[0];
    const paths = [
      '/es',
      '/es/catalog',
      `/es/catalog/${cards.data[0].card.id}`,
      '/es/sellado',
      `/es/sellado/${sealed.representativeItemId}`,
      '/es/accesorios',
      '/es/decks-meta',
      '/es/buylist',
      '/es/terminos',
      '/es/privacidad',
      '/es/preguntas',
      '/es/como-funciona',
      '/es/guias',
      '/es/nosotros',
    ];
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const p of paths) {
      const { status, html } = await raw(request, p);
      expect(status, p).toBe(200);
      const title = headTag(html, /<title>([^<]*)<\/title>/);
      const desc = headTag(html, /<meta name="description" content="([^"]*)"/);
      const canonical = headTag(html, /<link rel="canonical" href="([^"]*)"/);
      expect(title, `${p} title`).toBeTruthy();
      expect(desc, `${p} description`).toBeTruthy();
      expect(canonical, `${p} canonical`).toMatch(/^https?:\/\//);
      expect(titles.get(title!), `${p} repite el título de ${titles.get(title!)}`).toBeUndefined();
      expect(descriptions.get(desc!), `${p} repite la descripción de ${descriptions.get(desc!)}`).toBeUndefined();
      titles.set(title!, p);
      descriptions.set(desc!, p);
    }
  });

  test('@real C5 · Product completo: itemCondition, brand, shippingDetails con la regla vigente y devoluciones', async ({
    request,
  }) => {
    const rule = await api<{ cardsOnlyFeeCents: number; sealedFeeCents: number; freeFromCents: number }>(
      '/checkout/shipping-rule',
    );
    const cards = await api<{ data: Group[] }>('/catalog/cards?pageSize=50');
    const g = cards.data.find((x) => x.productType === 'raw' && x.displayPriceCents != null)!;
    const sealed = (await api<{ data: { representativeItemId: string }[] }>('/catalog/sealed')).data[0];
    for (const [path, kind] of [
      [`/es/catalog/${g.card.id}`, 'card'],
      [`/es/sellado/${sealed.representativeItemId}`, 'sealed'],
    ] as const) {
      const { html } = await raw(request, path);
      const [product] = ldNodes(html, 'Product');
      expect(product, path).toBeTruthy();
      expect(product.brand).toEqual({ '@type': 'Brand', name: 'Pokémon' });
      const offer = product.offers as Record<string, unknown>;
      expect(offer.itemCondition).toBe(
        kind === 'sealed' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
      );
      const price = Math.round(Number(offer.price) * 100);
      const fee = price >= rule.freeFromCents ? 0 : kind === 'sealed' ? rule.sealedFeeCents : rule.cardsOnlyFeeCents;
      const ship = offer.shippingDetails as { shippingRate: { value: string; currency: string }; shippingDestination: unknown };
      expect(ship.shippingRate).toEqual({ '@type': 'MonetaryAmount', value: (fee / 100).toFixed(2), currency: 'MXN' });
      expect(ship.shippingDestination).toEqual({ '@type': 'DefinedRegion', addressCountry: 'MX' });
      expect(offer.hasMerchantReturnPolicy).toEqual({
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'MX',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
      });
    }
  });

  test('@real C6 · portada con WebSite + SearchAction y logo; hreflang x-default a una URL 200; lastmod real', async ({
    request,
  }) => {
    const home = await raw(request, '/es');
    const [site] = ldNodes(home.html, 'WebSite');
    expect(site, 'WebSite en la portada').toBeTruthy();
    const action = site.potentialAction as { target: { urlTemplate: string } };
    expect(action.target.urlTemplate).toMatch(/\/es\/catalog\?q=\{search_term_string\}$/);
    const [org] = ldNodes(home.html, 'Organization');
    expect(String(org.logo)).toMatch(/\/apple-icon\.png$/);
    const logo = await request.get(new URL(String(org.logo)).pathname, { maxRedirects: 0 });
    expect(logo.status()).toBe(200);

    // hreflang en el <head>; x-default = la versión `es`, que responde 200 sin redirigir.
    const xdef = headTag(home.html, /<link rel="alternate" hrefLang="x-default" href="([^"]*)"/i);
    expect(xdef).toBeTruthy();
    const xres = await request.get(new URL(xdef!).pathname, { maxRedirects: 0 });
    expect(xres.status()).toBe(200);
    // Y ya no viaja el `Link` de next-intl con el x-default que redirigía (307).
    const head = await request.get('/es/catalog', { maxRedirects: 0 });
    expect(head.headers()['link'] ?? '').not.toContain('x-default');

    // Sitemap: las páginas fijas sin una fecha medible (buylist, accesorios, términos) salen SIN `lastmod`; antes
    // llevaban la hora en que se generó el sitemap. (Las que sí tienen fuente las fija `sitemap-robots.test.ts`.)
    const sm = await (await request.get('/sitemap.xml')).text();
    const entries = new Map(
      [...sm.matchAll(/<url>\s*<loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)].map((m) => [m[1], m[2]] as const),
    );
    for (const p of ['/es/buylist', '/es/accesorios', '/es/terminos']) {
      const key = [...entries.keys()].find((k) => k.endsWith(p));
      expect(key, `${p} en el sitemap`).toBeTruthy();
      expect(entries.get(key!), `${p} sin lastmod`).not.toContain('<lastmod>');
    }
  });
});
