import { test, expect } from '@playwright/test';
import { IS_REAL, loginAs, realOnly } from './utils/auth';
import { apiAs, apiAsOk } from './utils/env';
import { t } from './utils/i18n';

/**
 * §IDS contra el STACK REAL (API_CONTRACT §IDS v1.116.2; IDS-F1, F2, F3, F4 y F7). El fichero entero es solo-real (un
 * `beforeEach` de fichero): siembra y lee por la API del backend, que en la corrida de mocks no existe.
 * Bloque «E2E Pidgey»: el seed sintético (`backend/prisma/seed-e2e.ts`) no trae una pieza en español de esa carta; esta
 * prueba SIEMBRA lo que necesita por la API de admin del contrato y lo deshace al terminar:
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

test.beforeEach(() => realOnly('siembra y lee §IDS por la API del backend real (en mocks no hay backend)'));

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
    // «Cartas de liga y promos» solo con `stamped` (el seed la trae: «E2E League Bird», bloque de abajo).
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
 * §IDS — versiones de LIGA contra el stack sembrado (API_CONTRACT §IDS.5 v1.116.3; IDS-F2/F3/F4 con producto `stamped`).
 * IDS-L1…L3 los escribió backend (9500e70e, 1e665e49) junto con la siembra que los alimenta (`E2E_IDS`,
 * backend/prisma/e2e-fixtures.ts); frontend los adopta como suyos (revisados el 2026-11-03: leen la API y la pantalla
 * sin escribir nada). IDS-L4 (carrito → quote → checkout) es de frontend. Ninguno da de alta piezas ni mueve diales.
 * Espejo del fixture (si cambia allí, cambia aquí): carta «E2E League Bird», producto `620000001` League Cup en `holofoil`,
 * piezas `(en, P)`, `(es, P)` y `(en, null)`/`(es, null)` `normal`; candidata sin colgar `620000002`.
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

  test('@real IDS-L1: la ficha trae la fila sin liga y la fila «De liga» del producto sembrado, y la pinta en 2×N', async ({ page }) => {
    const detail = await apiAsOk<{ versions: VersionOption[] }>('customer', 'GET', `/catalog/cards/${league.cardId}`);
    // Orden del servidor (§IDS.5): sin liga `en`, `es`; luego la fila de liga, `en` antes que `es` (la forma de IDS-B8).
    expect(detail.versions.map((v) => v.optionKey)).toEqual(['en', 'es', LEAGUE_EN, LEAGUE_ES]);
    const [baseEn, baseEs, ligaEn, ligaEs] = detail.versions;
    for (const v of [baseEn, baseEs]) {
      expect(v.version.stamp, v.optionKey).toBeNull();
      expect(v.finishLabel).toBe('non_holo');
    }
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
    await expect(pills).toHaveCount(4);
    expect(await pills.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.optionKey))).toEqual(['en', 'es', LEAGUE_EN, LEAGUE_ES]);
    // Sin `?version=` ⇒ preselección `en` (D-IDS-4).
    await expect(group.locator('[data-option-key="en"]')).toHaveAttribute('aria-checked', 'true');
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
    // Cada teja lleva DOS enlaces a la ficha (imagen y nombre): se comparan las versiones DISTINTAS enlazadas.
    const links = page.locator(`main a[href*="/catalog/${league.cardId}?version="]`);
    await expect
      .poll(async () => [...new Set(await links.evaluateAll((els) => els.map((e) => (e.getAttribute('href') ?? '').split('?version=')[1])))].sort())
      .toEqual([LEAGUE_EN, LEAGUE_ES]);
    await expect(links.filter({ hasText: LEAGUE.name }).filter({ visible: true })).toHaveCount(2);
    // Las tejas sin liga de la misma carta (`en` con enlace llano, `?version=es`) quedan fuera del filtro.
    await expect(page.locator(`main a[href$="/catalog/${league.cardId}"]`)).toHaveCount(0);
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

  // IDS-F4 (criterios 518 y 964) + petición 8 de ux-ui contra el stack: tres piezas de la carta de liga al carrito desde la
  // ficha (`?version=` preselecciona y «Agregar» toma la pieza de ESA versión) ⇒ `POST /checkout/quote` trae `version` y
  // `finishLabel` por línea y cada precio = `fromPriceCents` de su versión ⇒ el checkout pinta cada línea con sus insignias
  // y la línea muted sin repetir el idioma (IDS-UX.4 «Carrito»). Solo cotiza: no crea sesión ni aparta piezas.
  test('@real IDS-L4: carrito con versiones ⇒ quote con `version`/`finishLabel` y precio de su versión ⇒ checkout con insignias sin «Español» repetido', async ({ page }) => {
    const detail = await apiAsOk<{ versions: VersionOption[] }>('customer', 'GET', `/catalog/cards/${league.cardId}`);
    const byKey = new Map(detail.versions.map((v) => [v.optionKey, v]));
    const picks = ['es', LEAGUE_EN, LEAGUE_ES].map((k) => {
      const v = byKey.get(k);
      if (!v || v.stockCount < 1) throw new Error(`«${LEAGUE.name}» sin existencia en ${k}: ${JSON.stringify(detail.versions)}`);
      return v;
    });

    await loginAs(page, 'customer');
    for (const v of picks) {
      await page.goto(`/es/catalog/${league.cardId}?version=${encodeURIComponent(v.optionKey)}`);
      const pill = page.locator(`[data-testid="version-pill"][data-option-key="${v.optionKey}"]`);
      await expect(pill).toHaveAttribute('aria-checked', 'true');
      const cta = page.getByTestId('instance-cta').first();
      await expect(cta).toHaveText(t('es', 'catalog.addToCart'));
      await cta.click();
      await expect(cta).toHaveText(t('es', 'catalog.viewCart'));
    }

    const quoteP = page.waitForResponse((r) => r.url().endsWith('/checkout/quote') && r.request().method() === 'POST');
    await page.goto('/es/checkout');
    const quote = await quoteP;
    expect(quote.status()).toBe(200);
    const body = (await quote.json()) as {
      items: { inventoryItemId: string; version: VersionOption['version']; finishLabel: string; unitPriceCents: number }[];
    };
    test.info().annotations.push({ type: 'IDS-L4 quote', description: JSON.stringify(body.items) });
    expect(body.items).toHaveLength(3);
    for (const v of picks) {
      const line = body.items.find((i) => i.version?.key === v.version.key && i.finishLabel === v.finishLabel);
      expect(line, `${v.optionKey} en el quote: ${JSON.stringify(body.items)}`).toBeDefined();
      expect(line!.version).toEqual(v.version);
      expect(line!.unitPriceCents, `precio de ${v.optionKey}`).toBe(v.fromPriceCents);
    }

    // Pantalla (IDS-UX.4 «Carrito», petición 8): ES sin liga = «Español» sin línea; EN de liga = «De liga» + «De liga
    // (promo de la Liga)»; ES de liga = «Español» + «De liga» + «De liga (promo de la Liga)». Nunca «Español» dos veces.
    // El checkout muestra 2 líneas y «Ver N más» (CheckoutLines VISIBLE_LINES): se despliegan para leer las tres.
    await page.getByRole('button', { name: t('es', 'checkout.showMoreLines', { n: 1 }) }).click();
    const lines = page.getByRole('main').getByRole('listitem').filter({ hasText: LEAGUE.name });
    await expect(lines).toHaveCount(3);
    const facts = await lines.evaluateAll((els) =>
      els.map((li) => ({
        chips: li.querySelector('[data-testid="line-version-chips"]')?.textContent ?? null,
        text: li.querySelector('[data-testid="line-version-text"]')?.textContent ?? null,
        spanish: (li.textContent ?? '').split('Español').length - 1,
      })),
    );
    test.info().annotations.push({ type: 'IDS-L4 checkout', description: JSON.stringify(facts) });
    const long = t('es', 'versionDetail.long.league');
    expect(facts.map((f) => `${f.chips}|${f.text}`).sort()).toEqual(
      [`De liga|${long}`, 'Español|null', `EspañolDe liga|${long}`].sort(),
    );
    for (const f of facts) expect(f.spanish, JSON.stringify(f)).toBeLessThanOrEqual(1);
  });
});

/**
 * §IDS.6 — Meta deck con versión contra el stack sembrado (criterios 963–966; IDS-UX.5 y petición 9a). Lee
 * `E2E_IDS.metaDeck` (`backend/prisma/e2e-fixtures.ts`, fijado por `backend/test/integration/ids-seed-deck.e2e-spec.ts`):
 * deck PUBLICADO `e2e-ids-deck-liga` con UNA línea de 3 × «E2E League Bird»; con las cuatro piezas de `E2E_IDS` el surtido
 * da 3 tramos: las dos sin liga (`en`, `es`, por precio) y la de liga al final (solo entra porque no alcanzan las sin liga).
 * Espejo del fixture (si cambia allí, cambia aquí). Solo cotiza: no crea sesión de pago ni aparta piezas.
 * Fuera: 967 (el deck sembrado no trae energías ni paquete) y 968 (el seed no trae una pieza sin precio de esta carta).
 */
const DECK = { slug: 'e2e-ids-deck-liga', quantity: 3, card: LEAGUE.name } as const;

interface DeckUnit {
  version: VersionOption['version'];
  qty: number;
  unitPriceMxnCents: number;
  inventoryItemIds: string[];
}
interface DeckLine {
  quantity: number;
  matchStatus: string;
  card: { cardId: string; name: string } | null;
  availableQty: number;
  unitPriceMxnCents: number | null;
  unitInventoryItemIds: string[];
  units: DeckUnit[];
}

test.describe('@real §IDS.6 Meta deck con versión (E2E_IDS.metaDeck)', () => {
  const mxn = (c: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(c / 100).replace('$', 'MX$');
  const lang = (l: 'en' | 'es') => t('es', `version.language.${l}`);
  /** Texto de las insignias de un tramo: «Español» si es español, y el nombre del tipo si es de liga (nunca «Inglés»). */
  const chipText = (u: DeckUnit) =>
    `${u.version.language === 'es' ? lang('es') : ''}${u.version.stamp ? t('es', `version.chip.${u.version.stamp.type}`) : ''}`;

  test('@real IDS-D1: la línea surte sin liga primero y la de liga al final, cada tramo con su insignia, y «de jalón» cotiza cada versión a su precio', async ({ page }) => {
    const deck = await apiAsOk<{ groups: { pokemon: DeckLine[]; trainer: DeckLine[]; energy: DeckLine[] } }>(
      'customer',
      'GET',
      `/decks-meta/${DECK.slug}`,
    );
    const all = [...deck.groups.pokemon, ...deck.groups.trainer, ...deck.groups.energy];
    expect(all, JSON.stringify(all)).toHaveLength(1);
    const [line] = all;
    expect(line.card?.name).toBe(DECK.card);
    expect(line.quantity).toBe(DECK.quantity);
    // 963: cuentan las tres piezas (inglesa, española y de liga).
    expect(line.availableQty).toBe(3);
    // 966 / P-IDS-12: sin liga primero (por precio ascendente), la de liga al final.
    expect(line.units.map((u) => [u.version.stamp != null, u.qty]), JSON.stringify(line.units)).toEqual([
      [false, 1],
      [false, 1],
      [true, 1],
    ]);
    expect(line.units.slice(0, 2).map((u) => u.version.key).sort()).toEqual(['en', 'es']);
    expect(line.units[0].unitPriceMxnCents).toBeLessThanOrEqual(line.units[1].unitPriceMxnCents);
    expect(line.units[2].version.stamp).toEqual({ type: 'league', label: null, productId: LEAGUE.productId });
    // 965: el precio de la línea es el de la pieza que agrega su botón (la primera); `units[]` parte `unitInventoryItemIds`.
    expect(line.unitPriceMxnCents).toBe(line.units[0].unitPriceMxnCents);
    expect(line.units.flatMap((u) => u.inventoryItemIds)).toEqual(line.unitInventoryItemIds);

    await loginAs(page, 'customer');
    await page.goto(`/es/decks-meta/${DECK.slug}`);
    // 964 + IDS-UX.5: línea mixta = un tramo por versión en el orden del servidor; inglés sin liga como TEXTO (sin
    // insignia), los demás con sus insignias; ninguno repite «Español» (petición 9a).
    const version = page.getByTestId('deck-line-version');
    await expect(version).toBeVisible();
    const tramos = version.getByTestId('deck-unit-tramo');
    await expect(tramos).toHaveCount(3);
    await expect(tramos).toHaveText(
      line.units.map((u) => `${u.version.key === 'en' ? lang('en') : chipText(u)}×${u.qty} · ${mxn(u.unitPriceMxnCents)}`),
    );
    const facts = await tramos.evaluateAll((els) =>
      els.map((li) => ({
        chips: li.querySelector('[data-testid="deck-version-chips"]')?.textContent ?? null,
        spanish: (li.textContent ?? '').split('Español').length - 1,
      })),
    );
    test.info().annotations.push({ type: 'IDS-D1 tramos', description: JSON.stringify(facts) });
    line.units.forEach((u, i) => {
      expect(facts[i].chips, `${u.version.key}: el inglés sin liga va sin insignia`).toBe(u.version.key === 'en' ? null : chipText(u));
      expect(facts[i].spanish, JSON.stringify(facts[i])).toBeLessThanOrEqual(1);
    });
    // Ni la palabra «sello» en superficie de cliente (IDS-UX.6 candado 5).
    await expect(version).not.toContainText('sello');
    // La línea muestra el precio de la pieza que agrega su botón (965).
    await expect(page.getByTestId('deck-line-price')).toHaveText(mxn(line.unitPriceMxnCents!));

    // 963/965: «Agregar de jalón» mete las tres; el quote cobra cada pieza al precio de SU versión (calculado en el servidor).
    const addAll = page.getByRole('button', { name: t('es', 'decksMeta.addAll.button') });
    await addAll.click();
    await expect(addAll).toBeDisabled();
    const quoteP = page.waitForResponse((r) => r.url().endsWith('/checkout/quote') && r.request().method() === 'POST');
    await page.goto('/es/checkout');
    const quote = await quoteP;
    expect(quote.status()).toBe(200);
    const body = (await quote.json()) as {
      items: { inventoryItemId: string; version: VersionOption['version']; unitPriceCents: number }[];
    };
    test.info().annotations.push({ type: 'IDS-D1 quote', description: JSON.stringify(body.items) });
    expect(body.items.map((i) => i.inventoryItemId).sort()).toEqual([...line.unitInventoryItemIds].sort());
    for (const u of line.units) {
      for (const id of u.inventoryItemIds) {
        const item = body.items.find((i) => i.inventoryItemId === id);
        expect(item, `${u.version.key} (${id}) en el quote`).toBeDefined();
        expect(item!.version, `versión de ${id}`).toEqual(u.version);
        expect(item!.unitPriceCents, `precio de ${u.version.key}: el del deck = el del quote`).toBe(u.unitPriceMxnCents);
      }
    }
    // 965: el cobro es la suma de los precios publicados de las tres piezas.
    expect(body.items.reduce((s, i) => s + i.unitPriceCents, 0)).toBe(line.units.reduce((s, u) => s + u.unitPriceMxnCents * u.qty, 0));

    // 964: en el checkout cada pieza lleva su etiqueta (la inglesa sin liga, ninguna) y ninguna repite «Español».
    await page.getByRole('button', { name: t('es', 'checkout.showMoreLines', { n: 1 }) }).click();
    const lines = page.getByRole('main').getByRole('listitem').filter({ hasText: DECK.card });
    await expect(lines).toHaveCount(3);
    const chips = await lines.evaluateAll((els) =>
      els.map((li) => ({
        chips: li.querySelector('[data-testid="line-version-chips"]')?.textContent ?? null,
        spanish: (li.textContent ?? '').split('Español').length - 1,
      })),
    );
    test.info().annotations.push({ type: 'IDS-D1 checkout', description: JSON.stringify(chips) });
    expect(chips.map((c) => c.chips ?? '').sort()).toEqual(line.units.map((u) => (u.version.key === 'en' ? '' : chipText(u))).sort());
    for (const c of chips) expect(c.spanish, JSON.stringify(c)).toBeLessThanOrEqual(1);
  });
});
