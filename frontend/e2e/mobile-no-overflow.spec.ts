import { test, expect, type Page } from '@playwright/test';

/**
 * B5 (BRIEF_MKT §4 Ola 1) — la portada y el catálogo NO desbordan a lo ancho en móvil: con la emulación móvil de
 * Chromium (`isMobile`), un desborde no aparece como barra de scroll sino como un LAYOUT más ancho que el aparato
 * (el navegador se aleja para que quepa): producción medía `innerWidth` = 677 px en un teléfono de 390 px
 * (diagnóstico 2026-10-30, `mobile-steps.json`). Por eso aquí se compara con el ANCHO CONFIGURADO, no con
 * `innerWidth`: con `isMobile` el desborde también estira `innerWidth` y `scrollWidth == innerWidth` saldría verde.
 *
 * Causa medida (2026-10-31): el `sr-only` («aproximadamente») de la cifra de gradeo de una teja de «Destacadas» es
 * `position:absolute` y su bloque contenedor era <body>, no la pista `overflow-x:auto` ⇒ escapaba del recorte del
 * scroll y estiraba el documento hasta la teja donde caía. Arreglo: `relative` en la pista (`FeaturedCarousel.tsx`).
 * Mutación: quitar ese `relative` ⇒ portada roja en los tres anchos (mocks: 853 px).
 *
 * Etiqueta `@real`: es conducta de layout y corre igual contra el stack sembrado.
 */
const WIDTHS = [360, 390, 414] as const;
const PAGES = [
  { name: 'portada', path: '/es', ready: (p: Page) => p.locator('#piezas-destacadas-pista a').first().waitFor() },
  { name: 'catálogo', path: '/es/catalog', ready: (p: Page) => p.locator('main a[href*="/catalog/"]').first().waitFor() },
] as const;

for (const width of WIDTHS) {
  test.describe(`B5 · ${width} px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    for (const pg of PAGES) {
      test(`${pg.name}: layout = ${width} px (innerWidth y scrollWidth) @real`, async ({ page }) => {
        await page.goto(pg.path);
        await pg.ready(page);
        // Tras pintar las tejas y sus cifras (las que traen el `sr-only` del desborde original).
        await page.waitForLoadState('networkidle');
        const m = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(m, `${pg.name} a ${width} px`).toEqual({ innerWidth: width, scrollWidth: width });
      });
    }
  });
}
