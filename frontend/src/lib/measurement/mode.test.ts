import { describe, expect, it } from 'vitest';
import { measurementActive, parseMeasurementIds, parseMeasurementMode } from './mode';
import { measurementBuildEnv } from '../../../next.config.mjs';

/** §MKT.H.1: falta o no válida ⇒ `off` (espejo de C-B1 del backend). */
describe('interruptor NEXT_PUBLIC_MEASUREMENT_MODE', () => {
  it.each([undefined, '', 'ON', 'On', 'true', '1', ' on', 'on ', 'yes'])('%j ⇒ off', (raw) => {
    expect(parseMeasurementMode(raw)).toBe('off');
  });
  it('solo «on» enciende', () => {
    expect(parseMeasurementMode('on')).toBe('on');
  });

  it('IDs con forma válida o null (fail-closed por etiqueta)', () => {
    expect(parseMeasurementIds({ ga4: 'G-ABC123', pixel: '1234567890' })).toEqual({ ga4: 'G-ABC123', pixel: '1234567890' });
    expect(parseMeasurementIds({ ga4: 'UA-1', pixel: '123' })).toEqual({ ga4: null, pixel: null });
    expect(parseMeasurementIds({ ga4: 'g-abc123', pixel: '12345678901234567890123' })).toEqual({ ga4: null, pixel: null });
  });

  it('on sin ningún ID válido ⇒ inactivo (sin banner: no se pide permiso para algo que no existe)', () => {
    expect(measurementActive('on', { ga4: null, pixel: null })).toBe(false);
    expect(measurementActive('on', { ga4: 'G-ABC123', pixel: null })).toBe(true);
    expect(measurementActive('off', { ga4: 'G-ABC123', pixel: '1234567890' })).toBe(false);
  });

  it('next.config hornea SIEMPRE el modo normalizado; con off, sin IDs ni orígenes CSP', () => {
    expect(measurementBuildEnv({})).toEqual({
      NEXT_PUBLIC_MEASUREMENT_MODE: 'off',
      NEXT_PUBLIC_GA4_MEASUREMENT_ID: '',
      NEXT_PUBLIC_META_PIXEL_ID: '',
      TH_MEASUREMENT_CSP_CONNECT: '',
      NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION: '',
    });
    const offWithIds = measurementBuildEnv({
      NEXT_PUBLIC_MEASUREMENT_MODE: 'ON',
      NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-ABC123',
      NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
    });
    expect(offWithIds.NEXT_PUBLIC_MEASUREMENT_MODE).toBe('off');
    expect(offWithIds.NEXT_PUBLIC_GA4_MEASUREMENT_ID).toBe('');
    expect(offWithIds.TH_MEASUREMENT_CSP_CONNECT).toBe('');
  });

  it('la versión de aviso de E2E solo se hornea en builds de MOCKS con on', () => {
    const real = measurementBuildEnv({ NEXT_PUBLIC_MEASUREMENT_MODE: 'on', NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION: 'e2e' });
    expect(real.NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION).toBe('');
    const mock = measurementBuildEnv({
      NEXT_PUBLIC_MEASUREMENT_MODE: 'on',
      NEXT_PUBLIC_USE_MOCKS: 'true',
      NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION: 'e2e',
    });
    expect(mock.NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION).toBe('e2e');
  });
});
