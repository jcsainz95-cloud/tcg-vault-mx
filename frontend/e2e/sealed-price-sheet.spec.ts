import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * **La hoja «Precios del sellado» en un navegador de verdad** (`DESIGN_SYSTEM §70.2`, contrato `§M11-SP.5 + 12.4 +
 * 13.7`). Recorrido corto del dueño: ve las nueve columnas, abre el editor, teclea un precio CON IVA, confirma y lee el
 * aviso con las cuentas de `autoPublish`.
 *
 * **Censo:** `mockOnly` — sigue las filas del fixture (`lib/mock/fixtures.ts`, «servidor falso de la hoja»). SIN versión
 * real todavía (hueco declarado): el seed real no siembra un `SealedProduct` con piezas ligadas y costo; con esa fila,
 * este caso se reescribe agnóstico.
 */

const PS = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m11.priceSheet.${key}`, vars);
const ED = (key: string, vars?: Record<string, string | number>) => t('es', `admin.sealedProductPrice.${key}`, vars);

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('§70.2 · M11 · hoja «Precios del sellado»', () => {
  test('el dueño fija el precio con IVA de un producto y lee lo que se publicó solo', async ({ page }) => {
    mockOnly('filas del fixture de la hoja');
    const errors = collectPageErrors(page);
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m11#precios-sellado');

    const sheet = page.locator('#precios-sellado');
    await expect(sheet.getByRole('heading', { name: PS('title') })).toBeVisible();
    for (const col of ['col.product', 'col.pieces', 'col.cost', 'col.owner', 'col.automatic', 'col.effective', 'col.net', 'col.market', 'col.margin']) {
      // Anclado al inicio: «Costo promedio» también aparece dentro de la ayuda de «Margen».
      const name = new RegExp(`^${PS(col).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      await expect(sheet.getByRole('columnheader', { name })).toBeVisible();
    }
    // Banner de piezas sin producto (cuenta global del fixture: 3).
    // (El helper `t` no resuelve plurales ICU: los textos con plural se asertan literales.)
    await expect(sheet.getByText(/^3 piezas de sellado no están ligadas a un producto/)).toBeVisible();

    const row = sheet.getByTestId('sheet-row-sp-scr-box');
    await expect(row).toContainText('MX$2,517.20');
    await expect(row).toContainText(PS('origin.automatic'));

    await row.getByRole('button', { name: ED('setAria', { name: 'Stellar Crown Booster Box' }) }).click();
    const input = row.getByLabel(ED('label'));
    await expect(input).toHaveValue('');
    await input.fill('2,900');
    // Margen en vivo con la tasa de la respuesta (16): N = round(290000·100/116) = 250000 ⇒ margen 50000 sobre 200000.
    await expect(row.getByTestId('sealed-product-price-margin-preview')).toContainText('MX$2,500.00');
    await expect(row.getByTestId('sealed-product-price-margin-preview')).toContainText('MX$500.00');
    await row.getByRole('button', { name: ED('save') }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('MX$2,900.00');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await dialog.getByTestId('sealed-product-price-confirm').click();

    const notice = sheet.getByTestId('sealed-price-saved-notice');
    await expect(notice).toContainText('Stellar Crown Booster Box: MX$2,900.00 con IVA para sus 3 piezas.');
    await expect(notice).toContainText('Se puso a la venta sola: 1.');
    await expect(row).toContainText(PS('origin.product'));
    expect(errors).toEqual([]);
  });
});
