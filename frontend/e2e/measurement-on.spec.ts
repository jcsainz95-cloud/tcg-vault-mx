import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { measurementCookies, recordRequests, type RequestLog } from './utils/measurement';

/**
 * Fase 2 con el modo ENCENDIDO — corre SOLO con `playwright.measurement-on.config.ts`, que construye
 * un bundle de MOCKS con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, IDs de prueba y una versión de aviso de
 * E2E (solo se hornea en builds de mocks). ⛔ Nada sale de CI: toda petición a Google/Meta se
 * intercepta y se responde vacía AQUÍ; se cuenta, no se envía.
 *
 * Candados: C-F3 (cuatro caminos de red + capturas 390×664), C-F5 (navegación dura), C-F10 (sin muro),
 * C-F11 (no tapa COMPRAR), C-F12 (altura), C-F19 (zoom). Los de unidad (C-F8/9/13/14/18) viven en
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

test.describe('C-F5 · navegación dura hacia rutas excluidas', () => {
  const EXCLUDED = ['/es/account', '/es/vault', '/es/admin', '/es/buylist', '/es/reset-password', '/es/pedido?token=mock-demo-token'];

  async function acceptOnCard(page: Page, context: BrowserContext) {
    const log = await setup(context);
    const href = await firstCardHref(page);
    await page.goto(href);
    await banner(page).getByRole('button', { name: t('es', 'consent.accept') }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('function');
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
      await page.evaluate((url) => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push(url), target);
      // (Una ruta protegida puede redirigir a /login: también excluida; lo que importa es salir de la ficha.)
      await page.waitForURL((u) => !u.pathname.startsWith('/es/catalog'));
      await settle(page);
      await expectCleanDocument(page);
      expect(log.measurement.slice(before)).toEqual([]);
    });
  }

  test('clic en un enlace del encabezado (Vender) y del pie (Términos) ⇒ documento nuevo sin etiquetas', async ({ page, context }) => {
    const { log, href } = await acceptOnCard(page, context);
    let before = log.measurement.length;
    await page.locator('header').getByRole('link', { name: t('es', 'nav.buylist') }).first().click();
    await page.waitForURL(/\/es\/buylist/);
    await settle(page);
    await expectCleanDocument(page);
    expect(log.measurement.slice(before)).toEqual([]);

    await page.goto(href);
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('function');
    before = log.measurement.length;
    await page.locator('footer').getByRole('link', { name: t('es', 'nav.terms') }).click();
    await page.waitForURL(/\/es\/terminos/);
    await settle(page);
    await expectCleanDocument(page);
    expect(log.measurement.slice(before)).toEqual([]);
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

  for (const locale of ['es', 'en'] as const) {
    test(`C-F12: alto ≤ 232 px a 390×664 (${locale}); una fila ≤ 120 px a 1280×720`, async ({ page, context }) => {
      await setup(context);
      await page.setViewportSize({ width: 390, height: 664 });
      await page.goto(`/${locale}`);
      const region = page.getByRole('region', { name: t(locale, 'consent.region') });
      await expect(region).toBeVisible();
      const h = (await region.boundingBox())!.height;
      testInfo().annotations.push({ type: `alto-${locale}-390`, description: String(h) });
      expect(h).toBeLessThanOrEqual(232);
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect.poll(async () => (await region.boundingBox())!.height).toBeLessThanOrEqual(120);
    });
  }

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
