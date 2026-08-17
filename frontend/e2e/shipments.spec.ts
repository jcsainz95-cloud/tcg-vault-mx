import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, IS_REAL, MONEY_RE } from './utils/auth';

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
    // Copy/i18n: no necesita backend. El rechazo de direcciones no-MX ahora es estructural
    // (el formulario fija país=MX; el backend mantiene el guardarraíl 422 ADDRESS_NOT_MX).
    await page.goto('/es/shipments');
    await expect(page.getByText(t('es', 'shipments.onlySettledNotice'))).toBeVisible();
    await expect(page.getByText(t('es', 'shipments.flatFeeNotice'))).toBeVisible();
    await expect(page.getByText(t('es', 'shipments.onlyMx'))).toBeVisible();
  });

  test('lista cartas no elegibles (no settled)', async ({ page }) => {
    // Mock-only (no @real): el seed real puede no traer piezas pending.
    await page.goto('/es/shipments');
    await expect(page.getByText(t('es', 'shipments.ineligibleTitle'))).toBeVisible();
  });
});
