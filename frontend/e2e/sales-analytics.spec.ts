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
    // §REPORTES-CEO F1: Ventas es la única vista de /admin/m9 (sin pestañas).
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'admin.modules.m9') })).toBeVisible();
    await expect(page.getByTestId('sales-period-label')).toBeVisible();

    // §REPORTES-CEO §2: el defecto es «Este mes»; «Hora de México» y las fechas resueltas siempre a la vista.
    await expect(page.getByTestId('period-resolved')).toContainText(t('es', 'admin.reports.period.mexicoTime'));
    await page.getByRole('button', { name: t('es', 'admin.reports.period.7d'), exact: true }).click();
    // criterio 605/609: últimos 7 días ⇒ 7 filas y 7 barras, también las de cero.
    await expect(page.getByTestId('sales-row')).toHaveCount(7);
    await expect(page.getByTestId('sales-bar')).toHaveCount(7);

    await page.getByRole('button', { name: t('es', 'admin.reports.period.today'), exact: true }).click();
    await expect(page.getByTestId('sales-row')).toHaveCount(1);
    await expect(page.getByTestId('sales-period-label')).toContainText('Hoy,');
    await expect(page).toHaveURL(/preset=today/);

    const download = page.waitForEvent('download');
    await page.getByTestId('sales-csv').click();
    expect((await download).suggestedFilename()).toMatch(/^ventas_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_day\.csv$/);

    // §REPORTES-CEO F1 (CR-2b): el enlace guardado de «Actividad» ya no da 404: aterriza en las metas de lanzamiento de la Junta.
    await page.goto('/es/admin/m9?tab=actividad');
    await expect(page).toHaveURL(/\/admin\/reportes#metas/);
    await expect(page.getByTestId('franja-metas')).toBeVisible();
  });

  test('§2 F2a: Junta, Ventas y Finanzas dicen contra qué se compara (mismo tramo) y Finanzas lleva su columna', async ({ page }) => {
    test.skip(IS_REAL, 'la cifra depende del seed: en real lo mide QA con el stack');
    // El demo trae el P&L plano; el servidor real (v1.95.2+) siempre manda el estado de resultados: se enciende aquí.
    await page.addInitScript(() => window.sessionStorage.setItem('tcg.mock.pnlStatement', '1'));
    await loginAs(page, 'admin');
    await page.goto('/es/admin/reportes');
    const note = page.getByTestId('board-period');
    await expect(note).toContainText('Mes a la fecha');
    await expect(note).toContainText('comparado con');
    await page.getByRole('button', { name: t('es', 'admin.reports.period.quarter'), exact: true }).click();
    await expect(note).toContainText('Trimestre a la fecha');
    await page.getByRole('button', { name: t('es', 'admin.reports.period.last-month'), exact: true }).click();
    await expect(note).not.toContainText('a la fecha');
    await expect(note).toContainText('comparado con');
    for (const jerga of ['MTD', 'YTD', 'basis', 'clamped']) await expect(page.locator('body')).not.toContainText(jerga);

    await page.goto('/es/admin/m9');
    await expect(page.getByTestId('sales-compare')).toContainText('Mes a la fecha');

    await page.goto('/es/admin/m7');
    await expect(page.getByTestId('pnl-compare')).toContainText('Mes a la fecha');
    await expect(page.getByTestId('cmp-cells')).toHaveCount(8);
    // «Todo»: sin columna y con su rótulo.
    await page.getByRole('button', { name: t('es', 'admin.reports.period.all'), exact: true }).click();
    await expect(page.getByTestId('pnl-compare')).toContainText('Sin periodo anterior para comparar');
    await expect(page.getByTestId('cmp-cells')).toHaveCount(0);
  });

  test('Reportes › Ventas: «Ventas de hoy» para súper-admin enlaza al informe con `preset=today`', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m9');
    const card = page.getByTestId('sales-today-card');
    await expect(card).toContainText(t('es', 'admin.dashboard.salesToday.title'));
    await card.getByRole('link', { name: t('es', 'admin.dashboard.salesToday.link') }).click();
    await expect(page).toHaveURL(/\/admin\/m9\?preset=today/);
    await expect(page.getByTestId('sales-row')).toHaveCount(1);
  });

  test('operador: Inicio sin «Ventas de hoy» ni dinero del periodo, y el informe de Ventas le sale restringido (criterio 613, CR-4)', async ({ page }) => {
    await loginAs(page, 'operator');
    // En mocks el rol del panel es el dial «Ver como» (localStorage); en real lo dicta el JWT del operador.
    if (!IS_REAL) await page.addInitScript(() => window.localStorage.setItem('tcg.role', 'vault_operator'));
    await page.goto('/es/admin');
    await expect(page.getByRole('heading', { name: t('es', 'admin.modules.dashboard') })).toBeVisible();
    await expect(page.getByText(t('es', 'admin.dashboard.workQueue')).first()).toBeVisible();
    await expect(page.getByTestId('sales-today-card')).toHaveCount(0);
    await page.goto('/es/admin/m9');
    await expect(page.getByText(t('es', 'admin.superAdminGateTitle'))).toBeVisible();
    await expect(page.getByTestId('sales-today-card')).toHaveCount(0);
    await expect(page.getByTestId('sales-row')).toHaveCount(0);
  });
});
