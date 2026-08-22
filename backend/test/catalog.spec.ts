import { CatalogService, yearFromReleaseDate } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { computeSealedSalePrice } from '../src/common/money';

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
    loadSalesRules: jest.fn(async () => ({ rules: {}, fallbackPct: 15 })),
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
    gateSealedMarketCents: (ref: any, sourceOn: boolean) =>
      sourceOn && ref?.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null,
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
    // El item sin precio resoluble queda fuera del listado.
    expect(res.data).toHaveLength(1);
    expect(res.data[0].inventoryItemId).toBe('ok');
    expect(res.data[0].sellable).toBe(true);
    expect(res.data[0].salePriceCents).toBe(11500);
    expect(res.total).toBe(1);
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

    expect(res.data.map((d) => d.inventoryItemId)).toEqual(['raw1']);
    expect(res.data.every((d) => d.productType !== 'sealed')).toBe(true);
    // El guardarraíl viaja en el WHERE (AND con productType != sealed), no solo en el filtrado en memoria.
    const where = prisma.inventoryItem.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([{ productType: { not: 'sealed' } }]));
  });

  it('getCard: la ficha del single (cardId ancla) NO mezcla la caja sellada, aunque sea la más reciente', async () => {
    const prisma = prismaHonoringWhere([rawSingle(), sealedBox()]);
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const { listings } = await svc.getCard('anchor');

    // Sin guardarraíl, `sealedBox` (createdAt más nuevo) sería listings[0] y pintaría la ficha como sellado.
    expect(listings.map((l) => l.inventoryItemId)).toEqual(['raw1']);
    expect(listings.some((l) => l.productType === 'sealed')).toBe(false);
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
