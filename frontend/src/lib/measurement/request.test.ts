import { afterEach, describe, expect, it, vi } from 'vitest';
import { bannerResponseBody, buildMeasurementInput, gaClientIdFromCookie, measurementForRequest, sendBannerResponse } from './request';
import { setRuntimeConsent } from './track';
import type { CookieJar } from './consent';

function jarWith(cookies: Record<string, string>): CookieJar {
  return {
    read: () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
    write: () => undefined,
    hostname: 'tcghunt.mx',
  };
}

const ALL = {
  _ga: 'GA1.1.1234567890.1729300000',
  _fbp: 'fb.1.1729300000000.123456789',
  _fbc: 'fb.1.1729300000000.IwAR0abc',
  th_first_utm: encodeURIComponent(JSON.stringify({ source: 'ig', medium: 'story', t: '2026-10-19T00:00:00.000Z' })),
};

/** §MKT.H.2 — el objeto `measurement` de las tres peticiones. */
describe('buildMeasurementInput', () => {
  it('sin elección o sin aviso ⇒ no viaja', () => {
    expect(buildMeasurementInput(null, 'v1', jarWith(ALL))).toBeUndefined();
    expect(buildMeasurementInput({ analytics: true, ads: true }, null, jarWith(ALL))).toBeUndefined();
  });

  it('todo concedido ⇒ consent, versión, firstUtm, gaClientId, fbp y fbc', () => {
    expect(buildMeasurementInput({ analytics: true, ads: true }, 'v1', jarWith(ALL))).toEqual({
      consent: { analytics: true, ads: true },
      noticeVersion: 'v1',
      firstUtm: { source: 'ig', medium: 'story', landedAt: '2026-10-19T00:00:00.000Z' },
      gaClientId: '1234567890.1729300000',
      fbp: ALL._fbp,
      fbc: ALL._fbc,
    });
  });

  it('analítica no ⇒ ni firstUtm ni gaClientId; publicidad no ⇒ ni fbp ni fbc', () => {
    expect(buildMeasurementInput({ analytics: false, ads: false }, 'v1', jarWith(ALL))).toEqual({
      consent: { analytics: false, ads: false },
      noticeVersion: 'v1',
    });
  });

  it('cookies con forma inválida se descartan', () => {
    const m = buildMeasurementInput({ analytics: true, ads: true }, 'v1', jarWith({ _ga: 'x', _fbp: 'fb.1.2.3', _fbc: 'mal' }));
    expect(m).toEqual({ consent: { analytics: true, ads: true }, noticeVersion: 'v1' });
  });

  it('gaClientIdFromCookie', () => {
    expect(gaClientIdFromCookie('GA1.2.111.222')).toBe('111.222');
    expect(gaClientIdFromCookie('GA1.2')).toBeUndefined();
  });
});

describe('modo off', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setRuntimeConsent(null);
  });

  it('measurementForRequest ⇒ undefined aunque haya elección en memoria', () => {
    setRuntimeConsent({ analytics: true, ads: true });
    expect(measurementForRequest()).toBeUndefined();
  });

  it('sendBannerResponse no llama a la red', () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    sendBannerResponse('accept');
    expect(f).not.toHaveBeenCalled();
  });

  it('con on, sendBannerResponse manda el body del contrato sin credenciales', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    sendBannerResponse('custom', 'story');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/measurement\/banner-response$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(String(init.body))).toEqual({ response: 'custom', utmMedium: 'story' });
    expect(bannerResponseBody('accept')).toEqual({ response: 'accept' });
  });
});
