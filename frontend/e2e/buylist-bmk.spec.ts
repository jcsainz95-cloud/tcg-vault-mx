import { test, expect, type Locator, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs } from './utils/auth';
import { apiAsOk } from './utils/env';
import { chooseNeighborhood } from './utils/address';
import type {
  BuylistBatchQuoteResponse,
  CardDTO,
  Paginated,
  SellRequestDTO,
} from '../src/types/contract';

/**
 * BMK-E1 (API_CONTRACT §BMK.8 · criterio 859 entero) — «Valor de mercado» junto a «Te pagamos», de
 * punta a punta contra el stack:
 *
 *  1. abrir el cotizador, elegir set y ver LOS DOS números en una teja (rótulo + cifra);
 *  2. agregar y ver LOS MISMOS en el renglón del carrito, a la vista y sin abrir «Detalle»;
 *  3. crear la solicitud y comprobar POR API que `marketMxnCents` de la línea === el mercado que se vio
 *     (criterio 852: el mercado que se ve es el que se usó);
 *  4. una carta en precio pendiente NO enseña mercado (P-BMK-3). En real apunta a `E2E Bin Premium`
 *     (BACKEND_NOTES §86.1), la pendiente POR EL GUARDARRAÍL con mercado guardado > 0 — la que ejercita
 *     BMK-2 con la siembra normal — y afirma también lo que contestó el servidor para esa carta.
 *
 * Env-agnóstico y etiquetado `@real`: no hardcodea montos (los lee del `aria-label` de la teja, que
 * §BMK.4 obliga a decir lo mismo que la teja). El paso 3 por API solo existe contra el backend real:
 * en mock la app no hace red, y lo que se afirma ahí es el cuerpo que devolvió el servidor.
 */

const MONEY = String.raw`MX\$[\d,]+\.\d{2}`;
const MARKET_ARIA = new RegExp(
  `a la venta · ${t('es', 'buylist.sellPrice.market')} (${MONEY}) · ${t('es', 'buylist.sellPrice.wePay')} (${MONEY})$`,
);

/** BACKEND_NOTES §86.1 — la carta sembrada que cae en el guardarraíl de COMPRA con los diales de fábrica. */
const BIN_PREMIUM = 'E2E Bin Premium';

async function expectPendingTileWithoutMarket(tile: Locator, addButton: Locator) {
  await expect(tile).not.toContainText(t('es', 'buylist.sellPrice.market'));
  await expect(tile).toContainText(t('es', 'masterSet.quoterPending'));
  await expect(tile).not.toContainText(new RegExp(MONEY));
  await expect(addButton).not.toHaveAttribute('aria-label', new RegExp(MONEY));
  await expect(addButton).not.toHaveAttribute('aria-label', new RegExp(t('es', 'buylist.sellPrice.market')));
}

function toCents(money: string): number {
  const m = money.match(/MX\$([\d,]+)\.(\d{2})/);
  if (!m) throw new Error(`no es una cifra MXN: ${money}`);
  return Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
}

async function openBaseSet(page: Page) {
  const searchSet = page.getByLabel(t('es', 'masterSet.searchSet'));
  await searchSet.fill('Base');
  await page.getByRole('button', { name: /Base Set/ }).first().click();
  // El lote de cotizaciones tiene que resolver antes de leer cualquier teja.
  await expect(page.getByRole('button', { name: / a la venta · /, disabled: false }).first()).toBeVisible({
    timeout: 30_000,
  });
}

function cartPanel(page: Page): Locator {
  const prefix = t('es', 'buylist.cartDrawer.ariaLabel', { count: 0 }).replace(/\s*\(0\)\s*$/, '');
  return page.locator(`[aria-label^="${prefix}"]:not(button)`);
}

async function openCart(page: Page) {
  const panel = cartPanel(page);
  if (await panel.isVisible().catch(() => false)) return;
  const trigger = page
    .getByTestId('sell-cart-fab')
    .or(page.getByTestId('sell-cart-bar-open'))
    .filter({ visible: true });
  await trigger.click();
  await expect(panel).toBeVisible();
}

/** Sube la cantidad hasta cruzar el mínimo del servidor (sin hardcodearlo), como el smoke de VENDER. */
async function ensureMinimumReached(page: Page) {
  const panel = cartPanel(page);
  const shortfall = panel.getByTestId('buylist-minimum-shortfall');
  const qty = panel.getByRole('spinbutton').first();
  for (const n of [1, 2, 5, 12, 30, 80, 200, 500, 999]) {
    if ((await shortfall.count()) === 0) return;
    await qty.fill(String(n));
  }
  await expect(shortfall).toHaveCount(0);
}

async function choosePickupAddress(scope: Locator) {
  const select = scope.getByLabel(t('es', 'buylist.request.address.label'));
  const line1 = scope.getByLabel(t('es', 'addresses.line1'));
  await expect(select.or(line1).first()).toBeVisible();
  if ((await select.count()) > 0) {
    await expect(select).not.toHaveValue('');
    return;
  }
  await line1.fill('Av. Reforma 222');
  await scope.getByLabel(t('es', 'addresses.postalCode')).fill('06600');
  await chooseNeighborhood(scope, 'Juárez');
  await scope.getByLabel(t('es', 'addresses.phone')).fill('5555123456');
  await scope.getByRole('button', { name: t('es', 'addresses.save') }).click();
}

test.describe('§BMK · BMK-E1 — mercado junto a «Te pagamos», teja → carrito → solicitud', () => {
  test('@real BMK-E1: los dos números en la teja, los mismos en el carrito, y el mercado congelado en la solicitud es el visto', async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 2000 });
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    await openBaseSet(page);

    // 1 · Teja con mercado visible: la más barata por «Te pagamos» (aleja el tope AML, como el smoke).
    const withMarket = page.getByRole('button', { name: MARKET_ARIA, disabled: false });
    const labels = await withMarket.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    // Sin salto: «E2E Base Set» trae cartas cotizadas con mercado > 0 (E2E Charizard, E2E Pidgey…, `e2e-fixtures.ts`
    // E2E_CARDS) y el mock también. Si no aparece ninguna, es un defecto de la siembra o de la pantalla.
    expect(labels.length, 'ninguna teja de «E2E Base Set» trae mercado visible').toBeGreaterThan(0);
    let best = 0;
    let bestPay = Number.MAX_SAFE_INTEGER;
    labels.forEach((label, i) => {
      const m = label.match(MARKET_ARIA);
      if (m && toCents(m[2]) < bestPay) {
        bestPay = toCents(m[2]);
        best = i;
      }
    });
    const [, market, pay] = labels[best].match(MARKET_ARIA)!;
    // ⚠️ El `has` de `filter` se evalúa RELATIVO a cada `li`: `withMarket.nth(best)` ahí dentro
    // significaría «el n-ésimo botón DENTRO de cada li». Se ancla por la etiqueta exacta.
    const addBtn = page.getByRole('button', { name: labels[best], exact: true });
    const tile = page.locator('li').filter({ has: addBtn });
    const block = tile.getByTestId('sell-price-block');
    await expect(block.locator('dt')).toHaveText([
      t('es', 'buylist.sellPrice.market'),
      t('es', 'buylist.sellPrice.wePay'),
    ]);
    await expect(block.locator('dd')).toHaveText([market, pay]);

    // 2 · Agregar → el renglón del carrito enseña los mismos dos números, sin abrir «Detalle».
    await addBtn.click();
    await openCart(page);
    const line = cartPanel(page).getByTestId('sell-cart-line-prices').first();
    await expect(line.locator('dt')).toHaveText([
      t('es', 'buylist.sellPrice.marketEach'),
      t('es', 'buylist.sellPrice.wePayEach'),
    ]);
    await expect(line.locator('dd')).toHaveText([market, pay]);
    // P-BMK-4 / criterio 856: el total no lleva mercado.
    await expect(cartPanel(page).getByTestId('sell-cart-money')).not.toContainText(
      t('es', 'buylist.sellPrice.market'),
    );

    // 3 · Crear la solicitud y comparar con lo que congeló el servidor.
    await ensureMinimumReached(page);
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();
    const dialog = page.getByRole('dialog', { name: t('es', 'buylist.requestTitle') });
    await expect(dialog.getByText(t('es', 'buylist.summaryTitle'))).toBeVisible();
    await choosePickupAddress(dialog);
    const clabeInput = dialog.getByLabel(/CLABE/);
    if (await clabeInput.count()) await clabeInput.first().fill('002010077777777771');

    const createdResponse = IS_REAL
      ? page.waitForResponse(
          (r) => r.request().method() === 'POST' && /\/buylist\/requests$/.test(new URL(r.url()).pathname),
        )
      : null;
    await dialog.getByRole('button', { name: t('es', 'buylist.submit') }).click();

    const created = page.getByText(t('es', 'buylist.created'));
    const ineRequired = dialog.getByText(t('es', 'buylist.ineRequiredError'));
    await expect(created.or(ineRequired).first()).toBeVisible();
    // Sin salto: el INE solo se exige con total >= `ine_threshold_cents` (MX$3,000, E2E_SETTINGS) o con una línea
    // pendiente (esta tiene mercado, no lo es). Se elige la teja MÁS BARATA y `ensureMinimumReached` sube la cantidad
    // por escalones de razón <= 2.7 hasta cruzar el mínimo (MX$500 de fábrica): el total queda < MX$1,350. Si aquí
    // aparece «INE requerido», o el mínimo/umbral sembrados cambiaron o el servidor lo exige de más: que falle.
    await expect(ineRequired).toHaveCount(0);
    await expect(created).toBeVisible();

    if (!createdResponse) {
      test.info().annotations.push({
        type: 'NO MEDIDO',
        description: 'paso 3 por API: en mock la app no hace red (solo contra el backend real)',
      });
      return;
    }
    const res = await createdResponse;
    expect(res.status()).toBe(201);
    const body = (await res.json()) as SellRequestDTO;
    expect(body.items.length).toBeGreaterThan(0);
    // Una sola carta (×N): todas las líneas físicas congelan el mismo mercado, el que se vio.
    for (const item of body.items) {
      expect(item.marketMxnCents).toBe(toCents(market));
      expect(item.quotedPriceCents).toBe(toCents(pay));
    }
    // Y lo persistido (no solo la respuesta) dice lo mismo.
    const persisted = await apiAsOk<SellRequestDTO>('customer', 'GET', `/buylist/requests/${body.sellRequestId}`);
    // Sin guarda de null (TD-BMK-5): el GET de cliente solo redacta `marketMxnCents` a null en
    // `no_offer` / `not_continued` (API_CONTRACT «Portal en not_continued: forma del DTO»), y una
    // solicitud recién creada no está en ninguno. Un null aquí es un defecto, no una redacción.
    expect(persisted.items.length).toBe(body.items.length);
    for (const item of persisted.items) {
      expect(item.marketMxnCents).not.toBeNull();
      expect(item.marketMxnCents).toBe(toCents(market));
    }
  });

  test('@real BMK-E1: una carta en precio pendiente NO enseña mercado (P-BMK-3)', async ({ page }) => {
    // Lo que el servidor contestó, para ligar la teja a la carta del guardarraíl (solo real: en mock no hay red).
    const cardBodies: Paginated<CardDTO>[] = [];
    const batchBodies: BuylistBatchQuoteResponse[] = [];
    if (IS_REAL) {
      page.on('response', async (r) => {
        if (r.request().method() === 'OPTIONS' || !r.ok()) return;
        const path = new URL(r.url()).pathname;
        if (/\/buylist\/cards$/.test(path)) cardBodies.push(await r.json().catch(() => ({ data: [] })));
        else if (/\/buylist\/quote\/batch$/.test(path)) batchBodies.push(await r.json().catch(() => ({ results: [] })));
      });
    }

    await page.goto('/es/buylist');
    await openBaseSet(page);
    const pendingLabel = t('es', 'masterSet.quoterPending');

    if (IS_REAL) {
      // BACKEND_NOTES §86.1: la siembra E2E trae `E2E Bin Premium` (normal, n.º 100, «E2E Base Set», mercado MX$2).
      // Con los diales de fábrica cae en el guardarraíl de COMPRA (60 < bin 100): `precio_pendiente` CON mercado
      // guardado > 0. Es la única pendiente del set que lo es por el guardarraíl y no por falta de mercado, así que
      // es la que ejercita BMK-2. No se salta: si la siembra no la trae, es un defecto de la siembra.
      const finish = t('es', 'finish.normal');
      const binAria = t('es', 'masterSet.quoterAddAria', {
        name: BIN_PREMIUM,
        finish,
        price: pendingLabel,
      });
      const binButton = page.getByRole('button', { name: binAria, exact: true });
      await expect(binButton).toHaveCount(1, { timeout: 30_000 });

      // El servidor (BMK-2): la cotización de la carta es pendiente y su `referencePrice` no trae cifra.
      await expect
        .poll(() => cardBodies.flatMap((b) => b.data ?? []).filter((c) => c.name === BIN_PREMIUM).length)
        .toBe(1);
      const cardId = cardBodies.flatMap((b) => b.data ?? []).find((c) => c.name === BIN_PREMIUM)!.id;
      const resultsOf = () =>
        batchBodies.flatMap((b) => b.results ?? []).filter((r) => r.cardId === cardId && r.ok && r.finish === 'normal');
      await expect.poll(() => resultsOf().length).toBeGreaterThan(0);
      for (const r of resultsOf()) {
        if (!r.ok) continue;
        expect(r.quote.status).toBe('precio_pendiente');
        expect(r.quote.quotedPriceCents).toBeNull();
        expect(r.referencePrice).toEqual({ status: 'pending' });
      }

      // La pantalla: la teja de ESA carta dice «Precio pendiente» y no enseña ni rótulo ni cifra de mercado.
      const tile = page.locator('li').filter({ has: binButton });
      await expect(tile).toHaveCount(1);
      await expectPendingTileWithoutMarket(tile, binButton);
      return;
    }

    // Mock: el mock no siembra `E2E Bin Premium` (no hay guardarraíl en el mock: su pendiente es «sin mercado»).
    // Se conserva el barrido de cualquier teja pendiente del set, que afirma la mitad de pantalla del caso.
    const pendingAria = new RegExp(`a la venta · ${pendingLabel}$`);
    const pendingTiles = page.locator('li').filter({ has: page.getByRole('button', { name: pendingAria }) });
    const n = await pendingTiles.count();
    // Sin salto: el mock siembra tejas pendientes «sin mercado» en el set; si no hay ninguna, el caso no mediría nada.
    expect(n, 'ninguna teja del set está en precio pendiente (mock)').toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      const tile = pendingTiles.nth(i);
      await expectPendingTileWithoutMarket(tile, tile.getByRole('button', { name: pendingAria }));
    }
  });
});
