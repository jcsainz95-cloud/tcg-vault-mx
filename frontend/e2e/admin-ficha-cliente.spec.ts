import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs } from './utils/auth';

/**
 * §FICHA-CLIENTE (diseño A): la ficha completa del cliente en M6. Corre igual contra el servidor falso y contra el
 * backend real con el seed (sin salvaguarda de solo-mock: no depende de un cliente concreto, toma el primero de la lista).
 * Totales visibles, notas internas (crear/fijar), celular editable por el súper-admin y los enlaces `?userId=` a M4/M5.
 */
test.describe('admin · ficha del cliente (M6)', () => {
  test('cabecera, cuatro cifras, notas y enlaces con ?userId=', async ({ page }) => {
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

    // Las secciones están y todo enlace a pedidos/ventas lleva el filtro del cliente (con el seed real el primer
    // cliente puede no tener filas: no se exige que existan).
    await expect(dialog.locator('#ficha-orders')).toBeVisible();
    await expect(dialog.locator('#ficha-sells')).toBeVisible();
    for (const a of await dialog.locator('#ficha-orders a[href*="/admin/m4"], #ficha-sells a[href*="/admin/m5"]').all()) {
      await expect(a).toHaveAttribute('href', /userId=/);
    }
    if (process.env.FICHA_SHOT) await page.screenshot({ path: process.env.FICHA_SHOT, fullPage: false });
  });

  test('el súper-admin valida el celular de 10 dígitos', async ({ page }) => {
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
