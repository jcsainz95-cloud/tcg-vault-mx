import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * §4-R (contrato v1.68, P-59) · el REINTENTO del mismo cliente tras un intento caído, contra el
 * bundle de mocks (`lib/mock/reservation.ts` simula la tabla de decisión del contrato):
 *
 *  cuenta   · 201 → cerrar modal → «Pagar» otra vez ⇒ `200 reused` (mismo pedido, sin duplicar)
 *           · cambiar el carrito ⇒ `201` + «tu intento anterior se canceló»
 *           · dial `tcg.mock.checkoutPiState=processing` ⇒ `409 PAYMENT_IN_PROGRESS` con bloqueo,
 *             enlace al pedido y «Reintentar en un momento» (que vuelve a llamar)
 *  invitado · el `checkoutToken` va a sessionStorage y el reintento lo manda ⇒ `200 reused`
 *           · sin token (otra pestaña / perdido) la reserva propia es «ajena» ⇒ `ITEM_UNAVAILABLE`
 *             ⇒ la poda de siempre (§4-R.3, R-7)
 *
 * Mock-only: contra el stack real esto exige un PI de Stripe en `processing` y una segunda
 * identidad; el smoke `@real` de compra vive en `checkout.spec.ts`.
 */
const PAY = /Pagar/;
const modalOf = (page: Page) => page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });

async function addFirstCard(page: Page) {
  await page.goto('/es/catalog');
  await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
}
async function addSecondCard(page: Page) {
  await page.goto('/es/catalog');
  await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).nth(1).click();
}
async function payAndCloseModal(page: Page) {
  await page.getByRole('complementary').getByRole('button', { name: PAY }).click();
  await expect(modalOf(page)).toBeVisible();
  await modalOf(page).getByRole('button', { name: 'Close' }).click();
  await expect(modalOf(page)).toBeHidden();
}

test.describe('checkout con cuenta · reintento sobre la propia reserva (§4-R.2)', () => {
  test.beforeEach(async ({ page }) => {
    mockOnly('el desenlace del reintento lo dicta el simulador de reservas de lib/mock');
    await loginAs(page, 'customer');
    await addFirstCard(page);
    await page.goto('/es/checkout');
  });

  test('intento caído ⇒ el segundo «Pagar» REUSA (mismo folio, cuenta atrás del servidor); carrito distinto ⇒ SUSTITUYE', async ({ page }) => {
    await payAndCloseModal(page);
    // Tras cerrar el modal, la reserva sigue siendo suya y se ve.
    await expect(page.getByTestId('reservation-countdown')).toContainText(/Reservado para ti hasta las \d{2}:\d{2}/);
    await expect(page.getByText(/Recuperamos tu reserva anterior/)).toHaveCount(0);

    await page.getByRole('complementary').getByRole('button', { name: PAY }).click();
    await expect(modalOf(page)).toBeVisible();
    await expect(page.getByText(/Recuperamos tu reserva anterior \(TCG-\d{6}\): es el mismo pedido y el mismo cobro/)).toBeVisible();
    await modalOf(page).getByRole('button', { name: 'Close' }).click();

    // Cambia el carrito (una pieza más) ⇒ sustitución: el intento anterior se cancela.
    await addSecondCard(page);
    await page.goto('/es/checkout');
    await page.getByRole('complementary').getByRole('button', { name: PAY }).click();
    await expect(modalOf(page)).toBeVisible();
    await expect(page.getByText('Tu intento anterior se canceló: este pedido lo sustituye y solo se cobra este.')).toBeVisible();
  });

  test('PI anterior no cancelable ⇒ 409 PAYMENT_IN_PROGRESS: bloqueo explicado, enlace al pedido y reintento', async ({ page }) => {
    await payAndCloseModal(page);
    // El PI del intento anterior pasa a `processing` (dial del simulador) y el carrito cambia.
    await page.evaluate(() => window.localStorage.setItem('tcg.mock.checkoutPiState', 'processing'));
    await addSecondCard(page);
    await page.goto('/es/checkout');
    await page.getByRole('complementary').getByRole('button', { name: PAY }).click();

    const block = page.getByTestId('payment-in-progress');
    await expect(block).toContainText('no se cobra dos veces');
    await expect(block.getByRole('link', { name: /Ver pedido TCG-\d{6}/ })).toHaveAttribute('href', /\/es\/orders\/ord-\d+$/);
    await expect(page.getByRole('complementary').getByRole('button', { name: /Pagar MX\$/ })).toBeDisabled();
    await expect(modalOf(page)).toHaveCount(0);

    // Stripe resolvió el PI: el reintento sustituye y abre el modal.
    await page.evaluate(() => window.localStorage.removeItem('tcg.mock.checkoutPiState'));
    await block.getByRole('button', { name: t('es', 'checkout.retry.retrySoon') }).click();
    await expect(modalOf(page)).toBeVisible();
    await expect(page.getByText(/Tu intento anterior se canceló/)).toBeVisible();
    await expect(page.getByTestId('payment-in-progress')).toHaveCount(0);
  });
});

test.describe('checkout de invitado · el token es la llave del reintento (§4-R.3)', () => {
  async function fillGuestForm(page: Page) {
    await page.getByRole('button', { name: t('es', 'checkout.identity.guest.cta') }).click();
    await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('invitado@dominio.com');
    await page.getByLabel(t('es', 'checkout.guest.recipientName')).fill('Juan Pérez');
    await page.getByLabel(t('es', 'addresses.line1')).fill('Av. Vallarta 1234');
    await page.getByLabel(t('es', 'addresses.city')).fill('Guadalajara');
    await page.getByLabel(t('es', 'addresses.state')).fill('Jalisco');
    await page.getByLabel(t('es', 'addresses.postalCode')).fill('44100');
    await page.getByLabel(t('es', 'addresses.phone')).fill('3312345678');
    await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
    await page.getByRole('checkbox', { name: t('es', 'checkout.guest.acceptTerms') }).check();
  }

  test.beforeEach(async ({ page }) => {
    mockOnly('el desenlace del reintento lo dicta el simulador de reservas de lib/mock');
    await addFirstCard(page);
    await page.goto('/es/checkout');
    await fillGuestForm(page);
  });

  test('con token en sessionStorage el reintento REUSA; sin token la reserva propia es «ajena» y se poda', async ({ page }) => {
    await payAndCloseModal(page);
    const stored = await page.evaluate(() => window.sessionStorage.getItem('tcg.guestCheckoutRetry'));
    expect(stored).not.toBeNull();
    expect(await page.evaluate(() => window.localStorage.getItem('tcg.guestCheckoutRetry'))).toBeNull();

    await page.getByRole('complementary').getByRole('button', { name: PAY }).click();
    await expect(modalOf(page)).toBeVisible();
    await expect(page.getByText(/Recuperamos tu reserva anterior \(TCG-\d{6}\)/)).toBeVisible();
    await modalOf(page).getByRole('button', { name: 'Close' }).click();

    // Token perdido (otra pestaña, sesión cerrada): no hay reclamo ⇒ ITEM_UNAVAILABLE ⇒ poda.
    await page.evaluate(() => window.sessionStorage.removeItem('tcg.guestCheckoutRetry'));
    await page.getByRole('complementary').getByRole('button', { name: PAY }).click();
    await expect(page.getByTestId('unavailable-notice')).toContainText('ya no está disponible y se quitó de tu carrito');
    await expect(modalOf(page)).toHaveCount(0);
  });
});
