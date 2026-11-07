/**
 * promo-viejas.e2e-spec.ts — P-PROMOS-VIEJAS (ARCHITECTURE §5.13; API_CONTRACT PV-B1..B8) contra Postgres REAL y la app por HTTP.
 * TCGCSV y pokemontcg.io van con dobles OFFLINE alimentados con los JSON REALES medidos el 2026-11-07 (test/fixtures/promos-viejas/
 * <set>.json: cartas de pokemontcg.io + productos y precios del grupo TCGCSV). Lo demás (Prisma, candado, reconciliador, escritor
 * de precio, `refresh-variants`, barrido de precio) es el real.
 *
 *  - Los 6 sets (svp, swshp, smp, xyp, bwp, dpp): conteo de cartas CON precio / PENDIENTES por set, y segunda corrida ⇒ 0 filas nuevas.
 *  - PV-B1 tabla > pptSetId (xyp con `pptSetId='sv-promos'` y con '1400' ⇒ 1451; también el barrido diario de precio).
 *  - PV-B2 BW004 (pokemontcg.io) = BW04 (TCGCSV) con el dato real; PV-B3 XY67a no recibe el producto XY67.
 *  - PV-B5 un sello nunca hereda el precio de la plana (todo CardProduct stamped lleva SU precio); PV-B6/B8 con datos reales.
 *  - Sin producto o sin precio ⇒ ni CardProduct ni PriceReference (Precio pendiente), jamás 0.
 */
import * as fs from 'fs';
import * as path from 'path';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { PokemonTcgIoClient } from '../../src/modules/catalog/pokemontcg-io.client';
import { TcgcsvSinglesBulkPriceProvider } from '../../src/modules/pricing/providers/tcgcsv-singles-bulk.provider';

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

/** Medido con los JSON reales (2026-11-07): cartas CON precio / PENDIENTES por set. */
const EXPECTED: Record<string, { cards: number; priced: number; pending: number }> = {
  svp: { cards: 200, priced: 188, pending: 12 },
  swshp: { cards: 304, priced: 293, pending: 11 },
  smp: { cards: 251, priced: 243, pending: 8 },
  xyp: { cards: 216, priced: 182, pending: 34 },
  bwp: { cards: 101, priced: 88, pending: 13 },
  dpp: { cards: 56, priced: 50, pending: 6 },
};

class FakeTcgcsv {
  calls: string[] = [];
  async listGroups() {
    this.calls.push('listGroups');
    return []; // el empate por nombre NO debe ser necesario para estos sets (falló 20/20)
  }
  async getCardProducts(groupId: number) {
    return BY_GROUP.get(groupId)?.products ?? [];
  }
  async getProducts(groupId: number) {
    return (BY_GROUP.get(groupId)?.products ?? []).map((p) => ({ productId: p.productId, name: p.name, number: p.number }));
  }
  async getPrices(groupId: number) {
    return BY_GROUP.get(groupId)?.prices ?? [];
  }
}
class FakePtcg {
  async getSets() {
    return [];
  }
}

describe('E2E — P-PROMOS-VIEJAS: productos y precios de las promos viejas por tabla fija (PV-B1..B8, datos reales)', () => {
  let h: E2EHarness;
  let admin: string;
  const tcgcsv = new FakeTcgcsv();

  async function wipe() {
    const sets = await h.prisma.cardSet.findMany({ where: { externalId: { in: Object.keys(FIX) } }, select: { id: true } });
    const setIds = sets.map((s) => s.id);
    const cardIds = (await h.prisma.card.findMany({ where: { setId: { in: setIds } }, select: { id: true } })).map((c) => c.id);
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.stampedProductCandidate.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
  }
  async function seedSet(id: string, pptSetId: string | null = null) {
    const f = FIX[id];
    const set = await h.prisma.cardSet.create({ data: { externalId: id, name: `Promos ${id}`, pptSetId } });
    await h.prisma.card.createMany({
      data: f.cards.map((c) => ({ externalId: c.externalId, setId: set.id, name: c.name, number: c.number })),
    });
    return set;
  }
  const refresh = (id: string) => h.api<any>('POST', '/admin/catalog/refresh-variants', { token: admin, json: { setId: id } });
  /** Cartas del set con PriceReference de un CardProduct `set_base` (= las que se venden con precio). */
  async function pricedCards(id: string) {
    const rows = await h.prisma.priceReference.findMany({
      where: { card: { set: { externalId: id } }, cardProduct: { kind: 'set_base' } },
      select: { cardId: true },
    });
    return new Set(rows.map((r) => r.cardId));
  }
  const snap = async (id: string) => ({
    products: await h.prisma.cardProduct.count({ where: { card: { set: { externalId: id } } } }),
    prices: await h.prisma.priceReference.count({ where: { card: { set: { externalId: id } } } }),
    cards: await h.prisma.card.count({ where: { set: { externalId: id } } }),
  });

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
  beforeEach(wipe);

  it.each(['svp', 'bwp', 'swshp', 'smp', 'xyp', 'dpp'])(
    '%s: refresh-variants deja las cartas con precio / pendientes medidas, nunca crea cartas, y la 2.ª corrida escribe 0 filas nuevas',
    async (id) => {
      await seedSet(id);
      const exp = EXPECTED[id];
      const first = await refresh(id);
      expect(first.status).toBe(200);
      expect(Array.isArray(first.body.promoSkipped)).toBe(true);
      const priced = await pricedCards(id);
      expect({ cards: (await snap(id)).cards, priced: priced.size, pending: exp.cards - priced.size }).toEqual(exp);
      const reasons = new Set(first.body.promoSkipped.map((s: any) => s.reason));
      for (const r of reasons) expect(['no_card', 'unknown_stamp', 'ambiguous_base', 'ambiguous_number']).toContain(r);
      const before = await snap(id);
      const second = await refresh(id);
      expect(second.status).toBe(200);
      expect(second.body.promoSkipped).toEqual(first.body.promoSkipped);
      expect((await pricedCards(id)).size).toBe(exp.priced);
      const after = await snap(id);
      expect(after.products).toBe(before.products); // 0 CardProduct nuevos
      expect(after.cards).toBe(before.cards);
      // Money-safe: ninguna fila de precio en 0 ni sin producto; todo precio cuelga de un CardProduct de ESTE grupo.
      const refs = await h.prisma.priceReference.findMany({
        where: { card: { set: { externalId: id } } },
        select: { priceUsdCents: true, cardProductId: true, cardProduct: { select: { sourceGroupId: true } } },
      });
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) {
        expect(r.cardProductId).not.toBeNull();
        expect(r.cardProduct?.sourceGroupId).toBe(FIX[id].groupId);
        expect(r.priceUsdCents ?? 0).toBeGreaterThan(0);
      }
      expect(tcgcsv.calls).not.toContain('listGroups'); // la tabla manda: el nombre no se consulta
    },
  );

  it('PV-B5/PV-B3 (datos reales): todo CardProduct stamped lleva SU precio de mercado (jamás el de la plana) y su carta solo recibe el producto de su número exacto', async () => {
    for (const id of ['svp', 'bwp', 'smp']) {
      await seedSet(id);
      expect((await refresh(id)).status).toBe(200);
      const price = new Map<number, number>();
      for (const r of FIX[id].prices) if (r.marketPrice && r.marketPrice > 0) price.set(r.productId, Math.round(r.marketPrice * 100));
      const stamped = await h.prisma.cardProduct.findMany({
        where: { kind: 'stamped', sourceGroupId: FIX[id].groupId },
        include: { priceReferences: true, card: { select: { number: true, set: { select: { externalId: true } } } } },
      });
      expect(stamped.length).toBeGreaterThan(15); // 27-52 versiones con sello por set (HECHOS 2026-11-07)
      let withOwnPrice = 0;
      for (const cp of stamped) {
        expect(cp.stampType).not.toBeNull();
        expect(cp.card.set.externalId).toBe(id);
        const own = price.get(cp.tcgplayerProductId);
        if (own == null) {
          expect(cp.priceReferences).toHaveLength(0); // sin mercado propio ⇒ sin precio (no hereda el de la plana)
        } else {
          withOwnPrice += 1;
          expect(cp.priceReferences.length).toBeGreaterThan(0);
          for (const pr of cp.priceReferences) expect(pr.priceUsdCents).toBe(own);
        }
      }
      expect(withOwnPrice).toBeGreaterThan(0);
    }
  });

  it('PV-B2 (ceros, datos reales): «1» de pokemontcg.io = «001» de TCGCSV (svp) y «BW004» (bwp) casan con UNA carta y UN producto base, con precio', async () => {
    await seedSet('svp');
    await seedSet('bwp');
    expect((await refresh('svp')).status).toBe(200);
    expect((await refresh('bwp')).status).toBe(200);
    for (const [ext, tcNumber] of [['svp-1', '001'], ['bwp-BW004', 'BW004']] as const) {
      const card = await h.prisma.card.findUniqueOrThrow({ where: { externalId: ext }, include: { cardProducts: true } });
      const bases = card.cardProducts.filter((p) => p.kind === 'set_base');
      expect(bases).toHaveLength(1);
      const fx = FIX[ext.split('-')[0]];
      expect(fx.products.find((p) => p.productId === bases[0].tcgplayerProductId)!.number).toBe(tcNumber);
      expect((await pricedCards(ext.split('-')[0])).has(card.id)).toBe(true);
    }
    expect(await h.prisma.card.count({ where: { set: { externalId: 'svp' } } })).toBe(200); // jamás se crea carta
  });

  it('PV-B3 + medición XY67a/XY150a/SM30a (datos reales): TCGCSV solo trae XY67/XY150/SM30, así que la «a» queda sin producto (Precio pendiente) y la plana sí casa', async () => {
    await seedSet('xyp');
    await seedSet('smp');
    expect((await refresh('xyp')).status).toBe(200);
    expect((await refresh('smp')).status).toBe(200);
    const get = (ext: string) => h.prisma.card.findUniqueOrThrow({ where: { externalId: ext }, include: { cardProducts: true } });
    const xy67 = await get('xyp-XY67');
    const xy67a = await get('xyp-XY67a');
    expect(xy67.cardProducts.map((p) => p.tcgplayerProductId)).toEqual([108596]); // «Jirachi - XY67»
    expect(xy67a.cardProducts).toHaveLength(0);
    expect((await get('xyp-XY150a')).cardProducts).toHaveLength(0);
    expect((await get('smp-SM30a')).cardProducts).toHaveLength(0);
    expect((await get('smp-SM30')).cardProducts.map((p) => p.tcgplayerProductId)).toEqual([131733]);
    expect(await h.prisma.priceReference.count({ where: { cardId: xy67a.id } })).toBe(0);
  });

  it('PV-B1: la tabla manda sobre pptSetId (xyp con «sv-promos», con «1400» o con el id de OTRO grupo ⇒ 1451) tanto en estructura como en el barrido diario de precio', async () => {
    for (const ppt of ['sv-promos', '1400', '22872']) {
      await wipe();
      const set = await seedSet('xyp', ppt);
      expect((await refresh('xyp')).status).toBe(200);
      const groups = await h.prisma.cardProduct.groupBy({ by: ['sourceGroupId'], where: { card: { setId: set.id } } });
      expect(groups.map((g) => g.sourceGroupId)).toEqual([1451]);
      const res = await h.app.get(TcgcsvSinglesBulkPriceProvider).fetchPricesForSet({ set });
      expect(res.requestOk).toBe(true);
      expect(res.setUnresolved).toBeUndefined();
      expect(res.rows.length).toBeGreaterThan(100);
      const ids = new Set((await h.prisma.cardProduct.findMany({ where: { card: { setId: set.id } }, select: { id: true } })).map((p) => p.id));
      for (const r of res.rows) expect(ids.has(r.cardProductId!)).toBe(true);
    }
    // pptSetId NO se reescribe por esta vía.
    expect((await h.prisma.cardSet.findUniqueOrThrow({ where: { externalId: 'xyp' } })).pptSetId).toBe('22872');
  });

  it('PV-B6/PV-B8 (datos reales): victory cups BW29-31 (3 candidatos con sello) ⇒ todos stamped y la carta pendiente; «Nintendo Power» y similares ⇒ unknown_stamp', async () => {
    await seedSet('bwp');
    const r = await refresh('bwp');
    expect(r.status).toBe(200);
    expect(r.body.promoSkipped).toEqual(expect.arrayContaining([{ number: 'BW29', reason: 'ambiguous_base' }]));
    const bw29 = await h.prisma.card.findUniqueOrThrow({ where: { externalId: 'bwp-BW29' }, include: { cardProducts: true } });
    expect(bw29.cardProducts.length).toBeGreaterThan(1);
    expect(bw29.cardProducts.every((p) => p.kind === 'stamped')).toBe(true);
    expect((await pricedCards('bwp')).has(bw29.id)).toBe(false);
    expect(r.body.promoSkipped.filter((s: any) => s.reason === 'unknown_stamp').length).toBeGreaterThan(0);
  });
});
