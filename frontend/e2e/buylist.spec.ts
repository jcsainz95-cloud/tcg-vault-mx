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

  test('cotiza EX+ como 40% de la referencia', async ({ page }) => {
    await page.goto('/es/buylist');
    // Charizard (Rare Holo → categoría EX o superior) es la carta por defecto.
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();

    await expect(page.getByRole('heading', { name: t('es', 'buylist.quoteResult') })).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.categoryLabel.ex_plus'))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.quotedPrice'), { exact: true })).toBeVisible();
    await expect(page.getByText(/MX\$/).first()).toBeVisible();
  });

  test('carta sin referencia entra a "precio pendiente" y no permite crear solicitud', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    // Zapdos tiene referencia pendiente en los fixtures.
    await page.getByLabel(t('es', 'buylist.selectCard')).selectOption('c-zapdos');
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();

    await expect(page.getByText(t('es', 'buylist.pricePendingNotice'))).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'buylist.createRequest'), disabled: true }),
    ).toBeVisible();
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
    // Charizard (EX+) tiene referencia → permite crear solicitud.
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();
    await page.getByRole('button', { name: t('es', 'buylist.createRequest') }).click();

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
    await page.getByRole('button', { name: t('es', 'buylist.getQuote') }).click();
    await page.getByRole('button', { name: t('es', 'buylist.createRequest') }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/CLABE/).fill('002010077777777771');
    await dialog.getByRole('button', { name: t('es', 'buylist.submit') }).click();

    await expect(page.getByText(t('es', 'buylist.created'))).toBeVisible();
  });
});
