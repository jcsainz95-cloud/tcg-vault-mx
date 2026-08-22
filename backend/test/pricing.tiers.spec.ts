import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * v1.37 (§4.33, P-34, API_CONTRACT §M2) — endpoints de PRICING POR TIERS: GET/PUT /admin/pricing/tiers y
 * GET/PUT /admin/pricing/tier-map. Cubre lectura, edición auditada, invariante money-safe (§4.33d,
 * 422 PREMIUM_RARITY_FIXED_TIER) y validación de rareza desconocida (422 UNKNOWN_RARITY).
 */
const SEED_BUY = {
  tierRules: {
    T0: { mode: 'fixed', value: 50 },
    T1: { mode: 'fixed', value: 150 },
    T2: { mode: 'pct', value: 25 },
    T3: { mode: 'pct', value: 40 },
    T4: { mode: 'pct', value: 40 },
  },
  finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
};
const SEED_SELL = {
  tierRules: {
    T0: { mode: 'fixed', value: 500 },
    T1: { mode: 'fixed', value: 1000 },
    T2: { mode: 'pct', value: 15 },
    T3: { mode: 'pct', value: 15 },
    T4: { mode: 'pct', value: 15 },
  },
  finishRules: { holofoil: { mode: 'fixed', value: 1000 }, reverse_holo: { mode: 'fixed', value: 1000 } },
};
// Mapa con una rareza premium (Illustration Rare → T3) y bulk (Common → T0), para el invariante.
const SEED_MAP = { Common: 'T0', Uncommon: 'T1', Rare: 'T2', 'Illustration Rare': 'T3', 'Hyper Rare': 'T4' };

function build(over?: { buy?: unknown; sell?: unknown; map?: unknown; grouped?: any[] }) {
  const stored: Record<string, unknown> = {
    buylist_price_rules: over?.buy ?? SEED_BUY,
    sales_price_rules: over?.sell ?? SEED_SELL,
    buylist_price_fallback_pct: 40,
    sales_price_fallback_pct: 15,
    pricing_tier_map: over?.map ?? SEED_MAP,
  };
  const settings = {
    getRaw: jest.fn(async (key: string) => stored[key]),
    getNumber: jest.fn(async (key: string) => Number(stored[key])),
  } as unknown as SettingsService;
  const prisma = {
    configSetting: {
      upsert: jest.fn(async ({ where, update }: any) => {
        stored[where.key] = update.valueJson;
        return {};
      }),
    },
    card: { groupBy: jest.fn(async () => over?.grouped ?? []) },
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
  return { controller, prisma, audit, stored };
}

describe('GET /admin/pricing/tiers', () => {
  it('devuelve los 5 tiers con buy/sell/premium/rarityCount + finishRules + fallbacks', async () => {
    const { controller } = build();
    const res: any = await controller.getTiers();
    expect(res.tiers.map((t: any) => t.id)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
    const t2 = res.tiers.find((t: any) => t.id === 'T2');
    expect(t2).toMatchObject({ name: 'Rare / Holo', premium: false, buy: { mode: 'pct', value: 25 }, sell: { mode: 'pct', value: 15 } });
    // rarityCount = nº de rarezas del mapa asignadas al tier (T3: Illustration Rare = 1).
    expect(res.tiers.find((t: any) => t.id === 'T3').rarityCount).toBe(1);
    expect(res.finishRules.buy).toEqual({ reverse_holo: { mode: 'fixed', value: 150 } });
    expect(res.fallbackPct).toEqual({ buy: 40, sell: 15 });
  });
});

describe('PUT /admin/pricing/tiers', () => {
  const fiveRows = (buyT2: any) => [
    { id: 'T0', buy: { mode: 'fixed', value: 50 }, sell: { mode: 'fixed', value: 500 } },
    { id: 'T1', buy: { mode: 'fixed', value: 150 }, sell: { mode: 'fixed', value: 1000 } },
    { id: 'T2', buy: buyT2, sell: { mode: 'pct', value: 15 } },
    { id: 'T3', buy: { mode: 'pct', value: 40 }, sell: { mode: 'pct', value: 15 } },
    { id: 'T4', buy: { mode: 'pct', value: 40 }, sell: { mode: 'pct', value: 15 } },
  ];

  it('reemplaza las 5 reglas, persiste buy+sell, audita y devuelve el shape del GET', async () => {
    const { controller, prisma, audit } = build();
    const res: any = await controller.putTiers({ tiers: fiveRows({ mode: 'pct', value: 30 }) } as any, 'admin_1');
    const keys = (prisma.configSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key);
    expect(keys).toEqual(expect.arrayContaining(['buylist_price_rules', 'sales_price_rules']));
    expect((audit.log as jest.Mock).mock.calls[0][0].action).toBe('pricing.tiers.update');
    expect(res.tiers.find((t: any) => t.id === 'T2').buy).toEqual({ mode: 'pct', value: 30 });
  });

  it('rechaza si faltan filas → 422 VALIDATION_ERROR', async () => {
    const { controller, prisma } = build();
    await expect(
      controller.putTiers({ tiers: fiveRows({ mode: 'pct', value: 25 }).slice(0, 4) } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('rechaza buy pct fuera de [0,100] → 422 VALIDATION_ERROR', async () => {
    const { controller } = build();
    await expect(
      controller.putTiers({ tiers: fiveRows({ mode: 'pct', value: 140 }) } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('INVARIANTE: poner la compra de T3 (con Illustration Rare premium) en fixed → 422 PREMIUM_RARITY_FIXED_TIER', async () => {
    const { controller, prisma } = build();
    const rows = fiveRows({ mode: 'pct', value: 25 });
    rows[3] = { id: 'T3', buy: { mode: 'fixed', value: 100 }, sell: { mode: 'pct', value: 15 } };
    await expect(controller.putTiers({ tiers: rows } as any, 'a')).rejects.toMatchObject({
      code: 'PREMIUM_RARITY_FIXED_TIER',
      details: { offending: [{ rarity: 'Illustration Rare', tierId: 'T3' }] },
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('sell fixed NO dispara el invariante (un piso de venta no es un bin de compra)', async () => {
    const { controller } = build();
    const rows = fiveRows({ mode: 'pct', value: 25 });
    rows[3] = { id: 'T3', buy: { mode: 'pct', value: 40 }, sell: { mode: 'fixed', value: 9999 } };
    await expect(controller.putTiers({ tiers: rows } as any, 'a')).resolves.toBeDefined();
  });
});

describe('GET /admin/pricing/tier-map', () => {
  it('devuelve tiers + rarezas del catálogo con tierId/source, ordenadas por cardCount desc', async () => {
    const { controller } = build({
      grouped: [
        { rarityCanonical: 'Common', _count: { _all: 5000 } },
        { rarityCanonical: 'Illustration Rare', _count: { _all: 80 } },
        { rarityCanonical: 'Some New Rarity', _count: { _all: 3 } }, // unmapped en catálogo
        { rarityCanonical: null, _count: { _all: 9 } },
      ],
    });
    const res: any = await controller.getTierMap();
    expect(res.tiers).toHaveLength(5);
    expect(res.rarities[0]).toMatchObject({ canonical: 'Common', tierId: 'T0', source: 'map', mapped: true });
    const someNew = res.rarities.find((r: any) => r.canonical === 'Some New Rarity');
    // `premium` lo fija el catálogo (predicado por patrón para unmapped); este nombre no matchea → false.
    expect(someNew).toMatchObject({ tierId: null, source: 'fallback', mapped: false, premium: false });
  });
});

describe('PUT /admin/pricing/tier-map', () => {
  it('reasigna una rareza (patch parcial), fusiona con el mapa vigente, persiste y audita', async () => {
    const { controller, prisma, audit, stored } = build({ grouped: [{ rarityCanonical: 'Rare', _count: { _all: 100 } }] });
    await controller.putTierMap({ assignments: { Rare: 'T3' } } as any, 'admin_1');
    expect((stored.pricing_tier_map as any).Rare).toBe('T3');
    // fusiona: las demás entradas del seed siguen ahí.
    expect((stored.pricing_tier_map as any).Common).toBe('T0');
    expect((audit.log as jest.Mock).mock.calls[0][0].action).toBe('pricing.tier_map.update');
    expect(prisma.configSetting.upsert).toHaveBeenCalled();
  });

  it('rechaza TierId inválido → 422 VALIDATION_ERROR', async () => {
    const { controller } = build();
    await expect(controller.putTierMap({ assignments: { Common: 'T9' } } as any, 'a')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rechaza una rareza desconocida (no canónica) → 422 UNKNOWN_RARITY', async () => {
    const { controller, prisma } = build();
    await expect(
      controller.putTierMap({ assignments: { 'Totally Made Up Rarity': 'T3' } } as any, 'a'),
    ).rejects.toMatchObject({ code: 'UNKNOWN_RARITY', details: { rarity: 'Totally Made Up Rarity' } });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('INVARIANTE: mandar una rareza premium (Ultra Rare) a T0 (compra fixed) → 422 PREMIUM_RARITY_FIXED_TIER', async () => {
    const { controller, prisma } = build();
    await expect(
      controller.putTierMap({ assignments: { 'Ultra Rare': 'T0' } } as any, 'a'),
    ).rejects.toMatchObject({
      code: 'PREMIUM_RARITY_FIXED_TIER',
      details: { offending: [{ rarity: 'Ultra Rare', tierId: 'T0' }] },
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('normaliza la key a su canónica antes de guardar (alias → canónica)', async () => {
    const { controller, stored } = build({ grouped: [] });
    // 'megaattackrare' es alias de 'Mega Rare' (premium) → T3 (compra pct, no viola invariante).
    await controller.putTierMap({ assignments: { megaattackrare: 'T3' } } as any, 'admin_1');
    expect((stored.pricing_tier_map as any)['Mega Rare']).toBe('T3');
  });
});
