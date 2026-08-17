import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, MONEY_RE } from './utils/auth';

/**
 * Flujo: buylist (PROJECT §E / AC 12, 13, 33, 34; contrato §6).
 * Rediseño menos-clics (2026-08-17): la cotización es AUTOMÁTICA al elegir carta
 * (ya no existe el botón "Cotizar"), el grid muestra el estimado por carta,
 * hay multi-selección (bulk) y el modal final lleva resumen + CLABE/KYC.
 */

/** Busca una carta por texto y la elige del grid (la cotización dispara sola). */
async function pickCard(page: Page, term: string) {
  await page.getByLabel(t('es', 'buylist.searchCards')).fill(term);
  await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
  await page
    .getByRole('list', { name: t('es', 'buylist.searchResults') })
    .getByRole('button', { name: new RegExp(term) })
    .first()
    .click();
}

/**
 * Descubre y elige la PRIMERA carta del catálogo sin hardcodear nombre/id: filtra por
 * el primer set real (el dropdown se puebla de GET /buylist/sets → mock o backend real)
 * y elige la primera carta del grid. Env-agnóstico (mock y real).
 */
async function pickFirstSellableCard(page: Page) {
  const setSelect = page.getByLabel(t('es', 'buylist.filterBySet'));
  // option[0] es el placeholder "Todos los sets"; option[1] es el primer set real.
  const firstSet = await setSelect.locator('option').nth(1).getAttribute('value');
  if (firstSet) await setSelect.selectOption(firstSet);
  await page
    .getByRole('list', { name: t('es', 'buylist.searchResults') })
    .getByRole('button')
    .first()
    .click();
}

test.describe('buylist · cotizador público (auto-cotización)', () => {
  test('banner persistente "pago tras recepción"', async ({ page }) => {
    await page.goto('/es/buylist');
    await expect(page.getByText(t('es', 'buylist.payAfterReceipt')).first()).toBeVisible();
  });

  test('busca una carta, la elige y cotiza SOLA (sin botón "Cotizar")', async ({ page }) => {
    await page.goto('/es/buylist');
    await pickCard(page, 'Charizard');

    // No existe el botón "Cotizar": la cotización aparece sola al elegir.
    await expect(page.getByRole('heading', { name: t('es', 'buylist.quoteResult') })).toBeVisible();
    // v1.3.1: se muestra la rareza oficial y la regla aplicada legible (40% de referencia).
    await expect(page.getByText(t('es', 'buylist.appliedRuleLabel'), { exact: true })).toBeVisible();
    await expect(page.getByText('40% de referencia')).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.quotedPrice'), { exact: true })).toBeVisible();
    await expect(page.getByText(/MX\$/).first()).toBeVisible();
  });

  test('el grid de resultados muestra el precio de compra estimado por carta', async ({ page }) => {
    await page.goto('/es/buylist');
    await page.getByLabel(t('es', 'buylist.searchCards')).fill('Charizard');
    await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();

    // Sin elegir la carta: el resultado ya muestra su estimado (buylist navegable).
    // Estructura, no monto exacto de fixture: hay una leyenda + un estimado con formato MXN.
    await expect(page.getByText(t('es', 'buylist.gridEstimateLegend'))).toBeVisible();
    await expect(
      page.getByRole('list', { name: t('es', 'buylist.searchResults') }).getByText(MONEY_RE).first(),
    ).toBeVisible();
  });

  test('bulk: multi-selección en el grid y agregar varias de golpe', async ({ page }) => {
    await page.goto('/es/buylist');
    await page.getByLabel(t('es', 'buylist.filterBySet')).selectOption('base1');

    await page.getByRole('checkbox', { name: t('es', 'buylist.bulkSelect', { name: 'Charizard' }) }).check();
    await page.getByRole('checkbox', { name: t('es', 'buylist.bulkSelect', { name: 'Pikachu' }) }).check();
    await page.getByRole('button', { name: t('es', 'buylist.bulkAddCta', { count: 2 }) }).click();

    await expect(page.getByText(t('es', 'buylist.bulkAdded', { count: 2 }))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
  });

  test('agrega varias cartas al carrito y suma un total estimado', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    // Carta 1: Charizard (auto-cotiza al elegir).
    await pickCard(page, 'Charizard');
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();
    // Carta 2: Pikachu.
    await pickCard(page, 'Pikachu');
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();

    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.estimateNote'))).toBeVisible();
    await expect(page.getByRole('button', { name: /Enviar solicitud/ })).toBeEnabled();
  });

  test('carta sin referencia entra a "precio pendiente" (estimado pendiente, backend lo fija)', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    // Zapdos tiene referencia pendiente en los fixtures; la cotización dispara sola.
    await pickCard(page, 'Zapdos');

    // El estimado sale "precio pendiente"; el monto final lo fija la plataforma al recibir.
    await expect(page.getByText(t('es', 'buylist.pricePendingNotice'))).toBeVisible();
  });

  test('guía de envío seguro menciona sleeve y top loader', async ({ page }) => {
    await page.goto('/es/buylist');
    await page.getByRole('button', { name: t('es', 'buylist.shippingGuideLink') }).click();

    // El diálogo de la guía debe mencionar explícitamente sleeve y top loader (AC 34).
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(t('es', 'safeShipping.step1Title')).first()).toBeVisible(); // Sleeve
    await expect(dialog.getByText(t('es', 'safeShipping.step2Title')).first()).toBeVisible(); // Top loader
    await expect(
      dialog.getByRole('button', { name: t('es', 'safeShipping.understood') }),
    ).toBeVisible();
  });
});

test.describe('buylist · solicitud con KYC/INE (AC 14; contrato §6/§8)', () => {
  test('el paso de solicitud muestra RESUMEN + CLABE + INE (anverso/reverso) con aviso de privacidad', async ({
    page,
  }) => {
    // Mock-only: asume KYC sin CLABE/INE en archivo (fixtures) para mostrar ambos uploaders.
    // El seed real puede traer CLABE/INE en archivo → el modal usa atajos (cubierto por @real).
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    // Charizard (EX+) tiene referencia → se cotiza sola y se agrega al carrito.
    await pickCard(page, 'Charizard');
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();
    // Enviar el carrito abre el resumen + KYC/CLABE una sola vez.
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog');
    // Resumen de la venta antes de confirmar (cartas + total + vigencia).
    await expect(dialog.getByText(t('es', 'buylist.summaryTitle'))).toBeVisible();
    await expect(dialog.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
    await expect(dialog.getByText(t('es', 'buylist.trustValidity'))).toBeVisible();
    await expect(dialog.getByLabel(/CLABE/)).toBeVisible();
    await expect(dialog.getByText(t('es', 'ine.front'))).toBeVisible(); // INE anverso
    await expect(dialog.getByText(t('es', 'ine.back'))).toBeVisible(); // INE reverso
    // El uploader solo acepta imágenes (backend endurece kyc_ine a image/*).
    await expect(dialog.getByLabel(t('es', 'ine.front'))).toHaveAttribute('accept', 'image/*');
    await expect(dialog.getByText(t('es', 'ine.privacy'))).toBeVisible();
  });

  /**
   * SMOKE @real — VENDER: descubre la primera carta, la agrega y crea la solicitud
   * (`POST /buylist/requests`). Env-agnóstico:
   *  - real: el cliente del seed suele traer CLABE/INE en archivo → el modal usa el atajo
   *    "usar mi CLABE" y se envía directo. Si el backend pidiera CLABE, se captura una válida.
   *  - mock: los fixtures no traen CLABE en archivo → se captura la CLABE en el modal.
   * Viewport alto para que el CTA del modal quede en pantalla (el modal no scrollea internamente).
   */
  test('@real vender: crea la solicitud de venta y muestra confirmación', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2000 });
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');

    await pickFirstSellableCard(page);
    // Cotización automática al elegir (sin botón "Cotizar").
    await expect(page.getByRole('heading', { name: t('es', 'buylist.quoteResult') })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();

    // Estructura: el carrito suma un total ESTIMADO (no un monto exacto de fixture).
    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();

    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog', { name: t('es', 'buylist.requestTitle') });
    await expect(dialog.getByText(t('es', 'buylist.summaryTitle'))).toBeVisible();

    // CLABE: si el modal pide capturarla (sin CLABE en archivo), se llena una válida.
    const clabeInput = dialog.getByLabel(/CLABE/);
    if (await clabeInput.count()) {
      await clabeInput.first().fill('002010077777777771');
    }

    await dialog.getByRole('button', { name: t('es', 'buylist.submit') }).click();
    await expect(page.getByText(t('es', 'buylist.created'))).toBeVisible();
  });
});
