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

  /**
   * v1.17-withdrawal-lifecycle (contrato §3): un holding con envío ACTIVO (`shipmentState != null`)
   * se marca "EN RETIRO" con la etapa del contrato §5 y RETIRAR queda DESHABILITADO (`withdrawable=false`
   * = fuente única de verdad). Mock-only: el fixture trae una pieza en retiro (`enviado`).
   */
  test('marca EN RETIRO y deshabilita RETIRAR en un holding con envío activo', async ({ page }) => {
    await page.goto('/es/vault');
    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();

    // Badge "EN RETIRO" + etapa legible del contrato §5 (enviado → "En camino").
    await expect(page.getByText(t('es', 'vault.inWithdrawal'), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(t('es', 'shipmentStage.enviado')).first()).toBeVisible();

    // RETIRAR de esa pieza es un botón DESHABILITADO con hint "en retiro" (no un enlace).
    const inWithdrawalBtn = page.getByRole('button', { name: t('es', 'vault.inWithdrawalHint') });
    await expect(inWithdrawalBtn).toBeVisible();
    await expect(inWithdrawalBtn).toBeDisabled();
  });

  /**
   * Deep-link del badge "EN RETIRO" al rastreo del retiro (`HoldingDTO.activeShipmentId` →
   * GET /shipments/:id). Mock-only. Al hacer clic, se abre el detalle con las cartas del retiro.
   */
  test('el badge EN RETIRO enlaza al detalle del retiro', async ({ page }) => {
    await page.goto('/es/vault');
    await page.getByRole('link', { name: new RegExp(t('es', 'vault.trackWithdrawal')) }).first().click();

    await expect(page).toHaveURL(/\/es\/shipments\/shp-7001/);
    await expect(page.getByText(t('es', 'shipments.itemsInWithdrawal'))).toBeVisible();
    await expect(page.getByText('Surging Sparks Booster Box').first()).toBeVisible();
  });
});
