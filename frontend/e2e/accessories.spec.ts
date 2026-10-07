import { test, expect } from '@playwright/test';
import { t, LOCALES } from './utils/i18n';
import { mockOnly } from './utils/auth';

/**
 * §AC — smoke de accesorios en MODO MOCK (`lib/mock/accessories.ts`), ES y EN (AC-F14, parte de pantalla).
 *
 * ⚠️ Esto NO es todavía el recorrido de punta a punta de los criterios 724 y 748 contra el stack corriendo: ese
 * necesita el backend de §AC (alta con foto PNG, pago con tarjeta de prueba, preparación y existencias que bajan),
 * que hoy no existe. Aquí se recorre lo que la pantalla hace sola con el simulador: la pestaña, el listado, la
 * ficha, el carrito con el grupo «ACCESORIOS», «¿Te falta algo?» y el paquete de energías desde un deck.
 * Pendiente registrado en FRONTEND_NOTES §107.
 */
for (const locale of LOCALES) {
  test.describe(`accesorios (${locale})`, () => {
    test.beforeEach(() => mockOnly('el simulador de §AC sirve el catálogo y la cotización'));

    test('pestaña → listado → ficha → carrito con el renglón y la sugerencia', async ({ page }) => {
      await page.goto(`/${locale}/accesorios`);
      const tab = page.getByRole('link', { name: t(locale, 'storeTabs.accessories') });
      await expect(tab).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { level: 1, name: t(locale, 'accessories.title') })).toBeVisible();
      // Agotado: sin botón (AC-UX-2).
      await expect(page.getByTestId('accessory-tile-acc-playmat').getByRole('button')).toHaveCount(0);

      await page.getByTestId('accessory-tile-acc-sleeves').getByRole('link').first().click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/accesorios/acc-sleeves$`));
      await page.getByRole('button', { name: t(locale, 'accessories.addToCart') }).click();

      await page.goto(`/${locale}/checkout`);
      await expect(page.getByText(t(locale, 'checkout.accessories.groupAccessories'), { exact: true })).toBeVisible();
      await expect(page.getByTestId('cart-accessory-acc-sleeves')).toBeVisible();
      const suggestions = page.getByRole('region', { name: t(locale, 'checkout.suggestions.title') });
      await expect(suggestions).toBeVisible();
      // ⛔ Energías nunca en «¿Te falta algo?».
      await expect(suggestions.getByText(/Energía|Energy/)).toHaveCount(0);
    });

    test('deck: «Agregar de jalón» no agrega el paquete; «Agregar paquete» lo pone en el carrito', async ({ page }) => {
      await page.goto(`/${locale}/decks-meta`);
      await page.getByRole('link', { name: t(locale, 'decksMeta.list.view') }).first().click();
      const box = page.getByTestId('deck-energy-bundle');
      await expect(box).toBeVisible();
      const addBundle = box.getByRole('button', { name: t(locale, 'decksMeta.bundle.add') });
      await expect(addBundle).toBeDisabled();
      await page.getByRole('button', { name: t(locale, 'decksMeta.addAll.button') }).click();
      await expect(addBundle).toBeEnabled();
      await addBundle.click();
      // Las piezas del deck mock no son listados del fixture del catálogo (la cotización mock las podaría): el
      // carrito de punta a punta va en el E2E real de 748, pendiente del backend.
      await expect(box.getByRole('button', { name: new RegExp(t(locale, 'decksMeta.bundle.inCart')) })).toBeVisible();
      await expect(box.getByRole('button', { name: t(locale, 'decksMeta.bundle.remove') })).toBeVisible();
    });
  });
}
