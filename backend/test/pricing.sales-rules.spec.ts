import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * v1.13-sales-pricing (§4.14c, API_CONTRACT §M2) — editor de precio de VENTA por RAREZA:
 *  - GET/PUT /admin/pricing/sales-rules (tabla + fallback), validado y auditado.
 *  - GET /admin/pricing/sales-rarities (rarezas distintas del catálogo unidas a las reglas).
 * Clones del patrón buylist; el pct de venta topa en [0,1000] (markup arriba de mercado).
 */
function build(opts: {
  rules?: Record<string, { mode: string; value: number }>;
  fallbackPct?: number;
  grouped?: { rarity: string | null; _count: { _all: number } }[];
}) {
  const stored = {
    sales_price_rules: opts.rules ?? { Common: { mode: 'fixed', value: 500 } },
    sales_price_fallback_pct: opts.fallbackPct ?? 15,
  };
  const settings = {
    getRaw: jest.fn(async (key: string) => (stored as any)[key]),
    getNumber: jest.fn(async (key: string) => Number((stored as any)[key])),
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
    {} as any, // v1.28: VariantControlsService (no usado en estos tests)
  );
  return { controller, prisma, audit, settings };
}

describe('PricingController.sales-rules — GET/PUT', () => {
  it('GET devuelve { rules, fallbackPct }', async () => {
    const { controller } = build({
      rules: { Common: { mode: 'fixed', value: 500 }, 'Reverse Holo': { mode: 'fixed', value: 1000 } },
      fallbackPct: 15,
    });
    const res: any = await controller.getSalesRules();
    expect(res).toEqual({
      rules: { Common: { mode: 'fixed', value: 500 }, 'Reverse Holo': { mode: 'fixed', value: 1000 } },
      fallbackPct: 15,
    });
  });

  it('PUT válido persiste rules + fallback, audita con la acción de venta y devuelve el shape', async () => {
    const { controller, prisma, audit } = build({});
    const dto = { rules: { 'Illustration Rare': { mode: 'pct', value: 200 } }, fallbackPct: 15 } as any;
    const res: any = await controller.putSalesRules(dto, 'admin_1');
    const upserts = (prisma.configSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key);
    expect(upserts).toEqual(
      expect.arrayContaining(['sales_price_rules', 'sales_price_fallback_pct']),
    );
    expect((audit.log as jest.Mock).mock.calls[0][0].action).toBe('pricing.sales_rules.update');
    expect(res).toHaveProperty('rules');
    expect(res).toHaveProperty('fallbackPct');
  });

  it('PUT sin fallback solo persiste rules (no toca el fallback)', async () => {
    const { controller, prisma } = build({});
    await controller.putSalesRules({ rules: { Common: { mode: 'fixed', value: 500 } } } as any, 'admin_1');
    const keys = (prisma.configSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key);
    expect(keys).toEqual(['sales_price_rules']);
  });

  it('PUT ACEPTA pct > 100 (markup arriba de mercado; diverge de buylist)', async () => {
    const { controller, prisma } = build({});
    // pct 300 = listar a 4× market; válido en venta (topa en 1000).
    await controller.putSalesRules({ rules: { X: { mode: 'pct', value: 300 } } } as any, 'a');
    expect(prisma.configSetting.upsert).toHaveBeenCalled();
  });

  it('PUT rechaza mode inválido → 422 VALIDATION_ERROR (no persiste)', async () => {
    const { controller, prisma } = build({});
    await expect(
      controller.putSalesRules({ rules: { X: { mode: 'percent', value: 10 } } } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('PUT rechaza pct > 1000 y fixed negativo', async () => {
    const { controller } = build({});
    await expect(
      controller.putSalesRules({ rules: { X: { mode: 'pct', value: 1001 } } } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      controller.putSalesRules({ rules: { X: { mode: 'fixed', value: -5 } } } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('PUT rechaza fallbackPct fuera de rango', async () => {
    const { controller } = build({});
    await expect(
      controller.putSalesRules({ rules: {}, fallbackPct: 2000 } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('PricingController.sales-rarities — catálogo unido a reglas de venta', () => {
  it('une rarezas del catálogo con reglas/fallback, ordena por cardCount desc y omite null', async () => {
    const { controller } = build({
      rules: { Common: { mode: 'fixed', value: 500 } },
      fallbackPct: 15,
      grouped: [
        { rarity: 'Illustration Rare', _count: { _all: 87 } },
        { rarity: 'Common', _count: { _all: 1234 } },
        { rarity: null, _count: { _all: 5 } },
      ],
    });
    const res: any = await controller.salesRarities();
    expect(res.fallbackPct).toBe(15);
    expect(res.rarities).toEqual([
      { rarity: 'Common', cardCount: 1234, rule: { mode: 'fixed', value: 500 }, source: 'rule' },
      { rarity: 'Illustration Rare', cardCount: 87, rule: { mode: 'pct', value: 15 }, source: 'fallback' },
    ]);
  });
});
