import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * §FICHA-CLIENTE (diseño A): la ficha completa del cliente en M6, contra el servidor falso que sigue el contrato.
 * Totales visibles, notas internas (crear/fijar), celular editable por el súper-admin y los enlaces `?userId=` a M4/M5.
 */
test.describe('admin · ficha del cliente (M6)', () => {
  test('cabecera, cuatro cifras, notas y enlaces con ?userId=', async ({ page }) => {
    mockOnly('usa los datos del servidor falso (u-777)');
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/es/admin/m6');
    await page.getByRole('button', { name: t('es', 'admin.m6.view') }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('ficha-header')).toBeVisible();
    await expect(dialog.getByTestId('strip-purchases')).toContainText('$');
    await expect(dialog.getByTestId('strip-sales')).toContainText('$');

    const note = `Nota e2e ${Date.now()}`;
    await dialog.getByLabel(t('es', 'admin.m6.ficha.notes.label')).fill(note);
    await dialog.getByRole('button', { name: t('es', 'admin.m6.ficha.notes.add') }).click();
    await expect(dialog.getByText(note)).toBeVisible();

    await expect(dialog.locator('#ficha-orders a[href*="/admin/m4"][href*="userId="]').first()).toBeVisible();
    await expect(dialog.locator('#ficha-sells a[href*="/admin/m5"][href*="userId="]').first()).toBeVisible();
    if (process.env.FICHA_SHOT) await page.screenshot({ path: process.env.FICHA_SHOT, fullPage: false });
  });

  test('el súper-admin valida el celular de 10 dígitos', async ({ page }) => {
    mockOnly('usa los datos del servidor falso (u-777)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m6');
    await page.getByRole('button', { name: t('es', 'admin.m6.view') }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t('es', 'admin.m6.ficha.phoneEdit') }).click();
    await dialog.getByLabel(/Celular de/).fill('55 12');
    await expect(dialog.getByText(t('es', 'admin.m6.ficha.phoneError'))).toBeVisible();
    await dialog.getByLabel(/Celular de/).fill('+52 55-1234-5678');
    await dialog.getByTestId('ficha-header').getByRole('button', { name: t('es', 'admin.m6.ficha.phoneSave'), exact: true }).click();
    await expect(dialog.getByTestId('phone-field')).toContainText('5678');
  });
});
