import { expect, test, type Page } from '@playwright/test';

/**
 * 🔒 DYN-F10 (d) · API_CONTRACT §DYN.6.7, ARCHITECTURE §4.DYN (f) 8 — los textos viajan POR RUTA (la raíz manda solo
 * `SHELL`; la portada `home`; el resto `storefront`). El riesgo que mide: una navegación de CLIENTE no vuelve a pintar
 * la raíz, así que si una página no trajera su ámbito, se quedaría con los textos de la anterior y la consola diría
 * `MISSING_MESSAGE` (next-intl hace `console.error` por defecto, también en producción).
 *
 * Recorrido, en es y en, por clics (navegación de cliente: una marca en `window` sobrevive de punta a punta):
 * portada → catálogo → ficha → sellado → vender (buylist) → «Mi cuenta» (login) → portada. 0 `MISSING_MESSAGE`.
 * La ficha → sellado pasa por «Comprar» (catálogo) y la pestaña «Producto sellado»: la ficha no enlaza el sellado.
 */
async function clickAndWait(page: Page, link: ReturnType<Page['locator']>, url: RegExp) {
  await link.click();
  await expect(page).toHaveURL(url);
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

for (const locale of ['es', 'en'] as const) {
  test(`@real (d) ${locale}: portada → catálogo → ficha → sellado → buylist → login → portada sin MISSING_MESSAGE`, async ({
    page,
  }) => {
    const missing: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('MISSING_MESSAGE')) missing.push(`${page.url()} · ${msg.text().slice(0, 200)}`);
    });
    page.on('pageerror', (err) => {
      if (String(err.message).includes('MISSING_MESSAGE')) missing.push(`${page.url()} · ${err.message.slice(0, 200)}`);
    });

    await page.goto(`/${locale}`);
    await expect(page.locator('#piezas-destacadas')).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __rmMark: number }).__rmMark = 1));
    const header = page.locator('header').first();

    await clickAndWait(page, header.locator(`a[href="/${locale}/catalog"]:visible`).first(), new RegExp(`/${locale}/catalog$`));
    await clickAndWait(
      page,
      page.locator(`main a[href^="/${locale}/catalog/"]:visible`).first(),
      new RegExp(`/${locale}/catalog/[^/?]+`),
    );
    await clickAndWait(page, header.locator(`a[href="/${locale}/catalog"]:visible`).first(), new RegExp(`/${locale}/catalog$`));
    await clickAndWait(page, page.locator(`main a[href="/${locale}/sellado"]:visible`).first(), new RegExp(`/${locale}/sellado$`));
    await clickAndWait(page, header.locator(`a[href="/${locale}/buylist"]:visible`).first(), new RegExp(`/${locale}/buylist$`));
    await clickAndWait(page, header.locator(`a[href="/${locale}/login"]:visible`).first(), new RegExp(`/${locale}/login`));
    await clickAndWait(page, page.locator(`a[href="/${locale}"]:visible`).first(), new RegExp(`/${locale}$`));
    await expect(page.locator('#piezas-destacadas')).toBeVisible();

    // Navegación de cliente de punta a punta (una recarga habría borrado la marca y pintado la raíz de nuevo).
    expect(await page.evaluate(() => (window as unknown as { __rmMark?: number }).__rmMark)).toBe(1);
    expect(missing).toEqual([]);
  });
}
