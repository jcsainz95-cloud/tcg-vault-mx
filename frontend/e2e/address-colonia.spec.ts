import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';

/**
 * **La colonia como Mercado Libre** (`HECHOS.md:57`; contrato v1.80.12.5 `§M4-SHIP.19.25`, fila «E2E» de
 * §19.25.6; diseño `DESIGN_SYSTEM §43.18m`): la lista del CP AYUDA, no bloquea. La tienda nunca deja de vender
 * por el catálogo de CP.
 *
 * Por qué `20000`: NO está en el catálogo del arnés (`E2E_POSTAL_CODES`, `backend/prisma/e2e-fixtures.ts`) ni en
 * el doble del modo mock (`src/lib/mock/skydropx.ts`, `POSTAL_CODES`). Contra el stack real es el caso
 * «catálogo vacío / CP desconocido» que el dueño pidió que venda.
 *
 * Mutación que lo pone rojo (§19.25.6): ocultar los campos de texto cuando el `GET` responde `404` ⇒ el flujo no
 * llega a pagar.
 */

const UNKNOWN_CP = '20000';

async function addFirstCardToCart(page: Page) {
  await page.goto('/es/catalog');
  await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
}

test.describe('colonia como Mercado Libre · §M4-SHIP.19.25', () => {
  /**
   * ⚠️ ENTORNO (no producto), igual que el smoke del invitado de `guest-checkout.spec.ts`: contra un stack sin
   * clave de Stripe la sesión responde `PAYMENT_PROVIDER_UNAVAILABLE` y el modal no abre. Antes de reportar un
   * rojo aquí, confirma `STRIPE_SECRET_KEY` en el stack.
   */
  test('@real invitado con un CP fuera del catálogo: escribe colonia, municipio y estado y paga', async ({ page }) => {
    await addFirstCardToCart(page);
    await page.goto('/es/checkout');
    await page.getByRole('button', { name: t('es', 'checkout.identity.guest.cta') }).click();

    await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('invitado@dominio.com');
    await page.getByLabel(t('es', 'checkout.guest.recipientName')).fill('Juan Pérez');
    await page.getByLabel(t('es', 'addresses.line1')).fill('Av. Madero 100');
    await page.getByLabel(t('es', 'addresses.postalCode')).fill(UNKNOWN_CP);

    // CA-7: el aviso explica, no acusa; ⛔ sin «Escríbenos» como única salida.
    await expect(page.getByTestId('address-geo-intro')).toHaveText(t('es', 'addresses.geo.cpNotInCatalog', { cp: UNKNOWN_CP }));
    await expect(page.getByLabel(t('es', 'addresses.postalCode'))).not.toHaveAttribute('aria-invalid', 'true');

    await page.getByRole('textbox', { name: t('es', 'addresses.neighborhood'), exact: true }).fill('Zona Centro');
    await page.getByRole('textbox', { name: t('es', 'addresses.city'), exact: true }).fill('Aguascalientes');
    await page.getByRole('combobox', { name: t('es', 'addresses.state'), exact: true }).selectOption({ label: 'Aguascalientes' });
    await page.getByLabel(t('es', 'addresses.phone')).fill('4491234567');
    await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
    await page.locator('#guest-terms').check(); // LIVE-8 sitio 3: la etiqueta lleva enlaces (§80.1)

    const session = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/checkout/guest/session'), {
      timeout: IS_REAL ? 30_000 : 1_000,
    }).catch(() => null);
    await page.getByRole('button', { name: /Pagar/ }).click();

    const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
    await expect(modal).toBeVisible();
    if (IS_REAL) {
      // Contra el backend: la sesión salió con lo tecleado (la orden y su PaymentIntent existen: el modal abrió).
      const req = await session;
      expect(req?.postDataJSON()?.shippingAddress).toMatchObject({
        postalCode: UNKNOWN_CP,
        neighborhood: 'Zona Centro',
        city: 'Aguascalientes',
        state: 'Aguascalientes',
      });
      await expect(modal.getByText(t('es', 'payment.mockBody'))).toBeHidden();
    } else {
      await modal.getByRole('button', { name: /Pagar/ }).click();
      await expect(page.getByTestId('guest-order-number')).toBeVisible();
      await expect(page.getByText(t('es', 'checkout.confirmation.title'))).toBeVisible();
    }
  });

  test('@real libreta: CP del arnés + «Mi colonia no está» ⇒ guarda la colonia escrita', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/account');
    const book = page.locator('#addresses');
    await book.getByRole('button', { name: t('es', 'addresses.add'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('es', 'addresses.recipientName')).fill('E2E Colonia Escrita');
    await dialog.getByLabel(t('es', 'addresses.line1')).fill('Calle Colonia E2E 7');
    // '06600' está en el catálogo del arnés y en el doble del modo mock (Juárez / Roma Norte).
    await dialog.getByLabel(t('es', 'addresses.postalCode')).fill('06600');
    await dialog.getByRole('button', { name: t('es', 'addresses.geo.notListedCta') }).click();
    const typed = dialog.getByRole('textbox', { name: t('es', 'addresses.neighborhood'), exact: true });
    await expect(typed).toBeFocused();
    const colonia = `Fracc. E2E ${Date.now() % 100000}`;
    await typed.fill(colonia);
    await dialog.getByLabel(t('es', 'addresses.phone')).fill('5555123456');
    await dialog.getByRole('button', { name: t('es', 'addresses.save'), exact: true }).click();
    await expect(dialog).toBeHidden();

    const row = book.getByRole('listitem').filter({ hasText: colonia });
    await expect(row).toHaveCount(1);
    // Limpieza: contra el seed real la libreta del customer es compartida entre corridas.
    await row.getByRole('button', { name: t('es', 'addresses.delete'), exact: true }).click();
    await expect(book.getByRole('listitem').filter({ hasText: colonia })).toHaveCount(0);
  });
});
