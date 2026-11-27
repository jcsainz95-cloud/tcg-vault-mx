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

describe('correcciones del gate de qa (I-3, I-4, M-3, M-4)', () => {
  it('M-3: UTM sin utm_source ⇒ también el referente reducido', () => {
    expect(computeVisitOrigin('?utm_medium=social', 'https://l.instagram.com/')).toEqual({
      utmMedium: 'social',
      referrer: 'instagram',
    });
    expect(computeVisitOrigin('?utm_medium=social', '')).toEqual({ utmMedium: 'social', referrer: 'directo' });
    // Con utm_source no se añade referente.
    expect(computeVisitOrigin('?utm_source=ig&utm_medium=social', 'https://google.com/')).toEqual({
      utmSource: 'ig',
      utmMedium: 'social',
    });
  });
  it('M-3: lo guardado con medium + referrer sobrevive a la relectura', () => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/?utm_medium=social');
    captureVisitOrigin();
    expect(readVisitOrigin()).toEqual({ utmMedium: 'social', referrer: 'directo' });
  });
  it('M-4: referentes android-app y copilot', () => {
    expect(reduceReferrer('android-app://com.google.android.googlequicksearchbox')).toBe('google');
    expect(reduceReferrer('android-app://com.instagram.android')).toBe('instagram');
    expect(reduceReferrer('android-app://com.otra.app')).toBe('otro');
    expect(reduceReferrer('https://copilot.microsoft.com/')).toBe('otro');
  });
  it('I-3: entrada por /card-show?utm… y luego la tienda con referente propio conserva instagram', () => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/card-show?utm_source=instagram&utm_medium=bio');
    captureVisitOrigin(); // VisitOriginCapture montado en el layout de /card-show
    window.history.replaceState({}, '', '/es/catalog');
    Object.defineProperty(document, 'referrer', { value: `${window.location.origin}/card-show`, configurable: true });
    captureVisitOrigin(); // layout [locale]
    expect(readVisitOrigin()).toEqual({ utmSource: 'instagram', utmMedium: 'bio' });
  });
  it('I-3: ambos layouts raíz montan VisitOriginCapture', () => {
    const root = join(__dirname, '..', 'app');
    for (const f of [join('card-show', 'layout.tsx'), join('[locale]', 'layout.tsx')]) {
      expect(readFileSync(join(root, f), 'utf8'), f).toMatch(/<VisitOriginCapture \/>/);
    }
    // Solo hay dos layouts raíz (con <html>) bajo app/.
    const roots = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => {
        try {
          return /<html[\s>]/.test(readFileSync(join(root, d.name, 'layout.tsx'), 'utf8'));
        } catch {
          return false;
        }
      })
      .map((d) => d.name)
      .sort();
    expect(roots).toEqual(['[locale]', 'card-show']);
  });
  it('I-4: las 3 llamadas de api.ts mandan visitOriginBodyField()', () => {
    const src = readFileSync(join(__dirname, 'api.ts'), 'utf8');
    for (const path of ["'/checkout/session'", "'/checkout/guest/session'", "'/buylist/requests', { method: 'POST'"]) {
      const i = src.indexOf(path);
      expect(i, path).toBeGreaterThan(-1);
      expect(src.slice(i, i + 700), path).toContain('...visitOriginBodyField()');
    }
  });
});
