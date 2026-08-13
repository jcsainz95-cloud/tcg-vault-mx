import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: Mi bóveda / portafolio (PROJECT §C / AC 5, 6, 8, 10; contrato §3).
 * Titularidad pending/settled, valor total de portafolio, retiro solo settled.
 */
test.describe('bóveda · portafolio y titularidad', () => {
  test('muestra valor de portafolio y banner de custodia', async ({ page }) => {
    await page.goto('/es/vault');

    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'vault.portfolioValue'))).toBeVisible();
    // Valor en MXN (fixtures: portafolio = MX$3,380.00).
    await expect(page.getByText(/MX\$/).first()).toBeVisible();
    await expect(page.getByText(t('es', 'vault.trustBanner'))).toBeVisible();
  });

  test('distingue titularidad pending vs settled', async ({ page }) => {
    await page.goto('/es/vault');
    await expect(page.getByText(t('es', 'status.ownership.settled')).first()).toBeVisible();
    await expect(page.getByText(t('es', 'status.ownership.pending')).first()).toBeVisible();
  });

  test('retiro solo habilitado para cartas settled', async ({ page }) => {
    await page.goto('/es/vault');
    await expect(page.getByText(t('es', 'vault.onlySettled')).first()).toBeVisible();

    // Botón de retiro deshabilitado en la carta pending; habilitado en la settled.
    await expect(
      page.getByRole('button', { name: t('es', 'vault.withdraw'), disabled: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'vault.withdraw'), disabled: false }).first(),
    ).toBeVisible();
  });
});
