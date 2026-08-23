import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/business.exception';
import { grossUpTotal } from '../src/common/money';

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

  // v1.14-price-ingest (WS-A): dial `priceProvider` (IsIn pokemontcg_io|pokemonpricetracker).
  it('accepts priceProvider ∈ {pokemontcg_io, pokemonpricetracker}', async () => {
    await expect(service.update({ priceProvider: 'pokemontcg_io' })).resolves.toEqual({
      priceProvider: 'pokemontcg_io',
    });
    await expect(service.update({ priceProvider: 'pokemonpricetracker' })).resolves.toEqual({
      priceProvider: 'pokemonpricetracker',
    });
  });

  it('rejects priceProvider outside the ingest enum (e.g. poketrace/manual) with 422', async () => {
    await expect(service.update({ priceProvider: 'poketrace' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ priceProvider: 'made_up' })).rejects.toMatchObject({
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

  // v1.1: catalogSyncFromDate ahora es un dial de primera clase del DTO M10 (API_CONTRACT §M10).
  it('accepts a valid catalogSyncFromDate (yyyy/MM/dd) and upserts it', async () => {
    const applied = await service.update({ catalogSyncFromDate: '2025/03/01' });
    expect(applied).toEqual({ catalogSyncFromDate: '2025/03/01' });
    expect(prisma.configSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'catalog_sync_from_date' },
      }),
    );
  });

  it('rejects catalogSyncFromDate with an invalid format (422)', async () => {
    await expect(service.update({ catalogSyncFromDate: '2025-03-01' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ catalogSyncFromDate: 'not-a-date' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update({ catalogSyncFromDate: 20250301 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });
});

/**
 * v1.1: catalogSyncFromDate se expone en GET /admin/settings (getAllDto), como pide el contrato §M10.
 */
describe('SettingsService.getAllDto — expone catalogSyncFromDate', () => {
  it('returns catalogSyncFromDate with its default when no DB row exists', async () => {
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto).toHaveProperty('catalogSyncFromDate', '2024/01/01');
  });

  // v1.14-price-ingest (WS-A): el DTO M10 gana `priceProvider` con SEED `pokemontcg_io` (money-safe).
  it('returns priceProvider with its default seed (pokemontcg_io) when no DB row exists', async () => {
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto).toHaveProperty('priceProvider', 'pokemontcg_io');
  });

  it('returns the persisted catalogSyncFromDate when a DB row exists', async () => {
    const prisma = {
      configSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
          where.key === 'catalog_sync_from_date'
            ? Promise.resolve({ key: where.key, valueJson: '2025/06/15' })
            : Promise.resolve(null),
        ),
      },
    };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto.catalogSyncFromDate).toBe('2025/06/15');
  });
});

/**
 * v1.40 (Enmienda A, P-37): `IVA_PCT` es la FUENTE ÚNICA del IVA. El dial redundante
 * `stripeFeeIvaPct` se RETIRA del DTO de §M10: ya no se expone en GET, y un PUT con esa key
 * cae en 422 (key desconocida). El IVA que Stripe MX cobra sobre su comisión se DERIVA de
 * `ivaPct` (`ivaPct/100`) dentro del gross-up — idéntico al centavo (16 ⇒ 0.16).
 */
describe('SettingsService — stripeFeeIvaPct retirado del DTO (v1.40 P-37)', () => {
  it('getAllDto NO expone stripeFeeIvaPct', async () => {
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const dto = await service.getAllDto();
    expect(dto).not.toHaveProperty('stripeFeeIvaPct');
  });

  it('update rechaza la key stripeFeeIvaPct con 422 (key desconocida) y no persiste', async () => {
    const prisma: any = { configSetting: { upsert: jest.fn().mockResolvedValue({}) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    await expect(service.update({ stripeFeeIvaPct: 0.08 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('getStripeFee deriva stripeFeeIvaPct de ivaPct (16 ⇒ 0.16), NUNCA de la fila vieja ni 0', async () => {
    // Solo hay fila para iva_pct=16; stripe_fee_iva_pct NO se lee (aunque existiera, es inerte).
    const prisma = {
      configSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
          where.key === 'iva_pct'
            ? Promise.resolve({ key: where.key, valueJson: 16 })
            : Promise.resolve(null),
        ),
      },
    };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const fee = await service.getStripeFee();
    expect(fee.stripeFeeIvaPct).toBe(0.16);
    // La key deprecada nunca se consulta en el gross-up.
    const consultedKeys = (prisma.configSetting.findUnique as jest.Mock).mock.calls.map(
      (c) => c[0].where.key,
    );
    expect(consultedKeys).not.toContain('stripe_fee_iva_pct');
  });

  it('smoke gross-up: con ivaPct=16 el neteo es IDÉNTICO al del antiguo 0.16', async () => {
    const prisma = { configSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SettingsService(prisma as unknown as PrismaService);
    const fee = await service.getStripeFee(); // deriva stripeFeeIvaPct = 16/100 = 0.16
    const baseCents = 116000; // subtotal 100000 + IVA 16000
    const derived = grossUpTotal(baseCents, fee);
    // Referencia: exactamente el gross-up con el 0.16 hardcodeado de antes (misma matemática).
    const legacy = grossUpTotal(baseCents, {
      stripePct: fee.stripePct,
      stripeFixedCents: fee.stripeFixedCents,
      stripeFeeIvaPct: 0.16,
    });
    expect(derived).toBe(legacy);
  });
});
