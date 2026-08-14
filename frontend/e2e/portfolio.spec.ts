import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: gráfica de tendencia del portafolio en "Mi bóveda" (PROJECT §C / AC 8b;
 * contrato GET /vault/portfolio/history; DESIGN_SYSTEM §7.17). Estilo acciones,
 * toggle de rangos, delta con signo/flecha y resumen accesible.
 */
test.describe('bóveda · gráfica de tendencia del portafolio', () => {
  test('muestra la gráfica con encabezado de valor y toggle de rangos', async ({ page }) => {
    await page.goto('/es/vault');
    await expect(page.getByText(t('es', 'portfolio.trend.title'))).toBeVisible();

    const group = page.getByRole('group', { name: t('es', 'portfolio.trend.rangesAria') });
    await expect(group).toBeVisible();
    // 8 rangos: 5d/15d/1m/3m/6m/1a/YTD/Máx.
    await expect(group.getByRole('button')).toHaveCount(8);
  });

  test('cambiar de rango actualiza la gráfica (mock genera la serie)', async ({ page }) => {
    await page.goto('/es/vault');
    const group = page.getByRole('group', { name: t('es', 'portfolio.trend.rangesAria') });
    await group.getByRole('button', { name: t('es', 'portfolio.trend.ranges.6m'), exact: true }).click();
    await expect(group.getByRole('button', { name: t('es', 'portfolio.trend.ranges.6m'), exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
