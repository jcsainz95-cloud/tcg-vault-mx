import path from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { loginAs, mockOnly } from './utils/auth';
import { t } from './utils/i18n';

/**
 * UX-ALTA-LIGA (HECHOS 2026-11-05 «Alta de piezas de liga/español desde el binder: opción A»; contrato §IDS.9 IDS-F11;
 * DESIGN_SYSTEM §16.5 / IDS-UX.2) — el camino del dueño, de punta a punta en el navegador y en el simulador:
 * Inventario → Master Set → «Surging Sparks» → casilla «Pikachu ex» → «Alta rápida» → «Español» + «De liga · Prize Pack»
 * → crear ⇒ (a) la petición al lote lleva `language:'es'` y `cardProductId` del producto; (b) la pieza nueva aparece en la
 * lista con sus insignias «Español» y «De liga»; (c) el panel vuelve a «Inglés / Sin liga»; (d) a 390 px cada burbuja
 * mide ≥ 44 px y nada desborda. Además, los filtros de la lista van bajo «Piezas (n)» rotulados «Filtrar piezas».
 *
 * **A2 (contrato v1.116.8 I-6; IDS-F11 (a)–(e); vIDS-10):** tester-e2e RECHAZÓ sobre el stack real porque la liga sembrada
 * («E2E League Bird», `finishes={holofoil}`) no se podía dar de alta desde la casilla `normal` y sus piezas no se veían en
 * ninguna casilla. En el simulador esa carta es «Pawmi» (`c-pawmi-sv08`, casilla solo `normal`): «Promo de Liga» solo en
 * Holo (⇒ burbuja «De liga · Promo de Liga (Holo)», POST con `finish:'holofoil'`) y «Prize Pack» en Reverse Holo + Holo (⇒
 * fila «Acabado» sin preselección). Tras el alta la pieza de liga en Holo aparece en «Piezas (n)» de la casilla `normal`
 * con la pista «La casilla cuenta solo inglés sin liga…». Con español o liga, «Pagamos por pieza» abre vacío (d).
 *
 * Solo en mocks (`mockOnly`): en el simulador no hay red, así que el cuerpo del lote se lee de
 * `globalThis.__thMockLastBatchRequest` (lo expone `mockBatchCreate`, `lib/mock/fixtures.ts`).
 *
 * Fixture: en el binder admin del simulador la casilla «Pikachu ex» de Surging Sparks es `c-pikachu-ir` (#238, Holo), con
 * Prize Pack 648703 (con precio), Staff sin mercado y una candidata (que el alta rápida ya no dibuja). `c-ids-pikachu-057`
 * vive fuera de `mockCards` (solo en la tienda), así que no tiene casilla.
 */
const FIXTURE = 'binder admin del simulador: casilla «Pikachu ex» = c-pikachu-ir con Prize Pack 648703; «Pawmi» = c-pawmi-sv08 con ligas en otros acabados (mockCardVersions)';
const PRIZE_PACK_PRODUCT_ID = 648703;
const PAWMI_LEAGUE_PRODUCT_ID = 651001;
const PAWMI_PRIZE_PACK_PRODUCT_ID = 651002;
/** Capturas para el informe (`E2E_SHOT_DIR`), además de las del `outputPath` de Playwright. */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

interface BatchReq {
  batchKey: string;
  items: { cardId?: string; productType: string; finish?: string; language?: string; cardProductId?: number; qty?: number; acquisitionCostCents?: number }[];
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false });
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
}

/** Inventario → Master Set → Surging Sparks → casilla de la carta ⇒ el cajón de la variante. */
async function openDrawer(page: Page, cardName: RegExp) {
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m1');
  await page.getByLabel(t('es', 'masterSet.searchSet')).fill('Surging Sparks');
  await page.getByRole('button', { name: /Surging Sparks/ }).first().click();
  const grid = page.getByRole('list', { name: t('es', 'masterSet.binderGridLabel') });
  await expect(grid).toBeVisible();
  await grid.getByRole('button', { name: cardName }).first().click();
  const drawer = page.getByRole('dialog', { name: cardName });
  await expect(drawer).toBeVisible();
  return drawer;
}
const openPikachuDrawer = (page: Page) => openDrawer(page, /Pikachu ex/);
const openPawmiDrawer = (page: Page) => openDrawer(page, /Pawmi/);

/**
 * Abre el panel «Alta rápida» si no está ya abierto. Con 0 piezas el cajón lo abre SOLO cuando la lista resuelve, así que
 * primero se espera la lista (vacía o con filas): leer `aria-expanded` antes y hacer clic después lo cerraba (carrera
 * medida 3/9 el 2026-11-05).
 */
async function openQuickAdd(page: Page, drawer: Locator) {
  const button = drawer.getByRole('button', { name: t('es', 'admin.drawer.addQuick') });
  await expect(button).toBeVisible();
  await expect(drawer.getByText(t('es', 'admin.drawer.noPieces')).or(drawer.getByTestId('piece-version').first())).toBeVisible();
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const panel = drawer.getByRole('region', { name: t('es', 'admin.quickAdd.title') });
  await expect(panel).toBeVisible();
  // El CTA espera a `GET …/versions` (M-2): con el precio (auto) a la vista, ya resolvió.
  await expect(panel.getByTestId('ids-price')).toBeVisible();
  return panel;
}

/** «Pagamos por pieza»: la tarjeta «Comprar» es un `<label>` que envuelve al campo, así que `getByLabel` resuelve dos elementos. */
const buyInput = (panel: Locator) => panel.locator('input[inputmode="decimal"]');
const lastBatch = (page: Page) => page.evaluate(() => (globalThis as { __thMockLastBatchRequest?: BatchReq }).__thMockLastBatchRequest);

async function pillFacts(page: Page) {
  return page.evaluate(() => {
    const capture = document.querySelector('[data-testid="ids-capture"]');
    const pills = capture ? [...capture.querySelectorAll<HTMLElement>('[role="radio"]')] : [];
    return pills.map((p) => {
      const r = p.getBoundingClientRect();
      return { text: p.textContent, h: Math.round(r.height * 10) / 10, left: r.left, right: r.right, checked: p.getAttribute('aria-checked') };
    });
  });
}

async function expectPillsFit(page: Page, width: number, tag: string, checked: string[]) {
  const facts = await pillFacts(page);
  test.info().annotations.push({ type: tag, description: JSON.stringify(facts) });
  for (const p of facts) {
    expect(p.h, `alto ${p.text}`).toBeGreaterThanOrEqual(44);
    expect(p.left, `dentro ${p.text}`).toBeGreaterThanOrEqual(0);
    expect(p.right, `sin desborde ${p.text}`).toBeLessThanOrEqual(width);
  }
  expect(facts.filter((p) => p.checked === 'true').map((p) => p.text)).toEqual(checked);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  return facts;
}

for (const width of [390, 1280] as const) {
  test.describe(`Alta rápida con Idioma y Versión · ${width} px`, () => {
    test.use(
      width === 390
        ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width, height: 900 } },
    );

    test(`binder → casilla → Alta rápida → Español + De liga · Prize Pack ⇒ compra vacía (d); el lote lleva language y cardProductId; la pieza aparece con insignias; vuelve a Inglés/Sin liga`, async ({ page }) => {
      mockOnly(FIXTURE);
      const drawer = await openPikachuDrawer(page);
      const panel = await openQuickAdd(page, drawer);

      // Las dos filas van ANTES de Cantidad, sin fila de acabado (la casilla Holo está entre los de la liga, IDS-F11 c).
      const lang = panel.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.language') });
      const version = panel.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.version') });
      await expect(lang).toBeVisible();
      await expect(version).toBeVisible();
      await expect(panel.getByTestId('ids-finish')).toHaveCount(0);
      await expect(panel.getByTestId('ids-alta-finish')).toHaveCount(0);
      const order = await panel.evaluate((el) => {
        const capture = el.querySelector('[data-testid="ids-capture"]')!;
        const qty = el.querySelector('input[inputmode="numeric"]')!;
        return (capture.compareDocumentPosition(qty) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      });
      expect(order, 'Idioma/Versión antes de Cantidad').toBe(true);
      await expect(lang.getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
      await expect(version.getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
      // «Staff» sin mercado: apagada con su motivo.
      await expect(version.getByRole('radio', { name: 'Staff' })).toHaveAttribute('aria-disabled', 'true');
      // Sin caja de candidatas en el alta rápida (vIDS-10).
      await expect(panel.getByTestId('ids-candidates')).toHaveCount(0);
      // Inglés sin liga: «Pagamos por pieza» prellenado con el sugerido del binder.
      const prefilled = await buyInput(panel).inputValue();
      expect(prefilled, 'prellenado del inglés sin liga').not.toBe('');

      await lang.getByRole('radio', { name: 'Español' }).click();
      await version.getByRole('radio', { name: 'De liga · Prize Pack' }).click();
      // Precio del servidor (simulador: Prize Pack 48 000 × 75 % = 36 000) con su desglose.
      await expect(panel.getByTestId('ids-price')).toContainText('MX$360.00');
      await expect(panel.getByTestId('ids-breakdown')).toHaveText('Base: De liga · Prize Pack en inglés · MX$480.00 × 75 % (español)');
      // (d) Compra sin prellenar: vacío con su ayuda, y el CTA espera el precio.
      await expect(buyInput(panel)).toHaveValue('');
      await expect(panel.getByText(t('es', 'admin.quickAdd.buyNoSuggestionVersion'))).toBeVisible();
      await expect(panel.getByRole('button', { name: t('es', 'admin.quickAdd.cta') })).toBeDisabled();

      // Geometría real: cada burbuja ≥ 44 px y dentro del viewport; la página no desborda.
      const facts = await expectPillsFit(page, width, `quickadd-pills-${width}`, ['Español', 'De liga · Prize Pack']);
      expect(facts.length).toBeGreaterThanOrEqual(5);
      await shot(page, `quick-add-${width}`);

      // Crear con lo pagado.
      await buyInput(panel).fill('300');
      await panel.getByRole('button', { name: t('es', 'admin.quickAdd.cta') }).click();
      const status = panel.getByRole('status').filter({ hasText: 'Pieza dada de alta' });
      await expect(status).toContainText(/^Pieza dada de alta · Español · De liga · Prize Pack · INV-\d{6}\./);

      // (a) El cuerpo que viajó al lote (IDS-F11): `language:'es'` y `cardProductId` del producto, el acabado de la casilla, sin precio de venta.
      const req = await lastBatch(page);
      expect(req, 'el simulador registró la petición al lote').toBeTruthy();
      expect(req!.items).toHaveLength(1);
      expect(req!.items[0]).toMatchObject({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil', language: 'es', cardProductId: PRIZE_PACK_PRODUCT_ID, qty: 1, acquisitionCostCents: 30_000 });
      expect(req!.items[0]).not.toHaveProperty('listPriceCents');

      // (b) La pieza nueva, en la lista del cajón, con «Español» y «De liga».
      const folio = (await status.textContent())!.match(/INV-\d{6}/)![0];
      const pieces = drawer.getByRole('region', { name: /^Piezas \(\d+\)$/ });
      const row = pieces.locator('li', { hasText: folio }).first();
      await expect(row).toBeVisible();
      await expect(row.getByTestId('piece-version')).toHaveText('EspañolDe liga');
      // Pista del cajón: alguna fila no es inglés sin liga.
      await expect(pieces.getByText(t('es', 'admin.drawer.slotCountNote'))).toBeVisible();

      // (c) De vuelta a «Inglés / Sin liga», el precio del inglés sin liga y el prellenado de compra.
      await expect(lang.getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
      await expect(version.getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
      await expect(panel.getByTestId('ids-breakdown')).toContainText('Base: Sin liga en inglés');
      await expect(buyInput(panel)).toHaveValue(prefilled);

      // Los filtros de la lista: bajo «Piezas (n)», rotulados como filtro, y después del panel de alta.
      await expect(pieces.getByText(t('es', 'admin.drawer.filterPieces'))).toBeVisible();
      const filtersAfterPanel = await drawer.evaluate((el) => {
        const panelEl = el.querySelector('section[aria-label="Alta rápida"]')!;
        const filters = el.querySelector('[data-testid="piece-version-filters"]')!;
        const heading = [...el.querySelectorAll('h3')].find((h) => /^Piezas \(\d+\)$/.test(h.textContent ?? ''))!;
        const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        return after(panelEl, filters) && after(heading, filters);
      });
      expect(filtersAfterPanel).toBe(true);
    });

    test(`A2 (a)+(e): casilla normal → «De liga · Promo de Liga (Holo)» ⇒ POST con finish holofoil + cardProductId ⇒ la pieza en «Piezas (n)» con la pista`, async ({ page }) => {
      mockOnly(FIXTURE);
      const drawer = await openPawmiDrawer(page);
      await expect(drawer).toContainText('NORMAL');
      const panel = await openQuickAdd(page, drawer);
      const version = panel.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.version') });
      await expect(version.getByRole('radio')).toHaveText(['Sin liga', 'De liga · Promo de Liga (Holo)', 'De liga · Prize Pack']);
      const league = version.getByRole('radio', { name: 'De liga · Promo de Liga (Holo)' });
      await expect(league).not.toHaveAttribute('aria-disabled', 'true');
      await league.click();
      await expect(league).toHaveAttribute('aria-checked', 'true');
      // Un solo acabado ⇒ implícito: sin fila «Acabado»; precio y desglose de ese combo, con el acabado nombrado.
      await expect(panel.getByTestId('ids-alta-finish')).toHaveCount(0);
      await expect(panel.getByTestId('ids-price')).toContainText('MX$120.00');
      await expect(panel.getByTestId('ids-breakdown')).toHaveText('Base: De liga · Promo de Liga (Holo) en inglés · MX$120.00 (mercado de TCGplayer)');
      // (d) compra vacía con su ayuda.
      await expect(buyInput(panel)).toHaveValue('');
      await expect(panel.getByText(t('es', 'admin.quickAdd.buyNoSuggestionVersion'))).toBeVisible();
      await expectPillsFit(page, width, `pawmi-league-pills-${width}`, ['Inglés', 'De liga · Promo de Liga (Holo)']);
      await shot(page, `pawmi-league-holo-${width}`);

      await buyInput(panel).fill('95');
      await panel.getByRole('button', { name: t('es', 'admin.quickAdd.cta') }).click();
      const status = panel.getByRole('status').filter({ hasText: 'Pieza dada de alta' });
      await expect(status).toContainText(/^Pieza dada de alta · Inglés · De liga · Promo de Liga · INV-\d{6}\./);
      const req = await lastBatch(page);
      expect(req!.items).toHaveLength(1);
      expect(req!.items[0]).toMatchObject({ cardId: 'c-pawmi-sv08', productType: 'raw', finish: 'holofoil', cardProductId: PAWMI_LEAGUE_PRODUCT_ID, qty: 1, acquisitionCostCents: 9_500 });
      expect(req!.items[0]).not.toHaveProperty('language');
      expect(req!.items[0]).not.toHaveProperty('listPriceCents');

      // (e) La pieza (Holo, sin casilla en un binder solo `normal`) aparece en «Piezas (n)» de la casilla `normal`, con la pista.
      const folio = (await status.textContent())!.match(/INV-\d{6}/)![0];
      const pieces = drawer.getByRole('region', { name: /^Piezas \(\d+\)$/ });
      const row = pieces.locator('li', { hasText: folio }).first();
      await expect(row).toBeVisible();
      await expect(row.getByTestId('piece-version')).toHaveText('ENDe liga');
      await expect(pieces.getByRole('heading', { level: 3 })).toHaveText(/^Piezas \([1-9]\d*\)$/);
      const note = pieces.getByText(t('es', 'admin.drawer.slotCountNote'));
      await expect(note).toBeVisible();
      // La pista va bajo «Piezas (n)» y sobre «Filtrar piezas», y a 390 cabe sin truncar (≤ 2 líneas).
      const noteFacts = await note.evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
      expect(noteFacts.h).toBeLessThanOrEqual(noteFacts.lh * 2 + 1);
      await note.scrollIntoViewIfNeeded();
      await shot(page, `pawmi-drawer-note-${width}`);
      // «Liga: Sin liga» esconde la pieza; «Piezas (n)» no cambia; «Mostrando n de N» aparece.
      const heading = await pieces.getByRole('heading', { level: 3 }).textContent();
      await pieces.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.filter.stamp') }).getByRole('radio', { name: t('es', 'admin.m1.ids.filter.stampNo') }).click();
      await expect(row).toHaveCount(0);
      await expect(pieces.getByRole('heading', { level: 3 })).toHaveText(heading!);
      await expect(pieces.getByText(/^Mostrando \d+ de \d+$/)).toBeVisible();
    });

    test(`A2 (b): «De liga · Prize Pack» con dos acabados y ninguno el de la casilla ⇒ fila «Acabado» sin preselección, CTA apagado hasta elegir; con «Holo» el POST lleva holofoil`, async ({ page }) => {
      mockOnly(FIXTURE);
      const drawer = await openPawmiDrawer(page);
      const panel = await openQuickAdd(page, drawer);
      const version = panel.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.version') });
      await version.getByRole('radio', { name: 'De liga · Prize Pack' }).click();
      const finishRow = panel.getByRole('radiogroup', { name: t('es', 'admin.quickAdd.finish') });
      await expect(finishRow).toBeVisible();
      await expect(finishRow.getByRole('radio')).toHaveText(['Reverse Holo', 'Holo']);
      for (const r of await finishRow.getByRole('radio').all()) await expect(r).toHaveAttribute('aria-checked', 'false');
      await expect(panel.getByText(t('es', 'admin.quickAdd.finishHint'))).toBeVisible();
      await expect(panel.getByTestId('ids-price')).toContainText(t('es', 'admin.quickAdd.finishPricePending'));
      const cta = panel.getByRole('button', { name: t('es', 'admin.quickAdd.cta') });
      await expect(cta).toHaveAttribute('aria-disabled', 'true');
      // Fila Acabado entre Versión y el precio.
      const between = await panel.evaluate((el) => {
        const v = el.querySelector('[data-testid="ids-version"]')!;
        const f = el.querySelector('[data-testid="ids-alta-finish"]')!;
        const p = el.querySelector('[data-testid="ids-price"]')!;
        const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        return after(v, f) && after(f, p);
      });
      expect(between).toBe(true);
      await expectPillsFit(page, width, `pawmi-finish-pills-${width}`, ['Inglés', 'De liga · Prize Pack']);
      await shot(page, `pawmi-finish-row-${width}`);
      // Un clic en el CTA apagado no crea nada.
      await buyInput(panel).fill('120');
      await cta.click({ force: true });
      await page.waitForTimeout(300);
      expect(await lastBatch(page)).toBeUndefined();

      // `exact`: «Reverse Holo» también contiene «Holo».
      await finishRow.getByRole('radio', { name: 'Holo', exact: true }).click();
      await expect(panel.getByTestId('ids-price')).toContainText('MX$150.00');
      await expect(panel.getByTestId('ids-breakdown')).toHaveText('Base: De liga · Prize Pack (Holo) en inglés · MX$150.00 (mercado de TCGplayer)');
      await expect(cta).not.toHaveAttribute('aria-disabled', 'true');
      await cta.click();
      await expect(panel.getByRole('status').filter({ hasText: 'Pieza dada de alta' })).toContainText(/^Pieza dada de alta · Inglés · De liga · Prize Pack · INV-\d{6}\./);
      const req = await lastBatch(page);
      expect(req!.items[0]).toMatchObject({ cardId: 'c-pawmi-sv08', finish: 'holofoil', cardProductId: PAWMI_PRIZE_PACK_PRODUCT_ID, acquisitionCostCents: 12_000 });
      // Y la fila desaparece al volver a «Sin liga».
      await expect(panel.getByTestId('ids-alta-finish')).toHaveCount(0);
      await expect(version.getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
    });
  });
}

test('inglés sin liga (0 toques) ⇒ el lote va sin `language` ni `cardProductId` y el resumen es el de hoy', async ({ page }) => {
  mockOnly(FIXTURE);
  const drawer = await openPikachuDrawer(page);
  const panel = await openQuickAdd(page, drawer);
  await expect(panel.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.language') })).toBeVisible();
  await panel.getByRole('button', { name: t('es', 'admin.quickAdd.cta') }).click();
  const status = panel.getByRole('status').filter({ hasText: 'Pieza dada de alta' });
  await expect(status).toContainText(/^Pieza dada de alta · INV-\d{6}\./);
  const req = await lastBatch(page);
  expect(req!.items[0]).toMatchObject({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil' });
  expect(req!.items[0]).not.toHaveProperty('language');
  expect(req!.items[0]).not.toHaveProperty('cardProductId');
});
