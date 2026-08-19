import { FxController } from './pricing.controller';
import type { FxService } from './fx.service';
import type { AuditService } from '../audit/audit.service';
import {
  MAX_FX_MANUAL_OVERRIDE_RATE,
  SETTING_VALIDATORS,
  SettingKey,
  validateFxManualOverrideRate,
} from '../settings/settings.constants';

/**
 * FX-B1 / FX-B2 (pentest, hallazgos BAJOS): el dial `fx_manual_override_rate` debe estar acotado
 * arriba (evita overflow de `Int priceMxnCents` en price-ingest → DoS) y validado con la MISMA regla
 * en las DOS puertas que lo escriben: `PUT /admin/settings` (SETTING_VALIDATORS) y `PUT /admin/fx`
 * (FxController). Ninguna puede quedar más permisiva que la otra.
 */

const ABSURD = 1e9; // override absurdo que desbordaría la columna Int priceMxnCents (~2.1e9).

describe('FX-B1/B2 — validateFxManualOverrideRate (helper compartido)', () => {
  it('acepta null (borra el override)', () => {
    expect(validateFxManualOverrideRate(null)).toBeNull();
  });

  it('acepta un tipo de cambio realista y fraccional (FxRate Decimal(12,6))', () => {
    expect(validateFxManualOverrideRate(18)).toBeNull();
    expect(validateFxManualOverrideRate(18.5)).toBeNull();
    expect(validateFxManualOverrideRate(20.123456)).toBeNull();
  });

  it('acepta el valor EN el techo MAX_FX_MANUAL_OVERRIDE_RATE', () => {
    expect(validateFxManualOverrideRate(MAX_FX_MANUAL_OVERRIDE_RATE)).toBeNull();
  });

  it('rechaza SOBRE el techo (cota superior finita, FX-B1)', () => {
    expect(validateFxManualOverrideRate(MAX_FX_MANUAL_OVERRIDE_RATE + 1)).not.toBeNull();
    expect(validateFxManualOverrideRate(ABSURD)).not.toBeNull();
  });

  it('rechaza 0, negativos, NaN e Infinity', () => {
    expect(validateFxManualOverrideRate(0)).not.toBeNull();
    expect(validateFxManualOverrideRate(-1)).not.toBeNull();
    expect(validateFxManualOverrideRate(NaN)).not.toBeNull();
    expect(validateFxManualOverrideRate(Infinity)).not.toBeNull();
  });

  it('el mensaje de error nombra el rango claro (0, MAX]', () => {
    const msg = validateFxManualOverrideRate(ABSURD);
    expect(msg).toContain(String(MAX_FX_MANUAL_OVERRIDE_RATE));
  });
});

describe('FX-B2 — PUT /admin/settings usa el MISMO validador', () => {
  const gate = SETTING_VALIDATORS[SettingKey.FX_MANUAL_OVERRIDE_RATE];

  it('está cableado al helper compartido', () => {
    expect(gate).toBe(validateFxManualOverrideRate);
  });

  it('rechaza el valor absurdo y acepta el límite / null', () => {
    expect(gate(ABSURD)).not.toBeNull();
    expect(gate(MAX_FX_MANUAL_OVERRIDE_RATE + 1)).not.toBeNull();
    expect(gate(MAX_FX_MANUAL_OVERRIDE_RATE)).toBeNull();
    expect(gate(null)).toBeNull();
  });
});

describe('FX-B2 — PUT /admin/fx (FxController.setManual) aplica el MISMO rango', () => {
  const setManualSpy = jest.fn().mockResolvedValue(undefined);
  const getCurrentSpy = jest.fn().mockResolvedValue({ rate: 18, bufferPct: 0, source: 'manual', effectiveDate: '2026-08-19' });
  const fx = { setManual: setManualSpy, getCurrent: getCurrentSpy } as unknown as FxService;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const controller = new FxController(fx, audit);

  beforeEach(() => jest.clearAllMocks());

  it('rechaza override sobre el techo SIN escribir (mismo rango que settings)', async () => {
    await expect(controller.setManual({ rate: ABSURD } as never, 'admin-1')).rejects.toBeDefined();
    await expect(controller.setManual({ rate: MAX_FX_MANUAL_OVERRIDE_RATE + 1 } as never, 'admin-1')).rejects.toBeDefined();
    expect(setManualSpy).not.toHaveBeenCalled();
  });

  it('rechaza 0 y negativos', async () => {
    await expect(controller.setManual({ rate: 0 } as never, 'admin-1')).rejects.toBeDefined();
    await expect(controller.setManual({ rate: -5 } as never, 'admin-1')).rejects.toBeDefined();
    expect(setManualSpy).not.toHaveBeenCalled();
  });

  it('acepta override en el límite y fraccional (persiste)', async () => {
    await controller.setManual({ rate: MAX_FX_MANUAL_OVERRIDE_RATE } as never, 'admin-1');
    await controller.setManual({ rate: 18.5 } as never, 'admin-1');
    expect(setManualSpy).toHaveBeenCalledTimes(2);
  });

  it('acepta solo bufferPct sin pinnear la tasa (rate omitido)', async () => {
    await controller.setManual({ bufferPct: 5 } as never, 'admin-1');
    expect(setManualSpy).toHaveBeenCalledWith(undefined, 5);
  });
});
