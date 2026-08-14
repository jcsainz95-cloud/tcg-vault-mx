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
    // Filtra a Raw (NM) para ver el badge legible.
    await page.getByRole('button', { name: t('es', 'shop.type.raw'), exact: true }).click();
    await expect(page.getByText(t('es', 'catalog.condition.nm.label')).first()).toBeVisible();
    // El estándar vive en el title/tooltip (+ aria-label).
    await expect(page.locator('[title*="Como nueva"]').first()).toBeVisible();
  });
});

test.describe('Compra · ficha de carta', () => {
  test('distingue valor de mercado vs precio de venta', async ({ page }) => {
    await page.goto('/es/catalog/c-charizard');

    await expect(page.getByRole('heading', { name: 'Charizard' })).toBeVisible();
    await expect(page.getByText(t('es', 'card.referenceExplainer'))).toBeVisible();
    await expect(page.getByText(t('es', 'catalog.marketValue')).first()).toBeVisible();
    await expect(page.getByText(t('es', 'common.withoutIva')).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first(),
    ).toBeEnabled();
  });

  test('ficha traducida a inglés mantiene el nombre de carta en inglés', async ({ page }) => {
    await page.goto('/en/catalog/c-charizard');
    await expect(page.getByText(t('en', 'card.referenceExplainer'))).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Charizard' })).toBeVisible();
  });
});
