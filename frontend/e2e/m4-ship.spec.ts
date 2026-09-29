import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * **§M4-SHIP en un NAVEGADOR DE VERDAD** — `DESIGN_SYSTEM §37`, contrato `§M4-SHIP v1.80.6`. Los cinco flujos
 * críticos del encargo, contra el «servidor» con estado de `lib/mock/m4-ship` (se reinicia con cada carga
 * completa, así que cada caso arranca limpio):
 *
 *  1. palomeo → «Pedido preparado» → guía (envío directo `shp-7004`, Ash);
 *  2. carta faltante → reembolso con la cifra del servidor (Pikachu `INV-000113` ⇒ **MX$314.58**, `§M4-SHIP.4`);
 *  3. caso «Por reponer» → reponer con una pieza (`rc-9001`) / reembolsar sin reposición (súper-admin);
 *  4. cubeta SPEI → revelar CLABE → «Marcar pagada» (`mr-1001`), con la CLABE fuera del HTML antes y después;
 *  5. M3 → «Reclamar» con casilla por carta (`ord-9004`, v1.80.6) y la confirmación física.
 *
 * Todos son `mockOnly`: el seed real no siembra reembolsos, casos ni transferencias, y los asertos siguen
 * folios del fixture. Los dos anchos de §37.18 (390×844 y 1280×800) y ⛔ sin desbordamiento horizontal.
 */

const VIEWPORTS = [
  { name: '390×844 (de pie)', size: { width: 390, height: 844 } },
  { name: '1280×800 (escritorio)', size: { width: 1280, height: 800 } },
] as const;

const S = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m4.prep.ship.${key}`, vars);
const V = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m4.prep.vault.${key}`, vars);
const R = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m4.replace.${key}`, vars);
const MR = (key: string, vars?: Record<string, string | number>) => t('es', `admin.manualRefunds.${key}`, vars);
const M3 = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m3.vaultRefund.${key}`, vars);

const EIGHTEEN_DIGITS = /\d{18}/;

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, `la pantalla desborda ${scrollW - clientW}px en horizontal`).toBeLessThanOrEqual(clientW);
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** El `aria-label` de los verbos de palomeo: «{acción}: {carta} · {folio}» (§36.12, mismo patrón en envío). */
function mark(page: Page, shipmentId: string, action: string, card: string, folio: string) {
  return page.getByTestId(`prep-order-${shipmentId}`).getByRole('button', { name: V('item.actionAria', { action, card, folio }), exact: true });
}

for (const vp of VIEWPORTS) {
  test.describe(`admin · Pedidos por preparar (§M4-SHIP) · ${vp.name}`, () => {
    test.use({ viewport: vp.size });

    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'admin');
    });

    test('palomeo → «Pedido preparado» → guía, y el envío sale de la hoja', async ({ page }) => {
      mockOnly('el recorrido sigue el envío directo `shp-7004` (Ash) del fixture con estado');
      const errors = collectPageErrors(page);
      await page.goto('/es/admin/m4');

      // PS-UI-2: el rótulo nuevo, y ⛔ ni «Pedidos a preparar» ni «picking» de cara al operador.
      // El h1 lee `admin.modules.m4` (la misma clave que el menú, `M4View.tsx`); `admin.m4.title` se borró en
      // la fusión envio-preparar. El literal fija el rótulo aunque alguien cambie la clave.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('es', 'admin.modules.m4'));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pedidos por preparar');
      await expect(page.getByText('Pedidos a preparar', { exact: false })).toHaveCount(0);
      await expect(page.getByText(/picking/i)).toHaveCount(0);

      const card = page.getByTestId('prep-order-shp-7004');
      await expect(card).toBeVisible();
      const step = page.getByTestId('ship-step-shp-7004');
      await expect(step).toHaveText(S('step.collect'));
      const prepare = card.getByRole('button', { name: S('prepare.cta') });
      await expect(prepare).toBeDisabled();

      // PS-UI-5: tres verbos por fila pendiente, ninguno recortado.
      const row = page.getByTestId('prep-item-sit-9004-1');
      await expect(row.getByRole('group').getByRole('button')).toHaveCount(3);
      await expectNoHorizontalOverflow(page);

      await mark(page, 'shp-7004', V('item.pick'), 'Charizard', 'INV-000112').click();
      await expect(row).toHaveAttribute('data-prep-status', 'picked');
      await mark(page, 'shp-7004', V('item.pick'), 'Pikachu', 'INV-000113').click();
      await expect(page.getByTestId('prep-item-sit-9004-2')).toHaveAttribute('data-prep-status', 'picked');
      await expect(prepare).toBeEnabled();

      // Sin faltantes: ⛔ no hay diálogo de dinero; el paso cambia y recibe el foco.
      await prepare.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(step).toHaveText(S('step.pack'));
      await expect(step).toBeFocused();
      await expect(card).toContainText('Preparado por');

      // Guía desde la tarjeta: el diálogo compartido, y el envío sale de la lista con su aviso.
      await card.getByRole('button', { name: S('guide.cta') }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Paquetería', { exact: true }).fill('Estafeta');
      await dialog.getByLabel('Número de guía', { exact: true }).fill('EST-000111');
      await dialog.getByRole('button', { name: t('es', 'admin.m4.tracking.save') }).click();
      await expect(page.getByText(S('guide.saved', { ref: 'TCG-000123' }))).toBeVisible();
      await expect(card).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });

    test('carta faltante → reembolso con la cifra del servidor (MX$314.58) → preparado', async ({ page }) => {
      mockOnly('la cifra 31458 sale del fixture `ord-5001` (contrato §M4-SHIP.4) sobre `shp-7004`');
      const errors = collectPageErrors(page);
      await page.goto('/es/admin/m4');

      const card = page.getByTestId('prep-order-shp-7004');
      await expect(card).toBeVisible();
      await mark(page, 'shp-7004', V('item.pick'), 'Charizard', 'INV-000112').click();
      await mark(page, 'shp-7004', V('item.miss'), 'Pikachu', 'INV-000113').click();
      const pikachu = page.getByTestId('prep-item-sit-9004-2');
      await expect(pikachu).toHaveAttribute('data-prep-status', 'missing');

      // PS-UI-3: la fila, el conteo y el botón del diálogo repiten «314.58»; nada lo calcula la pantalla.
      await expect(page.getByTestId('ship-refund-line-sit-9004-2')).toContainText('314.58');
      await expect(page.getByTestId('ship-refund-preview-shp-7004')).toContainText('314.58');
      await card.getByRole('button', { name: S('prepare.cta') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: S('confirmRefund.cancel') })).toBeFocused();
      await expect(dialog.getByTestId('ship-prepare-confirm')).toContainText('314.58');
      await expect(dialog).toContainText(S('confirmRefund.signature'));

      await dialog.getByTestId('ship-prepare-confirm').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('ship-step-shp-7004')).toHaveText(S('step.pack'));
      // La línea de dinero pasa a «reembolsada» con su estado; la fila queda fija (sin «Deshacer»).
      await expect(page.getByTestId('ship-refund-line-sit-9004-2')).toContainText('314.58');
      // Fila fija: ni «Deshacer» ni ningún verbo de palomeo (el grupo entero desaparece). El único botón que
      // queda es «Ubicar» (hueco 1, arreglos-operador), que no toca el estado de preparación; contar 1 con ese
      // nombre conserva el candado de «ningún otro botón en la fila».
      await expect(pikachu.getByRole('button', { name: V('item.actionAria', { action: V('item.undo'), card: 'Pikachu', folio: 'INV-000113' }), exact: true })).toHaveCount(0);
      await expect(pikachu.getByRole('group')).toHaveCount(0);
      await expect(pikachu.getByRole('button')).toHaveCount(1);
      await expect(pikachu.getByRole('button', { name: t('es', 'admin.m4.prep.locate.actionAria', { folio: 'INV-000113' }), exact: true })).toHaveCount(1);
      await expect(page.getByTestId('prep-notice')).toContainText('314.58');

      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });

    test('«Por reponer»: la pestaña, el caso `rc-9001` y «Reponer con esta pieza»', async ({ page }) => {
      mockOnly('el caso `rc-9001` (retiro de Gary, dos candidatas) es del fixture');
      const errors = collectPageErrors(page);
      await page.goto('/es/admin/m4?tab=reponer');

      await expect(page.getByRole('tab', { name: /Por reponer/ })).toHaveAttribute('aria-selected', 'true');
      const caseCard = page.getByTestId('case-rc-9001');
      await expect(caseCard).toBeVisible();
      await expect(page.getByTestId('case-due-rc-9001')).toContainText(/Vence/);
      // PS-UI-11 sobre el vencido del fixture: «Vencido» en bermellón.
      await expect(page.getByTestId('case-due-rc-9002')).toContainText(/Vencido/);
      await expectNoHorizontalOverflow(page);

      await caseCard.getByRole('link', { name: R('viewCase') }).click();
      await expect(page).toHaveURL(/\/admin\/m4\/reponer\/rc-9001/);
      const candidate = page.getByTestId('candidate-inv-1250');
      await expect(candidate).toBeVisible();
      await candidate.getByRole('button', { name: R('action.replace') }).click();
      const dialog = page.getByRole('dialog', { name: R('confirmReplace.title', { folio: 'INV-000350' }) });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: R('confirmReplace.confirm') }).click();
      await expect(page.getByTestId('case-notice')).toContainText('INV-000350');
      await expect(page.getByTestId('case-notice')).toContainText(R('result.replacedCanShip'));

      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });

    test('«Por reponer»: «Reembolsar» (súper-admin) con las dos referencias y el reparto del servidor', async ({ page }) => {
      mockOnly('el reembolso del caso `rc-9001` corre sobre el fixture con estado');
      const errors = collectPageErrors(page);
      await page.goto('/es/admin/m4/reponer/rc-9001');

      await page.getByTestId('case-refund-cta').click();
      const dialog = page.getByRole('dialog', { name: R('refund.title') });
      await expect(dialog.getByTestId('case-refund-refs')).toContainText(/Pagó/);
      await dialog.getByTestId('case-refund-amount').fill('500');
      await dialog.getByTestId('case-refund-reason').fill('No hay pieza igual');
      await expect(dialog.getByTestId('case-refund-preview')).toContainText('500.00');
      await dialog.getByTestId('case-refund-submit').click();
      await expect(page.getByTestId('case-notice')).toContainText('500.00');
      await expect(page.getByTestId('case-refund-cta')).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });

    test('cubeta SPEI: revelar CLABE → «Marcar pagada»; la CLABE no está en el HTML antes ni después', async ({ page }) => {
      mockOnly('la transferencia `mr-1001` (Ana) es del fixture con estado');
      const errors = collectPageErrors(page);
      await page.goto('/es/admin/manual-refunds');

      await expect(page.getByTestId('mr-row-mr-1001')).toBeVisible();
      expect(await page.content()).not.toMatch(EIGHTEEN_DIGITS);
      await page.getByTestId('mr-row-mr-1001').getByRole('link', { name: MR('view') }).click();
      await expect(page).toHaveURL(/\/admin\/manual-refunds\/mr-1001/);
      expect(await page.content()).not.toMatch(EIGHTEEN_DIGITS);
      await expect(page.getByTestId('mr-paid-cta')).toHaveCount(0);

      await page.getByTestId('mr-reveal').click();
      const clabe = page.getByTestId('mr-clabe');
      await expect(clabe).toHaveText(/^\d{18}$/);
      await page.getByTestId('mr-spei-ref').fill('ABC123');
      await page.getByTestId('mr-paid-cta').click();
      const dialog = page.getByRole('dialog', { name: MR('paid.title') });
      await expect(dialog.getByRole('button', { name: t('es', 'common.cancel') })).toBeFocused();
      await dialog.getByTestId('mr-paid-confirm').click();

      await expect(page.getByTestId('mr-paid')).toContainText(MR('trackingKey', { ref: 'ABC123' }));
      await expect(page.getByTestId('mr-notice')).toContainText('Pagada');
      expect(await page.content()).not.toMatch(EIGHTEEN_DIGITS);

      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });

    test('M3 · «Reclamar» con casilla por carta (v1.80.6) y la confirmación física', async ({ page }) => {
      mockOnly('la compra reembolsada `ord-9004` (Vulpix en la caja de `shp-7007`) es del fixture con estado');
      const errors = collectPageErrors(page);
      await page.goto('/es/admin/m3/ord-9004');

      const pieces = page.getByTestId('m3-vault-pieces');
      await expect(pieces).toBeVisible();
      await expect(page.getByTestId('vault-piece-inv-1402')).toContainText(M3('state.in_packed_withdrawal'));
      await page.getByTestId('vault-piece-inv-1402').getByRole('button', { name: M3('reclaim.cta') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('m3-reclaim-confirm')).toBeDisabled();
      await dialog.getByTestId('m3-reclaim-unpacked').check();
      await dialog.getByLabel(M3('reclaim.note')).fill('La saqué de la caja en el mostrador');
      await dialog.getByTestId('m3-reclaim-confirm').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('m3-notice')).toContainText('volvió a la plataforma');
      await expect(page.getByTestId('vault-piece-inv-1402')).toContainText(M3('state.returnedPending'));

      // Confirmación física (`chargeback-inventory`): la pieza devuelta se marca «Recuperada».
      const form = page.getByTestId('m3-inventory-form');
      await expect(form).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  });
}
