import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL } from './utils/auth';
import { chooseNeighborhood } from './utils/address';
import { C_F1_ARTIFACT_RE, measurementCookies, recordRequests } from './utils/measurement';

/**
 * C-F2 (API_CONTRACT §MKT.H.11) — con `NEXT_PUBLIC_MEASUREMENT_MODE=off` (el de hoy, y el del
 * webServer de mocks de `playwright.config.ts`): recorriendo portada, catálogo, ficha de carta, ficha
 * de sellado, carrito, checkout de invitado hasta el formulario de pago, privacidad y guías ⇒
 * 0 peticiones a hosts de medición, 0 cookies `_ga*`/`_gid`/`_fbp`/`_fbc`/`th_first_utm`/`th_consent`,
 * 0 llamadas a `/measurement/banner-response`, sin banner y sin «Preferencias de cookies».
 * Excluidos a propósito: `accounts.google.com` (botón de Google) y `www.google.com` (Card Show).
 *
 * Y C-F1 (mitad de ARTEFACTO): el build que sirve esta corrida no contiene el cargador.
 *
 * Etiqueta `@real`: corre igual contra el stack real (`E2E_BASE_URL`), que hoy está en `off`.
 */

async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function expectNoConsentUi(page: Page) {
  await expect(page.getByTestId('consent-banner')).toHaveCount(0);
  await expect(page.getByRole('region', { name: t('es', 'consent.region') })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('es', 'consent.footerLink') })).toHaveCount(0);
}

test.describe('@real C-F2 · medición apagada: nada sale a Google/Meta', () => {
  test('recorrido completo sin hosts de medición, sin cookies, sin banner-response, sin banner', async ({ page, context }) => {
    test.setTimeout(IS_REAL ? 240_000 : 180_000);
    const log = recordRequests(context);

    // Portada (con UTM: con off no deben escribir nada).
    await visit(page, '/es?utm_source=ig&utm_medium=story&utm_campaign=c-f2');
    await expectNoConsentUi(page);

    // Catálogo y ficha de carta.
    await visit(page, '/es/catalog');
    await expectNoConsentUi(page);
    const cardHref = await page.locator('a[href*="/catalog/"]').first().getAttribute('href');
    expect(cardHref, 'el catálogo debe tener al menos una ficha').toBeTruthy();
    await visit(page, cardHref!);
    await expectNoConsentUi(page);

    // Lista y ficha de sellado.
    await visit(page, '/es/sellado');
    const sealedHref = await page.locator('a[href*="/sellado/"]').first().getAttribute('href');
    if (sealedHref) {
      await visit(page, sealedHref);
      await expectNoConsentUi(page);
    }

    // Carrito → checkout de invitado hasta el formulario de pago.
    await visit(page, '/es/catalog');
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
    await visit(page, '/es/checkout');
    await expectNoConsentUi(page);
    // CHK-MOVIL.2.1: sin pantalla de tres vías; el formulario de invitado está desde el primer pintado.
    await expect(page.getByLabel(t('es', 'checkout.guest.email.label'))).toBeVisible();
    await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('invitado-cf2@dominio.com');
    await page.getByLabel(t('es', 'checkout.guest.recipientName')).fill('Prueba Medición');
    await page.getByLabel(t('es', 'addresses.line1')).fill('Av. Vallarta 1234');
    await page.getByLabel(t('es', 'addresses.postalCode')).fill('44100');
    await chooseNeighborhood(page, 'Guadalajara Centro');
    await page.getByLabel(t('es', 'addresses.phone')).fill('3312345678');
    await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
    await page.locator('#guest-terms').check();
    await page.getByRole('button', { name: /Pagar/ }).click();
    await expect(page.getByRole('dialog', { name: t('es', 'checkout.payTitle') })).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Privacidad (sin el botón «Preferencias de cookies» en el aviso) y guías.
    await visit(page, '/es/privacidad');
    await expectNoConsentUi(page);
    await visit(page, '/es/guias');
    const guideHref = await page.locator('a[href*="/guias/"]').first().getAttribute('href');
    if (guideHref) await visit(page, guideHref);
    await expectNoConsentUi(page);

    expect(log.all.length, 'el registro de peticiones tiene que haber visto algo').toBeGreaterThan(10);
    expect(log.measurement.map((m) => m.url)).toEqual([]);
    expect(log.bannerResponses).toEqual([]);
    expect(await measurementCookies(context)).toEqual([]);
    const globals = await page.evaluate(() => ({
      gtag: typeof (window as unknown as { gtag?: unknown }).gtag,
      fbq: typeof (window as unknown as { fbq?: unknown }).fbq,
      dataLayer: typeof (window as unknown as { dataLayer?: unknown }).dataLayer,
      scripts: document.querySelectorAll('script[data-th-measurement]').length,
    }));
    expect(globals).toEqual({ gtag: 'undefined', fbq: 'undefined', dataLayer: 'undefined', scripts: 0 });
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test.describe('C-F1 · el artefacto servido no contiene el cargador', () => {
  test('grep sobre <distDir>/static y <distDir>/server = 0 ficheros', async () => {
    const distDir = process.env.E2E_MOCK_DIST_DIR ?? '.next-e2e-mock';
    test.skip(!!process.env.E2E_BASE_URL, 'app externa: el grep del artefacto lo corre devops sobre su build (C-F1)');
    test.skip(!existsSync(distDir), `sin ${distDir}: no se construyó aquí`);
    const hits: string[] = [];
    for (const sub of ['static', 'server']) {
      const root = join(distDir, sub);
      if (!existsSync(root)) continue;
      for (const f of walk(root)) if (C_F1_ARTIFACT_RE.test(readFileSync(f, 'latin1'))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});
