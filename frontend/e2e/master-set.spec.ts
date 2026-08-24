import { test, expect, type Page, type Locator } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL } from './utils/auth';

/**
 * E2E mínimo del flujo del PO (ARCHITECTURE §4.22, Reparto · QA): contra los seeds de
 * §4.22e (`backend/prisma/seed-e2e.ts`) se verifica en el BINDER DEL COTIZADOR
 * (`/es/buylist`, raw → MasterSetPanel mode="quoter"):
 *
 *  1. una carta CON reverse holo pinta DOS casillas de imagen (normal izquierda,
 *     reverse holo derecha — orden del array `availableFinishes`, contrato v1.22);
 *  2. una carta con UN solo acabado pinta UNA sola casilla (JAMÁS un hueco de relleno);
 *  3. el set de orden se lista en ORDEN NATURAL: 2 → 10 → … → TG01 (numéricos por valor
 *     entero primero, promos/subsets con prefijo alfabético AL FINAL).
 *
 * Tagueados `@real` (son el smoke de los seeds §4.22e). Env-aware como el resto de la
 * suite: en modo mock (sin E2E_REAL) corren contra los fixtures del front con un oráculo
 * equivalente (misma estructura, otros nombres), así la suite completa sigue en verde.
 *
 * Las imágenes del seed apuntan a `img.e2e.local` (no resuelve fuera del stack): se
 * INTERCEPTAN con `page.route` y además los asserts son por DOM/aria (nº de <img> y
 * aria-label de las casillas), nunca por el contenido del arte.
 */

/**
 * Oráculo por entorno. REAL = seeds §4.22e (nombres y números LITERALES del seed —
 * si el seed cambia, este bloque es el único que hay que tocar). MOCK = fixtures de
 * `src/lib/mock/fixtures.ts` con la misma forma (dual/single/orden con promo al final).
 */
const ORACLE = IS_REAL
  ? {
      variantsSet: 'E2E Base Set',
      dual: { name: 'E2E Reverse Bird', number: '17', finishes: ['Normal', 'Reverse Holo'] },
      single: { name: 'E2E Pidgey', number: '16', finish: 'Normal' },
      orderSet: 'E2E Order Set',
      // ⚠️ Oráculo de VARIANTES, no de cartas. `E2E_ORDER_EXPECTED_NUMBERS`
      // (backend/prisma/e2e-fixtures.ts, §4.22e) = `['2','10','SV107','TG01']` es el oráculo de
      // `GET /buylist/cards`: UNA entrada por CARTA. El binder del cotizador pinta **una casilla
      // por (carta, acabado)** (rejilla plana N-16), y `E2E Order Two` (#2) trae
      // `availableFinishes: ['normal','reverse_holo']` ⇒ **dos** casillas. Copiar el oráculo de
      // cartas aquí producía un assert que no podía pasar en ningún entorno: en real fallaba por
      // el #2 duplicado y en mock era código muerto (`orderExact: null` salta la línea).
      // El propio spec ya lo demostraba: el test de «una carta CON reverse holo pinta DOS
      // casillas» pasa — o sea que el producto tiene razón y el oráculo estaba mal.
      // `SV` < `TG` ⇒ SV107 va ANTES de TG01 (promos agrupados por prefijo).
      orderExact: ['2', '2', '10', 'SV107', 'TG01'] as string[] | null,
      orderMustContain: { numeric: [2, 10], promos: ['SV107', 'TG01'] },
    }
  : {
      variantsSet: 'Base Set',
      dual: { name: 'Pikachu', number: '58', finishes: ['Normal', 'Reverse Holo'] },
      single: { name: 'Pikachu ex', number: '238', finish: 'Holofoil', set: 'Surging Sparks' },
      orderSet: 'Surging Sparks',
      // El catálogo mock del COTIZADOR (`mockCards`) no incluye celdas promo con prefijo
      // (TG12 solo existe en el binder de inventario `mockMasterSetBinder`): la rama mock
      // verifica la ESTRUCTURA del orden (numéricos ascendentes / prefijos al final); la
      // secuencia literal 2 → 10 → SV107 → TG01 la cubre la rama real contra los seeds §4.22e.
      orderExact: null as string[] | null,
      orderMustContain: { numeric: [213, 238], promos: [] as string[] },
    };

/** Sirve un SVG local para las imágenes de fixture (img.e2e.local no resuelve en sandbox/CI). */
async function stubFixtureImages(page: Page) {
  await page.route('**://img.e2e.local/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" fill="#ccc"/></svg>',
    }),
  );
}

/** Abre el binder del cotizador para un set: búsqueda en el índice + clic en su tarjeta. */
async function openQuoterSet(page: Page, setName: string): Promise<Locator> {
  await page.goto('/es/buylist');
  // El índice de sets del binder (mode="quoter") trae su propio "Buscar set".
  await page.getByLabel(t('es', 'masterSet.searchSet')).fill(setName);
  await page.getByRole('button', { name: new RegExp(setName) }).first().click();
  // La cuadrícula del set es la lista con aria-label del binder compartido.
  const grid = page.getByRole('list', { name: t('es', 'masterSet.binderGridLabel') });
  await expect(grid).toBeVisible();
  return grid;
}

/** Celda (li) de una carta del binder, localizada por su nombre EN (dato de catálogo). */
function cellOf(grid: Locator, cardName: string): Locator {
  return grid.locator('li').filter({ hasText: cardName }).first();
}

/**
 * Casillas de UNA carta en la rejilla PLANA del cotizador (N-16, v1.22-2): hay **una casilla (li)
 * por (carta, acabado)**, hermanas entre sí — no una celda con sub-casillas dentro. Se localizan
 * por el `#número`, que cada casilla imprime junto a su acabado («#58 · Reverse Holo»).
 */
function variantTilesOf(grid: Locator, cardNumber: string): Locator {
  return grid.locator('li').filter({ hasText: `#${cardNumber}` });
}

/** Botón «Agregar {carta} ({acabado}) a la venta» dentro de la rejilla. */
function addVariantBtn(grid: Locator, cardName: string, finish: string): Locator {
  return grid.getByRole('button', {
    name: new RegExp(`^Agregar ${cardName} \\(${finish}\\) a la venta`),
  });
}

test.describe('master set · cotizador: una casilla de IMAGEN por variante real (§4.22e)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFixtureImages(page);
  });

  test('@real una carta CON reverse holo pinta DOS casillas (normal izquierda, reverse holo derecha)', async ({
    page,
  }) => {
    const grid = await openQuoterSet(page, ORACLE.variantsSet);
    const tiles = variantTilesOf(grid, ORACLE.dual.number);

    // DOS casillas HERMANAS, una por variante real (rejilla plana N-16): la carta con reverse holo
    // ocupa dos posiciones de la cuadrícula, no una celda con dos cajas dentro.
    await expect(tiles).toHaveCount(2);

    // Cada casilla es su PROPIO botón de venta (aria quoterAddAria) con su propia imagen.
    // El precio del aria varía por seed (cotizada o "Precio pendiente") → regex por prefijo.
    const [left, right] = ORACLE.dual.finishes;
    const leftBtn = addVariantBtn(grid, ORACLE.dual.name, left);
    const rightBtn = addVariantBtn(grid, ORACLE.dual.name, right);
    await expect(leftBtn).toBeVisible();
    await expect(rightBtn).toBeVisible();

    // Una <img> por variante — no una imagen + chips de texto.
    await expect(tiles.locator('img')).toHaveCount(2);
    // …y normal a la IZQUIERDA del reverse holo (orden del array, contrato v1.22).
    const leftBox = await leftBtn.boundingBox();
    const rightBox = await rightBtn.boundingBox();
    expect(leftBox && rightBox && leftBox.x < rightBox.x).toBe(true);
  });

  test('@real una carta con UN solo acabado pinta UNA sola casilla (sin hueco de relleno)', async ({
    page,
  }) => {
    const setName = 'set' in ORACLE.single ? (ORACLE.single as { set: string }).set : ORACLE.variantsSet;
    const grid = await openQuoterSet(page, setName);
    const tiles = variantTilesOf(grid, ORACLE.single.number);

    // UNA casilla, la de su único acabado real, con UNA imagen…
    await expect(tiles).toHaveCount(1);
    await expect(tiles.locator('img')).toHaveCount(1);
    await expect(addVariantBtn(grid, ORACLE.single.name, ORACLE.single.finish)).toBeVisible();
    // …y NINGÚN botón de venta para acabados que la carta no tiene (prohibido el relleno).
    // Se cuentan los botones de AGREGAR: la casilla lleva además su «Ver detalle de …» (P-43),
    // que es navegación al pop-up, no una variante de más.
    await expect(
      grid.getByRole('button', { name: new RegExp(`^Agregar ${ORACLE.single.name} \\(`) }),
    ).toHaveCount(1);
  });

  test('@real el binder lista el set en ORDEN NATURAL: numéricos ascendentes primero, promos con prefijo al final', async ({
    page,
  }) => {
    const grid = await openQuoterSet(page, ORACLE.orderSet);

    // Números de las celdas EN EL ORDEN en que se pintan (texto `#<number>` de cada celda).
    const raw = await grid.getByText(/^#/).allInnerTexts();
    const numbers = raw.map((s) => s.replace(/^#/, '').trim());
    expect(numbers.length).toBeGreaterThanOrEqual(2);

    const isNumeric = (s: string) => /^\d+$/.test(s);
    const numeric = numbers.filter(isNumeric).map(Number);
    const promos = numbers.filter((s) => !isNumeric(s));

    // (a) Los numéricos van en orden ASCENDENTE POR VALOR entero ("2" antes que "10",
    //     nunca el orden lexicográfico "10" < "2").
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
    // (b) Todos los numéricos van ANTES que cualquier promo/subset con prefijo. El assert
    //     tolera promos adicionales del seed (p. ej. SV107) mientras queden al final.
    const firstPromoIdx = numbers.findIndex((s) => !isNumeric(s));
    if (firstPromoIdx !== -1) {
      expect(numbers.slice(firstPromoIdx).every((s) => !isNumeric(s))).toBe(true);
    }
    // (c) La secuencia mínima del seed §4.22e está presente y en su grupo correcto.
    for (const n of ORACLE.orderMustContain.numeric) expect(numeric).toContain(n);
    for (const p of ORACLE.orderMustContain.promos) expect(promos).toContain(p);
    // (d) Rama real: la secuencia COMPLETA de CASILLAS es exactamente la del fixture §4.22e
    //     expandido por acabado (#2 dos veces: normal + reverse holo) — 2 → 2 → 10 → SV107 → TG01.
    if (ORACLE.orderExact) expect(numbers).toEqual(ORACLE.orderExact);
    // (e) Y las casillas de una MISMA carta quedan juntas: expandir por acabado no puede
    //     desordenar el set (si #2 apareciera separado, el orden natural estaría roto).
    const firstTwo = numbers.indexOf('2');
    const lastTwo = numbers.lastIndexOf('2');
    if (firstTwo !== -1 && lastTwo !== firstTwo) {
      expect(numbers.slice(firstTwo, lastTwo + 1).every((n) => n === '2')).toBe(true);
    }
  });
});
