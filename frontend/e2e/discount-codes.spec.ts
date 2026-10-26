import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';
import { chooseNeighborhood } from './utils/address';
import { apiAs, apiAsOk } from './utils/env';
import { withCustomerSettledHolding } from './utils/vault-holding';
import {
  findDiscountCodeId,
  ownDiscountPiece,
  pollFor,
  releaseDiscountPiece,
  retireDiscountCode,
  runDiscountCode,
  seedDiscountCode,
  settleByWebhook,
  stripeDouble,
  type SeededDiscountCode,
} from './utils/discount-scenario';

/**
 * §DSC (contrato v1.110) · DESIGN_SYSTEM §DSC-UX — códigos de descuento de punta a punta en el NAVEGADOR, contra el
 * bundle de MOCKS (el simulador `lib/mock/discounts.ts` replica §DSC.2-§DSC.8; paridad de cifras en
 * `discounts.parity.test.ts`). Candados DL1-DL4 y DL7 de §DSC-UX.8; DL5/DL6 son de vitest (`seo-content.test.ts`,
 * `i18n-parity.test.ts`).
 *
 * Los casos de arriba usan ids de pieza y códigos del simulador (`SEPT10`, `ENVIO25`…) y no llevan `@real`; los de
 * «DSC · @real contra el stack» (al final) y DL7 corren en los dos entornos, sembrando por la API en real. Este fichero
 * no suma al censo de salvaguardas (`scripts/check-e2e-skip-census.sh`): ningún caso se salta.
 */

/** Carrito de solo cartas de MX$4,210.80 (S ≥ T = MX$4,000): con 10 % baja a MX$3,789.72 y paga envío (895 / DL4). */
const CARDS_OVER_THRESHOLD = ['inv-1002', 'inv-1005', 'inv-1004'];

async function openCheckoutWith(page: Page, ids: string[]) {
  await page.goto('/es');
  await page.evaluate(
    ([key, list]) => window.localStorage.setItem(key, JSON.stringify({ ids: list, accessories: [], deckPulls: [], updatedAt: Date.now() })),
    ['tcg.cart', ids] as const,
  );
  await page.goto('/es/checkout');
  await expect(page.getByLabel(t('es', 'checkout.guest.email.label'))).toBeVisible();
}

async function applyCode(page: Page, code: string) {
  const row = page.getByTestId('code-row');
  const toggle = row.getByRole('button', { name: /¿Tienes un código/ });
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  const useAnother = row.getByRole('button', { name: t('es', 'checkout.discount.useAnother') });
  if ((await useAnother.count()) > 0) await useAnother.click();
  await row.getByLabel(t('es', 'checkout.discount.label')).fill(code);
  await row.getByRole('button', { name: t('es', 'checkout.discount.apply') }).click();
}

async function expectNoHorizontalOverflow(page: Page, state: string) {
  const r = await page.evaluate(() => ({ vw: window.innerWidth, sw: document.documentElement.scrollWidth }));
  expect(r.sw, `${state}: scrollWidth ${r.sw} > innerWidth ${r.vw}`).toBeLessThanOrEqual(r.vw);
}

test.describe('DSC · cliente con código (invitado, envío a domicilio)', () => {
  test('el renglón va ARRIBA (variante A): tras «Envío a mi domicilio» y antes del correo', async ({ page }) => {
    await openCheckoutWith(page, CARDS_OVER_THRESHOLD);
    const order = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="code-row"]')!;
      const email = document.querySelector('input[type="email"]')!;
      const dest = document.getElementById('guest-destination-group')!;
      const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { destBeforeRow: before(dest, row), rowBeforeEmail: before(row, email) };
    });
    expect(order).toEqual({ destBeforeRow: true, rowBeforeEmail: true });
  });

  test('DL4: aplicar 10 % a MX$4,210.80 hace aparecer «Te faltan…» y la fila «Descuento (SEPT10)»; quitarlo los borra', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCheckoutWith(page, CARDS_OVER_THRESHOLD);
    await expect(page.getByTestId('free-shipping-remaining')).toHaveCount(0);
    const summary = page.locator('aside');
    await applyCode(page, 'sept10');
    await expect(page.getByTestId('code-row-applied')).toContainText('SEPT10');
    await expect(summary.getByTestId('amount-breakdown-discount')).toContainText('Descuento (SEPT10)');
    // El número lo da el servidor (T − S′ = 400000 − 378972): ⛔ ninguna cuenta del front (DCO-F2).
    await expect(page.getByTestId('free-shipping-remaining')).toHaveText(t('es', 'checkout.freeShippingRemaining', { remaining: 'MX$210.28' }));
    await page.getByTestId('code-row').getByRole('button', { name: t('es', 'checkout.discount.remove') }).click();
    await expect(page.getByTestId('free-shipping-remaining')).toHaveCount(0);
    await expect(summary.getByTestId('amount-breakdown-discount')).toHaveCount(0);
  });

  test('DL2: genéricos (no existe / pausado / vencido / agotado) ⇒ el mismo texto y la misma estructura', async ({ page }) => {
    await openCheckoutWith(page, CARDS_OVER_THRESHOLD);
    const shapes: string[] = [];
    for (const code of ['NOEXISTE', 'BOVEDA10', 'VERANO15', 'AGOTADO5']) {
      await applyCode(page, code);
      const alert = page.getByTestId('code-row').getByRole('alert');
      await expect(alert).toHaveText(t('es', 'checkout.discount.invalid'));
      shapes.push(await page.getByTestId('code-row-field').evaluate((el) => el.outerHTML.replace(/value="[^"]*"/, '')));
    }
    expect(new Set(shapes).size).toBe(1);
  });

  test('F4: un segundo código reemplaza al primero con aviso; el pago lleva SOLO el código vigente', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCheckoutWith(page, CARDS_OVER_THRESHOLD);
    await applyCode(page, 'SEPT10');
    await expect(page.getByTestId('code-row-applied')).toContainText('SEPT10');
    await applyCode(page, 'NUEVO20');
    await expect(page.getByTestId('code-row-applied')).toContainText('NUEVO20');
    await expect(page.getByTestId('code-row-notice')).toContainText('Cambiamos SEPT10');
    // El formulario completo y PAGAR: el mock de la sesión recibe el código (I-1: sin código no viajaría).
    await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('invitado@dominio.com');
    await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
    await page.getByLabel(t('es', 'checkout.guest.recipientName')).fill('Juan Pérez');
    await page.getByLabel(t('es', 'addresses.postalCode')).fill('44100');
    await chooseNeighborhood(page, 'Guadalajara Centro');
    await page.getByLabel(t('es', 'addresses.line1')).fill('Av. Vallarta 1234');
    await page.getByLabel(t('es', 'addresses.phone')).fill('3312345678');
    await page.locator('#guest-terms').check();
    const totalBefore = await page.locator('aside').getByTestId('amount-breakdown').locator(':scope > div').last().textContent();
    await page.locator('aside').getByRole('button', { name: /^Pagar/ }).click();
    const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
    await expect(modal).toBeVisible();
    // El modal cobra el total de la SESIÓN, que es el de la cotización con NUEVO20.
    expect(totalBefore).toContain((await modal.textContent())?.match(/MX\$[\d,]+\.\d{2}/)?.[0] ?? '∅');
  });

  for (const vp of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 414, height: 896 },
  ]) {
    test(`DL1 + DL3 · ${vp.width}: código de 20 caracteres e importes de 5 cifras sin desplazamiento; barra ≤ 2 líneas y ≤ 120 px`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openCheckoutWith(page, ['inv-1001']);
      await expectNoHorizontalOverflow(page, 'plegado');
      await applyCode(page, 'BOGUS-CODE-LONG-2026');
      await expect(page.getByTestId('code-row').getByRole('alert')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'error');
      await applyCode(page, 'EVENTO-OTONO-2026-AB');
      await expect(page.getByTestId('code-row-applied')).toContainText('EVENTO-OTONO-2026-AB');
      await expectNoHorizontalOverflow(page, 'aplicado');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const bar = page.getByTestId('checkout-pay-bar');
      await expect(bar).toBeVisible();
      await expect(page.getByTestId('checkout-pay-bar-summary')).toContainText('Con descuento −MX$12,345.00');
      const m = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="checkout-pay-bar"]')!;
        const s = document.querySelector<HTMLElement>('[data-testid="checkout-pay-bar-summary"]')!;
        const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.4;
        return { barH: b.getBoundingClientRect().height, lines: Math.round(s.getBoundingClientRect().height / lh) };
      });
      expect(m.lines).toBeLessThanOrEqual(2);
      expect(m.barH).toBeLessThanOrEqual(120);
    });
  }
});

test.describe('DSC · compra a bóveda con cuenta', () => {
  test('el mismo renglón; un código de envío gratis da C13a; uno de % pinta la fila del desglose', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, 'customer');
    await page.goto('/es');
    await page.evaluate(
      ([key, list]) => window.localStorage.setItem(key, JSON.stringify({ ids: list, accessories: [], deckPulls: [], updatedAt: Date.now() })),
      ['tcg.cart', ['inv-1002']] as const,
    );
    await page.goto('/es/checkout');
    await applyCode(page, 'ENVIO25');
    await expect(page.getByTestId('code-row').getByRole('alert')).toHaveText(t('es', 'checkout.discount.noShipping'));
    await applyCode(page, 'SEPT10');
    await expect(page.getByTestId('code-row-applied')).toContainText('SEPT10');
    await expect(page.locator('aside').getByTestId('amount-breakdown-discount')).toContainText('Descuento (SEPT10)');
  });
});

test.describe('DSC · retiro de bóveda con código de envío gratis (P-DSC-3 = a)', () => {
  test('MX$0.00, «Confirmar retiro» y sin pantalla de cobro; un código de % da C13b', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/shipments');
    await page.getByRole('checkbox').first().check();
    const breakdown = page.getByTestId('amount-breakdown');
    await expect(breakdown).toBeVisible();
    await page.getByRole('button', { name: t('es', 'checkout.discount.rowWithdrawal') }).click();
    await page.getByLabel(t('es', 'checkout.discount.label')).fill('SEPT10');
    await page.getByRole('button', { name: t('es', 'checkout.discount.apply') }).click();
    await expect(page.getByTestId('code-row').getByRole('alert')).toHaveText(t('es', 'checkout.discount.withdrawalOnlyFreeShipping'));
    await page.getByLabel(t('es', 'checkout.discount.label')).fill('ENVIO25');
    await page.getByRole('button', { name: t('es', 'checkout.discount.apply') }).click();
    await expect(page.getByTestId('code-row-applied')).toContainText('ENVIO25');
    await expect(breakdown).toContainText(t('es', 'checkout.discount.withdrawalShipping'));
    await expect(breakdown.getByTestId('amount-breakdown-discount')).toContainText('Envío gratis (ENVIO25)');
    await expect(breakdown.locator(':scope > div').last()).toContainText('MX$0.00');
    await expectNoHorizontalOverflow(page, 'retiro aplicado');
    await page.getByRole('button', { name: t('es', 'checkout.discount.confirmWithdrawal') }).click();
    await expect(page.getByRole('dialog', { name: t('es', 'shipments.payTitle') })).toHaveCount(0);
    await expect(page).toHaveURL(/\/vault/);
  });
});

test.describe('DSC · panel del dueño', () => {
  test('el dueño crea un código y aparece en la lista; pausar un lote pide confirmación', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, 'admin');
    await page.goto('/es/admin/codes');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'admin.modules.discounts') })).toBeVisible();
    await page.getByRole('link', { name: t('es', 'admin.discounts.newCode') }).click();
    await page.getByLabel(t('es', 'admin.discounts.form.codeLabel')).fill('E2E-OTONO10');
    await page.getByLabel(t('es', 'admin.discounts.form.valuePct')).fill('10');
    await page.getByRole('button', { name: t('es', 'admin.discounts.saveCode') }).click();
    await expect(page).toHaveURL(/\/admin\/codes$/);
    await expect(page.getByTestId('code-list-row').filter({ hasText: 'E2E-OTONO10' })).toContainText('10 %');

    await page.getByRole('link', { name: t('es', 'admin.discounts.generateBatch') }).click();
    await page.getByLabel(t('es', 'admin.discounts.batch.prefix')).fill('FERIA');
    await page.getByLabel(t('es', 'admin.discounts.batch.quantity')).fill('5');
    await page.getByLabel(t('es', 'admin.discounts.form.valueAmount')).fill('100');
    await page.getByRole('button', { name: /^Generar 5 códigos$/ }).click();
    await expect(page.getByTestId('batch-ready')).toContainText('Lote FERIA listo');
    await expect(page.getByTestId('batch-csv-sample')).toContainText('code,status,usedAt');
    // Navegación del cliente (sin recargar): el simulador conserva el lote recién generado.
    await page.getByRole('main').getByRole('link', { name: new RegExp(t('es', 'admin.discounts.back')) }).click();
    const batchRow = page.getByTestId('batch-list-row').filter({ hasText: 'FERIA' });
    await batchRow.getByRole('button', { name: t('es', 'admin.discounts.pauseBatch') }).click();
    const dialog = page.getByRole('dialog', { name: '¿Pausar el lote FERIA?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t('es', 'admin.discounts.pauseBatch') }).click();
    await expect(batchRow).toContainText(t('es', 'admin.discounts.states.paused'));
  });

  test('v1.110.1: «Descuento dado» en la lista, «Así lo verá el cliente» a la derecha (lg) o debajo (móvil) y «Cambios» al editar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, 'admin');
    await page.goto('/es/admin/codes');
    const sept = page.getByTestId('code-list-row').filter({ hasText: 'SEPT10' });
    await expect(sept.getByTestId('code-given')).toContainText('MX$570.00');

    await page.getByRole('link', { name: t('es', 'admin.discounts.newCode') }).click();
    const preview = page.getByTestId('discount-preview');
    await expect(preview).toContainText(t('es', 'admin.discounts.preview.incomplete'));
    await page.getByLabel(t('es', 'admin.discounts.form.valuePct')).fill('10');
    await expect(preview.getByTestId('discount-preview-amount')).toHaveText('Descuento −MX$400.00');
    const form = await page.locator('form').first().boundingBox();
    const box = await preview.boundingBox();
    expect(box!.x).toBeGreaterThan(form!.x + form!.width - 1);

    await page.setViewportSize({ width: 390, height: 844 });
    const formM = await page.locator('form').first().boundingBox();
    const boxM = await preview.boundingBox();
    expect(boxM!.y).toBeGreaterThanOrEqual(formM!.y + formM!.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/es/admin/codes/dsc-sept10');
    const audit = page.getByTestId('discount-audit');
    await expect(audit).toContainText('maxTotalUses · 50 → 100');
    await expect(audit.getByTestId('discount-audit-entry')).toHaveCount(2);
  });

  test('@real DL7: el operador no ve la entrada del menú y por URL llega al acceso denegado', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, 'operator');
    await page.addInitScript(() => window.localStorage.setItem('tcg.role', 'vault_operator'));
    await page.goto('/es/admin');
    await expect(page.getByRole('heading', { name: t('es', 'admin.modules.dashboard') })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(t('es', 'admin.modules.discounts')) })).toHaveCount(0);
    await page.goto('/es/admin/codes');
    await expect(page.getByText(t('es', 'admin.superAdminGateTitle'))).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'admin.modules.discounts') })).toHaveCount(0);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * §DSC contra el STACK REAL (`@real`, frontend 2026-10-26, contrato v1.110.2, backend `1c6bb38a`/`e84c86fe`).
 *
 * Los cinco recorridos que el dueño hará en su tienda, agnósticos al entorno: en MOCK usan los códigos y las piezas del
 * simulador; en REAL siembran lo suyo por la API del contrato y lo retiran en `finally` (`utils/discount-scenario.ts`):
 *  1. el dueño crea un código desde `/admin/codes`;
 *  2. el cliente lo aplica en el checkout de invitado y ve «Descuento (CÓDIGO)»;
 *  3. lo paga: sesión `201` con `discount` aplicado ⇒ el doble de Stripe cobra ⇒ webhook FIRMADO ⇒ pedido `settled` y
 *     el reporte del código cuenta el uso con el mismo descuento que cobró la sesión;
 *  4. retiro de bóveda con un código de envío gratis ⇒ MX$0.00 y «Confirmar retiro», sin pantalla de cobro;
 *  5. el operador no ve `/admin/codes` (DL7, arriba, con `@real`).
 *
 * En real el fichero corre en UN worker y en orden (`mode: 'default'`, como `checkout-movil`): 3 y 4 cobran contra el
 * mismo backend y 4 aparta la pieza del cliente del seed durante el recorrido. ⛔ No `serial` (saltaría lo de detrás
 * del primer rojo). Presupuesto de sesiones de invitado (5/h/IP): **1** por corrida (el caso 3); el texto del fichero
 * dice «invitado», así que `e2e-real-suite.sh` le da tanda propia. Lo que deja en el stack, dicho: el caso 3 vende una
 * pieza PROPIA (alta del arnés) y deja su código pausado con un uso; el caso 4 compra a bóveda otra pieza propia para el
 * `customer` del seed y la deja en un retiro `picking` de MX$0.00 (un retiro pagado no se cancela a mano,
 * `PAID_SHIPMENT_NOT_CANCELLABLE`), con su código pausado. Ninguna pieza del seed cambia.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
if (IS_REAL) test.describe.configure({ mode: 'default' });

const mx = (cents: number) => `MX$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface AppliedDiscount {
  outcome: 'applied';
  code: string;
  kind: string;
  discountCents: number;
  shippingWaivedCents: number;
}

async function fillGuestForm(page: Page) {
  await page.getByLabel(t('es', 'checkout.guest.email.label')).fill('invitado.dsc@dominio.com');
  await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
  await page.getByLabel(t('es', 'checkout.guest.recipientName')).fill('Juan Pérez');
  await page.getByLabel(t('es', 'addresses.postalCode')).fill('44100');
  await chooseNeighborhood(page, 'Guadalajara Centro');
  await page.getByLabel(t('es', 'addresses.line1')).fill('Av. Vallarta 1234');
  await page.getByLabel(t('es', 'addresses.phone')).fill('3312345678');
  await page.locator('#guest-terms').check();
}

/** Último `discount` aplicado que devolvió `POST /checkout/guest/quote` (solo real: en mock no hay red). */
function watchGuestQuote(page: Page): () => AppliedDiscount | null {
  let last: AppliedDiscount | null = null;
  page.on('response', async (r) => {
    if (r.request().method() !== 'POST' || !/\/checkout\/guest\/quote(\?|$)/.test(r.url()) || r.status() !== 200) return;
    try {
      const body = (await r.json()) as { discount?: AppliedDiscount };
      if (body.discount?.outcome === 'applied') last = body.discount;
    } catch {
      // cuerpo no JSON: no es la cotización
    }
  });
  return () => last;
}

test.describe('DSC · @real contra el stack (siembra por la API y retira en finally)', () => {
  test('@real el dueño crea un código desde /admin/codes y aparece en la lista', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const code = IS_REAL ? runDiscountCode('ui') : 'E2E-PANTALLA10';
    try {
      await loginAs(page, 'admin');
      await page.goto('/es/admin/codes');
      await expect(page.getByRole('heading', { level: 1, name: t('es', 'admin.modules.discounts') })).toBeVisible();
      await page.getByRole('link', { name: t('es', 'admin.discounts.newCode') }).click();
      await page.getByLabel(t('es', 'admin.discounts.form.codeLabel')).fill(code.toLowerCase());
      await page.getByLabel(t('es', 'admin.discounts.form.valuePct')).fill('10');
      await page.getByRole('button', { name: t('es', 'admin.discounts.saveCode') }).click();
      await expect(page).toHaveURL(/\/admin\/codes$/);
      // El servidor normaliza a MAYÚSCULAS (§DSC.6) y la lista es la suya, la más nueva primero.
      await expect(page.getByTestId('code-list-row').filter({ hasText: code })).toContainText('10 %');
    } finally {
      if (IS_REAL) {
        const id = await findDiscountCodeId(code);
        if (id) await retireDiscountCode(id);
      }
    }
  });

  test('@real el cliente aplica el código en el checkout de invitado y ve la línea «Descuento (CÓDIGO)»', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const piece = IS_REAL ? await ownDiscountPiece() : null;
    const seeded = IS_REAL ? await seedDiscountCode({ code: runDiscountCode('ap'), kind: 'percent', percentPct: 10 }) : null;
    const code = seeded?.code ?? 'SEPT10';
    try {
      const lastQuote = watchGuestQuote(page);
      await openCheckoutWith(page, piece ? [piece.id] : CARDS_OVER_THRESHOLD);
      await applyCode(page, code.toLowerCase());
      await expect(page.getByTestId('code-row-applied')).toContainText(code);
      const row = page.locator('aside').getByTestId('amount-breakdown-discount');
      await expect(row).toContainText(`Descuento (${code})`);
      if (IS_REAL) {
        // La cifra es la del servidor (DCO-F2): la fila pinta el `discountCents` de la cotización, sin cuentas.
        const applied = lastQuote();
        expect(applied, 'POST /checkout/guest/quote con discount.outcome = applied').not.toBeNull();
        expect(applied!.discountCents).toBeGreaterThan(0);
        await expect(row).toContainText(mx(applied!.discountCents));
      }
    } finally {
      if (seeded) await retireDiscountCode(seeded.id);
      if (piece) await releaseDiscountPiece(piece.id);
    }
  });

  test('@real el invitado paga con el código: webhook firmado del doble de Stripe ⇒ pedido pagado y el uso contado', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const double = IS_REAL ? stripeDouble() : null; // sin el doble: ROJO con el motivo, antes de gastar una sesión
    const piece = IS_REAL ? await ownDiscountPiece() : null;
    const seeded = IS_REAL ? await seedDiscountCode({ code: runDiscountCode('pg'), kind: 'percent', percentPct: 10 }) : null;
    const code = seeded?.code ?? 'SEPT10';
    try {
      await openCheckoutWith(page, piece ? [piece.id] : CARDS_OVER_THRESHOLD);
      await applyCode(page, code);
      await expect(page.getByTestId('code-row-applied')).toContainText(code);
      await fillGuestForm(page);
      const totalBefore = await page.locator('aside').getByTestId('amount-breakdown').locator(':scope > div').last().textContent();
      const sessionResponse = IS_REAL
        ? page.waitForResponse((r) => r.request().method() === 'POST' && /\/checkout\/guest\/session(\?|$)/.test(r.url()))
        : null;
      await page.locator('aside').getByRole('button', { name: /^Pagar/ }).click();
      const modal = page.getByRole('dialog', { name: t('es', 'checkout.payTitle') });
      if (!IS_REAL) {
        await expect(modal).toBeVisible();
        expect(totalBefore).toContain((await modal.textContent())?.match(/MX\$[\d,]+\.\d{2}/)?.[0] ?? '∅');
        return;
      }
      const res = await sessionResponse!;
      expect(res.status(), 'POST /checkout/guest/session').toBe(201);
      const session = (await res.json()) as {
        orderId: string;
        breakdown: { totalCents: number };
        stripe: { paymentIntentId: string };
        discount?: AppliedDiscount;
      };
      expect(session.discount).toMatchObject({ outcome: 'applied', code, kind: 'percent' });
      expect(session.discount!.discountCents).toBeGreaterThan(0);
      // Lo que se cobra es el total de la cotización con el código (el que el cliente vio antes de pagar).
      expect(totalBefore).toContain(mx(session.breakdown.totalCents));
      await expect(modal).toBeVisible();

      expect(await settleByWebhook(double!, session.stripe.paymentIntentId), 'webhook firmado').toBe(200);
      const status = await pollFor(async () => {
        const o = await apiAs<{ status: string }>('admin', 'GET', `/admin/orders/${session.orderId}`);
        return o.status === 200 && o.body.status === 'settled' ? o.body.status : undefined;
      });
      expect(status, `pedido ${session.orderId} tras el webhook`).toBe('settled');
      // El dueño lo ve en el reporte del código: un uso consumido, un pedido pagado, el mismo descuento cobrado (913).
      const report = await apiAsOk<{ consumed: number; paidOrders: number; discountGivenCents: number; salesCollectedCents: number }>(
        'admin',
        'GET',
        `/admin/discount-codes/${seeded!.id}/report`,
      );
      expect(report).toMatchObject({
        consumed: 1,
        paidOrders: 1,
        discountGivenCents: session.discount!.discountCents,
        salesCollectedCents: session.breakdown.totalCents,
      });
    } finally {
      if (seeded) await retireDiscountCode(seeded.id);
      if (piece) await releaseDiscountPiece(piece.id);
    }
  });

  test('@real retiro de bóveda con un código de envío gratis ⇒ MX$0.00 y «Confirmar retiro», sin pantalla de cobro', async ({ page }) => {
    const run = async () => {
      let folio: string | null = null;
      let seeded: SeededDiscountCode | null = null;
      let pieceId: string | null = null;
      try {
        if (IS_REAL) {
          // Una pieza PROPIA en la bóveda del `customer` del seed: la compra a bóveda por la API (§4) y el doble cobra.
          const double = stripeDouble();
          const piece = await ownDiscountPiece();
          pieceId = piece.id;
          folio = piece.folio;
          const vault = await apiAsOk<{ stripe: { paymentIntentId: string } }>('customer', 'POST', '/checkout/session', {
            inventoryItemIds: [piece.id],
          });
          expect(await settleByWebhook(double, vault.stripe.paymentIntentId), 'webhook firmado de la compra a bóveda').toBe(200);
          const ready = await pollFor(async () => {
            const h = await apiAsOk<{ data: { inventoryItemId: string; withdrawable: boolean }[] }>('customer', 'GET', '/vault/holdings');
            return h.data.find((x) => x.inventoryItemId === piece.id && x.withdrawable) ? true : undefined;
          });
          expect(ready, `la pieza ${piece.folio} retirable en la bóveda del cliente`).toBe(true);
          seeded = await seedDiscountCode({ code: runDiscountCode('rt'), kind: 'free_shipping' });
        }
        const code = seeded?.code ?? 'ENVIO25';
        await loginAs(page, 'customer');
        await page.goto('/es/shipments');
        const box = folio ? page.getByRole('checkbox', { name: new RegExp(`${folio}$`) }) : page.getByRole('checkbox').first();
        await box.check();
        const breakdown = page.getByTestId('amount-breakdown');
        await expect(breakdown).toBeVisible();
        await page.getByRole('button', { name: t('es', 'checkout.discount.rowWithdrawal') }).click();
        await page.getByLabel(t('es', 'checkout.discount.label')).fill(code);
        await page.getByRole('button', { name: t('es', 'checkout.discount.apply') }).click();
        await expect(page.getByTestId('code-row-applied')).toContainText(code);
        await expect(breakdown.getByTestId('amount-breakdown-discount')).toContainText(`Envío gratis (${code})`);
        await expect(breakdown.locator(':scope > div').last()).toContainText('MX$0.00');
        await page.getByRole('button', { name: t('es', 'checkout.discount.confirmWithdrawal') }).click();
        await expect(page.getByRole('dialog', { name: t('es', 'shipments.payTitle') })).toHaveCount(0);
        await expect(page).toHaveURL(/\/vault/);
        if (seeded) {
          // §DSC.8: el uso se consume directo (no hay cobro que esperar) y el reporte lo cuenta como retiro.
          const report = await apiAsOk<{ consumed: number; withdrawals: number; shippingWaivedWithdrawalsCents: number }>(
            'admin',
            'GET',
            `/admin/discount-codes/${seeded.id}/report`,
          );
          expect(report.consumed).toBe(1);
          expect(report.withdrawals).toBe(1);
          expect(report.shippingWaivedWithdrawalsCents).toBeGreaterThan(0);
        }
      } finally {
        if (seeded) await retireDiscountCode(seeded.id);
        if (pieceId) await releaseDiscountPiece(pieceId);
      }
    };
    // Mientras dura, nadie más mira la bóveda del `customer` (shipments/vault toman «la primera casilla», QA-REL-3).
    await withCustomerSettledHolding(run);
  });
});
