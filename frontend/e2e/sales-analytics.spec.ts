import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';

/**
 * Smoke de la analítica de ventas del dueño (`DESIGN_SYSTEM §AN-UX`, contrato §15, criterios 605/609/610/611/613).
 * Sin `@real`: corre en la pasada de mocks (servidor falso `src/lib/mock/sales.ts`) y asierta ESTRUCTURA, no montos:
 * una barra por fila de la tabla, el CSV con el nombre del contrato, la tarjeta solo para súper-admin.
 * Contra el backend real lo mide QA con el stack (la cifra depende del seed).
 */
test.describe('admin · Reportes › Ventas', () => {
  test('pestaña «Ventas» por defecto: una barra por fila, presets del servidor y CSV del mismo periodo', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m9');
    const tab = page.getByRole('tab', { name: t('es', 'admin.m9.tabs.sales') });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('sales-period-label')).toBeVisible();

    // criterio 605/609: últimos 7 días ⇒ 7 filas y 7 barras, también las de cero.
    await expect(page.getByTestId('sales-row')).toHaveCount(7);
    await expect(page.getByTestId('sales-bar')).toHaveCount(7);

    await page.getByRole('button', { name: t('es', 'admin.m9.sales.period.today'), exact: true }).click();
    await expect(page.getByTestId('sales-row')).toHaveCount(1);
    await expect(page.getByTestId('sales-period-label')).toContainText('Hoy,');
    await expect(page).toHaveURL(/preset=today/);

    const download = page.waitForEvent('download');
    await page.getByTestId('sales-csv').click();
    expect((await download).suggestedFilename()).toMatch(/^ventas_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_day\.csv$/);

    // «Actividad» sigue ahí, idéntica.
    await page.getByRole('tab', { name: t('es', 'admin.m9.tabs.activity') }).click();
    await expect(page.getByText(t('es', 'admin.m9.metrics.title'), { exact: true })).toBeVisible();
  });

  test('tablero: «Ventas de hoy» para súper-admin enlaza a la pestaña con `preset=today`', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin');
    const card = page.getByTestId('sales-today-card');
    await expect(card).toContainText(t('es', 'admin.dashboard.salesToday.title'));
    await card.getByRole('link', { name: t('es', 'admin.dashboard.salesToday.link') }).click();
    await expect(page).toHaveURL(/\/admin\/m9\?tab=ventas&preset=today/);
    await expect(page.getByTestId('sales-row')).toHaveCount(1);
  });

  test('tablero: el operador no tiene «Ventas de hoy» (criterio 613)', async ({ page }) => {
    await loginAs(page, 'operator');
    // En mocks el rol del panel es el dial «Ver como» (localStorage); en real lo dicta el JWT del operador.
    if (!IS_REAL) await page.addInitScript(() => window.localStorage.setItem('tcg.role', 'vault_operator'));
    await page.goto('/es/admin');
    await expect(page.getByTestId('sales-gross')).toBeVisible();
    await expect(page.getByTestId('sales-today-card')).toHaveCount(0);
  });
});
