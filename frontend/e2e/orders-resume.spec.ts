import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * §4-R.5 (contrato v1.68): `GET /orders` trae `orderNumber` REAL y, en `pending`, `reservedUntil`.
 * La columna PEDIDO pinta el folio; la fila `pending` ofrece «Reanudar pago», que carga las piezas
 * del pedido al carrito y vuelve a `/checkout`, donde `POST /checkout/session` responde `200 reused`
 * (mismo pedido, mismo PI). **No hay endpoint de reanudar.**
 *
 * Mock-only por DATOS: `ord-9002` (`TCG-009002`, pending, reservado a la cuenta) y `ord-9003`
 * (`orderNumber: null` ⇒ cae al id) son fixtures. Contra el stack real el folio sale de la BD y no
 * hay un `pending` con reserva viva prometido por el seed.
 */
test.describe('pedidos · folio real y «Reanudar pago» (§4-R.5)', () => {
  test.beforeEach(async ({ page }) => {
    mockOnly('depende de ord-9002 (pending reservado) y ord-9003 (sin folio) de las fixtures');
    await loginAs(page, 'customer');
  });

  test('la columna PEDIDO muestra el folio real y cae al id solo cuando el servidor manda null', async ({ page }) => {
    await page.goto('/es/orders');
    await expect(page.getByRole('link', { name: 'TCG-009001' }).first()).toHaveAttribute('href', /\/orders\/ord-9001$/);
    await expect(page.getByRole('link', { name: 'TCG-009002' }).first()).toHaveAttribute('href', /\/orders\/ord-9002$/);
    await expect(page.getByRole('link', { name: 'ord-9003' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'ord-9002', exact: true })).toHaveCount(0);
  });

  test('pending reservado: «Reservado hasta las HH:MM» + «Reanudar pago» ⇒ /checkout ⇒ 200 reused del MISMO pedido', async ({ page }) => {
    await page.goto('/es/orders');
    const resume = page.getByTestId('resume-payment').first();
    await expect(resume).toContainText(/Reservado hasta las \d{2}:\d{2}/);
    await resume.getByRole('button', { name: t('es', 'orders.resume.cta') }).click();

    await expect(page).toHaveURL(/\/es\/checkout$/);
    // El carrito es exactamente el del pedido (Blastoise = inv-1002 en fixtures).
    await expect(page.getByText('Blastoise')).toBeVisible();
    await page.getByRole('button', { name: /Pagar/ }).click();
    const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
    await expect(modal).toBeVisible();
    // Reuso: el mismo folio, y la cuenta atrás con la hora del servidor (renovada).
    await expect(page.getByText(/Recuperamos tu reserva anterior \(TCG-009002\)/)).toBeVisible();
    await expect(page.getByTestId('reservation-countdown')).toContainText(/Reservado para ti hasta las \d{2}:\d{2}/);
  });

  test('v1.68.1: reserva VENCIDA sin barrer ⇒ «Reanudar pago» sigue ⇒ /checkout avisa que venció y la sesión sustituye (201)', async ({ page }) => {
    await page.goto('/es/orders');
    await expect(page.getByTestId('resume-payment').first()).toBeVisible();
    await page.evaluate(() => {
      const s = JSON.parse(window.sessionStorage.getItem('tcg.mock.reservations')!);
      for (const r of s.reservations) r.reservedUntil = new Date(Date.now() - 60_000).toISOString();
      window.sessionStorage.setItem('tcg.mock.reservations', JSON.stringify(s));
    });
    await page.reload();
    const resume = page.getByTestId('resume-payment').first();
    await expect(resume.getByTestId('resume-expired')).toContainText('La reserva venció');
    await resume.getByRole('button', { name: t('es', 'orders.resume.cta') }).click();
    await expect(page).toHaveURL(/\/es\/checkout$/);
    await expect(page.getByTestId('own-reservation-expired')).toContainText('TCG-009002');
    await expect(page.getByText('Blastoise')).toBeVisible();
    await page.getByRole('button', { name: /Pagar/ }).click();
    await expect(page.getByRole('dialog', { name: t('es', 'checkout.payTitle') })).toBeVisible();
    await expect(page.getByText(/Tu intento anterior se canceló/)).toBeVisible();
  });

  test('el detalle del pedido pending pinta el folio en el título y ofrece «Reanudar pago»', async ({ page }) => {
    await page.goto('/es/orders/ord-9002');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'orders.orderNumber', { id: 'TCG-009002' }) })).toBeVisible();
    await expect(page.getByTestId('resume-payment').getByRole('button', { name: t('es', 'orders.resume.cta') })).toBeVisible();
    // Un pedido liquidado no lo ofrece.
    await page.goto('/es/orders/ord-9001');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'orders.orderNumber', { id: 'TCG-009001' }) })).toBeVisible();
    await expect(page.getByTestId('resume-payment')).toHaveCount(0);
  });
});
