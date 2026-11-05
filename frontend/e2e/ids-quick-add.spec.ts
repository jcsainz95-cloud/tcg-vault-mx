import { test, expect, type Page } from '@playwright/test';
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
 * Solo en mocks (`mockOnly`): en el simulador no hay red, así que el cuerpo del lote se lee de
 * `globalThis.__thMockLastBatchRequest` (lo expone `mockBatchCreate`, `lib/mock/fixtures.ts`).
 *
 * Fixture: en el binder admin del simulador la casilla «Pikachu ex» de Surging Sparks es `c-pikachu-ir` (#238, Holo), la
 * única carta de `mockCards` con productos de liga en `mockCardVersions` (Prize Pack 648703 con precio, Staff sin mercado
 * y una candidata). `c-ids-pikachu-057` vive fuera de `mockCards` (solo en la tienda), así que no tiene casilla.
 */
const FIXTURE = 'binder admin del simulador: casilla «Pikachu ex» = c-pikachu-ir con Prize Pack 648703 (mockCardVersions)';
const PRIZE_PACK_PRODUCT_ID = 648703;

interface BatchReq {
  batchKey: string;
  items: { cardId?: string; productType: string; finish?: string; language?: string; cardProductId?: number; qty?: number }[];
}

/** Inventario → Master Set → Surging Sparks → casilla «Pikachu ex» (Holo) ⇒ el cajón de la variante. */
async function openPikachuDrawer(page: Page) {
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m1');
  await page.getByLabel(t('es', 'masterSet.searchSet')).fill('Surging Sparks');
  await page.getByRole('button', { name: /Surging Sparks/ }).first().click();
  const grid = page.getByRole('list', { name: t('es', 'masterSet.binderGridLabel') });
  await expect(grid).toBeVisible();
  await grid.getByRole('button', { name: /Pikachu ex/ }).first().click();
  const drawer = page.getByRole('dialog', { name: /Pikachu ex/ });
  await expect(drawer).toBeVisible();
  return drawer;
}

/**
 * Abre el panel «Alta rápida» si no está ya abierto. Con 0 piezas el cajón lo abre SOLO cuando la lista resuelve, así que
 * primero se espera la lista (vacía o con filas): leer `aria-expanded` antes y hacer clic después lo cerraba (carrera
 * medida 3/9 el 2026-11-05).
 */
async function openQuickAdd(page: Page, drawer: ReturnType<Page['getByRole']>) {
  const button = drawer.getByRole('button', { name: t('es', 'admin.drawer.addQuick') });
  await expect(button).toBeVisible();
  await expect(drawer.getByText(t('es', 'admin.drawer.noPieces')).or(drawer.getByTestId('piece-version').first())).toBeVisible();
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const panel = drawer.getByRole('region', { name: t('es', 'admin.quickAdd.title') });
  await expect(panel).toBeVisible();
  return panel;
}

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

for (const width of [390, 1280] as const) {
  test.describe(`Alta rápida con Idioma y Versión · ${width} px`, () => {
    test.use(
      width === 390
        ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width, height: 900 } },
    );

    test(`binder → casilla → Alta rápida → Español + De liga · Prize Pack ⇒ el lote lleva language y cardProductId; la pieza aparece con insignias; vuelve a Inglés/Sin liga`, async ({ page }) => {
      mockOnly(FIXTURE);
      const drawer = await openPikachuDrawer(page);
      const panel = await openQuickAdd(page, drawer);

      // Las dos filas van ANTES de Cantidad, sin fila de acabado (lo fija la casilla).
      const lang = panel.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.language') });
      const version = panel.getByRole('radiogroup', { name: t('es', 'admin.m1.ids.version') });
      await expect(lang).toBeVisible();
      await expect(version).toBeVisible();
      await expect(panel.getByTestId('ids-finish')).toHaveCount(0);
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

      await lang.getByRole('radio', { name: 'Español' }).click();
      await version.getByRole('radio', { name: 'De liga · Prize Pack' }).click();
      // Precio del servidor (simulador: Prize Pack 48 000 × 75 % = 36 000) con su desglose.
      await expect(panel.getByTestId('ids-price')).toContainText('MX$360.00');
      await expect(panel.getByTestId('ids-breakdown')).toHaveText('Base: De liga · Prize Pack en inglés · MX$480.00 × 75 % (español)');

      // (d) Geometría real: cada burbuja ≥ 44 px y dentro del viewport; la página no desborda.
      const facts = await pillFacts(page);
      test.info().annotations.push({ type: `quickadd-pills-${width}`, description: JSON.stringify(facts) });
      expect(facts.length).toBeGreaterThanOrEqual(5);
      for (const p of facts) {
        expect(p.h, `alto ${p.text}`).toBeGreaterThanOrEqual(44);
        expect(p.left, `dentro ${p.text}`).toBeGreaterThanOrEqual(0);
        expect(p.right, `sin desborde ${p.text}`).toBeLessThanOrEqual(width);
      }
      expect(facts.filter((p) => p.checked === 'true').map((p) => p.text)).toEqual(['Español', 'De liga · Prize Pack']);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: test.info().outputPath(`quick-add-${width}.png`), fullPage: false });

      // Crear.
      await panel.getByRole('button', { name: t('es', 'admin.quickAdd.cta') }).click();
      const status = panel.getByRole('status').filter({ hasText: 'Pieza dada de alta' });
      await expect(status).toContainText(/^Pieza dada de alta · Español · De liga · Prize Pack · INV-\d{6}\./);

      // (a) El cuerpo que viajó al lote (IDS-F11): `language:'es'` y `cardProductId` del producto, sin precio.
      const req = await page.evaluate(() => (globalThis as { __thMockLastBatchRequest?: BatchReq }).__thMockLastBatchRequest);
      expect(req, 'el simulador registró la petición al lote').toBeTruthy();
      expect(req!.items).toHaveLength(1);
      expect(req!.items[0]).toMatchObject({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil', language: 'es', cardProductId: PRIZE_PACK_PRODUCT_ID, qty: 1 });
      expect(req!.items[0]).not.toHaveProperty('listPriceCents');

      // (b) La pieza nueva, en la lista del cajón, con «Español» y «De liga».
      const folio = (await status.textContent())!.match(/INV-\d{6}/)![0];
      const pieces = drawer.getByRole('region', { name: /^Piezas \(\d+\)$/ });
      const row = pieces.locator('li', { hasText: folio }).first();
      await expect(row).toBeVisible();
      await expect(row.getByTestId('piece-version')).toHaveText('EspañolDe liga');

      // (c) De vuelta a «Inglés / Sin liga» y el precio del inglés sin liga.
      await expect(lang.getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
      await expect(version.getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
      await expect(panel.getByTestId('ids-breakdown')).toContainText('Base: Sin liga en inglés');

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
  const req = await page.evaluate(() => (globalThis as { __thMockLastBatchRequest?: BatchReq }).__thMockLastBatchRequest);
  expect(req!.items[0]).toMatchObject({ cardId: 'c-pikachu-ir', productType: 'raw', finish: 'holofoil' });
  expect(req!.items[0]).not.toHaveProperty('language');
  expect(req!.items[0]).not.toHaveProperty('cardProductId');
});
