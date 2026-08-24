import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.13-sales-pricing (§4.14d) · ⛔ SUPERSEDED por v2.0 (P-48, ARCHITECTURE §4.36.5b).
 *
 * `PricingService.computeSalePriceForItem` es el **SEAM ÚNICO del eje de VENTA**: ya no lee reglas por
 * rareza sino **la CURVA** (`pricing_curve`), y su firma **no recibe `rarity` ni `finish`** — criterio
 * 84 hecho tipo. Los call-sites (catálogo y checkout) siguen pasando por él, así que cobran y publican
 * exactamente el mismo número.
 */

function realPricing(): { pricing: PricingService; settings: SettingsService } {
  const settings = {
    getRaw: jest.fn(async (key: string) => (key === 'pricing_curve' ? DEFAULT_PRICING_CURVE : null)),
    getNumber: jest.fn(async () => 0),
  } as unknown as SettingsService;
  const pricing = new PricingService(
    {} as PrismaService,
    settings,
    {} as FxService,
    {} as never,
    {} as never,
    {} as never,
  );
  return { pricing, settings };
}

describe('PricingService.computeSalePriceForItem — SEAM ÚNICO de VENTA por la CURVA (§4.36.5b)', () => {
  it('SIN mercado ⇒ pending: el PISO NO gana (cambio LOCKED vs. el `fixed` de v1.13)', async () => {
    const { pricing } = realPricing();
    const r = await pricing.computeSalePriceForItem(null);
    expect(r).toMatchObject({ priceCents: null, basis: 'pending', marketMxnCents: null });
  });

  it('CON mercado ⇒ curva: $1,000 × 1.15 = $1,150 (múltiplo de $25, no se mueve)', async () => {
    const { pricing } = realPricing();
    const r = await pricing.computeSalePriceForItem(100000);
    expect(r).toMatchObject({ priceCents: 115000, basis: 'market', marketMxnCents: 100000 });
  });

  it('mercado bajo ⇒ gana el PISO ($1.14 ⇒ $25) con basis "floor"', async () => {
    const { pricing } = realPricing();
    const r = await pricing.computeSalePriceForItem(114);
    expect(r).toMatchObject({ priceCents: 2500, basis: 'floor' });
  });

  it('sellOverrideCents (variante) pisa la curva y es ABSOLUTO (criterio 89)', async () => {
    const { pricing } = realPricing();
    const r = await pricing.computeSalePriceForItem(100000, { sellOverrideCents: 3000 });
    expect(r).toMatchObject({ priceCents: 3000, basis: 'override', curveQuoteCents: 115000 });
  });

  it('lee `pricing_curve` y NUNCA las claves retiradas (`sales_price_rules`, `sales_markup_pct`)', async () => {
    const { pricing, settings } = realPricing();
    await pricing.computeSalePriceForItem(100000);
    const rawKeys = (settings.getRaw as jest.Mock).mock.calls.map((c) => c[0]);
    const numKeys = (settings.getNumber as jest.Mock).mock.calls.map((c) => c[0]);
    expect(rawKeys).toContain('pricing_curve');
    expect(rawKeys).not.toContain('sales_price_rules');
    expect(rawKeys).not.toContain('pricing_tier_map');
    expect(numKeys).not.toContain('sales_price_fallback_pct');
    expect(numKeys).not.toContain('sales_markup_pct');
  });

  it('la CURVA se puede izar UNA vez por request y pasarse al seam (BE-25, sin releer settings)', async () => {
    const { pricing, settings } = realPricing();
    const curve = await pricing.loadPricingCurve();
    (settings.getRaw as jest.Mock).mockClear();
    const r = await pricing.computeSalePriceForItem(100000, null, curve);
    expect(r.priceCents).toBe(115000);
    expect(settings.getRaw).not.toHaveBeenCalled();
  });

  it('un `pricing_curve` CORRUPTO en BD no apaga el catálogo: cae al seed y lo grita en el log', async () => {
    const settings = {
      getRaw: jest.fn(async () => ({ version: 1, sale: { floorCents: 0, points: [], rounding: [] } })),
      getNumber: jest.fn(async () => 0),
    } as unknown as SettingsService;
    const pricing = new PricingService(
      {} as PrismaService,
      settings,
      {} as FxService,
      {} as never,
      {} as never,
      {} as never,
    );
    const spy = jest.spyOn(pricing['logger'], 'error').mockImplementation(() => undefined);
    const r = await pricing.computeSalePriceForItem(100000);
    expect(r.priceCents).toBe(115000); // el seed de §N.2
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[MONEY]'));
    spy.mockRestore();
  });
});

function cardOf(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c1', externalId: 'x', name: 'N', number: '1', rarity: 'Common', supertype: 'Pokémon',
    subtypes: [], setId: 's', imageSmallUrl: null, imageLargeUrl: null, availableFinishes: ['normal'],
    set: { id: 's', name: 'Set' }, ...over,
  };
}
function itemOf(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'i1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', sealedSubtype: null,
    gradingCompany: null, gradeValue: null, certNumber: null, status: 'listed', finish: 'normal',
    ownerType: 'platform', folio: 'INV-000001',
    listPriceCents: null, createdAt: new Date('2026-08-01'), card: cardOf(), ...over,
  };
}

/** Mock del servicio que DELEGA en el seam real (sin reimplementar la matemática). */
function pricingMock(referenceMxnCents: number | null): PricingService {
  const real = realPricing().pricing;
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn(async () =>
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    computeSalePriceForItem: jest.fn((ref: number | null, controls?: never, curve?: never) =>
      real.computeSalePriceForItem(ref, controls, curve),
    ),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

describe('call-site — toListingDTO resuelve por la CURVA y expone `priceBasis`', () => {
  it('una Common SIN PriceReference YA NO se publica (el piso no gana): sellable=false, basis pending', async () => {
    const pricing = pricingMock(null);
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(itemOf() as never);
    expect(dto.salePriceCents).toBeUndefined();
    expect(dto.sellable).toBe(false);
    expect(dto.priceBasis).toBe('pending');
    // Criterio 84 hecho tipo: al seam NO se le pasa rareza ni acabado, solo el MERCADO.
    expect((pricing.computeSalePriceForItem as jest.Mock).mock.calls[0][0]).toBeNull();
  });

  it('con mercado publica por la curva y marca `priceBasis="market"`', async () => {
    const pricing = pricingMock(100000);
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(itemOf() as never);
    expect(dto.salePriceCents).toBe(115000);
    expect(dto.sellable).toBe(true);
    expect(dto.priceBasis).toBe('market');
  });

  it('listPriceCents (override POR PIEZA) sigue ganando y marca `priceBasis="override"`', async () => {
    const pricing = pricingMock(100000);
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(itemOf({ listPriceCents: 99999 }) as never);
    expect(dto.salePriceCents).toBe(99999);
    expect(dto.priceBasis).toBe('override');
    expect(pricing.computeSalePriceForItem).not.toHaveBeenCalled();
  });
});

describe('call-site — orders.salePriceOf cobra EXACTAMENTE lo que publica el storefront', () => {
  function buildOrders(pricing: PricingService) {
    const prisma: PrismaService = {
      inventoryItem: { findMany: jest.fn(async () => [itemOf()]) },
    } as never;
    const settings = {
      getNumber: jest.fn().mockResolvedValue(16),
      getStripeFee: jest.fn().mockResolvedValue({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 }),
    } as unknown as SettingsService;
    return new OrdersService(prisma, pricing, settings, {} as StripeService, {} as CatalogService);
  }

  it('con mercado cobra el precio de la curva (mismo número que la ficha)', async () => {
    const svc = buildOrders(pricingMock(100000));
    const res = await svc.quote(['i1']);
    expect(res.items[0].unitPriceCents).toBe(115000);
  });

  it('sin mercado → PRICE_PENDING (el piso NO gana; jamás se cobra un precio inventado)', async () => {
    const svc = buildOrders(pricingMock(null));
    await expect(svc.quote(['i1'])).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });
});
