import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs, mockOnly, skipIfSeedMissing } from './utils/auth';
import { anyOrderWithNumber, anyResumableOrder, anySettledOrder, type OrderRow } from './utils/orders';

/**
 * §4-R.5 (contrato v1.68): `GET /orders` trae `orderNumber` REAL y, en `pending`, `reservedUntil`.
 * La columna PEDIDO pinta el folio; la fila `pending` ofrece «Reanudar pago», que carga las piezas
 * del pedido al carrito y vuelve a `/checkout`, donde `POST /checkout/session` responde `200 reused`
 * (mismo pedido, mismo PI). **No hay endpoint de reanudar.**
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ **REPARTO TRAS EL HALLAZGO H-4 DE QA.** El archivo entero era `mockOnly` («depende de ord-9002
 * y ord-9003 de las fixtures»), y eso metía en el mismo cajón dos cosas muy distintas:
 *
 * 1. **Lo que SÍ se mide contra el stack** (`@real`, sin ningún id horneado): que el folio de la
 *    columna PEDIDO sea **el del servidor** y enlace a su propio detalle, y que un pedido que no
 *    está `pending` **no** ofrezca «Reanudar pago». La fila se descubre por la API (`utils/orders`).
 *
 * 2. **Lo que hoy no existe en el entorno**, y está MEDIDO (2026-09-11, stack `1522b45`):
 *    `POST /checkout/session` ⇒ **`503 PAYMENT_PROVIDER_UNAVAILABLE`** y el pedido queda `failed`
 *    con `reservedUntil: null` ⇒ **no hay ningún `pending` con reserva viva** que reanudar. Eso NO
 *    es mock-only: es un dato que falta, así que se salta con `skipIfSeedMissing` **y su razón
 *    exacta**, y correrá solo el día que el entorno tenga claves de prueba de Stripe.
 *
 * 3. **Lo que es mock por CONSTRUCCIÓN**: el caso que vence la reserva escribiendo
 *    `tcg.mock.reservations` en `sessionStorage` (un dial del servidor falso) y el fallback al id
 *    cuando el servidor manda `orderNumber: null` (el backend real siempre folia). Ésos sí se
 *    quedan `mockOnly`, cada uno con su motivo.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
test.describe('pedidos · folio real y «Reanudar pago» (§4-R.5)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'customer');
  });

  /**
   * La fila sobre la que se afirma, con UNA sola salvaguarda para los dos casos que la necesitan.
   *
   * ⚠️ Va aquí y no repetida en cada test **a propósito**: los dos comparten el mismo hueco de dato
   * —la cuenta del seed sin ningún pedido— y una marca por test serían dos salvaguardas defendiendo
   * lo mismo. Medido (2026-09-11): el seed solo crea el pedido de INVITADO `TCG-E2E-GUEST-0001`
   * (`userId: null`, reclamable por correo), así que en un stack recién sembrado `GET /orders` de la
   * cuenta puede venir **vacío** hasta que alguien lo reclame; por eso la ausencia se salta con su
   * razón en vez de pintar un rojo que hablaría del seed y no del producto.
   *
   * En MOCK no hay salvaguarda que valga: se usan las filas del fixture y el assert es el mismo.
   */
  async function orderOrSkip(pick: () => Promise<OrderRow | null>, missing: string): Promise<OrderRow> {
    const order = await pick();
    skipIfSeedMissing(IS_REAL && order === null, missing);
    return order ?? { id: 'ord-9001', orderNumber: 'TCG-009001', status: 'settled', totalCents: 0 };
  }

  test('@real la columna PEDIDO pinta el folio QUE MANDA EL SERVIDOR y enlaza a su detalle', async ({
    page,
  }) => {
    // Folio y destino se afirman contra la RESPUESTA de la API, no contra un literal: en mock es el
    // del fixture y en real el de la BD, y el assert es el mismo.
    const order = await orderOrSkip(anyOrderWithNumber, 'ningún pedido con folio en la cuenta del seed');
    const folio = order.orderNumber ?? 'TCG-009001';
    const id = order.id;

    await page.goto('/es/orders');
    await expect(page.getByRole('link', { name: folio }).first()).toHaveAttribute(
      'href',
      new RegExp(`/orders/${id}$`),
    );
    // Y el id NO se pinta cuando hay folio (el fallback es solo para `orderNumber: null`).
    await expect(page.getByRole('link', { name: id, exact: true })).toHaveCount(0);
  });

  test('@real el detalle pinta el folio en el título; un pedido que no está pending NO ofrece reanudar', async ({
    page,
  }) => {
    const order = await orderOrSkip(anySettledOrder, 'ningún pedido fuera de `pending` en la cuenta del seed');
    const id = order.id;
    const folio = order.orderNumber ?? 'TCG-009001';

    await page.goto(`/es/orders/${id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: t('es', 'orders.orderNumber', { id: folio }) }),
    ).toBeVisible();
    // §4-R.5: reanudar es de `pending` con reserva viva y de nadie más.
    await expect(page.getByTestId('resume-payment')).toHaveCount(0);
  });

  test('la columna PEDIDO cae al id SOLO cuando el servidor manda `orderNumber: null`', async ({ page }) => {
    mockOnly('el backend real folia SIEMPRE: `orderNumber: null` solo lo produce el fixture ord-9003');
    await page.goto('/es/orders');
    await expect(page.getByRole('link', { name: 'ord-9003' }).first()).toBeVisible();
  });

  test('@real pending reservado: «Reservado hasta las HH:MM» + «Reanudar pago» ⇒ /checkout ⇒ 200 reused del MISMO pedido', async ({
    page,
  }) => {
    const order = await anyResumableOrder();
    skipIfSeedMissing(
      IS_REAL && order === null,
      'ningún pedido `pending` con reserva viva: sin proveedor de pagos `POST /checkout/session` ' +
        'responde 503 PAYMENT_PROVIDER_UNAVAILABLE y el pedido queda `failed` con reservedUntil null',
    );

    await page.goto('/es/orders');
    const resume = page.getByTestId('resume-payment').first();
    await expect(resume).toContainText(/Reservado hasta las \d{2}:\d{2}/);
    await resume.getByRole('button', { name: t('es', 'orders.resume.cta') }).click();

    await expect(page).toHaveURL(/\/es\/checkout$/);
    if (!IS_REAL) {
      // El carrito es exactamente el del pedido (Blastoise = inv-1002 en fixtures).
      await expect(page.getByText('Blastoise')).toBeVisible();
    }
    await page.getByRole('button', { name: /Pagar/ }).click();
    const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
    await expect(modal).toBeVisible();
    // Reuso: el MISMO folio que traía la fila, y la cuenta atrás con la hora del servidor.
    const folio = order?.orderNumber ?? 'TCG-009002';
    await expect(page.getByText(new RegExp(`Recuperamos tu reserva anterior \\(${folio}\\)`))).toBeVisible();
    await expect(page.getByTestId('reservation-countdown')).toContainText(
      /Reservado para ti hasta las \d{2}:\d{2}/,
    );
  });

  test('v1.68.1: reserva VENCIDA sin barrer ⇒ «Reanudar pago» sigue ⇒ /checkout avisa que venció y la sesión sustituye (201)', async ({
    page,
  }) => {
    mockOnly('vence la reserva escribiendo `tcg.mock.reservations`, que es un dial del servidor falso');
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
    mockOnly('exige un pedido `pending` con reserva viva: hoy solo lo produce el fixture (ord-9002)');
    await page.goto('/es/orders/ord-9002');
    await expect(
      page.getByRole('heading', { level: 1, name: t('es', 'orders.orderNumber', { id: 'TCG-009002' }) }),
    ).toBeVisible();
    await expect(
      page.getByTestId('resume-payment').getByRole('button', { name: t('es', 'orders.resume.cta') }),
    ).toBeVisible();
  });
});
