import { VaultService } from '../src/modules/vault/vault.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.23-sealed-sales (§3 / §4.23g) — pestaña «Sellado» de la bóveda: agrega por producto+condición,
 * valúa por `sealedMarketRef` (misma base del portafolio), EXCLUYE del total las piezas sin mercado y
 * las cuenta en `pendingPriceCount`, y desglosa la titularidad (pending|settled).
 */

function card(over: Partial<any> = {}) {
  return {
    id: 'c1',
    externalId: 'sv8-100',
    name: 'Booster Box',
    number: '1',
    numberSort: 1,
    numberPrefix: '',
    rarity: null,
    supertype: null,
    subtypes: [],
    setId: 'set1',
    imageSmallUrl: 'https://img/s.png',
    imageLargeUrl: 'https://img/l.png',
    availableFinishes: ['normal'],
    set: { id: 'set1', name: 'Surging Sparks' },
    ...over,
  };
}

function piece(over: Partial<any> = {}) {
  return {
    id: 'i1',
    cardId: 'c1',
    productType: 'sealed',
    status: 'in_custody',
    ownerType: 'customer',
    ownerUserId: 'u1',
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    finish: 'normal',
    tcgplayerProductId: 100,
    ownershipStatus: 'settled',
    // M-37 snapshot congelado por-pieza (identidad real del SealedProduct); null → cae a la Card ancla.
    sealedProductName: null,
    sealedImageUrl: null,
    sealedProductId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    card: card(),
    ...over,
  };
}

function build(items: any[], refs: Map<string, any>) {
  const prisma = {
    inventoryItem: { findMany: jest.fn(async () => items) },
  } as unknown as PrismaService;
  const pricing = {
    sealedMarketGradeKeyForItem: jest.fn((it: any) =>
      it.tcgplayerProductId != null ? `sealed:tcg:${it.tcgplayerProductId}` : null,
    ),
    getReferencesBatch: jest.fn(async () => refs),
    // v1.22-2 / N-15: displayFinishes se deriva de este lote (default vacío = sin supresión).
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    // H-1 (v1.24): dial encendido EN RUNTIME (sourceOn:true) — el SEED del dial es `off` (fail-closed,
    // por contrato §M10); este test fija sourceOn:true para ejercer la valuación con el mercado activo.
    // El gate es la misma expresión trivial que el método real `PricingService.gateSealedMarketCents`
    // (no reimplementa la pura `computeSealedSalePrice`: `sealedTab` valúa por gate del mercado, no por spread).
    loadSealedSpreads: jest.fn(async () => ({
      spreadPctBySubtype: {},
      fallbackPct: 25,
      sourceOn: true,
    })),
    gateSealedMarketCents: (ref: any, sourceOn: boolean) => {
      if (ref?.status !== 'priced' || ref.referenceMxnCents == null) return null;
      if (ref.isManualOverride === true || ref.source === 'manual') return ref.referenceMxnCents;
      return sourceOn ? ref.referenceMxnCents : null;
    },
  } as unknown as PricingService;
  return { prisma, pricing, svc: new VaultService(prisma, pricing) };
}

describe('VaultService.sealedTab — agregación + valuación de la bóveda sellada', () => {
  it('agrupa por producto+condición, valúa a mercado, desglosa titularidad; pendientes excluidos y contados', async () => {
    const items = [
      piece({ id: 'a', tcgplayerProductId: 100, ownershipStatus: 'settled' }),
      piece({ id: 'b', tcgplayerProductId: 100, ownershipStatus: 'pending' }),
      piece({ id: 'c', tcgplayerProductId: null }), // no mapeado → sin mercado → pendiente
    ];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:100|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build(items, refs);
    const res = await svc.sealedTab('u1', {});

    // Dos grupos: producto 100 (mapeado) y producto no mapeado.
    expect(res.data).toHaveLength(2);
    const mapped = res.data.find((g) => g.count === 2)!;
    expect(mapped.ownership).toEqual({ pending: 1, settled: 1 });
    expect(mapped.totalMarketValueMxnCents).toBe(200000); // 2 × 100000
    expect(mapped.marketValue).toMatchObject({ status: 'priced', referenceMxnCents: 100000 });

    const unmapped = res.data.find((g) => g.count === 1)!;
    expect(unmapped.totalMarketValueMxnCents).toBeNull();
    expect(unmapped.marketValue.status).toBe('pending');

    // Total = solo lo priceado; el pendiente NO suma pero cuenta 1 pieza.
    expect(res.totalValueMxnCents).toBe(200000);
    expect(res.pendingPriceCount).toBe(1);
    expect(res.currency).toBe('MXN');
  });

  it('H-P38-1: el grid de bóveda usa la IDENTIDAD del SealedProduct (snapshot), NO el single ancla («Tropius»)', async () => {
    const items = [
      piece({
        id: 'a',
        tcgplayerProductId: 100,
        sealedSubtype: 'etb',
        sealedProductName: 'Surging Sparks Elite Trainer Box',
        sealedImageUrl: 'https://img/etb.png',
        card: card({ name: 'Tropius', imageSmallUrl: 'https://img/tropius.png' }),
      }),
    ];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:100|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build(items, refs);
    const res = await svc.sealedTab('u1', {});
    expect(res.data).toHaveLength(1);
    expect(res.data[0].productName).toBe('Surging Sparks Elite Trainer Box');
    expect(res.data[0].imageUrl).toBe('https://img/etb.png');
    expect(res.data[0].productName).not.toBe('Tropius');
    expect(res.data[0].imageUrl).not.toBe('https://img/tropius.png');
  });

  it('H-P38-1: sin snapshot (legacy) el grid de bóveda CAE a la Card ancla (fallback de cascada)', async () => {
    const items = [piece({ id: 'a', tcgplayerProductId: 100, sealedProductName: null, sealedImageUrl: null })];
    const refs = new Map<string, any>([
      ['c1|sealed|sealed:tcg:100|normal', { status: 'priced', referenceMxnCents: 100000 }],
    ]);
    const { svc } = build(items, refs);
    const res = await svc.sealedTab('u1', {});
    expect(res.data[0].productName).toBe('Booster Box');
    expect(res.data[0].imageUrl).toBe('https://img/s.png');
  });

  it('usa el filtro de status "en bóveda" (excluye withdrawn/shipped/delivered/lost/damaged)', async () => {
    const { prisma, svc } = build([], new Map());
    await svc.sealedTab('u1', {});
    const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.ownerType).toBe('customer');
    expect(where.ownerUserId).toBe('u1');
    expect(where.productType).toBe('sealed');
    expect(where.status).toEqual({ notIn: ['withdrawn', 'shipped', 'delivered', 'lost', 'damaged'] });
  });
});
