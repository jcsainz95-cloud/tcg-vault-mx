/**
 * promo-tcgcsv.e2e-spec.ts — P-PROMOS opción C (ARCHITECTURE §5.12; API_CONTRACT PROMO-B1..B7) contra Postgres REAL y la
 * app por HTTP. TCGCSV y pokemontcg.io van con dobles OFFLINE (fixtures con nombres REALES de TCGCSV 24451, medidos
 * 2026-11-07); lo demás (guards, DTO, Prisma, candado consultivo, reconciliador, escritor de precio) es el real.
 *
 *  - Acceso: sin sesión 401, cliente 403 en los dos endpoints.
 *  - PROMO-B4: grupo que empata con un set de pokemontcg.io (por `pptSetId` y por nombre) ⇒ 409 TCGCSV_GROUP_COVERED; grupo
 *    desconocido ⇒ 404 TCGCSV_GROUP_UNKNOWN; `groupId` no entero ⇒ 400. Y `GET tcgcsv-groups` no los lista.
 *  - PROMO-B1/B2: «Pikachu ex 107 (30th Celebration)» ⇒ carta 107 con imagen grande y precio; «Paradise Resort 092 [Staff]»
 *    ⇒ `CardProduct stamped` staff colgado de la base 092 (no carta propia); sello desconocido, sin número y sello sin base
 *    ⇒ en `skipped` con su motivo.
 *  - PROMO-B3: reimportar ⇒ 0 duplicados (`created:0`); 3 importaciones SIMULTÁNEAS ⇒ 0 duplicados.
 *  - PROMO-B6: carta sin precio de mercado se crea y su decisión de venta es `PRICE_PENDING` (422).
 *  - PROMO-B5 (+ NO MEDIDO del arquitecto): `remote-sets` (remoto y degradado) no lista `tcgcsv:`; `sync-all` no los toca; el
 *    resolver de refresh-variants no los recorre (no convierte un `stamped` en `promo`); una carta de pokemontcg.io cuyo
 *    producto ya es de una `tcgcsv:` NO se crea ni mueve y deja `catalog.tcgcsv_shadowed`; el barrido de precios los lee por
 *    `pptSetId`/productId; el reconciliador deja `availableFinishes` coherente.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { PokemonTcgIoClient } from '../../src/modules/catalog/pokemontcg-io.client';
import { TcgcsvSinglesBulkPriceProvider } from '../../src/modules/pricing/providers/tcgcsv-singles-bulk.provider';
import { CardProductResolverService } from '../../src/modules/catalog/card-product-resolver.service';
import { CatalogSyncService } from '../../src/modules/catalog/catalog-sync.service';
import { SaleDecisionService, hypotheticalRawSaleItem } from '../../src/modules/pricing/sale-decision.service';
import { SettingsService } from '../../src/modules/settings/settings.service';

jest.setTimeout(180_000);

const G = 24451;
const GROUP_PPT = 99001; // empata con un set local por pptSetId
const GROUP_NAME = 99002; // empata con un set local por nombre
const GROUP_FREE = 99003; // sin set de pokemontcg.io
const P = {
  meganium: 654594,
  meganiumStaff: 656800,
  pikachu: 713257,
  paradise: 714597,
  paradiseStaff: 714598,
  enamorus: 730452, // sin precio de mercado
  orphanStaff: 730999, // [Staff] sin base
  mystery: 731000, // sello desconocido
  sealed: 731001, // sin Number
};
const ext = (n: string, rarity = 'Promo') => [
  { name: 'Number', value: n },
  { name: 'Rarity', value: rarity },
];
const img = (id: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`;
const prod = (productId: number, name: string, number: string | null, rarity = 'Promo') => ({
  productId,
  name,
  number,
  rarity: number == null ? null : rarity,
  imageUrl: img(productId),
});
void ext;

const PRODUCTS = [
  prod(P.meganium, 'Meganium - 001', '001'),
  prod(P.meganiumStaff, 'Meganium - 001 [Staff]', '001'),
  prod(P.pikachu, 'Pikachu ex - 107 (30th Celebration)', '107'),
  prod(P.paradise, 'Paradise Resort - 092 (World Championships 2026)', '092'),
  prod(P.paradiseStaff, 'Paradise Resort - 092 (World Championships 2026) [Staff]', '092'),
  prod(P.enamorus, 'Enamorus - 113', '113', 'Uncommon'),
  prod(P.orphanStaff, 'Orphan - 300 [Staff]', '300'),
  prod(P.mystery, 'Foo - 200 [Mystery Stamp]', '200'),
  prod(P.sealed, 'Mega Evolution Promo Pack', null),
];
const price = (productId: number, subTypeName: string, marketPrice: number | null) => ({ productId, subTypeName, marketPrice });
const PRICES_BY_GROUP: Record<number, ReturnType<typeof price>[]> = {
  [G]: [
    price(P.meganium, 'Holofoil', 1.5),
    price(P.meganiumStaff, 'Holofoil', 4),
    price(P.pikachu, 'Holofoil', 25),
    price(P.paradise, 'Normal', 2),
    price(P.paradiseStaff, 'Normal', 9.99),
    price(P.enamorus, 'Normal', null), // existe la fila pero sin mercado
    price(P.orphanStaff, 'Holofoil', 3),
  ],
};

class FakeTcgcsv {
  groups = [
    { groupId: G, name: 'ME: Mega Evolution Promo', publishedOn: '2025-09-26T00:00:00' },
    { groupId: GROUP_PPT, name: 'Promo Cov Ppt Group' },
    { groupId: GROUP_NAME, name: 'SV02: Paldea Evolved Promocov' },
    { groupId: GROUP_FREE, name: 'Free Group', publishedOn: '2024-01-01T00:00:00' },
  ];
  prices = PRICES_BY_GROUP;
  fail = false;
  async listGroups() {
    if (this.fail) throw new Error('tcgcsv down');
    return this.groups;
  }
  async getCardProducts(groupId: number) {
    if (this.fail) throw new Error('tcgcsv down');
    return groupId === G ? PRODUCTS : [];
  }
  async getProducts(groupId: number) {
    return groupId === G ? PRODUCTS.map((p) => ({ productId: p.productId, name: p.name, number: p.number })) : [];
  }
  async getPrices(groupId: number) {
    return this.prices[groupId] ?? [];
  }
}

class FakePtcg {
  sets: { id: string; name: string; series?: string; releaseDate?: string; printedTotal?: number }[] = [];
  cards: Record<string, unknown[]> = {};
  down = false;
  async getSets() {
    if (this.down) throw new Error('pokemontcg.io down');
    return this.sets;
  }
  async getCardsBySet(setId: string) {
    const data = this.cards[setId] ?? [];
    return { data, page: 1, pageSize: 250, count: data.length, totalCount: data.length };
  }
}

describe('E2E — P-PROMOS opción C: import de cartas desde un grupo de TCGCSV (PROMO-B1..B7)', () => {
  let h: E2EHarness;
  let admin: string;
  let customer: string;
  const tcgcsv = new FakeTcgcsv();
  const ptcg = new FakePtcg();
  const run = randomUUID().slice(0, 8);
  const SET_EXT = `tcgcsv:${G}`;
  const localExt = { ppt: `promocov-ppt-${run}`, name: `promocov-name-${run}`, shadow: `zzshadow-${run}` };

  const setRow = () => h.prisma.cardSet.findUnique({ where: { externalId: SET_EXT } });
  const cardsOfSet = async () => h.prisma.card.findMany({ where: { set: { externalId: SET_EXT } }, orderBy: { number: 'asc' } });
  const productsOfSet = () => h.prisma.cardProduct.findMany({ where: { sourceGroupId: G }, orderBy: { tcgplayerProductId: 'asc' } });
  const importG = (token = admin) => h.api<any>('POST', '/admin/catalog/import-tcgcsv-set', { token, json: { groupId: G } });

  async function wipe() {
    const sets = await h.prisma.cardSet.findMany({
      where: { externalId: { in: [SET_EXT, `tcgcsv:${GROUP_PPT}`, `tcgcsv:${GROUP_NAME}`, 'tcgcsv:424242', localExt.ppt, localExt.name, localExt.shadow] } },
      select: { id: true },
    });
    const setIds = sets.map((s) => s.id);
    const cards = await h.prisma.card.findMany({ where: { setId: { in: setIds } }, select: { id: true } });
    const cardIds = cards.map((c) => c.id);
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.stampedProductCandidate.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.tcgcsv_import', 'catalog.tcgcsv_shadowed'] } } });
  }

  beforeAll(async () => {
    h = await E2EHarness.create((b) =>
      b.overrideProvider(TcgcsvCatalogClient).useValue(tcgcsv).overrideProvider(PokemonTcgIoClient).useValue(ptcg),
    );
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    await wipe();
    // Sets locales de pokemontcg.io que "cubren" dos grupos (por pptSetId y por nombre).
    await h.prisma.cardSet.create({ data: { externalId: localExt.ppt, name: 'Promo Cov Ppt', pptSetId: String(GROUP_PPT) } });
    await h.prisma.cardSet.create({ data: { externalId: localExt.name, name: 'Paldea Evolved Promocov' } });
  });

  afterAll(async () => {
    if (h) {
      await wipe();
      await h.close();
    }
  });

  it('acceso: sin sesión 401, cliente 403 en los dos endpoints', async () => {
    expect((await h.api('GET', '/admin/catalog/tcgcsv-groups')).status).toBe(401);
    expect((await h.api('GET', '/admin/catalog/tcgcsv-groups', { token: customer })).status).toBe(403);
    expect((await h.api('POST', '/admin/catalog/import-tcgcsv-set', { token: customer, json: { groupId: G } })).status).toBe(403);
    expect(await setRow()).toBeNull();
  });

  it('PROMO-B4: grupos con set de pokemontcg.io (pptSetId o nombre) ⇒ 409 y no se listan; desconocido 404; groupId basura 400', async () => {
    const list = await h.api<any[]>('GET', '/admin/catalog/tcgcsv-groups', { token: admin });
    expect(list.status).toBe(200);
    const ids = list.body.map((g) => g.groupId);
    expect(ids).toEqual(expect.arrayContaining([G, GROUP_FREE]));
    expect(ids).not.toContain(GROUP_PPT);
    expect(ids).not.toContain(GROUP_NAME);
    expect(list.body.find((g) => g.groupId === G)).toEqual({
      groupId: G,
      name: 'ME: Mega Evolution Promo',
      publishedOn: '2025-09-26T00:00:00',
      imported: false,
      cardCount: 0,
    });
    for (const groupId of [GROUP_PPT, GROUP_NAME]) {
      const r = await h.api<any>('POST', '/admin/catalog/import-tcgcsv-set', { token: admin, json: { groupId } });
      expect(r.status).toBe(409);
      expect(r.body.error?.code ?? r.body.code).toBe('TCGCSV_GROUP_COVERED');
    }
    const unknown = await h.api<any>('POST', '/admin/catalog/import-tcgcsv-set', { token: admin, json: { groupId: 424242 } });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code ?? unknown.body.code).toBe('TCGCSV_GROUP_UNKNOWN');
    for (const bad of [{ groupId: 'x' }, { groupId: 1.5 }, {}]) {
      expect((await h.api('POST', '/admin/catalog/import-tcgcsv-set', { token: admin, json: bad })).status).toBe(400);
    }
    expect(await h.prisma.cardSet.count({ where: { externalId: { in: [`tcgcsv:${GROUP_PPT}`, `tcgcsv:${GROUP_NAME}`, 'tcgcsv:424242'] } } })).toBe(0);
  });

  it('TCGCSV caído ⇒ 502 y no se escribe nada', async () => {
    tcgcsv.fail = true;
    try {
      const r = await importG();
      expect(r.status).toBe(502);
      expect(await setRow()).toBeNull();
    } finally {
      tcgcsv.fail = false;
    }
  });

  it('PROMO-B1/B2/B7: importar 24451 crea cartas con imagen y precio, el sello cuelga de su base y lo dudoso se reporta', async () => {
    const r = await importG();
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['created', 'noPrice', 'setId', 'skipped', 'stamped', 'updated']);
    const set = (await setRow())!;
    expect(r.body).toMatchObject({ setId: set.id, created: 4, updated: 0, stamped: 2, noPrice: 1 });
    expect([...r.body.skipped].sort((a: any, b: any) => a.productId - b.productId)).toEqual(
      [
        { productId: P.orphanStaff, name: 'Orphan - 300 [Staff]', reason: 'no_base' },
        { productId: P.mystery, name: 'Foo - 200 [Mystery Stamp]', reason: 'unknown_stamp' },
        { productId: P.sealed, name: 'Mega Evolution Promo Pack', reason: 'no_number' },
      ].sort((a, b) => a.productId - b.productId),
    );
    expect(set).toMatchObject({ name: 'ME: Mega Evolution Promo', pptSetId: String(G), tcgcsvGroupId: G, releaseDate: '2025/09/26' });

    // B1: Pikachu 107 con paréntesis, imagen grande y precio de mercado.
    const pika = await h.prisma.card.findUniqueOrThrow({ where: { externalId: `tcgcsv:${P.pikachu}` } });
    expect(pika).toMatchObject({ name: 'Pikachu ex (30th Celebration)', number: '107', tcgplayerId: String(P.pikachu), rarity: 'Promo' });
    expect(pika.imageSmallUrl).toBe(img(P.pikachu));
    expect(pika.imageLargeUrl).toBe(`https://tcgplayer-cdn.tcgplayer.com/product/${P.pikachu}_in_1000x1000.jpg`);
    expect(pika.availableFinishes).toEqual(['holofoil']);
    const ref = await h.prisma.priceReference.findFirstOrThrow({ where: { cardId: pika.id, finish: 'holofoil' } });
    expect(ref).toMatchObject({ source: 'tcgcsv_singles', refKind: 'market', priceUsdCents: 2500 });
    expect(ref.priceMxnCents).toBeGreaterThan(0);

    // B2: el sello es un CardProduct stamped de la base 092 (no una carta con «[Staff]»).
    const cards = await cardsOfSet();
    expect(cards.map((c) => c.number)).toEqual(['001', '092', '107', '113']);
    expect(cards.some((c) => /\[/.test(c.name))).toBe(false);
    const paradise = cards.find((c) => c.number === '092')!;
    expect(paradise.name).toBe('Paradise Resort (World Championships 2026)');
    const staff = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P.paradiseStaff } });
    expect(staff).toMatchObject({ cardId: paradise.id, kind: 'stamped', stampType: 'staff', stampLabel: 'Staff', sourceGroupId: G });
    const staffRef = await h.prisma.priceReference.findFirstOrThrow({ where: { cardProductId: staff.id } });
    expect(staffRef.priceUsdCents).toBe(999);
    // El sello no altera los acabados de la base ni su precio.
    expect(paradise.availableFinishes).toEqual(['normal']);
    const prods = await productsOfSet();
    expect(prods.filter((p) => p.kind === 'set_base')).toHaveLength(4);
    expect(prods.filter((p) => p.kind === 'stamped')).toHaveLength(2);
    // B7: lo omitido NO existe.
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: { in: [P.orphanStaff, P.mystery, P.sealed] } } })).toBe(0);
    expect(await h.prisma.card.count({ where: { externalId: { in: [P.orphanStaff, P.mystery, P.sealed].map((x) => `tcgcsv:${x}`) } } })).toBe(0);
    // Auditoría del controller.
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'catalog.tcgcsv_import', entityId: set.id } });
    expect(audit?.after).toMatchObject({ groupId: G, created: 4, stamped: 2, noPrice: 1, skipped: 3 });
    // Y el listado lo marca importado.
    const list = await h.api<any[]>('GET', '/admin/catalog/tcgcsv-groups', { token: admin });
    expect(list.body.find((g) => g.groupId === G)).toMatchObject({ imported: true, cardCount: 4 });
  });

  it('PROMO-B3: reimportar y 3 importaciones simultáneas ⇒ 0 duplicados', async () => {
    const before = { cards: await cardsOfSet(), prods: await productsOfSet(), refs: await h.prisma.priceReference.count({ where: { card: { set: { externalId: SET_EXT } } } }) };
    const again = await importG();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: 0, updated: 4, stamped: 2, noPrice: 1 });
    const all = await Promise.all([importG(), importG(), importG()]);
    expect(all.map((x) => x.status)).toEqual([200, 200, 200]);
    for (const x of all) expect(x.body).toMatchObject({ created: 0, updated: 4, stamped: 2 });
    expect((await cardsOfSet()).map((c) => c.id)).toEqual(before.cards.map((c) => c.id));
    expect((await productsOfSet()).map((p) => p.id)).toEqual(before.prods.map((p) => p.id));
    // Precio sin cambio ⇒ write-on-change: ninguna fila nueva.
    expect(await h.prisma.priceReference.count({ where: { card: { set: { externalId: SET_EXT } } } })).toBe(before.refs);
    expect(await h.prisma.cardSet.count({ where: { externalId: SET_EXT } })).toBe(1);
  });

  it('PROMO-B3 (estrés del candado): primera importación concurrente desde cero ⇒ 0 duplicados', async () => {
    await wipe();
    await h.prisma.cardSet.create({ data: { externalId: localExt.ppt, name: 'Promo Cov Ppt', pptSetId: String(GROUP_PPT) } });
    await h.prisma.cardSet.create({ data: { externalId: localExt.name, name: 'Paldea Evolved Promocov' } });
    const all = await Promise.all([importG(), importG(), importG()]);
    expect(all.map((x) => x.status)).toEqual([200, 200, 200]);
    expect((await cardsOfSet()).length).toBe(4);
    expect((await productsOfSet()).length).toBe(6);
    expect(await h.prisma.cardSet.count({ where: { externalId: SET_EXT } })).toBe(1);
    // Exactamente una de las tres creó (las otras esperaron el candado y actualizaron).
    expect(all.reduce((n, x) => n + x.body.created, 0)).toBe(4);
  });

  it('PROMO-B6: la carta sin precio se crea y su venta es PRICE_PENDING; la que tiene precio sí se decide', async () => {
    const decider = h.app.get(SaleDecisionService);
    const dials = await h.app.get(SettingsService).getIvaDials();
    const item = async (productId: number, finish: 'normal' | 'holofoil') => {
      const card = await h.prisma.card.findUniqueOrThrow({ where: { externalId: `tcgcsv:${productId}` }, include: { set: true } });
      return hypotheticalRawSaleItem({ id: randomUUID(), folio: 'PROMO-TEST', card, finish, language: 'en', cardProductId: null });
    };
    const priced = await decider.decide(await item(P.pikachu, 'holofoil'), dials);
    expect(priced.unitPriceCents).toBeGreaterThan(0);
    await expect(decider.decide(await item(P.enamorus, 'normal'), dials)).rejects.toMatchObject({ code: 'PRICE_PENDING', status: 422 });
    const enamorus = await h.prisma.card.findUniqueOrThrow({ where: { externalId: `tcgcsv:${P.enamorus}` } });
    expect(await h.prisma.priceReference.count({ where: { cardId: enamorus.id } })).toBe(0);
    expect(enamorus.availableFinishes).toEqual(['normal']);
  });

  it('PROMO-B5 / NO MEDIDO: remote-sets (remoto y degradado) no lista `tcgcsv:`; sync-all no toca estos sets', async () => {
    const snapshot = async () => JSON.stringify([(await cardsOfSet()).map((c) => [c.id, c.name, c.number, c.imageLargeUrl]), (await productsOfSet()).map((p) => [p.id, p.kind, p.cardId])]);
    const before = await snapshot();

    ptcg.sets = [{ id: 'zzremote', name: 'Zz Remote', releaseDate: '2026/01/01', printedTotal: 1 }];
    const remote = await h.api<any>('GET', '/admin/catalog/remote-sets', { token: admin });
    expect(remote.status).toBe(200);
    expect(remote.body.data.map((s: any) => s.id)).toEqual(['zzremote']);

    ptcg.down = true;
    try {
      const degraded = await h.api<any>('GET', '/admin/catalog/remote-sets', { token: admin });
      expect(degraded.body.degraded).toBe(true);
      expect(degraded.body.data.length).toBeGreaterThan(0); // los sets locales de pokemontcg.io sí
      expect(degraded.body.data.some((s: any) => s.id.startsWith('tcgcsv:'))).toBe(false);
    } finally {
      ptcg.down = false;
    }

    ptcg.sets = [];
    const all = await h.api<any>('POST', '/admin/catalog/sync-all', { token: admin, json: { force: true } });
    expect(all.status).toBe(202);
    expect(all.body.setsQueued).toBe(0);
    expect(await snapshot()).toBe(before);
    // `refresh-variants` por set: el id con «:» no pasa el patrón (400), y el barrido por lote no lo encola.
    expect((await h.api('POST', '/admin/catalog/refresh-variants', { token: admin, json: { setId: SET_EXT } })).status).toBeGreaterThanOrEqual(400);
    const queue: string[] = await (h.app.get(CatalogSyncService) as any).localSetExternalIdsWithCards();
    expect(queue.some((id) => id.startsWith('tcgcsv:'))).toBe(false);
  });

  it('PROMO-B5 / NO MEDIDO: el resolver de variantes NO recorre un set `tcgcsv:` (un `stamped` no pasa a `promo`)', async () => {
    const set = (await setRow())!;
    const before = await productsOfSet();
    expect(await h.app.get(CardProductResolverService).resolveCardProductsForSet(set.id)).toBeNull();
    const after = await productsOfSet();
    expect(after.map((p) => [p.id, p.kind, p.stampType, p.cardId, p.finishes])).toEqual(before.map((p) => [p.id, p.kind, p.stampType, p.cardId, p.finishes]));
  });

  it('PROMO-B5: carta de pokemontcg.io cuyo producto ya es de una `tcgcsv:` ⇒ NO se crea ni se mueve y queda `catalog.tcgcsv_shadowed`', async () => {
    const pikaCard = await h.prisma.card.findUniqueOrThrow({ where: { externalId: `tcgcsv:${P.pikachu}` } });
    const cpBefore = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P.pikachu } });
    ptcg.sets = [{ id: localExt.shadow, name: 'Zz Shadow Set', releaseDate: '2026/02/02', printedTotal: 2 }];
    const setBody = { id: localExt.shadow, name: 'Zz Shadow Set', series: 'Zz', releaseDate: '2026/02/02', printedTotal: 2 };
    ptcg.cards[localExt.shadow] = [
      { id: `${localExt.shadow}-107`, name: 'Pikachu ex', number: '107', set: setBody, tcgplayer: { url: `https://prices.pokemontcg.io/tcgplayer/${localExt.shadow}-107?x=1&u=https://www.tcgplayer.com/product/${P.pikachu}/pokemon-x` } },
      { id: `${localExt.shadow}-2`, name: 'Otra', number: '2', set: setBody, tcgplayer: { url: 'https://www.tcgplayer.com/product/555001/pokemon-otra' } },
    ];
    const r = await h.api<any>('POST', '/admin/catalog/sync', { token: admin, json: { setId: localExt.shadow } });
    expect(r.status).toBe(202);
    expect(await h.prisma.card.findUnique({ where: { externalId: `${localExt.shadow}-107` } })).toBeNull();
    expect(await h.prisma.card.findUnique({ where: { externalId: `${localExt.shadow}-2` } })).not.toBeNull(); // la no sombreada sí
    const cpAfter = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P.pikachu } });
    expect(cpAfter.cardId).toBe(cpBefore.cardId);
    expect(cpAfter.cardId).toBe(pikaCard.id);
    const shadow = await h.prisma.auditLog.findMany({ where: { action: 'catalog.tcgcsv_shadowed' } });
    expect(shadow).toHaveLength(1);
    expect(shadow[0].after).toMatchObject({ pokemontcgIoCardId: `${localExt.shadow}-107`, tcgplayerProductId: String(P.pikachu) });
    // Tras ese sync, el set 24451 sigue intacto.
    expect((await cardsOfSet()).length).toBe(4);
    ptcg.sets = [];
  });

  it('NO MEDIDO: el barrido de precios resuelve estos sets por pptSetId y escribe por productId (también el sello)', async () => {
    const set = (await setRow())!;
    // Sube el mercado de Pikachu (25 ⇒ 31 USD) y el del sello de Paradise (9.99 ⇒ 12.5): el barrido debe verlos.
    tcgcsv.prices = {
      [G]: PRICES_BY_GROUP[G].map((p) =>
        p.productId === P.pikachu ? { ...p, marketPrice: 31 } : p.productId === P.paradiseStaff ? { ...p, marketPrice: 12.5 } : p,
      ),
    };
    try {
      const res = await h.app.get(TcgcsvSinglesBulkPriceProvider).fetchPricesForSet({ set });
      expect(res.requestOk).toBe(true);
      expect(res.setUnresolved).toBeUndefined();
      const byProduct = new Map(res.rows.map((x) => [x.externalId, x]));
      expect(byProduct.get(`tcgcsv:${P.pikachu}`)).toMatchObject({ finish: 'holofoil', marketCents: 3100 });
      const staff = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P.paradiseStaff } });
      expect(res.rows.find((x) => x.cardProductId === staff.id)).toMatchObject({ marketCents: 1250 });
      // Lo sin precio (Enamorus) no produce fila: sigue PRICE_PENDING.
      expect(res.rows.some((x) => x.externalId === `tcgcsv:${P.enamorus}`)).toBe(false);
    } finally {
      tcgcsv.prices = PRICES_BY_GROUP;
    }
  });
});
