import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly, IS_REAL, MONEY_RE } from './utils/auth';

/**
 * Flujo: retiro / envío (PROJECT §D / AC 9, 10, 31; contrato §5).
 * Tarifa fija + IVA sobre envío, solo cartas settled, solo direcciones MX.
 *
 * WS-F rediseñó el retiro: el país fijo salió del selector y vive en el picker real de
 * direcciones (`AddressManager`, país fijo MX); "Solicitar retiro" crea la `ShipmentRequest`
 * (`POST /shipments`) y cobra por Stripe. El smoke @real autentica de verdad y descubre la
 * primera pieza settled (no hardcodea ids); asertos por estructura, no por montos de fixture.
 */

test.describe('retiro · envío nacional', () => {
  /**
   * SMOKE @real — RETIRAR: selecciona una pieza settled, obtiene el desglose de envío
   * y dispara el cobro. Env-agnóstico:
   *  - real: "Solicitar retiro" crea la `ShipmentRequest` y abre el modal de Stripe
   *    (confirma que la sesión de cobro REAL se creó).
   *  - mock: conserva el camino simulado (completa el pago y cierra el modal).
   */
  /**
   * ⚠️ ENTORNO (no producto): contra un stack SIN clave de Stripe este test es ROJO — el backend
   * responde `PAYMENT_PROVIDER_UNAVAILABLE` y el modal de pago no puede abrirse. NO se salta a
   * propósito: un smoke de dinero que se pone verde (o se salta solo) cuando no hay proveedor de
   * pago es exactamente la clase de mentira que este arnés vino a quitar. Si sale rojo aquí,
   * confirma primero si hay `STRIPE_SECRET_KEY` en el stack antes de reportarlo como bug.
   */
  test('@real retirar: cotiza envío y el cobro abre el modal de pago', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/shipments');

    // Primera pieza settled: los ítems son checkboxes; las direcciones del picker son radios.
    await page.getByRole('checkbox').first().check();

    // La dirección MX por defecto se auto-selecciona → aparece el desglose de envío.
    const breakdown = page.getByTestId('amount-breakdown');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.shipping'))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.iva', { rate: 16 }))).toBeVisible();
    await expect(breakdown.getByText(MONEY_RE).first()).toBeVisible();

    await page.getByRole('button', { name: t('es', 'shipments.requestWithdrawal') }).click();

    const modal = page.getByRole('dialog', { name: t('es', 'shipments.payTitle') });
    await expect(modal).toBeVisible();

    if (IS_REAL) {
      // Real: camino Stripe <Elements>, NO el cuerpo simulado.
      await expect(modal.getByText(t('es', 'payment.mockBody'))).toBeHidden();
    } else {
      await modal.getByRole('button', { name: /Pagar/ }).click();
      await expect(modal).toBeHidden();
    }
  });

  test('solo nacional: el aviso MX-only es visible (país fijo en el alta de dirección)', async ({
    page,
  }) => {
    // Copy/i18n, pero /shipments es RUTA PRIVADA (PrivateRouteGuard): en mock el guard es
    // inerte y bastaba con navegar; contra el stack real hay que traer sesión o el guard
    // redirige a /login y el copy no llega a pintarse nunca.
    await loginAs(page, 'customer');
    await page.goto('/es/shipments');
    await expect(page.getByText(t('es', 'shipments.onlySettledNotice'))).toBeVisible();
    await expect(page.getByText(t('es', 'shipments.flatFeeNotice'))).toBeVisible();
    await expect(page.getByText(t('es', 'shipments.onlyMx'))).toBeVisible();
  });

  test('lista cartas no elegibles (no settled)', async ({ page }) => {
    // Mock-only (ya lo decía el comentario, ahora lo dice el arnés): la sección solo aparece si
    // el cliente tiene piezas NO liquidadas, y el seed real no promete ninguna.
    mockOnly('requiere un holding pending, que el seed real no garantiza');
    await loginAs(page, 'customer');
    await page.goto('/es/shipments');
    await expect(page.getByText(t('es', 'shipments.ineligibleTitle'))).toBeVisible();
  });

  /**
   * v1.17-withdrawal-lifecycle (contrato §5): la vista de RASTREO ("Mis retiros") lista los retiros del
   * cliente con la etapa legible (tabla §5), sus cartas (folio/nombre/set) y permite abrir el detalle
   * (deep-link GET /shipments/:id). Mock-only: depende del fixture de retiros del cliente.
   */
  test('rastreo: lista un retiro con sus cartas y abre el detalle', async ({ page }) => {
    // Mock-only: afirma ids y nombres LITERALES del fixture (`shp-7001`, Charizard, la caja de
    // Surging Sparks) y dos retiros en etapas concretas. Nada de eso lo promete el seed real.
    mockOnly('ids/nombres literales del fixture de retiros (shp-7001, Charizard)');
    await loginAs(page, 'customer');
    await page.goto('/es/shipments');

    // Sección "Mis retiros".
    await expect(page.getByRole('heading', { name: t('es', 'shipments.myShipments') })).toBeVisible();

    // Etapa legible del contrato §5 (un retiro entregado y otro en camino).
    await expect(page.getByText(t('es', 'shipmentStage.entregado')).first()).toBeVisible();
    await expect(page.getByText(t('es', 'shipmentStage.enviado')).first()).toBeVisible();

    // Las cartas del retiro se listan (nombre en inglés, dato de catálogo).
    await expect(page.getByText('Charizard').first()).toBeVisible();

    // Deep-link al detalle: el id del retiro es un enlace → abre el rastreo con las cartas.
    await page.getByRole('link', { name: 'shp-7001' }).click();
    await expect(page).toHaveURL(/\/es\/shipments\/shp-7001/);
    await expect(page.getByText(t('es', 'shipments.itemsInWithdrawal'))).toBeVisible();
    await expect(page.getByText(t('es', 'shipments.shippingAddress'))).toBeVisible();
    await expect(page.getByText('Surging Sparks Booster Box').first()).toBeVisible();
  });
});
