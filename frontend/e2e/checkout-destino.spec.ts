import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * N1 (ux-review de marketing 2026-11-03; medido por el orquestador en producción a 390 px, N=1): en el checkout de
 * invitado «Envío a mi domicilio» era un `<div>` sin control. Tras tocar «Guardar en mi bóveda», PAGAR quedaba
 * deshabilitado y tocar «Envío a mi domicilio» no hacía nada; la única salida quedaba ~740 px más abajo y la dirección
 * seguía a la vista. Aquí, a 390 y 1280 contra el bundle de MOCKS (la conducta es de pantalla, no del backend):
 *  - las dos opciones son botones `aria-pressed` de ≥ 44 px;
 *  - bóveda → «Envío a mi domicilio» → PAGAR habilitado;
 *  - el aviso de bloqueo lleva a esa opción («Elegir envío a domicilio»);
 *  - en modo bóveda la dirección de envío no se ve, y al volver conserva lo capturado.
 * Más el menor de las pestañas: a 390 «GRADEADAS» queda cortada y debe haber indicio de desplazamiento.
 */

async function openCheckoutWithCard(page: Page) {
  await page.goto('/es/catalog');
  await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
  await page.goto('/es/checkout');
  await expect(page.getByLabel(t('es', 'checkout.guest.email.label'), { exact: true })).toBeVisible();
}

async function confirmEmail(page: Page) {
  await page.getByLabel(t('es', 'checkout.guest.email.label'), { exact: true }).fill('invitado@dominio.com');
  await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
  // Sin foco en un campo de texto: con el teclado «abierto» la barra móvil no se pinta (L2).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const PAY_RE = new RegExp(`^${t('es', 'checkout.payNoAmount')}$`);

for (const vp of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const) {
  test.describe(`N1 · destino del checkout · ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test(`bóveda → «Envío a mi domicilio» → PAGAR habilitado (${vp.width})`, async ({ page }) => {
      await openCheckoutWithCard(page);
      await confirmEmail(page);
      const region = page.getByRole('region', { name: t('es', 'checkout.destination.eyebrow') });
      const ship = region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.ship')) });
      const vault = region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.vault')) });
      const pay = page.getByRole('button', { name: PAY_RE });

      // Objetivos táctiles ≥ 44 px en las dos opciones.
      for (const opt of [ship, vault]) {
        const box = await opt.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await expect(ship).toHaveAttribute('aria-pressed', 'true');
      await expect(pay).toBeEnabled();

      await vault.click();
      await expect(vault).toHaveAttribute('aria-pressed', 'true');
      await expect(pay).toBeDisabled();
      await expect(page.getByTestId('vault-upsell')).toBeVisible();
      // En modo bóveda la dirección no se ve.
      await expect(page.getByLabel(t('es', 'checkout.guest.recipientName'))).toBeHidden();

      await ship.click();
      await expect(page.getByTestId('vault-upsell')).toBeHidden();
      await expect(ship).toHaveAttribute('aria-pressed', 'true');
      await expect(vault).toHaveAttribute('aria-pressed', 'false');
      await expect(pay).toBeEnabled();
      await expect(page.getByLabel(t('es', 'checkout.guest.recipientName'))).toBeVisible();
    });

    test(`el aviso de bloqueo lleva a envío a domicilio (${vp.width})`, async ({ page }) => {
      await openCheckoutWithCard(page);
      await confirmEmail(page);
      const region = page.getByRole('region', { name: t('es', 'checkout.destination.eyebrow') });
      await region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.vault')) }).click();
      const pay = page.getByRole('button', { name: PAY_RE });
      await expect(pay).toBeDisabled();
      const action = page.getByRole('button', { name: t('es', 'checkout.guest.payBlocked.vaultAction') });
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      if (vp.width < 1024) {
        // La salida va DENTRO de la barra fija, que no crece (≤ 120 px, CHK-MOVIL.2.4).
        const barBox = await page.getByTestId('checkout-pay-bar').boundingBox();
        expect(barBox?.height ?? 999).toBeLessThanOrEqual(120);
      }
      await action.click();
      await expect(pay).toBeEnabled();
      await expect(region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.ship')) })).toBeFocused();
    });
  });
}

test.describe('N1 menor · pestañas de la tienda a 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('si la fila no cabe hay indicio de desplazamiento; en «Gradeadas» la pestaña activa se ve entera', async ({ page }) => {
    await page.goto('/es/catalog');
    const nav = page.getByRole('navigation', { name: t('es', 'storeTabs.label') });
    await expect(nav).toBeVisible();
    const overflows = await nav.evaluate((n) => n.scrollWidth > n.clientWidth);
    expect(overflows, 'a 390 las cuatro pestañas no caben (premisa del defecto)').toBe(true);
    await expect(page.getByTestId('store-tabs-more')).toBeVisible();

    await page.goto('/es/catalog?productType=graded');
    const graded = nav.getByRole('link', { name: t('es', 'storeTabs.graded') });
    await expect(graded).toHaveAttribute('aria-current', 'page');
    const inside = await graded.evaluate((el) => {
      const n = el.parentElement!.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return b.left >= n.left - 0.5 && b.right <= Math.min(n.right, window.innerWidth) + 0.5;
    });
    expect(inside, '«Gradeadas» activa entera dentro de la fila').toBe(true);
  });
});
