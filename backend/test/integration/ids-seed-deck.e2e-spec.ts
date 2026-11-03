/**
 * ids-seed-deck.e2e-spec.ts — v1.116.4⟨ids⟩ (QA sobre `f2cd0e31`: los criterios 963–968 no se podían medir en navegador porque
 * el seed E2E no traía ningún Meta deck con versión). Propiedad: backend. Contra Postgres REAL y la app por HTTP.
 *
 * Fija el fixture que el `@real` de frontend va a recorrer (`E2E_IDS.metaDeck`): publicado, una línea `quantity` × la carta de
 * liga, y con las cuatro piezas de versión del seed el surtido de §IDS.6 da tres tramos — las dos sin liga primero (por precio) y
 * la de liga al final. Y que la siembra es IDEMPOTENTE: una segunda pasada no crea otra lista. Determinista (N=1).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_IDS } from '../../prisma/e2e-fixtures';

jest.setTimeout(120_000);

type Line = { quantity: number; availableQty: number; units: { version: { key: string; stamp: unknown }; qty: number }[] };

describe('IDS seed — Meta deck de liga para 963–968', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
  });

  afterAll(async () => {
    if (h) await h.close();
  });

  it('publicado; su línea de liga surte 3 = `en`, `es` (sin liga) y la de liga al final', async () => {
    const r = await h.api('GET', `/decks-meta/${E2E_IDS.metaDeck.slug}`);
    expect(r.status).toBe(200);
    const lines = (r.body.groups.pokemon as Line[]).filter((l) => l.quantity === E2E_IDS.metaDeck.quantity);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line.availableQty).toBe(3);
    // Sin liga primero (entre ellas, por precio: la española suele ser la más barata), la de liga al final.
    expect(line.units.map((u) => [u.version.stamp != null, u.qty])).toEqual([
      [false, 1],
      [false, 1],
      [true, 1],
    ]);
    expect(line.units.slice(0, 2).map((u) => u.version.key).sort()).toEqual(['en', 'es']);
    const list = await h.api('GET', '/decks-meta');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(E2E_IDS.metaDeck.slug);
  });

  it('idempotente: resembrar no crea otra lista', async () => {
    const before = await h.prisma.metaDeck.findUniqueOrThrow({ where: { slug: E2E_IDS.metaDeck.slug }, select: { id: true, currentListId: true } });
    const n0 = await h.prisma.metaDeckList.count({ where: { deckId: before.id } });
    await seedE2E(h.prisma);
    const after = await h.prisma.metaDeck.findUniqueOrThrow({ where: { slug: E2E_IDS.metaDeck.slug }, select: { currentListId: true } });
    expect(after.currentListId).toBe(before.currentListId);
    expect(await h.prisma.metaDeckList.count({ where: { deckId: before.id } })).toBe(n0);
  });
});
