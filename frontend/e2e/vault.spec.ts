import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, MONEY_RE } from './utils/auth';

/**
 * Flujo: Mi bóveda / portafolio (PROJECT §C / AC 5, 6, 8, 10; contrato §3).
 * Titularidad pending/settled, valor total de portafolio, retiro solo settled.
 */
test.describe('bóveda · portafolio y titularidad', () => {
  /**
   * SMOKE @real — la bóveda del cliente autenticado muestra su portafolio (valor con
   * formato de moneda, no monto de fixture), el banner de custodia y al menos una pieza
   * settled con su acceso a "Retirar" (link a /shipments). Descubre datos del seed.
   */
  test('@real muestra valor de portafolio, custodia y retiro de pieza settled', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/vault');

    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'vault.portfolioValue'))).toBeVisible();
    await expect(page.getByText(MONEY_RE).first()).toBeVisible();
    await expect(page.getByText(t('es', 'vault.trustBanner'))).toBeVisible();

    // El seed del cliente trae inventario en custodia settled → badge + acceso a retiro.
    await expect(page.getByText(t('es', 'status.ownership.settled')).first()).toBeVisible();
    // "Retirar" de una pieza settled es un enlace a /shipments (no un botón).
    await expect(page.getByRole('link', { name: t('es', 'vault.withdraw') }).first()).toBeVisible();
  });

  test('distingue titularidad pending vs settled', async ({ page }) => {
    // Mock-only: los fixtures traen ambas titularidades; el seed real puede no traer pending.
    await page.goto('/es/vault');
    await expect(page.getByText(t('es', 'status.ownership.settled')).first()).toBeVisible();
    await expect(page.getByText(t('es', 'status.ownership.pending')).first()).toBeVisible();
  });

  test('retiro solo habilitado para cartas settled', async ({ page }) => {
    // Mock-only: requiere una pieza settled Y una pending para contrastar el estado.
    await page.goto('/es/vault');
    await expect(page.getByText(t('es', 'vault.onlySettled')).first()).toBeVisible();

    // Settled: "Retirar" es un enlace ACTIVO a /shipments (con el ítem preseleccionado).
    await expect(page.getByRole('link', { name: t('es', 'vault.withdraw') }).first()).toBeVisible();
    // Pending: "Retirar" es un botón DESHABILITADO (no retirable hasta liquidar).
    await expect(
      page.getByRole('button', { name: t('es', 'vault.withdraw'), disabled: true }).first(),
    ).toBeVisible();
  });
});
