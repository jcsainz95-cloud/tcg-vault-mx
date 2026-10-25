import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs } from './utils/auth';
import { chooseNeighborhood } from './utils/address';

/**
 * §DSC (contrato v1.110) · DESIGN_SYSTEM §DSC-UX — códigos de descuento de punta a punta en el NAVEGADOR, contra el
 * bundle de MOCKS (el simulador `lib/mock/discounts.ts` replica §DSC.2-§DSC.8; paridad de cifras en
 * `discounts.parity.test.ts`). Candados DL1-DL4 y DL7 de §DSC-UX.8; DL5/DL6 son de vitest (`seo-content.test.ts`,
 * `i18n-parity.test.ts`).
 *
 * ⚠️ **Sin `@real` a propósito, y no es un `mockOnly`:** medido en este árbol (base `85f350df`) NO existe
 * `backend/src/modules/discounts/` ni los campos `discountCode` en los DTO del backend, así que contra el stack real
 * no hay nada que medir todavía (el config de real filtra por `@real`, así que este fichero no corre allí). Los ids de pieza y los códigos (`SEPT10`, `ENVIO25`…) son del simulador: cuando el
 * backend aterrice, el `@real` necesita sembrar sus códigos por `POST /admin/discount-codes` (pendiente, en
 * FRONTEND_NOTES §DSC). Este fichero no suma al censo de salvaguardas (`scripts/check-e2e-skip-census.sh`).
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

  test('DL7: el operador no ve la entrada del menú y por URL llega al acceso denegado', async ({ page }) => {
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
