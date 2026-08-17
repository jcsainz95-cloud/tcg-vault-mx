import { ConfigService } from '@nestjs/config';
import { FxService } from '../src/modules/pricing/fx.service';
import { FxController } from '../src/modules/pricing/pricing.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * WS-A (v1.14-price-ingest, #13, §4.15f):
 *  - `getCurrent()` prefiere el colchón del DIAL en TODAS las ramas (aplica de inmediato en el
 *    próximo ingest, sin esperar al siguiente fx-refresh).
 *  - `PUT /admin/fx` con `rate?` opcional: omitir `rate` guarda SOLO el colchón sin pinnear la tasa
 *    manual (Banxico auto sigue activo).
 */

describe('FxService.getCurrent — prefiere el colchón del DIAL (no el congelado en FxRate)', () => {
  it('rama auto-Banxico: bufferPct viene del dial (5), no de la fila FxRate (3)', async () => {
    const settings = {
      getNumber: jest.fn(async () => 5), // dial fx_buffer_pct = 5
      getRaw: jest.fn(async () => null), // sin override manual
    } as unknown as SettingsService;
    const prisma = {
      fxRate: {
        findFirst: jest.fn(async () => ({
          rate: 18,
          bufferPct: 3, // valor STALE en la fila (del último fx-refresh)
          source: 'banxico',
          effectiveDate: new Date('2026-08-17'),
        })),
      },
    } as unknown as PrismaService;
    const fx = new FxService(prisma, settings, new ConfigService({}));

    const cur = await fx.getCurrent();
    expect(cur.bufferPct).toBe(5); // del DIAL, no 3
    expect(cur.rate).toBe(18);
    expect(cur.source).toBe('banxico');
  });
});

describe('FxService.setManual — rate opcional (#13)', () => {
  function build() {
    const settings = {
      update: jest.fn(async () => ({})),
      getNumber: jest.fn(async () => 4),
    } as unknown as SettingsService;
    const prisma = { fxRate: { upsert: jest.fn(async () => ({})) } } as unknown as PrismaService;
    const fx = new FxService(prisma, settings, new ConfigService({}));
    return { fx, settings, prisma };
  }

  it('solo colchón (sin rate) → actualiza fxBufferPct y NO pinnea la tasa manual', async () => {
    const { fx, settings, prisma } = build();
    await fx.setManual(undefined, 5);
    expect(settings.update).toHaveBeenCalledWith({ fxBufferPct: 5 });
    // NO se escribe fila FxRate manual (no hay rate que pinnear).
    expect((prisma.fxRate as any).upsert).not.toHaveBeenCalled();
  });

  it('con rate explícito → pinnea override + escribe fila FxRate manual', async () => {
    const { fx, settings, prisma } = build();
    await fx.setManual(19, 5);
    expect(settings.update).toHaveBeenCalledWith({ fxBufferPct: 5, fxManualOverrideRate: 19 });
    expect((prisma.fxRate as any).upsert).toHaveBeenCalledTimes(1);
    const arg = (prisma.fxRate as any).upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ rate: 19, bufferPct: 5, source: 'manual' });
  });

  it('rate sin bufferPct → usa el colchón del dial para la fila FxRate', async () => {
    const { fx, settings, prisma } = build();
    await fx.setManual(19);
    expect(settings.update).toHaveBeenCalledWith({ fxManualOverrideRate: 19 });
    const arg = (prisma.fxRate as any).upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ rate: 19, bufferPct: 4, source: 'manual' }); // 4 = dial
  });
});

describe('FxController.setManual — rate opcional pero al menos uno', () => {
  function build() {
    const fx = {
      setManual: jest.fn(async () => {}),
      getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 5, source: 'banxico', effectiveDate: '2026-08-17' })),
    } as unknown as FxService;
    const audit = { log: jest.fn(async () => {}) } as unknown as AuditService;
    return { ctrl: new FxController(fx, audit), fx, audit };
  }

  it('body vacío (ni rate ni bufferPct) → 422 VALIDATION_ERROR', async () => {
    const { ctrl } = build();
    await expect(ctrl.setManual({}, 'admin-1')).rejects.toBeInstanceOf(BusinessException);
  });

  it('solo bufferPct → llama setManual(undefined, buffer) y audita', async () => {
    const { ctrl, fx, audit } = build();
    await ctrl.setManual({ bufferPct: 5 }, 'admin-1');
    expect((fx.setManual as jest.Mock)).toHaveBeenCalledWith(undefined, 5);
    expect((audit.log as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fx.override', after: { rate: null, bufferPct: 5 } }),
    );
  });

  it('rate + bufferPct → llama setManual(rate, buffer)', async () => {
    const { ctrl, fx } = build();
    await ctrl.setManual({ rate: 19, bufferPct: 5 }, 'admin-1');
    expect((fx.setManual as jest.Mock)).toHaveBeenCalledWith(19, 5);
  });
});
