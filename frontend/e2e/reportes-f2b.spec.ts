import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';

/**
 * §REPORTES-CEO F2b + cierre de F2a (mocks: servidor falso `src/lib/mock/pnl-lines.ts`, forma exacta del contrato). Asierta ESTRUCTURA
 * y la paridad que el contrato promete (Σ de las cinco columnas = Total en lo que se VE); contra el backend real lo mide QA con el stack.
 */
const LINES = ['sealed', 'raw', 'graded', 'accessory', 'unassigned'] as const;
const cents = (s: string) => Number(s.replace(/[^\d−-]/g, '').replace('−', '-'));

test.describe('admin · Finanzas › Resultado por línea y Consolidados (F2b)', () => {
  test.skip(IS_REAL, 'las cifras dependen del seed: en real lo mide QA con el stack');

  test('escritorio: 6 columnas, Σ líneas = Total en pantalla, memo aparte, Marketplace reservado y Consolidados mes → año', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m7');
    const table = page.getByTestId('pnl-lines-table');
    await expect(table).toBeVisible();
    await expect(page.getByTestId('pnl-lines')).toContainText(t('es', 'admin.m7.lines.title'));
    for (const l of [...LINES, 'total'] as const) await expect(page.getByTestId(`pl-head-${l}`)).toBeVisible();
    for (const row of ['grossSales', 'netSales', 'cogs', 'contribution']) {
      let sum = 0;
      for (const l of LINES) sum += cents((await page.getByTestId(`pl-${row}-${l}`).locator('span').first().innerText()) || '0');
      expect(sum, row).toBe(cents(await page.getByTestId(`pl-${row}-total`).locator('span').first().innerText()));
    }
    await expect(page.getByTestId('pnl-lines-memo')).toContainText(t('es', 'admin.m7.lines.memo.title'));
    await expect(page.getByTestId('pnl-lines-marketplace')).toContainText(t('es', 'admin.m7.lines.marketplace.reserved'));
    // Sin jerga interna.
    for (const jerga of ['MTD', 'YTD', 'basis', 'clamped', 'unassigned', 'bps']) await expect(page.getByTestId('pnl-lines')).not.toContainText(jerga);

    const cons = page.getByTestId('pnl-consolidated');
    await expect(cons.getByTestId('cons-todate')).toContainText(t('es', 'admin.reports.compare.toDate.month'));
    for (const [unit, key] of [['quarter', 'Trimestre'], ['semester', 'Semestre'], ['year', 'Año']] as const) {
      await cons.getByRole('button', { name: key, exact: true }).click();
      await expect(page.getByTestId('cons-table')).toHaveAttribute('data-unit', unit);
      await expect(cons.getByTestId('cons-todate')).toContainText(t('es', `admin.reports.compare.toDate.${unit === 'year' ? 'year' : unit}`));
    }
  });

  test('celular (375 px): una línea junto al Total, sin desbordar la página; tabla de consolidados con desplazamiento propio', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m7');
    await expect(page.getByTestId('pnl-lines-table')).toBeVisible();
    await expect(page.getByTestId('pnl-lines-picker')).toBeVisible();
    await expect(page.getByTestId('pl-head-sealed')).toBeVisible();
    await expect(page.getByTestId('pl-head-raw')).toBeHidden();
    await expect(page.getByTestId('pl-head-total')).toBeVisible();
    await page.getByTestId('pnl-lines-picker').getByRole('button', { name: t('es', 'admin.m7.lines.line.graded'), exact: true }).click();
    await expect(page.getByTestId('pl-head-graded')).toBeVisible();
    await expect(page.getByTestId('pl-head-sealed')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // Consolidados: la tabla se desplaza dentro de su caja y arranca mostrando el periodo en curso (la última columna).
    const sc = page.getByTestId('cons-scroller');
    await expect(sc).toBeVisible();
    const m = await sc.evaluate((el) => ({ scrollable: el.scrollWidth > el.clientWidth, atEnd: Math.abs(el.scrollLeft + el.clientWidth - el.scrollWidth) <= 2 }));
    expect(m).toEqual({ scrollable: true, atEnd: true });
  });

  test('aviso de reparto dudoso: allocationMismatchOrders > 0 se ve junto a la tabla', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('tcg.mock.allocationMismatch', '2'));
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m7');
    await expect(page.getByTestId('pnl-lines-mismatch')).toContainText('2 pedidos');
  });

  test('Junta: franja «A la fecha» con mes, trimestre, semestre y año en curso; el operador no la ve', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/reportes');
    const strip = page.getByTestId('franja-to-date');
    await expect(strip).toBeVisible();
    for (const u of ['month', 'quarter', 'semester', 'year']) {
      const col = page.getByTestId(`to-date-${u}`);
      await expect(col).toHaveAttribute('data-todate', 'true');
      await expect(col.getByTestId('to-date-value')).toHaveCount(3);
    }
    await expect(strip).toContainText(t('es', 'admin.reports.board.areas.toDate.result'));
  });

  test('operador: Finanzas le sale restringida, sin secciones ni importes', async ({ page }) => {
    await loginAs(page, 'operator');
    await page.addInitScript(() => window.localStorage.setItem('tcg.role', 'vault_operator'));
    await page.goto('/es/admin/m7');
    await expect(page.getByText(t('es', 'admin.superAdminGateTitle'))).toBeVisible();
    await expect(page.getByTestId('pnl-lines')).toHaveCount(0);
    await expect(page.getByTestId('pnl-consolidated')).toHaveCount(0);
  });
});

test.describe('admin · caídas del selector con aviso (I-1)', () => {
  test.skip(IS_REAL, 'mock');
  const fb = () => t('es', 'admin.reports.period.fallback');
  test('«Todo» en Junta, Ventas, Compras y Operación avisa; en Finanzas NO hay aviso', async ({ page }) => {
    await loginAs(page, 'admin');
    for (const path of ['/es/admin/reportes', '/es/admin/m9', '/es/admin/reportes/compras', '/es/admin/reportes/operacion']) {
      await page.goto(`${path}?preset=all`);
      await expect(page.getByRole('status').filter({ hasText: '«Todo» no está disponible aquí (máximo 366 días)' }), path).toBeVisible();
      await expect(page).toHaveURL(/preset=month/);
    }
    await page.goto('/es/admin/m7?preset=all');
    await expect(page.getByTestId('period-selector')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'no está disponible' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: fb() })).toHaveCount(0);
  });
  test('fecha inexistente ⇒ «Ese periodo no es válido» en las 5 pantallas; un rango largo avisa «pasa de 366 días»', async ({ page }) => {
    await loginAs(page, 'admin');
    for (const path of ['/es/admin/reportes', '/es/admin/m9', '/es/admin/reportes/compras', '/es/admin/reportes/operacion', '/es/admin/m7']) {
      await page.goto(`${path}?preset=custom&from=2026-02-30&to=2026-03-01`);
      await expect(page.getByRole('status').filter({ hasText: fb() }), path).toBeVisible();
    }
    await page.goto('/es/admin/reportes?preset=custom&from=2024-01-01&to=2026-01-01');
    await expect(page.getByRole('status').filter({ hasText: 'Ese periodo pasa de 366 días' })).toBeVisible();
  });
});
