import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';

/**
 * Flujo del Panel de Marketing (`DESIGN_SYSTEM §MKT-UX`; contrato §MKT.E/§MKT.G): abrir el panel, cambiar de pantalla y
 * de periodo, crear y borrar una anotación, descargar el Excel. Asierta ESTRUCTURA (pestaña activa, rótulo, la fila
 * creada, el nombre del archivo del contrato), no cifras: contra el stack real la cifra depende del seed.
 *
 * Sin `@real` todavía: escrito para correr en las dos pasadas, pero contra el stack NO se ha corrido (lo cierra QA y,
 * si queda verde, se tagea `@real`). La etiqueta de la anotación es única por corrida y no lleva datos personales.
 */
test.describe('admin · Marketing', () => {
  test('pantallas, periodo, anotación (crear y borrar) y Excel de la semana', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/marketing');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('es', 'admin.modules.marketing'));

    const tabs = page.getByRole('tablist', { name: t('es', 'admin.marketing.tabs.label') });
    await expect(tabs.getByRole('tab', { name: t('es', 'admin.marketing.tabs.a') })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('mkt-screen-a')).toBeVisible();
    await expect(page.getByTestId('mkt-period-label')).toContainText('hora del centro de México');

    // Cambiar de pantalla: Catálogo.
    await tabs.getByRole('tab', { name: t('es', 'admin.marketing.tabs.d') }).click();
    await expect(page.getByTestId('mkt-screen-d')).toBeVisible();
    await expect(page).toHaveURL(/pantalla=d/);

    // Cambiar de periodo: la semana anterior y luego Mes.
    const select = page.getByTestId('mkt-period-select');
    const second = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(second!);
    await expect(page).toHaveURL(new RegExp(`week=${second}`));
    await page.getByRole('button', { name: t('es', 'admin.marketing.period.month'), exact: true }).click();
    await expect(page).toHaveURL(/periodo=mes/);
    await expect(page.getByTestId('mkt-download-weekly')).toHaveText(t('es', 'admin.marketing.download.month'));
    await page.getByRole('button', { name: t('es', 'admin.marketing.period.week'), exact: true }).click();

    // Anotaciones: crear y borrar (sin datos personales).
    await tabs.getByRole('tab', { name: t('es', 'admin.marketing.tabs.h') }).click();
    await expect(page.getByTestId('mkt-ann-pii').first()).toBeVisible();
    const label = `Prueba e2e ${Date.now().toString(36)}`;
    await page.getByTestId('mkt-ann-new').click();
    const dlg = page.getByTestId('mkt-ann-dialog');
    await dlg.getByLabel(t('es', 'admin.marketing.ann.field.kind')).selectOption('evento');
    await dlg.getByLabel(t('es', 'admin.marketing.ann.field.label')).fill(label);
    await page.getByTestId('mkt-ann-save').click();
    await expect(dlg).toHaveCount(0);
    const row = page.getByTestId('mkt-ann-row').filter({ hasText: label });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: t('es', 'admin.marketing.ann.delete') }).click();
    await page.getByTestId('mkt-ann-delete-confirm').click();
    await expect(page.getByTestId('mkt-ann-status')).toHaveText(t('es', 'admin.marketing.ann.deleted'));
    await expect(page.getByTestId('mkt-ann-row').filter({ hasText: label })).toHaveCount(0);

    // Excel de la semana: fetch + blob, nombre del contrato (§MKT.E).
    const download = page.waitForEvent('download');
    await page.getByTestId('mkt-download-weekly').click();
    expect((await download).suggestedFilename()).toMatch(/^tcghunt_semana_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_corte-\d{8}-\d{4}\.xlsx$/);
    await expect(page.getByTestId('mkt-download-status')).toContainText('Se descargó');
  });

  test('el operador no ve «Marketing» en el menú y por URL llega al aviso sin permiso', async ({ page }) => {
    await loginAs(page, 'operator');
    if (!IS_REAL) await page.addInitScript(() => window.localStorage.setItem('tcg.role', 'vault_operator'));
    await page.goto('/es/admin/marketing');
    await expect(page.getByTestId('mkt-forbidden')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('link', { name: t('es', 'admin.modules.marketing'), exact: true })).toHaveCount(0);
  });
});
