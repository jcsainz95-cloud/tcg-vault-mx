import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * v1.3.1 (§E.1, API_CONTRACT §M2) — editor de precio de buylist por RAREZA:
 *  - GET/PUT /admin/pricing/buylist-rules (tabla + fallback), validado y auditado.
 *  - GET /admin/pricing/rarities (rarezas distintas del catálogo unidas a las reglas).
 */
function build(opts: {
  rules?: Record<string, { mode: string; value: number }>;
  fallbackPct?: number;
  grouped?: { rarity: string | null; _count: { _all: number } }[];
}) {
  const stored = {
    buylist_price_rules: opts.rules ?? { Common: { mode: 'fixed', value: 50 } },
    buylist_price_fallback_pct: opts.fallbackPct ?? 40,
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
  );
  return { controller, prisma, audit, settings };
}

describe('PricingController.buylist-rules — GET/PUT', () => {
  it('GET devuelve { rules, fallbackPct }', async () => {
    const { controller } = build({
      rules: { Common: { mode: 'fixed', value: 50 }, 'Reverse Holo': { mode: 'fixed', value: 150 } },
      fallbackPct: 40,
    });
    const res: any = await controller.getBuylistRules();
    expect(res).toEqual({
      rules: { Common: { mode: 'fixed', value: 50 }, 'Reverse Holo': { mode: 'fixed', value: 150 } },
      fallbackPct: 40,
    });
  });

  it('PUT válido persiste rules + fallback, audita y devuelve el shape', async () => {
    const { controller, prisma, audit } = build({});
    const dto = { rules: { 'Illustration Rare': { mode: 'pct', value: 45 } }, fallbackPct: 40 } as any;
    const res: any = await controller.putBuylistRules(dto, 'admin_1');
    // Persiste ambas keys.
    const upserts = (prisma.configSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key);
    expect(upserts).toEqual(
      expect.arrayContaining(['buylist_price_rules', 'buylist_price_fallback_pct']),
    );
    // Auditado con la acción del contrato.
    expect((audit.log as jest.Mock).mock.calls[0][0].action).toBe('pricing.buylist_rules.update');
    expect(res).toHaveProperty('rules');
    expect(res).toHaveProperty('fallbackPct');
  });

  it('PUT sin fallback solo persiste rules (no toca el fallback)', async () => {
    const { controller, prisma } = build({});
    await controller.putBuylistRules({ rules: { Common: { mode: 'fixed', value: 50 } } } as any, 'admin_1');
    const keys = (prisma.configSetting.upsert as jest.Mock).mock.calls.map((c) => c[0].where.key);
    expect(keys).toEqual(['buylist_price_rules']);
  });

  it('PUT rechaza mode inválido → 422 VALIDATION_ERROR (no persiste)', async () => {
    const { controller, prisma } = build({});
    await expect(
      controller.putBuylistRules({ rules: { X: { mode: 'percent', value: 10 } } } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('PUT rechaza pct fuera de [0,100] y fixed negativo', async () => {
    const { controller } = build({});
    await expect(
      controller.putBuylistRules({ rules: { X: { mode: 'pct', value: 140 } } } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      controller.putBuylistRules({ rules: { X: { mode: 'fixed', value: -5 } } } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('PUT rechaza fallbackPct fuera de rango', async () => {
    const { controller } = build({});
    await expect(
      controller.putBuylistRules({ rules: {}, fallbackPct: 200 } as any, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('PricingController.rarities — catálogo unido a reglas', () => {
  it('une rarezas del catálogo con reglas/fallback, ordena por cardCount desc y omite null', async () => {
    const { controller } = build({
      rules: { Common: { mode: 'fixed', value: 50 } },
      fallbackPct: 40,
      grouped: [
        { rarity: 'Illustration Rare', _count: { _all: 87 } },
        { rarity: 'Common', _count: { _all: 1234 } },
        { rarity: null, _count: { _all: 5 } },
      ],
    });
    const res: any = await controller.rarities();
    expect(res.fallbackPct).toBe(40);
    // Ordenado por cardCount desc; sin la rareza null.
    expect(res.rarities).toEqual([
      { rarity: 'Common', cardCount: 1234, rule: { mode: 'fixed', value: 50 }, source: 'rule' },
      { rarity: 'Illustration Rare', cardCount: 87, rule: { mode: 'pct', value: 40 }, source: 'fallback' },
    ]);
  });
});
