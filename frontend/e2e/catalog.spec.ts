import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: "Compra" (antes "Catálogo") — vitrina de inventario publicado CON precio
 * (v1.1: nunca "precio pendiente"), filtros (rareza multi-select, set con año,
 * tipo/sellado), condición NM legible con tooltip, y ficha (valor de mercado vs
 * precio de venta). PROJECT §A / AC 1, 1b, 2, 3b, 3c, 3e; contrato §2. Datos EN.
 */
test.describe('Compra · listado y filtros', () => {
  test('rótulo "Compra" y datos de catálogo en inglés', async ({ page }) => {
    await page.goto('/es/catalog');
    await expect(page.getByRole('heading', { name: t('es', 'catalog.title') })).toBeVisible();
    // "Compra" también en el nav.
    await expect(
      page.getByRole('navigation').first().getByRole('link', { name: t('es', 'nav.shop') }),
    ).toBeVisible();
    await expect(page.getByText('Charizard').first()).toBeVisible();
    await expect(page.getByText('Pikachu').first()).toBeVisible();
  });

  test('filtra por rareza (multi-select buscable) mandando la rareza cruda', async ({ page }) => {
    await page.goto('/es/catalog');
    // Marca la rareza "Common" en el combobox de rareza (panel lateral en lg).
    await page.getByRole('option', { name: 'Common', exact: true }).click();
    await expect(page.getByText('Pikachu').first()).toBeVisible();
    await expect(page.getByText('Charizard')).toHaveCount(0);
  });

  test('Compra NUNCA muestra "precio pendiente" (v1.1)', async ({ page }) => {
    await page.goto('/es/catalog');
    await expect(page.getByText('Charizard').first()).toBeVisible();
    await expect(page.getByText(t('es', 'price.pendingLabel'))).toHaveCount(0);
  });

  test('tarjeta de SELLADO: badge "Sellado" + precio, sin condición/rareza', async ({ page }) => {
    await page.goto('/es/catalog');
    // Filtra a Sellado.
    await page.getByRole('button', { name: t('es', 'shop.type.sealed'), exact: true }).click();
    await expect(page.getByText('Surging Sparks Booster Box').first()).toBeVisible();
    await expect(page.getByText(t('es', 'card.productType.sealed')).first()).toBeVisible();
    // Precio siempre visible (sin IVA).
    await expect(page.getByText(t('es', 'common.withoutIva')).first()).toBeVisible();
  });

  test('condición NM legible con tooltip del estándar', async ({ page }) => {
    await page.goto('/es/catalog');
    // Filtra a Raw (NM) para ver la ficha técnica de la copia.
    await page.getByRole('button', { name: t('es', 'shop.type.raw'), exact: true }).click();
    // En la retícula la condición se abrevia a NM (renglón `RAW · NM · ACABADO`)
    // y el estándar vive en el title/tooltip (+ aria-label).
    await expect(page.getByText(/Raw · NM/).first()).toBeVisible();
    await expect(page.locator('[title*="Como nueva"]').first()).toBeVisible();
  });

  test('la ficha de detalle pinta la condición con su etiqueta legible', async ({ page }) => {
    // La etiqueta completa ("Casi nueva (NM)") es la que ocupa la celda de
    // Condición en la ficha, donde sí hay hueco para leerla entera.
    await page.goto('/es/catalog/c-pikachu');
    await expect(page.getByText(t('es', 'catalog.condition.nm.label')).first()).toBeVisible();
  });
});

test.describe('Compra · ficha de carta', () => {
  test('distingue valor de mercado vs precio de venta (§21.8: el mercado FIJÓ el precio)', async ({ page }) => {
    await page.goto('/es/catalog/c-charizard');

    await expect(page.getByRole('heading', { name: 'Charizard' })).toBeVisible();
    // v2.0 (P-48): la nota al pie tiene DOS variantes; con bloque de mercado va la «WithMarket».
    await expect(page.getByText(t('es', 'card.referenceExplainerWithMarket'))).toBeVisible();
    await expect(page.getByText(t('es', 'catalog.marketValue')).first()).toBeVisible();
    await expect(page.getByText(t('es', 'common.withoutIva')).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first(),
    ).toBeEnabled();
  });

  test('«Comprar» da feedback: toast + CTA «En el carrito»; el segundo clic lleva al carrito', async ({ page }) => {
    await page.goto('/es/catalog/c-charizard');
    await page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first().click();

    // Confirmación efímera (toast §7.5) con enlace al carrito.
    await expect(
      page.getByRole('status').getByText(t('es', 'catalog.addedToCart')),
    ).toBeVisible();

    // El CTA de ESA pieza cambia de estado y, al re-clicar, navega al carrito.
    const inCart = page.getByRole('button', { name: t('es', 'catalog.inCart') }).first();
    await expect(inCart).toBeVisible();
    await inCart.click();
    await page.waitForURL('**/checkout');
  });

  test('pieza ya en el carrito al recargar la ficha → CTA inicial «En el carrito»', async ({ page }) => {
    await page.goto('/es/catalog/c-charizard');
    await page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first().click();
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.inCart') }).first(),
    ).toBeVisible();

    // El carrito vive en localStorage: al recargar, el estado se restaura tras montar.
    await page.reload();
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.inCart') }).first(),
    ).toBeVisible();
  });

  test('ficha traducida a inglés mantiene el nombre de carta en inglés', async ({ page }) => {
    await page.goto('/en/catalog/c-charizard');
    await expect(page.getByText(t('en', 'card.referenceExplainerWithMarket'))).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Charizard' })).toBeVisible();
  });
});
