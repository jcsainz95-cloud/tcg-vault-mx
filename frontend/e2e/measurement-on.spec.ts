import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { measurementCookies, recordRequests, type RequestLog } from './utils/measurement';
import { loginAs } from './utils/auth';

/**
 * Fase 2 con el modo ENCENDIDO — corre SOLO con `playwright.measurement-on.config.ts`, que construye
 * un bundle de MOCKS con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, IDs de prueba y una versión de aviso de
 * E2E (solo se hornea en builds de mocks). ⛔ Nada sale de CI: toda petición a Google/Meta se
 * intercepta y se responde vacía AQUÍ; se cuenta, no se envía.
 *
 * Candados: C-F3 (cuatro caminos de red + capturas 390×664), C-F5 (navegación dura, v1.109 también
 * `/buylist` → paso de crear con CLABE/INE), C-F9 (`/card-show`: solo `page_view` a GA4, sin Meta), C-F10 (sin muro),
 * C-F11 (no tapa COMPRAR), C-F12 / L-1 (altura, MKT-CONV.6), L-2 (mismo peso), L-3 (COMPRAR visible), 943 (dos
 * tarjetas con el banner), C-F19 (zoom). Los de unidad (C-F8/9/13/14/18) viven en
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

  // Criterio 943 (B5, SUPUESTO «también con el banner abierto»): ≥ 2 tarjetas COMPLETAS en la primera pantalla del
  // catálogo a 360/390/414, entre el borde de arriba y el borde superior del banner; y el banner no desborda (L-5).
  test('943 / L-5: catálogo con el banner abierto ⇒ ≥ 2 tarjetas completas a 360/390/414; sin desborde en portada @real', async ({ page, context }) => {
    await setup(context);
    for (const [w, h] of [[360, 740], [390, 844], [414, 896]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/es/catalog');
      await expect(banner(page)).toBeVisible();
      await page.locator('main a[href*="/catalog/"] img').first().waitFor();
      const m = await page.evaluate(() => {
        const top = document.querySelector('[data-testid="consent-banner"]')!.getBoundingClientRect().top;
        const tiles = [...document.querySelectorAll<HTMLElement>('main a[href*="/catalog/"]')]
          .filter((a) => a.querySelector('img'))
          .map((a) => a.parentElement!.getBoundingClientRect());
        return { complete: tiles.filter((r) => r.top >= 0 && r.bottom <= top + 0.5 && r.height > 0).length, bannerTop: top };
      });
      testInfo().annotations.push({ type: `tarjetas-${w}`, description: JSON.stringify(m) });
      expect(m.complete, `tarjetas completas a ${w}×${h}`).toBeGreaterThanOrEqual(2);
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

function testInfo() {
  return test.info();
}
