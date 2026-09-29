import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly, skipIfSeedMissing } from './utils/auth';
import {
  P,
  V,
  card,
  custody,
  expectNoHorizontalOverflow,
  footer,
  markButton,
  openVaultBucket,
} from './utils/vault-placement';

/**
 * **«Para bóveda» y «Qué debe haber» (M4-VAULT) en un NAVEGADOR DE VERDAD** — `DESIGN_SYSTEM §36`,
 * contrato `§M4-VAULT`.
 *
 * ⭐ **Por qué existe, con la medición que lo motivó.** QA rechazó el stream sobre `db7d1c2` con un
 * bloqueante que **ningún candado de jsdom podía ver**: `vaults/[userId]/page.tsx` (servidor) llamaba
 * a `parseVaultDetailTab`, exportada desde un módulo `'use client'`. En el build de producción
 * **todo** render de `/admin/vaults/<userId>` caía en «Application error»: la pestaña «Qué debe
 * haber», el enlace de la tarjeta y —por H-6— también «Cartas» y «Sellado». vitest y tsc verdes.
 * El servidor de mocks de Playwright es `next build && next start` (ver `playwright.config.ts`),
 * así que estos casos SÍ ejercen esa frontera.
 *
 * Además no había NINGÚN spec de la tarjeta de bóveda: los PV-* vivían solo en jsdom, que no tiene
 * viewport ni layout (§36.12 pide 390×844 y 1280×800).
 *
 * Clasificación de gavetas:
 * - Los recorridos de la tarjeta son `mockOnly`: el seed real **no siembra** ninguna `VaultPlacement`
 *   (`backend/prisma/seed-e2e.ts` solo las borra) y los asertos siguen folios del fixture.
 * - La ruta del detalle tiene un caso `@real` **agnóstico**: descubre un cliente desde la lista de
 *   bóvedas y abre su `?tab=physical`. Es la prueba de la frontera servidor/cliente contra el stack.
 */

const VIEWPORTS = [
  { name: '390×844 (de pie)', size: { width: 390, height: 844 } },
  { name: '1280×800 (escritorio)', size: { width: 1280, height: 800 } },
] as const;

const VT = (key: string, vars?: Record<string, string | number>) => t('es', `admin.vaults.${key}`, vars);

/** Un render que cayó en el error boundary de Next no es una pantalla: se aserta que NO esté. */
async function expectNoAppError(page: Page, errors: string[]) {
  await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);
  expect(errors, `errores de página: ${errors.join(' | ')}`).toEqual([]);
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

for (const vp of VIEWPORTS) {
  test.describe(`admin · Para bóveda · ${vp.name}`, () => {
    test.use({ viewport: vp.size });

    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'admin');
    });

    /**
     * Palomear ⇒ preparado ⇒ deshacer ⇒ preparado ⇒ confirmar con cajón (§36.5–§36.8), sobre la
     * colocación de Ana (`vp-8001`): una ya tomada, una por palomear y una bloqueada.
     */
    test('palomear ⇒ preparado ⇒ deshacer ⇒ preparado ⇒ confirmar en su cajón', async ({ page }) => {
      mockOnly('el seed real no siembra VaultPlacement; el recorrido sigue la colocación `vp-8001` del fixture');
      const errors = collectPageErrors(page);
      await openVaultBucket(page);

      const c = card(page, 'vp-8001');
      const foot = footer(page, 'vp-8001');
      const step = page.getByTestId('vault-step-vp-8001');
      const prepare = foot.getByRole('button', { name: V('prepare.cta') });

      // Paso 1. PV-7: ni «Confirmar» ni «Deshacer preparado» todavía; ni un control de guía.
      await expect(step).toHaveText(V('step.collect'));
      await expect(foot.getByRole('button', { name: V('place.cta') })).toHaveCount(0);
      await expect(foot.getByRole('button', { name: V('unprepare.cta') })).toHaveCount(0);

      // PV-5: con una por palomear, «Pedido preparado» deshabilitado y su razón unida por aria-describedby.
      await expect(prepare).toBeDisabled();
      const reasonId = await prepare.getAttribute('aria-describedby');
      expect(reasonId, 'la razón de «deshabilitado» no está unida al botón').toBeTruthy();
      await expect(page.locator(`[id="${reasonId}"]`)).toBeVisible();

      // PV-6: la bloqueada no tiene botones de palomeo y dice por qué.
      const gyarados = page.getByTestId('prep-item-vpi-8001-3');
      await expect(gyarados).toHaveAttribute('data-prep-status', 'blocked');
      await expect(gyarados.getByRole('button')).toHaveCount(0);
      await expect(gyarados).toContainText(V('blockedReason.in_withdrawal'));

      // Palomear: la marca se pinta con lo que respondió el servidor (sin optimismo).
      await markButton(page, 'vp-8001', 'pick', 'Alakazam', 'INV-000202').click();
      await expect(page.getByTestId('prep-item-vpi-8001-2')).toHaveAttribute('data-prep-status', 'picked');
      await expect(prepare).toBeEnabled();
      await expect(prepare).not.toHaveAttribute('aria-describedby', /.+/);

      // ⇒ preparado: paso 2, el foco va a la línea de paso de ESTA tarjeta (§36.12).
      await prepare.click();
      await expect(step).toHaveText(V('step.place'));
      await expect(step).toBeFocused();
      await expect(markButton(page, 'vp-8001', 'undo', 'Alakazam', 'INV-000202')).toHaveCount(0);
      // Su cajón (existing_customer_vault): nombrado CON su zona (V3), sin selector.
      await expect(page.getByTestId('vault-summary-vp-8001')).toContainText(custody('C10-F01-S01'));
      await expect(c.getByRole('radio')).toHaveCount(0);

      // ⇒ deshacer: diálogo con foco inicial en «Cancelar» (PV-8).
      await foot.getByRole('button', { name: V('unprepare.cta') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: V('unprepare.cancel') })).toBeFocused();
      await dialog.getByRole('button', { name: V('unprepare.confirm') }).click();
      await expect(dialog).toHaveCount(0);
      await expect(step).toHaveText(V('step.collect'));
      await expect(page.getByTestId('vault-live-vp-8001')).toContainText(V('unprepare.done'));
      // PV-8: las marcas que había SIGUEN pintadas (el contrato las conserva).
      await expect(page.getByTestId('prep-item-vpi-8001-1')).toHaveAttribute('data-prep-status', 'picked');
      await expect(page.getByTestId('prep-item-vpi-8001-2')).toHaveAttribute('data-prep-status', 'picked');

      // ⇒ preparado otra vez ⇒ confirmar con cajón.
      await prepare.click();
      await expect(step).toHaveText(V('step.place'));
      await foot.getByRole('button', { name: V('place.cta') }).click();

      // La tarjeta SALE y el resultado queda en el aviso de la cola, con folio y cajón con zona.
      await expect(c).toHaveCount(0);
      const notice = page.getByTestId('prep-notice');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('TCG-000201');
      await expect(notice).toContainText(custody('C10-F01-S01'));
      await expectNoHorizontalOverflow(page);
      await expectNoAppError(page, errors);
    });

    /**
     * Bruno (`vp-8003`): ya preparado y con cartas en DOS cajones. PV-4: ningún radio marcado al
     * abrir; «Confirmar» no se puede pulsar hasta elegir; el resumen nombra el elegido con su zona.
     */
    test('dos cajones: no hay elección por defecto; confirmar exige elegir uno', async ({ page }) => {
      mockOnly('colocación `vp-8003` del fixture (dos cajones, ya preparada)');
      await openVaultBucket(page);
      const c = card(page, 'vp-8003');
      const foot = footer(page, 'vp-8003');

      await expect(c).toContainText(V('drawer.multipleTag'));
      const radios = c.getByRole('radio');
      await expect(radios).toHaveCount(2);
      for (const r of await radios.all()) await expect(r).not.toBeChecked();
      const confirm = foot.getByRole('button', { name: V('place.cta') });
      await expect(confirm).toBeDisabled();
      await expect(page.getByTestId('vault-summary-vp-8003')).toContainText(V('place.chooseFirst'));

      await c.getByRole('radio', { name: new RegExp(custody('C10-F01-S02')) }).check();
      await expect(page.getByTestId('vault-summary-vp-8003')).toContainText(custody('C10-F01-S02'));
      await confirm.click();
      await expect(c).toHaveCount(0);
      await expect(page.getByTestId('prep-notice')).toContainText(custody('C10-F01-S02'));
      await expectNoHorizontalOverflow(page);
    });

    /** «Ver qué debe haber en su bóveda» (§36.1, H-6): el enlace de la tarjeta llega a SU pestaña. */
    test('el enlace de la tarjeta abre «Qué debe haber» del cliente, y la ruta renderiza', async ({ page }) => {
      mockOnly('el cliente `u-777` y su colocación `vp-8001` son del fixture');
      const errors = collectPageErrors(page);
      await openVaultBucket(page);
      await card(page, 'vp-8001').getByRole('link', { name: V('seeWhatShouldBe') }).click();

      await expect(page).toHaveURL(/\/es\/admin\/vaults\/u-777\?tab=physical$/);
      await expect(page.getByRole('tab', { name: VT('detailTabs.physical') })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('physical-inventory')).toBeVisible();
      await expectNoAppError(page, errors);
    });
  });

  test.describe(`admin · Qué debe haber · ${vp.name}`, () => {
    test.use({ viewport: vp.size });

    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'admin');
    });

    /**
     * PV-11 en layout real: los grupos en el orden faltantes → sin ubicar → en su cajón → por
     * colocar → en un retiro, y el resumen con los cinco conteos. Entrada DIRECTA por URL: es la
     * petición que el servidor tiene que renderizar (la del defecto de db7d1c2).
     */
    test('abrir /admin/vaults/<id>?tab=physical: cabecera, cajón y grupos en orden', async ({ page }) => {
      mockOnly('el inventario físico de `u-777` es del fixture (`mockPhysicalInventory`)');
      const errors = collectPageErrors(page);
      const res = await page.goto('/es/admin/vaults/u-777?tab=physical');
      expect(res?.status(), 'el servidor no pudo renderizar la ruta').toBe(200);

      await expect(page.getByRole('tab', { name: VT('detailTabs.physical') })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('vault-detail-owner')).toContainText('Ana López');
      await expect(page.getByTestId('vault-detail-owner')).toContainText('ana@example.com');
      await expect(page.getByTestId('physical-drawer')).toContainText(custody('C10-F01-S01'));

      const order = ['missing', 'unlocated', 'in_drawer', 'pending_placement', 'in_withdrawal'];
      for (const g of order) {
        await expect(page.getByRole('heading', { name: new RegExp(`^${VT(`physical.group.${g}`)} \\(`) })).toBeVisible();
      }
      const seen = await page
        .locator('[data-testid^="physical-group-"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('physical-group-', '')));
      expect(seen, 'los grupos no salen en el orden de §36.11 (anomalías primero)').toEqual(order);
      await expect(page.locator('[data-testid="physical-counts"] [data-count]')).toHaveCount(6);
      // §36.17 / PV-13: el cierre del resumen no comparte sustantivo con la lista («a su nombre»).
      await expect(page.getByTestId('physical-counts')).toContainText('deben estar en bóveda');
      await expect(page.getByTestId('physical-counts')).not.toContainText('en total');
      await expect(page.getByTestId('physical-counts-help')).toBeVisible();

      // V3: toda ubicación va con su zona.
      await expect(page.getByTestId('physical-location-inv-pi-3')).toContainText(t('es', 'admin.m1.zone.customer_custody'));
      // Lectura pura: ni un botón dentro del panel.
      await expect(page.getByTestId('physical-inventory').getByRole('button')).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
      await expectNoAppError(page, errors);
    });

    /** Sin nombre (§36.4): la cabecera pinta la marca y el correo; ⛔ nunca el prefijo del correo como nombre. */
    test('cliente sin nombre: la cabecera nombra la ausencia y da el correo', async ({ page }) => {
      mockOnly('`u-780` es la cuenta `derived` del fixture');
      const errors = collectPageErrors(page);
      await page.goto('/es/admin/vaults/u-780?tab=physical');
      const owner = page.getByTestId('vault-detail-owner');
      await expect(owner).toContainText(V('nameMissing.tag'));
      await expect(owner).toContainText('jcsainz95@example.com');
      await expect(page.getByRole('heading', { level: 1, name: 'jcsainz95' })).toHaveCount(0);
      await expect(page.getByTestId('physical-owner')).toContainText(V('nameMissing.body'));
      await expectNoAppError(page, errors);
    });

    /** H-6: sin `?tab` cae en «Cartas», y «Sellado» también renderiza (regresión del mismo defecto). */
    test('sin ?tab abre «Cartas»; ?tab=sealed abre «Sellado»; un valor raro cae en «Cartas»', async ({ page }) => {
      mockOnly('el cliente `u-777` es del fixture');
      const errors = collectPageErrors(page);
      for (const [url, tab] of [
        ['/es/admin/vaults/u-777', 'cards'],
        ['/es/admin/vaults/u-777?tab=sealed', 'sealed'],
        ['/es/admin/vaults/u-777?tab=%3Cscript%3E', 'cards'],
      ] as const) {
        const res = await page.goto(url);
        expect(res?.status(), `${url} no renderizó`).toBe(200);
        await expect(page.getByRole('tab', { name: VT(`detailTabs.${tab}`) })).toHaveAttribute('aria-selected', 'true');
      }
      await expectNoAppError(page, errors);
    });
  });
}

/**
 * **@real, agnóstico al seed.** Descubre un cliente desde la lista de bóvedas y abre su «Qué debe
 * haber» por URL. No asierta contenido de fixture: asierta que la ruta RENDERIZA (200, pestaña
 * seleccionada, panel o su vacío) y que no cayó en el error boundary — que es exactamente lo que
 * rompió `db7d1c2` en el build de producción.
 */
test('@real admin · el detalle de bóveda renderiza por URL con ?tab=physical', async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAs(page, 'admin');
  await page.goto('/es/admin/vaults');
  const firstRow = page.locator('a[href*="/admin/vaults/"]').first();
  const hasRow = await firstRow
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  skipIfSeedMissing(!hasRow, 'ningún cliente con bóveda en la lista de `/admin/vaults`');
  const href = (await firstRow.getAttribute('href'))!;

  const res = await page.goto(`${href}?tab=physical`);
  expect(res?.status(), 'el servidor no pudo renderizar la ruta').toBe(200);
  await expect(page.getByRole('tab', { name: VT('detailTabs.physical') })).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByTestId('physical-inventory').or(page.getByRole('heading', { name: VT('physical.empty.title') })),
  ).toBeVisible();

  const res2 = await page.goto(href);
  expect(res2?.status()).toBe(200);
  await expect(page.getByRole('tab', { name: VT('detailTabs.cards') })).toHaveAttribute('aria-selected', 'true');
  await expectNoAppError(page, errors);
});

/**
 * Cierre SIN cajón a 390 px (§36.8, H-4): la única carta se marca «No la encontré», el pedido se
 * da por preparado y se cierra sin guardar nada. ⛔ No aparece selector de cajón (no hay qué
 * guardar), y la acción cabe en el ancho del operador de pie.
 */
test.describe('admin · Para bóveda · cierre sin cajón · 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('una carta faltante ⇒ preparado ⇒ «Cerrar pedido sin guardar nada», sin selector de cajón', async ({ page }) => {
    mockOnly('colocación `vp-8002` del fixture (cuenta sin nombre, cliente nuevo)');
    const errors = collectPageErrors(page);
    await loginAs(page, 'admin');
    await openVaultBucket(page);

    const c = card(page, 'vp-8002');
    const foot = footer(page, 'vp-8002');
    // §36.4 en la tarjeta: la ausencia se nombra, con el correo.
    await expect(page.getByTestId('prep-customer-vp-8002')).toContainText(V('nameMissing.tag'));

    await markButton(page, 'vp-8002', 'miss', 'Dragonite', 'INV-000204').click();
    await expect(page.getByTestId('prep-item-vpi-8002-1')).toHaveAttribute('data-prep-status', 'missing');
    await expect(foot).toContainText(V('prepare.nothingPicked'));
    await foot.getByRole('button', { name: V('prepare.cta') }).click();

    await expect(page.getByTestId('vault-step-vp-8002')).toHaveText(V('step.place'));
    // Sin cartas tomadas ⇒ ⛔ ni selector ni radios; el resumen dice que no se guarda nada.
    await expect(page.getByTestId('vault-choose-vp-8002')).toHaveCount(0);
    await expect(c.getByRole('radio')).toHaveCount(0);
    await expect(c.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByTestId('vault-summary-vp-8002')).toHaveText(V('place.summaryEmpty'));

    const close = foot.getByRole('button', { name: V('place.ctaEmpty') });
    await expect(close).toBeEnabled();
    const box = (await close.boundingBox())!;
    expect(box.x + box.width, 'la acción de cierre se sale del ancho de 390 px').toBeLessThanOrEqual(390);
    expect(box.height, 'objetivo táctil < 44 px (§36.12)').toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);

    await close.click();
    await expect(c).toHaveCount(0);
    await expect(page.getByTestId('prep-notice')).toContainText(V('result.nothingToPlace', { folio: 'TCG-000202' }));
    await expect(page.getByRole('heading', { name: P('title') })).toBeVisible();
    await expectNoAppError(page, errors);
  });
});
