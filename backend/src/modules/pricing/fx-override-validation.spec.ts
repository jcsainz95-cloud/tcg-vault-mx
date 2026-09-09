import { FxController } from './pricing.controller';
import type { FxService } from './fx.service';
import type { AuditService } from '../audit/audit.service';
import {
  MAX_FX_MANUAL_OVERRIDE_RATE,
  SETTING_VALIDATORS,
  SettingKey,
  validateFxManualOverrideRate,
} from '../settings/settings.constants';
import { FX_RATE_BAND_TEXT, FX_RATE_MIN } from '../../common/fx-mode';

/**
 * FX-B1 / FX-B2 (pentest, hallazgos BAJOS): el dial `fx_manual_override_rate` debe estar acotado
 * arriba (evita overflow de `Int priceMxnCents` en price-ingest → DoS) y validado con la MISMA regla
 * en las DOS puertas que lo escriben: `PUT /admin/settings` (SETTING_VALIDATORS) y `PUT /admin/fx`
 * (FxController). Ninguna puede quedar más permisiva que la otra.
 *
 * ⚠️ **v1.63.4 (`FX-24`, §M2-F.8): la banda gana PISO y pasa a `[1, 1000]`.** Este fichero cubre la
 * puerta TECLEADA; la **paridad con el parser de la SIE** —que es donde la mutación realista vive,
 * porque el arreglo se hace en dos ficheros— la asierta `FX-24(b)` en `test/fx.mode-switch.spec.ts`
 * como **identidad**, no como dos copias de esta lista.
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

  /**
   * ⭐⭐ **v1.63.4 (`FX-24`) — EL PISO, que hasta v1.63.3 no existía.**
   * `0.05` es la **inversa del par** (dólares por peso), el vector que produce que la fuente publique
   * el par al revés; con él, una carta de USD 100 pasa de MX$ 1,879 a MX$ 0.01.
   */
  it('⭐ rechaza SUB-PISO: la inversa del par, el ÷1000 y el `0.999999`', () => {
    expect(validateFxManualOverrideRate(1e-7)).not.toBeNull();
    expect(validateFxManualOverrideRate(0.0001)).not.toBeNull();
    expect(validateFxManualOverrideRate(0.05)).not.toBeNull();
    expect(validateFxManualOverrideRate(0.999999)).not.toBeNull();
  });

  it('⭐ acepta el valor EN el piso `1` (extremo inferior CERRADO)', () => {
    expect(validateFxManualOverrideRate(FX_RATE_MIN)).toBeNull();
  });

  it('el mensaje de error nombra los DOS extremos de la banda `[1, 1000]` (FX-24(d))', () => {
    const msg = validateFxManualOverrideRate(ABSURD);
    expect(msg).toContain(String(MAX_FX_MANUAL_OVERRIDE_RATE));
    // ⚠️ Hasta v1.63.3 sólo nombraba el techo: quien tecleaba `0.05` recibía un error que no
    // explicaba nada de lo que acababa de pasar.
    expect(msg).toContain(String(FX_RATE_MIN));
    expect(msg).toContain(FX_RATE_BAND_TEXT);
    expect(validateFxManualOverrideRate(0.05)).toContain(FX_RATE_BAND_TEXT);
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

  it('rechaza 0, negativos y SUB-PISO (FX-24: la banda es la misma en las dos puertas)', async () => {
    await expect(controller.setManual({ rate: 0 } as never, 'admin-1')).rejects.toBeDefined();
    await expect(controller.setManual({ rate: -5 } as never, 'admin-1')).rejects.toBeDefined();
    await expect(controller.setManual({ rate: 0.05 } as never, 'admin-1')).rejects.toBeDefined();
    await expect(controller.setManual({ rate: 0.999999 } as never, 'admin-1')).rejects.toBeDefined();
    expect(setManualSpy).not.toHaveBeenCalled();
  });

  it('acepta override en los DOS límites y fraccional (persiste)', async () => {
    await controller.setManual({ rate: MAX_FX_MANUAL_OVERRIDE_RATE } as never, 'admin-1');
    await controller.setManual({ rate: FX_RATE_MIN } as never, 'admin-1'); // ⭐ el piso, CERRADO
    await controller.setManual({ rate: 18.5 } as never, 'admin-1');
    expect(setManualSpy).toHaveBeenCalledTimes(3);
  });

  it('acepta solo bufferPct sin pinnear la tasa (rate omitido)', async () => {
    await controller.setManual({ bufferPct: 5 } as never, 'admin-1');
    // v1.63 (§M2-F.4): el 3er argumento es el contexto de actor+bitácora TRANSACCIONAL. Lo que este
    // candado mide sigue siendo lo mismo: `rate` viaja `undefined` ⇒ no se pinnea la tasa.
    expect(setManualSpy).toHaveBeenCalledWith(undefined, 5, expect.objectContaining({ actorUserId: 'admin-1' }));
  });
});
