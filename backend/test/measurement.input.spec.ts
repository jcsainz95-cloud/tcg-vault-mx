/**
 * §MKT.H.2 — el saneador del objeto `measurement` (puro, nunca lanza, descarta campo a campo).
 * Parte de C-B2 («`measurement` basura ⇒ misma respuesta que sin él») y de C-B4 (consentimiento).
 */
import { sanitizeMeasurementInput } from '../src/modules/measurement/measurement-input';
import { FBC, FBP, GA_CLIENT } from './helpers/measurement-fixtures';

const NOW = new Date('2026-10-18T18:00:00.000Z');
const ok = (over: Record<string, unknown> = {}) => ({
  consent: { analytics: true, ads: true },
  noticeVersion: '2026-11.1',
  firstUtm: { source: 'instagram', medium: 'bio', campaign: 'cardshow-nov', content: 'reel-1', landedAt: '2026-10-17T10:00:00.000Z' },
  gaClientId: GA_CLIENT,
  fbp: FBP,
  fbc: FBC,
  ...over,
});

describe('§MKT.H.2 · sanitizeMeasurementInput', () => {
  it('completo y válido ⇒ columnas de consentimiento + firstUtm* y contexto con los tres identificadores', () => {
    const r = sanitizeMeasurementInput(ok(), NOW)!;
    expect(r.columns).toEqual({
      measurementConsentAnalytics: true,
      measurementConsentAds: true,
      measurementNoticeVersion: '2026-11.1',
      firstUtmSource: 'instagram',
      firstUtmMedium: 'bio',
      firstUtmCampaign: 'cardshow-nov',
      firstUtmContent: 'reel-1',
      firstUtmLandedAt: new Date('2026-10-17T10:00:00.000Z'),
    });
    expect(r.context).toEqual({ gaClientId: GA_CLIENT, fbp: FBP, fbc: FBC });
  });

  it.each([
    ['null', null],
    ['string', 'basura'],
    ['número', 42],
    ['array', [1, 2]],
    ['sin consent', { noticeVersion: 'v1' }],
    ['consent no booleano', { consent: { analytics: 'yes', ads: true }, noticeVersion: 'v1' }],
    ['sin noticeVersion', { consent: { analytics: true, ads: true } }],
    ['noticeVersion con espacio', { consent: { analytics: true, ads: true }, noticeVersion: 'v 1' }],
    ['noticeVersion > 32', { consent: { analytics: true, ads: true }, noticeVersion: 'x'.repeat(33) }],
  ])('%s ⇒ null (se ignora entero, sin lanzar)', (_n, raw) => {
    expect(() => sanitizeMeasurementInput(raw, NOW)).not.toThrow();
    expect(sanitizeMeasurementInput(raw, NOW)).toBeNull();
  });

  it('un getter hostil no lanza: null', () => {
    const hostile = { get consent() { throw new Error('boom'); } };
    expect(sanitizeMeasurementInput(hostile, NOW)).toBeNull();
  });

  it('C-B4 · analytics=false ⇒ fuera firstUtm y gaClientId aunque vengan', () => {
    const r = sanitizeMeasurementInput(ok({ consent: { analytics: false, ads: true } }), NOW)!;
    expect(Object.keys(r.columns).filter((k) => k.startsWith('firstUtm'))).toEqual([]);
    expect(r.context).toEqual({ fbp: FBP, fbc: FBC });
  });

  it('C-B4 · ads=false ⇒ fuera fbp/fbc', () => {
    const r = sanitizeMeasurementInput(ok({ consent: { analytics: true, ads: false } }), NOW)!;
    expect(r.context).toEqual({ gaClientId: GA_CLIENT });
  });

  it('todo denegado ⇒ solo el consentimiento (false/false) y la versión; sin contexto', () => {
    const r = sanitizeMeasurementInput(ok({ consent: { analytics: false, ads: false } }), NOW)!;
    expect(r.columns).toEqual({ measurementConsentAnalytics: false, measurementConsentAds: false, measurementNoticeVersion: '2026-11.1' });
    expect(r.context).toBeNull();
  });

  it('campo a campo: utm inválido, ids sin forma y landedAt fuera de plazo se descartan; lo demás se queda', () => {
    const r = sanitizeMeasurementInput(
      ok({
        firstUtm: { source: 'juan@correo.com', medium: 'BIO', campaign: '<script>', content: 5, landedAt: '2026-12-01T00:00:00Z' },
        gaClientId: 'GA1.2.3',
        fbp: 'fb.1.x.y',
        fbc: FBC,
        email: 'no@debe.salir',
      }),
      NOW,
    )!;
    expect(r.columns).toEqual({
      measurementConsentAnalytics: true,
      measurementConsentAds: true,
      measurementNoticeVersion: '2026-11.1',
      firstUtmMedium: 'bio',
    });
    expect(r.context).toEqual({ fbc: FBC });
    expect(JSON.stringify(r)).not.toContain('no@debe.salir');
  });

  it('landedAt de hace más de 90 días ⇒ se descarta (el utm se queda)', () => {
    const r = sanitizeMeasurementInput(ok({ firstUtm: { source: 'ig', landedAt: '2026-07-01T00:00:00Z' } }), NOW)!;
    expect(r.columns.firstUtmSource).toBe('ig');
    expect(r.columns.firstUtmLandedAt).toBeUndefined();
  });
});
