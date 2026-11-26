import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VISIT_ORIGIN_KEY,
  captureVisitOrigin,
  computeVisitOrigin,
  readVisitOrigin,
  reduceReferrer,
  visitOriginBodyField,
} from './visit-origin';

describe('reduceReferrer (CV-2)', () => {
  it.each([
    ['https://www.google.com/', 'google'],
    ['https://www.google.com.mx/search?q=x', 'google'],
    ['https://gemini.google.com/app', 'gemini'],
    ['https://l.instagram.com/?u=x', 'instagram'],
    ['https://chatgpt.com/', 'chatgpt'],
    ['https://www.bing.com/', 'bing'],
    ['https://www.perplexity.ai/', 'perplexity'],
    ['https://m.facebook.com/', 'facebook'],
    ['https://sitio-raro.example/', 'otro'],
    ['', 'directo'],
    ['no-es-url', 'directo'],
    ['https://www.tcghunt.mx/cartas', 'directo'],
  ])('%s -> %s', (raw, expected) => {
    expect(reduceReferrer(raw, 'www.tcghunt.mx')).toBe(expected);
  });
});

describe('computeVisitOrigin', () => {
  it('UTM válido gana al referente (CV-1)', () => {
    expect(computeVisitOrigin('?utm_source=Instagram&utm_medium=social', 'https://google.com/')).toEqual({
      utmSource: 'instagram',
      utmMedium: 'social',
    });
  });
  it('UTM inválido se descarta y cae al referente', () => {
    expect(computeVisitOrigin('?utm_source=a@b', 'https://google.com/')).toEqual({ referrer: 'google' });
  });
  it('sin nada ⇒ directo', () => {
    expect(computeVisitOrigin('', '')).toEqual({ referrer: 'directo' });
  });
});

describe('sessionStorage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  it('primera entrada gana y no toca localStorage ni cookies', () => {
    window.history.replaceState({}, '', '/?utm_source=instagram');
    captureVisitOrigin();
    window.history.replaceState({}, '', '/?utm_source=otro');
    captureVisitOrigin();
    expect(readVisitOrigin()).toEqual({ utmSource: 'instagram' });
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).not.toContain('visit');
    expect(visitOriginBodyField()).toEqual({ visitOrigin: { utmSource: 'instagram' } });
  });
  it('dato corrupto o sin dato ⇒ se omite el campo', () => {
    expect(visitOriginBodyField()).toEqual({});
    window.sessionStorage.setItem(VISIT_ORIGIN_KEY, '{"referrer":"evil.com"}');
    expect(visitOriginBodyField()).toEqual({});
    window.sessionStorage.setItem(VISIT_ORIGIN_KEY, '[1');
    expect(visitOriginBodyField()).toEqual({});
  });
  it('sessionStorage que lanza no rompe nada', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => captureVisitOrigin()).not.toThrow();
    expect(visitOriginBodyField()).toEqual({});
    spy.mockRestore();
  });
});

describe('aislamiento: ningún visit* va a GA4, Meta, CAPI ni MeasurementContext', () => {
  it('el código de medición no menciona visitOrigin ni visit-origin', () => {
    const dir = join(__dirname, 'measurement');
    for (const f of readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/visit-origin|visitOrigin|visitUtm|visitReferrer/);
    }
  });
});
