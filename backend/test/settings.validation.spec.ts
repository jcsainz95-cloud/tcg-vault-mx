import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * Fix correctness #2: PUT /admin/settings valida cada dial por tipo+rango, rechaza
 * keys desconocidas (422) y no persiste valores que romperían la matemática de money.ts.
 */
describe('SettingsService.update — validación de diales (fix #2)', () => {
  let prisma: any;
  let service: SettingsService;

  beforeEach(() => {
    prisma = { configSetting: { upsert: jest.fn().mockResolvedValue({}) } };
    service = new SettingsService(prisma as unknown as PrismaService);
  });

  it('accepts valid dials and upserts them', async () => {
    const applied = await service.update({ ivaPct: 16, salesMarkupPct: 15, stripeFeePct: 0.036 });
    expect(applied).toEqual({ ivaPct: 16, salesMarkupPct: 15, stripeFeePct: 0.036 });
    expect(prisma.configSetting.upsert).toHaveBeenCalledTimes(3);
  });

  it('rejects stripe_fee_pct >= 1 (would divide by <= 0 in gross-up)', async () => {
    await expect(service.update({ stripeFeePct: 1 })).rejects.toBeInstanceOf(BusinessException);
    await expect(service.update({ stripeFeePct: 1.2 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-numeric iva_pct (would produce NaN)', async () => {
    await expect(service.update({ ivaPct: 'sixteen' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects negative sales_markup_pct', async () => {
    await expect(service.update({ salesMarkupPct: -5 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects non-integer / negative cents dials', async () => {
    await expect(service.update({ shippingFeeCents: -100 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ shippingFeeCents: 175.5 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects unknown keys with 422 (no longer silently ignored)', async () => {
    await expect(service.update({ notADial: 123 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('is all-or-nothing: one invalid value blocks the whole batch', async () => {
    await expect(service.update({ ivaPct: 16, stripeFeePct: 5 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid pricing provider enum', async () => {
    await expect(service.update({ pricingProviderRaw: 'made_up' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('allows fxManualOverrideRate null (no override) or positive number', async () => {
    await expect(service.update({ fxManualOverrideRate: null })).resolves.toBeDefined();
    await expect(service.update({ fxManualOverrideRate: 18.5 })).resolves.toBeDefined();
    await expect(service.update({ fxManualOverrideRate: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
