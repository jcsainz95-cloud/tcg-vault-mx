import { test, expect, type Page } from '@playwright/test';
import { t, type Locale } from './utils/i18n';
import { mockOnly } from './utils/auth';
import { chooseNeighborhood } from './utils/address';

/**
 * CHK-MOVIL · candados L1-L6 de `DESIGN_SYSTEM §CHK-MOVIL.7` (opción A, una pantalla; `HECHOS.md` 2026-10-24
 * «Checkout móvil: opción A»). Viewports 360×740, 390×844, 414×896 y 320×568 de estrés. Corren contra el bundle
 * de MOCKS: los estados que miden (upsell, login, desglose, reintento) los dicta el simulador; la conducta de
 * layout no depende del backend.
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
      mockOnly('el aviso de reintento (§4-R.3) lo dicta el simulador de reservas del modo mock');
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
      mockOnly('se cuentan las sesiones en el simulador de reservas del modo mock (sessionStorage)');
      await addCardAndOpenCheckout(page);
      await fillGuestForm(page);
      await payButton(page).dblclick();
      await expect(page.getByRole('dialog', { name: t('es', 'checkout.payTitle') })).toBeVisible();
      const sessions = await page.evaluate(() => {
        const raw = window.sessionStorage.getItem('tcg.mock.reservations');
        const s = raw ? JSON.parse(raw) : { reservations: [], superseded: [] };
        return (s.reservations?.length ?? 0) + (s.superseded?.length ?? 0);
      });
      expect(sessions).toBe(1);
      await expect(page.getByTestId('unavailable-notice')).toHaveCount(0);
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
      mockOnly('navega a fichas de fixture (c-charizard, inv-1008)');
      await page.goto(`/${locale}/catalog/c-charizard`);
      await expect(page.getByTestId('shipping-fee-hint').first()).toHaveText(shape(locale, 'checkout.feeHint.cardsOnly'));
      await page.goto(`/${locale}/sellado/inv-1008`);
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
