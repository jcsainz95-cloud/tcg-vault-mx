/**
 * reevaluate-unlocated.e2e-spec.ts — ⭐ SU-B6 (API_CONTRACT §M1-SU, SU.3 / SU.6): el script del REZAGO, contra
 * Postgres REAL. Propiedad: backend; la ejecuta QA.
 *
 * Con SU-1 una pieza de plataforma `in_stock` SIN cajón y CON precio pasa a `missing = []`: sale de la cola **sin
 * publicarse**, porque ningún disparador corre sobre ella. `scripts/reevaluate-unlocated.ts` es el barrido único.
 * Lo que se fija:
 *   1. **sin `--apply` no escribe NADA** — ni `status`/`updatedAt`/`listPriceCents` de ninguna pieza, ni la cola de
 *      M2 — y cuenta `selected / wouldPublish / pricePending / notPublishable`;
 *   2. **la 1.ª corrida con `--apply`** publica las que tienen precio (sin inventarles cajón), deja la sin precio en la
 *      cola con `["price"]` (escalada a M2) y no toca la gradeada sin slab;
 *   3. **la 2.ª corrida con `--apply` da `published: 0`** (idempotente);
 *   4. y el punto de entrada de verdad (`ts-node scripts/reevaluate-unlocated.ts`) arranca su contexto Nest mínimo,
 *      imprime las cuentas y ⛔ **no imprime la URL** de la base.
 *
 * ⚠️ La selección es GLOBAL (todo el rezago de la BD), y la BD de integración es compartida: las cuentas se miden por
 * DELTA contra una corrida previa a sembrar las piezas del caso, y las piezas propias por su estado en la BD.
 */
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS } from '../../prisma/e2e-fixtures';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { reevaluateUnlocated, Deps } from '../../scripts/reevaluate-unlocated';

const RUN = Date.now().toString(36).toUpperCase();
const FOLIO = { priced: `SU6-${RUN}-P`, unpriced: `SU6-${RUN}-U`, slabless: `SU6-${RUN}-G` };

describe('E2E — SU-B6: `scripts/reevaluate-unlocated.ts` (§M1-SU, SU.3)', () => {
  let h: E2EHarness;
  let deps: Deps;
  const ids: Record<keyof typeof FOLIO, string> = { priced: '', unpriced: '', slabless: '' };

  const cleanup = () => h.prisma.inventoryItem.deleteMany({ where: { folio: { in: Object.values(FOLIO) } } });

  /** TODAS las piezas y TODA la cola de M2: lo que un «no escribe nada» tiene que dejar idéntico. */
  const worldSnapshot = async () => ({
    items: await h.prisma.inventoryItem.findMany({
      select: { id: true, status: true, updatedAt: true, listPriceCents: true, locationId: true },
      orderBy: { id: 'asc' },
    }),
    pending: await h.prisma.pendingPriceEntry.findMany({ orderBy: { id: 'asc' } }),
    listed: await h.prisma.inventoryItem.count({ where: { status: 'listed' } }),
  });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    deps = { prisma: h.prisma, inventory: h.app.get(InventoryService) };
    await cleanup();
  }, 180000);

  afterAll(async () => {
    if (h) {
      await cleanup();
      await h.close();
    }
  });

  it('sin `--apply` NO escribe y cuenta; 1.ª `--apply` publica las con precio; 2.ª `--apply` ⇒ `published: 0`', async () => {
    const card = async (k: keyof typeof E2E_CARDS) =>
      (await h.prisma.card.findFirstOrThrow({ where: { externalId: E2E_CARDS[k].externalId }, select: { id: true } })).id;
    const base = {
      ownerType: 'platform' as const,
      status: 'in_stock' as const,
      acquisitionType: 'buylist' as const,
      acquisitionCostCents: 2500,
      finish: 'normal' as const,
    };

    const before = await reevaluateUnlocated(deps, { apply: false });

    ids.priced = (
      await h.prisma.inventoryItem.create({
        data: { ...base, folio: FOLIO.priced, cardId: await card('common'), productType: 'raw', rawCondition: 'NM' },
      })
    ).id;
    ids.unpriced = (
      await h.prisma.inventoryItem.create({
        data: { ...base, folio: FOLIO.unpriced, cardId: await card('nopref'), productType: 'raw', rawCondition: 'NM' },
      })
    ).id;
    // Gradeada con cert y precio MANUAL pero SIN identidad de slab: la guarda (no el cajón) la retiene.
    ids.slabless = (
      await h.prisma.inventoryItem.create({
        data: { ...base, folio: FOLIO.slabless, cardId: await card('graded'), productType: 'graded', certNumber: `SU6-${RUN}`, listPriceCents: 99_900 },
      })
    ).id;

    // (1) Sin `--apply`: cuenta y NO escribe.
    const snap0 = await worldSnapshot();
    const dry = await reevaluateUnlocated(deps, { apply: false });
    expect(dry.mode).toBe('dry-run');
    expect({
      selected: dry.selected - before.selected,
      wouldPublish: dry.wouldPublish - before.wouldPublish,
      pricePending: dry.pricePending - before.pricePending,
      notPublishable: dry.notPublishable - before.notPublishable,
    }).toEqual({ selected: 3, wouldPublish: 1, pricePending: 1, notPublishable: 1 });
    expect(await worldSnapshot()).toEqual(snap0);

    // (2) 1.ª con `--apply`: el MISMO cuerpo de los disparadores.
    const first = await reevaluateUnlocated(deps, { apply: true });
    expect(first.mode).toBe('apply');
    expect(first.selected).toBe(dry.selected);
    expect(first.published).toBeGreaterThanOrEqual(1);
    expect(first.byOutcome.missing_location).toBe(0);
    const state = async (id: string) =>
      h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { status: true, locationId: true } });
    expect(await state(ids.priced)).toEqual({ status: 'listed', locationId: null });
    expect(await state(ids.unpriced)).toEqual({ status: 'in_stock', locationId: null });
    expect(await state(ids.slabless)).toEqual({ status: 'in_stock', locationId: null });
    // La sin precio escaló a M2 (un pendiente visible) y sigue en la cola con EXACTAMENTE `["price"]`.
    const nopref = await card('nopref');
    expect(
      await h.prisma.pendingPriceEntry.count({
        where: { cardId: nopref, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', status: 'open', context: 'inventory' },
      }),
    ).toBeGreaterThanOrEqual(1);
    const queue = await h.app.get(InventoryService).pendingPublish({ page: 1, pageSize: 1000 });
    const rowU = (queue.data as any[]).find((r) => r.inventoryItemId === ids.unpriced);
    expect(rowU?.missing).toEqual(['price']);
    expect((queue.data as any[]).some((r) => r.inventoryItemId === ids.priced)).toBe(false);

    // (3) 2.ª con `--apply`: idempotente.
    const second = await reevaluateUnlocated(deps, { apply: true });
    expect(second.published).toBe(0);
    expect(second.selected).toBe(first.selected - first.published);
    expect(await state(ids.priced)).toEqual({ status: 'listed', locationId: null });
  });

  it('el punto de entrada real: contexto Nest mínimo, cuentas en JSON, sin `--apply` no escribe, ⛔ sin la URL', async () => {
    const snap0 = await worldSnapshot();
    const backend = join(__dirname, '..', '..');
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [require.resolve('ts-node/dist/bin.js'), '--transpile-only', 'scripts/reevaluate-unlocated.ts'],
      { cwd: backend, env: process.env, timeout: 150_000 },
    );
    const last = stdout.trim().split('\n').pop() as string;
    expect(JSON.parse(last)).toMatchObject({ mode: 'dry-run' });
    expect(stdout).toContain('dry-run (no escribe)');
    const url = process.env.DATABASE_URL as string;
    const pwd = new URL(url).password;
    for (const out of [stdout, stderr]) {
      expect(out).not.toContain(url);
      if (pwd) expect(out).not.toContain(pwd);
    }
    expect(await worldSnapshot()).toEqual(snap0);
  }, 180000);

  it('argumento desconocido ⇒ sale 64 sin conectarse', async () => {
    const backend = join(__dirname, '..', '..');
    const res = await promisify(execFile)(
      process.execPath,
      [require.resolve('ts-node/dist/bin.js'), '--transpile-only', 'scripts/reevaluate-unlocated.ts', '--aply'],
      { cwd: backend, env: process.env, timeout: 150_000 },
    ).catch((e) => e);
    expect(res.code).toBe(64);
    expect(String(res.stderr)).toContain('argumento desconocido');
  }, 180000);
});
