import { test, expect, type Page } from '@playwright/test';
import { t, type Locale } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';
import { apiAsOk } from './utils/env';
import type {
  GroupedListingDetailResponse,
  GroupedListingDTO,
  GroupedListingListResponse,
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
 *  (d) una ficha de sellado con precio por margen enseña mercado con IVA, y su tendencia si está encendida;
 *  (e) «Vender»: la MISMA carta cotiza con el mercado SIN IVA (el guardado, `M`);
 *  (f) (a) en inglés.
 *
 * Dos mundos, una sola prueba (sin saltos):
 *  - **real** (`@real`): las cartas se DESCUBREN por la API pública; `M` y la tasa `r` se leen por la API de
 *    admin (`GET /admin/pricing/card/:cardId` y `GET /admin/settings`). Si el stack no tiene una carta que
 *    cumpla, la prueba FALLA diciendo cuál falta: es un defecto de la siembra, no algo que saltarse.
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

/** El nombre accesible de la celda de mercado (§MIV.5): «Valor de mercado MX$1,160.00 IVA 16 % incluido». */
function marketGroupName(locale: Locale, labelKey: string, cents: number, r: number): string {
  return `${t(locale, labelKey)} ${mx(cents)} ${t(locale, 'common.ivaIncluded', { rate: r })}`;
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

  // `M` del mercado GUARDADO, por la API de admin: tiene que existir una captura (no manual) de esa
  // fecha, de ese grado, con ese importe. La tasa sale del dial (`iva_pct`), no de la respuesta pública.
  const history = await apiAsOk<{ data: PriceHistoryEntryDTO[] }>(
    'admin',
    'GET',
    `/admin/pricing/card/${encodeURIComponent(detail!.card.id)}`,
  );
  const stored = history.data
    .filter((h) => h.gradeKey === g.gradeKey && h.capturedDate === g.referenceValue.capturedDate && !h.isManualOverride)
    .map((h) => h.priceMxnCents);
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
      const group = page.getByRole('group', { name: marketGroupName('es', 'catalog.marketValue', shown, c.r), exact: true });
      await expect(group).toBeVisible();
      // El rótulo es texto visible, pegado a la cifra (criterio 863).
      await expect(group.getByTestId('iva-label')).toBeVisible();
      await expect(group.getByTestId('iva-label')).toHaveText(t('es', 'common.ivaIncluded', { rate: c.r }));
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

    await test.step('(d) ficha de sellado por margen: mercado con IVA (y la tendencia, si está encendida)', async () => {
      let itemId = 'inv-1008';
      let display = 353800;
      let r = 16;
      let trendEnabled = true;
      let trendLast: number | undefined = 353800;
      if (IS_REAL) {
        const list = await apiAsOk<SealedGroupListResponse>('customer', 'GET', '/catalog/sealed?pageSize=50');
        let found: SealedGroupDetailResponse | undefined;
        for (const s of list.data) {
          const d = await apiAsOk<SealedGroupDetailResponse>('customer', 'GET', `/catalog/sealed/${s.representativeItemId}`);
          if (d.group.priceBasis === 'market' && Number.isInteger(d.group.referenceDisplayCents)) {
            found = d;
            break;
          }
        }
        expect(found, 'el stack no publica ningún sellado con precio por margen y `referenceDisplayCents`').toBeTruthy();
        const g = found!.group;
        itemId = g.representativeItemId;
        display = g.referenceDisplayCents!;
        r = g.ivaRatePct;
        expect(display).toBe(withIva(g.referenceValue.referenceMxnCents!, r));
        trendEnabled = found!.trendEnabled;
        trendLast = undefined;
      }
      const historyResponse =
        IS_REAL && trendEnabled
          ? page.waitForResponse((res) => /\/catalog\/sealed\/[^/]+\/value-history/.test(new URL(res.url()).pathname))
          : null;
      await page.goto(`/es/sellado/${itemId}`);
      await expect(
        page.getByRole('group', { name: marketGroupName('es', 'sealed.detail.marketValue', display, r), exact: true }),
      ).toBeVisible();
      if (!trendEnabled) {
        test.info().annotations.push({ type: 'NO MEDIDO', description: '(d) tendencia apagada en este stack' });
        return;
      }
      if (historyResponse) {
        const res = await historyResponse;
        if (res.status() === 404) {
          // Pieza no mapeada: el componente se oculta (contrato). Se dice, no se esconde.
          test.info().annotations.push({ type: 'NO MEDIDO', description: '(d) tendencia: 404 (pieza sin serie)' });
          return;
        }
        const body = (await res.json()) as SealedValueHistoryResponse;
        expect(body.points.length, 'la serie del sellado vino vacía').toBeGreaterThan(0);
        trendLast = body.points[body.points.length - 1].displayValueMxnCents;
      }
      await expect(
        page.getByRole('group', { name: `${mx(trendLast!)} ${t('es', 'common.ivaIncluded', { rate: r })}`, exact: true }),
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
        page.getByRole('group', { name: marketGroupName('en', 'catalog.marketValue', shown, c.r), exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('main')).not.toContainText(mx(c.m));
    });
  });
});
