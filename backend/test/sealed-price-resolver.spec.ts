import { PricingService } from '../src/modules/pricing/pricing.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';

/**
 * H-1 (v1.24-sealed-dedup) — el gating del precio de VENTA del sellado (gate del mercado por dial +
 * pura `computeSealedSalePrice`, incluida la REGLA ÚNICA de override>0) vive en UN solo cuerpo:
 * `PricingService.resolveSealedSalePrice`. Este spec prueba (a) el resolver único y su gate, y
 * (b) que catálogo (`toListingDTO`), Compra (`orders.salePriceOf`) y grid (`loadPricedSealed`)
 * producen EXACTAMENTE el mismo precio para el caso money-safe del override degenerado (0 centavos).
 */

// PricingService real: `resolveSealedSalePrice`/`gateSealedMarketCents` son PUROS (no tocan deps).
function realPricing(): PricingService {
  return new PricingService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const CTX_ON = { spreadPctBySubtype: { box: 18 }, fallbackPct: 25, sourceOn: true };
const CTX_OFF = { spreadPctBySubtype: { box: 18 }, fallbackPct: 25, sourceOn: false };
const PRICED = { status: 'priced' as const, referenceMxnCents: 100000 };
const PENDING = { status: 'pending' as const };

describe('PricingService.gateSealedMarketCents — gate ÚNICO del mercado (dial + priced)', () => {
  it('dial ON + priced → referenceMxnCents', () => {
    expect(realPricing().gateSealedMarketCents(PRICED, true)).toBe(100000);
  });
  it('dial OFF → null (mercado TCGCSV inerte, §4.23a)', () => {
    expect(realPricing().gateSealedMarketCents(PRICED, false)).toBeNull();
  });
  it('ref pending / undefined / null → null', () => {
    expect(realPricing().gateSealedMarketCents(PENDING, true)).toBeNull();
    expect(realPricing().gateSealedMarketCents(undefined, true)).toBeNull();
    expect(realPricing().gateSealedMarketCents(null, true)).toBeNull();
  });
});

describe('PricingService.resolveSealedSalePrice — regla ÚNICA de override', () => {
  const svc = () => realPricing();

  it('override>0 gana (precedencia máxima)', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: 99900, sealedSubtype: 'box' }, PRICED, CTX_ON);
    expect(r).toMatchObject({ salePriceCents: 99900, source: 'override' });
  });

  it('override=0 DEGENERADO → se ignora → mercado×spread (NO cobra gratis)', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: 0, sealedSubtype: 'box' }, PRICED, CTX_ON);
    expect(r).toMatchObject({ salePriceCents: 118000, source: 'subtype_spread' });
  });

  it('override NEGATIVO → se ignora → mercado×spread', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: -1, sealedSubtype: 'box' }, PRICED, CTX_ON);
    expect(r.salePriceCents).toBe(118000);
  });

  it('override=0 + dial OFF (sin market efectivo) → pending (no publicable)', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: 0, sealedSubtype: 'box' }, PRICED, CTX_OFF);
    expect(r.status).toBe('pending');
    expect(r.salePriceCents).toBeNull();
  });

  it('sin override + market → mercado×spread; sin market → pending', () => {
    expect(
      svc().resolveSealedSalePrice({ listPriceCents: null, sealedSubtype: 'box' }, PRICED, CTX_ON).salePriceCents,
    ).toBe(118000);
    expect(
      svc().resolveSealedSalePrice({ listPriceCents: null, sealedSubtype: 'box' }, PENDING, CTX_ON).salePriceCents,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Consistencia cross-sitio: catálogo, Compra (orders) y grid dan el MISMO precio.
// ---------------------------------------------------------------------------
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

// Pieza SELLADA con override DEGENERADO (0 centavos), mapeada (productId 100), mercado priceado.
function sealedPiece(over: Partial<any> = {}) {
  return {
    id: 'i1',
    folio: 'INV-000001',
    cardId: 'c1',
    productType: 'sealed',
    status: 'listed',
    ownerType: 'platform',
    listPriceCents: 0, // override DEGENERADO
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    finish: 'normal',
    tcgplayerProductId: 100,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    card: card(),
    ...over,
  };
}

const EXPECTED = 118000; // 100000 × 1.18 (spread box), NO 0 (override degenerado ignorado)

describe('H-1 — mismo precio en catálogo, Compra (orders) y grid para override=0', () => {
  it('los tres sitios coinciden en EXPECTED (mercado×spread, no gratis)', async () => {
    // --- catálogo: toListingDTO con contexto pre-cargado (mercado priceado) ---
    const pricingCat = realPricing();
    const catalog = new CatalogService({} as any, pricingCat);
    const dto = await catalog.toListingDTO(sealedPiece() as any, {
      reference: PRICED,
      sealedSpreads: CTX_ON,
    });
    expect(dto.salePriceCents).toBe(EXPECTED);
    expect(dto.sellable).toBe(true);

    // --- Compra: orders.salePriceOf (private) con loaders espiados ---
    const pricingOrders = realPricing();
    jest.spyOn(pricingOrders, 'loadSealedSpreads').mockResolvedValue(CTX_ON);
    jest.spyOn(pricingOrders, 'getSealedMarketRef').mockResolvedValue(PRICED as any);
    const orders = new OrdersService(
      {} as any,
      pricingOrders,
      {} as any,
      {} as any,
      {} as any,
    );
    const orderPrice = await (orders as any).salePriceOf(sealedPiece());
    expect(orderPrice).toBe(EXPECTED);

    // --- grid: loadPricedSealed (private) con prisma + loaders mockeados ---
    const pricingGrid = realPricing();
    jest.spyOn(pricingGrid, 'loadSealedSpreads').mockResolvedValue(CTX_ON);
    jest
      .spyOn(pricingGrid, 'getReferencesBatch')
      .mockResolvedValue(new Map([['c1|sealed|sealed:tcg:100|normal', PRICED as any]]));
    const prismaGrid = {
      inventoryItem: { findMany: jest.fn(async () => [sealedPiece()]) },
    } as any;
    const sealedCatalog = new SealedCatalogService(prismaGrid, pricingGrid, {} as any, {} as any);
    const priced = await (sealedCatalog as any).loadPricedSealed({});
    expect(priced).toHaveLength(1);
    expect(priced[0].salePriceCents).toBe(EXPECTED);
    expect(priced[0].source).toBe('subtype_spread');
  });
});
