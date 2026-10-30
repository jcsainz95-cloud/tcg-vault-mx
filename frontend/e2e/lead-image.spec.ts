import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * 🔒 DYN-F8 (b, c) y DYN-F9 en el NAVEGADOR — API_CONTRACT §DYN.6.6, ARCHITECTURE §4.DYN (f) 7 (opción A del dueño,
 * `HECHOS` 2026-10-30): la foto de la teja líder de Destacadas viaja por `/_next/image` (WebP 384/640, q 75).
 *
 * El optimizador del servidor no siempre puede bajar la foto en el entorno de pruebas (sin salida a internet; el seed
 * apunta a `img.e2e.local`). Por eso aquí se intercepta `/_next/image` DESDE EL NAVEGADOR: lo que se mide es QUÉ
 * pide la página y qué hace cuando el optimizador responde (bien o con 500), no la transformación. La transformación
 * real (200 `image/webp`) la mide el arnés de `home-perf` (DYN-D3, devops).
 * Los asertos son de ESTRUCTURA (no de fixture): valen en mocks y contra el stack (`@real`).
 */
const TRACK = '#piezas-destacadas-pista';
// 2×2 px válidos (generados con sharp): el navegador los decodifica (naturalWidth > 0).
const WEBP = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAACwAQCdASoCAAIAAUAmJaACdLoABDAAAP7x3I/4DdfFtMv/vYL/3YL/3YL/WwAA', 'base64');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const isOptimizer = (url: string) => new URL(url).pathname === '/_next/image';

/** Toda imagen de un host ajeno (el arte de carta) se sirve aquí: el entorno no tiene red. Devuelve las URL pedidas. */
async function serveCardArt(page: Page, baseURL: string | undefined, status = 200): Promise<string[]> {
  const asked: string[] = [];
  const own = new URL(baseURL ?? 'http://localhost').origin;
  await page.route('**/*', async (route: Route) => {
    const req = route.request();
    if (req.resourceType() !== 'image' || new URL(req.url()).origin === own) return route.fallback();
    asked.push(req.url());
    return status === 200
      ? route.fulfill({ status, contentType: 'image/png', body: PNG })
      : route.fulfill({ status, contentType: 'text/plain', body: 'no' });
  });
  return asked;
}

const lead = (page: Page) => page.locator(`${TRACK} > a`).first();

test.describe('DYN-F8 · la foto líder por /_next/image', () => {
  test('@real (c) en /es la líder viaja por /_next/image y NO se pide su URL original', async ({ page, baseURL }) => {
    const asked = await serveCardArt(page, baseURL);
    const optimizer: string[] = [];
    await page.route('**/_next/image?**', (route) => {
      optimizer.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'image/webp', body: WEBP });
    });
    await page.goto('/es');
    const img = lead(page).locator('img');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const current = await img.evaluate((i: HTMLImageElement) => i.currentSrc);
    expect(isOptimizer(current)).toBe(true);
    const original = new URL(current).searchParams.get('url');
    expect(original).toBeTruthy();
    expect(new URL(current).searchParams.get('q')).toBe('75');
    expect(['384', '640']).toContain(new URL(current).searchParams.get('w'));
    expect(optimizer.length).toBeGreaterThan(0);
    // Ni la `<img>` ni la precarga piden la original (doble descarga).
    expect(asked.filter((u) => u === original)).toEqual([]);
  });

  test('(b) contra el servidor: solo w ∈ {384, 640} y q = 75; w=1080 o q=90 ⇒ 400', async ({ request }) => {
    const url = (w: number, q: number) =>
      `/_next/image?url=${encodeURIComponent('https://images.scrydex.com/pokemon/me5-88/large')}&w=${w}&q=${q}`;
    expect((await request.get(url(1080, 75))).status(), 'w=1080').toBe(400);
    expect((await request.get(url(640, 90))).status(), 'q=90').toBe(400);
    // Los admitidos pasan el portero de parámetros (sin red, la descarga aguas arriba puede fallar con 5xx).
    for (const w of [384, 640]) expect((await request.get(url(w, 75))).status(), `w=${w}`).not.toBe(400);
  });
});

test.describe('DYN-F9 · si el optimizador falla, la líder cae UNA vez a la original', () => {
  test('@real /_next/image con 500 ⇒ la original, sin srcset, pedida una vez, y se pinta', async ({ page, baseURL }) => {
    const asked = await serveCardArt(page, baseURL);
    let optimizerHits = 0;
    await page.route('**/_next/image?**', (route) => {
      optimizerHits += 1;
      return route.fulfill({ status: 500, contentType: 'text/plain', body: 'optimizer down' });
    });
    await page.goto('/es');
    const img = lead(page).locator('img');
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => new URL(i.currentSrc || i.src).pathname !== '/_next/image'))
      .toBe(true);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(img).not.toHaveAttribute('srcset');
    await expect(img).toBeVisible();
    const original = await img.getAttribute('src');
    expect(optimizerHits).toBeGreaterThan(0);
    // Una sola vez: sin reintentos en bucle. (Se deja correr un poco más para que un bucle se notara.)
    await page.waitForTimeout(1500);
    expect(asked.filter((u) => u === original)).toHaveLength(1);
  });

  test('@real con la original también rota: el pozo sin imagen rota, sin bucle', async ({ page, baseURL }) => {
    const asked = await serveCardArt(page, baseURL, 404);
    const originals = new Set<string>();
    await page.route('**/_next/image?**', (route) => {
      originals.add(new URL(route.request().url()).searchParams.get('url') ?? '');
      return route.fulfill({ status: 500, contentType: 'text/plain', body: 'optimizer down' });
    });
    await page.goto('/es');
    const tile = lead(page);
    await expect(tile).toBeVisible();
    await expect(tile.locator('img')).toHaveCount(0);
    await page.waitForTimeout(1500);
    // La original de la líder se pidió UNA vez (el respaldo), nunca en bucle.
    expect(originals.size).toBe(1);
    const [original] = [...originals];
    expect(asked.filter((u) => u === original)).toHaveLength(1);
  });
});
