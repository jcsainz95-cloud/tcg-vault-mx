import { test, expect, type Page } from '@playwright/test';

/**
 * QA de marketing (2026-11-02): a 390 px la cabecera de tcghunt.mx solo enseñaba «TCG HUNT — inicio» y «Menú»
 * (medido por el orquestador con Playwright en producción); el carrito vivía dentro del menú. Candado de GEOMETRÍA
 * del acceso al carrito en < lg (`StorefrontHeader`, `data-testid="header-cart-mobile"`):
 *  - visible sin abrir el menú, dentro del <header>, objetivo táctil ≥ 44×44 px;
 *  - la cabecera NO crece: alto ≤ 77 px (la cifra de la aritmética de MKT-CONV.8 / L-8, «cabecera 77»), para no
 *    comerse el margen ≥ 20 px a 360 (criterio 943);
 *  - nombre accesible con la cantidad y destino /checkout;
 *  - en lg (1280) se oculta: allí está el botón de texto «Carrito N».
 * Mutaciones que lo ponen rojo: quitar el enlace o cambiar `h-11 min-w-11` por `h-10 w-10` (rojo por < 44 px).
 * Etiqueta `@real`: conducta de layout, corre igual contra el stack sembrado (no depende de ids del carrito).
 */
const WIDTHS = [360, 390, 414] as const;
const cartIcon = (page: Page) => page.getByTestId('header-cart-mobile');

async function seedCart(page: Page, ids: string[]) {
  await page.evaluate((ids) => window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, updatedAt: Date.now() })), ids);
}

for (const width of WIDTHS) {
  test.describe(`Carrito en cabecera · ${width} px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test(`icono visible ≥ 44 px, cabecera ≤ 77 px y nombre con la cantidad @real`, async ({ page }) => {
      await page.goto('/es/catalog');
      await expect(page.getByRole('button', { name: 'Menú' })).toHaveAttribute('aria-expanded', 'false');
      const icon = cartIcon(page);
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('aria-label', 'Carrito: vacío');
      await expect(icon).toHaveAttribute('href', '/es/checkout');

      const g = await page.evaluate(() => {
        const header = document.querySelector('header')!.getBoundingClientRect();
        const el = document.querySelector('[data-testid="header-cart-mobile"]')!.getBoundingClientRect();
        return {
          headerH: header.height,
          inside: el.top >= header.top && el.bottom <= header.bottom && el.left >= 0 && el.right <= window.innerWidth,
          w: el.width,
          h: el.height,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      test.info().annotations.push({ type: `header-cart-${width}`, description: JSON.stringify(g) });
      expect(g.inside, JSON.stringify(g)).toBe(true);
      expect(g.w, JSON.stringify(g)).toBeGreaterThanOrEqual(44);
      expect(g.h, JSON.stringify(g)).toBeGreaterThanOrEqual(44);
      expect(g.headerH, JSON.stringify(g)).toBeLessThanOrEqual(77.5);
      expect(g.scrollWidth, JSON.stringify(g)).toBe(width);

      // Con piezas en el carrito, el nombre accesible lleva la cantidad; el toque lleva a /checkout.
      await seedCart(page, ['e2e-a', 'e2e-b']);
      await page.reload();
      await expect(cartIcon(page)).toHaveAttribute('aria-label', 'Carrito: 2 artículos');
      await cartIcon(page).tap();
      await expect(page).toHaveURL(/\/es\/checkout$/);
    });
  });
}

test('en lg (1280) el icono no se ve y queda el botón de texto «Carrito» @real', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/es/catalog');
  await expect(cartIcon(page)).toBeHidden();
  await expect(page.locator('header').getByRole('link', { name: /^Carrito\s*\d+$/ })).toBeVisible();
});
