/**
 * C-B1 (interruptor) y C-B7 (fail-closed por destino) — API_CONTRACT §MKT.H.1/.11; ARCHITECTURE §14.1.
 *
 * - `MEASUREMENT_MODE` ausente, vacío, `ON`, `true`, `1`, ` on` ⇒ `off`. Solo el literal `on` enciende.
 * - `on` sin `META_CAPI_TOKEN` ⇒ Meta deshabilitado, UNA línea `MEASUREMENT_DESTINATION_DISABLED` sin valores, y el servicio
 *   arranca (no lanza). Canario C-B1: leer el modo con `!== 'off'` ⇒ rojo.
 */
import { Logger } from '@nestjs/common';
import {
  destinationEnabled,
  disabledDestinationLines,
  readMeasurementConfig,
  readMeasurementMode,
} from '../src/modules/measurement/measurement.config';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { CAPI_TOKEN, GA4_ID, GA4_SECRET, PIXEL, fakeConfig, fullEnv as full } from './helpers/measurement-fixtures';

describe('C-B1 · MEASUREMENT_MODE: solo el literal `on` enciende', () => {
  it.each([[undefined], [''], ['ON'], ['On'], ['true'], ['1'], [' on'], ['on '], ['yes'], ['off']])('%p ⇒ off', (v) => {
    expect(readMeasurementMode({ MEASUREMENT_MODE: v })).toBe('off');
    const cfg = readMeasurementConfig(full({ MEASUREMENT_MODE: v }));
    expect(cfg.mode).toBe('off');
    // Con off, ningún destino está habilitado aunque tenga sus variables completas.
    expect(destinationEnabled(cfg, 'ga4_mp')).toBe(false);
    expect(destinationEnabled(cfg, 'meta_capi')).toBe(false);
    expect(disabledDestinationLines(cfg)).toEqual([]);
  });
  it("'on' ⇒ on, y con las cuatro variables los dos destinos se habilitan", () => {
    const cfg = readMeasurementConfig(full());
    expect(cfg.mode).toBe('on');
    expect(destinationEnabled(cfg, 'ga4_mp')).toBe(true);
    expect(destinationEnabled(cfg, 'meta_capi')).toBe(true);
  });
});

describe('C-B7 · fail-closed por destino, una línea sin valores, arranque OK', () => {
  it('on sin META_CAPI_TOKEN ⇒ meta deshabilitado, GA4 sigue, UNA línea MEASUREMENT_DESTINATION_DISABLED sin valores', () => {
    const cfg = readMeasurementConfig(full({ META_CAPI_TOKEN: undefined }));
    expect(destinationEnabled(cfg, 'meta_capi')).toBe(false);
    expect(destinationEnabled(cfg, 'ga4_mp')).toBe(true);
    const lines = disabledDestinationLines(cfg);
    expect(lines).toEqual(['MEASUREMENT_DESTINATION_DISABLED destination=meta_capi reason=missing_config']);
    for (const v of [GA4_ID, GA4_SECRET, PIXEL, CAPI_TOKEN]) expect(lines.join('\n')).not.toContain(v);
  });
  it.each([
    ['GA4 id con forma inválida', { GA4_MEASUREMENT_ID: 'UA-12345' }, 'ga4_mp', 'invalid_config'],
    ['GA4 sin secreto', { GA4_MP_API_SECRET: '' }, 'ga4_mp', 'missing_config'],
    ['secreto GA4 con espacio', { GA4_MP_API_SECRET: 'a b' }, 'ga4_mp', 'invalid_config'],
    ['píxel con letras', { META_PIXEL_ID: '12345abc901' }, 'meta_capi', 'invalid_config'],
    ['token corto', { META_CAPI_TOKEN: 'short' }, 'meta_capi', 'invalid_config'],
  ])('%s ⇒ deshabilitado con motivo, sin valores', (_n, over, dest, reason) => {
    const cfg = readMeasurementConfig(full(over));
    expect(destinationEnabled(cfg, dest as 'ga4_mp' | 'meta_capi')).toBe(false);
    const lines = disabledDestinationLines(cfg);
    expect(lines).toEqual([`MEASUREMENT_DESTINATION_DISABLED destination=${dest} reason=${reason}`]);
  });
  it('el servicio arranca sin lanzar y escribe UNA línea por destino deshabilitado (y ningún valor)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const env = full({ META_CAPI_TOKEN: undefined });
      const svc = new MeasurementService({} as never, fakeConfig(env));
      expect(() => svc.onModuleInit()).not.toThrow();
      const warned = warn.mock.calls.map((c) => String(c[0]));
      expect(warned.filter((l) => l.startsWith('MEASUREMENT_DESTINATION_DISABLED'))).toEqual([
        'MEASUREMENT_DESTINATION_DISABLED destination=meta_capi reason=missing_config',
      ]);
      const all = [...warned, ...log.mock.calls.map((c) => String(c[0]))].join('\n');
      for (const v of [GA4_ID, GA4_SECRET, PIXEL]) expect(all).not.toContain(v);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
