import { test, expect, type Browser, type Page, type Response } from '@playwright/test';
import { t, LOCALES, type Locale } from './utils/i18n';
import { loginAs, realOnly } from './utils/auth';
import { apiAs, apiAsOk } from './utils/env';
import { withFileLock } from './utils/state';
import {
  DECK_ENERGIES,
  createReadyAccessory,
  deckScenario,
  getAdminAccessory,
  makePng,
  rememberCreatedAccessory,
  retireAccessory,
  runTag,
  shopScenario,
  type AdminAccessory,
} from './utils/accessories-scenario';

/**
 * §AC — accesorios, energías y paquete de energías del deck. ES y EN.
 *
 * **§107.real (2026-10-07).** Hasta hoy TODO este fichero era solo-mock («el simulador de §AC sirve el catálogo y la
 * cotización»), motivo que dejó de ser cierto cuando el backend de §AC quedó completo en esta rama. Doctrina H-4
 * (`utils/grading.ts:14-21`): un salto «solo-mock» sobre algo medible es un defecto. Ahora:
 *
 *  1. Los dos smokes de pantalla son AGNÓSTICOS y `@real`: en mock usan los ids del simulador; en real siembran sus
 *     accesorios y el deck por la API del contrato (`utils/accessories-scenario.ts`).
 *  2. **AC-F14** — los recorridos de punta a punta de los criterios **724** y **748** y el del **749**, contra el stack
 *     (solo-real: lo que miden es que la pantalla y el servidor concuerdan; el simulador no aparta existencias).
 *
 * ⛔ **Dónde se detienen 724 y 748, y por qué.** Ningún E2E del arnés paga con tarjeta de prueba: los smokes de dinero
 * (`checkout.spec.ts:66`, `guest-checkout.spec.ts:137`, `address-colonia.spec.ts`) llegan a que la sesión se cree y el
 * modal de Stripe monte, y no más (el asentamiento es por webhook). Estos recorridos llegan al MISMO punto y además
 * afirman lo que el servidor apartó. «Paga con tarjeta de prueba → el operador lo prepara → las existencias bajaron»
 * queda **SIN CUBRIR** por E2E hasta que el arnés sepa confirmar un pago de prueba (FRONTEND_NOTES §107.real).
 *
 * ⚠️ ENTORNO (no producto), como los demás smokes de dinero: contra un stack SIN clave de Stripe la sesión responde
 * `503 PAYMENT_PROVIDER_UNAVAILABLE` y 724/748 salen ROJOS en ese paso. No se saltan a propósito.
 *
 * Huella en el entorno: cada caso retira lo que crea; lo que quede lo deshace `restoreAccessoryScenario` en
 * `e2e/global-teardown.ts` (energías activadas por el arnés, deck publicado, accesorios vivos).
 */

const money = (cents: number, locale: Locale) => {
  const s = new Intl.NumberFormat(locale === 'es' ? 'es-MX' : 'en-US', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return s.includes('MX$') ? s : s.replace('$', 'MX$');
};

interface GuestQuote {
  breakdown: { shippingFeeCents: number | null; totalCents: number };
  accessoryLines: { accessoryId: string; quantity: number; lineTotalCents: number }[];
  energyBundles: { deckSlug: string; priceCents: number }[];
  shippingBox: { code: string; review: boolean } | null;
}

const isGuestQuote = (r: Response) => r.request().method() === 'POST' && r.url().includes('/checkout/guest/quote');
const isGuestSession = (r: Response) => r.request().method() === 'POST' && r.url().includes('/checkout/guest/session');

/** Llena el formulario del invitado con un CP del catálogo del arnés (`E2E_POSTAL_CODES`). */
async function fillGuestForm(page: Page, locale: Locale): Promise<void> {
  await page.locator('#guest-email').fill(`invitado.ac.${locale}@dominio.com`);
  await page.locator('#guest-recipientName').fill('Juan Pérez');
  await page.locator('#guest-line1').fill('Av. Vallarta 1234');
  await page.locator('#guest-postalCode').fill('44100');
  const colonia = page.locator('#guest-neighborhood');
  await expect(colonia.locator('option', { hasText: 'Guadalajara Centro' })).toHaveCount(1);
  await colonia.selectOption({ label: 'Guadalajara Centro' });
  await page.locator('#guest-phone').fill('3312345678');
  await page.locator('#guest-email-confirm').check();
  await page.locator('#guest-terms').check(); // LIVE-8 sitio 3: la etiqueta lleva enlaces (§80.1)
}

/** El renglón «Envío» del desglose dice exactamente la cifra del servidor. */
async function expectShipping(page: Page, locale: Locale, cents: number): Promise<void> {
  const row = page
    .getByTestId('amount-breakdown')
    .locator('div')
    .filter({ has: page.getByText(t(locale, 'checkout.shipping'), { exact: true }) })
    .last();
  await expect(row).toContainText(money(cents, locale));
}

/** Pulsa «Pagar» y devuelve la respuesta de la sesión del invitado. */
async function payAsGuest(page: Page, locale: Locale): Promise<Response> {
  const session = page.waitForResponse(isGuestSession, { timeout: 30_000 });
  await page.getByRole('button', { name: t(locale, 'checkout.payNoAmount'), exact: true }).click();
  return session;
}

async function adminPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const p = await ctx.newPage();
  await loginAs(p, 'admin');
  return p;
}

for (const locale of LOCALES) {
  test.describe(`accesorios (${locale})`, () => {
    test('@real pestaña → listado → ficha → carrito con el renglón y la sugerencia', async ({ page }) => {
      const sc = await shopScenario(`smoke ${locale}`);
      try {
        await page.goto(`/${locale}/accesorios${sc.listQuery ? `?q=${encodeURIComponent(sc.listQuery)}` : ''}`);
        const tab = page.getByRole('link', { name: t(locale, 'storeTabs.accessories') });
        await expect(tab).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('heading', { level: 1, name: t(locale, 'accessories.title') })).toBeVisible();
        // Agotado: sin botón (AC-UX-2).
        await expect(page.getByTestId(`accessory-tile-${sc.soldOut.id}`)).toBeVisible();
        await expect(page.getByTestId(`accessory-tile-${sc.soldOut.id}`).getByRole('button')).toHaveCount(0);

        await page.getByTestId(`accessory-tile-${sc.available.id}`).getByRole('link').first().click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/accesorios/${sc.available.id}$`));
        await page.getByRole('button', { name: t(locale, 'accessories.addToCart') }).click();

        await page.goto(`/${locale}/checkout`);
        await expect(page.getByText(t(locale, 'checkout.accessories.groupAccessories'), { exact: true })).toBeVisible();
        await expect(page.getByTestId(`cart-accessory-${sc.available.id}`)).toBeVisible();
        const suggestions = page.getByRole('region', { name: t(locale, 'checkout.suggestions.title') });
        await expect(suggestions).toBeVisible();
        // ⛔ Energías nunca en «¿Te falta algo?».
        await expect(suggestions.getByText(/Energía|Energy/)).toHaveCount(0);
      } finally {
        for (const id of sc.cleanup) await retireAccessory(id);
      }
    });

    test('@real deck: «Agregar de jalón» no agrega el paquete; «Agregar paquete» lo pone en el carrito', async ({ page }) => {
      const sc = await withFileLock('accessories:deck-scenario', () => deckScenario());

      await page.goto(`/${locale}/decks-meta`);
      // La lista no pinta ningún «Ver deck»: cada deck es una tarjeta-enlace a `/decks-meta/{slug}`. En mock se entra por
      // la primera (⛔ no «Pegar mi lista», que vive bajo la misma ruta); en real, por la del deck sembrado.
      const card = sc.slug
        ? page.locator(`a[href="/${locale}/decks-meta/${sc.slug}"]`).first()
        : page.locator(`a[href^="/${locale}/decks-meta/"]:not([href$="/decks-meta/pegar"])`).first();
      await expect(card).toBeVisible();
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/decks-meta/${sc.slug || '(?!pegar$)[^/]+'}$`));
      const box = page.getByTestId('deck-energy-bundle');
      await expect(box).toBeVisible();
      const addBundle = box.getByRole('button', { name: t(locale, 'decksMeta.bundle.add') });
      await expect(addBundle).toBeDisabled();
      await page.getByRole('button', { name: t(locale, 'decksMeta.addAll.button') }).click();
      await expect(addBundle).toBeEnabled();
      // «Agregar de jalón» deja el paquete FUERA: sigue ofreciéndose y no hay «En el carrito» en el recuadro.
      await expect(box.getByRole('button', { name: new RegExp(t(locale, 'decksMeta.bundle.inCart')) })).toHaveCount(0);
      await addBundle.click();
      await expect(box.getByRole('button', { name: new RegExp(t(locale, 'decksMeta.bundle.inCart')) })).toBeVisible();
      await expect(box.getByRole('button', { name: t(locale, 'decksMeta.bundle.remove') })).toBeVisible();
    });

    /**
     * AC-F14 — recorridos de punta a punta contra el stack (solo-real: lo que miden es que la pantalla y el servidor
     * concuerdan — el simulador no aparta existencias, no firma `pullToken` ni crea la sesión de pago, y el rechazo del
     * 749 es un `422` del servidor que se afirma sobre pedidos y existencias reales).
     */
    test.describe('AC-F14 · contra el stack', () => {
      test.beforeEach(() =>
        realOnly('recorrido O-4 contra el stack: el simulador no aparta existencias, no firma pullToken ni rechaza con 422'),
      );

      /**
       * AC-F14 · criterio 724 — el dueño da de alta un accesorio con foto PNG (POR PANTALLA) → lo ve en la pestaña → un
       * invitado lo agrega desde la sugerencia del carrito junto a una carta → la sesión de pago se crea y aparta 1.
       */
      test(`@real AC-F14 · 724 alta con foto PNG → pestaña → sugerencia junto a una carta → sesión de pago (${locale})`, async ({
        page,
        browser,
      }) => {
        const A = (k: string, v?: Record<string, string | number>) => t(locale, `admin.accessories.${k}`, v);
        const name = runTag(`724 ${locale}`);
        const admin = await adminPage(browser);
        let id: string | null = null;
        try {
          // ── 1. El dueño da de alta (pantalla del panel, no API) ──
          await admin.goto(`/${locale}/admin/accessories/new`);
          await admin.getByLabel(A('form.name'), { exact: true }).fill(name);
          await admin.getByLabel(A('form.category'), { exact: true }).selectOption({ label: t(locale, 'accessories.category.sleeves') });
          for (const [k, v] of [['length', '95'], ['width', '70'], ['height', '20'], ['weight', '40']] as const) {
            await admin.getByLabel(A(`form.${k}`), { exact: true }).fill(v);
          }
          await admin.getByRole('button', { name: A('form.saveData') }).click();
          await admin.waitForURL(new RegExp(`/${locale}/admin/accessories/([0-9a-f-]{36})\\?created=1$`));
          id = /accessories\/([0-9a-f-]{36})/.exec(admin.url())![1];
          await rememberCreatedAccessory(id);

          await admin.getByTestId('accessory-photo-input').setInputFiles({
            name: 'funda.png',
            mimeType: 'image/png',
            buffer: makePng(300, 200),
          });
          // DESIGN_SYSTEM §AC-UX (bloque Foto): con foto, vista previa y el botón pasa a «Cambiar foto».
          await expect(admin.getByText(A('photo.change'), { exact: true })).toBeVisible();
          await expect(admin.getByRole('img', { name, exact: true })).toBeVisible();
          await admin.getByLabel(A('price.price'), { exact: true }).fill('89.00');
          await admin.getByRole('button', { name: A('price.save') }).click();
          await expect(admin.getByText(A('price.saved'))).toBeVisible();
          await admin.getByRole('button', { name: A('stock.receive'), exact: true }).click();
          await admin.getByRole('dialog').getByLabel(A('stock.receiveQty'), { exact: true }).fill('20');
          await admin.getByRole('button', { name: A('stock.receiveConfirm', { n: 20 }) }).click();
          await expect(admin.getByText(A('stock.receiveDone', { n: 20, stock: 20 }))).toBeVisible();
          // «Sugerido» (★): así «¿Te falta algo?» lo pone primero aunque la tienda tenga otros (§AC.3, regla de orden).
          const suggested = admin.getByRole('switch', { name: A('publish.suggested') });
          await suggested.click();
          await expect(suggested).toHaveAttribute('aria-checked', 'true');
          await admin.getByRole('button', { name: A('publish.activate'), exact: true }).click();
          await expect(admin.getByRole('button', { name: A('publish.deactivate'), exact: true })).toBeVisible();

          const before = await getAdminAccessory(id);
          expect(before).toMatchObject({ active: true, stockQty: 20, reservedQty: 0, priceCents: 8900, suggested: true });
          expect(before.photo?.url).toMatch(new RegExp(`^/api/v1/accessories/${id}/photo/[0-9a-f]{16}/full$`));

          // ── 2. Lo ve en la pestaña (sin sesión) ──
          await page.goto(`/${locale}/accesorios?q=${encodeURIComponent(name)}`);
          await expect(page.getByRole('link', { name: t(locale, 'storeTabs.accessories') })).toHaveAttribute('aria-current', 'page');
          const tile = page.getByTestId(`accessory-tile-${id}`);
          await expect(tile).toBeVisible();
          await expect(tile.getByText(money(8900, locale))).toBeVisible();
          // La foto la sirve la API y el navegador la pinta (criterio 704: pública; AC-F20: CSP con el origen de la API).
          await expect
            .poll(() => tile.locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
            .toBe(true);

          // ── 3. Invitado: una carta + el accesorio desde la sugerencia del carrito ──
          await page.goto(`/${locale}/catalog`);
          await page.getByRole('button', { name: t(locale, 'catalog.addToCart') }).first().click();
          await page.goto(`/${locale}/checkout`);
          await page.getByRole('button', { name: t(locale, 'checkout.identity.guest.cta') }).click();
          const suggestions = page.getByRole('region', { name: t(locale, 'checkout.suggestions.title') });
          await expect(suggestions).toBeVisible();
          const quoted = page.waitForResponse(
            async (r) =>
              isGuestQuote(r) &&
              ((await r.json().catch(() => null)) as GuestQuote | null)?.accessoryLines?.some((l) => l.accessoryId === id) === true,
          );
          await suggestions.getByRole('button', { name: t(locale, 'checkout.suggestions.addAria', { name }) }).click();
          await expect(page.getByTestId(`cart-accessory-${id}`)).toBeVisible();
          const quote = (await (await quoted).json()) as GuestQuote;
          expect(quote.accessoryLines.find((l) => l.accessoryId === id)).toMatchObject({ quantity: 1, lineTotalCents: 8900 });

          // ── 4. Envío mostrado = el del servidor; la sesión de pago se crea ──
          await fillGuestForm(page, locale);
          expect(quote.breakdown.shippingFeeCents).not.toBeNull();
          await expectShipping(page, locale, quote.breakdown.shippingFeeCents!);
          const session = await payAsGuest(page, locale);
          expect(session.status(), `sesión del invitado: ${await session.text()}`).toBe(201);
          await expect(page.getByRole('dialog', { name: t(locale, 'checkout.payTitle') })).toBeVisible();

          // ── 5. Lo que el servidor apartó: 1 de 20, sin vender todavía (el cobro no ocurrió) ──
          const after = await getAdminAccessory(id);
          expect(after).toMatchObject({ stockQty: 20, reservedQty: 1, availableQty: 19 });
          // ⛔ Fin del tramo medible: pagar con tarjeta de prueba, preparar y ver bajar las existencias queda sin E2E.
        } finally {
          if (id) await retireAccessory(id);
          await admin.context().close();
        }
      });

      /**
       * AC-F14 · criterio 748 — un invitado abre un deck → «Agregar de jalón» → agrega el paquete → el envío mostrado es el
       * de hoy (el paquete no entra a la caja, §AC.7) → la sesión de pago aparta las energías por tipo.
       */
      test(`@real AC-F14 · 748 deck → «Agregar de jalón» → paquete → envío → sesión de pago (${locale})`, async ({ page }) => {
        const sc = await withFileLock('accessories:deck-scenario', () => deckScenario());
        const before = Object.fromEntries(
          await Promise.all(Object.entries(sc.energies).map(async ([k, a]) => [k, await getAdminAccessory(a.id)] as const)),
        ) as Record<'fire' | 'psychic', AdminAccessory>;

        // ── 1. Abre el deck desde la lista y lo agrega de jalón; luego el paquete ──
        await page.goto(`/${locale}/decks-meta`);
        await page.locator(`a[href="/${locale}/decks-meta/${sc.slug}"]`).first().click();
        await expect(page).toHaveURL(new RegExp(`/${locale}/decks-meta/${sc.slug}$`));
        for (const type of ['fire', 'psychic'] as const) {
          await expect(page.getByTestId(`deck-energy-${type}`)).toBeVisible(); // criterio 734: ligadas, no «no identificada»
        }
        const box = page.getByTestId('deck-energy-bundle');
        await expect(box).toBeVisible();
        await page.getByRole('button', { name: t(locale, 'decksMeta.addAll.button') }).click();
        await box.getByRole('button', { name: t(locale, 'decksMeta.bundle.add') }).click();
        await expect(box.getByRole('button', { name: new RegExp(t(locale, 'decksMeta.bundle.inCart')) })).toBeVisible();

        // ── 2. Carrito: renglón del paquete con el precio del servidor; envío ──
        const quoted = page.waitForResponse(
          async (r) =>
            isGuestQuote(r) &&
            ((await r.json().catch(() => null)) as GuestQuote | null)?.energyBundles?.some((b) => b.deckSlug === sc.slug) === true,
        );
        await page.goto(`/${locale}/checkout`);
        await page.getByRole('button', { name: t(locale, 'checkout.identity.guest.cta') }).click();
        const quote = (await (await quoted).json()) as GuestQuote;
        const bundle = quote.energyBundles.find((b) => b.deckSlug === sc.slug)!;
        const line = page.getByTestId(`cart-bundle-${sc.slug}`);
        await expect(line).toBeVisible();
        await expect(line).toContainText(t(locale, 'checkout.accessories.bundleTitle', { deck: sc.name }));
        await expect(line).toContainText(money(bundle.priceCents, locale));
        // «El envío mostrado corresponde a la caja»: sin accesorios con medidas no hay caja (§AC.7: las energías y el
        // paquete no entran a `chooseBox`) ⇒ `shippingBox: null` y la tarifa de hoy, sin la nota de caja.
        expect(quote.shippingBox).toBeNull();
        await fillGuestForm(page, locale);
        await expectShipping(page, locale, quote.breakdown.shippingFeeCents!);
        await expect(page.getByTestId('amount-breakdown-shipping-note')).toHaveCount(0);

        // ── 3. Sesión de pago: aparta lo que pedía el deck, por tipo ──
        const session = await payAsGuest(page, locale);
        expect(session.status(), `sesión del invitado: ${await session.text()}`).toBe(201);
        await expect(page.getByRole('dialog', { name: t(locale, 'checkout.payTitle') })).toBeVisible();
        for (const type of ['fire', 'psychic'] as const) {
          const now = await getAdminAccessory(before[type].id);
          expect(now.reservedQty - before[type].reservedQty, `apartadas de ${type}`).toBe(DECK_ENERGIES[type]);
          expect(now.stockQty, `existencias de ${type} (sin cobro todavía)`).toBe(before[type].stockQty);
        }
        // ⛔ Fin del tramo medible: pagar, ver el desglose en preparación y ver bajar las existencias queda sin E2E.
      });

      /**
       * AC-F14 · criterio 749 — con sesión no se pagan accesorios: la pantalla (P-AC-1) y el servidor (`quote` y `session`
       * con `422 ACCESSORIES_REQUIRE_DIRECT_SHIP`, sin pedido nuevo y sin nada apartado).
       */
      test(`@real AC-F14 · 749 con sesión: la ficha avisa, el checkout no manda el accesorio y el servidor lo rechaza (${locale})`, async ({
        page,
      }) => {
        const acc = await createReadyAccessory({ name: runTag(`749 ${locale}`), category: 'deck_boxes', priceCents: 15000, stock: 5 });
        try {
          // ── 1. Invitado lo deja en el carrito; luego entra con su cuenta ──
          await page.goto(`/${locale}/accesorios/${acc.id}`);
          await page.getByRole('button', { name: t(locale, 'accessories.addToCart') }).click();
          await loginAs(page, 'customer');
          await page.goto(`/${locale}/accesorios/${acc.id}`);
          // P-AC-1: con sesión, sin «Agregar» y con el aviso.
          await expect(page.getByRole('note').filter({ hasText: t(locale, 'accessories.signedInNotice') })).toBeVisible();
          await expect(page.getByRole('button', { name: t(locale, 'accessories.addToCart') })).toHaveCount(0);

          // ── 2. Checkout con cuenta: la cotización NO lleva el accesorio; el bloque «NO VAN EN ESTE PAGO» sí ──
          await page.goto(`/${locale}/catalog`);
          await page.getByRole('button', { name: t(locale, 'catalog.addToCart') }).first().click();
          const quoteReq = page.waitForRequest((r) => r.method() === 'POST' && /\/checkout\/quote$/.test(r.url()));
          await page.goto(`/${locale}/checkout`);
          const body = (await quoteReq).postDataJSON() as { inventoryItemIds: string[]; accessoryLines?: unknown[] };
          expect(body.accessoryLines ?? []).toEqual([]);
          const block = page.getByTestId('accessories-not-in-payment');
          await expect(block).toContainText(t(locale, 'checkout.accessories.notInThisPayment'));
          await expect(block).toContainText(acc.name);

          // ── 3. Llamando a la API directamente: se rechaza en cotizar y en pagar ──
          const itemIds = body.inventoryItemIds;
          expect(itemIds.length).toBeGreaterThan(0);
          const ordersBefore = await apiAsOk<{ data: { id: string }[] }>('customer', 'GET', '/orders?pageSize=50');
          const accessoryLines = [{ accessoryId: acc.id, quantity: 1 }];
          for (const path of ['/checkout/quote', '/checkout/session'] as const) {
            const res = await apiAs<{ error: { code: string } }>('customer', 'POST', path, { inventoryItemIds: itemIds, accessoryLines });
            expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(422);
            expect(res.body.error.code).toBe('ACCESSORIES_REQUIRE_DIRECT_SHIP');
          }
          const ordersAfter = await apiAsOk<{ data: { id: string }[] }>('customer', 'GET', '/orders?pageSize=50');
          expect(ordersAfter.data.map((o) => o.id).sort()).toEqual(ordersBefore.data.map((o) => o.id).sort());
          const after = await getAdminAccessory(acc.id);
          expect(after).toMatchObject({ stockQty: 5, reservedQty: 0 });
        } finally {
          await retireAccessory(acc.id);
        }
      });
    });
  });
}
