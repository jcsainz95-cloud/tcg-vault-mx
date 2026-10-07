import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * §WSH · Lista de deseos — WSH-F1…F9 (API_CONTRACT §WSH.9 + errata v1.87.1; DESIGN_SYSTEM §WSH-UX).
 *
 * TODOS `mockOnly`, y el motivo es concreto (no «no supe escribirlo agnóstico»): el módulo `wishlist` del backend se
 * construye EN PARALELO a este spec y el seed real no tiene ni el dial encendido ni deseos ni la lista de compra; los
 * casos usan el estado del servidor FALSO (`src/lib/mock/wishlist.ts`, banderas en `localStorage`, token `mock-token`)
 * y cartas del fixture (`c-pikachu`, `c-cel25-7`). El día que exista el backend, la versión `@real` se escribe contra
 * datos sembrados por `POST /wishlist` (NO MEDIDO hoy: no hay backend que medir).
 *
 * Cifras: las del contrato (M = MX$1,000.00 ⇒ 5/10/16 % = MX$1,050 / 1,100 / 1,160 con IVA dentro, WSH-T31). El
 * spec las LEE de la pantalla y las compara entre sí (preview = guardado): no las recalcula.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

const W = (k: string, vars?: Record<string, string | number>) => t('es', `wishlist.${k}`, vars);
const B = (k: string, vars?: Record<string, string | number>) => t('es', `admin.m9.buyList.${k}`, vars);

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

test.describe('§WSH · lista de deseos (mock)', () => {
  test('WSH-F1 · ficha: solo los acabados de la carta, 5/10/16 con 10 marcado, botón con el acabado; invitado ⇒ a entrar', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; estado del servidor falso');
    // Invitado primero: sin chips, con `next` de vuelta a la ficha.
    await seedWishlist(page);
    await page.goto('/es/catalog/c-pikachu');
    const guest = block(page);
    await expect(guest).toBeVisible();
    await expect(guest.getByRole('radio')).toHaveCount(0);
    const login = guest.getByRole('link', { name: W('guest.login') });
    expect(decodeURIComponent((await login.getAttribute('href')) ?? '')).toContain('next=/catalog/c-pikachu');

    await loginAs(page, 'customer');
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
    await expect(b.getByRole('button', { name: W('block.add', { finish: t('es', 'finish.normal') }) })).toBeVisible();
    await b.getByText(t('es', 'finish.reverse_holo'), { exact: true }).click();
    await expect(b.getByRole('button', { name: W('block.add', { finish: t('es', 'finish.reverse_holo') }) })).toBeVisible();
  });

  test('WSH-F1 · tope y duplicado se explican: lista llena ⇒ cómo liberar lugar; ya en la lista ⇒ cambiar el %', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; estado del servidor falso');
    await loginAs(page, 'customer');
    await seedWishlist(page, { items: [stored('w-ya', 'c-pikachu', 'normal', 16)], limit: 1 });
    await page.goto('/es/catalog/c-pikachu');
    const b = block(page);
    // El acabado guardado ⇒ estado «ya en tu lista» con su %.
    await expect(b.getByText(W('block.inList', { finish: t('es', 'finish.normal'), pct: 16 }))).toBeVisible();
    await expect(b.getByRole('button', { name: W('block.saveChange') })).toBeDisabled();
    // Otro acabado con la lista llena ⇒ el estado (c), con enlace a la lista y sin «Agregar».
    await b.getByText(t('es', 'finish.reverse_holo'), { exact: true }).click();
    await expect(b.getByText(W('full.title', { count: 1, limit: 1 }))).toBeVisible();
    await expect(b.getByRole('link', { name: W('seeList') })).toHaveAttribute('href', /\/account\/wishlist$/);
    await expect(b.getByRole('button', { name: /Agregar/ })).toHaveCount(0);
  });

  test('WSH-F7 · los pesos bajo cada % son los del servidor y la cifra al guardar es la misma; sin mercado ⇒ sin cifra', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; estado del servidor falso');
    await loginAs(page, 'customer');
    await seedWishlist(page);
    await page.goto('/es/catalog/c-pikachu');
    const b = block(page);
    const group = b.getByRole('radiogroup', { name: W('block.pctLegend') });
    await expect(group.getByText(/^hasta MX\$/)).toHaveCount(3);
    const tenPesos = (await group.locator('label').nth(1).getByText(/^hasta MX\$/).textContent())!.replace('hasta ', '');
    await expect(b.getByText(t('es', 'common.ivaIncluded', { rate: 16 })).first()).toBeVisible();
    // Acabado sin mercado: ni una cifra.
    await b.getByText(t('es', 'finish.reverse_holo'), { exact: true }).click();
    await expect(group.getByText(/MX\$/)).toHaveCount(0);
    await expect(b.getByText(W('block.noMarketLong'))).toBeVisible();
    // Vuelta al acabado con precio, guardar al 10 %: la cifra guardada = la del preview.
    await b.getByText(t('es', 'finish.normal'), { exact: true }).click();
    await b.getByRole('button', { name: W('block.add', { finish: t('es', 'finish.normal') }) }).click();
    await expect(b.getByText(W('maxToday', { amount: tenPesos }))).toBeVisible();
  });

  test('WSH-F2 · «Mi lista»: columnas, «aproximado», «sin precio de mercado», cambiar % y quitar', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; estado del servidor falso');
    await loginAs(page, 'customer');
    await seedWishlist(page, {
      items: [stored('w-pika', 'c-pikachu', 'normal', 10), stored('w-zap', 'c-zapdos', 'normal', 5)],
    });
    await page.goto('/es/account/wishlist');
    await expect(page.getByRole('heading', { level: 1, name: W('page.title') })).toBeVisible();
    const pika = page.getByTestId('wishlist-row').filter({ has: page.getByRole('heading', { name: 'Pikachu' }) });
    const zap = page.getByTestId('wishlist-row').filter({ has: page.getByRole('heading', { name: 'Zapdos' }) });
    await expect(pika.getByText(W('row.maxPct', { pct: 10 }))).toBeVisible();
    await expect(pika.getByText(/^Hoy: hasta MX\$/)).toBeVisible();
    await expect(pika.getByText(W('approx'), { exact: true })).toBeVisible();
    await expect(zap.getByText(W('noMarket'), { exact: true })).toBeVisible();
    await expect(zap).not.toContainText('MX$0.00');

    // Cambiar el %: el select no guarda; «Guardar» sí.
    const before = await pika.getByText(/^Hoy: hasta MX\$/).textContent();
    await pika.getByLabel(W('row.pctLabel')).selectOption('16');
    await expect(pika.getByText(before!)).toBeVisible();
    await pika.getByRole('button', { name: W('row.save') }).click();
    await expect(pika.getByText(W('saved'))).toBeVisible();
    await expect(pika.getByText(W('row.maxPct', { pct: 16 }))).toBeVisible();

    // Quitar con «Deshacer».
    await zap.getByRole('button', { name: W('row.removeLabel', { card: 'Zapdos', finish: t('es', 'finish.normal') }) }).click();
    await expect(page.getByRole('heading', { name: 'Zapdos' })).toHaveCount(0);
    await page.getByRole('button', { name: W('row.undo') }).click();
    await expect(page.getByRole('heading', { name: 'Zapdos' })).toBeVisible();
  });

  test('WSH-F6 · buscar una carta que la tienda nunca tuvo, abrir su ficha y agregarla; el buscador no pinta precios', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; carta del fixture (Celebrations, sin piezas)');
    await loginAs(page, 'customer');
    await seedWishlist(page);
    await page.goto('/es/account/wishlist');
    await page.getByLabel(W('page.searchLabel')).fill('Celebrations #7');
    const results = page.getByTestId('wishlist-search-results');
    const link = results.getByRole('link', { name: /Celebrations #7/ }).first();
    await expect(link).toBeVisible();
    await expect(results).not.toContainText('MX$');
    await link.click();
    await expect(page).toHaveURL(/\/catalog\/c-cel25-7$/);
    await expect(page.getByText(W('card.notHere'))).toBeVisible();
    const b = block(page);
    await b.getByRole('button', { name: W('block.add', { finish: t('es', 'finish.holofoil') }) }).click();
    await expect(b.getByText(W('block.inList', { finish: t('es', 'finish.holofoil'), pct: 10 }))).toBeVisible();
    await page.goto('/es/account/wishlist');
    await expect(page.getByRole('heading', { name: 'Celebrations #7' })).toBeVisible();
  });

  test('WSH-F3 · la página del enlace pide UN clic, sin sesión, y confirma; el token sale de la barra', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; token del servidor falso (`mock-token`)');
    await seedWishlist(page, { items: [stored('w-del', 'c-pikachu', 'normal', 10)] });
    let posted = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/wishlist/mail-actions')) posted++;
    });
    await page.goto('/es/lista-de-deseos/aviso?a=remove&id=w-del&t=mock-token');
    await expect(page.getByRole('heading', { level: 1, name: W('mailAction.removeTitle') })).toBeVisible();
    await expect(page).not.toHaveURL(/t=/);
    expect(posted).toBe(0);
    await page.getByRole('button', { name: W('mailAction.removeCta') }).click();
    await expect(page.getByText(W('mailAction.removed'))).toBeVisible();
    await expect(page.getByRole('button', { name: W('mailAction.removeCta') })).toHaveCount(0);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });

  test('WSH-F9 · con el dial apagado, la página del enlace sigue pidiendo el clic y confirma «quitada» / «pausada»', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; dial apagado del servidor falso');
    await seedWishlist(page, { items: [stored('w-off', 'c-pikachu', 'normal', 10)], off: true });
    await page.goto('/es/lista-de-deseos/aviso?a=remove&id=w-off&t=mock-token');
    await page.getByRole('button', { name: W('mailAction.removeCta') }).click();
    await expect(page.getByText(W('mailAction.removed'))).toBeVisible();
    await page.goto('/es/lista-de-deseos/aviso?a=pause&id=mail-1&t=mock-token');
    await page.getByRole('button', { name: W('mailAction.pauseCta') }).click();
    await expect(page.getByText(W('mailAction.paused'))).toBeVisible();
    // Y en el mismo estado la lista con sesión no existe (WSH-5).
    await loginAs(page, 'customer');
    await page.goto('/es/account/wishlist');
    await expect(page.getByText(W('page.disabled'))).toBeVisible();
  });

  test('WSH-F4 / WSH-F8 · M9 «Lista de compra»: solo súper-admin, orden, sin datos personales, filtro en pantalla y CSV completo', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; filas del servidor falso');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m9?tab=compra');
    await expect(page.getByRole('heading', { level: 2, name: B('title') })).toBeVisible();
    const articles = page.locator('article');
    await expect(articles).toHaveCount(3);
    // Orden por defecto del servidor: la fila sin mercado al final.
    await expect(articles.last()).toContainText(B('noMarket'));
    await expect(articles.last()).not.toContainText('MX$0.00');
    // pct en puntos porcentuales, tal cual.
    await expect(page.getByText('Si la pagas a mercado: pierdes MX$94.83 (−9.5 %)')).toBeVisible();
    // Sin datos personales.
    expect(await page.locator('main').innerHTML()).not.toContain('@');
    // Filtro en el navegador ⇒ menos filas; el CSV trae TODAS.
    await page.getByLabel(B('search')).fill('Classic');
    await expect(articles).toHaveCount(1);
    await expect(page.getByText(B('filtered', { shown: 1, total: 3 }))).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: B('csv') }).click()]);
    const csv = await (await download.createReadStream())?.toArray();
    const text = Buffer.concat((csv ?? []) as Buffer[]).toString('utf8');
    expect(text.trim().split('\n')).toHaveLength(1 + 3);
    expect(text).toContain('-9.5');
    // Orden: un chip manda `sort` en la URL.
    await page.getByLabel(B('search')).fill('');
    await page.getByRole('button', { name: B('sort.wanted') }).click();
    await expect(page).toHaveURL(/sort=wanted/);
  });

  test('WSH-F4 · el operador no ve «Lista de compra» (M9 es solo súper-admin)', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; sesión del arnés mock');
    await loginAs(page, 'operator');
    await page.goto('/es/admin/m9?tab=compra');
    await expect(page.getByRole('heading', { level: 2, name: B('title') })).toHaveCount(0);
  });

  test('WSH-F5 · ficha de sellado sin botón de deseos', async ({ page }) => {
    mockOnly('el backend de §WSH se construye en paralelo; sellado del fixture');
    await loginAs(page, 'customer');
    await seedWishlist(page);
    await page.goto('/es/sellado');
    const first = page.locator('a[href*="/sellado/"]').first();
    await first.click();
    await expect(page).toHaveURL(/\/sellado\/[^/]+$/);
    await expect(page.getByTestId('wishlist-block')).toHaveCount(0);
    await expect(page.getByText(W('eyebrow'), { exact: true })).toHaveCount(0);
  });
});
