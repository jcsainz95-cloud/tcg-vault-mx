import { test, expect, type Page } from '@playwright/test';
import { t, type Locale } from './utils/i18n';
import { IS_REAL, mockOnly } from './utils/auth';
import { chooseNeighborhood } from './utils/address';

/**
 * CHK-MOVIL · candados L1-L6 de `DESIGN_SYSTEM §CHK-MOVIL.7` (opción A, una pantalla; `HECHOS.md` 2026-10-24
 * «Checkout móvil: opción A»). Viewports 360×740, 390×844, 414×896 y 320×568 de estrés. Corren contra el bundle
 * de MOCKS: los estados que miden (upsell, login, desglose, reintento) los dicta el simulador; la conducta de
 * layout no depende del backend.
 *
 * Contra el stack REAL (`seed:synthetic`) corren todos menos uno: el aviso de reintento necesita una sesión de pago
 * CREADA (`201` con `reservedUntil`), y sin proveedor de pagos el stack responde `503 PAYMENT_PROVIDER_UNAVAILABLE`
 * (ver la salvaguarda de ese caso). L6 cuenta en real las peticiones `POST /checkout/guest/session` que salen del
 * navegador, que no dependen de que Stripe conteste; L5 llega a las fichas desde el catálogo, sin ids de fixture.
 *
 * Mutaciones con las que se midió que muerden (FRONTEND_NOTES §CHK-MOVIL): L1 rejilla sin `minmax(0,1fr)` /
 * `min-w-[426px]`; L2 sin `useStickyBottomBar` o sin el `padding-bottom` reservado; L3 sugerencias antes del
 * formulario; L4 el plegable abierto por defecto; L5 T3 con un importe calculado en el front; L6 sin guarda de
 * doble envío.
 */

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
] as const;

const PAY_RE = (locale: Locale) => new RegExp(`^${t(locale, 'checkout.payNoAmount')}$`);

async function addCardAndOpenCheckout(page: Page, locale: Locale = 'es') {
  await page.goto(`/${locale}/catalog`);
  await page.getByRole('button', { name: t(locale, 'catalog.addToCart') }).first().click();
  await page.goto(`/${locale}/checkout`);
  await expect(page.getByLabel(t(locale, 'checkout.guest.email.label'))).toBeVisible();
  await expect(page.getByTestId('checkout-pay-bar')).toBeVisible();
}

/** L1: sin desplazamiento lateral y ningún interactivo visible se sale por la derecha. */
async function expectNoHorizontalOverflow(page: Page, state: string) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [role="button"]')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (b.right > vw + 0.5) offenders.push(`${el.tagName.toLowerCase()} «${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}» right=${Math.round(b.right)}`);
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
  expect(r.scrollWidth, `${state}: scrollWidth ${r.scrollWidth} > innerWidth ${r.vw}`).toBeLessThanOrEqual(r.vw);
  expect(r.offenders, `${state}: interactivos fuera del viewport`).toEqual([]);
}

async function fillGuestForm(page: Page) {
  await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('invitado@dominio.com');
  await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
  await page.getByLabel(t('es', 'checkout.guest.recipientName')).fill('Juan Pérez');
  await page.getByLabel(t('es', 'addresses.postalCode')).fill('44100');
  await chooseNeighborhood(page, 'Guadalajara Centro');
  await page.getByLabel(t('es', 'addresses.line1')).fill('Av. Vallarta 1234');
  await page.getByLabel(t('es', 'addresses.phone')).fill('3312345678');
  await page.locator('#guest-terms').check();
  // Sin foco en un campo de texto: con el teclado «abierto» la barra no se pinta (L2).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const bar = (page: Page) => page.getByTestId('checkout-pay-bar');
const payButton = (page: Page, locale: Locale = 'es') => bar(page).getByRole('button', { name: PAY_RE(locale) });

for (const vp of VIEWPORTS) {
  test.describe(`CHK-MOVIL · ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test(`L1 · sin desplazamiento lateral: carrito, errores, upsell, login, desglose (${vp.width})`, async ({ page }) => {
      await addCardAndOpenCheckout(page);
      await expectNoHorizontalOverflow(page, 'carrito');

      await payButton(page).click();
      await expect(page.getByRole('main').getByRole('alert').first()).toBeVisible();
      await expectNoHorizontalOverflow(page, 'formulario con errores');

      await page.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.vault')) }).click();
      await expect(page.getByTestId('vault-upsell')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'upsell abierto');
      await page.getByRole('button', { name: t('es', 'checkout.vaultUpsell.dismiss') }).click();

      await page.getByRole('button', { name: 'Inicia sesión', exact: true }).click();
      await expect(page.locator('#identity-panel input[type="password"]')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'panel de login');
      await page.getByRole('button', { name: 'Inicia sesión', exact: true }).click();

      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await bar(page).getByRole('button', { name: new RegExp(t('es', 'checkout.bar.showBreakdown')) }).click();
      await expect(page.getByTestId('checkout-pay-bar-breakdown')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'desglose abierto');
    });

    test(`L1 · sin desplazamiento lateral con el aviso de reintento (${vp.width})`, async ({ page }) => {
      // Solo mock, y no por dato: el aviso (`CheckoutRetryNotice`) se pinta con el `reservedUntil` del `201` de
      // `POST /checkout/guest/session`, y sin proveedor de pagos el stack real responde `503 PAYMENT_PROVIDER_UNAVAILABLE`
      // y libera la reserva (DEVOPS_NOTES §48.2): no hay modal que cerrar ni aviso que medir. Lo medido aquí es LAYOUT
      // (L1), que no depende de quién emitió el `reservedUntil`. El dato real lo cubre la integración de backend contra
      // Postgres: `backend/test/integration/checkout-reservation-owner.e2e-spec.ts:172` (201 con `reservedUntil`) y
      // `:640` (invitado: 201 con `checkoutToken`, reintento R-7).
      mockOnly('el aviso de reintento (§4-R.3) necesita el 201 de la sesión de pago; sin Stripe el stack real da 503');
      await addCardAndOpenCheckout(page);
      await fillGuestForm(page);
      await payButton(page).click();
      const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
      await expect(modal).toBeVisible();
      await modal.getByRole('button', { name: 'Close' }).click();
      await expect(modal).toBeHidden();
      await expect(page.locator('[data-testid="checkout-retry-notice"], [data-testid="reservation-countdown"]').first()).toBeVisible();
      await expectNoHorizontalOverflow(page, 'aviso de reintento');
    });

    test(`L2 · PAGAR visible en el primer pintado, barra ≤ 120 px, reserva su alto, y se oculta con un campo enfocado (${vp.width})`, async ({ page }) => {
      await addCardAndOpenCheckout(page);
      const m = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-testid="checkout-pay-bar"]')!;
        const pay = [...el.querySelectorAll('button')].find((b) => /^(Pagar|Pay)$/.test((b.textContent || '').trim()))!;
        const pb = pay.getBoundingClientRect();
        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          barH: el.getBoundingClientRect().height,
          pay: { top: pb.top, bottom: pb.bottom, left: pb.left, right: pb.right },
          published: getComputedStyle(document.documentElement).getPropertyValue('--sticky-bottom-h').trim(),
        };
      });
      expect(m.pay.top).toBeGreaterThanOrEqual(0);
      expect(m.pay.bottom).toBeLessThanOrEqual(m.vh);
      expect(m.pay.left).toBeGreaterThanOrEqual(0);
      expect(m.pay.right).toBeLessThanOrEqual(m.vw);
      expect(m.barH).toBeLessThanOrEqual(120);
      // MKT2-UX.5: la barra publica su alto real; el contenido lo reserva.
      expect(m.published).toBe(`${Math.ceil(m.barH)}px`);

      // Al fondo de la página, la última nota legal queda ENCIMA de la barra (nada tapado).
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const covered = await page.evaluate(() => {
        const barTop = document.querySelector<HTMLElement>('[data-testid="checkout-pay-bar"]')!.getBoundingClientRect().top;
        const notes = [...document.querySelectorAll<HTMLElement>('main .rule-note-quiet')];
        const last = notes[notes.length - 1]!;
        return { lastBottom: last.getBoundingClientRect().bottom, barTop };
      });
      expect(covered.lastBottom).toBeLessThanOrEqual(covered.barTop);

      // Teclado abierto (campo enfocado) ⇒ la barra no se pinta y la variable vale 0.
      await page.getByLabel(t('es', 'checkout.guest.email.label')).focus();
      await expect(bar(page)).toHaveCount(0);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sticky-bottom-h').trim())).toBe('');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await expect(bar(page)).toBeVisible();
    });

    test(`L3 · el primer campo va antes que sugerencias y paquetes; sin «Continuar como invitado» (${vp.width})`, async ({ page }) => {
      await addCardAndOpenCheckout(page);
      await expect(page.getByRole('heading', { name: t('es', 'checkout.suggestions.title') })).toBeVisible();
      const order = await page.evaluate(() => {
        const field = document.getElementById('guest-email')!;
        const later = [...document.querySelectorAll('section[aria-labelledby="accessory-suggestions-title"], section[aria-label]')]
          .filter((s) => s.matches('section[aria-labelledby="accessory-suggestions-title"]') || /paquete|bundle/i.test(s.getAttribute('aria-label') || ''));
        return later.map((s) => !!(field.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING));
      });
      expect(order.length).toBeGreaterThan(0);
      expect(order.every(Boolean)).toBe(true);
      await expect(page.getByRole('button', { name: /Continuar como invitado|Continue as guest/ })).toHaveCount(0);
    });

    test(`L4 · formulario vacío: 6 obligatorios visibles, 2 plegados, ≤ 2 casillas (${vp.width})`, async ({ page }) => {
      await addCardAndOpenCheckout(page);
      const form = page.getByTestId('guest-form');
      const fields = form.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea');
      await expect(fields.filter({ visible: true })).toHaveCount(6);
      expect(await form.locator('input[type="checkbox"]').count()).toBeLessThanOrEqual(2);
      const fold = form.getByRole('button', { name: new RegExp(t('es', 'checkout.guest.optionalFold').replace(/[()]/g, '\\$&')) });
      await expect(fold).toHaveAttribute('aria-expanded', 'false');
      await fold.click();
      await expect(fields.filter({ visible: true })).toHaveCount(8);
    });

    test(`L6 · doble toque en PAGAR crea UNA sesión (${vp.width})`, async ({ page }) => {
      // En real se cuentan además las peticiones `POST /checkout/guest/session` que salen del navegador: la guarda de
      // doble envío es del front y se mide igual aunque el proveedor de pagos responda 503 (sin Stripe en el stack).
      const sessionPosts: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/checkout\/guest\/session(\?|$)/.test(r.url())) sessionPosts.push(r.url());
      });
      // Cada `pay()` que llega a crear la sesión lee UNA vez el token de reintento (`tcg.guestCheckoutRetry`, §4-R.3)
      // justo antes de `POST /checkout/guest/session`: se cuentan esas lecturas desde el toque. Medido: contar
      // reservas o respuestas no servía (el simulador rechaza la 2.ª en silencio porque la pieza ya es «tuya» y no se
      // poda) — 0/12 y 1/12 rojas sin guardas; la prueba de unidad sí veía 2 llamadas.
      await page.addInitScript(() => {
        const w = window as unknown as { __sessionAttempts: number; __countAttempts: boolean };
        w.__sessionAttempts = 0;
        w.__countAttempts = false;
        const orig = Storage.prototype.getItem;
        Storage.prototype.getItem = function (k: string) {
          if (w.__countAttempts && k === 'tcg.guestCheckoutRetry') w.__sessionAttempts += 1;
          return orig.call(this, k);
        };
      });
      await addCardAndOpenCheckout(page);
      await fillGuestForm(page);
      // Dos activaciones en el MISMO tick (el peor doble toque): con `dblclick` de Playwright el segundo clic llegaba
      // ya con el botón re-pintado y la mutación «sin guardas» salía 0/12 roja — el candado no mordía.
      await expect(payButton(page)).toBeEnabled();
      await payButton(page).evaluate((b: HTMLButtonElement) => {
        (window as unknown as { __countAttempts: boolean }).__countAttempts = true;
        b.click();
        b.click();
        (window as unknown as { __countAttempts: boolean }).__countAttempts = false;
      });
      expect(await page.evaluate(() => (window as unknown as { __sessionAttempts: number }).__sessionAttempts)).toBe(1);
      if (IS_REAL) {
        // La respuesta (201 con Stripe, 503 sin él) cierra el intento; se da margen a una 2.ª petición rezagada.
        await expect(payButton(page)).toBeEnabled();
        await page.waitForTimeout(500);
        expect(sessionPosts, 'peticiones POST /checkout/guest/session').toHaveLength(1);
      } else {
        await expect(page.getByRole('dialog', { name: t('es', 'checkout.payTitle') })).toBeVisible();
        const sessions = await page.evaluate(() => {
          const raw = window.sessionStorage.getItem('tcg.mock.reservations');
          const s = raw ? JSON.parse(raw) : { reservations: [], superseded: [] };
          return (s.reservations?.length ?? 0) + (s.superseded?.length ?? 0);
        });
        expect(sessions).toBe(1);
      }
      await expect(page.getByTestId('unavailable-notice')).toHaveCount(0);
      await expect(page.getByTestId('payment-in-progress')).toHaveCount(0);
      await expect(page.getByText(/Tu intento anterior se canceló|Your previous attempt was canceled/)).toHaveCount(0);
    });
  });
}

test.describe('CHK-MOVIL · L5 · textos T1/T3 con paridad ES/EN y el importe del quote (390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Plantilla i18n ⇒ regex con cada `{x}` como importe MX$ (el número lo pone el endpoint, no el texto). */
  const shape = (locale: Locale, key: string) =>
    new RegExp(
      '^' +
        t(locale, key)
          .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
          .replace(/\\?\{\w+\\?\}|\{\w+\}/g, 'MX\\$[\\d,]+\\.\\d{2}') +
        '$',
    );

  for (const locale of ['es', 'en'] as const) {
    test(`T1a/T1b en la ficha y T3a en la barra (${locale})`, async ({ page }) => {
      // Las fichas se toman del listado (mock: fixtures; real: `seed:synthetic`), no por id de fixture.
      await page.goto(`/${locale}/catalog`);
      const firstBuyable = page.getByRole('button', { name: t(locale, 'catalog.addToCart') }).first();
      const cardHref = await firstBuyable
        .locator('xpath=ancestor::div[.//a[contains(@href, "/catalog/")]][1]')
        .locator('a[href*="/catalog/"]')
        .first()
        .getAttribute('href');
      expect(cardHref, 'el catálogo debe tener una carta a la venta').toBeTruthy();
      await page.goto(cardHref!);
      await expect(page.getByTestId('shipping-fee-hint').first()).toHaveText(shape(locale, 'checkout.feeHint.cardsOnly'));
      await page.goto(`/${locale}/sellado`);
      // Mock: «Surging Sparks Booster Box» (inv-1008); real: «E2E Surging Sparks Booster Box» (`E2E_SEALED_LISTED`).
      const sealedTile = page.locator('a[href*="/sellado/"]').filter({ hasText: /Surging Sparks Booster Box/ }).first();
      await expect(sealedTile).toBeVisible();
      await sealedTile.click();
      await expect(page).toHaveURL(/\/sellado\/[^/?]+$/);
      await expect(page.getByTestId('shipping-fee-hint').first()).toHaveText(shape(locale, 'checkout.feeHint.sealed'));

      await addCardAndOpenCheckout(page, locale);
      const summary = page.getByTestId('checkout-pay-bar-summary');
      await expect(summary).toHaveText(shape(locale, 'checkout.bar.includesShipping'));
      await bar(page).getByRole('button', { name: new RegExp(t(locale, 'checkout.bar.showBreakdown')) }).click();
      const region = page.getByTestId('checkout-pay-bar-breakdown');
      await expect(region).toBeVisible();
      // T3 contiene EXACTAMENTE el importe de `processingFeeCents` que pinta el desglose del quote.
      const regionText = (await region.innerText()).replace(/\s+/g, ' ');
      const fee = new RegExp(`${t(locale, 'checkout.platformFee')}[\\s\\S]*?(MX\\$[\\d,]+\\.\\d{2})`).exec(regionText)?.[1];
      expect(fee, `importe de comisión en el desglose: «${regionText}»`).toBeTruthy();
      const summaryText = await summary.innerText();
      expect(summaryText.endsWith(fee!), `«${summaryText}» debe terminar con ${fee}`).toBe(true);
    });
  }
});

test.describe('CHK-MOVIL · escritorio sigue con el aside (1280)', () => {
  test('lg+: sin barra fija, con el resumen y un solo PAGAR', async ({ page }) => {
    await page.goto('/es/catalog');
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
    await page.goto('/es/checkout');
    await expect(page.getByRole('complementary').getByTestId('amount-breakdown')).toBeVisible();
    await expect(page.getByTestId('checkout-pay-bar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Pagar/ })).toHaveCount(1);
  });
});
