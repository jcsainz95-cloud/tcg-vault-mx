import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: catálogo (filtros) → ficha (valor de mercado vs precio de venta, "precio
 * pendiente"). PROJECT §A / AC 1, 2, 3, 3b; contrato §2. Datos de carta en inglés.
 */
test.describe('catálogo · listado y filtros', () => {
  test('lista cartas y filtra por rareza', async ({ page }) => {
    await page.goto('/es/catalog');
    await expect(page.getByRole('heading', { name: t('es', 'catalog.title') })).toBeVisible();

    // Datos de catálogo en inglés (no se traducen).
    await expect(page.getByText('Charizard').first()).toBeVisible();
    await expect(page.getByText('Pikachu').first()).toBeVisible();

    // Filtro por rareza "Common" → quedan solo comunes; Charizard (Rare Holo) desaparece.
    await page.getByLabel(t('es', 'catalog.filterRarity')).selectOption('Common');
    await expect(page.getByText('Pikachu').first()).toBeVisible();
    await expect(page.getByText('Charizard')).toHaveCount(0);
  });

  test('carta "precio pendiente" no es comprable', async ({ page }) => {
    await page.goto('/es/catalog');
    // Zapdos (inv-1004) entra como precio pendiente en los fixtures del contrato.
    await expect(page.getByText(t('es', 'price.pendingLabel')).first()).toBeVisible();
    // El CTA de esa carta está deshabilitado (regla de confianza: no vendible).
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.notForSale'), disabled: true }).first(),
    ).toBeVisible();
  });
});

test.describe('catálogo · ficha de carta', () => {
  test('distingue valor de mercado vs precio de venta', async ({ page }) => {
    await page.goto('/es/catalog/c-charizard');

    await expect(page.getByRole('heading', { name: 'Charizard' })).toBeVisible();
    // Explicación referencia vs venta (banner de confianza).
    await expect(page.getByText(t('es', 'card.referenceExplainer'))).toBeVisible();
    // Valor de mercado (referencia) presente.
    await expect(page.getByText(t('es', 'catalog.marketValue')).first()).toBeVisible();
    // Precio de venta se muestra "sin IVA" (PROJECT AC 2/3b).
    await expect(page.getByText(t('es', 'common.withoutIva')).first()).toBeVisible();
    // CTA comprar disponible para carta vendible.
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
