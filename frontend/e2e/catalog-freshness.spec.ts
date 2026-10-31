import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { realOnly } from './utils/auth';
import { apiAsOk, resolveApiBaseUrl } from './utils/env';

/**
 * B-R2 (QA sobre `e066b0b5`, medido 10/10 y 3/3): la lista pública del catálogo se cachea en la caché de datos de Next
 * (`revalidate: 30`), que es stale-while-revalidate: tras > 30 s SIN visitas, la primera visita recibe la copia VIEJA.
 * Antes la vista la tomaba como `initialData` «fresca» (`staleTime` 30 s) y no releía: la teja decía MX$1,510.00 y el
 * checkout cobraba MX$1,601.00 (ARCHITECTURE §4.DYN (f) 3: ≤ 60 s en listas públicas, exacto al pagar).
 *
 * El escenario de QA, de punta a punta contra `next start` y el backend sembrado (`E2E_REAL=1`):
 *   calentar la caché → cambiar el precio (PATCH `listPriceCents`, §M1) → esperar > 30 s sin visitas → abrir.
 * Se afirma que el HTML servido SÍ era la copia vieja (el escenario se reprodujo) y que en ≤ 10 s la teja pasa al precio
 * nuevo (la vista relee al hidratar porque sabe la edad del dato).
 *
 * La portada (`HydrationBoundary`, `updatedAt: 0`) se mide con el mismo escenario: allí el dato nace «viejo» a
 * propósito y el cliente relee siempre al montar.
 *
 * Mutación que lo pone rojo (FRONTEND_NOTES §MKT-R2B): quitar `initialDataUpdatedAt` del `useQuery` de `CatalogView`
 * ⇒ la teja se queda con el precio viejo.
 */

const REVALIDATE_S = 30;
const IDLE_MS = (REVALIDATE_S + 6) * 1000;

interface Group {
  representativeInventoryItemId: string;
  productType: 'raw' | 'graded';
  stockCount: number;
  displayPriceCents: number | null;
  card: { id: string; name: string };
}

const fmt = (cents: number) =>
  `MX$${new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)}`;

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${await resolveApiBaseUrl()}${path}`);
  if (!res.ok) throw new Error(`GET ${path} ⇒ ${res.status}`);
  return (await res.json()) as T;
}

/** El texto de la teja de `cardId` (el bloque que contiene el enlace por nombre). */
function tile(page: Page, cardId: string) {
  return page.locator('main div.flex.flex-col', { has: page.locator(`p a[href="/es/catalog/${cardId}"]`) }).first();
}

/**
 * Baja el precio de la ÚNICA pieza del grupo con un precio de lista a mano (`PATCH listPriceCents`, §M1; con una sola
 * pieza no hay otra representante que pueda tomar su lugar) y devuelve el precio que el backend publica DESPUÉS, leído sin caché (el
 * precio publicado se recalcula en segundo plano: se espera a verlo). `restore` deja el precio de lista como estaba
 * (`null` = vuelve al de mercado).
 */
async function lowerPrice(g: Group, listPath: string): Promise<{ newCents: number; restore: () => Promise<void> }> {
  const id = g.representativeInventoryItemId;
  const before = await apiAsOk<{ listPriceCents: number | null }>('admin', 'GET', `/admin/inventory/items/${id}`);
  const lowered = Math.max(100, Math.floor((g.displayPriceCents! * 0.8) / 100) * 100 + 37);
  await apiAsOk('admin', 'PATCH', `/admin/inventory/items/${id}`, { listPriceCents: lowered });
  const published = async () =>
    (await publicGet<{ data: Group[] }>(listPath)).data.find((x) => x.card.id === g.card.id)?.displayPriceCents ?? null;
  await expect
    .poll(published, { message: 'el backend publica el precio nuevo', timeout: 15_000 })
    .not.toBe(g.displayPriceCents);
  const newCents = (await published())!;
  return {
    newCents,
    restore: async () => {
      await apiAsOk('admin', 'PATCH', `/admin/inventory/items/${id}`, { listPriceCents: before.listPriceCents });
      await expect.poll(published, { timeout: 15_000 }).toBe(g.displayPriceCents);
    },
  };
}

/**
 * Calentar: visitar hasta que el HTML servido traiga el precio de AHORA. Una visita tras vencer la ventana recibe la
 * copia vieja y dispara la relectura en segundo plano; tras una corrida anterior la copia puede traer aún el precio que
 * esa corrida bajó y restauró. Cuando el HTML ya trae `text`, la caché tiene una copia recién leída con ese precio.
 */
async function warmUntil(request: APIRequestContext, path: string, text: string): Promise<void> {
  await expect
    .poll(async () => (await (await request.get(path)).text()).includes(text), {
      message: `la caché de ${path} quedó con el precio de ahora`,
      timeout: 90_000,
      intervals: [2_000],
    })
    .toBe(true);
}

/**
 * Restaura el precio SIN tapar el fallo de la prueba: un `throw` dentro de `finally` reemplaza al error original (la
 * primera corrida de la mutación reportó el fallo de la restauración en vez del precio viejo en la teja). Si la prueba
 * ya falló, el fallo de la restauración solo se registra; si pasó, la restauración fallida la pone roja.
 */
async function restoreKeepingFailure(restore: () => Promise<void>, passed: boolean): Promise<void> {
  try {
    await restore();
  } catch (e) {
    if (passed) throw e;
    console.error(`[catalog-freshness] no se restauró el precio: ${e}`);
  }
}

test.describe('@real B-R2 · una copia vieja de la caché de datos no deja un precio viejo en pantalla', () => {
  test.beforeEach(() => realOnly('mide la caché de datos de next start contra el backend sembrado'));
  test.describe.configure({ mode: 'serial' });

  test('@real catálogo: tras > 30 s sin visitas, la teja pasa al precio nuevo en ≤ 10 s', async ({ page, request }) => {
    test.setTimeout(240_000);
    const listPath = '/catalog/cards?sort=newest';
    const first = await publicGet<{ data: Group[] }>(listPath);
    const g = first.data.find((x) => x.displayPriceCents != null && x.stockCount === 1);
    expect(g, 'el catálogo trae un grupo de UNA pieza con precio').toBeTruthy();
    const oldText = fmt(g!.displayPriceCents!);

    // Calentar: dos visitas (la primera puede servir una copia vencida y releer en segundo plano).
    await warmUntil(request, '/es/catalog', oldText);

    const { newCents, restore } = await lowerPrice(g!, listPath);
    let passed = false;
    try {
      await page.waitForTimeout(IDLE_MS); // sin visitas: la copia de la caché vence pero sigue ahí
      const reads: string[] = [];
      page.on('request', (r) => {
        if (/\/api\/v1\/catalog\/cards(\?|$)/.test(r.url())) reads.push(r.url());
      });
      const res = await page.goto('/es/catalog');
      const served = (await res!.text()) ?? '';
      expect(served, 'el escenario se reprodujo: el servidor sirvió la copia VIEJA').toContain(oldText);
      await expect(tile(page, g!.card.id), 'la teja muestra el precio que se cobra').toContainText(fmt(newCents), {
        timeout: 10_000,
      });
      expect(reads.length, 'la vista releyó la rejilla al hidratar').toBeGreaterThan(0);
      passed = true;
    } finally {
      await restoreKeepingFailure(restore, passed);
    }
  });

  test('@real portada: tras > 30 s sin visitas, la vitrina pasa al precio nuevo en ≤ 10 s', async ({ page, request }) => {
    test.setTimeout(240_000);
    const featured = await publicGet<{ data: Group[] }>('/catalog/featured');
    const g = featured.data.find((x) => x.displayPriceCents != null && x.stockCount === 1);
    expect(g, 'la portada trae una destacada de UNA pieza con precio').toBeTruthy();
    const oldText = fmt(g!.displayPriceCents!);

    await warmUntil(request, '/es', oldText);

    const { newCents, restore } = await lowerPrice(g!, '/catalog/featured');
    let passed = false;
    try {
      await page.waitForTimeout(IDLE_MS);
      const res = await page.goto('/es');
      const served = (await res!.text()) ?? '';
      expect(served, 'el escenario se reprodujo: el servidor sirvió la copia VIEJA').toContain(oldText);
      await expect(page.locator('main'), 'la destacada muestra el precio que se cobra').toContainText(fmt(newCents), {
        timeout: 10_000,
      });
      passed = true;
    } finally {
      await restoreKeepingFailure(restore, passed);
    }
  });
});
