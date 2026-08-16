import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: buylist (PROJECT §E / AC 12, 13, 33, 34; contrato §6).
 * Cotizador público, banner "pago tras recepción", guía de envío seguro
 * (sleeve/top loader), y cola de "precio pendiente".
 */
test.describe('buylist · cotizador público', () => {
  test('banner persistente "pago tras recepción"', async ({ page }) => {
    await page.goto('/es/buylist');
    await expect(page.getByText(t('es', 'buylist.payAfterReceipt')).first()).toBeVisible();
  });

  test('busca una carta y cotiza mostrando rareza + regla aplicada (40% de la referencia)', async ({ page }) => {
    await page.goto('/es/buylist');
    // Nuevo flujo (Opción 1): buscar sobre todo el catálogo → elegir carta → cotizar.
    await page.getByLabel(t('es', 'buylist.searchCards')).fill('Charizard');
    await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
    await page.getByRole('option', { name: /Charizard/ }).click();
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();

    await expect(page.getByRole('heading', { name: t('es', 'buylist.quoteResult') })).toBeVisible();
    // v1.3.1: se muestra la rareza oficial y la regla aplicada legible (40% de referencia).
    await expect(page.getByText(t('es', 'buylist.appliedRuleLabel'), { exact: true })).toBeVisible();
    await expect(page.getByText('40% de referencia')).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.quotedPrice'), { exact: true })).toBeVisible();
    await expect(page.getByText(/MX\$/).first()).toBeVisible();
  });

  test('agrega varias cartas al carrito y suma un total estimado', async ({ page }) => {
    await page.goto('/es/buylist');
    // Carta 1: Charizard.
    await page.getByLabel(t('es', 'buylist.searchCards')).fill('Charizard');
    await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
    await page.getByRole('option', { name: /Charizard/ }).click();
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();
    // Carta 2: Pikachu.
    await page.getByLabel(t('es', 'buylist.searchCards')).fill('Pikachu');
    await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
    await page.getByRole('option', { name: /Pikachu/ }).first().click();
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();

    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.estimateNote'))).toBeVisible();
    await expect(page.getByRole('button', { name: /Enviar solicitud/ })).toBeEnabled();
  });

  test('carta sin referencia entra a "precio pendiente" (estimado pendiente, backend lo fija)', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    // Zapdos tiene referencia pendiente en los fixtures.
    await page.getByLabel(t('es', 'buylist.searchCards')).fill('Zapdos');
    await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
    await page.getByRole('option', { name: /Zapdos/ }).click();
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();

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
  test('el paso de solicitud pide CLABE + INE (anverso/reverso) con aviso de privacidad', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    // Charizard (EX+) tiene referencia → se cotiza y se agrega al carrito.
    await page.getByLabel(t('es', 'buylist.searchCards')).fill('Charizard');
    await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
    await page.getByRole('option', { name: /Charizard/ }).click();
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();
    // Enviar el carrito abre el KYC/CLABE una sola vez.
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/CLABE/)).toBeVisible();
    await expect(dialog.getByText(t('es', 'ine.front'))).toBeVisible(); // INE anverso
    await expect(dialog.getByText(t('es', 'ine.back'))).toBeVisible(); // INE reverso
    // El uploader solo acepta imágenes (backend endurece kyc_ine a image/*).
    await expect(dialog.getByLabel(t('es', 'ine.front'))).toHaveAttribute('accept', 'image/*');
    await expect(dialog.getByText(t('es', 'ine.privacy'))).toBeVisible();
  });

  test('crea la solicitud con CLABE válida y muestra confirmación', async ({ page }) => {
    await page.goto('/es/buylist');
    await page.getByLabel(t('es', 'buylist.searchCards')).fill('Charizard');
    await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
    await page.getByRole('option', { name: /Charizard/ }).click();
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();
    await page.getByRole('button', { name: new RegExp(t('es', 'buylist.addToCart')) }).click();
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/CLABE/).fill('002010077777777771');
    await dialog.getByRole('button', { name: t('es', 'buylist.submit') }).click();

    await expect(page.getByText(t('es', 'buylist.created'))).toBeVisible();
  });
});
