import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * API_CONTRACT §M2: GET/PUT /admin/pricing/rarity-map usan el envelope
 * `{ entries: [{ rarity, category }, ...] }` — NO un Record<string,string> plano.
 */
describe('PricingController — rarity-map envelope', () => {
  function build(rawMap: Record<string, string> | null) {
    const settings = { getRaw: jest.fn().mockResolvedValue(rawMap) } as unknown as SettingsService;
    const prisma = { configSetting: { upsert: jest.fn().mockResolvedValue({}) } } as unknown as PrismaService;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
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
    return { controller, prisma, audit };
  }

  it('GET devuelve { entries: [{ rarity, category }] } (no un mapa plano)', async () => {
    const { controller } = build({ common: 'common', 'Illustration Rare': 'ex_plus' });
    const res: any = await controller.getRarityMap();
    expect(res).toHaveProperty('entries');
    expect(Array.isArray(res.entries)).toBe(true);
    expect(res.entries).toEqual(
      expect.arrayContaining([
        { rarity: 'common', category: 'common' },
        { rarity: 'Illustration Rare', category: 'ex_plus' },
      ]),
    );
    // No es un Record plano.
    expect(res.common).toBeUndefined();
  });

  it('GET tolera config ausente devolviendo { entries: [] }', async () => {
    const { controller } = build(null);
    const res: any = await controller.getRarityMap();
    expect(res).toEqual({ entries: [] });
  });

  it('PUT persiste el mapa y responde con el mismo envelope { entries }', async () => {
    const { controller, prisma } = build({});
    const res: any = await controller.putRarityMap(
      { entries: [{ rarity: 'Full Art', category: 'ex_plus' }] },
      'admin_1',
    );
    // Persiste como mapa interno.
    const upsertArg = (prisma.configSetting.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertArg.update.valueJson).toEqual({ 'Full Art': 'ex_plus' });
    // Responde con envelope.
    expect(res).toEqual({ entries: [{ rarity: 'Full Art', category: 'ex_plus' }] });
  });
});
