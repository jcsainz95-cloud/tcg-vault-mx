import { test, expect } from '@playwright/test';
import { IS_REAL, loginAs, realOnly } from './utils/auth';
import { apiAs, apiAsOk } from './utils/env';

/**
 * §IDS contra el STACK REAL (API_CONTRACT §IDS v1.116.2; IDS-F1, F2, F3 y F7). El seed sintético
 * (`backend/prisma/seed-e2e.ts`) no trae piezas en español ni productos de liga; esta prueba SIEMBRA lo que necesita por
 * la API de admin del contrato y lo deshace al terminar:
 *  - alta de UNA pieza raw NM `language: 'es'` de «E2E Pidgey» (`e2e-common`, referencia raw NM del seed), que nace
 *    publicada porque el inglés tiene mercado (`P(es)` = cuerpo único sobre `R_en × X`, IDS.2);
 *  - al final, baja por `error_captura` (`POST /admin/inventory/adjustments`) y el dial X de vuelta al valor LEÍDO.
 * Versiones de liga (`stamped`): este entorno no tiene salida a tcgcsv.com (ni barrido ni `attach` traen productos), así
 * que las SIEMBRA el seed (`E2E_IDS` de `backend/prisma/e2e-fixtures.ts`, sobre «E2E League Bird»): el bloque «liga
 * sembrada» de abajo las lee sin escribir nada.
 * Serie: el caso del dial (F7) mueve X y recalcula el español; los demás leen X.
 */

const CARD_NAME = 'E2E Pidgey';

interface Combo {
  finish: string;
  language: 'en' | 'es';
  stamp: unknown;
  previewPriceCents: number | null;
  baseReferenceMxnCents: number | null;
  appliedMarketPct: number | null;
}

const state: { cardId: string; pieceId: string | null; pct: number } = { cardId: '', pieceId: null, pct: 75 };

test.describe.configure({ mode: 'serial' });

test.describe('@real §IDS contra el stack sembrado', () => {
  test.beforeAll(async () => {
    if (!IS_REAL) return;
    const cards = await apiAsOk<{ data: { id: string; name: string }[] }>(
      'admin',
      'GET',
      `/buylist/cards?q=${encodeURIComponent(CARD_NAME)}&pageSize=10`,
    );
    const card = cards.data.find((c) => c.name === CARD_NAME);
    if (!card) throw new Error(`el seed no trae «${CARD_NAME}» (backend/prisma/e2e-fixtures.ts, e2e-common)`);
    state.cardId = card.id;
    const settings = await apiAsOk<{ spanishMarketPct?: number }>('admin', 'GET', '/admin/settings');
    if (typeof settings.spanishMarketPct !== 'number') throw new Error('el servidor no sirve spanishMarketPct (§IDS.7)');
    state.pct = settings.spanishMarketPct;
    const item = await apiAsOk<{ id: string; folio: string; status: string }>('admin', 'POST', '/admin/inventory/items', {
      cardId: card.id,
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'normal',
      language: 'es',
      acquisitionType: 'compra',
      acquisitionCostCents: 1000,
    });
    state.pieceId = item.id;
    if (item.status !== 'listed') {
      throw new Error(`la pieza española ${item.folio} nació «${item.status}»: sin precio (¿«${CARD_NAME}» sin mercado del inglés?)`);
    }
  });

  test.afterAll(async () => {
    if (state.pieceId) {
      const r = await apiAs('admin', 'POST', '/admin/inventory/adjustments', {
        reason: 'error_captura',
        inventoryItemId: state.pieceId,
        note: 'E2E §IDS: pieza en español dada de alta por la prueba, no existe físicamente',
      });
      if (r.status >= 300 && r.status !== 404 && r.status !== 422) {
        throw new Error(`no pude retirar la pieza ${state.pieceId}: ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
      }
    }
    const now = await apiAs<{ spanishMarketPct?: number }>('admin', 'GET', '/admin/settings');
    if (now.status === 200 && now.body?.spanishMarketPct !== state.pct) {
      await apiAsOk('admin', 'PUT', '/admin/settings', { spanishMarketPct: state.pct });
    }
  });

  test.beforeEach(() => realOnly('siembra y lee §IDS por la API del backend real'));

  test('@real IDS-F2: la faceta `languages` trae `es` y el catálogo ofrece «Español»; elegirlo filtra con la query del API', async ({ page }) => {
    const facets = await apiAsOk<{ languages?: string[]; stamped?: boolean }>('customer', 'GET', '/catalog/facets');
    expect(facets.languages, JSON.stringify(facets.languages)).toEqual(['en', 'es']);
    expect(typeof facets.stamped).toBe('boolean');
    await page.goto('/es/catalog');
    // Escritorio: el panel lateral está a la vista (el de < lg vive en un cajón, oculto).
    const filter = page.getByTestId('version-filter').filter({ visible: true });
    await filter.getByRole('button', { name: 'Español' }).click();
    await expect(page).toHaveURL(/[?&]language=es\b/);
    const tile = page.locator('main a[href*="/catalog/"]').filter({ hasText: CARD_NAME }).first();
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute('href', new RegExp(`/catalog/${state.cardId}\\?version=es$`));
    // «Cartas de liga y promos» solo con `stamped`: el seed no trae liga.
    await expect(filter.getByRole('button', { name: 'Cartas de liga y promos' })).toHaveCount(facets.stamped ? 1 : 0);
  });

  test('@real IDS-F3: la ficha pinta una burbuja por entrada de `versions[]` (en, es) y elegir «Español» cambia el precio', async ({ page }) => {
    const detail = await apiAsOk<{ versions: { optionKey: string; fromPriceCents: number }[] }>(
      'customer',
      'GET',
      `/catalog/cards/${state.cardId}`,
    );
    expect(detail.versions.map((v) => v.optionKey)).toEqual(['en', 'es']);
    await page.goto(`/es/catalog/${state.cardId}`);
    const group = page.getByRole('radiogroup', { name: 'IDIOMA Y VERSIÓN' });
    await expect(group).toBeVisible();
    const pills = group.locator('[data-testid="version-pill"]');
    await expect(pills).toHaveCount(2);
    expect(await pills.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.optionKey))).toEqual(['en', 'es']);
    await expect(pills.nth(0)).toHaveAttribute('aria-checked', 'true');
    await pills.nth(1).click();
    await expect(pills.nth(1)).toHaveAttribute('aria-checked', 'true');
    const es = detail.versions.find((v) => v.optionKey === 'es')!;
    const price = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })
      .format(es.fromPriceCents / 100)
      .replace('$', 'MX$');
    await expect(pills.nth(1)).toContainText(price);
  });

  test('@real IDS-F1: el desglose de captura pinta la base y el % DEL COMBO del servidor', async ({ page }) => {
    const v = await apiAsOk<{ combos: Combo[] }>('admin', 'GET', `/admin/inventory/cards/${state.cardId}/versions`);
    const en = v.combos.find((c) => c.finish === 'normal' && c.language === 'en' && c.stamp == null)!;
    const es = v.combos.find((c) => c.finish === 'normal' && c.language === 'es' && c.stamp == null)!;
    expect(en.appliedMarketPct).toBeNull();
    expect(es.appliedMarketPct).toBe(state.pct);
    expect(es.baseReferenceMxnCents).toBe(en.baseReferenceMxnCents);
    expect(es.baseReferenceMxnCents, 'el seed da mercado raw NM a «E2E Pidgey»').not.toBeNull();
    const fmt = (c: number) =>
      new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(c / 100).replace('$', 'MX$');

    await loginAs(page, 'admin');
    await page.goto('/es/admin/m1');
    await page.getByRole('button', { name: 'Alta por lote' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Buscar carta').fill(CARD_NAME);
    await dialog.getByRole('button', { name: 'Buscar', exact: true }).click();
    await dialog.getByRole('option', { name: new RegExp(CARD_NAME) }).first().click();
    const breakdown = dialog.getByTestId('ids-breakdown');
    await expect(breakdown).toHaveText(`Base: Sin liga en inglés · ${fmt(en.baseReferenceMxnCents!)} (mercado de TCGplayer)`);
    await dialog.getByRole('radiogroup', { name: 'Idioma' }).getByRole('radio', { name: 'Español' }).click();
    await expect(breakdown).toHaveText(`Base: Sin liga en inglés · ${fmt(es.baseReferenceMxnCents!)} × ${state.pct} % (español)`);
    await expect(dialog.getByTestId('ids-price')).toContainText(fmt(es.previewPriceCents!));
  });

  test('@real IDS-F7: M10 lee el dial, lo guarda como entero y deja una entrada nueva `settings.update` en la bitácora', async ({ page }) => {
    const next = state.pct === 200 ? 199 : state.pct + 1;
    // La lista de la bitácora no trae antes/después (contrato §M10: `AuditLogDTO` sin `before`/`after`); el antes → después
    // del dial lo afirma backend (IDS-B4). Aquí: el guardado desde la pantalla deja UNA entrada nueva del super_admin.
    type Log = { data: { id: string; action: string; actorRole: string | null }[] };
    const logPath = '/admin/audit-log?action=settings.update&pageSize=20';
    const seen = new Set((await apiAsOk<Log>('admin', 'GET', logPath)).data.map((e) => e.id));
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m10');
    const section = page.getByTestId('m10-spanish-market');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Precio del español (% del inglés)');
    const input = section.getByLabel('Porcentaje del inglés');
    await expect(input).toHaveValue(String(state.pct));
    await input.fill('0');
    await expect(section.getByTestId('m10-spanish-market-save')).toBeDisabled();
    await input.fill(String(next));
    await section.getByTestId('m10-spanish-market-save').click();
    await expect(section.getByRole('status')).toContainText('Guardado');
    const after = await apiAsOk<{ spanishMarketPct: number }>('admin', 'GET', '/admin/settings');
    expect(after.spanishMarketPct).toBe(next);
    const fresh = (await apiAsOk<Log>('admin', 'GET', logPath)).data.filter((e) => !seen.has(e.id));
    expect(fresh, JSON.stringify(fresh)).toHaveLength(1);
    expect(fresh[0].actorRole).toBe('super_admin');
    // Restaura por la misma pantalla (el `afterAll` lo garantiza por API si esto falla).
    await input.fill(String(state.pct));
    await section.getByTestId('m10-spanish-market-save').click();
    await expect.poll(async () => (await apiAsOk<{ spanishMarketPct: number }>('admin', 'GET', '/admin/settings')).spanishMarketPct).toBe(state.pct);
  });
});


/**
 * §IDS — versiones de LIGA contra el stack sembrado (API_CONTRACT §IDS.5 v1.116.3; IDS-F2/F3 con producto `stamped`).
 * Escrita por backend junto con la siembra que la alimenta (`E2E_IDS`, backend/prisma/e2e-fixtures.ts); es la otra mitad del
 * mismo seed. Solo LEE: no da de alta piezas ni mueve diales.
 * Espejo del fixture (si cambia allí, cambia aquí): carta «E2E League Bird», producto `620000001` League Cup en `holofoil`,
 * piezas `(en, P)`, `(es, P)` y `(es, null)` `normal`; candidata sin colgar `620000002`.
 */
const LEAGUE = { name: 'E2E League Bird', productId: 620000001, finish: 'holofoil', candidateId: 620000002 } as const;
const LEAGUE_EN = `en.${LEAGUE.productId}.${LEAGUE.finish}`;
const LEAGUE_ES = `es.${LEAGUE.productId}.${LEAGUE.finish}`;

interface VersionOption {
  optionKey: string;
  version: { key: string; language: 'en' | 'es'; stamp: { type: string; label: string | null; productId: number } | null };
  finishLabel: string | null;
  fromPriceCents: number;
  stockCount: number;
}

test.describe('@real §IDS liga sembrada (E2E_IDS)', () => {
  const league = { cardId: '' };

  test.beforeAll(async () => {
    if (!IS_REAL) return;
    const cards = await apiAsOk<{ data: { id: string; name: string }[] }>(
      'admin',
      'GET',
      `/buylist/cards?q=${encodeURIComponent(LEAGUE.name)}&pageSize=10`,
    );
    const card = cards.data.find((c) => c.name === LEAGUE.name);
    if (!card) throw new Error(`el seed no trae «${LEAGUE.name}» (backend/prisma/e2e-fixtures.ts, E2E_IDS)`);
    league.cardId = card.id;
  });

  test.beforeEach(() => realOnly('lee las versiones de liga que siembra backend/prisma/seed-e2e.ts'));

  test('@real IDS-L1: la ficha trae la fila sin liga y la fila «De liga» del producto sembrado, y la pinta en 2×N', async ({ page }) => {
    const detail = await apiAsOk<{ versions: VersionOption[] }>('customer', 'GET', `/catalog/cards/${league.cardId}`);
    // Orden del servidor (§IDS.5): sin liga (`es`; no hay inglesa sin liga) y luego la fila de liga, `en` antes que `es`.
    expect(detail.versions.map((v) => v.optionKey)).toEqual(['es', LEAGUE_EN, LEAGUE_ES]);
    const [base, ligaEn, ligaEs] = detail.versions;
    expect(base.version.stamp).toBeNull();
    expect(base.finishLabel).toBe('non_holo');
    for (const v of [ligaEn, ligaEs]) {
      expect(v.version.stamp, v.optionKey).toEqual({ type: 'league', label: null, productId: LEAGUE.productId });
      expect(v.finishLabel).toBe('holo');
      expect(v.stockCount).toBeGreaterThanOrEqual(1);
    }
    // Precio por versión (§IDS.2): la española de liga = la de su producto × X ⇒ distinta (y menor) que la inglesa de liga.
    expect(ligaEs.fromPriceCents).toBeLessThan(ligaEn.fromPriceCents);

    await page.goto(`/es/catalog/${league.cardId}`);
    const group = page.getByRole('radiogroup', { name: 'IDIOMA Y VERSIÓN' });
    await expect(group).toBeVisible();
    await expect(page.getByTestId('version-pills')).toHaveAttribute('data-form', '2xN');
    const pills = group.locator('[data-testid="version-pill"]');
    await expect(pills).toHaveCount(3);
    expect(await pills.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.optionKey))).toEqual(['es', LEAGUE_EN, LEAGUE_ES]);
    await expect(page.getByTestId('version-row-label')).toHaveText(['Sin liga · No holo', 'De liga · Promo de la Liga · Holo']);
    const pillEn = group.locator(`[data-option-key="${LEAGUE_EN}"]`);
    await pillEn.click();
    await expect(pillEn).toHaveAttribute('aria-checked', 'true');
    const price = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })
      .format(ligaEn.fromPriceCents / 100)
      .replace('$', 'MX$');
    await expect(pillEn).toContainText(price);
  });

  test('@real IDS-L2: la faceta `stamped` ofrece «Cartas de liga y promos» y el filtro deja solo las tejas de liga', async ({ page }) => {
    const facets = await apiAsOk<{ stamped?: boolean }>('customer', 'GET', '/catalog/facets');
    expect(facets.stamped).toBe(true);
    const onlyLiga = await apiAsOk<{ data: { card: { id: string }; version: VersionOption['version']; versionOptionKey: string }[] }>(
      'customer',
      'GET',
      '/catalog/cards?stamped=true&pageSize=100',
    );
    expect(onlyLiga.data.length).toBeGreaterThan(0);
    for (const row of onlyLiga.data) expect(row.version.stamp, row.versionOptionKey).not.toBeNull();
    const mine = onlyLiga.data.filter((r) => r.card.id === league.cardId).map((r) => r.versionOptionKey).sort();
    expect(mine).toEqual([LEAGUE_EN, LEAGUE_ES]);

    await page.goto('/es/catalog');
    const filter = page.getByTestId('version-filter').filter({ visible: true });
    await filter.getByRole('button', { name: 'Cartas de liga y promos' }).click();
    await expect(page).toHaveURL(/[?&]stamped=true\b/);
    const tiles = page.locator(`main a[href*="/catalog/${league.cardId}?version="]`);
    await expect(tiles).toHaveCount(2);
    const hrefs = (await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))).map((h) => h.split('?version=')[1]).sort();
    expect(hrefs).toEqual([LEAGUE_EN, LEAGUE_ES]);
    // La teja sin liga de la misma carta (`?version=es`) queda fuera del filtro.
    await expect(page.locator(`main a[href$="/catalog/${league.cardId}?version=es"]`)).toHaveCount(0);
  });

  test('@real IDS-L3: la captura de la carta lista la candidata sin colgar y el producto colgado con su precio', async () => {
    const v = await apiAsOk<{ combos: Combo[]; candidates: { tcgplayerProductId: number }[] }>(
      'admin',
      'GET',
      `/admin/inventory/cards/${league.cardId}/versions`,
    );
    expect(v.candidates.map((c) => c.tcgplayerProductId)).toEqual([LEAGUE.candidateId]);
    const ligaEn = v.combos.find((c) => c.language === 'en' && (c.stamp as { productId?: number } | null)?.productId === LEAGUE.productId);
    expect(ligaEn, JSON.stringify(v.combos)).toBeDefined();
    expect(ligaEn!.finish).toBe(LEAGUE.finish);
    expect(ligaEn!.previewPriceCents).not.toBeNull();
  });
});
