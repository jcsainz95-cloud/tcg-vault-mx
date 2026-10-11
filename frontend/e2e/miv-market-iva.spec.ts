import { test, expect, type Page } from '@playwright/test';
import { t, type Locale } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';
import { apiAs, apiAsOk } from './utils/env';
import type {
  GroupedListingDetailResponse,
  GroupedListingDTO,
  GroupedListingListResponse,
  InventoryItemDTO,
  PriceHistoryEntryDTO,
  SealedGroupDetailResponse,
  SealedGroupListResponse,
  SealedValueHistoryResponse,
  SettingsDTO,
} from '../src/types/contract';

/**
 * MIV-E1 (`API_CONTRACT §MIV.7` · criterio **869** entero) — el mercado CON IVA en la tienda, de punta a
 * punta. Norma: `HECHOS.md:160`, fila 2026-10-10 «Tienda: el VALOR DE MERCADO se muestra CON IVA, con una
 * nota «incluye IVA».» (mercado MX$1,000 → MX$1,160 junto a su precio MX$1,334; «Vender» sin IVA).
 *
 *  (a) ficha de una carta con precio por mercado: mercado con IVA + rótulo de IVA + precio; la cifra se
 *      comprueba contra `M + round(M × r / 100)` del mercado GUARDADO, leído por la API de admin (no contra
 *      otro número de la pantalla);
 *  (b) se agrega al carrito: el subtotal del checkout es el precio de la ficha (ningún importe cambia) y
 *      el desglose no trae el mercado;
 *  (c) una carta con precio a mano no enseña mercado (ni cifra ni rótulo);
 *  (d) una ficha de sellado con precio por margen enseña mercado con IVA y su tendencia con IVA (en real, la
 *      prueba prepara la pieza y enciende la tendencia, y lo deshace al terminar);
 *  (e) «Vender»: la MISMA carta cotiza con el mercado SIN IVA (el guardado, `M`);
 *  (f) (a) en inglés.
 *
 * Dos mundos, una sola prueba (sin saltos):
 *  - **real** (`@real`): las cartas se DESCUBREN por la API pública; `M` y la tasa `r` se leen por la API de
 *    admin (`GET /admin/pricing/card/:cardId` y `GET /admin/settings`). Si el stack no tiene una carta que
 *    cumpla, la prueba FALLA diciendo cuál falta: es un defecto de la siembra, no algo que saltarse.
 *    El SELLADO de (d) no se descubre: la siembra solo publica uno con precio a mano y la tendencia apagada
 *    (medido por QA sobre `f3a6c702`), así que la prueba PREPARA su propio estado por la API de admin del
 *    contrato y lo DESHACE al final (`afterEach`, corre también si la prueba falla) — ver `sealedMarketCase`.
 *  - **mock**: la app no hace red; los datos son los del simulador (`lib/mock/fixtures.ts`): Blastoise
 *    (`c-blastoise`, mercado guardado 128,000, `ivaPct` 16), Milotic (`c-milotic-fa`, precio a mano) y la
 *    caja `inv-1008` (mercado con IVA 353,800, tendencia encendida). Se dicen aquí, no se esconden.
 */

const MONEY = String.raw`MX\$[\d,]+\.\d{2}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Formato de la tienda (`formatMoneyCents`): «MX$1,160.00» en los dos idiomas. */
function mx(cents: number): string {
  return `MX$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `API_CONTRACT §MIV.1`: la cuenta del servidor, rehecha AQUÍ solo como oráculo de la prueba. */
function withIva(m: number, r: number): number {
  return m + Math.round((m * r) / 100);
}

/** El nombre accesible de la celda de mercado (§MIV.5 / vMIV-2): «Valor de mercado MX$1,160.00 incluye IVA»
 * (en: «… VAT included»). El rótulo del mercado NO lleva la tasa (§MIV.10). */
function marketGroupName(locale: Locale, labelKey: string, cents: number): string {
  return `${t(locale, labelKey)} ${mx(cents)} ${t(locale, 'common.ivaIncludedBare')}`;
}

interface CardCase {
  cardId: string;
  name: string;
  setName: string;
  finish: string;
  /** Mercado guardado (neto). */
  m: number;
  /** Tasa `iva_pct`. */
  r: number;
  /** Precio de venta exhibido (lo que se cobra), si se conoce por API. */
  priceCents?: number;
}

/** Recorre la rejilla pública y devuelve la primera ficha cuyo grupo principal cumpla `pred`. */
async function findCardDetail(
  pred: (g: GroupedListingDTO) => boolean,
): Promise<GroupedListingDetailResponse | undefined> {
  for (let page = 1; page <= 10; page += 1) {
    const list = await apiAsOk<GroupedListingListResponse>('customer', 'GET', `/catalog/cards?page=${page}&pageSize=50`);
    const ids = [...new Set(list.data.filter((s) => s.productType === 'raw').map((s) => s.card.id))];
    for (const id of ids) {
      const detail = await apiAsOk<GroupedListingDetailResponse>('customer', 'GET', `/catalog/cards/${id}`);
      const primary = detail.listings[0];
      if (primary && pred(primary)) return detail;
    }
    if (page * list.pageSize >= list.total) break;
  }
  return undefined;
}

async function marketCardCase(): Promise<CardCase> {
  if (!IS_REAL) {
    return { cardId: 'c-blastoise', name: 'Blastoise', setName: 'Base Set', finish: 'normal', m: 128000, r: 16 };
  }
  const detail = await findCardDetail(
    (g) => g.productType === 'raw' && g.priceBasis === 'market' && Number.isInteger(g.referenceDisplayCents),
  );
  expect(detail, 'el stack no publica ninguna carta raw con precio por mercado y `referenceDisplayCents`').toBeTruthy();
  const g = detail!.listings[0];
  const net = g.referenceValue.referenceMxnCents;
  expect(net, 'el grupo market no trae `referenceValue.referenceMxnCents`').toEqual(expect.any(Number));

  // `M` del mercado GUARDADO, por la API de admin: tiene que existir una fila de NATURALEZA mercado
  // (`refKind: "market"`) de esa fecha, de ese grado, con ese importe. La tasa sale del dial (`iva_pct`), no de la
  // respuesta pública.
  // ⚠️ El filtro es `refKind`, NO `!isManualOverride`: `isManualOverride` es PROCEDENCIA («lo tecleó alguien»), y
  // un mercado fijado a mano («FIJAR PRECIO», `source: manual`) SÍ resuelve un precio por mercado — es justo lo que
  // la siembra hace (QA midió en `f3a6c702`: `{source:"manual", isManualOverride:true, refKind:"market"}` con
  // `priceBasis: market`). Lo que NUNCA puede ser dinero es `refKind: "graded_estimate"` (`API_CONTRACT`
  // `PriceHistoryEntryDTO`, v1.50.3-f). El tipo del front aún no trae `refKind` (TD-MIV-F5): se lee aquí.
  const history = await apiAsOk<{ data: (PriceHistoryEntryDTO & { refKind?: 'market' | 'graded_estimate' })[] }>(
    'admin',
    'GET',
    `/admin/pricing/card/${encodeURIComponent(detail!.card.id)}`,
  );
  const sameKey = history.data.filter(
    (h) => h.productType === 'raw' && h.gradeKey === g.gradeKey && h.capturedDate === g.referenceValue.capturedDate,
  );
  // El campo tiene que venir: sin él, el filtro de abajo no distinguiría mercado de estimado y pasaría en vacío.
  for (const h of sameKey) expect(h.refKind, 'GET /admin/pricing/card sin `refKind` (contrato v1.50.3-f)').toBeDefined();
  const stored = sameKey.filter((h) => h.refKind === 'market').map((h) => h.priceMxnCents);
  expect(stored, `mercado guardado de ${detail!.card.name} (${g.gradeKey}, ${g.referenceValue.capturedDate})`).toContain(net);
  const settings = await apiAsOk<SettingsDTO>('admin', 'GET', '/admin/settings');
  // El servidor y el oráculo coinciden: la cifra con IVA es la cuenta de §MIV.1 sobre el guardado.
  expect(g.referenceDisplayCents).toBe(withIva(net!, settings.ivaPct));
  expect(g.ivaRatePct).toBe(settings.ivaPct);
  return {
    cardId: detail!.card.id,
    name: detail!.card.name,
    setName: detail!.card.setName,
    finish: g.finish,
    m: net!,
    r: settings.ivaPct,
    priceCents: g.displayPriceCents,
  };
}

/** Lo que la prueba cambió en el stack y tiene que deshacer (en orden inverso), pase lo que pase. */
const undo: { what: string; run: () => Promise<void> }[] = [];

/**
 * `tcgplayerProductId` PROPIO de MIV-E1: la serie de mercado del sellado se guarda por esta clave
 * (`sealed:tcg:<id>`), así que uno fijo y exclusivo hace que la prueba escriba UNA fila por día (el
 * override es por clave y fecha) y no toque la serie de ningún otro sellado (el de la siembra es 610000001).
 */
const MIV_SEALED_PID = 619_000_869;
const MIV_SEALED_GROUP = 61_001;
/** Mercado neto que la prueba fija a su sellado (MX$2,500.00 ⇒ con IVA 16 %: MX$2,900.00). */
const MIV_SEALED_MARKET = 250_000;

interface SealedCase {
  itemId: string;
  display: number;
  r: number;
  trendEnabled: boolean;
  /** Último punto con IVA de la tendencia; en real se lee de la respuesta de la ficha. */
  trendLast?: number;
}

/** Retira (`error_captura`) una pieza que dio de alta la prueba. `404`/ya retirada = nada que hacer. */
async function retireMivPiece(id: string): Promise<void> {
  const r = await apiAs('admin', 'POST', '/admin/inventory/adjustments', {
    reason: 'error_captura',
    inventoryItemId: id,
    note: 'E2E MIV-E1: sellado dado de alta por la prueba, no existe físicamente',
  });
  if (r.status >= 300 && r.status !== 404 && r.status !== 422) {
    throw new Error(`no pude retirar la pieza ${id} de MIV-E1: ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
  }
}

/**
 * (d) en real: la siembra no publica ningún sellado con precio por mercado ni enciende la tendencia, así que la
 * prueba los PREPARA por la API de admin del contrato y deja en `undo` cómo deshacerlo:
 *  1. dial `sealedValueTrend` → `on` (`PUT /admin/settings`); se restaura al valor LEÍDO;
 *  2. alta de una pieza sellada SIN precio a mano, anclada a la carta del sellado de la siembra
 *     (`POST /admin/inventory/items`); se retira con `error_captura` (`POST /admin/inventory/adjustments`);
 *  3. mapeo a `MIV_SEALED_PID` (`PUT /admin/pricing/sealed/items/:id/mapping`) y su mercado fijado a mano
 *     («FIJAR PRECIO», `POST /admin/pricing/override`, `refKind: market`, no gateado por `sealedPriceSource`);
 *  4. publicar (`PATCH /admin/inventory/items/:id {status:'listed'}`).
 * La fila de mercado de `MIV_SEALED_PID` se queda (no hay ruta que la borre): es de una clave que solo usa esta
 * prueba y nadie más la lee. Antes de dar de alta se retiran las piezas de esa clave que una corrida MUERTA (sin
 * `afterEach`) haya dejado publicadas, para no acumularlas.
 * Si algún paso no da lo que el contrato dice, la prueba FALLA aquí con su causa: nada de «NO MEDIDO».
 */
async function sealedMarketCase(): Promise<SealedCase> {
  if (!IS_REAL) return { itemId: 'inv-1008', display: 353800, r: 16, trendEnabled: true, trendLast: 353800 };

  const seeded = await apiAsOk<SealedGroupListResponse>('customer', 'GET', '/catalog/sealed?pageSize=50');
  expect(seeded.data.length, 'el stack no publica ningún sellado: la prueba necesita su carta ancla').toBeGreaterThan(0);
  const anchorCardId = seeded.data[0].card.id;

  // Restos de una corrida muerta: piezas de MI clave aún vivas.
  const stale = await apiAsOk<{ data: InventoryItemDTO[] }>(
    'admin',
    'GET',
    `/admin/inventory/items?cardId=${anchorCardId}&productType=sealed&pageSize=100`,
  );
  for (const it of stale.data) {
    if (it.tcgplayerProductId === MIV_SEALED_PID && (it.status === 'listed' || it.status === 'in_stock')) {
      await retireMivPiece(it.id);
    }
  }

  const before = await apiAsOk<SettingsDTO>('admin', 'GET', '/admin/settings');
  const originalTrend = before.sealedValueTrend ?? 'off';
  if (originalTrend !== 'on') {
    await apiAsOk('admin', 'PUT', '/admin/settings', { sealedValueTrend: 'on' });
    undo.push({
      what: `dial sealedValueTrend → ${originalTrend}`,
      run: async () => {
        await apiAsOk('admin', 'PUT', '/admin/settings', { sealedValueTrend: originalTrend });
      },
    });
  }

  const item = await apiAsOk<InventoryItemDTO>('admin', 'POST', '/admin/inventory/items', {
    cardId: anchorCardId,
    productType: 'sealed',
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    acquisitionType: 'compra',
    acquisitionCostCents: 1000,
  });
  undo.push({ what: `retirar ${item.folio}`, run: () => retireMivPiece(item.id) });
  expect(item.listPriceCents ?? null, 'el alta de MIV-E1 nació con precio a mano').toBeNull();

  await apiAsOk('admin', 'PUT', `/admin/pricing/sealed/items/${item.id}/mapping`, {
    tcgplayerProductId: MIV_SEALED_PID,
    tcgplayerGroupId: MIV_SEALED_GROUP,
  });
  await apiAsOk('admin', 'POST', '/admin/pricing/override', {
    cardId: anchorCardId,
    productType: 'sealed',
    gradeKey: `sealed:tcg:${MIV_SEALED_PID}`,
    finish: 'normal',
    priceMxnCents: MIV_SEALED_MARKET,
  });
  const published = await apiAsOk<InventoryItemDTO>('admin', 'PATCH', `/admin/inventory/items/${item.id}`, {
    status: 'listed',
  });
  expect(published.status, `la pieza ${item.folio} no quedó publicada`).toBe('listed');

  // Lo que la tienda dice de ESA pieza (contrato §2-S): precio por mercado, con su cifra con IVA.
  const d = await apiAsOk<SealedGroupDetailResponse>('customer', 'GET', `/catalog/sealed/${item.id}`);
  const g = d.group;
  expect(g.priceBasis, `ficha de ${item.folio}: precio por mercado`).toBe('market');
  expect(g.referenceValue.referenceMxnCents).toBe(MIV_SEALED_MARKET);
  const settings = await apiAsOk<SettingsDTO>('admin', 'GET', '/admin/settings');
  expect(g.ivaRatePct).toBe(settings.ivaPct);
  expect(g.referenceDisplayCents).toBe(withIva(MIV_SEALED_MARKET, settings.ivaPct));
  expect(d.trendEnabled, 'la tendencia sigue apagada tras encender el dial').toBe(true);
  return { itemId: g.representativeItemId, display: g.referenceDisplayCents!, r: g.ivaRatePct, trendEnabled: true };
}

/** La celda «Precio de venta» de la ficha y su cifra. */
async function salePriceOf(page: Page, locale: Locale): Promise<string> {
  const cell = page
    .locator('div.border-b')
    .filter({ has: page.getByText(t(locale, 'catalog.salePrice'), { exact: true }) })
    .last();
  await expect(cell).toBeVisible();
  const text = (await cell.textContent()) ?? '';
  const m = text.match(new RegExp(MONEY));
  expect(m, `la celda «${t(locale, 'catalog.salePrice')}» no trae cifra`).toBeTruthy();
  return m![0];
}

test.describe('§MIV · MIV-E1 — mercado con IVA en la tienda (criterio 869)', () => {
  // Deshace lo que (d) preparó, también si la prueba falla o se agota. Todos los pasos se intentan; si alguno
  // falla, la prueba se pone ROJA nombrándolo (un stack que se queda cambiado no es un verde).
  test.afterEach(async () => {
    const failed: string[] = [];
    while (undo.length > 0) {
      const u = undo.pop()!;
      try {
        await u.run();
      } catch (e) {
        failed.push(`${u.what}: ${String(e)}`);
      }
    }
    expect(failed, 'MIV-E1 no pudo deshacer su preparación').toEqual([]);
  });

  test('@real MIV-E1: ficha con IVA contra el guardado, carrito igual, override sin mercado, sellado, «Vender» sin IVA, inglés', async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 2000 });
    await loginAs(page, 'customer');
    const c = await marketCardCase();
    const shown = withIva(c.m, c.r);

    let price = '';
    await test.step('(a) ficha de carta: mercado CON IVA + rótulo + precio; cifra = M + round(M·r/100)', async () => {
      await page.goto(`/es/catalog/${c.cardId}`);
      const group = page.getByRole('group', { name: marketGroupName('es', 'catalog.marketValue', shown), exact: true });
      await expect(group).toBeVisible();
      // El rótulo es texto visible, pegado a la cifra (criterio 863). vMIV-2: dice «incluye IVA», sin la tasa.
      await expect(group.getByTestId('iva-label')).toBeVisible();
      await expect(group.getByTestId('iva-label')).toHaveText(t('es', 'common.ivaIncludedBare'));
      // ⛔ el neto no aparece en la ficha.
      await expect(page.getByRole('main')).not.toContainText(mx(c.m));
      price = await salePriceOf(page, 'es');
      if (c.priceCents != null) expect(price).toBe(mx(c.priceCents));
      expect(price).not.toBe(mx(shown));
    });

    await test.step('(b) carrito: el subtotal es el precio de la ficha; el desglose no trae el mercado', async () => {
      await page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first().click();
      // Confirmación (toast §7.5). El CTA «En el carrito» solo sale cuando TODAS las piezas del grupo
      // están dentro, y el grupo puede tener varias.
      await expect(page.getByRole('status').getByText(t('es', 'catalog.addedToCart'))).toBeVisible();
      await page.goto('/es/checkout');
      const breakdown = page.getByTestId('amount-breakdown');
      await expect(breakdown).toBeVisible();
      await expect(breakdown).toContainText(price);
      await expect(breakdown).not.toContainText(mx(shown));
      await expect(breakdown).toContainText(t('es', 'checkout.total'));
      // El cobro (pasarela) no se ejecuta aquí: lo cubre `checkout.spec.ts` «@real comprar…». Aquí se
      // afirma la parte que §MIV podría mover: lo que entra al cobro es el precio, no el mercado.
      test.info().annotations.push({
        type: 'alcance',
        description: '(b) mide subtotal/desglose; el cobro por la pasarela lo mide checkout.spec.ts',
      });
    });

    await test.step('(c) carta con precio a mano: ni mercado, ni rótulo de mercado, ni su cifra', async () => {
      let cardId = 'c-milotic-fa';
      let hidden: number[] = [withIva(210000, 16), 210000];
      if (IS_REAL) {
        const d = await findCardDetail((g) => g.priceBasis === 'override');
        expect(d, 'el stack no publica ninguna carta con precio a mano (override)').toBeTruthy();
        cardId = d!.card.id;
        const g = d!.listings[0];
        // Lo que el servidor emita (por error) tampoco puede verse.
        hidden = [g.referenceDisplayCents, g.referenceValue.referenceMxnCents].filter(
          (x): x is number => typeof x === 'number',
        );
      }
      await page.goto(`/es/catalog/${cardId}`);
      await expect(page.getByText(t('es', 'catalog.salePrice'), { exact: true })).toBeVisible();
      await expect(page.getByText(t('es', 'catalog.marketValue'), { exact: true })).toHaveCount(0);
      await expect(page.getByRole('group', { name: new RegExp(`^${esc(t('es', 'catalog.marketValue'))}`) })).toHaveCount(0);
      await expect(page.getByText(t('es', 'card.referenceExplainerNoMarket'))).toBeVisible();
      for (const cents of hidden) await expect(page.getByRole('main')).not.toContainText(mx(cents));
    });

    await test.step('(d) ficha de sellado por margen: mercado con IVA y su tendencia con IVA', async () => {
      const sc = await sealedMarketCase();
      const historyResponse = IS_REAL
        ? page.waitForResponse((res) => /\/catalog\/sealed\/[^/]+\/value-history/.test(new URL(res.url()).pathname))
        : null;
      await page.goto(`/es/sellado/${sc.itemId}`);
      await expect(
        page.getByRole('group', { name: marketGroupName('es', 'sealed.detail.marketValue', sc.display), exact: true }),
      ).toBeVisible();
      // Tendencia: en los dos mundos está encendida (real: la encendió `sealedMarketCase`). Un 404 o una serie
      // vacía es un ROJO, no un «no medido» (techlead D-7).
      expect(sc.trendEnabled).toBe(true);
      let trendLast = sc.trendLast;
      if (historyResponse) {
        const res = await historyResponse;
        expect(res.status(), 'value-history de la pieza de MIV-E1').toBe(200);
        const body = (await res.json()) as SealedValueHistoryResponse;
        expect(body.points.length, 'la serie del sellado vino vacía').toBeGreaterThan(0);
        trendLast = body.points[body.points.length - 1].displayValueMxnCents;
        // El último punto es el mercado de hoy que fijó la prueba: la tendencia termina en la cifra de la ficha.
        expect(trendLast).toBe(sc.display);
      }
      await expect(
        page.getByRole('group', { name: `${mx(trendLast!)} ${t('es', 'common.ivaIncludedBare')}`, exact: true }),
      ).toBeVisible();
    });

    await test.step('(e) «Vender»: la MISMA carta cotiza con el mercado SIN IVA (el guardado)', async () => {
      await page.goto('/es/buylist');
      await page.getByLabel(t('es', 'masterSet.searchSet')).fill(c.setName.split(' ')[0]);
      await page.getByRole('button', { name: new RegExp(esc(c.setName)) }).first().click();
      const aria = new RegExp(
        `^${esc(t('es', 'masterSet.quoterAddAriaMarket', { name: c.name, finish: t('es', `finish.${c.finish}`), market: '\u0001', price: '\u0002' }))}$`
          .replace('\u0001', `(${MONEY})`)
          .replace('\u0002', `(${MONEY})`),
      );
      const btn = page.getByRole('button', { name: aria }).first();
      await expect(btn).toBeVisible({ timeout: 30_000 });
      const label = (await btn.getAttribute('aria-label')) ?? '';
      const [, market] = label.match(aria)!;
      expect(market).toBe(mx(c.m));
      expect(market).not.toBe(mx(shown));
      const tile = page.locator('li').filter({ has: btn });
      await expect(tile.getByTestId('sell-price-block')).not.toContainText(/IVA/);
    });

    await test.step('(f) (a) en inglés: la misma cifra con «N % VAT included»', async () => {
      await page.goto(`/en/catalog/${c.cardId}`);
      await expect(
        page.getByRole('group', { name: marketGroupName('en', 'catalog.marketValue', shown), exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('main')).not.toContainText(mx(c.m));
    });
  });
});
