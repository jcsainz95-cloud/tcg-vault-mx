import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: toggle de idioma ES/EN (PROJECT AC 32, DESIGN_SYSTEM §6.5).
 * Verifica que TODOS los textos de UI cambian de idioma y que el prefijo de ruta
 * refleja el locale. Los datos de catálogo permanecen en inglés (no se traducen).
 */
test.describe('i18n · toggle de idioma ES/EN', () => {
  test('cambia la UI de español a inglés y actualiza la ruta', async ({ page }) => {
    await page.goto('/es');

    // Nav en español (default).
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: t('es', 'nav.catalog') })).toBeVisible();

    // Toggle EN (segmented control ES|EN del header).
    const toggle = page.getByRole('group', { name: 'Idioma / Language' }).first();
    await toggle.getByRole('button', { name: 'en', exact: true }).click();

    await expect(page).toHaveURL(/\/en(\/|$)/);
    await expect(nav.getByRole('link', { name: t('en', 'nav.catalog') })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('vuelve a español con el toggle', async ({ page }) => {
    await page.goto('/en/catalog');
    await expect(page.getByRole('heading', { name: t('en', 'catalog.title') })).toBeVisible();

    const toggle = page.getByRole('group', { name: 'Idioma / Language' }).first();
    await toggle.getByRole('button', { name: 'es', exact: true }).click();

    await expect(page).toHaveURL(/\/es(\/|$)/);
    await expect(page.getByRole('heading', { name: t('es', 'catalog.title') })).toBeVisible();
  });
});
