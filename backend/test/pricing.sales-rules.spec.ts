import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * v1.29 (§4.28d, API_CONTRACT §M2) — editor de precio de VENTA en DOS EJES `PriceRuleSet`:
 *  - GET/PUT /admin/pricing/sales-rules ({ rarityRules, finishRules, fallbackPct }), validado y auditado.
 *  - GET /admin/pricing/sales-rarities agrupa por `rarityCanonical`. El pct de venta topa en [0,1000].
 */
function build(opts: {
  rules?: unknown;
  fallbackPct?: number;
  grouped?: { rarityCanonical: string | null; rarity: string | null; _count: { _all: number } }[];
}) {
  const stored = {
    sales_price_rules: opts.rules ?? { rarityRules: { Common: { mode: 'fixed', value: 500 } }, finishRules: {} },
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
    {} as any,
  );
  return { controller, prisma, audit, settings };
}

describe('PricingController.sales-rules — GET/PUT (dos ejes §4.28d)', () => {
  it('GET devuelve el PriceRuleSet { rarityRules, finishRules, fallbackPct }', async () => {
    const { controller } = build({
      rules: { rarityRules: { Common: { mode: 'fixed', value: 500 } }, finishRules: { reverse_holo: { mode: 'fixed', value: 1000 } } },
      fallbackPct: 15,
    });
    const res: any = await controller.getSalesRules();
    expect(res).toEqual({
      rarityRules: { Common: { mode: 'fixed', value: 500 } },
      finishRules: { reverse_holo: { mode: 'fixed', value: 1000 } },
      fallbackPct: 15,
    });
  });

  it('PUT válido persiste rules + fallback, audita con la acción de venta y devuelve el PriceRuleSet', async () => {
    const { controller, prisma, audit } = build({});
    const dto = { rarityRules: { 'Illustration Rare': { mode: 'pct', value: 200 } }, finishRules: {}, fallbackPct: 15 } as any;
    const res: any = await controller.putSalesRules(dto, 'admin_1');
    const upserts = (prisma.configSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key);
    expect(upserts).toEqual(expect.arrayContaining(['sales_price_rules', 'sales_price_fallback_pct']));
    expect((audit.log as jest.Mock).mock.calls[0][0].action).toBe('pricing.sales_rules.update');
    expect(res).toHaveProperty('rarityRules');
    expect(res).toHaveProperty('finishRules');
    expect(res).toHaveProperty('fallbackPct');
  });

  it('PUT sin fallback solo persiste rules (no toca el fallback)', async () => {
    const { controller, prisma } = build({});
    await controller.putSalesRules({ rarityRules: { Common: { mode: 'fixed', value: 500 } }, finishRules: {} } as any, 'admin_1');
    const keys = (prisma.configSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key);
    expect(keys).toEqual(['sales_price_rules']);
  });

  it('PUT ACEPTA pct > 100 (markup arriba de mercado; diverge de buylist)', async () => {
    const { controller, prisma } = build({});
    await controller.putSalesRules({ rarityRules: { X: { mode: 'pct', value: 300 } }, finishRules: {} } as any, 'a');
    expect(prisma.configSetting.upsert).toHaveBeenCalled();
  });

  it('PUT rechaza mode inválido → 422 VALIDATION_ERROR (no persiste)', async () => {
    const { controller, prisma } = build({});
    await expect(
      controller.putSalesRules({ rarityRules: { X: { mode: 'percent', value: 10 } }, finishRules: {} } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('PUT rechaza pct > 1000 y fixed negativo', async () => {
    const { controller } = build({});
    await expect(
      controller.putSalesRules({ rarityRules: { X: { mode: 'pct', value: 1001 } }, finishRules: {} } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      controller.putSalesRules({ rarityRules: { X: { mode: 'fixed', value: -5 } }, finishRules: {} } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('PUT rechaza fallbackPct fuera de rango', async () => {
    const { controller } = build({});
    await expect(
      controller.putSalesRules({ rarityRules: {}, finishRules: {}, fallbackPct: 2000 } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('PricingController.sales-rarities — catálogo canónico unido a reglas de venta (§4.28c)', () => {
  it('agrupa por rarityCanonical con premium/mapped, ordena por cardCount desc y omite null', async () => {
    const { controller } = build({
      rules: { rarityRules: { Common: { mode: 'fixed', value: 500 } }, finishRules: {} },
      fallbackPct: 15,
      grouped: [
        { rarityCanonical: 'Illustration Rare', rarity: 'Illustration Rare', _count: { _all: 87 } },
        { rarityCanonical: 'Common', rarity: 'Common', _count: { _all: 1234 } },
        { rarityCanonical: null, rarity: null, _count: { _all: 5 } },
      ],
    });
    const res: any = await controller.salesRarities();
    expect(res.fallbackPct).toBe(15);
    expect(res.rarities).toEqual([
      { canonical: 'Common', rarity: 'Common', raw: 'Common', premium: false, mapped: true, cardCount: 1234, rule: { mode: 'fixed', value: 500 }, source: 'rule' },
      { canonical: 'Illustration Rare', rarity: 'Illustration Rare', raw: 'Illustration Rare', premium: true, mapped: true, cardCount: 87, rule: { mode: 'pct', value: 15 }, source: 'fallback' },
    ]);
  });
});
