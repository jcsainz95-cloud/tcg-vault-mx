import { test, expect, type Page } from '@playwright/test';
import { IS_REAL, mockOnly } from './utils/auth';
import { apiAsOk } from './utils/env';

/**
 * §IDS (API_CONTRACT §IDS.5/§IDS.9 IDS-F3/F6; DESIGN_SYSTEM §IDS-UX.6/.8) — candados de NAVEGADOR del selector de
 * versión en burbujas y de la teja con insignias. Geometría real (Chromium), no clases.
 *  (9)  a 360 px las burbujas ES caben sin envolver y las EN de liga crecen sin desbordar;
 *  (10) cada burbuja ≥ 44 px de alto (171×64 a 390);
 *  (11) ninguna versión agotada en el DOM (N burbujas = N entradas de `versions[]`);
 *  (12) con una sola versión no hay `radiogroup`;
 *  (14) el borde de la burbuja se computa como `--color-border-control` (rgba(26,26,24,.55)), no `-strong`;
 *  (16) forma 2×N: un rótulo por fila (12 px arriba / 6 px abajo), sin insignia dentro, un solo tab-stop;
 *  (6)  la insignia de la teja nunca es hija del contenedor de la foto;
 *  (15) la ficha técnica de la teja no envuelve a 360 (en mocks, con el `finishLabel` de 11 caracteres «Cosmos Holo»).
 * Corren en los DOS modos (`@real`), cada uno con sus datos (`target()`):
 *  - mocks: fixtures del simulador (`c-ids-dedenne-084` 2×2, `c-ids-pikachu-057` 2×N de 6, `c-charizard` de una versión;
 *    `lib/mock/fixtures.ts`);
 *  - stack sembrado: «E2E League Bird» (`E2E_IDS` de `backend/prisma/e2e-fixtures.ts`: en/es sin liga + en/es de liga, forma
 *    2×N de 2 filas porque la liga trae otro acabado) y la primera carta del catálogo con una sola versión; lo que se
 *    espera (burbujas, filas) sale de `GET /catalog/cards/:id`, no de constantes.
 * Solo IDS-F3 «7 filas» se salta en real (corre solo en mocks): el peor caso medido (sin liga + 6 filas de liga,
 * `c-ids-poffin-6`) no existe en el seed, y la mecánica 2×N ya la mide en real la ficha de 2 filas; sembrarlo solo
 * añadiría el número de filas.
 */
const FIXTURE = 'peor caso 2×N de 7 filas (`c-ids-poffin-6`): solo en el simulador; el seed real trae una carta de 2 filas';

interface VersionOption {
  optionKey: string;
  version: { stamp: { productId: number } | null };
  finishLabel: string | null;
}
interface Targets {
  /** Ficha con versión de liga (2×2 en mocks, 2×N de 2 filas en el seed) y la `optionKey` de su «Español · De liga». */
  liga: { path: string; esLeagueKey: string; pills: number; rows: number };
  /** Ficha 2×N: burbujas y filas esperadas. */
  wide: { path: string; pills: number; rows: number };
  /** Ficha de una sola versión. */
  single: string;
}

const LEAGUE_NAME = 'E2E League Bird';
let real: Promise<Targets> | null = null;

const rowsOf = (versions: VersionOption[]) =>
  new Set(versions.map((v) => `${v.version.stamp?.productId ?? 'none'}|${v.finishLabel}`)).size;

async function realTargets(): Promise<Targets> {
  const cards = await apiAsOk<{ data: { id: string; name: string }[] }>(
    'admin',
    'GET',
    `/buylist/cards?q=${encodeURIComponent(LEAGUE_NAME)}&pageSize=10`,
  );
  const card = cards.data.find((c) => c.name === LEAGUE_NAME);
  if (!card) throw new Error(`el seed no trae «${LEAGUE_NAME}» (backend/prisma/e2e-fixtures.ts, E2E_IDS)`);
  const detail = await apiAsOk<{ versions: VersionOption[] }>('customer', 'GET', `/catalog/cards/${card.id}`);
  const esLeague = detail.versions.find((v) => v.optionKey.startsWith('es.'));
  if (!esLeague) throw new Error(`«${LEAGUE_NAME}» sin versión española de liga: ${JSON.stringify(detail.versions)}`);
  const liga = { path: `/es/catalog/${card.id}`, esLeagueKey: esLeague.optionKey, pills: detail.versions.length, rows: rowsOf(detail.versions) };
  // (12): la primera carta del catálogo sembrado con una sola versión con existencia.
  const list = await apiAsOk<{ data: { card: { id: string } }[] }>('customer', 'GET', '/catalog/cards?pageSize=50');
  let single: string | null = null;
  for (const id of [...new Set(list.data.map((r) => r.card.id))]) {
    const d = await apiAsOk<{ versions?: VersionOption[] }>('customer', 'GET', `/catalog/cards/${id}`);
    if ((d.versions?.length ?? 0) <= 1) {
      single = `/es/catalog/${id}`;
      break;
    }
  }
  if (!single) throw new Error('el catálogo sembrado no trae ninguna carta de una sola versión en la página 1');
  return { liga, wide: liga, single };
}

/** Datos de cada modo: los del simulador en mocks; en real, los que dice el servidor sobre el seed. */
function target(): Promise<Targets> {
  if (!IS_REAL) {
    return Promise.resolve({
      liga: { path: '/es/catalog/c-ids-dedenne-084', esLeagueKey: 'es.648800.normal', pills: 4, rows: 2 },
      wide: { path: '/es/catalog/c-ids-pikachu-057', pills: 6, rows: 3 },
      single: '/es/catalog/c-charizard',
    });
  }
  real ??= realTargets();
  return real;
}

async function pillFacts(page: Page) {
  return page.evaluate(() => {
    const pills = [...document.querySelectorAll<HTMLElement>('[data-testid="version-pill"]')];
    return pills.map((p) => {
      const r = p.getBoundingClientRect();
      const name = p.firstElementChild as HTMLElement;
      const nameLines = Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight));
      return {
        key: p.dataset.optionKey,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        right: r.right,
        nameLines,
        border: getComputedStyle(p).borderTopColor,
        radius: getComputedStyle(p).borderTopLeftRadius,
        tabIndex: p.tabIndex,
        chips: p.querySelectorAll('[data-version-chip]').length,
        checked: p.getAttribute('aria-checked'),
      };
    });
  });
}

for (const width of [360, 390] as const) {
  test.describe(`Ficha con versiones · ${width} px`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test(`(9)(10)(14) ficha con liga: ES en una línea, EN de liga sin desborde, ≥ 44 px, borde -control @real`, async ({ page }) => {
      const { liga } = await target();
      await page.goto(liga.path);
      await expect(page.getByRole('radiogroup', { name: 'IDIOMA Y VERSIÓN' })).toBeVisible();
      const f = await pillFacts(page);
      test.info().annotations.push({ type: `ids-liga-${width}`, description: JSON.stringify({ path: liga.path, f }) });
      expect(f).toHaveLength(liga.pills);
      for (const p of f) {
        expect(p.h, `alto ${p.key}`).toBeGreaterThanOrEqual(44);
        expect(p.right, `sin desborde ${p.key}`).toBeLessThanOrEqual(width);
        // §IDS-UX.8: idle = rgba(26,26,24,.55); elegida = tinta sólida.
        if (p.checked !== 'true') expect(p.border, `borde ${p.key}`).toBe('rgba(26, 26, 24, 0.55)');
        expect(parseFloat(p.radius), `píldora ${p.key}`).toBeGreaterThan(20);
      }
      // «Español · De liga» cabe en una línea (aritmética 108 de 129 px útiles).
      const esLeague = f.find((p) => p.key === liga.esLeagueKey)!;
      expect(esLeague.nameLines, JSON.stringify(esLeague)).toBe(1);
      expect(f.find((p) => p.key === 'es')!.nameLines).toBe(1);
      if (width === 390) {
        // 171×64 a 390 (IDS-UX.8): (390 − 2×gutter − 8) ÷ 2.
        expect(f[0].h).toBeGreaterThanOrEqual(64);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });

    test(`(9) EN: «Spanish»+«Prize Pack» puede bajar a 2ª línea pero no desborda @real`, async ({ page }) => {
      const { liga } = await target();
      await page.goto(liga.path.replace('/es/', '/en/'));
      await expect(page.getByRole('radiogroup', { name: 'LANGUAGE AND VERSION' })).toBeVisible();
      const f = await pillFacts(page);
      test.info().annotations.push({ type: `ids-2x2-en-${width}`, description: JSON.stringify(f) });
      for (const p of f) {
        expect(p.right).toBeLessThanOrEqual(width);
        expect(p.h).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });

    test(`(11)(16) 2×N: una burbuja por entrada de versions[], un rótulo 12/6 por fila, sin insignia dentro, un solo tab-stop @real`, async ({ page }) => {
      const { wide } = await target();
      await page.goto(wide.path);
      const group = page.getByRole('radiogroup', { name: 'IDIOMA Y VERSIÓN' });
      await expect(group).toBeVisible();
      await expect(page.getByTestId('version-pills')).toHaveAttribute('data-form', '2xN');
      const f = await pillFacts(page);
      expect(f).toHaveLength(wide.pills);
      expect(f.filter((p) => p.tabIndex === 0)).toHaveLength(1);
      expect(f.every((p) => p.chips === 0)).toBe(true);
      for (const p of f) expect(p.h).toBeGreaterThanOrEqual(44);
      const labels = await page.getByTestId('version-row-label').evaluateAll((els) =>
        els.map((el) => {
          const cs = getComputedStyle(el);
          return { text: el.textContent, mt: cs.marginTop, mb: cs.marginBottom, size: cs.fontSize };
        }),
      );
      test.info().annotations.push({ type: `ids-2xN-${width}`, description: JSON.stringify({ f, labels }) });
      expect(labels).toHaveLength(wide.rows);
      expect(labels.map((l) => l.mb)).toEqual(Array(wide.rows).fill('6px'));
      expect(labels.map((l) => l.mt)).toEqual(['0px', ...Array(wide.rows - 1).fill('12px')]);
      expect(labels.every((l) => l.size === '12px')).toBe(true);
      // Teclado: la flecha mueve y elige.
      await page.locator('[data-testid="version-pill"][tabindex="0"]').focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('[data-testid="version-pill"][aria-checked="true"]')).toHaveAttribute('data-option-key', 'es');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  });
}

// IDS-F3 (v1.116.2: «2×N con 6 filas a 360 px sin desborde, peor caso medido»): `c-ids-poffin-6` = fila sin liga + 6
// filas de liga (máx medido por carta, DEVOPS_NOTES §108.1), dos del mismo tipo y acabado (D-IDS-6). A 360 px: 14
// burbujas en 2 columnas, ≥ 44 px, ninguna fuera del viewport, cada fila con sus dos burbujas a la misma altura, 7
// rótulos distintos y sin desborde horizontal de la página. En ES y EN (EN trae los rótulos más largos).
test.describe('2×N peor caso · 7 filas a 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const locale of ['es', 'en'] as const) {
    test(`IDS-F3 (${locale}): sin liga + 6 filas de liga, 14 burbujas en 2 columnas sin desborde`, async ({ page }) => {
      mockOnly(FIXTURE);
      await page.goto(`/${locale}/catalog/c-ids-poffin-6`);
      await expect(page.getByTestId('version-pills')).toHaveAttribute('data-form', '2xN');
      const facts = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="version-row"]')];
        return rows.map((row) => {
          const label = row.querySelector<HTMLElement>('[data-testid="version-row-label"]')!;
          const lr = label.getBoundingClientRect();
          const pills = [...row.querySelectorAll<HTMLElement>('[data-testid="version-pill"]')].map((p) => {
            const r = p.getBoundingClientRect();
            return { key: p.dataset.optionKey, left: r.left, right: r.right, top: r.top, h: r.height, w: r.width };
          });
          return {
            label: label.textContent,
            labelLines: Math.round(lr.height / parseFloat(getComputedStyle(label).lineHeight)),
            labelRight: lr.right,
            pills,
          };
        });
      });
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      test.info().annotations.push({ type: `ids-2xN-7rows-${locale}-360`, description: JSON.stringify({ scrollW, facts }) });
      expect(facts).toHaveLength(7);
      expect(new Set(facts.map((r) => r.label)).size, JSON.stringify(facts.map((r) => r.label))).toBe(7);
      expect(facts.flatMap((r) => r.pills)).toHaveLength(14);
      for (const r of facts) {
        expect(r.pills, JSON.stringify(r)).toHaveLength(2);
        expect(Math.abs(r.pills[0].top - r.pills[1].top), JSON.stringify(r)).toBeLessThan(1);
        expect(r.pills[0].right, JSON.stringify(r)).toBeLessThanOrEqual(r.pills[1].left);
        for (const p of r.pills) {
          expect(p.h, JSON.stringify(p)).toBeGreaterThanOrEqual(44);
          expect(p.left, JSON.stringify(p)).toBeGreaterThanOrEqual(0);
          expect(p.right, JSON.stringify(p)).toBeLessThanOrEqual(360);
        }
        expect(r.labelRight, JSON.stringify(r)).toBeLessThanOrEqual(360);
        expect(r.labelLines, `rótulo en una línea: ${JSON.stringify(r)}`).toBe(1);
      }
      expect(scrollW).toBe(360);
    });
  }
});

test('(12) con una sola versión no hay radiogroup @real', async ({ page }) => {
  await page.goto((await target()).single);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
});

test.describe('Teja con insignias · 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('(6) insignias fuera de la foto; (15) la ficha técnica no envuelve («Cosmos», forma corta de «Cosmos Holo», en mocks) @real', async ({ page }) => {
    await page.goto('/es/catalog?language=es&stamped=true');
    const tiles = page.locator('main a[href*="/catalog/"]').filter({ has: page.locator('img') });
    await tiles.first().waitFor();
    const facts = await page.evaluate(() => {
      const links = [...document.querySelectorAll<HTMLElement>('main a[href*="/catalog/"]')].filter((a) => a.querySelector('img'));
      return links.slice(0, 4).map((a) => {
        const tile = a.parentElement!;
        const chips = tile.querySelector<HTMLElement>('[data-testid="tile-version-chips"]');
        // foto · nombre · set · ficha técnica (ListingSpec, renglón mono): el 4.º hijo de la teja.
        const spec = tile.children[3] as HTMLElement | undefined;
        // `leading-none` ⇒ line-height = font-size (11 px).
        const lh = spec ? parseFloat(getComputedStyle(spec).lineHeight) || parseFloat(getComputedStyle(spec).fontSize) : 0;
        return {
          href: a.getAttribute('href'),
          chipsInPhoto: !!a.querySelector('[data-version-chip]'),
          chipsH: chips ? chips.getBoundingClientRect().height : null,
          spec: spec?.textContent ?? null,
          specLines: spec ? Math.round(spec.getBoundingClientRect().height / lh) : null,
        };
      });
    });
    test.info().annotations.push({ type: 'ids-tile-360', description: JSON.stringify(facts) });
    // El seed trae UNA teja española de liga («E2E League Bird»); el simulador, varias.
    expect(facts.length).toBeGreaterThanOrEqual(IS_REAL ? 1 : 2);
    for (const f of facts) {
      expect(f.chipsInPhoto, JSON.stringify(f)).toBe(false);
      // Una fila de insignias (alto 20; nunca dos filas).
      expect(f.chipsH, JSON.stringify(f)).toBeLessThanOrEqual(21);
      expect(f.href, JSON.stringify(f)).toMatch(/\?version=es\.\d+\.[a-z_]+$/);
      expect(f.specLines, `ficha técnica en una línea: ${JSON.stringify(f)}`).toBe(1);
    }
    // El peor caso de (15) es un DATO del simulador (el seed no trae Cosmos Holo): en mocks, que esté y se mida arriba.
    if (!IS_REAL) expect(facts.find((f) => /Cosmos/i.test(f.spec ?? '')), JSON.stringify(facts)).toBeDefined();
  });
});
