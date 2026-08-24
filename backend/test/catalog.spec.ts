import { CatalogService, yearFromReleaseDate } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { computeSealedSalePrice } from '../src/common/money';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.1 — "Compra" = inventario PUBLICADO con precio (API_CONTRACT §catalog). El comprador
 * NUNCA ve "precio pendiente": solo aparecen items `listed` con precio de venta RESOLUBLE
 * (listPriceCents fijado o referencia con la que calcular precio×markup). Facetas dinámicas.
 */

function pricing(): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    // Item con listPriceCents fijado → salePrice = listPrice; sin él y pending → no sellable.
    getReference: jest.fn(async (cardId: string) =>
      cardId === 'pending' ? { status: 'pending' } : { status: 'priced', referenceMxnCents: 10000 },
    ),
    // v1.22-2 / N-15: displayFinishes se deriva de este lote (default vacío = sin supresión).
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    // v1.16-master-set (BE-25): fetchSellable iza reglas 1 vez + resuelve referencias en lote.
    // v2.0 (P-48): la CURVA sustituye a las reglas de venta/compra; UN solo loader (§4.36.2).
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    getReferencesBatch: jest.fn(async (items: any[]) => {
      const m = new Map<string, any>();
      for (const it of items) {
        if (it.cardId !== 'pending') {
          m.set(`${it.cardId}|${it.productType}|${it.gradeKey}|${it.finish}`, {
            status: 'priced',
            referenceMxnCents: 10000,
          });
        }
      }
      return m;
    }),
    // v1.13-sales-pricing: el call-site migró a computeSalePriceForItem. Sin market → pending
    // (Illustration Rare cae al fallback pct); con market → 15% arriba (equivale al legacy 1.15).
    computeSalePriceForItem: jest.fn(async (_item: any, ref: number | null) =>
      ref == null
        ? { salePriceCents: null, status: 'pending', appliedRule: { mode: 'pct', value: 15 }, ruleSource: 'fallback' }
        : { salePriceCents: Math.round(ref * 1.15), status: 'priced', appliedRule: { mode: 'pct', value: 15 }, ruleSource: 'fallback' },
    ),
    // v1.23-sealed-sales: contexto de spreads del sellado + helpers de mercado (no usados en estos raw tests).
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false })),
    sealedMarketGradeKeyForItem: jest.fn((item: any) =>
      item.tcgplayerProductId != null ? `sealed:tcg:${item.tcgplayerProductId}` : null,
    ),
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    // H-1 (v1.24): resolver ÚNICO del sellado (gate del mercado por dial + pura). Los mocks
    // NO reimplementan la lógica: el gate es la misma expresión trivial que el método real y
    // `resolveSealedSalePrice` DELEGA en la pura real `computeSealedSalePrice` (sin riesgo de
    // divergencia silenciosa si la pura cambia).
    gateSealedMarketCents: (ref: any, sourceOn: boolean) => {
      if (ref?.status !== 'priced' || ref.referenceMxnCents == null) return null;
      if (ref.isManualOverride === true || ref.source === 'manual') return ref.referenceMxnCents;
      return sourceOn ? ref.referenceMxnCents : null;
    },
    resolveSealedSalePrice: (item: any, ref: any, ctx: any) =>
      computeSealedSalePrice(
        item.listPriceCents,
        item.sealedSubtype,
        ctx.sourceOn && ref?.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null,
        ctx.spreadPctBySubtype,
        ctx.fallbackPct,
      ),
    // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

function cardOf(over: Partial<any> = {}) {
  return {
    id: 'c1',
    externalId: 'sv8-1',
    name: 'Pikachu',
    number: '1',
    rarity: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's-new',
    imageSmallUrl: null,
    imageLargeUrl: null,
    set: { id: 's-new', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    ...over,
  };
}

function itemOf(over: Partial<any> = {}) {
  return {
    id: 'i1',
    cardId: 'c1',
    productType: 'raw',
    rawCondition: 'NM',
    sealedSubtype: null,
    gradingCompany: null,
    gradeValue: null,
    certNumber: null,
    status: 'listed',
    finish: 'normal',
    listPriceCents: 11500,
    createdAt: new Date('2026-08-01'),
    card: cardOf(),
    ...over,
  };
}

describe('CatalogService.listCards — regla dura de "Compra"', () => {
  it('publica items listed + plataforma con precio de venta; excluye "precio pendiente"', async () => {
    let captured: any;
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async (args: any) => {
          captured = args.where;
          return [
            itemOf({ id: 'ok', listPriceCents: 11500 }),
            // Item pendiente: listPrice null + referencia pending → NO comprable → excluido.
            itemOf({ id: 'pending', listPriceCents: null, cardId: 'pending', card: cardOf({ id: 'pending' }) }),
          ];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const res = await svc.listCards({ page: 1, pageSize: 20 });

    expect(captured.ownerType).toBe('platform');
    expect(captured.status).toBe('listed');
    // v1.38-grouped-listings (P-30): el item sin precio resoluble ni cuenta ni entra (money-safe).
    // El listado es AGRUPADO: 1 grupo (la pieza 'ok'), representante = 'ok', stockCount = 1.
    expect(res.data).toHaveLength(1);
    expect(res.data[0].representativeInventoryItemId).toBe('ok');
    expect(res.data[0].stockCount).toBe(1);
    expect(res.data[0].salePriceCents).toBe(11500);
    expect(res.data[0].currency).toBe('MXN');
    expect(res.total).toBe(1); // total = nº de GRUPOS.
  });

  it('propaga filtros de tipo/sealedSubtype al where y aplica rango de precio', async () => {
    let captured: any;
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async (args: any) => {
          captured = args.where;
          return [itemOf({ productType: 'sealed', sealedSubtype: 'etb', listPriceCents: 11500 })];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    // Rango que excluye el único item (11500 < 20000) → lista vacía.
    const res = await svc.listCards({
      page: 1,
      pageSize: 20,
      productType: 'sealed',
      sealedSubtype: 'etb',
      minPriceCents: 20000,
    });
    expect(captured.productType).toBe('sealed');
    expect(captured.sealedSubtype).toBe('etb');
    expect(res.data).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});

/**
 * v1.38-grouped-listings (P-30, ARCHITECTURE §4.9a) — GET /catalog/cards* devuelve publicaciones
 * AGRUPADAS por K=(cardId, productType, gradeKey, finish) con stockCount, no una fila por copia física.
 */
describe('CatalogService — publicación ÚNICA por carta/variante/condición con STOCK (P-30)', () => {
  function prismaWith(items: any[]): any {
    return {
      card: { findUnique: jest.fn(async ({ where }: any) => items.find((i) => i.cardId === where.id)?.card ?? null) },
      inventoryItem: { findMany: jest.fn(async () => items) },
    };
  }

  it('listCards: 3 copias de la MISMA K colapsan en 1 grupo con stockCount=3 y precio = mínimo', async () => {
    // Tres Tropius raw NM normal (misma K); precios manuales divergentes → el grupo muestra el más barato.
    const items = [
      itemOf({ id: 't1', listPriceCents: 15000 }),
      itemOf({ id: 't2', listPriceCents: 12000 }),
      itemOf({ id: 't3', listPriceCents: 18000 }),
    ];
    const svc = new CatalogService(prismaWith(items) as PrismaService, pricing());
    const res = await svc.listCards({ page: 1, pageSize: 20 });

    expect(res.data).toHaveLength(1);
    expect(res.total).toBe(1); // total = nº de GRUPOS, no de piezas (antes salían 3 filas).
    const g = res.data[0];
    expect(g.stockCount).toBe(3);
    expect(g.salePriceCents).toBe(12000); // mínimo del grupo…
    expect(g.representativeInventoryItemId).toBe('t2'); // …= la pieza vendible más barata.
    expect(g.productType).toBe('raw');
    expect(g.rawCondition).toBe('NM');
    expect(g.gradeKey).toBe('raw:NM');
  });

  it('money-safe: una pieza SIN precio no cuenta ni entra al stock del grupo (nunca $0)', async () => {
    // Misma K (cardId 'pending' → referencia pending). A: precio manual → vendible; B: sin precio → fuera.
    const items = [
      itemOf({ id: 'A', cardId: 'pending', card: cardOf({ id: 'pending' }), listPriceCents: 11500 }),
      itemOf({ id: 'B', cardId: 'pending', card: cardOf({ id: 'pending' }), listPriceCents: null }),
    ];
    const svc = new CatalogService(prismaWith(items) as PrismaService, pricing());
    const res = await svc.listCards({ page: 1, pageSize: 20 });

    expect(res.data).toHaveLength(1);
    expect(res.data[0].stockCount).toBe(1); // B (sin precio) NO cuenta.
    expect(res.data[0].representativeInventoryItemId).toBe('A');
    expect(res.data[0].salePriceCents).toBe(11500);
  });

  it('money-safe: grupo AGOTADO (todas las piezas sin precio) DESAPARECE de Compra', async () => {
    const items = [itemOf({ id: 'x', cardId: 'pending', card: cardOf({ id: 'pending' }), listPriceCents: null })];
    const svc = new CatalogService(prismaWith(items) as PrismaService, pricing());
    const res = await svc.listCards({ page: 1, pageSize: 20 });

    expect(res.data).toHaveLength(0); // stockCount=0 ⇒ no se emite fila.
    expect(res.total).toBe(0);
  });

  it('listCards: distinta K (raw vs graded) ⇒ grupos SEPARADOS', async () => {
    const p = pricing();
    (p as any).gradeKeyFor = jest.fn((it: any) =>
      it.productType === 'graded' ? `graded:${it.gradingCompany}:${it.gradeValue}` : 'raw:NM',
    );
    const items = [
      itemOf({ id: 'r1', productType: 'raw', listPriceCents: 12000 }),
      itemOf({ id: 'g1', productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '10', listPriceCents: 90000 }),
    ];
    const svc = new CatalogService(prismaWith(items) as PrismaService, p);
    const res = await svc.listCards({ page: 1, pageSize: 20 });

    expect(res.data).toHaveLength(2);
    const graded = res.data.find((d) => d.productType === 'graded')!;
    expect(graded.gradeKey).toBe('graded:PSA:10');
    expect(graded.gradingCompany).toBe('PSA');
    expect(graded.gradeValue).toBe('10');
    expect(graded.rawCondition).toBeUndefined(); // rawCondition SOLO en raw.
    expect(graded.stockCount).toBe(1);
  });

  it('getCard: `listings` son grupos y `units` son TODAS las piezas por-pieza (add-to-cart cheapest-first)', async () => {
    // Dos copias raw NM de la MISMA carta (misma K): 1 grupo stockCount=2, 2 units con inventoryItemId distinto.
    const items = [
      itemOf({ id: 'u-caro', listPriceCents: 15000 }),
      itemOf({ id: 'u-barato', listPriceCents: 12000 }),
    ];
    const svc = new CatalogService(prismaWith(items) as PrismaService, pricing());
    const { listings, units } = await svc.getCard('c1');

    // Grilla de la ficha = grupos.
    expect(listings).toHaveLength(1);
    expect(listings[0].stockCount).toBe(2);
    expect(listings[0].salePriceCents).toBe(12000);
    expect(listings[0].representativeInventoryItemId).toBe('u-barato');
    // `units` = por-pieza, cheapest-first, para agregar inventoryItemId DISTINTOS al carrito.
    expect(units.map((u) => u.inventoryItemId)).toEqual(['u-barato', 'u-caro']);
    expect(units.every((u) => u.sellable)).toBe(true);
  });

  // H4 (P-30) — REGRESIÓN: precio de grupo con `listPriceCents` manual DIVERGENTE en la MISMA K
  // (§4.26b: el manual por-pieza gana siempre). El grupo publica el MÍNIMO como representante (piso),
  // pero la ficha expone AMBAS piezas en `units[]` (cheapest-first) para el add-to-cart por
  // inventoryItemId. Money-safe: el precio del grupo es un PISO informativo; el cobro real se
  // re-cotiza por pieza (cada `unit` lleva su propio salePriceCents exacto).
  it('H4 · precio de grupo con `listPriceCents` divergente en la misma K: grupo = mínimo, `units[]` completo cheapest-first', async () => {
    // Dos piezas de la MISMA K (raw NM normal, misma carta) con precio manual divergente: 18000 vs 9900.
    const items = [
      itemOf({ id: 'div-caro', listPriceCents: 18000, createdAt: new Date('2026-08-05') }),
      itemOf({ id: 'div-barato', listPriceCents: 9900, createdAt: new Date('2026-08-02') }),
    ];
    const svc = new CatalogService(prismaWith(items) as PrismaService, pricing());

    // (a) Listado de Compra: 1 grupo, representante = la pieza más barata, precio del grupo = mínimo.
    const list = await svc.listCards({ page: 1, pageSize: 20 });
    expect(list.data).toHaveLength(1);
    expect(list.total).toBe(1);
    expect(list.data[0].stockCount).toBe(2);
    expect(list.data[0].salePriceCents).toBe(9900); // mínimo = piso «desde».
    expect(list.data[0].representativeInventoryItemId).toBe('div-barato');

    // (b) Ficha: `listings` (grupo) muestra el mínimo; `units[]` trae AMBAS piezas cheapest-first,
    // cada una con su salePriceCents EXACTO por-pieza (no el del grupo) para el cobro re-cotizado.
    const { listings, units } = await svc.getCard('c1');
    expect(listings).toHaveLength(1);
    expect(listings[0].salePriceCents).toBe(9900);
    expect(listings[0].stockCount).toBe(2);
    expect(units.map((u) => u.inventoryItemId)).toEqual(['div-barato', 'div-caro']);
    expect(units.map((u) => u.salePriceCents)).toEqual([9900, 18000]); // precio EXACTO por pieza, divergente.
    expect(units.every((u) => u.sellable)).toBe(true);
  });

  // H4 (P-30) — REGRESIÓN: sort + paginación sobre GRUPOS. Con varios grupos y un `pageSize` que
  // cruza página, `price_asc`/`price_desc` ordenan por el precio del grupo, `total` = nº de grupos, y
  // recorriendo todas las páginas ningún grupo se repite ni se salta (cobertura exacta del conjunto).
  it('H4 · sort + paginación sobre grupos: price_asc/desc correctos, total = nº de grupos, sin repetir ni saltar', async () => {
    // Cinco grupos distintos (cardId distinto ⇒ K distinta), cada uno con 1 pieza y precio manual único.
    const specs = [
      { cardId: 'ca', price: 5000 },
      { cardId: 'cb', price: 12000 },
      { cardId: 'cc', price: 8000 },
      { cardId: 'cd', price: 20000 },
      { cardId: 'ce', price: 15000 },
    ];
    const items = specs.map((s) =>
      itemOf({ id: `it-${s.cardId}`, cardId: s.cardId, listPriceCents: s.price, card: cardOf({ id: s.cardId }) }),
    );
    const svc = new CatalogService(prismaWith(items) as PrismaService, pricing());
    const ascExpected = [5000, 8000, 12000, 15000, 20000];

    // price_asc, pageSize=2 (cruza 3 páginas: 2 + 2 + 1). Recolecta todas las páginas.
    const seen: string[] = [];
    const collected: number[] = [];
    for (const page of [1, 2, 3]) {
      const res = await svc.listCards({ page, pageSize: 2, sort: 'price_asc' });
      expect(res.total).toBe(5); // total = nº de GRUPOS en todas las páginas.
      expect(res.data.length).toBe(page === 3 ? 1 : 2);
      for (const g of res.data) {
        seen.push(g.representativeInventoryItemId);
        collected.push(g.salePriceCents);
      }
    }
    // Orden global ascendente correcto a través de las páginas.
    expect(collected).toEqual(ascExpected);
    // Ningún grupo repetido ni saltado: los 5 representantes distintos aparecen exactamente una vez.
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual(specs.map((s) => `it-${s.cardId}`).sort());

    // price_desc: mismo conjunto, orden inverso; una sola página grande para el orden global.
    const desc = await svc.listCards({ page: 1, pageSize: 10, sort: 'price_desc' });
    expect(desc.total).toBe(5);
    expect(desc.data.map((g) => g.salePriceCents)).toEqual([...ascExpected].reverse());
  });
});

describe('CatalogService.facets — facetas dinámicas sobre inventario publicado', () => {
  it('devuelve rarities distinct, sets con year desc, productTypes, sealedSubtypes y rango de precio', async () => {
    const items = [
      itemOf({ id: 'a', productType: 'raw', listPriceCents: 5000, card: cardOf({ rarity: 'Illustration Rare' }) }),
      itemOf({
        id: 'b',
        productType: 'sealed',
        sealedSubtype: 'etb',
        listPriceCents: 450000,
        card: cardOf({ id: 'c2', rarity: null, set: { id: 's-old', name: 'Base', releaseDate: '1999/01/09' } }),
      }),
      itemOf({ id: 'c', productType: 'sealed', sealedSubtype: 'box', listPriceCents: 300000, card: cardOf({ id: 'c3', rarity: 'Common' }) }),
    ];
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => items) } };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const f = await svc.facets();

    expect(f.rarities).toEqual(expect.arrayContaining(['Illustration Rare', 'Common']));
    expect(f.rarities).not.toContain(null);
    expect(f.sets.map((s) => s.id)).toEqual(['s-new', 's-old']); // año desc
    expect(f.sets[0].year).toBe(2024);
    expect(f.sets[1].year).toBe(1999);
    expect(f.productTypes).toEqual(expect.arrayContaining(['raw', 'sealed']));
    expect(f.sealedSubtypes).toEqual(expect.arrayContaining(['etb', 'box']));
    expect(f.price).toEqual({ minCents: 5000, maxCents: 450000, currency: 'MXN' });
  });
});

describe('CatalogService.getListing — 404 si no es visible en Compra', () => {
  it('item sin precio resoluble (pendiente) → 404', async () => {
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async () => [
          itemOf({ id: 'pending', listPriceCents: null, cardId: 'pending', card: cardOf({ id: 'pending' }) }),
        ]),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    await expect(svc.getListing('pending')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * H9 / SB-D5 — guardarraíl INTERINO de `productType`: la vista pública de SINGLES (`GET /catalog/cards`
 * listado y `GET /catalog/cards/:cardId` ficha) NO debe exponer sellado. P-35 ancla TODO el sellado de un
 * set a la carta single de menor `(numberPrefix, numberSort)`, así que un `sealed` con `cardId` = el de la
 * carta ancla aparecería entre los "ejemplares" del single. Debe seguir apareciendo en `GET /catalog/sealed`.
 *
 * A diferencia del resto de tests de este archivo (mocks que IGNORAN el `where`), aquí el mock de Prisma
 * HONRA el `where` (equality + `AND [{productType:{not:'sealed'}}]` + `card.setId`), para que el guardarraíl
 * quede realmente ejercido: si no se filtrara, el `sealed` (mismo `cardId` que el ancla) se colaría.
 */
function matchWhere(item: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === 'AND') {
      if (!(v as any[]).every((sub) => matchWhere(item, sub))) return false;
    } else if (k === 'card') {
      const cw: any = v;
      if (cw.setId && item.card?.setId !== cw.setId) return false;
      if (cw.name?.contains && !String(item.card?.name ?? '').toLowerCase().includes(String(cw.name.contains).toLowerCase())) return false;
    } else if (k === 'productType' && v && typeof v === 'object' && 'not' in (v as any)) {
      if (item.productType === (v as any).not) return false;
    } else if (item[k] !== v) {
      return false;
    }
  }
  return true;
}

describe('H9 / SB-D5 — la vista de SINGLES excluye el sellado (P-35 ancla-a-single)', () => {
  const anchorCard = () =>
    cardOf({ id: 'anchor', name: 'Pikachu', number: '1', setId: 's1', set: { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08' } });

  // Single raw y caja sellada COMPARTEN cardId 'anchor' (efecto de P-35). La caja es la más reciente
  // (createdAt mayor) → sin guardarraíl sería `listings[0]` de la ficha del single.
  const rawSingle = () =>
    itemOf({ id: 'raw1', cardId: 'anchor', productType: 'raw', ownerType: 'platform', listPriceCents: 11500, createdAt: new Date('2026-08-01'), card: anchorCard() });
  const sealedBox = () =>
    itemOf({
      id: 'box1', cardId: 'anchor', productType: 'sealed', ownerType: 'platform', sealedSubtype: 'box',
      sealedCondition: 'mint', tcgplayerProductId: null, listPriceCents: 450000, createdAt: new Date('2026-08-20'), card: anchorCard(),
    });

  function prismaHonoringWhere(items: any[]): any {
    return {
      card: { findUnique: jest.fn(async ({ where }: any) => (where.id === 'anchor' ? anchorCard() : null)) },
      inventoryItem: {
        findMany: jest.fn(async ({ where }: any) => items.filter((it) => matchWhere(it, where))),
        findFirst: jest.fn(async ({ where }: any) => items.find((it) => matchWhere(it, where)) ?? null),
      },
    };
  }

  it('listCards: el sellado NO aparece en el listado de singles (solo raw/graded)', async () => {
    const prisma = prismaHonoringWhere([rawSingle(), sealedBox()]);
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const res = await svc.listCards({ page: 1, pageSize: 20 });

    // v1.38-grouped-listings: el listado son GRUPOS → representativeInventoryItemId. El single raw sobrevive
    // como su propio grupo; el sellado ni siquiera entra (H9 lo excluye del where de singles).
    expect(res.data.map((d) => d.representativeInventoryItemId)).toEqual(['raw1']);
    expect(res.data.every((d) => (d.productType as string) !== 'sealed')).toBe(true);
    // El guardarraíl viaja en el WHERE (AND con productType != sealed), no solo en el filtrado en memoria.
    const where = prisma.inventoryItem.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([{ productType: { not: 'sealed' } }]));
  });

  it('getCard: la ficha del single (cardId ancla) NO mezcla la caja sellada, aunque sea la más reciente', async () => {
    const prisma = prismaHonoringWhere([rawSingle(), sealedBox()]);
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const { listings } = await svc.getCard('anchor');

    // Sin guardarraíl, `sealedBox` (createdAt más nuevo) sería listings[0] y pintaría la ficha como sellado.
    // v1.38-grouped-listings: `listings` son grupos (GroupedListingDTO) → representativeInventoryItemId.
    expect(listings.map((l) => l.representativeInventoryItemId)).toEqual(['raw1']);
    expect(listings.some((l) => (l.productType as string) === 'sealed')).toBe(false);
  });

  it('el MISMO sellado SÍ aparece en GET /catalog/sealed (catálogo de sellado, servicio aparte)', async () => {
    const prisma = prismaHonoringWhere([rawSingle(), sealedBox()]);
    const catalog = new CatalogService(prisma as PrismaService, pricing());
    const settings = { getString: jest.fn(async () => 'off') } as unknown as SettingsService;
    const sealed = new SealedCatalogService(prisma as PrismaService, pricing(), settings, catalog);

    const res = await sealed.listSealed({ page: 1, pageSize: 20 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].representativeItemId).toBe('box1');
    expect(res.data[0].sealedSubtype).toBe('box');
    expect(res.data[0].fromPriceCents).toBe(450000);
  });
});

describe('yearFromReleaseDate', () => {
  it('deriva el año de yyyy/MM/dd', () => {
    expect(yearFromReleaseDate('2024/11/08')).toBe(2024);
    expect(yearFromReleaseDate(null)).toBeNull();
    expect(yearFromReleaseDate('bogus')).toBeNull();
  });
});
