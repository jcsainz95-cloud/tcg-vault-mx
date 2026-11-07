/**
 * promo-tcgcsv.e2e-spec.ts — P-PROMOS opción C, 2.ª ronda (ARCHITECTURE §5.12; API_CONTRACT PROMO-B1..B7) contra Postgres REAL
 * (pool de 5) y la app por HTTP. TCGCSV y pokemontcg.io van con dobles OFFLINE (nombres REALES de TCGCSV 24451, medidos
 * 2026-11-07); lo demás (guards, DTO, Prisma, candado consultivo, reconciliador, escritor de precio) es el real.
 *
 *  - Acceso: sin sesión 401, cliente 403. Lista explícita: SOLO 24451 se lista/importa; 22872 y 24722 y cualquier otro ⇒ 404.
 *  - Fail-closed: pokemontcg.io caído ⇒ 503 POKEMONTCG_UNAVAILABLE y 0 filas. Set publicado allí (por id o por nombre) ⇒ 409 COVERED.
 *  - Sellos: `(30th Celebration)` se queda en el nombre; `[Staff]`/`(Prerelease)`/`(Winner)` ⇒ producto aparte; otro paréntesis o
 *    corchete ⇒ `unknown_stamp`; campos pasados de tope ⇒ `field_too_long`.
 *  - Atomicidad: fallo a mitad ⇒ 0 filas (503 TCGCSV_IMPORT_FAILED); candado ocupado ⇒ 409 inmediato; N=30 simultáneos con pool 5
 *    ⇒ 1×200, 29×409, 0×5xx; reimportar ⇒ 0 duplicados.
 *  - PROMO-B6 `PRICE_PENDING`; PROMO-B5 sombra POR SET (sync/sync-all/upsertCards de `mep` con set local `tcgcsv:24451` ⇒ 0 nuevas
 *    + aviso + AuditLog), remote-sets y resolver no recorren `tcgcsv:`; el barrido de precios los lee por pptSetId/productId.
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
import { PricingService } from '../../src/modules/pricing/pricing.service';

jest.setTimeout(180_000);

const G = 24451;
const P = {
  meganium: 654594,
  meganiumStaff: 656800,
  pikachu: 713257, // «Pikachu ex - 107 (30th Celebration)»
  paradise: 714597,
  paradiseStaff: 714598,
  enamorus: 730452, // sin precio de mercado
  orphanStaff: 730999, // [Staff] sin base
  mystery: 731000, // corchete desconocido
  pcenter: 731002, // paréntesis desconocido
  sealed: 731001, // sin Number
  tox: 663194,
  toxPre: 663193, // «(Prerelease)»
  pika93: 716741,
  pika93Win: 716740, // «(Winner)»
  longy: 731003, // rareza de 65 caracteres
};
const img = (id: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`;
const prod = (productId: number, name: string, number: string | null, rarity = 'Promo') => ({
  productId,
  name,
  number,
  rarity: number == null ? null : rarity,
  imageUrl: img(productId),
});

const PRODUCTS = [
  prod(P.meganium, 'Meganium - 001', '001'),
  prod(P.meganiumStaff, 'Meganium - 001 [Staff]', '001'),
  prod(P.pikachu, 'Pikachu ex - 107 (30th Celebration)', '107'),
  prod(P.paradise, 'Paradise Resort - 092', '092'),
  prod(P.paradiseStaff, 'Paradise Resort - 092 [Staff]', '092'),
  prod(P.enamorus, 'Enamorus - 113', '113', 'Uncommon'),
  prod(P.orphanStaff, 'Orphan - 300 [Staff]', '300'),
  prod(P.mystery, 'Foo - 200 [Mystery Stamp]', '200'),
  prod(P.pcenter, 'Alakazam - 009 (Pokemon Center Exclusive)', '009'),
  prod(P.sealed, 'Mega Evolution Promo Pack', null),
  prod(P.tox, 'Toxtricity - 017', '017'),
  prod(P.toxPre, 'Toxtricity - 017 (Prerelease)', '017'),
  prod(P.pika93, 'Pikachu - 093', '093'),
  prod(P.pika93Win, 'Pikachu - 093 (Winner)', '093'),
  prod(P.longy, 'Longy - 300', '300', 'R'.repeat(65)),
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
    price(P.tox, 'Holofoil', 1),
    price(P.toxPre, 'Holofoil', 2),
    price(P.pika93, 'Holofoil', 3),
    price(P.pika93Win, 'Holofoil', 8),
    price(P.longy, 'Normal', 1),
  ],
};

class FakeTcgcsv {
  groups = [
    { groupId: G, name: 'ME: Mega Evolution Promo', publishedOn: '2025-09-26T00:00:00' },
    { groupId: 22872, name: 'SV: Scarlet & Violet Promo Cards' },
    { groupId: 24722, name: 'Zz Otro Grupo' },
  ];
  prices = PRICES_BY_GROUP;
  fail = false;
  failProducts = false;
  /** Espera en la descarga: hace que N peticiones lleguen JUNTAS a la transacción. */
  delayMs = 0;
  async listGroups() {
    if (this.fail) throw new Error('tcgcsv down');
    return this.groups;
  }
  async getCardProducts(groupId: number) {
    if (this.fail || this.failProducts) throw new Error('tcgcsv down');
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
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

const codeOf = (r: { body: any }) => r.body?.error?.code ?? r.body?.code;

describe('E2E — P-PROMOS opción C (2.ª ronda): import de cartas desde un grupo de TCGCSV (PROMO-B1..B7)', () => {
  let h: E2EHarness;
  let admin: string;
  let customer: string;
  const tcgcsv = new FakeTcgcsv();
  const ptcg = new FakePtcg();
  const run = randomUUID().slice(0, 8);
  const SET_EXT = `tcgcsv:${G}`;
  const otherExt = `zzother-${run}`;

  const setRow = () => h.prisma.cardSet.findUnique({ where: { externalId: SET_EXT } });
  const cardsOfSet = async () => h.prisma.card.findMany({ where: { set: { externalId: SET_EXT } }, orderBy: { number: 'asc' } });
  const productsOfSet = () => h.prisma.cardProduct.findMany({ where: { sourceGroupId: G }, orderBy: { tcgplayerProductId: 'asc' } });
  const importG = (token = admin) => h.api<any>('POST', '/admin/catalog/import-tcgcsv-set', { token, json: { groupId: G } });
  /** 0 filas: ni set, ni cartas, ni productos, ni precios, ni bitácora del import. */
  const expectNothingWritten = async () => {
    expect(await setRow()).toBeNull();
    expect(await h.prisma.card.count({ where: { externalId: { startsWith: 'tcgcsv:' } } })).toBe(0);
    expect(await h.prisma.cardProduct.count({ where: { sourceGroupId: G } })).toBe(0);
    expect(await h.prisma.priceReference.count({ where: { card: { externalId: { startsWith: 'tcgcsv:' } } } })).toBe(0);
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.tcgcsv_import' } })).toBe(0);
  };

  async function wipe() {
    const sets = await h.prisma.cardSet.findMany({
      where: { externalId: { in: [SET_EXT, 'tcgcsv:22872', 'tcgcsv:24722', 'tcgcsv:424242', 'mep', otherExt] } },
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

  it('lista explícita: GET lista SOLO 24451 (con productCount); 22872, 24722 y desconocidos ⇒ 404; basura ⇒ 400', async () => {
    const list = await h.api<any[]>('GET', '/admin/catalog/tcgcsv-groups', { token: admin });
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      { groupId: G, name: 'ME: Mega Evolution Promo', publishedOn: '2025-09-26T00:00:00', imported: false, productCount: 14, cardCount: 0 },
    ]);
    tcgcsv.failProducts = true;
    try {
      const degraded = await h.api<any[]>('GET', '/admin/catalog/tcgcsv-groups', { token: admin });
      expect(degraded.body[0]).toMatchObject({ groupId: G, productCount: null });
    } finally {
      tcgcsv.failProducts = false;
    }
    for (const groupId of [22872, 24722, 424242]) {
      const r = await h.api<any>('POST', '/admin/catalog/import-tcgcsv-set', { token: admin, json: { groupId } });
      expect(r.status).toBe(404);
      expect(codeOf(r)).toBe('TCGCSV_GROUP_UNKNOWN');
    }
    for (const bad of [{ groupId: 'x' }, { groupId: 1.5 }, {}]) {
      expect((await h.api('POST', '/admin/catalog/import-tcgcsv-set', { token: admin, json: bad })).status).toBe(400);
    }
    expect(await h.prisma.cardSet.count({ where: { externalId: { in: ['tcgcsv:22872', 'tcgcsv:24722', 'tcgcsv:424242'] } } })).toBe(0);
  });

  it('fail-closed: pokemontcg.io caído ⇒ 503 POKEMONTCG_UNAVAILABLE y 0 filas', async () => {
    ptcg.down = true;
    try {
      const r = await importG();
      expect(r.status).toBe(503);
      expect(codeOf(r)).toBe('POKEMONTCG_UNAVAILABLE');
      await expectNothingWritten();
    } finally {
      ptcg.down = false;
    }
  });

  it('PROMO-B4: pokemontcg.io ya publica el set (por id o por nombre) ⇒ 409 TCGCSV_GROUP_COVERED y 0 filas', async () => {
    for (const sets of [
      [{ id: 'mep', name: 'Otro nombre' }],
      [{ id: 'zz-no-mep', name: 'ME: Mega Evolution Promo' }],
    ]) {
      ptcg.sets = sets;
      const r = await importG();
      expect(r.status).toBe(409);
      expect(codeOf(r)).toBe('TCGCSV_GROUP_COVERED');
      await expectNothingWritten();
    }
    ptcg.sets = [];
  });

  it('TCGCSV caído ⇒ 502 y no se escribe nada', async () => {
    tcgcsv.fail = true;
    try {
      const r = await importG();
      expect(r.status).toBe(502);
      await expectNothingWritten();
    } finally {
      tcgcsv.fail = false;
    }
  });

  it('candado ocupado ⇒ 409 TCGCSV_IMPORT_IN_PROGRESS inmediato (sin esperar) y 0 filas', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = h.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tcgcsv-import'), ${G}::int)`;
        locked();
        await held;
      },
      { timeout: 60_000 },
    );
    await isLocked;
    try {
      const t0 = Date.now();
      const r = await importG();
      expect(r.status).toBe(409);
      expect(codeOf(r)).toBe('TCGCSV_IMPORT_IN_PROGRESS');
      expect(Date.now() - t0).toBeLessThan(3000);
      await expectNothingWritten();
    } finally {
      release();
      await holder;
    }
  });

  it('atomicidad: un fallo a mitad del import ⇒ rollback total (0 filas) y 503 TCGCSV_IMPORT_FAILED', async () => {
    const pricing = h.app.get(PricingService);
    const real = pricing.persistMarketReference.bind(pricing);
    let calls = 0;
    const spy = jest.spyOn(pricing, 'persistMarketReference').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 4) throw new Error('boom a mitad');
      return real(...args);
    });
    try {
      const r = await importG();
      expect(r.status).toBe(503);
      expect(codeOf(r)).toBe('TCGCSV_IMPORT_FAILED');
      expect(calls).toBeGreaterThanOrEqual(4); // sí escribió antes de fallar
      await expectNothingWritten();
    } finally {
      spy.mockRestore();
    }
  });

  it('PROMO-B1/B2/B7: importar 24451 crea cartas con imagen y precio; los sellos son producto aparte; lo dudoso se reporta', async () => {
    const r = await importG();
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['created', 'noPrice', 'setId', 'skipped', 'stamped', 'updated']);
    const set = (await setRow())!;
    expect(r.body).toMatchObject({ setId: set.id, created: 6, updated: 0, stamped: 4, noPrice: 1 });
    expect([...r.body.skipped].sort((a: any, b: any) => a.productId - b.productId)).toEqual(
      [
        { productId: P.orphanStaff, name: 'Orphan - 300 [Staff]', reason: 'no_base' },
        { productId: P.mystery, name: 'Foo - 200 [Mystery Stamp]', reason: 'unknown_stamp' },
        { productId: P.pcenter, name: 'Alakazam - 009 (Pokemon Center Exclusive)', reason: 'unknown_stamp' },
        { productId: P.sealed, name: 'Mega Evolution Promo Pack', reason: 'no_number' },
        { productId: P.longy, name: 'Longy - 300', reason: 'field_too_long' },
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

    // B2: sellos = CardProduct stamped de su base única (no cartas con «[Staff]»/«(Prerelease)»/«(Winner)»).
    const cards = await cardsOfSet();
    expect(cards.map((c) => c.number)).toEqual(['001', '017', '092', '093', '107', '113']);
    expect(cards.some((c) => /[[(](?!30th)/.test(c.name))).toBe(false);
    const stampOf = async (pid: number) => h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: pid } });
    const byNum = (n: string) => cards.find((c) => c.number === n)!;
    expect(await stampOf(P.paradiseStaff)).toMatchObject({ cardId: byNum('092').id, kind: 'stamped', stampType: 'staff', stampLabel: 'Staff', sourceGroupId: G });
    expect(await stampOf(P.toxPre)).toMatchObject({ cardId: byNum('017').id, kind: 'stamped', stampType: 'prerelease', stampLabel: 'Prerelease' });
    expect(await stampOf(P.pika93Win)).toMatchObject({ cardId: byNum('093').id, kind: 'stamped', stampType: 'championship', stampLabel: 'Winner' });
    const staff = await stampOf(P.paradiseStaff);
    expect((await h.prisma.priceReference.findFirstOrThrow({ where: { cardProductId: staff.id } })).priceUsdCents).toBe(999);
    expect(byNum('092').availableFinishes).toEqual(['normal']);
    const prods = await productsOfSet();
    expect(prods.filter((p) => p.kind === 'set_base')).toHaveLength(6);
    expect(prods.filter((p) => p.kind === 'stamped')).toHaveLength(4);
    // Lo omitido NO existe.
    const omitted = [P.orphanStaff, P.mystery, P.pcenter, P.sealed, P.longy];
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: { in: omitted } } })).toBe(0);
    expect(await h.prisma.card.count({ where: { externalId: { in: omitted.map((x) => `tcgcsv:${x}`) } } })).toBe(0);
    // Bitácora DENTRO de la transacción, con actor.
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'catalog.tcgcsv_import', entityId: set.id } });
    expect(audit?.after).toMatchObject({ groupId: G, created: 6, stamped: 4, noPrice: 1, skipped: 5 });
    expect(audit?.actorUserId).toBeTruthy();
    const list = await h.api<any[]>('GET', '/admin/catalog/tcgcsv-groups', { token: admin });
    expect(list.body.find((g) => g.groupId === G)).toMatchObject({ imported: true, cardCount: 6, productCount: 14 });
  });

  it('PROMO-B3: reimportar ⇒ 0 duplicados, 0 filas de precio nuevas', async () => {
    const before = { cards: await cardsOfSet(), prods: await productsOfSet(), refs: await h.prisma.priceReference.count({ where: { card: { set: { externalId: SET_EXT } } } }) };
    const again = await importG();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: 0, updated: 6, stamped: 4, noPrice: 1 });
    expect((await cardsOfSet()).map((c) => c.id)).toEqual(before.cards.map((c) => c.id));
    expect((await productsOfSet()).map((p) => p.id)).toEqual(before.prods.map((p) => p.id));
    expect(await h.prisma.priceReference.count({ where: { card: { set: { externalId: SET_EXT } } } })).toBe(before.refs);
    expect(await h.prisma.cardSet.count({ where: { externalId: SET_EXT } })).toBe(1);
  });

  it('PROMO-B3 (estrés): N=30 importaciones simultáneas desde cero con pool 5 ⇒ 1×200, 29×409, 0×5xx y 0 duplicados', async () => {
    await wipe();
    tcgcsv.delayMs = 400; // todas llegan juntas a la transacción
    try {
      const all = await Promise.all(Array.from({ length: 30 }, () => importG()));
      const count = (st: number) => all.filter((x) => x.status === st).length;
      expect({ ok: count(200), conflict: count(409), other: all.filter((x) => ![200, 409].includes(x.status)).map((x) => x.status) }).toEqual({
        ok: 1,
        conflict: 29,
        other: [],
      });
      expect(all.filter((x) => x.status === 409).every((x) => codeOf(x) === 'TCGCSV_IMPORT_IN_PROGRESS')).toBe(true);
    } finally {
      tcgcsv.delayMs = 0;
    }
    expect((await cardsOfSet()).length).toBe(6);
    expect((await productsOfSet()).length).toBe(10);
    expect(await h.prisma.cardSet.count({ where: { externalId: SET_EXT } })).toBe(1);
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

  it('PROMO-B5: remote-sets (remoto y degradado) no lista `tcgcsv:`; sync-all no toca estos sets', async () => {
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
      expect(degraded.body.data.some((s: any) => s.id.startsWith('tcgcsv:'))).toBe(false);
    } finally {
      ptcg.down = false;
    }
    ptcg.sets = [];
    const all = await h.api<any>('POST', '/admin/catalog/sync-all', { token: admin, json: { force: true } });
    expect(all.status).toBe(202);
    expect(all.body.setsQueued).toBe(0);
    expect(await snapshot()).toBe(before);
    expect((await h.api('POST', '/admin/catalog/refresh-variants', { token: admin, json: { setId: SET_EXT } })).status).toBeGreaterThanOrEqual(400);
    const queue: string[] = await (h.app.get(CatalogSyncService) as any).localSetExternalIdsWithCards();
    expect(queue.some((id) => id.startsWith('tcgcsv:'))).toBe(false);
  });

  it('PROMO-B5: el resolver de variantes NO recorre un set `tcgcsv:` (un `stamped` no pasa a `promo`)', async () => {
    const set = (await setRow())!;
    const before = await productsOfSet();
    expect(await h.app.get(CardProductResolverService).resolveCardProductsForSet(set.id)).toBeNull();
    const after = await productsOfSet();
    expect(after.map((p) => [p.id, p.kind, p.stampType, p.cardId, p.finishes])).toEqual(before.map((p) => [p.id, p.kind, p.stampType, p.cardId, p.finishes]));
  });

  it('PROMO-B5 (sombra POR SET): `sync`, `sync-all` y `upsertCards` de `mep` con el set local `tcgcsv:24451` ⇒ 0 cartas nuevas + aviso + AuditLog', async () => {
    const setBody = { id: 'mep', name: 'Mega Evolution Promo', series: 'Mega Evolution', releaseDate: '2026/11/01', printedTotal: 2 };
    ptcg.sets = [setBody];
    // Cartas SIN producto TCGplayer reconocible: la sombra no depende de URLs.
    ptcg.cards['mep'] = [
      { id: 'mep-1', name: 'Meganium', number: '1', set: setBody },
      { id: 'mep-2', name: 'Otra', number: '2', set: setBody },
    ];
    const snap = async () => JSON.stringify([(await cardsOfSet()).map((c) => [c.id, c.name]), (await productsOfSet()).map((p) => [p.id, p.cardId])]);
    const before = await snap();
    const r = await h.api<any>('POST', '/admin/catalog/sync', { token: admin, json: { setId: 'mep' } });
    expect(r.status).toBe(202);
    expect(r.body.shadowed).toEqual(['mep']);
    expect(r.body.setsQueued).toBe(0);
    expect(await h.prisma.card.count({ where: { externalId: { in: ['mep-1', 'mep-2'] } } })).toBe(0);
    expect(await h.prisma.cardSet.count({ where: { externalId: 'mep' } })).toBe(0); // ni siquiera el CardSet
    // sync-all (importSet) y upsertCards directo: tampoco.
    const svc = h.app.get(CatalogSyncService) as any;
    expect(await svc.importSet(setBody, { force: true })).toMatchObject({ outcome: 'noop', cardsUpserted: 0, shadowedBy: { ptcgSetId: 'mep', groupId: G } });
    // `upsertCards` directo sobre una fila local `mep` (p. ej. preexistente): tampoco crea nada.
    const mepRow = await h.prisma.cardSet.create({ data: { externalId: 'mep', name: 'Mega Evolution Promo' } });
    expect(await svc.upsertCards(ptcg.cards['mep'], mepRow.id)).toBe(0);
    expect(await h.prisma.card.count({ where: { externalId: { in: ['mep-1', 'mep-2'] } } })).toBe(0);
    expect(await snap()).toBe(before);
    const shadow = await h.prisma.auditLog.findMany({ where: { action: 'catalog.tcgcsv_shadowed' } });
    expect(shadow.length).toBeGreaterThanOrEqual(1);
    expect(shadow[0].after).toMatchObject({ pokemontcgIoSetId: 'mep', tcgcsvGroupId: G });
    // Un set de pokemontcg.io SIN relación sigue sincronizando normal.
    const other = { id: otherExt, name: 'Zz Other', series: 'Zz', releaseDate: '2026/02/02', printedTotal: 1 };
    ptcg.cards[otherExt] = [{ id: `${otherExt}-1`, name: 'Algo', number: '1', set: other }];
    const ok = await h.api<any>('POST', '/admin/catalog/sync', { token: admin, json: { setId: otherExt } });
    expect(ok.status).toBe(202);
    expect(ok.body.shadowed).toBeUndefined();
    expect(await h.prisma.card.count({ where: { externalId: `${otherExt}-1` } })).toBe(1);
    ptcg.sets = [];
  });

  it('NO MEDIDO: el barrido de precios resuelve estos sets por pptSetId y escribe por productId (también el sello)', async () => {
    const set = (await setRow())!;
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
      expect(res.rows.some((x) => x.externalId === `tcgcsv:${P.enamorus}`)).toBe(false);
    } finally {
      tcgcsv.prices = PRICES_BY_GROUP;
    }
  });
});
