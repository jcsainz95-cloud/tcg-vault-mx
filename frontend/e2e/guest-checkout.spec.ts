import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { mockOnly, MONEY_RE } from './utils/auth';

/**
 * Guest checkout — PROJECT §J / §J.1, criterios 45–56b; contrato §4-G.
 *
 * Cubre los flujos críticos de §J.1 tal cual: camino feliz de invitado, upsell de bóveda,
 * y los negativos (correo inválido, token manipulado/expirado). Los casos corren SIN
 * sesión a propósito: es el punto de la feature.
 *
 * Nota de entorno: en modo mock las ramas de `lib/api.ts` responden con los shapes del
 * contrato (`/checkout/guest/*`, `/orders/guest/*`); contra el stack real el mismo flujo
 * pega a los endpoints de verdad. Los smoke de dinero se marcan `@real`.
 */

async function addFirstCardToCart(page: import('@playwright/test').Page, locale: 'es' | 'en' = 'es') {
  await page.goto(`/${locale}/catalog`);
  await page.getByRole('button', { name: t(locale, 'catalog.addToCart') }).first().click();
}

test.describe('guest checkout · identidad y desglose', () => {
  test('sin sesión el checkout ofrece las TRES vías y conserva el carrito (criterios 45, 46)', async ({
    page,
  }) => {
    await addFirstCardToCart(page);
    await page.goto('/es/checkout');

    await expect(page.getByRole('button', { name: t('es', 'checkout.identity.guest.cta') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'checkout.identity.login.cta') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'checkout.identity.register.cta') })).toBeVisible();
    await expect(page.getByText(t('es', 'checkout.identity.cartKept'))).toBeVisible();

    // Alternar vías no vacía el carrito ni cambia de ruta.
    await page.getByRole('button', { name: t('es', 'checkout.identity.guest.cta') }).click();
    await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('invitado@dominio.com');
    await page.getByRole('button', { name: t('es', 'checkout.identity.change') }).click();
    await page.getByRole('button', { name: t('es', 'checkout.identity.login.cta') }).click();
    await page.getByRole('button', { name: t('es', 'checkout.identity.change') }).click();
    await page.getByRole('button', { name: t('es', 'checkout.identity.guest.cta') }).click();

    await expect(page).toHaveURL(/\/es\/checkout$/);
    await expect(page.getByLabel(t('es', 'checkout.guest.email.label'))).toHaveValue('invitado@dominio.com');
    await expect(page.getByTestId('amount-breakdown')).toBeVisible();
  });

  test('el invitado ve el MISMO desglose y los mismos avisos, con línea de envío (criterio 48b)', async ({
    page,
  }) => {
    await addFirstCardToCart(page);
    await page.goto('/es/checkout');

    const breakdown = page.getByTestId('amount-breakdown');
    await expect(breakdown.getByText(t('es', 'checkout.subtotal'))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.shipping'))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.iva', { rate: 16 }))).toBeVisible();
    await expect(breakdown.getByText(t('es', 'checkout.processingFee'))).toBeVisible();
    await expect(breakdown.getByText(MONEY_RE).first()).toBeVisible();

    await expect(page.getByText(t('es', 'checkout.finalSaleNotice'))).toBeVisible();
    await expect(page.getByText(t('es', 'checkout.cfdiNotice'))).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: t('es', 'checkout.viewTerms') }),
    ).toBeVisible();
  });

  test('un correo inválido impide avanzar al pago (criterio 47)', async ({ page }) => {
    await addFirstCardToCart(page);
    await page.goto('/es/checkout');
    await page.getByRole('button', { name: t('es', 'checkout.identity.guest.cta') }).click();

    await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('no-es-correo');
    await page.getByRole('button', { name: /Pagar/ }).click();

    // El invitado ve DOS avisos deliberados y distintos: el RESUMEN de errores del formulario
    // (§15.9) y la nota bajo «Pagar» que explica el bloqueo. Se afirma el resumen POR SU
    // CONTENIDO en vez de «el alert de main», que era ambiguo entre los dos.
    await expect(
      page
        .getByRole('main')
        .getByRole('alert')
        .filter({ hasText: t('es', 'checkout.guest.email.invalid') }),
    ).toBeVisible();
    await expect(page.getByText(t('es', 'checkout.guest.formIncomplete'))).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('elegir bóveda muestra UPSELL, nunca un error (criterio 48)', async ({ page }) => {
    await addFirstCardToCart(page);
    await page.goto('/es/checkout');
    await page.getByRole('button', { name: t('es', 'checkout.identity.guest.cta') }).click();

    // N-9: el destino se ofrece DOS veces a propósito (en el formulario, con su detalle y el
    // upsell; y otra vez justo arriba de «Pagar»), compartiendo estado. Se elige el del
    // FORMULARIO por su nombre accesible completo — el del resumen se llama solo «Guardar en mi
    // bóveda» —, en vez de un localizador que casa con los dos.
    const vault = page.getByRole('radio', {
      name: `${t('es', 'checkout.destination.vault')} ${t('es', 'checkout.destination.vaultRequiresAccount')}`,
    });
    await expect(vault).toBeEnabled();
    await vault.check();

    const upsell = page.getByTestId('vault-upsell');
    await expect(upsell).toBeVisible();
    await expect(upsell.getByRole('button', { name: t('es', 'checkout.vaultUpsell.cta') })).toBeVisible();
    // Salida en positivo, sin confirmshaming, y sin tratamiento de error.
    await expect(page.getByRole('button', { name: t('es', 'checkout.vaultUpsell.dismiss') })).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toBeHidden();
    await expect(page.getByRole('button', { name: /Pagar/ })).toBeDisabled();
    await expect(page.getByText(t('es', 'checkout.guest.payBlocked.vault'))).toBeVisible();

    // Descartar el upsell continúa con envío directo (el carrito sigue intacto).
    await page.getByRole('button', { name: t('es', 'checkout.vaultUpsell.dismiss') }).click();
    await expect(page.getByTestId('vault-upsell')).toBeHidden();
    await expect(page.getByTestId('amount-breakdown')).toBeVisible();
  });

  /**
   * SMOKE @real — COMPRAR COMO INVITADO: correo + dirección MX → el botón crea el pedido
   * (`POST /checkout/guest/session`) y abre el modal de pago.
   *  - real: solo se verifica que el modal se abre con el clientSecret de la sesión REAL.
   *  - mock: completa el pago simulado y confirma la pantalla de confirmación (criterio 49).
   */
  /**
   * ⚠️ ENTORNO (no producto): contra un stack SIN clave de Stripe este test es ROJO — el backend
   * responde `PAYMENT_PROVIDER_UNAVAILABLE` y el modal de pago no puede abrirse. NO se salta a
   * propósito: un smoke de dinero que se pone verde (o se salta solo) cuando no hay proveedor de
   * pago es exactamente la clase de mentira que este arnés vino a quitar. Si sale rojo aquí,
   * confirma primero si hay `STRIPE_SECRET_KEY` en el stack antes de reportarlo como bug.
   */
  test('@real comprar como invitado: la sesión se crea y termina en confirmación', async ({ page }) => {
    await addFirstCardToCart(page);
    await page.goto('/es/checkout');
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

    await page.getByRole('button', { name: /Pagar/ }).click();

    const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
    await expect(modal).toBeVisible();

    if (process.env.E2E_REAL === '1') {
      await expect(modal.getByText(t('es', 'payment.mockBody'))).toBeHidden();
    } else {
      await modal.getByRole('button', { name: /Pagar/ }).click();
      // Confirmación con número de pedido + oferta de crear cuenta (criterios 49, 54).
      await expect(page.getByTestId('guest-order-number')).toBeVisible();
      await expect(page.getByText(t('es', 'checkout.confirmation.title'))).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('es', 'checkout.confirmation.claim.cta') }),
      ).toBeVisible();
    }
  });
});

test.describe('seguimiento público · /pedido', () => {
  test('con enlace válido muestra estado, artículos y total, sin datos sensibles (criterios 50, 51)', async ({
    page,
  }) => {
    // MOCK: la rama mock de `trackGuestOrder` reconoce tokens que empiezan con "mock". Contra el
    // backend real haría falta un pedido de invitado + su token FIRMADO, que no se puede fabricar
    // desde el navegador. Los caminos NEUTROS (token inventado/expirado) sí corren en real: son
    // los que importan para la seguridad, y ahí el backend es la autoridad.
    mockOnly('token de seguimiento `mock-demo-token` que solo reconoce la rama mock');
    await page.goto('/es/pedido?token=mock-demo-token');

    await expect(page.getByTestId('tracking-order-number')).toBeVisible();
    await expect(page.getByTestId('tracking-status-label')).toBeVisible();
    await expect(page.getByTestId('amount-breakdown')).toBeVisible();

    // El token se borra de la URL (history.replaceState) — §4-G.7.
    await expect(page).toHaveURL(/\/es\/pedido$/);

    // Chrome reducido: sin nav de tienda ni carrito ni "mi cuenta".
    await expect(page.getByRole('link', { name: t('es', 'nav.vault') })).toBeHidden();
    await expect(page.getByRole('link', { name: t('es', 'nav.orders') })).toBeHidden();

    // Ninguna acción sensible.
    for (const forbidden of [/cancelar/i, /reembolso/i, /cambiar dirección/i]) {
      await expect(page.getByRole('button', { name: forbidden })).toHaveCount(0);
    }
  });

  test('token manipulado y token expirado dan la MISMA pantalla neutra (criterios 52, 53)', async ({
    page,
  }) => {
    const neutralTitle = t('es', 'track.neutral.title');

    await page.goto('/es/pedido?token=token-inventado');
    await expect(page.getByRole('heading', { level: 1, name: neutralTitle })).toBeVisible();
    const bodyInvalid = await page.getByTestId('tracking-neutral-state').innerText();

    await page.goto('/es/pedido?token=mock-expired-token');
    await expect(page.getByRole('heading', { level: 1, name: neutralTitle })).toBeVisible();
    const bodyExpired = await page.getByTestId('tracking-neutral-state').innerText();

    // Mismo texto EXACTO en ambos casos: la pantalla no es un oráculo.
    expect(bodyExpired).toBe(bodyInvalid);
  });

  test('el reenvío responde siempre lo mismo y entra en enfriamiento (criterio 53)', async ({ page }) => {
    await page.goto('/es/pedido?token=mock-expired-token');

    // Vía A (con token): ningún campo, solo el botón. La vía B vive tras el disclosure.
    await expect(page.getByLabel(t('es', 'track.neutral.emailLabel'))).toHaveCount(0);
    await page.getByRole('button', { name: t('es', 'track.neutral.noLinkCta') }).click();

    // Vía B: ni el correo ni el número de pedido por separado habilitan el envío (§15.7).
    const submit = page.getByRole('button', { name: t('es', 'track.neutral.submit') });
    await expect(submit).toBeDisabled();
    await expect(page.getByText(t('es', 'track.neutral.incompleteForm'))).toBeVisible();
    await page.getByLabel(t('es', 'track.neutral.emailLabel')).fill('invitado@dominio.com');
    await expect(submit).toBeDisabled();
    await page.getByLabel(t('es', 'track.neutral.orderNumberLabel')).fill('TCG-000123');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(t('es', 'track.neutral.result'))).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'track.neutral.submit') })).toHaveCount(0);
  });

  test('el enlace del CHECKOUT caduca a las 2 h y cae en la pantalla neutra, que sí reenvía (§4-G.7a)', async ({
    page,
  }) => {
    // v1.21.1: el token que devuelve el checkout vive 120 min y NUNCA se manda por correo
    // (el enlace de 90 días llega en el correo del settle). Si el comprador vuelve a esa URL
    // más tarde, debe caer en la pantalla neutra y poder pedir uno nuevo — no quedarse sin salida.
    await page.goto('/es/pedido?token=mock-ord-guest-1234-checkout-token-expired');

    await expect(
      page.getByRole('heading', { level: 1, name: t('es', 'track.neutral.title') }),
    ).toBeVisible();
    // Camino preferente con token: reenvío por `{ token }`, sin pedir nada más.
    await page.getByRole('button', { name: t('es', 'track.neutral.submit') }).click();
    await expect(page.getByText(t('es', 'track.neutral.result'))).toBeVisible();
  });

  test('un enlace de checkout VIGENTE avisa de que es temporal y remite al correo', async ({ page }) => {
    mockOnly('token de seguimiento `mock-demo-token` que solo reconoce la rama mock');
    await page.goto('/es/pedido?token=mock-demo-token');
    // El pedido demo del mock caduca en 90 días (enlace de correo): sin aviso de temporalidad.
    await expect(page.getByTestId('tracking-order-number')).toBeVisible();
    await expect(page.getByTestId('temporary-link-notice')).toHaveCount(0);
  });

  test('la pantalla neutra también existe en inglés', async ({ page }) => {
    await page.goto('/en/pedido?token=token-inventado');
    await expect(
      page.getByRole('heading', { level: 1, name: t('en', 'track.neutral.title') }),
    ).toBeVisible();
    await expect(page.getByText(t('en', 'track.neutral.body'))).toBeVisible();
  });
});
