import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * v1.37 (§4.33, P-34, API_CONTRACT §M2) — editor de precio por TIERS. El `PUT /admin/pricing/buylist-rules`
 * quedó RETIRADO (superseded por `/tiers`+`/tier-map`); el `GET` se conserva y devuelve el `PriceRuleSet`
 * EFECTIVO derivado de (tierRules × PRICING_TIER_MAP). `GET /admin/pricing/rarities` gana `tierId`+`source`.
 */
function build(opts: {
  buylistRules?: unknown;
  tierMap?: unknown;
  fallbackPct?: number;
  grouped?: { rarityCanonical: string | null; rarity: string | null; _count: { _all: number } }[];
}) {
  const stored: Record<string, unknown> = {
    buylist_price_rules:
      opts.buylistRules ?? {
        tierRules: {
          T0: { mode: 'fixed', value: 50 },
          T1: { mode: 'fixed', value: 150 },
          T2: { mode: 'pct', value: 25 },
          T3: { mode: 'pct', value: 40 },
          T4: { mode: 'pct', value: 40 },
        },
        finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
      },
    buylist_price_fallback_pct: opts.fallbackPct ?? 40,
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

describe('PricingController.buylist-rules — GET efectivo (tiers × mapa, §4.33c)', () => {
  it('GET DERIVA el PriceRuleSet efectivo: rarityRules = tierRules[map[canonical]]', async () => {
    const { controller } = build({});
    const res: any = await controller.getBuylistRules();
    // Common → T0 (fixed 50); Illustration Rare → T3 (pct 40); finishRules y fallback intactos.
    expect(res.rarityRules).toEqual({
      Common: { mode: 'fixed', value: 50 },
      'Illustration Rare': { mode: 'pct', value: 40 },
    });
    expect(res.finishRules).toEqual({ reverse_holo: { mode: 'fixed', value: 150 } });
    expect(res.fallbackPct).toBe(40);
  });

  it('COMPAT on-read: el shape legacy { rarityRules, finishRules } (pre-M-38) se usa tal cual', async () => {
    const { controller } = build({
      buylistRules: {
        rarityRules: { Common: { mode: 'fixed', value: 50 } },
        finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
      },
      tierMap: {},
    });
    const res: any = await controller.getBuylistRules();
    expect(res.rarityRules).toEqual({ Common: { mode: 'fixed', value: 50 } });
    expect(res.finishRules).toEqual({ reverse_holo: { mode: 'fixed', value: 150 } });
  });

  it('el PUT buylist-rules quedó RETIRADO (superseded por /tiers)', () => {
    const { controller } = build({});
    expect((controller as any).putBuylistRules).toBeUndefined();
  });
});

describe('PricingController.rarities — catálogo canónico + tierId/source (§4.33c)', () => {
  it('agrupa por rarityCanonical, resuelve rule vía tier y anexa tierId + source:map|fallback', async () => {
    const { controller } = build({
      tierMap: { Common: 'T0', 'Illustration Rare': 'T3' },
      grouped: [
        { rarityCanonical: 'Illustration Rare', rarity: 'Illustration Rare', _count: { _all: 87 } },
        { rarityCanonical: 'Common', rarity: 'Common', _count: { _all: 1234 } },
        // rareza del catálogo SIN entrada en el mapa → tierId null, source fallback, rule = fallback pct.
        { rarityCanonical: 'Rare', rarity: 'Rare', _count: { _all: 300 } },
        { rarityCanonical: null, rarity: null, _count: { _all: 5 } },
      ],
    });
    const res: any = await controller.rarities();
    expect(res.fallbackPct).toBe(40);
    expect(res.rarities).toEqual([
      { canonical: 'Common', rarity: 'Common', raw: 'Common', premium: false, mapped: true, cardCount: 1234, rule: { mode: 'fixed', value: 50 }, tierId: 'T0', source: 'map' },
      { canonical: 'Rare', rarity: 'Rare', raw: 'Rare', premium: false, mapped: true, cardCount: 300, rule: { mode: 'pct', value: 40 }, tierId: null, source: 'fallback' },
      { canonical: 'Illustration Rare', rarity: 'Illustration Rare', raw: 'Illustration Rare', premium: true, mapped: true, cardCount: 87, rule: { mode: 'pct', value: 40 }, tierId: 'T3', source: 'map' },
    ]);
  });
});
