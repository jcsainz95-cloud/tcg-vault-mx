import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { measurementCookies, recordRequests, type RequestLog } from './utils/measurement';
import { loginAs } from './utils/auth';
import { gradingScenario } from './utils/grading';

/**
 * Fase 2 con el modo ENCENDIDO — corre SOLO con `playwright.measurement-on.config.ts`, que construye
 * un bundle de MOCKS con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, IDs de prueba y una versión de aviso de
 * E2E (solo se hornea en builds de mocks). ⛔ Nada sale de CI: toda petición a Google/Meta se
 * intercepta y se responde vacía AQUÍ; se cuenta, no se envía.
 *
 * Candados: C-F3 (cuatro caminos de red + capturas 390×664), C-F5 (navegación dura, v1.109 también
 * `/buylist` → paso de crear con CLABE/INE), C-F9 (`/card-show`: solo `page_view` a GA4, sin Meta), C-F10 (sin muro),
 * C-F11 (no tapa COMPRAR), C-F12 / L-1 (altura, MKT-CONV.6), L-2 (mismo peso), L-3 (COMPRAR visible), L-5 (portada sin
 * desborde), L-8 (943: dos tejas con el banner), L-9 (ficha lg), L-10 (teja ≥ sm intacta), C-F19 (zoom). Los de unidad (C-F8/9/13/14/18) viven en
 * `src/components/consent/ConsentBanner.test.tsx`.
 */

const THIRD_PARTY_RE = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com|facebook\.net/;

async function interceptThirdParties(context: BrowserContext) {
  await context.route(THIRD_PARTY_RE, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* interceptado por el E2E */' }),
  );
  await context.route(/\/measurement\/banner-response/, (route) => route.fulfill({ status: 204, body: '' }));
}

async function setup(context: BrowserContext): Promise<RequestLog> {
  await interceptThirdParties(context);
  return recordRequests(context);
}

const banner = (page: Page) => page.getByRole('region', { name: t('es', 'consent.region') });
const kinds = (log: RequestLog) => new Set(log.measurement.map((m) => m.kind));

async function firstCardHref(page: Page): Promise<string> {
  await page.goto('/es/catalog');
  const href = await page.locator('a[href*="/catalog/"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  return href!;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

test.describe('C-F3 · cuatro caminos de red', () => {
  test('sin responder ⇒ 0 peticiones de medición y sin cookies de medición', async ({ page, context }) => {
    const log = await setup(context);
    await page.goto('/es?utm_source=ig&utm_medium=story');
    await expect(banner(page)).toBeVisible();
    await page.goto(await firstCardHref(page));
    await settle(page);
    expect(log.measurement).toEqual([]);
    expect(await measurementCookies(context)).toEqual([]);
    // MKT.H.13 (v1.105): ocultar la pestaña sin responder ⇒ UN `no_response` por documento y 0 escrituras de
    // medición en storage. (`page.goto` ya pudo contar uno del documento anterior: se cuenta desde aquí.)
    const sentBefore = log.bannerResponses.length;
    const storage = await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      const keys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i) ?? '');
      return [...keys(window.sessionStorage), ...keys(window.localStorage)].filter((k) => /^th_|consent|banner|measurement/i.test(k));
    });
    expect(storage).toEqual([]);
    await expect.poll(() => log.bannerResponses.slice(sentBefore).map((b) => (b.body as { response: string }).response)).toEqual([
      'no_response',
    ]);
    expect(log.bannerResponses.every((b) => (b.body as { response: string }).response === 'no_response')).toBe(true);
  });

  test('«Solo lo necesario» ⇒ 0 peticiones y solo th_consent', async ({ page, context }) => {
    const log = await setup(context);
    await page.goto('/es?utm_source=ig');
    await banner(page).getByRole('button', { name: t('es', 'consent.necessary') }).click();
    await expect(banner(page)).toHaveCount(0);
    await page.goto(await firstCardHref(page));
    await settle(page);
    expect(log.measurement).toEqual([]);
    expect(await measurementCookies(context)).toEqual(['th_consent']);
    expect(log.bannerResponses.map((b) => b.body)).toEqual([{ response: 'necessary_only' }]);
  });

  test('solo analítica ⇒ Google sí, Meta 0; th_first_utm escrito', async ({ page, context }) => {
    const log = await setup(context);
    await page.goto('/es?utm_source=ig&utm_medium=story');
    await banner(page).getByRole('button', { name: t('es', 'consent.customize') }).click();
    const dialog = page.getByRole('dialog', { name: t('es', 'consent.layer.title') });
    await dialog.getByRole('switch', { name: t('es', 'consent.layer.analytics.title') }).click();
    await dialog.getByRole('button', { name: t('es', 'consent.layer.save') }).click();
    await expect.poll(() => kinds(log).has('google')).toBe(true);
    await page.goto(await firstCardHref(page));
    await settle(page);
    expect(kinds(log).has('meta')).toBe(false);
    const cookies = await measurementCookies(context);
    expect(cookies).toContain('th_consent');
    expect(cookies).toContain('th_first_utm');
    expect(log.bannerResponses.map((b) => b.body)).toEqual([{ response: 'custom', utmMedium: 'story' }]);
  });

  test('«Aceptar» ⇒ Google y Meta', async ({ page, context }) => {
    const log = await setup(context);
    await page.goto('/es');
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    await expect.poll(() => kinds(log).has('google') && kinds(log).has('meta')).toBe(true);
    expect(log.bannerResponses.map((b) => b.body)).toEqual([{ response: 'accept' }]);
  });

  test('capturas 390×664 (criterio 1 de D3b): portada y ficha con el banner abierto', async ({ page, context }, testInfo) => {
    await setup(context);
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto('/es');
    await expect(banner(page)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('d3b-portada-390x664.png') });
    await page.goto(await firstCardHref(page));
    await expect(page.getByTestId('mobile-buy-bar')).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('d3b-ficha-390x664.png') });
  });
});

/**
 * C-F3 con `?q=` (API_CONTRACT §MKT.H.11 v1.112.2; ARCHITECTURE §14.4 D-MKT2-11; SEC-MED-1). El término de
 * búsqueda no sale hacia Google ni Meta: (a) aterrizar en `/es/catalog?q=pikachu` ⇒ `fbevents.js` no se pide,
 * `window.fbq` no existe y `gtag` sí carga; (b) buscar «pikachu» desde `/es/catalog` limpio y agregar ⇒ 0 llamadas
 * nuevas en `fbq.queue`; (c) en todos, cada `event` de `dataLayer` lleva `page_location` sin `q`, y ni `dataLayer`,
 * ni `fbq.queue`, ni la URL o el cuerpo de una petición a host de medición contienen `pikachu`; (d) abrir después
 * una ficha ⇒ `fbevents.js` carga. Más (b′): `?q=` añadido a la URL de una ficha con el píxel ya cargado ⇒ ese
 * `add_to_cart` va solo a GA4 (la comprobación se hace en cada llamada a `fbq`; ARCHITECTURE §14.4).
 * Canarios: quitar `page_location` de `track()`, o `isPixelSafeUrl` de `track()`/`loadMeta` ⇒ rojo.
 */
test.describe('C-F3 · ?q= (SEC-MED-1): el término no sale a Google ni a Meta', () => {
  const TERM = 'pikachu';

  /** Petición a host de medición con su cuerpo (la URL ya la cuenta `recordRequests`). */
  function recordBodies(context: BrowserContext): Array<{ url: string; body: string }> {
    const out: Array<{ url: string; body: string }> = [];
    context.on('request', (req) => {
      if (THIRD_PARTY_RE.test(req.url())) out.push({ url: req.url(), body: req.postData() ?? '' });
    });
    return out;
  }

  async function vendorState(page: Page) {
    return page.evaluate(() => {
      const w = window as unknown as { dataLayer?: ArrayLike<unknown>[]; fbq?: { queue?: unknown[] }; gtag?: unknown };
      const dl = (w.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
      return {
        gtag: typeof w.gtag,
        fbq: typeof w.fbq,
        dataLayer: JSON.stringify(dl),
        events: dl
          .filter((a) => a[0] === 'event')
          .map((a) => ({ name: String(a[1]), page_location: ((a[2] ?? {}) as { page_location?: unknown }).page_location ?? null })),
        fbqQueue: w.fbq?.queue ? JSON.stringify(w.fbq.queue) : '',
        fbqLen: w.fbq?.queue?.length ?? 0,
      };
    });
  }

  /** (c) */
  async function expectNoTerm(page: Page, bodies: Array<{ url: string; body: string }>) {
    const st = await vendorState(page);
    expect(st.events.length, 'sin eventos en dataLayer no hay nada que medir').toBeGreaterThan(0);
    for (const e of st.events) {
      expect(typeof e.page_location, `${e.name} sin page_location`).toBe('string');
      expect(e.page_location as string, `${e.name} con q en page_location`).not.toMatch(/[?&]q=/);
    }
    expect(st.dataLayer).not.toContain(TERM);
    expect(st.fbqQueue).not.toContain(TERM);
    for (const b of bodies) {
      expect(b.url, 'URL de una petición a host de medición').not.toContain(TERM);
      expect(b.body, `cuerpo de ${b.url}`).not.toContain(TERM);
    }
    return st;
  }

  const fbeventsRequested = (log: RequestLog) => log.measurement.some((m) => /fbevents\.js/.test(m.url));
  const gtagRequested = (log: RequestLog) => log.measurement.some((m) => /gtag\/js/.test(m.url));

  test('(a)+(c)+(d) aterrizar en /es/catalog?q=pikachu ⇒ gtag sí, fbq no; abrir una ficha ⇒ fbevents.js carga', async ({ page, context }) => {
    const log = await setup(context);
    const bodies = recordBodies(context);
    const href = await firstCardHref(page);
    await page.goto(`/es/catalog?q=${TERM}`);
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    await expect.poll(() => gtagRequested(log)).toBe(true);
    await expect.poll(async () => (await vendorState(page)).events.some((e) => e.name === 'page_view')).toBe(true);
    await settle(page);
    // (a)
    const st = await expectNoTerm(page, bodies);
    expect(st.gtag).toBe('function');
    expect(st.fbq).toBe('undefined');
    expect(fbeventsRequested(log)).toBe(false);
    expect(await page.locator('script[data-th-measurement="meta"]').count()).toBe(0);
    // (d) navegación de cliente a una ficha (URL limpia, referente vacío) ⇒ el proveedor reintenta y Meta carga.
    await page.evaluate((u) => (window as unknown as { next: { router: { push: (x: string) => void } } }).next.router.push(u), href);
    await page.waitForURL((u) => u.pathname === href);
    await expect.poll(() => fbeventsRequested(log)).toBe(true);
    await expect.poll(async () => (await vendorState(page)).fbq).toBe('function');
    await settle(page);
    await expectNoTerm(page, bodies);
  });

  test('(b)+(c) buscar «pikachu» desde /es/catalog limpio y agregar ⇒ 0 llamadas nuevas en fbq.queue', async ({ page, context }) => {
    const log = await setup(context);
    const bodies = recordBodies(context);
    await page.goto('/es/catalog');
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    // Con carga alta la descarga tardó > 15 s una vez (1/30, load ≈ 10 en 4 CPU): 30 s, no es conducta.
    await expect.poll(() => fbeventsRequested(log) && gtagRequested(log), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await vendorState(page)).fbq).toBe('function');
    await settle(page);
    const before = (await vendorState(page)).fbqLen;
    await page.getByRole('searchbox', { name: t('es', 'catalog.searchPlaceholder') }).first().fill(TERM);
    await expect(page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first()).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
    await settle(page);
    const st = await expectNoTerm(page, bodies);
    expect(st.fbqLen - before).toBe(0);
  });

  test('(b′)+(c) ficha con el píxel cargado y ?q= añadido después ⇒ add_to_cart solo a GA4, page_location sin q', async ({ page, context }) => {
    const log = await setup(context);
    const bodies = recordBodies(context);
    await page.setViewportSize({ width: 390, height: 844 });
    const href = await firstCardHref(page);
    await page.goto(href);
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    // Con carga alta la descarga tardó > 15 s una vez (1/30, load ≈ 10 en 4 CPU): 30 s, no es conducta.
    await expect.poll(() => fbeventsRequested(log) && gtagRequested(log), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await vendorState(page)).fbq).toBe('function');
    await settle(page);
    const before = await vendorState(page);
    await page.evaluate((term) => window.history.replaceState(window.history.state, '', `${window.location.pathname}?q=${term}`), TERM);
    expect(new URL(page.url()).searchParams.get('q')).toBe(TERM);
    await page.getByTestId('mobile-buy-bar').getByRole('button', { name: t('es', 'catalog.addToCart') }).click();
    await expect
      .poll(async () => (await vendorState(page)).events.filter((e) => e.name === 'add_to_cart').length)
      .toBe(before.events.filter((e) => e.name === 'add_to_cart').length + 1);
    await settle(page);
    const st = await expectNoTerm(page, bodies);
    expect(st.fbqLen - before.fbqLen).toBe(0);
  });
});

test.describe('C-F5 · navegación dura hacia rutas excluidas', () => {
  // v1.109: `/es/buylist` ya es medida (D-MKT2-8); excluido queda su PASO de crear (CLABE/INE).
  const EXCLUDED = ['/es/account', '/es/vault', '/es/admin', '/es/buylist/solicitud', '/es/reset-password', '/es/pedido?token=mock-demo-token'];

  async function acceptOnCard(page: Page, context: BrowserContext) {
    const log = await setup(context);
    const href = await firstCardHref(page);
    await page.goto(href);
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('function');
    // El stub se define en el acto, pero la descarga de gtag.js/fbevents.js sale un instante después.
    // Sin esperarla, esa petición (de la FICHA) caía después del corte `before` y se contaba como de la
    // ruta excluida: medido 3/170 rojos con N=10 sobre 4bb23ff2, documento final limpio en los tres.
    await expect.poll(() => kinds(log).has('google') && kinds(log).has('meta')).toBe(true);
    await settle(page);
    return { log, href };
  }

  async function expectCleanDocument(page: Page) {
    const state = await page.evaluate(() => ({
      gtag: typeof (window as unknown as { gtag?: unknown }).gtag,
      fbq: typeof (window as unknown as { fbq?: unknown }).fbq,
      scripts: [...document.scripts].filter((s) => /googletagmanager|connect\.facebook\.net/.test(s.src)).length,
      marked: document.querySelectorAll('script[data-th-measurement]').length,
    }));
    expect(state).toEqual({ gtag: 'undefined', fbq: 'undefined', scripts: 0, marked: 0 });
  }

  for (const target of EXCLUDED) {
    test(`router.push a ${target} sin recargar ⇒ documento sin etiquetas y 0 peticiones después`, async ({ page, context }) => {
      const { log } = await acceptOnCard(page, context);
      const before = log.measurement.length;
      // Marca en el documento de la ficha: si la navegación NO es dura, la marca sobrevive.
      await page.evaluate(() => ((window as unknown as { __cf5?: number }).__cf5 = 1));
      await page
        .evaluate((url) => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push(url), target)
        .catch(() => undefined); // el documento puede irse a mitad de la llamada (es lo que se busca)
      // (Una ruta protegida puede redirigir a /login: también excluida; lo que importa es salir de la ficha.)
      await page.waitForURL((u) => !u.pathname.startsWith('/es/catalog'));
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __cf5?: number }).__cf5 ?? 0).catch(() => -1), {
          message: 'el documento de la ficha sigue vivo en la ruta excluida (navegación sin recarga)',
        })
        .toBe(0);
      await settle(page);
      await expectCleanDocument(page);
      expect(log.measurement.slice(before)).toEqual([]);
    });
  }

  // v1.109: «Vender» lleva a `/buylist`, que ya se mide; el enlace excluido del encabezado es «Decks».
  test('clic en un enlace del encabezado (Decks) y del pie (Términos) ⇒ documento nuevo sin etiquetas', async ({ page, context }) => {
    const { log, href } = await acceptOnCard(page, context);
    let before = log.measurement.length;
    await page.locator('header').getByRole('link', { name: t('es', 'nav.decksMeta') }).first().click();
    await page.waitForURL(/\/es\/decks-meta/);
    await settle(page);
    await expectCleanDocument(page);
    expect(log.measurement.slice(before)).toEqual([]);

    const scriptsBefore = log.measurement.filter((m) => /gtag\/js|fbevents/.test(m.url)).length;
    await page.goto(href);
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('function');
    // Misma espera que en `acceptOnCard`: las dos descargas de ESTA ficha antes del corte.
    await expect.poll(() => log.measurement.filter((m) => /gtag\/js|fbevents/.test(m.url)).length).toBeGreaterThanOrEqual(scriptsBefore + 2);
    await settle(page);
    before = log.measurement.length;
    await page.locator('footer').getByRole('link', { name: t('es', 'nav.terms') }).click();
    await page.waitForURL(/\/es\/terminos/);
    await settle(page);
    await expectCleanDocument(page);
    expect(log.measurement.slice(before)).toEqual([]);
  });
});

/**
 * C-F5 ampliado (v1.109, D-MKT2-8): desde `/buylist` (medida) al PASO que pinta CLABE e INE. El documento final
 * no tiene `gtag`/`fbq` ni `<script>` de medición, y nada sale después. La mitad de unidad (el cotizador no
 * pinta `BuylistKycForm`; `location.assign`) es `buylist/solicitud/SellRequestStep.cf5.test.tsx`.
 */
test.describe('C-F5 · /buylist → paso de crear (CLABE/INE)', () => {
  test('con etiquetas cargadas en el cotizador, «Enviar solicitud» llega a un documento sin medición', async ({ page, context }) => {
    test.slow();
    const log = await setup(context);
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('function');
    await expect.poll(() => kinds(log).has('google') && kinds(log).has('meta')).toBe(true);
    // El cotizador se mide y manda su `page_view` (solo GA4).
    await expect
      .poll(() =>
        page.evaluate(() =>
          ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).some((a) => a[0] === 'event' && a[1] === 'page_view'),
        ),
      )
      .toBe(true);
    await settle(page);

    await page.getByLabel(t('es', 'masterSet.searchSet')).fill('Base');
    await page.getByRole('button', { name: /Base Set/ }).first().click();
    await page.getByRole('button', { name: /^Agregar Charizard \(Normal\) a la venta/ }).click();
    const trigger = page.getByTestId('sell-cart-fab').or(page.getByTestId('sell-cart-bar-open')).filter({ visible: true });
    await trigger.click();
    // El veredicto de INE (debounce de 400 ms + consulta) inserta una línea en los requisitos del cajón y BAJA el CTA:
    // un clic antes de eso cae donde estaba el botón (medido: 1/10 rojos con N=10 sobre `0066d9e6`, cajón abierto y
    // «Enviar solicitud» con foco pero sin navegación). En el mock el total de Charizard siempre exige INE.
    await expect(page.getByText(t('es', 'buylist.reqIneExpected')).first()).toBeVisible();
    const before = log.measurement.length;
    await page.evaluate(() => ((window as unknown as { __cf5?: number }).__cf5 = 1));
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();
    await page.waitForURL(/\/es\/buylist\/solicitud$/);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __cf5?: number }).__cf5 ?? 0).catch(() => -1), {
        message: 'el documento del cotizador sigue vivo en el paso de crear (navegación sin recarga)',
      })
      .toBe(0);
    const step = page.getByRole('region', { name: t('es', 'buylist.requestTitle') });
    await expect(step.getByLabel(/CLABE/)).toBeVisible();
    await settle(page);
    const state = await page.evaluate(() => ({
      gtag: typeof (window as unknown as { gtag?: unknown }).gtag,
      fbq: typeof (window as unknown as { fbq?: unknown }).fbq,
      scripts: [...document.scripts].filter((s) => /googletagmanager|connect\.facebook\.net/.test(s.src)).length,
      marked: document.querySelectorAll('script[data-th-measurement]').length,
    }));
    expect(state).toEqual({ gtag: 'undefined', fbq: 'undefined', scripts: 0, marked: 0 });
    expect(log.measurement.slice(before)).toEqual([]);
  });
});

/**
 * C-F9 (v1.109, D-MKT2-9): `/card-show` (fuera de `[locale]`) honra una elección ya guardada y manda SOLO
 * `page_view` a GA4; `fbevents.js` no carga aunque se haya aceptado la publicidad (P-CS-MEDIR-1). Sin elección,
 * nada. Las páginas con token (`confirm`…) quedan fuera.
 */
test.describe('C-F9 · /card-show: solo page_view a GA4, sin Meta', () => {
  const vendorCalls = (page: Page) =>
    page.evaluate(() =>
      ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [])
        .map((a) => Array.from(a as ArrayLike<unknown>))
        .filter((a) => a[0] === 'event')
        .map((a) => a[1]),
    );

  test('aceptado todo en la tienda ⇒ en /card-show GA4 con page_view y nada más; 0 peticiones a Meta, sin fbq', async ({ page, context }) => {
    const log = await setup(context);
    await page.goto('/es');
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    await expect.poll(() => kinds(log).has('meta')).toBe(true);
    await settle(page);

    const before = log.measurement.length;
    await page.goto('/card-show');
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('function');
    await expect.poll(() => vendorCalls(page)).toEqual(['page_view']);
    // Interacción con un formulario de la landing: ningún evento nuevo.
    await page.locator('#registro').scrollIntoViewIfNeeded();
    await page.locator('#registro input').first().fill('Ash').catch(() => undefined);
    await settle(page);
    expect(await vendorCalls(page)).toEqual(['page_view']);
    const after = log.measurement.slice(before);
    expect(after.filter((m) => m.kind === 'meta')).toEqual([]);
    expect(after.some((m) => /gtag\/js/.test(m.url))).toBe(true);
    expect(await page.evaluate(() => typeof (window as unknown as { fbq?: unknown }).fbq)).toBe('undefined');
  });

  test('sin elección guardada ⇒ en /card-show no se carga nada (la landing no pregunta)', async ({ page, context }) => {
    const log = await setup(context);
    await page.goto('/card-show');
    await settle(page);
    expect(log.measurement).toEqual([]);
    expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('undefined');
    expect(await measurementCookies(context)).toEqual([]);
  });

  test('las páginas con token del Card Show no cargan nada aunque haya elección', async ({ page, context }) => {
    const log = await setup(context);
    await page.goto('/es');
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    await expect.poll(() => kinds(log).has('google')).toBe(true);
    await settle(page);
    const before = log.measurement.length;
    await page.goto('/card-show/confirm?token=mock-x');
    await settle(page);
    expect(log.measurement.slice(before)).toEqual([]);
    expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('undefined');
  });
});

test.describe('C-F10 · sin muro', () => {
  test('con el banner abierto se navega, se agrega al carrito y se llega al checkout; sin scrim ni bloqueo', async ({ page, context }) => {
    await setup(context);
    await page.goto('/es/catalog');
    await expect(banner(page)).toBeVisible();
    const wall = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement).overflow;
      const body = getComputedStyle(document.body).overflow;
      const modal = document.querySelectorAll('[aria-modal="true"]').length;
      const scrims = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
        const s = getComputedStyle(el);
        return s.position === 'fixed' && s.top === '0px' && s.left === '0px' && s.right === '0px' && s.bottom === '0px';
      }).length;
      return { html, body, modal, scrims };
    });
    expect(wall.html).not.toBe('hidden');
    expect(wall.body).not.toBe('hidden');
    expect(wall.modal).toBe(0);
    expect(wall.scrims).toBe(0);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
    await page.goto('/es/checkout');
    await expect(page.getByTestId('amount-breakdown')).toBeVisible();
    await expect(banner(page)).toBeVisible();
  });
});

test.describe('C-F11 / C-F12 / C-F19 · geometría en móvil', () => {
  test('C-F11: en la ficha de carta el banner va ENCIMA de la barra de COMPRAR y no la tapa', async ({ page, context }) => {
    await setup(context);
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto(await firstCardHref(page));
    const bar = page.getByTestId('mobile-buy-bar');
    await expect(bar).toBeVisible();
    await expect(banner(page)).toBeVisible();
    const geo = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="consent-banner"]')!.getBoundingClientRect();
      const barEl = document.querySelector('[data-testid="mobile-buy-bar"]')!;
      const r = barEl.getBoundingClientRect();
      const btn = barEl.querySelector('button')!;
      const br = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return { bannerBottom: b.bottom, barTop: r.top, hitIsButton: !!hit && (hit === btn || btn.contains(hit)) };
    });
    expect(geo.bannerBottom).toBeLessThanOrEqual(geo.barTop + 0.5);
    expect(geo.hitIsButton).toBe(true);
  });

  // MKT-CONV.6 L-1 (B1, criterio 940): sustituye el techo de 232/120 px de C-F12. Barra delgada ≤ 96 px en móvil
  // (objetivo ≈ 89) y ≤ 64 px a 1366×768 (objetivo ≈ 57). Mutación que lo pone rojo: volver a la fila propia de
  // «Configurar» (FRONTEND_NOTES §MKT-CONV2).
  for (const locale of ['es', 'en'] as const) {
    test(`C-F12 / L-1: alto ≤ 96 px a 360/390/414 y ≤ 64 px a 1366×768 (${locale}) @real`, async ({ page, context }) => {
      await setup(context);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}`);
      const region = page.getByRole('region', { name: t(locale, 'consent.region') });
      await expect(region).toBeVisible();
      for (const [w, h, max] of [[360, 740, 96], [390, 844, 96], [414, 896, 96], [1366, 768, 64]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await expect.poll(async () => (await region.boundingBox())!.height, `alto del banner a ${w}×${h}`).toBeLessThanOrEqual(max);
        testInfo().annotations.push({ type: `alto-${locale}-${w}`, description: String((await region.boundingBox())!.height) });
      }
    });
  }

  // L-2: «Aceptar» y «Solo lo necesario» con el mismo peso visual (D-A = A, HECHOS 2026-10-31). Mutación: `bg-primary`
  // solo en «Aceptar».
  test('L-2: Aceptar y Solo lo necesario, misma caja, mismo fondo, borde y letra; ≥ 44 px en móvil @real', async ({ page, context }) => {
    await setup(context);
    for (const [w, h] of [[390, 844], [1366, 768]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/es');
      await expect(banner(page)).toBeVisible();
      const look = (name: string) =>
        banner(page)
          .getByRole('button', { name })
          .evaluate((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return { h: r.height, w: r.width, bg: s.backgroundColor, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, fs: s.fontSize, fw: s.fontWeight };
          });
      const a = await look(t('es', 'consent.accept'));
      const n = await look(t('es', 'consent.necessary'));
      expect({ bg: a.bg, border: a.border, fs: a.fs, fw: a.fw, h: a.h }).toEqual({ bg: n.bg, border: n.border, fs: n.fs, fw: n.fw, h: n.h });
      if (w < 768) {
        expect(Math.abs(a.w - n.w)).toBeLessThanOrEqual(1);
        expect(a.h).toBeGreaterThanOrEqual(44);
      }
    }
  });

  // L-3 (extiende C-F11): con el banner abierto, «Añadir al carrito» de la barra fija (móvil) y del primer renglón
  // (1366×768) está en pantalla y es lo que recibe el toque. Mutación: devolver la frase de sistema o el `mt-10`.
  test('L-3: con el banner abierto, «Añadir al carrito» se ve y se pulsa (barra en móvil, renglón a 1366×768) @real', async ({ page, context }) => {
    await setup(context);
    await page.setViewportSize({ width: 390, height: 844 });
    const href = await firstCardHref(page);
    const hit = (sel: string) =>
      page.evaluate((s) => {
        const btn = document.querySelector<HTMLElement>(s);
        if (!btn) return { found: false, inView: false, hit: false };
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { found: true, inView: r.top >= 0 && r.bottom <= window.innerHeight, hit: !!el && (el === btn || btn.contains(el)) };
      }, sel);
    for (const [w, h] of [[360, 740], [390, 664], [414, 896]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(href);
      await expect(page.getByTestId('mobile-buy-bar')).toBeVisible();
      await expect(banner(page)).toBeVisible();
      expect(await hit('[data-testid="mobile-buy-bar"] button'), `barra a ${w}×${h}`).toEqual({ found: true, inView: true, hit: true });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(href);
    await expect(banner(page)).toBeVisible();
    await expect(page.getByTestId('instance-cta').first()).toBeVisible();
    expect(await hit('[data-testid="instance-cta"]'), 'renglón a 1366×768').toEqual({ found: true, inView: true, hit: true });
  });

  // L-5 (B5): con el banner abierto la portada no desborda a 360/390/414. El criterio 943 («≥ 2 tarjetas completas con
  // el banner») ya no se anota aquí: lo AFIRMA L-8 (abajo), con el layout de MKT-CONV.8.
  test('L-5: con el banner abierto, portada sin desborde a 360/390/414 @real', async ({ page, context }) => {
    await setup(context);
    for (const [w, h] of [[360, 740], [390, 844], [414, 896]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/es');
      await expect(banner(page)).toBeVisible();
      const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      expect(sw.sw, `portada a ${w}`).toBeLessThanOrEqual(sw.iw);
    }
  });

  test('C-F19: a 200 % de zoom (195×332) max-height ≤ 60vh, scroll interno, botones alcanzables', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 195, height: 332 }, deviceScaleFactor: 2, locale: 'es-MX' });
    await interceptThirdParties(context);
    const page = await context.newPage();
    await page.goto('/es');
    const region = banner(page);
    await expect(region).toBeVisible();
    const m = await region.evaluate((el) => ({ h: el.getBoundingClientRect().height, max: getComputedStyle(el).maxHeight, oy: getComputedStyle(el).overflowY }));
    expect(m.h).toBeLessThanOrEqual(332 * 0.6 + 0.5);
    expect(m.oy).toBe('auto');
    for (const name of [t('es', 'consent.accept'), t('es', 'consent.necessary')]) {
      const b = region.getByRole('button', { name });
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeInViewport();
    }
    await context.close();
  });
});

/**
 * MKT-CONV.6 · L-8 / L-9 / L-10 (DESIGN_SYSTEM §MKT-CONV vMKT-CONV-2). Geometría con el banner ABIERTO (sin responder).
 *
 * PEOR CASO ESCRITO EN EL DOM, y por qué: el seed sintético (`backend/prisma/e2e-fixtures.ts`) no trae nombres de 60
 * ni de 120 caracteres ni un grupo con precio pendiente en la primera página, y frontend no escribe en `backend/`. El
 * peor caso se escribe sobre los nodos REALES que pintó React (mismas clases, mismo contenedor), con lo que el
 * componente pintaría para ese DTO: nombre largo; o «Precio pendiente» (clases de `PendingPriceLabel`) sin rótulo de IVA
 * + «Queda 1». Lo que se mide es el LAYOUT ante ese contenido, que es lo que el diseño promete.
 */
const NAME_60 = 'Pikachu VMAX Rainbow Rare Alternate Art Special Delivery Set'; // 60 caracteres
const NAME_120 =
  'Charizard ex Special Illustration Rare Obsidian Flames Tera Type Darkness Alternate Full Art Gold Secret Hyper Rare 223a'; // 120
const PENDING_CLASSES = 'font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-accent order-1 block';

/** vMKT-CONV-3: precio de 5 cifras (el que partía el renglón precio/stock a 360, +9 px medido). */
const PRICE_5 = 'MX$61,886.00';

type Worst = 'name' | 'pending' | 'price5';

/** Escribe el peor caso en las dos primeras tejas (la primera fila de la rejilla de 2 columnas). */
async function seedWorstTiles(page: Page, worst: Worst, locale: 'es' | 'en') {
  await page.evaluate(
    ({ worst, name, pending, lastOne, pendingClasses, price5 }) => {
      const tiles = [...document.querySelectorAll<HTMLElement>('main a[href*="/catalog/"]')]
        .filter((a) => a.querySelector('img'))
        .slice(0, 2)
        .map((a) => a.parentElement!);
      for (const tile of tiles) {
        const nameLink = tile.querySelector('p.font-serif a');
        if (nameLink) nameLink.textContent = name;
        if (worst === 'name') continue;
        const row = tile.querySelector<HTMLElement>('[data-testid="tile-price-row"]');
        if (!row) continue; // árbol sin MKT-CONV.8: se mide tal cual (con nombre largo) y la prueba lo dirá
        const [price, ...rest] = [...row.children] as HTMLElement[];
        if (worst === 'price5') {
          // Nombre de 120 + «MX$61,886.00» + «Queda 1» (el rótulo de IVA, si lo hay, se queda: es más alto).
          if (price.matches('p.tabular')) price.textContent = price5;
          for (const el of rest) if (!/IVA|VAT/.test(el.textContent ?? '')) el.textContent = lastOne;
          continue;
        }
        const label = document.createElement('span');
        label.className = pendingClasses;
        label.textContent = pending;
        price.replaceWith(label);
        for (const el of rest) {
          if (/IVA|VAT/.test(el.textContent ?? '')) el.remove();
          else el.textContent = lastOne;
        }
      }
    },
    { worst, name: NAME_120, pending: t(locale, 'price.pendingLabel'), lastOne: t(locale, 'stock.lastOne'), pendingClasses: PENDING_CLASSES, price5: PRICE_5 },
  );
}

async function catalogGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect();
    const bannerTop = document.querySelector('[data-testid="consent-banner"]')!.getBoundingClientRect().top;
    const tiles = [...document.querySelectorAll<HTMLElement>('main a[href*="/catalog/"]')]
      .filter((a) => a.querySelector('img'))
      .map((a) => a.parentElement!.getBoundingClientRect());
    const complete = tiles.filter((r) => r.height > 0 && r.top >= header.bottom - 0.5 && r.bottom <= bannerTop - 8 + 0.5).length;
    // Renglón precio/stock de la 1.ª teja: mismo renglón (cajas solapadas) o, si el precio no deja sitio, el stock
    // DEBAJO y a la IZQUIERDA (`flex-wrap`, vMKT-CONV-3 / L-10). Se informa; L-8 lo afirma en el caso `price5`.
    const row = document.querySelector<HTMLElement>('main [data-testid="tile-price-row"]');
    const kids = row ? ([...row.children] as HTMLElement[]).map((k) => k.getBoundingClientRect()) : [];
    const pr = kids[0];
    const sr = kids[kids.length - 1];
    const rowLeft = row?.getBoundingClientRect().left ?? 0;
    const priceRow = !pr || !sr || kids.length < 2
      ? 'absent'
      : sr.top < pr.bottom && sr.bottom > pr.top
        ? 'same'
        : sr.top >= pr.bottom - 0.5 && Math.abs(sr.left - rowLeft) <= 1
          ? 'below-left'
          : 'other';
    return {
      headerBottom: header.bottom,
      bannerTop,
      firstTop: tiles[0]?.top ?? Infinity,
      firstHeights: tiles.slice(0, 2).map((r) => Math.round(r.height * 10) / 10),
      firstBottoms: tiles.slice(0, 2).map((r) => Math.round(r.bottom * 10) / 10),
      complete,
      // Margen del peor de las dos primeras tejas contra el límite de L-8 (`bottom ≤ top(banner) − 8`).
      margin: Math.round((bannerTop - 8 - Math.max(...tiles.slice(0, 2).map((r) => r.bottom))) * 10) / 10,
      priceRow,
    };
  });
}

test.describe('L-8 / L-10 · catálogo con el banner abierto (MKT-CONV.8, PROJECT 943)', () => {
  // L-8. Mutación que lo pone rojo: restaurar el eyebrow o el `py-8` de la rejilla en móvil (FRONTEND_NOTES §MKT-CONV8).
  for (const locale of ['es', 'en'] as const) {
    test(`L-8: ≥ 2 tejas completas a 360/390/414 con nombre de 3 renglones y con precio pendiente + «Queda 1» (${locale}) @real`, async ({ page, context }) => {
      await setup(context);
      for (const [w, h] of [[360, 740], [390, 844], [414, 896]] as const) {
        for (const worst of ['name', 'pending', 'price5'] as const) {
          await page.setViewportSize({ width: w, height: h });
          await page.goto(`/${locale}/catalog`);
          await expect(page.getByTestId('consent-banner')).toBeVisible();
          await page.locator('main a[href*="/catalog/"] img').first().waitFor();
          await settle(page);
          await seedWorstTiles(page, worst, locale);
          const g = await catalogGeometry(page);
          testInfo().annotations.push({ type: `L-8-${locale}-${w}-${worst}`, description: JSON.stringify(g) });
          expect(g.firstTop, `top de la 1ª teja a ${w}×${h} (${worst})`).toBeLessThanOrEqual(250);
          expect(g.complete, `tejas completas a ${w}×${h} (${worst}): ${JSON.stringify(g)}`).toBeGreaterThanOrEqual(2);
          if (worst === 'price5') {
            expect(['same', 'below-left'], `renglón precio/stock con 5 cifras a ${w}: ${JSON.stringify(g)}`).toContain(g.priceRow);
          }
        }
      }
      // 390×664 (viewport de C-F3): solo el arranque de la rejilla; las tejas NO se prometen ahí (MKT-CONV.8).
      await page.setViewportSize({ width: 390, height: 664 });
      await page.goto(`/${locale}/catalog`);
      await expect(page.getByTestId('consent-banner')).toBeVisible();
      await page.locator('main a[href*="/catalog/"] img').first().waitFor();
      const g = await catalogGeometry(page);
      testInfo().annotations.push({ type: `L-8-${locale}-390x664`, description: JSON.stringify(g) });
      expect(g.firstTop).toBeLessThanOrEqual(250);
    });
  }

  // L-8, caso badge (DESIGN_SYSTEM §22.5 «Excepción vigente (2026-11-01)», §MKT-CONV.8 vMKT-CONV-3; HECHOS 2026-11-01
  // «Estimado PSA fuera de la teja del catálogo en celular», «A»). La carta curada trae el estimado PSA elegible (en
  // mocks, Blastoise; en real la siembra `gradingScenario()` por la API, y el `globalTeardown` apaga el dial). En < sm
  // el badge existe en el DOM (presencia ⇔ elegibilidad, R4) pero NO se ve ni se anuncia, la foto es 4:5 y la nota al
  // pie tampoco se ve; en ≥ sm, badge con cifra y micro-aviso visibles, foto 5:7 y nota visible. Mutaciones que lo
  // ponen rojo: quitar `hidden sm:block` del badge en `CatalogTile` (rojo en < sm) o dejarlo `hidden` (rojo en ≥ sm).
  for (const locale of ['es', 'en'] as const) {
    test(`L-8 (badge): sin estimado PSA en la teja < sm y con estimado en ≥ sm (${locale}) @real`, async ({ page, context }) => {
      await setup(context);
      const { curated } = await gradingScenario();
      const tile = page
        .locator('main a[href*="/catalog/"]')
        .filter({ has: page.locator('img') })
        .and(page.locator(`[href$="/catalog/${curated.id}"]`))
        .first()
        .locator('xpath=..');
      const badge = tile.getByTestId('estimate-badge');
      // La 2.ª idea del micro-aviso («no evaluamos esta carta» / «we haven't assessed this card»), su `<b>` literal.
      const idea = [...t(locale, 'catalog.gradingBadge.microNotice').matchAll(/<b>([^<]+)<\/b>/g)][1][1];
      const notice = tile.getByText(idea, { exact: true });
      const facts = () =>
        tile.evaluate((el) => {
          const well = el.querySelector('a')!.firstElementChild!.getBoundingClientRect();
          return { wellW: well.width, wellH: well.height };
        });
      for (const [w, h, below] of [[360, 740, true], [390, 844, true], [414, 896, true], [768, 1024, false], [1366, 768, false]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/${locale}/catalog?q=${encodeURIComponent(curated.name)}`);
        await tile.locator('img').waitFor();
        await settle(page);
        expect(await badge.count(), `el badge se renderiza (la carta es elegible) a ${w}`).toBe(1);
        const f = await facts();
        const snapshot = await tile.ariaSnapshot();
        testInfo().annotations.push({ type: `L-8-badge-${locale}-${w}`, description: JSON.stringify({ ...f, snapshot }) });
        if (below) {
          await expect(badge, `badge a ${w}`).toBeHidden();
          await expect(notice, `micro-aviso a ${w}`).toBeHidden();
          await expect(page.locator('#nota-estimado'), `nota al pie a ${w}`).toBeHidden();
          // Ni la cifra ni el micro-aviso llegan al árbol de accesibilidad de la teja.
          expect(snapshot, `árbol accesible de la teja a ${w}`).not.toMatch(/PSA 10|≈/);
          expect(snapshot).not.toContain(t(locale, 'catalog.gradingNote.callSr'));
          expect(Math.abs(f.wellH - (f.wellW * 5) / 4), `foto 4:5 a ${w}: ${JSON.stringify(f)}`).toBeLessThanOrEqual(1);
        } else {
          await expect(badge, `badge a ${w}`).toBeVisible();
          await expect(badge, `cifra a ${w}`).toContainText(/PSA 10/);
          await expect(notice, `micro-aviso a ${w}`).toBeVisible();
          await expect(page.locator('#nota-estimado'), `nota al pie a ${w}`).toBeVisible();
          expect(Math.abs(f.wellH - (f.wellW * 7) / 5), `foto 5:7 a ${w}: ${JSON.stringify(f)}`).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  // L-10. ≥ sm la teja no cambia; < sm se compacta. Mutación que lo pone rojo: aplicar la compactación sin el prefijo
  // de ancho (p. ej. `hidden` en la rareza sin `sm:inline-block`). Los altos (±1 px de la captura previa) se anotan y se
  // comparan en FRONTEND_NOTES §MKT-CONV8; lo que se afirma es la mecánica que los produce, medida en el navegador.
  test('L-10: teja igual en ≥ sm (768 y 1366) y compacta en < sm (390): rareza fuera, precio y stock en un renglón @real', async ({ page, context }) => {
    await setup(context);
    const tileFacts = () =>
      page.evaluate(() => {
        const a = [...document.querySelectorAll<HTMLElement>('main a[href*="/catalog/"]')].find((x) => x.querySelector('img'))!;
        const tile = a.parentElement!;
        const name = tile.querySelector<HTMLElement>('p.font-serif')!;
        const rarity = tile.querySelector<HTMLElement>('[aria-label^="Rareza"], [aria-label^="Rarity"]');
        const row = tile.querySelector<HTMLElement>('[data-testid="tile-price-row"]');
        const price = tile.querySelector<HTMLElement>('p.tabular');
        const stock = [...tile.querySelectorAll<HTMLElement>('p')].find((p) => /stock|Queda|left/i.test(p.textContent ?? ''));
        const cta = tile.querySelector('button')!.parentElement!;
        const cs = (el: Element) => getComputedStyle(el);
        const pr = price?.getBoundingClientRect();
        const sr = stock?.getBoundingClientRect();
        return {
          height: Math.round(tile.getBoundingClientRect().height * 10) / 10,
          nameMarginTop: cs(name).marginTop,
          nameClamp: cs(name).webkitLineClamp,
          rarityDisplay: rarity ? cs(rarity).display : 'absent',
          rarityHeight: rarity ? rarity.getBoundingClientRect().height : 0,
          rowDisplay: row ? cs(row).display : 'absent',
          priceTop: pr?.top ?? null,
          priceBottom: pr?.bottom ?? null,
          stockTop: sr?.top ?? null,
          stockBottom: sr?.bottom ?? null,
          ctaPaddingTop: cs(cta).paddingTop,
        };
      });
    for (const [w, h] of [[768, 1024], [1366, 768]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/es/catalog');
      await page.locator('main a[href*="/catalog/"] img').first().waitFor();
      const f = await tileFacts();
      testInfo().annotations.push({ type: `L-10-${w}`, description: JSON.stringify(f) });
      expect(f.nameMarginTop, `nombre a ${w}`).toBe('12px');
      expect(['none', '', undefined, null].includes(f.nameClamp), `sin recorte a ${w}: ${f.nameClamp}`).toBe(true);
      expect(f.rarityDisplay, `rareza a ${w}`).not.toBe('none');
      expect(f.rarityHeight).toBeGreaterThan(0);
      expect(['block', 'absent'].includes(f.rowDisplay), `renglón de precio a ${w}: ${f.rowDisplay}`).toBe(true);
      expect(f.stockTop!, `stock BAJO el precio a ${w}`).toBeGreaterThanOrEqual(f.priceBottom!);
      expect(f.ctaPaddingTop).toBe('12px');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/es/catalog');
    await page.locator('main a[href*="/catalog/"] img').first().waitFor();
    const m = await tileFacts();
    testInfo().annotations.push({ type: 'L-10-390', description: JSON.stringify(m) });
    expect(['none', 'absent'].includes(m.rarityDisplay), `rareza a 390: ${m.rarityDisplay}`).toBe(true);
    expect(m.rarityHeight).toBe(0);
    // Mismo renglón: las cajas se solapan en vertical. Van alineadas por la LÍNEA BASE (15 px contra 9 px), así que sus
    // `top` no coinciden ±2 px como decía la aritmética del diseño (diferencia medida: FRONTEND_NOTES §MKT-CONV8).
    expect(m.stockTop!).toBeLessThan(m.priceBottom!);
    expect(m.stockBottom!).toBeGreaterThan(m.priceTop!);
  });
});

test.describe('L-9 · ficha en lg: el renglón de compra fuera del alcance del banner (vMKT-CONV-2)', () => {
  // Mutación que lo pone rojo: devolver la pila o la retícula por encima de «Ejemplares disponibles» en lg (rojo con el
  // nombre de 3 renglones). El barrido se corre N veces (`--repeat-each`, O-3).
  test('L-9: a 1366×768, 1280×720 y 1440×900, bottom del 1er renglón ≤ top del banner − 48 con nombres de 1/2/3 renglones y una gradeada @real', async ({ page, context }) => {
    test.setTimeout(180_000);
    await setup(context);
    await page.setViewportSize({ width: 1366, height: 768 });
    const rawHref = await firstCardHref(page);
    await page.goto('/es/catalog?productType=graded');
    await page.locator('main a[href*="/catalog/"]').first().waitFor();
    const gradedHref = (await page.locator('main a[href*="/catalog/"]').first().getAttribute('href'))!;
    for (const [w, h] of [[1366, 768], [1280, 720], [1440, 900]] as const) {
      for (const [kind, href] of [['suelta', rawHref], ['gradeada', gradedHref]] as const) {
        for (const name of [null, NAME_60, NAME_120]) {
          await page.setViewportSize({ width: w, height: h });
          await page.goto(href);
          await expect(banner(page)).toBeVisible();
          await expect(page.getByTestId('instance-cta').first()).toBeVisible();
          await settle(page);
          const m = await page.evaluate((name) => {
            const h1 = document.querySelector('main h1')!;
            const nameEl = h1.querySelector<HTMLElement>('[data-testid="card-name"]');
            const target = nameEl ?? (h1.firstChild as ChildNode);
            if (name) target.textContent = name;
            const lh = parseFloat(getComputedStyle(h1).lineHeight);
            const lines = nameEl ? Math.round(nameEl.getBoundingClientRect().height / lh) : null;
            const btn = document.querySelector('[data-testid="instance-cta"]')!.getBoundingClientRect();
            const bannerTop = document.querySelector('[data-testid="consent-banner"]')!.getBoundingClientRect().top;
            return {
              lines,
              cert: !!document.querySelector('[data-testid="cert-number"]'),
              btnBottom: Math.round(btn.bottom * 10) / 10,
              bannerTop,
              margin: Math.round((bannerTop - btn.bottom) * 10) / 10,
            };
          }, name);
          const label = `${w}×${h} ${kind} nombre=${name ? name.length : 'sembrado'}`;
          testInfo().annotations.push({ type: `L-9 ${label}`, description: JSON.stringify(m) });
          if (m.lines != null) expect(m.lines, `renglones del nombre (${label})`).toBeLessThanOrEqual(3);
          expect(m.btnBottom, `${label}: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.bannerTop - 48);
        }
      }
    }
  });
});

function testInfo() {
  return test.info();
}
