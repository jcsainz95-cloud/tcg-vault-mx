import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * v1.37 (§4.33, P-34, API_CONTRACT §M2) — editor de VENTA por TIERS. `PUT /admin/pricing/sales-rules`
 * RETIRADO (superseded por `/tiers`); el `GET` devuelve el `PriceRuleSet` EFECTIVO (tierRules × mapa).
 * `GET /admin/pricing/sales-rarities` gana `tierId` + `source`. El pct de venta topa en [0,1000].
 */
function build(opts: {
  salesRules?: unknown;
  tierMap?: unknown;
  fallbackPct?: number;
  grouped?: { rarityCanonical: string | null; rarity: string | null; _count: { _all: number } }[];
}) {
  const stored: Record<string, unknown> = {
    sales_price_rules:
      opts.salesRules ?? {
        tierRules: {
          T0: { mode: 'fixed', value: 500 },
          T1: { mode: 'fixed', value: 1000 },
          T2: { mode: 'pct', value: 15 },
          T3: { mode: 'pct', value: 15 },
          T4: { mode: 'pct', value: 15 },
        },
        finishRules: { reverse_holo: { mode: 'fixed', value: 1000 } },
      },
    sales_price_fallback_pct: opts.fallbackPct ?? 15,
    pricing_tier_map: opts.tierMap ?? { Common: 'T0', 'Illustration Rare': 'T3' },
  };
  const settings = {
    getRaw: jest.fn(async (key: string) => stored[key]),
    getNumber: jest.fn(async (key: string) => Number(stored[key])),
  } as unknown as SettingsService;
  const prisma = {
    configSetting: { upsert: jest.fn(async () => ({})) },
    card: { groupBy: jest.fn(async () => opts.grouped ?? []) },
  } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const controller = new PricingController(
    {} as PricingService,
    {} as FxService,
    settings,
    audit,
    prisma,
    {} as PriceSyncJobService,
    {} as any,
    {} as any,
  );
  return { controller, prisma, audit, settings };
}

describe('PricingController.sales-rules — GET efectivo (tiers × mapa, §4.33c)', () => {
  it('GET DERIVA el PriceRuleSet efectivo de venta desde tierRules × mapa', async () => {
    const { controller } = build({});
    const res: any = await controller.getSalesRules();
    expect(res.rarityRules).toEqual({
      Common: { mode: 'fixed', value: 500 },
      'Illustration Rare': { mode: 'pct', value: 15 },
    });
    expect(res.finishRules).toEqual({ reverse_holo: { mode: 'fixed', value: 1000 } });
    expect(res.fallbackPct).toBe(15);
  });

  it('el PUT sales-rules quedó RETIRADO (superseded por /tiers)', () => {
    const { controller } = build({});
    expect((controller as any).putSalesRules).toBeUndefined();
  });
});

describe('PricingController.sales-rarities — catálogo canónico + tierId/source (§4.33c)', () => {
  it('agrupa por rarityCanonical, resuelve rule vía tier y anexa tierId + source', async () => {
    const { controller } = build({
      tierMap: { Common: 'T0', 'Illustration Rare': 'T3' },
      grouped: [
        { rarityCanonical: 'Illustration Rare', rarity: 'Illustration Rare', _count: { _all: 87 } },
        { rarityCanonical: 'Common', rarity: 'Common', _count: { _all: 1234 } },
        { rarityCanonical: null, rarity: null, _count: { _all: 5 } },
      ],
    });
    const res: any = await controller.salesRarities();
    expect(res.fallbackPct).toBe(15);
    expect(res.rarities).toEqual([
      { canonical: 'Common', rarity: 'Common', raw: 'Common', premium: false, mapped: true, cardCount: 1234, rule: { mode: 'fixed', value: 500 }, tierId: 'T0', source: 'map' },
      { canonical: 'Illustration Rare', rarity: 'Illustration Rare', raw: 'Illustration Rare', premium: true, mapped: true, cardCount: 87, rule: { mode: 'pct', value: 15 }, tierId: 'T3', source: 'map' },
    ]);
  });
});
