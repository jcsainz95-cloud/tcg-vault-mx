import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, IS_REAL, MONEY_RE } from './utils/auth';

/**
 * Flujo: agregar al carrito → checkout con AmountBreakdown (subtotal + fee + IVA
 * 16%) y mensaje CFDI por correo. PROJECT §B / AC 4, 30; contrato §4.
 * En modo mocks el pago se simula (no hay Stripe real); contra backend real el
 * botón dispara POST /checkout/session y abre el modal de Stripe. Ver FRONTEND_NOTES.
 */
test.describe('checkout · desglose y CFDI', () => {
  test('muestra subtotal + procesamiento + IVA 16% + total y aviso CFDI', async ({ page }) => {
    // v1.21-guest-checkout: SIN sesión, /checkout es ahora el checkout de INVITADO
    // (criterio 45/46). Este caso cubre el checkout CON cuenta, así que autentica primero.
    await loginAs(page, 'customer');
    await page.goto('/es/catalog');
    // Agrega la primera carta vendible (Charizard) al carrito.
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();

    await page.goto('/es/checkout');

    const breakdown = page.getByTestId('amount-breakdown');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.subtotal'))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.iva', { rate: 16 }))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.processingFee'))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.total'))).toBeVisible();

    // Mensaje CFDI: solicitar factura por correo con datos fiscales.
    await expect(page.getByText(t('es', 'checkout.cfdiNotice'))).toBeVisible();
    // Titularidad pendiente hasta liquidar.
    await expect(page.getByText(t('es', 'checkout.afterPayment'))).toBeVisible();

    // Política de ventas finales visible + enlace a términos (decisión del humano).
    await expect(page.getByText(t('es', 'checkout.finalSaleNotice'))).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: t('es', 'checkout.viewTerms') }),
    ).toBeVisible();
  });

  /**
   * SMOKE @real — COMPRAR: el botón "Pagar" crea la sesión de checkout
   * (`POST /checkout/session`) y abre el modal de pago. Env-agnóstico:
   *  - real: verifica que se abre el modal de Stripe (monta `<Elements>` con el
   *    clientSecret de la sesión REAL creada; el asentamiento es por webhook, así
   *    que NO se espera pantalla de "pagado" inmediata).
   *  - mock: conserva el camino simulado → confirma "en proceso" y ofrece la bóveda.
   * Aserciones por ESTRUCTURA (desglose + total con formato de moneda), no por montos.
   */
  /**
   * ⚠️ ENTORNO (no producto): contra un stack SIN clave de Stripe este test es ROJO — el backend
   * responde `PAYMENT_PROVIDER_UNAVAILABLE` y el modal de pago no puede abrirse. NO se salta a
   * propósito: un smoke de dinero que se pone verde (o se salta solo) cuando no hay proveedor de
   * pago es exactamente la clase de mentira que este arnés vino a quitar. Si sale rojo aquí,
   * confirma primero si hay `STRIPE_SECRET_KEY` en el stack antes de reportarlo como bug.
   */
  test('@real comprar: el pago crea la sesión y abre el modal de pago', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/catalog');
    // Agrega la primera carta vendible que exista (descubre, no hardcodea id).
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
    await page.goto('/es/checkout');

    const breakdown = page.getByTestId('amount-breakdown');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.getByText(MONEY_RE).first()).toBeVisible();

    await page.getByRole('button', { name: /Pagar/ }).click();

    // El modal SOLO se abre si la sesión (POST /checkout/session) se creó con éxito.
    const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
    await expect(modal).toBeVisible();

    if (IS_REAL) {
      // Real: camino Stripe <Elements>, NO el cuerpo simulado (confirma sesión real creada).
      await expect(modal.getByText(t('es', 'payment.mockBody'))).toBeHidden();
    } else {
      // Mock: completa el pago simulado y confirma la vista "en proceso".
      await modal.getByRole('button', { name: /Pagar/ }).click();
      await expect(page.getByText(t('es', 'checkout.processingTitle'))).toBeVisible();
      await expect(
        page.getByRole('main').getByRole('link', { name: t('es', 'nav.vault') }),
      ).toBeVisible();
    }
  });

  test('desglose de checkout en inglés', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/en/catalog');
    await page.getByRole('button', { name: t('en', 'catalog.addToCart') }).first().click();
    await page.goto('/en/checkout');

    const breakdown = page.getByTestId('amount-breakdown');
    await expect(breakdown.getByText(t('en', 'checkout.iva', { rate: 16 }))).toBeVisible();
    await expect(page.getByText(t('en', 'checkout.cfdiNotice'))).toBeVisible();
    // Política de ventas finales visible en inglés.
    await expect(page.getByText(t('en', 'checkout.finalSaleNotice'))).toBeVisible();
  });

  test('el enlace de términos abre la política de reembolsos (ES)', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/catalog');
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
    await page.goto('/es/checkout');

    await page.getByRole('main').getByRole('link', { name: t('es', 'checkout.viewTerms') }).click();
    await expect(page).toHaveURL(/\/es\/terminos$/);
    await expect(page.getByRole('heading', { name: t('es', 'legal.title'), level: 1 })).toBeVisible();
    await expect(page.getByText(t('es', 'legal.refundBody'))).toBeVisible();
    await expect(page.getByText(t('es', 'legal.disputeOutcome'))).toBeVisible();
    // Aclaración: error de la plataforma (cobro duplicado / sin inventario) siempre se reembolsa.
    await expect(page.getByText(t('es', 'legal.platformErrorBody'))).toBeVisible();
    // Aclaración: la ventana de 7 días cuenta desde la entrega.
    await expect(page.getByText(t('es', 'legal.disputeWindowNote'))).toBeVisible();
    // Alcance: aplica a raw, sellado y gradeadas.
    await expect(page.getByText(t('es', 'legal.scopeNote'))).toBeVisible();
  });

  test('la política de términos también existe en inglés', async ({ page }) => {
    await page.goto('/en/terminos');
    await expect(page.getByRole('heading', { name: t('en', 'legal.title'), level: 1 })).toBeVisible();
    await expect(page.getByText(t('en', 'legal.refundBody'))).toBeVisible();
    await expect(page.getByText(t('en', 'legal.disputeOutcome'))).toBeVisible();
    await expect(page.getByText(t('en', 'legal.platformErrorBody'))).toBeVisible();
    await expect(page.getByText(t('en', 'legal.disputeWindowNote'))).toBeVisible();
    await expect(page.getByText(t('en', 'legal.scopeNote'))).toBeVisible();
  });
});
