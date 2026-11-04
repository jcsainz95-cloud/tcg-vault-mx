import { expect, test, type Page, type Route } from '@playwright/test';
import { imageOptimizerOrigins } from '../src/lib/image-optimizer-hosts.mjs';

/**
 * 🔒 DYN-F8 (b, c), DYN-F9 y DYN-F10 en el NAVEGADOR — API_CONTRACT §DYN.6.6, ARCHITECTURE §4.DYN (f) 7 (opción A del
 * dueño, `HECHOS` 2026-10-30; «Pásalas por el reductor», `HECHOS` 2026-11-04): la foto de la teja líder de Destacadas
 * Y las de sus tejas secundarias viajan por `/_next/image` (WebP 384/640, q 75) cuando su origen está en
 * `images.remotePatterns`; si no (DYN-F10), la teja va cruda desde el principio, sin pedir el optimizador.
 *
 * El optimizador del servidor no siempre puede bajar la foto en el entorno de pruebas (sin salida a internet; el seed
 * apunta a `img.e2e.local`). Por eso aquí se intercepta `/_next/image` DESDE EL NAVEGADOR: lo que se mide es QUÉ
 * pide la página y qué hace cuando el optimizador responde (bien o con 500), no la transformación. La transformación
 * real (200 `image/webp`) la mide el arnés de `home-perf` (DYN-D3, devops).
 * Los asertos son de ESTRUCTURA (no de fixture): valen en mocks y contra el stack (`@real`). El único dato de fixture
 * que entra es el ORIGEN de cada foto, y entra para decir qué debe pasar con ella (optimizador o cruda), no cuál es.
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

/**
 * Las `<img>` de la pista tal como salen en el HTML del servidor (DYN-F2: Destacadas viaja en el HTML), en orden:
 * la líder primero. Por cada una, su `src` y —si pasa por el optimizador— la URL original que envuelve. Se lee del
 * HTML y no del DOM porque, con el optimizador y la original rotos, las `<img>` desaparecen del DOM (DYN-F9).
 */
function trackImagesInHtml(html: string, origin: string): { src: string; original: string | null }[] {
  const start = html.indexOf(`id="${TRACK.slice(1)}"`);
  expect(start, 'la pista de Destacadas está en el HTML del servidor').toBeGreaterThan(-1);
  const section = html.slice(start, html.indexOf('</section>', start));
  return [...section.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => {
    const src = m[1].replace(/&amp;/g, '&');
    const u = new URL(src, origin);
    return { src, original: u.pathname === '/_next/image' ? u.searchParams.get('url') : null };
  });
}

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

  test('@real (DYN-F10) cada <img> de la pista pasa por /_next/image si y solo si su origen está en remotePatterns', async ({
    page,
    baseURL,
  }) => {
    await serveCardArt(page, baseURL);
    await page.route('**/_next/image?**', (route) => route.fulfill({ status: 200, contentType: 'image/webp', body: WEBP }));
    const response = await page.goto('/es');
    const imgs = trackImagesInHtml((await response!.text()) ?? '', new URL(baseURL ?? 'http://localhost').origin);
    const origins = imageOptimizerOrigins();
    expect(origins.length).toBeGreaterThan(0);
    // Líder + al menos una teja: si solo hubiera una `<img>`, esto no mediría las tejas.
    expect(imgs.length).toBeGreaterThan(1);
    for (const { src, original } of imgs) {
      const photo = original ?? src;
      const allowed = origins.includes(new URL(photo).origin);
      expect(original !== null, `${photo}: ${allowed ? 'DEBE' : 'NO debe'} pasar por /_next/image`).toBe(allowed);
    }
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

  test('@real con la original también rota: el pozo sin imagen rota, sin bucle (líder y tejas)', async ({ page, baseURL }) => {
    const asked = await serveCardArt(page, baseURL, 404);
    const originals = new Set<string>();
    await page.route('**/_next/image?**', (route) => {
      originals.add(new URL(route.request().url()).searchParams.get('url') ?? '');
      return route.fulfill({ status: 500, contentType: 'text/plain', body: 'optimizer down' });
    });
    const response = await page.goto('/es');
    const own = new URL(baseURL ?? 'http://localhost').origin;
    const imgs = trackImagesInHtml((await response!.text()) ?? '', own);
    const tile = lead(page);
    await expect(tile).toBeVisible();
    await expect(tile.locator('img')).toHaveCount(0);
    await page.waitForTimeout(1500);
    // La misma carta puede estar en OTRA superficie de la portada con `<img>` cruda (nivel B: «Cartas gradeadas»,
    // «Joyas para gradear»; en mocks, Latias ex está en Destacadas y en gradeadas). Esa `<img>` pide la original una
    // vez por derecho propio y no es un respaldo: se cuentan las que ya se pidieron (`complete`) fuera de la pista.
    const elsewhere = await page.evaluate((track) => {
      const out: Record<string, number> = {};
      for (const img of Array.from(document.querySelectorAll('img'))) {
        if (img.closest(track) || !img.complete) continue;
        const src = img.getAttribute('src') ?? '';
        out[src] = (out[src] ?? 0) + 1;
      }
      return out;
    }, TRACK);
    const budget = (original: string) => 1 + (elsewhere[original] ?? 0);
    // (a) La líder está entre lo que se pidió al optimizador y su original se pidió UNA vez (el respaldo), nunca en bucle.
    const leadOriginal = imgs[0]?.original;
    expect(leadOriginal, 'la líder sale del servidor por /_next/image').toBeTruthy();
    expect(originals.has(leadOriginal!)).toBe(true);
    expect(asked.filter((u) => u === leadOriginal).length).toBeGreaterThanOrEqual(1);
    expect(asked.filter((u) => u === leadOriginal).length).toBeLessThanOrEqual(budget(leadOriginal!));
    // (b) Las tejas también lo piden (desde 2026-11-04) y CADA original se pidió como máximo una vez como respaldo:
    // sin bucle para ninguna (un bucle suma peticiones por encima del presupuesto de esa URL).
    expect(originals.size).toBeGreaterThan(1);
    for (const original of originals) {
      expect(asked.filter((u) => u === original).length, `${original}: respaldo una vez, nunca en bucle`).toBeLessThanOrEqual(
        budget(original),
      );
    }
    // Solo originales de la pista (ninguna otra superficie pide el optimizador, DYN-F8).
    const pista = new Set(imgs.map((i) => i.original).filter((o): o is string => o !== null));
    for (const original of originals) expect(pista.has(original), `${original} es de una teja de Destacadas`).toBe(true);
  });
});
