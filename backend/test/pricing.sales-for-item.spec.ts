import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * v1.13-sales-pricing (§4.14d) — PricingService.computeSalePriceForItem lee la tabla de reglas de
 * VENTA + fallback y aplica el resolver por rareza. Además, los 2 call-sites (catalog.toListingDTO,
 * orders.salePriceOf) usan la regla por rareza y NO el markup global.
 */

const SALES_RULES = {
  Common: { mode: 'fixed', value: 500 },
  Uncommon: { mode: 'fixed', value: 1000 },
  Holo: { mode: 'fixed', value: 1000 },
  'Reverse Holo': { mode: 'fixed', value: 1000 },
};

function realPricing(): PricingService {
  const settings = {
    getRaw: jest.fn(async (key: string) => (key === 'sales_price_rules' ? SALES_RULES : null)),
    getNumber: jest.fn(async (key: string) => (key === 'sales_price_fallback_pct' ? 15 : 0)),
  } as unknown as SettingsService;
  return new PricingService(
    {} as PrismaService,
    settings,
    {} as FxService,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe('PricingService.computeSalePriceForItem (§4.14d)', () => {
  it('fixed → piso aunque no haya market (Common $5)', async () => {
    const p = realPricing();
    const r = await p.computeSalePriceForItem({ rarity: 'Common', finish: 'normal' }, null);
    expect(r).toMatchObject({ salePriceCents: 500, status: 'priced', ruleSource: 'rule' });
  });

  it('pct fallback → 15% arriba de market (rareza rara con market)', async () => {
    const p = realPricing();
    const r = await p.computeSalePriceForItem({ rarity: 'Illustration Rare', finish: 'normal' }, 100000);
    expect(r).toMatchObject({ salePriceCents: 115000, status: 'priced', ruleSource: 'fallback' });
  });

  it('pct sin market → pending', async () => {
    const p = realPricing();
    const r = await p.computeSalePriceForItem({ rarity: 'Rare', finish: 'normal' }, null);
    expect(r).toMatchObject({ salePriceCents: null, status: 'pending' });
  });

  it('NO usa el markup global SALES_MARKUP_PCT (lee sales_price_rules / sales_price_fallback_pct)', async () => {
    const settings = {
      getRaw: jest.fn(async () => SALES_RULES),
      getNumber: jest.fn(async () => 15),
    } as unknown as SettingsService;
    const p = new PricingService({} as PrismaService, settings, {} as FxService, {} as any, {} as any, {} as any);
    await p.computeSalePriceForItem({ rarity: 'Common', finish: 'normal' }, null);
    // Leyó las keys de VENTA por rareza, NUNCA sales_markup_pct.
    const rawKeys = (settings.getRaw as jest.Mock).mock.calls.map((c) => c[0]);
    const numKeys = (settings.getNumber as jest.Mock).mock.calls.map((c) => c[0]);
    expect(rawKeys).toContain('sales_price_rules');
    expect(numKeys).toContain('sales_price_fallback_pct');
    expect(numKeys).not.toContain('sales_markup_pct');
  });
});

function cardOf(over: Partial<any> = {}) {
  return {
    id: 'c1', externalId: 'x', name: 'N', number: '1', rarity: 'Common', supertype: 'Pokémon',
    subtypes: [], setId: 's', imageSmallUrl: null, imageLargeUrl: null, availableFinishes: ['normal'],
    set: { id: 's', name: 'Set' }, ...over,
  };
}
function itemOf(over: Partial<any> = {}) {
  return {
    id: 'i1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', sealedSubtype: null,
    gradingCompany: null, gradeValue: null, certNumber: null, status: 'listed', finish: 'normal',
    ownerType: 'platform', folio: 'INV-000001',
    listPriceCents: null, createdAt: new Date('2026-08-01'), card: cardOf(), ...over,
  };
}

describe('call-site swap — toListingDTO usa la regla por rareza (piso fixed sin market)', () => {
  it('una Common SIN PriceReference se vuelve sellable al piso $5 (mejora deliberada)', async () => {
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async () => ({ status: 'pending' })), // sin market
      computeSalePriceForItem: jest.fn(async () => ({
        salePriceCents: 500, status: 'priced', appliedRule: { mode: 'fixed', value: 500 }, ruleSource: 'rule',
      })),
      // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(itemOf() as any);
    expect(dto.salePriceCents).toBe(500);
    expect(dto.sellable).toBe(true);
    // Se pasó (rarity, finish) desde la BD (Card.rarity / InventoryItem.finish), no del cliente.
    expect((pricing.computeSalePriceForItem as jest.Mock).mock.calls[0][0]).toEqual({
      rarity: 'Common', finish: 'normal',
    });
  });

  it('listPriceCents (override) sigue ganando sobre la regla', async () => {
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
      computeSalePriceForItem: jest.fn(),
      // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(itemOf({ listPriceCents: 99999 }) as any);
    expect(dto.salePriceCents).toBe(99999);
    expect(pricing.computeSalePriceForItem).not.toHaveBeenCalled();
  });
});

describe('call-site swap — orders.salePriceOf usa la regla por rareza', () => {
  function buildOrders(pricing: PricingService) {
    const prisma: any = {
      inventoryItem: { findMany: jest.fn(async () => [itemOf()]) },
    };
    const settings: any = {
      getNumber: jest.fn().mockResolvedValue(16),
      getStripeFee: jest.fn().mockResolvedValue({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 }),
    };
    return new OrdersService(
      prisma as PrismaService, pricing, settings as SettingsService, {} as StripeService, {} as CatalogService,
    );
  }

  it('fixed devuelve el piso aunque no haya market', async () => {
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async () => ({ status: 'pending' })),
      computeSalePriceForItem: jest.fn(async () => ({
        salePriceCents: 500, status: 'priced', appliedRule: { mode: 'fixed', value: 500 }, ruleSource: 'rule',
      })),
      // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
    const svc = buildOrders(pricing);
    const res = await svc.quote(['i1']);
    expect(res.items[0].unitPriceCents).toBe(500);
  });

  it('pct sin market → PRICE_PENDING (se conserva)', async () => {
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async () => ({ status: 'pending' })),
      computeSalePriceForItem: jest.fn(async () => ({
        salePriceCents: null, status: 'pending', appliedRule: { mode: 'pct', value: 15 }, ruleSource: 'fallback',
      })),
      // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
    const svc = buildOrders(pricing);
    await expect(svc.quote(['i1'])).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });
});
