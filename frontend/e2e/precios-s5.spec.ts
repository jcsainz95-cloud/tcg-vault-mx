import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs, mockOnly, realOnly } from './utils/auth';
import { apiAs, apiAsOk } from './utils/env';

/**
 * **Stream «precios» s5 en un NAVEGADOR DE VERDAD** — `DESIGN_SYSTEM §39` (precio final del sellado, cola «Listas para
 * publicar» con motivo, regla de premium en el piso de M10) y `§40` (reembolso total «depende de si ya salió» y
 * «Reembolso por revisar»), contrato `§M1 v1.80.8.7` y `§M4-SHIP.18.12`. Lo pidió QA (IMPORTANTE-2 sobre `4d994c55`):
 * hasta aquí solo lo cubría su smoke de scratchpad.
 *
 * **Censo** (`utils/auth`):
 *  - `@real` agnósticos: el dial de M10 (lo deja como estaba) y la tarjeta/filtro de «Reembolso por revisar».
 *  - `realOnly`: los códigos del contrato que el seed sí permite (`400` del filtro, `403` del operador, `404`).
 *  - `mockOnly`: los recorridos que siguen folios del fixture (`INV-000109`, `INV-004204`, `ord-5006/5007/5008`).
 *  - SIN versión real (hueco declarado, no escondido): los recorridos de dinero de §40.2/§40.3 contra el backend real.
 *    El seed NO siembra un directo liquidado con envío `enviado`/`guia`, ni un reembolso total tras el envío sin motivo;
 *    QA los fabricó con SQL y un `charge.refunded` firmado, cosa que el arnés no hace. Petición a quien mantiene
 *    `backend/prisma/seed-e2e.ts` (FRONTEND_NOTES §85): con esas filas, estos casos se reescriben agnósticos.
 *
 * El «servidor» de mocks se reinicia con cada carga completa: cada caso arranca limpio, y dentro de un caso se navega
 * por la APP (clics), no con `goto`, cuando el estado tiene que sobrevivir.
 */

const M10 = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m10.premiumFloor.${key}`, vars);
const Q = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m1.publishQueue.${key}`, vars);
const SFP = (key: string, vars?: Record<string, string | number>) => t('es', `admin.sealedFinalPrice.${key}`, vars);
const M3 = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m3.${key}`, vars);
const RR = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m3.refundReview.${key}`, vars);
const REASON = (r: 'not_arrived' | 'arrived_damaged') => t('es', `admin.m3.shippedReason.${r}`);

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

type PremiumFloorRule = { mode: 'all' | 'none' | 'only'; rarities: string[] };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §39.4 · el dial de M10 «Cartas premium en el piso (venta)»
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('§39.4 · M10 · regla de premium en el piso', () => {
  test.describe.configure({ mode: 'serial' });

  test('@real cambiar la regla pide confirmación con «antes/ahora», se guarda, y se deja como estaba', async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAs(page, 'admin');
    // En real se lee la regla VIGENTE para devolverla al final: el dial es global y lo leen otros casos.
    const original = IS_REAL
      ? (await apiAsOk<{ premiumFloorSalePublish: PremiumFloorRule }>('admin', 'GET', '/admin/settings')).premiumFloorSalePublish
      : null;
    try {
      await page.goto('/es/admin/m10');
      const sec = page.getByTestId('m10-premium-floor');
      await sec.scrollIntoViewIfNeeded();
      await expect(sec.getByRole('heading', { name: M10('title') })).toBeVisible();
      // «Valor inicial» marca SIEMPRE la opción «Publicar solo estas rarezas» (§39.4), sea cual sea la vigente.
      const onlyLabel = sec.locator('label', { has: page.locator('input[name="premium-floor-mode"][value="only"]') });
      await expect(onlyLabel).toContainText(M10('defaultTag'));

      const checked = sec.locator('input[name="premium-floor-mode"]:checked');
      await expect(checked).toHaveCount(1);
      const before = (await checked.getAttribute('value')) as PremiumFloorRule['mode'];
      if (!IS_REAL) expect(before, 'el fixture arranca en el valor inicial').toBe('only');
      // Destino: «Retener todas» (o «Publicar solo…» si ya estaba en retener) — nunca «todas», que publica rotos.
      const target: PremiumFloorRule['mode'] = before === 'none' ? 'only' : 'none';
      if (target === 'only') {
        await sec.locator('input[name="premium-floor-mode"][value="only"]').check();
        const first = sec.getByTestId('premium-floor-rarities').locator('input[type=checkbox]').first();
        if (!(await first.isChecked())) await first.check();
      } else {
        await sec.locator('input[name="premium-floor-mode"][value="none"]').check();
      }
      await sec.getByRole('button', { name: M10('save') }).click();

      const dialog = page.getByRole('dialog', { name: M10('confirm.title') });
      await expect(dialog).toBeVisible();
      if (target === 'none') await expect(dialog).toContainText(M10('confirm.after', { summary: M10('summary.none') }));
      await dialog.getByRole('button', { name: M10('confirm.confirm'), exact: true }).click();
      await expect(sec.getByRole('status').filter({ hasText: M10('saved') })).toBeVisible();
      await expect(sec.locator(`input[name="premium-floor-mode"][value="${target}"]`)).toBeChecked();

      if (IS_REAL) {
        const now = await apiAsOk<{ premiumFloorSalePublish: PremiumFloorRule }>('admin', 'GET', '/admin/settings');
        expect(now.premiumFloorSalePublish.mode).toBe(target);
      }
      expect(errors).toEqual([]);
    } finally {
      if (original) await apiAsOk('admin', 'PUT', '/admin/settings', { premiumFloorSalePublish: original });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §39.2 / §39.3 · cola «Listas para publicar»: motivo por fila y precio final SOLO del sellado
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('§39.2/§39.3 · M1 · «Listas para publicar»', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
  });

  test('cada fila dice POR QUÉ falta el precio; el lápiz de precio final solo aparece en el sellado', async ({ page }) => {
    mockOnly('las filas `INV-004204` (premium retenida) e `INV-000109` (sellado) son del fixture');
    await page.goto('/es/admin/m1');
    const queue = page.getByTestId('pending-publish-queue');
    await expect(queue).toBeVisible();

    // Premium retenida: el motivo del SERVIDOR y, para el súper-admin, el enlace a la regla de M10.
    const premium = queue.getByTestId('publish-reason-inv-pub-4');
    await expect(premium).toContainText(Q('reason.premium_at_floor'));
    await expect(premium.getByRole('link', { name: Q('reason.seeRule') })).toHaveAttribute('href', /\/admin\/m10#premium-piso$/);
    // Sin mercado: su propio motivo.
    await expect(queue.getByTestId('publish-reason-inv-1009')).toContainText(Q('reason.sealedNoPrice'));

    // ⛔ Raw y graded no montan el editor (P-PRE-1); el sellado sí.
    await expect(queue.getByTestId('sealed-final-price-inv-1009')).toBeVisible();
    for (const id of ['inv-pub-1', 'inv-pub-2', 'inv-pub-3', 'inv-pub-4']) {
      await expect(queue.getByTestId(`sealed-final-price-${id}`)).toHaveCount(0);
    }
    await expect(queue.getByRole('button', { name: SFP('setAria', { folio: 'INV-000109' }) })).toBeVisible();
    await expect(queue.getByRole('button', { name: SFP('setAria', { folio: 'INV-004204' }) })).toHaveCount(0);
  });

  test('precio final del sellado: ⛔ $0, confirmación con el efecto, y la pieza sale de la cola publicada', async ({ page }) => {
    mockOnly('el sellado `inv-1009` (con ubicación, sin precio automático) es del fixture con estado');
    const errors = collectPageErrors(page);
    await page.goto('/es/admin/m1');
    const queue = page.getByTestId('pending-publish-queue');
    await queue.getByRole('button', { name: SFP('setAria', { folio: 'INV-000109' }) }).click();
    const editor = queue.getByTestId('sealed-final-price-editor-inv-1009');
    const input = editor.getByLabel(SFP('label'));
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(''); // ⛔ prellenado con un automático que no existe

    const publish = editor.getByRole('button', { name: SFP('saveAndPublish') });
    await input.fill('0');
    await expect(editor).toContainText(SFP('errPositive'));
    await expect(publish).toBeDisabled();
    await input.fill('1250');
    await expect(publish).toBeEnabled();
    // Pieza con ubicación ⇒ «Guardar y publicar» es el ÚNICO botón (guardar sin publicar la dejaría invisible).
    await expect(editor.getByRole('button', { name: SFP('saveOnly') })).toHaveCount(0);
    await publish.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(SFP('confirm.nowNone'));
    await expect(dialog).toContainText(SFP('confirm.effectPublish', { price: 'MX$1,250.00' }));
    await dialog.getByTestId('sealed-final-price-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: SFP('done.published', { folio: 'INV-000109', price: 'MX$1,250.00' }) })).toBeVisible();
    await expect(queue.getByTestId('sealed-final-price-inv-1009')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('@real ninguna fila de la cola ofrece el precio final fuera del sellado', async ({ page }) => {
    await page.goto('/es/admin/m1');
    const queue = page.getByTestId('pending-publish-queue');
    await expect(queue).toBeVisible();
    const rows = queue.locator('tbody tr');
    await expect(rows.first().or(queue.getByText(Q('empty'))).first()).toBeVisible();
    // Cada lápiz de precio final vive en una fila marcada como sellado (la marca «SELLADO» de `PieceCell`).
    const total = await rows.count();
    for (let i = 0; i < total; i++) {
      const row = rows.nth(i);
      if ((await row.locator('[data-testid^="sealed-final-price-"]').count()) > 0) {
        await expect(row, `fila ${i}: precio final fuera del sellado`).toContainText(Q('sealedMark'));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §40.2 · reembolso TOTAL de M3: «depende de si ya salió»
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('§40.2 · M3 · reembolso total', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
  });

  test('pedido con guía que NO ha salido: sin motivo, el total del detalle es el del desglose (⛔ NaN)', async ({ page }) => {
    mockOnly('`ord-5008` (directo de invitado con guía, sin salir) es del fixture con estado');
    const errors = collectPageErrors(page);
    await page.goto('/es/admin/m3/ord-5008');
    // QA s5 IMPORTANTE-1: el total sale de `breakdown.totalCents`.
    await expect(page.getByTestId('m3-total')).toHaveText('MX$838.86');
    await expect(page.locator('body')).not.toContainText('NaN');

    await page.getByTestId('m3-refund-cta').click();
    const dialog = page.getByRole('dialog', { name: M3('refund') });
    const confirm = dialog.getByTestId('m3-refund-confirm');
    await expect(confirm).toHaveText(M3('refundConfirm', { amount: 'MX$838.86' }));
    await expect(dialog.getByTestId('m3-shipped-warning')).toHaveCount(0);
    await expect(dialog.locator('input[name="m3-refund-shipped-reason"]')).toHaveCount(0);
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(M3('refundReasonLabel')).fill('cliente canceló antes de que saliera');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByTestId('m3-notice')).toContainText(M3('refundDone', { orderId: 'ord-5008' }));
    // No salió ⇒ no hay «reembolso tras el envío» que registrar.
    await expect(page.getByTestId('m3-refund-review-done')).toHaveCount(0);
    await expect(page.getByTestId('m3-refund-review')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('pedido YA ENVIADO: aviso, motivo obligatorio (⛔ preseleccionado) y nota; queda registrado a la vista', async ({ page }) => {
    mockOnly('`ord-5006` (directo de invitado con envío `enviado`) es del fixture con estado');
    const errors = collectPageErrors(page);
    await page.goto('/es/admin/m3/ord-5006');
    await expect(page.getByTestId('m3-total')).toHaveText('MX$838.86');
    await page.getByTestId('m3-refund-cta').click();
    const dialog = page.getByRole('dialog', { name: M3('refund') });
    await expect(dialog.getByTestId('m3-shipped-warning')).toContainText(M3('shippedRefund.warning'));
    const radios = dialog.locator('input[name="m3-refund-shipped-reason"]');
    await expect(radios).toHaveCount(2);
    for (let i = 0; i < 2; i++) await expect(radios.nth(i)).not.toBeChecked();
    const confirm = dialog.getByTestId('m3-refund-confirm');
    const note = dialog.getByLabel(M3('shippedRefund.noteLabel'));

    await note.fill('guía sin movimiento 10 días');
    await expect(confirm, 'con nota y SIN motivo no se puede reembolsar').toBeDisabled();
    await dialog.getByRole('radio', { name: new RegExp(REASON('not_arrived')) }).check();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByTestId('m3-notice')).toContainText(
      M3('shippedRefund.done', { ref: 'TCG-000126', reason: REASON('not_arrived') }),
    );
    const done = page.getByTestId('m3-refund-review-done');
    await expect(done).toContainText(RR('reasonLine', { reason: REASON('not_arrived') }));
    // Registro único: el formulario de «por revisar» NO aparece (ya tiene motivo).
    await expect(page.getByTestId('m3-refund-review')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §40.3 · «Reembolso por revisar»: tarjeta del tablero, filtro, marca y registro único
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('§40.3 · «Reembolso por revisar»', () => {
  test('tablero → filtro → marca → registro único, como lo recorre el dueño', async ({ page }) => {
    mockOnly('`ord-5007` (reembolsado desde Stripe tras el envío, sin motivo) es del fixture con estado');
    const errors = collectPageErrors(page);
    await loginAs(page, 'admin');
    await page.goto('/es/admin');
    const card = page.getByTestId('dashboard-refund-reviews');
    await expect(card).toContainText('Falta el motivo');
    await card.click();

    await expect(page).toHaveURL(/\/es\/admin\/m3\?refundReview=pending$/);
    await expect(page.getByTestId('m3-refund-review-filter')).toBeChecked();
    // La tabla pinta cada fila dos veces (escritorio + tarjeta móvil): se mira la VISIBLE.
    await expect(page.getByTestId('m3-review-chip-ord-5007').filter({ visible: true })).toHaveText(RR('chip'));
    // El filtro deja SOLO las que tienen el predicado del servidor.
    for (const id of ['ord-5006', 'ord-5008', 'ord-9001']) await expect(page.getByTestId(`m3-order-link-${id}`)).toHaveCount(0);
    await page.getByTestId('m3-order-link-ord-5007').filter({ visible: true }).click();

    await expect(page.getByTestId('m3-refund-review-banner')).toHaveText(RR('bannerBody'));
    const form = page.getByTestId('m3-refund-review');
    const cta = form.getByRole('button', { name: RR('cta') });
    await expect(cta).toBeDisabled(); // ⛔ sin motivo preseleccionado
    await form.getByRole('radio', { name: new RegExp(REASON('arrived_damaged')) }).check();
    await form.getByLabel(RR('noteLabel')).fill('cartas dobladas');
    await cta.click();
    const confirm = page.getByRole('dialog', { name: RR('confirmTitle', { reason: REASON('arrived_damaged') }) });
    await expect(confirm).toContainText(RR('confirmBody'));
    await confirm.getByTestId('m3-refund-review-confirm').click();

    const done = page.getByTestId('m3-refund-review-done');
    await expect(done).toContainText(RR('reasonLine', { reason: REASON('arrived_damaged') }));
    await expect(done).toContainText('cartas dobladas');
    // Registro ÚNICO: el formulario y la marca desaparecen; no hay botón para cambiarlo.
    await expect(page.getByTestId('m3-refund-review')).toHaveCount(0);
    await expect(page.getByTestId('m3-refund-review-banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: RR('cta') })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('el operador ve la marca pero no registra, y no tiene la tarjeta del tablero', async ({ page }) => {
    mockOnly('`ord-5007` es del fixture');
    await loginAs(page, 'operator');
    await page.goto('/es/admin/m3/ord-5007');
    await expect(page.getByTestId('m3-refund-review-banner')).toBeVisible();
    await expect(page.getByTestId('m3-refund-review-operator')).toHaveText(RR('operatorOnly'));
    await expect(page.getByTestId('m3-refund-review')).toHaveCount(0);
    await page.goto('/es/admin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('dashboard-refund-reviews')).toHaveCount(0);
  });

  test('@real el súper-admin tiene la tarjeta y el filtro lleva a la lista filtrada', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin');
    const card = page.getByTestId('dashboard-refund-reviews');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/es\/admin\/m3\?refundReview=pending$/);
    await expect(page.getByTestId('m3-refund-review-filter')).toBeChecked();
    // Con o sin pendientes: o hay marcas en TODAS las filas, o el vacío propio del filtro.
    const links = page.locator('[data-testid^="m3-order-link-"]').filter({ visible: true });
    await expect(links.first().or(page.getByText(RR('emptyTitle'))).first()).toBeVisible();
    const n = await links.count();
    expect(await page.locator('[data-testid^="m3-review-chip-"]').filter({ visible: true }).count()).toBe(n);
  });

  test('@real los códigos del contrato: filtro inválido 400, operador 403 auditado, pedido inexistente 404', async () => {
    realOnly('son respuestas del servidor real (§M4-SHIP.18.12 (6)/(7))');
    const bad = await apiAs<{ error: { code: string; details: { field: string } } }>('admin', 'GET', '/admin/orders?refundReview=foo');
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('refundReview');
    const op = await apiAs<{ error: { code: string } }>('operator', 'POST', '/admin/orders/no-existe/shipped-refund-reason', { reason: 'not_arrived' });
    expect(op.status).toBe(403);
    expect(op.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
    const nf = await apiAs('admin', 'POST', '/admin/orders/no-existe/shipped-refund-reason', { reason: 'not_arrived' });
    expect(nf.status).toBe(404);
  });

});
