/**
 * promo-viejas-resync.e2e-spec.ts — P-PROMOS-VIEJAS PV-1/PV-2/QA-PV-STALE contra Postgres REAL: el RE-SYNC de un set de la tabla
 * RECONCILIA (no solo upsert). Mismos JSON reales que promo-viejas.e2e-spec.ts; el segundo pase cambia el plan (productos
 * alterados en memoria) y se mide el estado en BD.
 *  - 1 `set_base` por carta (o ninguno si queda pendiente) en los 6 sets tras sync + re-sync.
 *  - base A ⇒ ambiguous_base; producto re-colgado de carta X a Y (con su PriceReference); sello retirado; producto con piezas
 *    que sale del plan NO se borra (se reporta `stale_in_use`); nombre/etiqueta kilométricos ⇒ `field_too_long`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { promoNumberKey } from '../../src/modules/catalog/promo-set-groups';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { PokemonTcgIoClient } from '../../src/modules/catalog/pokemontcg-io.client';

jest.setTimeout(300_000);

interface Fixture {
  setId: string;
  groupId: number;
  cards: { externalId: string; number: string; name: string }[];
  products: { productId: number; name: string; number: string | null; rarity: string | null; imageUrl: string | null }[];
  prices: { productId: number; subTypeName: string; marketPrice: number | null }[];
}
const load = (id: string): Fixture =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'promos-viejas', `${id}.json`), 'utf8'));
const FIX: Record<string, Fixture> = {};
for (const id of ['svp', 'swshp', 'smp', 'xyp', 'bwp', 'dpp']) FIX[id] = load(id);
const BY_GROUP = new Map(Object.values(FIX).map((f) => [f.groupId, f]));

class FakeTcgcsv {
  products = new Map<number, Fixture['products']>();
  async listGroups() {
    return [];
  }
  async getCardProducts(groupId: number) {
    return this.products.get(groupId) ?? BY_GROUP.get(groupId)?.products ?? [];
  }
  async getProducts(groupId: number) {
    return (await this.getCardProducts(groupId)).map((p) => ({ productId: p.productId, name: p.name, number: p.number }));
  }
  async getPrices(groupId: number) {
    return this.extraPrices.get(groupId) ?? BY_GROUP.get(groupId)?.prices ?? [];
  }
  extraPrices = new Map<number, Fixture['prices']>();
}
class FakePtcg {
  async getSets() {
    return [];
  }
}
const PREFIX: Record<string, string> = { svp: 'SVP', swshp: 'SWSH', smp: 'SM', xyp: 'XY', bwp: 'BW', dpp: 'DP' };

describe('E2E — P-PROMOS-VIEJAS PV-1/PV-2: el re-sync reconcilia (datos reales)', () => {
  let h: E2EHarness;
  let admin: string;
  const tcgcsv = new FakeTcgcsv();

  async function wipe() {
    const sets = await h.prisma.cardSet.findMany({ where: { externalId: { in: Object.keys(FIX) } }, select: { id: true } });
    const setIds = sets.map((s) => s.id);
    const cardIds = (await h.prisma.card.findMany({ where: { setId: { in: setIds } }, select: { id: true } })).map((c) => c.id);
    await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.stampedProductCandidate.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
  }
  async function seedSet(id: string) {
    const f = FIX[id];
    const set = await h.prisma.cardSet.create({ data: { externalId: id, name: `Promos ${id}` } });
    await h.prisma.card.createMany({ data: f.cards.map((c) => ({ externalId: c.externalId, setId: set.id, name: c.name, number: c.number })) });
    return set;
  }
  const refresh = (id: string) => h.api<any>('POST', '/admin/catalog/refresh-variants', { token: admin, json: { setId: id } });
  /** Cartas del set con ≠ 1 `set_base` — la consulta «kind=set_base por carta = 1» (admite 0 si pendiente). */
  async function cardsWithManySetBase(id: string) {
    const rows = await h.prisma.cardProduct.groupBy({
      by: ['cardId'],
      where: { kind: 'set_base', card: { set: { externalId: id } } },
      _count: { _all: true },
    });
    return rows.filter((r) => r._count._all !== 1);
  }
  const setBase = (id: string) => h.prisma.cardProduct.findMany({ where: { kind: 'set_base', card: { set: { externalId: id } } }, include: { card: { select: { number: true } } } });

  beforeAll(async () => {
    h = await E2EHarness.create((b) =>
      b.overrideProvider(TcgcsvCatalogClient).useValue(tcgcsv).overrideProvider(PokemonTcgIoClient).useValue(new FakePtcg()),
    );
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    await wipe();
  });
  afterAll(async () => {
    if (h) {
      await wipe();
      await h.close();
    }
  });
  beforeEach(async () => {
    tcgcsv.products.clear();
    tcgcsv.extraPrices.clear();
    await wipe();
  });

  it.each(['svp', 'swshp', 'smp', 'xyp', 'bwp', 'dpp'])('%s: tras sync + re-sync ninguna carta tiene ≠ 1 set_base', async (id) => {
    await seedSet(id);
    const first = await refresh(id);
    expect(first.status).toBe(200);
    expect(await cardsWithManySetBase(id)).toEqual([]);
    // QA-PV-PEND: pendingCards = cartas sin set_base (≠ filas de precio pendientes).
    expect(first.body.pendingCards).toBe(await h.prisma.card.count({ where: { set: { externalId: id }, cardProducts: { none: { kind: 'set_base' } } } }));
    expect((await refresh(id)).status).toBe(200);
    expect(await cardsWithManySetBase(id)).toEqual([]);
  });

  it('semilla previa (otro tcgplayerProductId set_base de la carta) no convive con el del plan: queda 1 set_base', async () => {
    await seedSet('svp');
    expect((await refresh('svp')).status).toBe(200);
    const base = (await setBase('svp'))[0];
    await h.prisma.cardProduct.create({ data: { cardId: base.cardId, tcgplayerProductId: 98_000_001, kind: 'set_base', name: 'semilla m31', finishes: ['normal'] } });
    expect((await h.prisma.cardProduct.count({ where: { cardId: base.cardId, kind: 'set_base' } }))).toBe(2);
    expect((await refresh('svp')).status).toBe(200);
    expect(await cardsWithManySetBase('svp')).toEqual([]);
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: 98_000_001 } })).toBe(0);
  });

  it('base A pasa a ambiguous_base ⇒ la carta queda sin set_base (el producto viejo y su precio se retiran) y se reporta', async () => {
    await seedSet('svp');
    expect((await refresh('svp')).status).toBe(200);
    const base = (await setBase('svp'))[0];
    const f = FIX.svp;
    const p = f.products.find((x) => x.productId === base.tcgplayerProductId)!;
    const clone = { ...p, productId: p.productId + 9_000_000, name: `${p.name} B` };
    tcgcsv.products.set(f.groupId, [...f.products, clone]);
    tcgcsv.extraPrices.set(f.groupId, [...f.prices, ...f.prices.filter((r) => r.productId === p.productId).map((r) => ({ ...r, productId: clone.productId }))]);
    const r = await refresh('svp');
    expect(r.status).toBe(200);
    expect(r.body.promoSkipped).toEqual(expect.arrayContaining([{ number: p.number, reason: 'ambiguous_base' }]));
    expect(await h.prisma.cardProduct.count({ where: { cardId: base.cardId, kind: 'set_base' } })).toBe(0);
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: p.productId } })).toBe(0);
    expect(await h.prisma.priceReference.count({ where: { cardId: base.cardId, cardProduct: { kind: 'set_base' } } })).toBe(0);
    expect(await cardsWithManySetBase('svp')).toEqual([]);
  });

  it('producto re-colgado de la carta X a la Y: X queda sin set_base, Y con exactamente 1 y el PriceReference sigue al cardId nuevo', async () => {
    await seedSet('svp');
    expect((await refresh('svp')).status).toBe(200);
    const f = FIX.svp;
    const usedKeys = new Set(f.products.map((p) => promoNumberKey(p.number, PREFIX.svp)));
    const cards = await h.prisma.card.findMany({ where: { set: { externalId: 'svp' } }, select: { id: true, number: true } });
    const y = cards.find((c) => !usedKeys.has(promoNumberKey(c.number, PREFIX.svp)))!;
    expect(y).toBeDefined();
    const base = (await setBase('svp')).find((b) => f.prices.some((r) => r.productId === b.tcgplayerProductId && (r.marketPrice ?? 0) > 0))!;
    expect(await h.prisma.priceReference.count({ where: { cardProductId: base.id } })).toBeGreaterThan(0);
    const moved = f.products.map((p) => (p.productId === base.tcgplayerProductId ? { ...p, number: y.number, name: p.name.replace(/\s-\s.*$/, ` - ${y.number}`) } : p));
    tcgcsv.products.set(f.groupId, moved);
    expect((await refresh('svp')).status).toBe(200);
    const cp = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: base.tcgplayerProductId } });
    expect(cp.cardId).toBe(y.id);
    expect(await h.prisma.cardProduct.count({ where: { cardId: y.id, kind: 'set_base' } })).toBe(1);
    expect(await h.prisma.cardProduct.count({ where: { cardId: base.cardId, kind: 'set_base' } })).toBe(0);
    const refs = await h.prisma.priceReference.findMany({ where: { cardProductId: base.id }, select: { cardId: true } });
    expect(refs.length).toBeGreaterThan(0);
    for (const rf of refs) expect(rf.cardId).toBe(y.id);
    expect(await h.prisma.priceReference.count({ where: { cardId: base.cardId, cardProductId: base.id } })).toBe(0);
    expect(await cardsWithManySetBase('svp')).toEqual([]);
  });

  it('sello que deja de existir en TCGCSV ⇒ se elimina con su precio', async () => {
    await seedSet('svp');
    expect((await refresh('svp')).status).toBe(200);
    const f = FIX.svp;
    const st = (await h.prisma.cardProduct.findMany({ where: { kind: 'stamped', sourceGroupId: f.groupId }, include: { priceReferences: true } })).find((s) => s.priceReferences.length > 0)!;
    expect(st).toBeDefined();
    tcgcsv.products.set(f.groupId, f.products.filter((p) => p.productId !== st.tcgplayerProductId));
    expect((await refresh('svp')).status).toBe(200);
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: st.tcgplayerProductId } })).toBe(0);
    expect(await h.prisma.priceReference.count({ where: { cardProductId: st.id } })).toBe(0);
  });

  it('producto CON piezas que sale del plan: NO se borra, no se mueve, y se reporta stale_in_use', async () => {
    await seedSet('svp');
    expect((await refresh('svp')).status).toBe(200);
    const f = FIX.svp;
    const base = (await setBase('svp'))[0];
    await h.prisma.inventoryItem.create({
      data: {
        folio: `PVR-${Date.now()}`, cardId: base.cardId, productType: 'raw', rawCondition: 'NM', finish: 'normal',
        acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', cardProductId: base.tcgplayerProductId,
      },
    });
    tcgcsv.products.set(f.groupId, f.products.filter((p) => p.productId !== base.tcgplayerProductId));
    const r = await refresh('svp');
    expect(r.status).toBe(200);
    expect(r.body.promoSkipped).toEqual(expect.arrayContaining([{ number: base.card.number, reason: 'stale_in_use' }]));
    const cp = await h.prisma.cardProduct.findUnique({ where: { tcgplayerProductId: base.tcgplayerProductId } });
    expect(cp?.cardId).toBe(base.cardId);
    expect(await h.prisma.inventoryItem.count({ where: { cardProductId: base.tcgplayerProductId } })).toBe(1);
  });

  it('PV-2: nombre kilométrico (la etiqueta sale de una tabla cerrada, no puede exceder) ⇒ field_too_long en promoSkipped y ningún CardProduct', async () => {
    await seedSet('svp');
    const f = FIX.svp;
    const plain = f.products.find((p) => !/\(|\[/.test(p.name) && (p.number ?? '').length > 0)!;
    const big = { ...plain, name: 'X'.repeat(600) };
    tcgcsv.products.set(f.groupId, f.products.map((p) => (p.productId === plain.productId ? big : p)));
    const r = await refresh('svp');
    expect(r.status).toBe(200);
    expect(r.body.promoSkipped.some((s: any) => s.reason === 'field_too_long')).toBe(true);
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: plain.productId } })).toBe(0);
  });
});
