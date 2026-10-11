import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs, loginAsDisposable, mockOnly, realOnly } from './utils/auth';
import { apiAsOk, resolveApiBaseUrl } from './utils/env';
import { WISHLIST_PRIVACY_EN, WISHLIST_PRIVACY_ES } from '../src/content/legal/privacy-wishlist';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * §WSH · Lista de deseos — WSH-F1…F10 (API_CONTRACT §WSH.9 + erratas v1.87.1–v1.87.3; DESIGN_SYSTEM §WSH-UX).
 *
 * AGNÓSTICO al entorno (FRONTEND_NOTES §108.v1.87.3; I-1 de QA / C1 de techlead sobre 503cf07): el mismo caso corre
 * en mocks y contra el stack real; lo único que cambia es CÓMO se prepara el estado:
 *   - mock: servidor falso de `src/lib/mock/wishlist.ts` (banderas en `localStorage`) y cartas del fixture;
 *   - real: por la API del contrato (`POST/DELETE /wishlist` como `customer2`, `PUT /admin/settings` como súper-admin)
 *     y cartas del seed `seed-e2e` descubiertas por nombre en `GET /buylist/cards?q=` (sus ids son aleatorios).
 * Las cartas tienen la MISMA forma en los dos mundos: una con {normal con mercado, reverse_holo sin mercado}
 * (Pikachu / E2E Reverse Bird), una sin mercado (Zapdos / E2E Order Two) y una que la tienda nunca tuvo
 * (Celebrations #7 / E2E Order Ten). En real los diales del módulo se fotografían en `beforeAll`, se reponen antes de
 * cada caso y al final, y la lista de `customer2` se vacía; los casos corren EN ORDEN en un worker
 * (`mode: 'default'`) porque comparten diales globales.
 *
 * Queda `mockOnly` SOLO lo que necesita el token firmado de un correo (WSH-F3/F9 «confirmar»: el HMAC lo firma el
 * servidor y el arnés no lee el buzón). WSH-F5 ya no espera al seed (v1.87.4): `seed-e2e` siembra UNA pieza sellada a
 * la venta y mapeada (`E2E_SEALED_LISTED`, folio `E2E-SLD-0001`, «E2E Surging Sparks Booster Box», `tcgplayerProductId
 * 610000001`; BACKEND_NOTES §84.v1.87.4). El «avísame» de punta a punta (WSH-F5 · avísame) solo corre contra el stack: lo
 * que mide es la fila que DERIVA el servidor, y en mock no hay servidor que derive. Cifras: las del servidor; el spec las LEE de la
 * pantalla y las compara entre sí (preview = guardado): no las recalcula.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

const W = (k: string, vars?: Record<string, string | number>) => t('es', `wishlist.${k}`, vars);
const B = (k: string, vars?: Record<string, string | number>) => t('es', `admin.m9.buyList.${k}`, vars);
const F = (finish: string) => t('es', `finish.${finish}`);

/** Cabecera literal del CSV (`API_CONTRACT §WSH.8` v1.87.2; el simulador se ancla al contrato en `wishlist-csv.test.ts`). */
const CSV_HEAD =
  'carta,set,numero,acabado,la_buscan,cuentas_16,max_16,techo_16,cuentas_10,max_10,techo_10,cuentas_5,max_5,techo_5,' +
  'techo_principal,mercado,normal_sin_iva,normal_con_iva,pagan_normal,margen_mercado,margen_mercado_pct,buylist_hoy';
const CSV_SEALED_HEAD = 'producto,presentacion,condicion,esperan';

/** Cuenta del cliente de estos casos (en real, sus deseos se borran antes de cada caso). */
const ROLE = 'customer2' as const;

type CardKey = 'two' | 'noMarket' | 'never';
/** Mock: ids del fixture. Real: nombres del seed; el id se resuelve en `beforeAll`. */
const CARDS: Record<CardKey, { id: string; name: string }> = IS_REAL
  ? {
      two: { id: '', name: 'E2E Reverse Bird' }, // normal con mercado, reverse_holo sin mercado, sin piezas
      noMarket: { id: '', name: 'E2E Order Two' }, // sin mercado en ningún acabado
      never: { id: '', name: 'E2E Order Ten' }, // nunca tuvo piezas; solo `normal`
    }
  : {
      two: { id: 'c-pikachu', name: 'Pikachu' }, // normal con mercado, reverse_holo sin mercado (a la venta)
      noMarket: { id: 'c-zapdos', name: 'Zapdos' },
      never: { id: 'c-cel25-7', name: 'Celebrations #7' }, // Celebrations, sin piezas; solo `holofoil`
    };
const NEVER_FINISH = IS_REAL ? 'normal' : 'holofoil';

// ── Preparación REAL (solo con IS_REAL) ─────────────────────────────────────────────────────────────────
interface Dials {
  wishlistEnabled: 'on' | 'off';
  wishlistMaxPerAccount: number;
  /** Dial del «avísame» de sellados (seed `off`); lo encienden solo los casos del «avísame». */
  sealedRestockAlerts: 'on' | 'off';
}
let originalDials: Dials | null = null;

async function putDials(d: Partial<Dials>): Promise<void> {
  await apiAsOk('admin', 'PUT', '/admin/settings', d);
}
async function clearRealList(): Promise<void> {
  const list = await apiAsOk<{ items: { id: string }[] }>(ROLE, 'GET', '/wishlist');
  for (const it of list.items) await apiAsOk(ROLE, 'DELETE', `/wishlist/${it.id}`);
}

interface Wish {
  card: CardKey;
  finish: string;
  maxPct: 5 | 10 | 16;
}

/**
 * Deja el servidor (falso o real) con `items` en la lista de `ROLE`, el tope `limit` y el dial `off`.
 * DEBE llamarse antes del primer `page.goto` (en mock usa `addInitScript`).
 */
async function arrange(page: Page, o: { items?: Wish[]; limit?: number; off?: boolean } = {}): Promise<void> {
  if (!IS_REAL) {
    const items = (o.items ?? []).map((w, i) => stored(`w-${i}`, CARDS[w.card].id, w.finish, w.maxPct));
    await seedWishlist(page, { items, limit: o.limit, off: o.off });
    return;
  }
  await clearRealList();
  for (const w of o.items ?? []) {
    await apiAsOk(ROLE, 'POST', '/wishlist', { cardId: CARDS[w.card].id, finish: w.finish, maxPct: w.maxPct });
  }
  if (o.limit !== undefined) await putDials({ wishlistMaxPerAccount: o.limit });
  if (o.off) await putDials({ wishlistEnabled: 'off' });
}

// ── Servidor FALSO (solo en mock) ───────────────────────────────────────────────────────────────────────
/** Estado inicial del servidor falso, aplicado UNA vez (las navegaciones siguientes no lo pisan). */
async function seedWishlist(page: Page, opts: { items?: unknown[]; off?: boolean; limit?: number; paused?: boolean } = {}) {
  await page.addInitScript((o) => {
    if (window.localStorage.getItem('tcg.mock.wishlistSeeded') === '1') return;
    window.localStorage.setItem('tcg.mock.wishlistSeeded', '1');
    window.localStorage.setItem('tcg.mock.wishlist', JSON.stringify(o.items ?? []));
    if (o.off) window.localStorage.setItem('tcg.mock.wishlistOff', '1');
    if (o.limit) window.localStorage.setItem('tcg.mock.wishlistLimit', String(o.limit));
    if (o.paused) window.localStorage.setItem('tcg.mock.wishlistPaused', '1');
  }, opts);
}

const stored = (id: string, cardId: string, finish: string, maxPct: number) => ({
  id,
  cardId,
  finish,
  maxPct,
  createdAt: '2026-10-07T10:00:00.000Z',
  lastNotifiedAt: null,
});

const block = (page: Page) => page.getByTestId('wishlist-block');
/** Token con la forma del real (43 caracteres base64url) que ningún servidor firmó. */
const BOGUS_TOKEN = 'x'.repeat(43);
const BOGUS_ID = '00000000-0000-4000-8000-000000000000';

// ── Sellado del seed (WSH-F5) ───────────────────────────────────────────────────────────────────────────
/**
 * La teja de sellado de los dos mundos: en mock, «Surging Sparks Booster Box» del fixture; en real, la pieza del seed
 * «E2E Surging Sparks Booster Box» (`E2E_SEALED_LISTED`). La subcadena casa con las dos.
 */
const SEALED_TILE_RE = /Surging Sparks Booster Box/;
/** Real: nombre del producto del seed y de su carta ancla (el `q` de `GET /catalog/sealed` busca por la CARTA). */
const SEALED_SEED = { productName: 'E2E Surging Sparks Booster Box', anchorCard: 'E2E Third Bird' } as const;
const R = (k: string, vars?: Record<string, string | number>) => t('es', `sealed.restock.${k}`, vars);
const RESTOCK_PATH = '/catalog/sealed/restock-subscriptions';

/** Real: el grupo del seed por la API pública (sus ids son aleatorios) y el `representativeItemId` de SU ficha. */
async function sealedSeedGroup(): Promise<{ tileId: string; representativeItemId: string }> {
  const q = encodeURIComponent(SEALED_SEED.anchorCard);
  const grid = await apiAsOk<{ data: { representativeItemId: string; productName: string }[] }>(
    'admin',
    'GET',
    `/catalog/sealed?q=${q}`,
  );
  const tile = grid.data.find((g) => g.productName === SEALED_SEED.productName);
  if (!tile) throw new Error(`seed-e2e sin el sellado «${SEALED_SEED.productName}» (¿corrió prisma/seed-e2e.ts?)`);
  const detail = await apiAsOk<{ group: { representativeItemId: string } }>(
    'admin',
    'GET',
    `/catalog/sealed/${tile.representativeItemId}`,
  );
  return { tileId: tile.representativeItemId, representativeItemId: detail.group.representativeItemId };
}

/**
 * Real: correos distintos esperando un sellado, por NOMBRE, en la demanda de M9 (`GET /admin/reports/wishlist-demand`,
 * `sealed[]`, §WSH.8). El nombre DELATA LA CLAVE de la fila (`wishlist-demand.service.ts` `sealedWaiting`, contrato
 * v1.87.2 «nombre del sellado en la demanda»): una fila `p:<tcgplayerProductId>:<cond>` sale con el `sealedProductName`
 * de una pieza de ese producto («E2E Surging Sparks Booster Box», el seed solo tiene ese producto con ese nombre ⇒
 * `p:610000001:mint`); una fila `c:<cardId>:<subtipo>:<cond>` —el defecto B-1— sale con el nombre de la CARTA ancla
 * («E2E Third Bird»). La demanda exige `wishlistEnabled = on` (lo pone el `beforeEach`).
 */
async function sealedWaiting(productName: string): Promise<number> {
  const d = await apiAsOk<{
    sealed: { productName: string; sealedSubtype: string | null; sealedCondition: string; waitingCount: number }[];
  }>('admin', 'GET', '/admin/reports/wishlist-demand');
  return d.sealed
    .filter((x) => x.productName === productName && x.sealedSubtype === 'box' && x.sealedCondition === 'mint')
    .reduce((n, x) => n + x.waitingCount, 0);
}

/** Correo único del arnés (dominio reservado `e2e.local`): cada corrida es un correo NUEVO ⇒ la cuenta sube en 1. */
const freshEmail = (tag: string) =>
  `e2e-wsh-restock-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;

test.describe('§WSH · lista de deseos', () => {
  // En real los casos comparten diales globales (`wishlist_enabled`, tope): en orden, en un worker. ⚠️ Por lo mismo,
  // `--repeat-each` necesita `--workers=1` (cada repetición es otra copia del fichero y correría en paralelo).
  test.describe.configure({ mode: 'default' });

  test.beforeAll(async () => {
    if (!IS_REAL) return;
    for (const key of Object.keys(CARDS) as CardKey[]) {
      const q = encodeURIComponent(CARDS[key].name);
      const res = await apiAsOk<{ data: { id: string; name: string }[] }>(ROLE, 'GET', `/buylist/cards?q=${q}&pageSize=10`);
      const hit = res.data.find((c) => c.name === CARDS[key].name);
      if (!hit) throw new Error(`seed-e2e sin la carta «${CARDS[key].name}» (¿corrió prisma/seed-e2e.ts?)`);
      CARDS[key].id = hit.id;
    }
    const s = await apiAsOk<Dials>('admin', 'GET', '/admin/settings');
    originalDials = {
      wishlistEnabled: s.wishlistEnabled,
      wishlistMaxPerAccount: s.wishlistMaxPerAccount,
      sealedRestockAlerts: s.sealedRestockAlerts,
    };
  });

  test.beforeEach(async () => {
    if (!IS_REAL) return;
    // Encendido y tope de fábrica antes de CADA caso: uno que falla a mitad no contagia al siguiente.
    await putDials({
      wishlistEnabled: 'on',
      wishlistMaxPerAccount: originalDials?.wishlistMaxPerAccount ?? 20,
      sealedRestockAlerts: originalDials?.sealedRestockAlerts ?? 'off',
    });
    await clearRealList();
  });

  test.afterAll(async () => {
    if (!IS_REAL || !originalDials) return;
    // Con el dial apagado `GET /wishlist` es 404: se enciende, se vacía la lista y se reponen los diales de antes.
    await putDials({ wishlistEnabled: 'on' });
    await clearRealList();
    await putDials(originalDials);
  });

  test('@real WSH-F1 · ficha: solo los acabados de la carta, 5/10/16 con 10 marcado, botón con el acabado; invitado ⇒ a entrar', async ({ page }) => {
    await arrange(page);
    // Invitado primero: sin chips, con `next` de vuelta a la ficha.
    await page.goto(`/es/catalog/${CARDS.two.id}`);
    const guest = block(page);
    await expect(guest).toBeVisible();
    await expect(guest.getByRole('radio')).toHaveCount(0);
    const login = guest.getByRole('link', { name: W('guest.login') });
    expect(decodeURIComponent((await login.getAttribute('href')) ?? '')).toContain(`next=/catalog/${CARDS.two.id}`);

    await loginAs(page, ROLE);
    await page.reload();
    const b = block(page);
    const finishes = b.getByRole('radiogroup', { name: W('block.finishLegend') }).getByRole('radio');
    await expect(finishes).toHaveCount(2);
    expect(await finishes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([
      'normal',
      'reverse_holo',
    ]);
    const pcts = b.getByRole('radiogroup', { name: W('block.pctLegend') }).getByRole('radio');
    expect(await pcts.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(['5', '10', '16']);
    await expect(pcts.nth(1)).toBeChecked();
    await expect(b.locator('select')).toHaveCount(0);
    // B-3: la ficha preselecciona el primer acabado A LA VENTA (en el fixture, `reverse_holo`; en el seed, sin piezas,
    // el primero de la carta). Sea cual sea, el botón nombra EXACTAMENTE el acabado marcado…
    const checked = await finishes.evaluateAll((els) => (els as HTMLInputElement[]).find((e) => e.checked)?.value);
    expect(['normal', 'reverse_holo']).toContain(checked);
    await expect(b.getByRole('button', { name: W('block.add', { finish: F(checked!) }) })).toBeVisible();
    // …y sigue al acabado que se elige, en los dos sentidos.
    await b.getByText(F('normal'), { exact: true }).click();
    await expect(b.getByRole('button', { name: W('block.add', { finish: F('normal') }) })).toBeVisible();
    await b.getByText(F('reverse_holo'), { exact: true }).click();
    await expect(b.getByRole('button', { name: W('block.add', { finish: F('reverse_holo') }) })).toBeVisible();
    await expect(b.getByRole('button', { name: W('block.add', { finish: F('normal') }) })).toHaveCount(0);
  });

  test('@real WSH-F1 · tope y duplicado se explican: lista llena ⇒ cómo liberar lugar; ya en la lista ⇒ cambiar el %', async ({ page }) => {
    await loginAs(page, ROLE);
    await arrange(page, { items: [{ card: 'two', finish: 'normal', maxPct: 16 }], limit: 1 });
    await page.goto(`/es/catalog/${CARDS.two.id}`);
    const b = block(page);
    // B-3: se ELIGE el acabado guardado (no se da por hecho cuál viene marcado) ⇒ «ya en tu lista» con su %.
    await b.getByText(F('normal'), { exact: true }).click();
    await expect(b.getByText(W('block.inList', { finish: F('normal'), pct: 16 }))).toBeVisible();
    await expect(b.getByRole('button', { name: W('block.saveChange') })).toBeDisabled();
    // Otro acabado con la lista llena ⇒ el estado (c), con enlace a la lista y sin «Agregar».
    await b.getByText(F('reverse_holo'), { exact: true }).click();
    await expect(b.getByText(W('full.title', { count: 1, limit: 1 }))).toBeVisible();
    await expect(b.getByRole('link', { name: W('seeList') })).toHaveAttribute('href', /\/account\/wishlist$/);
    await expect(b.getByRole('button', { name: /Agregar/ })).toHaveCount(0);
  });

  test('@real WSH-F7 · los pesos bajo cada % son los del servidor y la cifra al guardar es la misma; sin mercado ⇒ sin cifra', async ({ page }) => {
    await loginAs(page, ROLE);
    await arrange(page);
    await page.goto(`/es/catalog/${CARDS.two.id}`);
    const b = block(page);
    const group = b.getByRole('radiogroup', { name: W('block.pctLegend') });
    // B-3: el acabado con mercado se ELIGE; no se asume que venga marcado.
    await b.getByText(F('normal'), { exact: true }).click();
    await expect(group.getByText(/^hasta MX\$/)).toHaveCount(3);
    const tenPesos = (await group.locator('label').nth(1).getByText(/^hasta MX\$/).textContent())!.replace('hasta ', '');
    await expect(b.getByText(t('es', 'common.ivaIncluded', { rate: 16 })).first()).toBeVisible();
    // Acabado sin mercado: ni una cifra.
    await b.getByText(F('reverse_holo'), { exact: true }).click();
    await expect(group.getByText(/MX\$/)).toHaveCount(0);
    await expect(b.getByText(W('block.noMarketLong'))).toBeVisible();
    // Vuelta al acabado con precio, guardar al 10 %: la cifra guardada = la del preview.
    await b.getByText(F('normal'), { exact: true }).click();
    await b.getByRole('button', { name: W('block.add', { finish: F('normal') }) }).click();
    await expect(b.getByText(W('maxToday', { amount: tenPesos }))).toBeVisible();
  });

  test('@real WSH-F2 · «Mi lista»: columnas, «aproximado», «sin precio de mercado», cambiar % y quitar', async ({ page }) => {
    await loginAs(page, ROLE);
    await arrange(page, {
      items: [
        { card: 'two', finish: 'normal', maxPct: 10 },
        { card: 'noMarket', finish: 'normal', maxPct: 5 },
      ],
    });
    await page.goto('/es/account/wishlist');
    await expect(page.getByRole('heading', { level: 1, name: W('page.title') })).toBeVisible();
    const rows = page.getByTestId('wishlist-row');
    await expect(rows).toHaveCount(2);
    const priced = rows.filter({ has: page.getByRole('heading', { name: CARDS.two.name }) });
    const bare = rows.filter({ has: page.getByRole('heading', { name: CARDS.noMarket.name }) });
    await expect(priced.getByText(W('row.maxPct', { pct: 10 }))).toBeVisible();
    await expect(priced.getByText(/^Hoy: hasta MX\$/)).toBeVisible();
    await expect(priced.getByText(W('approx'), { exact: true })).toBeVisible();
    await expect(bare.getByText(W('noMarket'), { exact: true })).toBeVisible();
    await expect(bare).not.toContainText('MX$0.00');

    // Cambiar el %: el select no guarda; «Guardar» sí.
    const before = await priced.getByText(/^Hoy: hasta MX\$/).textContent();
    await priced.getByLabel(W('row.pctLabel')).selectOption('16');
    await expect(priced.getByText(before!)).toBeVisible();
    await priced.getByRole('button', { name: W('row.save') }).click();
    await expect(priced.getByText(W('saved'))).toBeVisible();
    await expect(priced.getByText(W('row.maxPct', { pct: 16 }))).toBeVisible();
    await expect(priced.getByText(before!)).toHaveCount(0);

    // Quitar con «Deshacer».
    await bare
      .getByRole('button', { name: W('row.removeLabel', { card: CARDS.noMarket.name, finish: F('normal') }) })
      .click();
    await expect(page.getByRole('heading', { name: CARDS.noMarket.name })).toHaveCount(0);
    await page.getByRole('button', { name: W('row.undo') }).click();
    await expect(page.getByRole('heading', { name: CARDS.noMarket.name })).toBeVisible();
  });

  test('@real WSH-F6 · buscar una carta que la tienda nunca tuvo, abrir su ficha y agregarla; el buscador no pinta precios', async ({ page }) => {
    await loginAs(page, ROLE);
    await arrange(page);
    await page.goto('/es/account/wishlist');
    await page.getByLabel(W('page.searchLabel')).fill(CARDS.never.name);
    const results = page.getByTestId('wishlist-search-results');
    const link = results.getByRole('link', { name: new RegExp(CARDS.never.name) }).first();
    await expect(link).toBeVisible();
    await expect(results).not.toContainText('MX$');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${CARDS.never.id}$`));
    await expect(page.getByText(W('card.notHere'))).toBeVisible();
    const b = block(page);
    await b.getByRole('button', { name: W('block.add', { finish: F(NEVER_FINISH) }) }).click();
    await expect(b.getByText(W('block.inList', { finish: F(NEVER_FINISH), pct: 10 }))).toBeVisible();
    await page.goto('/es/account/wishlist');
    await expect(page.getByRole('heading', { name: CARDS.never.name })).toBeVisible();
  });

  test('@real WSH-F3 · la página del enlace pide UN clic, sin sesión; nada al cargar; el token sale de la barra; enlace no firmado ⇒ «no funciona»', async ({ page }) => {
    let posted = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/wishlist/mail-actions')) posted++;
    });
    await page.goto(`/es/lista-de-deseos/aviso?a=remove&id=${BOGUS_ID}&t=${BOGUS_TOKEN}`);
    await expect(page.getByRole('heading', { level: 1, name: W('mailAction.removeTitle') })).toBeVisible();
    await expect(page).not.toHaveURL(/t=/);
    expect(posted).toBe(0);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    // Un clic ⇒ el servidor no reconoce la firma ⇒ el texto de enlace inválido, nunca «quitada».
    await page.getByRole('button', { name: W('mailAction.removeCta') }).click();
    await expect(page.getByText(W('mailAction.invalid'))).toBeVisible();
    await expect(page.getByText(W('mailAction.removed'))).toHaveCount(0);
  });

  test('WSH-F3 · confirmar: con el token válido, un clic quita la carta y el botón desaparece', async ({ page }) => {
    mockOnly('token firmado por el servidor (HMAC): solo existe dentro del correo y el arnés no lee el buzón');
    await seedWishlist(page, { items: [stored('w-del', 'c-pikachu', 'normal', 10)] });
    await page.goto('/es/lista-de-deseos/aviso?a=remove&id=w-del&t=mock-token');
    await page.getByRole('button', { name: W('mailAction.removeCta') }).click();
    await expect(page.getByText(W('mailAction.removed'))).toBeVisible();
    await expect(page.getByRole('button', { name: W('mailAction.removeCta') })).toHaveCount(0);
  });

  test('@real WSH-F9 · con el dial apagado: el enlace del correo sigue pidiendo el clic; la lista y el bloque de la ficha no existen', async ({ page }) => {
    await arrange(page, { off: true });
    await page.goto(`/es/lista-de-deseos/aviso?a=pause&id=${BOGUS_ID}&t=${BOGUS_TOKEN}`);
    await expect(page.getByRole('heading', { level: 1, name: W('mailAction.pauseTitle') })).toBeVisible();
    await expect(page.getByRole('button', { name: W('mailAction.pauseCta') })).toBeEnabled();
    // Y en el mismo estado la lista con sesión no existe (WSH-5), ni el bloque de la ficha.
    await loginAs(page, ROLE);
    await page.goto('/es/account/wishlist');
    await expect(page.getByText(W('page.disabled'))).toBeVisible();
    await page.goto(`/es/catalog/${CARDS.two.id}`);
    await expect(page.getByRole('heading', { level: 1, name: CARDS.two.name })).toBeVisible();
    await expect(block(page)).toHaveCount(0);
  });

  test('WSH-F9 · confirmar con el dial apagado: «quitada» / «pausada»', async ({ page }) => {
    mockOnly('token firmado por el servidor (HMAC): solo existe dentro del correo y el arnés no lee el buzón');
    await seedWishlist(page, { items: [stored('w-off', 'c-pikachu', 'normal', 10)], off: true });
    await page.goto('/es/lista-de-deseos/aviso?a=remove&id=w-off&t=mock-token');
    await page.getByRole('button', { name: W('mailAction.removeCta') }).click();
    await expect(page.getByText(W('mailAction.removed'))).toBeVisible();
    await page.goto('/es/lista-de-deseos/aviso?a=pause&id=mail-1&t=mock-token');
    await page.getByRole('button', { name: W('mailAction.pauseCta') }).click();
    await expect(page.getByText(W('mailAction.paused'))).toBeVisible();
  });

  test('@real WSH-F4 / WSH-F8 · M9 «Lista de compra»: orden, sin datos personales, filtro en pantalla y CSV completo con su cabecera', async ({ page }) => {
    // Demanda: `customer2` busca dos cartas sin piezas, una con mercado y otra sin él (en mock: las filas del fixture).
    await loginAs(page, 'admin');
    await arrange(page, {
      items: [
        { card: 'two', finish: 'normal', maxPct: 10 },
        { card: 'noMarket', finish: 'normal', maxPct: 5 },
      ],
    });
    const real = IS_REAL
      ? await apiAsOk<{ rows: unknown[]; sealed: unknown[] }>('admin', 'GET', '/admin/reports/wishlist-demand')
      : null;
    const total = real ? real.rows.length : 3; // fixture: 3 filas (src/lib/mock/wishlist.ts DEMAND_ROWS)
    const sealedCount = real ? real.sealed.length : 1; // fixture: 1 sellado
    expect(total).toBeGreaterThanOrEqual(2);
    // Un nombre que aparece en UNA sola fila sirve de filtro.
    const needle = IS_REAL ? CARDS.two.name : 'Classic';
    const needleCell = IS_REAL ? `"${CARDS.two.name}"` : '"Classic Collection #3"';

    await page.goto('/es/admin/m9?tab=compra');
    await expect(page.getByRole('heading', { level: 2, name: B('title') })).toBeVisible();
    const articles = page.locator('article');
    await expect(articles).toHaveCount(total);
    // Orden por defecto del servidor: la fila sin mercado al final, sin «MX$0.00».
    await expect(articles.last()).toContainText(B('noMarket'));
    await expect(articles.last()).not.toContainText('MX$0.00');
    if (!IS_REAL) {
      // Oráculo del FIXTURE (pct en puntos porcentuales, tal cual): la cifra solo existe en el servidor falso.
      await expect(page.getByText('Si la pagas a mercado: pierdes MX$94.83 (−9.5 %)')).toBeVisible();
    }
    // Sin datos personales.
    expect(await page.locator('main').innerHTML()).not.toContain('@');
    // Filtro en el navegador ⇒ menos filas; el CSV trae TODAS (criterio 822 compara contra la pantalla sin filtros).
    await page.getByLabel(B('search')).fill(needle);
    await expect(articles).toHaveCount(1);
    await expect(page.getByText(B('filtered', { shown: 1, total }))).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: B('csv') }).click()]);
    const chunks = await (await download.createReadStream())?.toArray();
    const text = Buffer.concat((chunks ?? []) as Buffer[]).toString('utf8');
    const lines = text.replace(/\n$/, '').split('\n');
    // C2: cabecera literal de §WSH.8, las filas, una línea vacía, `sellados`, su cabecera y una línea por sellado.
    expect(lines[0]).toBe(CSV_HEAD);
    expect(lines).toHaveLength(1 + total + 3 + sealedCount);
    expect(lines[1 + total]).toBe('');
    expect(lines[2 + total]).toBe('sellados');
    expect(lines[3 + total]).toBe(CSV_SEALED_HEAD);
    expect(text).toContain(needleCell);
    expect(text).not.toContain('@');
    if (!IS_REAL) expect(text).toContain('-9.5');
    // Orden: un chip manda `sort` en la URL.
    await page.getByLabel(B('search')).fill('');
    await page.getByRole('button', { name: B('sort.wanted') }).click();
    await expect(page).toHaveURL(/sort=wanted/);
  });

  test('@real WSH-F4 · el operador no ve «Lista de compra» (M9 es solo súper-admin)', async ({ page }) => {
    await loginAs(page, 'operator');
    await page.goto('/es/admin/m9?tab=compra');
    await expect(page.getByRole('tab', { name: t('es', 'admin.m9.tabs.buyList') })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: B('title') })).toHaveCount(0);
  });

  test('@real WSH-F5 · ficha de sellado sin botón de deseos (con la lista de deseos encendida)', async ({ page }) => {
    // v1.87.4: el seed ya tiene un sellado a la venta (`E2E_SEALED_LISTED`); en mock, el del fixture. Mismo caso.
    await loginAs(page, ROLE);
    await arrange(page);
    await page.goto('/es/sellado');
    const tile = page.locator('a[href*="/sellado/"]').filter({ hasText: SEALED_TILE_RE }).first();
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page).toHaveURL(/\/sellado\/[^/?]+$/);
    // La ficha CARGÓ (si no, las dos ausencias de abajo pasarían en vacío)…
    await expect(page.getByRole('heading', { level: 1, name: SEALED_TILE_RE })).toBeVisible();
    // …y no trae el bloque de deseos ni su rótulo (los deseos son de cartas sueltas, §WSH).
    await expect(page.getByTestId('wishlist-block')).toHaveCount(0);
    await expect(page.getByText(W('eyebrow'), { exact: true })).toHaveCount(0);
  });

  /**
   * WSH-F5 · «avísame» de punta a punta (errata v1.87.3 B-1 + v1.87.4): desde la ficha, el cuerpo que manda la pantalla
   * es EXACTAMENTE `{ email, inventoryItemId }` con el `representativeItemId` de `GET /catalog/sealed/:id`, y la fila que
   * crea el servidor tiene la clave del PRODUCTO (`p:610000001:mint`), no la de la carta ancla (`c:…`, el defecto B-1).
   * El correo de «volvió» no se mide aquí (lo cubre la integración de backend, WSH-T42/T44: el arnés no lee el buzón).
   */
  test('@real WSH-F5 · «avísame» sin sesión: cuerpo {email, inventoryItemId} y la suscripción queda con la clave del producto', async ({ page }) => {
    realOnly('mide la fila que DERIVA el servidor (clave p:…); en mock el «avísame» responde FEATURE_DISABLED y no hay servidor que derive');
    await putDials({ sealedRestockAlerts: 'on' });
    const g = await sealedSeedGroup();
    const before = await sealedWaiting(SEALED_SEED.productName);
    const beforeAnchor = await sealedWaiting(SEALED_SEED.anchorCard);
    const email = freshEmail('guest');

    await page.goto('/es/sellado');
    await page.locator('a[href*="/sellado/"]').filter({ hasText: SEALED_SEED.productName }).first().click();
    await expect(page).toHaveURL(new RegExp(`/sellado/${g.tileId}$`));
    await expect(page.getByText(R('title'), { exact: true })).toBeVisible();
    await page.getByLabel(R('emailLabel')).fill(email);
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(RESTOCK_PATH)),
      page.getByRole('button', { name: R('cta') }).click(),
    ]);
    const body = req.postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['email', 'inventoryItemId']);
    expect(body).toEqual({ email, inventoryItemId: g.representativeItemId });
    expect((await req.response())?.status()).toBe(202);
    await expect(page.getByText(R('confirmed'))).toBeVisible();

    // La fila: +1 correo esperando el PRODUCTO (clave p:610000001:mint) y 0 en la clave de la carta ancla.
    expect(await sealedWaiting(SEALED_SEED.productName)).toBe(before + 1);
    expect(await sealedWaiting(SEALED_SEED.anchorCard)).toBe(beforeAnchor);
  });

  test('@real WSH-F5 · «avísame» con sesión: sin campo de correo, el de la cuenta, y la misma clave del producto', async ({ page }) => {
    realOnly('mide la fila que DERIVA el servidor (clave p:…); en mock el «avísame» responde FEATURE_DISABLED y no hay servidor que derive');
    await putDials({ sealedRestockAlerts: 'on' });
    const g = await sealedSeedGroup();
    // Cuenta NUEVA por corrida (`POST /auth/register`, público): un cliente del seed ya podría estar esperando este
    // producto desde una corrida anterior, y entonces el alta no sumaría (no se duplica la misma identidad, §WSH.7 b).
    const account = { email: freshEmail('account'), password: `Wsh-${Math.random().toString(36).slice(2)}-9aA` };
    const apiBase = await resolveApiBaseUrl();
    const reg = await fetch(`${apiBase}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...account, name: 'E2E Restock Account', phone: '5512345678', locale: 'es' }),
    });
    expect(reg.status).toBe(201);
    const userId = ((await reg.json()) as { user: { id: string } }).user.id;
    try {
      const before = await sealedWaiting(SEALED_SEED.productName);
      const beforeAnchor = await sealedWaiting(SEALED_SEED.anchorCard);
      await loginAsDisposable(page, account);
      await page.goto(`/es/sellado/${g.tileId}`);
      await expect(page.getByRole('heading', { level: 1, name: SEALED_SEED.productName })).toBeVisible();
      await expect(page.getByText(R('signedInAs', { email: account.email }))).toBeVisible();
      await expect(page.getByLabel(R('emailLabel'))).toHaveCount(0);
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(RESTOCK_PATH)),
        page.getByRole('button', { name: R('cta') }).click(),
      ]);
      const body = req.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['email', 'inventoryItemId']);
      expect(body).toEqual({ email: account.email, inventoryItemId: g.representativeItemId });
      expect((await req.response())?.status()).toBe(202);
      await expect(page.getByText(R('confirmed'))).toBeVisible();
      expect(await sealedWaiting(SEALED_SEED.productName)).toBe(before + 1);
      expect(await sealedWaiting(SEALED_SEED.anchorCard)).toBe(beforeAnchor);
    } finally {
      // Sin historial económico ⇒ borrado en duro (§«Eliminar usuario — híbrido hard/soft»), que además borra sus
      // suscripciones «avísame» (`admin.service.ts` `restockSubscriptionsOf`): la medición de arriba es ANTES del borrado.
      await apiAsOk('admin', 'DELETE', `/admin/users/${userId}`);
    }
  });

  test('@real WSH-F10 · criterio 824: /es/privacidad y /en/privacidad, sin sesión, traen el párrafo «Lista de deseos» literal', async ({ page }) => {
    const plain = (s: string) => s.replace(/\*\*/g, '');
    await page.goto('/es/privacidad');
    const es = page.locator('article p').filter({ hasText: 'Lista de deseos.' });
    await expect(es).toHaveCount(1);
    await expect(es).toHaveText(plain(WISHLIST_PRIVACY_ES));
    await expect(page.locator('article p[lang="en"]').filter({ hasText: 'Wishlist.' })).toHaveCount(0);
    await expect(page.locator('section#finalidades-primarias [lang="en"]')).toHaveCount(0);
    await page.goto('/en/privacidad');
    const en = page.locator('article p[lang="en"]').filter({ hasText: 'Wishlist.' });
    await expect(en).toHaveCount(1);
    await expect(en).toHaveText(plain(WISHLIST_PRIVACY_EN));
    // El aviso (en español) sigue completo en inglés, con el mismo párrafo.
    await expect(page.locator('article p').filter({ hasText: 'Lista de deseos.' })).toHaveText(plain(WISHLIST_PRIVACY_ES));
    // WSH-UX-15 (DESIGN_SYSTEM «WSH-UX.v1.87.3» c): el inglés va JUSTO debajo del español, dentro del apartado 3.
    const prev = await page
      .locator('section#finalidades-primarias p[lang="en"]')
      .filter({ hasText: 'Wishlist.' })
      .evaluate((el) => {
        const p = el.previousElementSibling;
        return p ? { tag: p.tagName, lang: p.getAttribute('lang'), text: (p.textContent ?? '').slice(0, 16) } : null;
      });
    expect(prev).toEqual({ tag: 'P', lang: null, text: 'Lista de deseos.' });
  });
});
