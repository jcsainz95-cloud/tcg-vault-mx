import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: retiro / envío (PROJECT §D / AC 9, 10, 31; contrato §5).
 * Tarifa fija + IVA sobre envío, solo cartas settled, solo direcciones MX.
 */
test.describe('retiro · envío nacional', () => {
  test('cotiza envío con desglose (tarifa + IVA) al seleccionar carta settled', async ({ page }) => {
    await page.goto('/es/shipments');

    await expect(page.getByRole('heading', { name: t('es', 'shipments.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'shipments.onlySettledNotice'))).toBeVisible();
    await expect(page.getByText(t('es', 'shipments.flatFeeNotice'))).toBeVisible();

    // Selecciona una carta settled → aparece el desglose de envío.
    await page.getByRole('checkbox').first().check();
    const breakdown = page.getByTestId('amount-breakdown');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.shipping'))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.iva', { rate: 16 }))).toBeVisible();
  });

  test('rechaza direcciones fuera de México (solo nacional)', async ({ page }) => {
    await page.goto('/es/shipments');

    await page.getByLabel(t('es', 'shipments.selectAddress')).selectOption('US');
    await expect(page.getByText(t('es', 'error.ADDRESS_NOT_MX'))).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'shipments.requestWithdrawal'), disabled: true }),
    ).toBeVisible();
  });

  test('lista cartas no elegibles (no settled)', async ({ page }) => {
    await page.goto('/es/shipments');
    await expect(page.getByText(t('es', 'shipments.ineligibleTitle'))).toBeVisible();
  });
});
