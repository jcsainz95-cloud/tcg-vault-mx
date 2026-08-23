import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { computeSealedSalePrice } from '../src/common/money';

/**
 * v1.23-sealed-sales (§2-S) — SealedCatalogService: grid AGREGADO por producto+condición
 * («N disponibles»), la condición SEPARA grupos, precio money-safe (sin precio → no se lista), y los
 * dos endpoints FEATURE-FLAGGED (tendencia + restock) responden 404 FEATURE_DISABLED con el dial off.
 */

const SPREADS = { box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 };

function card(over: Partial<any> = {}) {
  return {
    id: 'c1',
    externalId: 'sv8-100',
    name: 'Surging Sparks Booster Box',
    number: '1',
    numberSort: 1,
    numberPrefix: '',
    rarity: null,
    supertype: null,
    subtypes: [],
    setId: 'set1',
    imageSmallUrl: 'https://img/small.png',
    imageLargeUrl: 'https://img/large.png',
    availableFinishes: ['normal'],
    set: { id: 'set1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08' },
    ...over,
  };
}

function sealedItem(over: Partial<any> = {}) {
  return {
    id: 'i1',
    cardId: 'c1',
    productType: 'sealed',
    status: 'listed',
    ownerType: 'platform',
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    finish: 'normal',
    listPriceCents: null,
    tcgplayerProductId: null,
    ownershipStatus: null,
    // M-37 snapshot congelado por-pieza (identidad real del SealedProduct); null → cae a la Card ancla.
    sealedProductName: null,
    sealedImageUrl: null,
    sealedProductId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    card: card(),
    ...over,
  };
}

function build(opts: {
  items?: any[];
  refs?: Map<string, any>;
  sourceOn?: boolean;
  trend?: string;
  restock?: string;
  findFirst?: any;
} = {}) {
  const prisma = {
    inventoryItem: {
      findMany: jest.fn(async () => opts.items ?? []),
      findFirst: jest.fn(async () => opts.findFirst ?? null),
    },
    priceReference: { findMany: jest.fn(async () => []) },
    card: { findUnique: jest.fn(async () => ({ id: 'c1' })) },
    sealedRestockSubscription: { create: jest.fn(async () => ({ id: 's1' })) },
  } as unknown as PrismaService;

  const pricing = {
    loadSealedSpreads: jest.fn(async () => ({
      spreadPctBySubtype: SPREADS,
      fallbackPct: 25,
      sourceOn: opts.sourceOn ?? true,
    })),
    sealedMarketGradeKeyForItem: jest.fn((it: any) =>
      it.tcgplayerProductId != null ? `sealed:tcg:${it.tcgplayerProductId}` : null,
    ),
    getReferencesBatch: jest.fn(async () => opts.refs ?? new Map()),
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    // H-1 (v1.24): resolver ÚNICO del sellado. El mock NO reimplementa la lógica: el gate es la misma
    // expresión trivial del método real y `resolveSealedSalePrice` DELEGA en la pura real
    // `computeSealedSalePrice` (sin riesgo de divergencia silenciosa si la pura cambia).
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
  } as unknown as PricingService;

  const settings = {
    getString: jest.fn(async (key: string) => {
      if (key === 'sealed_value_trend') return opts.trend ?? 'off';
      if (key === 'sealed_restock_alerts') return opts.restock ?? 'off';
      return 'off';
    }),
  } as unknown as SettingsService;

  const catalog = {
    toListingDTO: jest.fn(async (item: any) => ({ inventoryItemId: item.id, productType: 'sealed' })),
  } as unknown as CatalogService;

  return { prisma, pricing, settings, catalog, svc: new SealedCatalogService(prisma, pricing, settings, catalog) };
}

describe('SealedCatalogService.listSealed — grid agregado por producto+condición', () => {
  it('agrupa piezas idénticas → «N disponibles», fromPriceCents = mínimo, representante = más barato', async () => {
    const items = [
      sealedItem({ id: 'a', tcgplayerProductId: 100, sealedCondition: 'mint', listPriceCents: 60000 }),
      sealedItem({ id: 'b', tcgplayerProductId: 100, sealedCondition: 'mint', listPriceCents: 50000 }),
    ];
    const { svc } = build({ items });
    const res = await svc.listSealed({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    const g = res.data[0];
    expect(g.availableCount).toBe(2);
    expect(g.fromPriceCents).toBe(50000);
    expect(g.representativeItemId).toBe('b'); // el más barato
    expect(g.priceSource).toBe('override');
    expect(g.sealedCondition).toBe('mint');
    expect(g.imageUrl).toBe('https://img/small.png');
  });

  it('H-P38-1: el display usa la IDENTIDAD del SealedProduct (snapshot), NO el single ancla («Tropius»)', async () => {
    // La Card ancla es un single («Tropius»); el snapshot M-37 congela la identidad real del ETB.
    const items = [
      sealedItem({
        id: 'a',
        tcgplayerProductId: 100,
        sealedSubtype: 'etb',
        listPriceCents: 80000,
        sealedProductName: 'Surging Sparks Elite Trainer Box',
        sealedImageUrl: 'https://img/etb.png',
        card: card({ name: 'Tropius', imageSmallUrl: 'https://img/tropius.png' }),
      }),
    ];
    const { svc } = build({ items });
    const res = await svc.listSealed({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    const g = res.data[0];
    expect(g.productName).toBe('Surging Sparks Elite Trainer Box');
    expect(g.imageUrl).toBe('https://img/etb.png');
    // Guardarraíl: jamás el nombre/imagen del single ancla.
    expect(g.productName).not.toBe('Tropius');
    expect(g.imageUrl).not.toBe('https://img/tropius.png');
  });

  it('H-P38-1: sin snapshot (legacy) el display CAE a la Card ancla (fallback de cascada)', async () => {
    const items = [
      sealedItem({
        id: 'a',
        tcgplayerProductId: 100,
        listPriceCents: 50000,
        sealedProductName: null,
        sealedImageUrl: null,
        card: card({ name: 'Booster Box', imageSmallUrl: 'https://img/bb.png' }),
      }),
    ];
    const { svc } = build({ items });
    const res = await svc.listSealed({ page: 1, pageSize: 20 });
    expect(res.data[0].productName).toBe('Booster Box');
    expect(res.data[0].imageUrl).toBe('https://img/bb.png');
  });

  it('la CONDICIÓN separa grupos (mint y minor_box_damage del mismo producto → 2 tarjetas)', async () => {
    const items = [
      sealedItem({ id: 'a', tcgplayerProductId: 100, sealedCondition: 'mint', listPriceCents: 50000 }),
      sealedItem({ id: 'b', tcgplayerProductId: 100, sealedCondition: 'minor_box_damage', listPriceCents: 40000 }),
    ];
    const { svc } = build({ items });
    const res = await svc.listSealed({ page: 1, pageSize: 20 });
    expect(res.total).toBe(2);
    const conditions = res.data.map((g) => g.sealedCondition).sort();
    expect(conditions).toEqual(['minor_box_damage', 'mint']);
  });

  it('precio derivado por mercado×spread cuando está mapeado y el dial ON (box 18%)', async () => {
    const items = [sealedItem({ id: 'a', tcgplayerProductId: 200, sealedSubtype: 'box' })];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:200|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build({ items, refs, sourceOn: true });
    const res = await svc.listSealed({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.data[0].fromPriceCents).toBe(118000);
    expect(res.data[0].priceSource).toBe('subtype_spread');
    expect(res.data[0].referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: 100000 });
  });

  it('MONEY-SAFE: sellado sin override y sin mercado NO se lista', async () => {
    const items = [sealedItem({ id: 'a', tcgplayerProductId: 300, listPriceCents: null })];
    const { svc } = build({ items, refs: new Map(), sourceOn: true });
    const res = await svc.listSealed({ page: 1, pageSize: 20 });
    expect(res.total).toBe(0);
    expect(res.data).toEqual([]);
  });

  it('dial sealedPriceSource OFF: el mercado no cuenta; sin override → no se lista', async () => {
    const items = [sealedItem({ id: 'a', tcgplayerProductId: 200, listPriceCents: null })];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:200|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build({ items, refs, sourceOn: false });
    const res = await svc.listSealed({ page: 1, pageSize: 20 });
    expect(res.total).toBe(0);
  });
});

describe('SealedCatalogService — endpoints FEATURE-FLAGGED (§2-S)', () => {
  it('value-history con dial OFF → 404 FEATURE_DISABLED', async () => {
    const { svc } = build({ trend: 'off' });
    await expect(svc.sealedValueHistory('i1', '1m')).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('value-history con dial ON pero pieza no mapeada → 404 NOT_FOUND (sin serie)', async () => {
    const { svc } = build({ trend: 'on', findFirst: sealedItem({ id: 'i1', tcgplayerProductId: null }) });
    await expect(svc.sealedValueHistory('i1', '1m')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('restock con dial OFF → 404 FEATURE_DISABLED', async () => {
    const { svc } = build({ restock: 'off' });
    await expect(
      svc.subscribeRestock({ email: 'a@b.com', cardId: 'c1', sealedCondition: 'mint' }),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('restock con dial ON y correo inválido → 422 VALIDATION_ERROR', async () => {
    const { svc } = build({ restock: 'on' });
    await expect(
      svc.subscribeRestock({ email: 'no-arroba', cardId: 'c1', sealedCondition: 'mint' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('restock con dial ON sin identidad de producto → 422 VALIDATION_ERROR', async () => {
    const { svc } = build({ restock: 'on' });
    await expect(
      svc.subscribeRestock({ email: 'a@b.com', sealedCondition: 'mint' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('restock con dial ON, correo e identidad válidos → 202 neutro { subscribed: true } y persiste', async () => {
    const { svc, prisma } = build({ restock: 'on' });
    const res = await svc.subscribeRestock({ email: 'A@B.com ', cardId: 'c1', sealedCondition: 'mint' });
    expect(res).toEqual({ subscribed: true });
    const create = (prisma.sealedRestockSubscription.create as jest.Mock).mock.calls[0][0].data;
    expect(create.email).toBe('a@b.com'); // normalizado (trim + lowercase)
    expect(create.cardId).toBe('c1');
    expect(create.notifiedAt).toBeNull();
  });

  it('restock: cardId inexistente → NEUTRO 202 sin persistir (anti-enumeración)', async () => {
    const { svc, prisma } = build({ restock: 'on' });
    (prisma.card.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const res = await svc.subscribeRestock({ email: 'a@b.com', cardId: 'ghost', sealedCondition: 'mint' });
    expect(res).toEqual({ subscribed: true });
    expect((prisma.sealedRestockSubscription.create as jest.Mock)).not.toHaveBeenCalled();
  });
});
