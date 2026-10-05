import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * Smoke de «Alertas de envíos» (`DESIGN_SYSTEM §43.22`, contrato §M4-SHIP.19.35.8 F-2): la tarjeta del tablero para los
 * dos roles, sin la cifra del saldo, y el destino de su enlace (`/admin/m4?tab=envios&alert=true`) con su filtro.
 * Mock-only: el cambio de rol «Ver como» y el servidor falso son de modo demo; contra el backend real lo cubre QA con
 * el stack (la cifra depende de los datos sembrados).
 */
test.describe('admin · tablero › Alertas de envíos', () => {
  test('la tarjeta existe para súper-admin y operador, sin cifra de saldo', async ({ page }) => {
    mockOnly('el cambio de rol «Ver como» solo existe en modo demo');
    await loginAs(page, 'admin');
    await page.goto('/es/admin');
    const title = page.getByText(t('es', 'admin.dashboard.shippingAlerts.title'), { exact: true });
    await expect(title).toBeVisible();
    const card = page.getByTestId('dashboard-shipping-alerts');
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('MX$');

    await page.getByLabel(t('es', 'admin.roleLabel')).selectOption('vault_operator');
    await expect(title).toBeVisible();
    await expect(card).not.toContainText('MX$');
    await expect(page.getByRole('link', { name: t('es', 'admin.dashboard.shippingAlerts.seeBalance') })).toHaveCount(0);
  });

  test('`/admin/m4?tab=envios&alert=true` abre «Envíos» con el filtro de alertas, y su ✕ lo quita', async ({ page }) => {
    mockOnly('lista del servidor falso');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m4?tab=envios&alert=true');
    const line = page.getByTestId('shipments-alert-filter');
    await expect(line).toContainText(t('es', 'admin.m4.alertFilter'));
    await page.getByRole('button', { name: t('es', 'admin.m4.alertFilterRemove') }).click();
    await expect(line).toHaveCount(0);
  });
});
