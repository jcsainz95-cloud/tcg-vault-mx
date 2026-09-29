import { ConfigService } from '@nestjs/config';
import {
  isValidLimitlessId,
  isValidFormatCode,
  buildDeckListUrl,
  buildArchetypeUrl,
  buildHomeUrl,
  buildFormatLabel,
  slugifyDeckName,
  normalizeAutofetchDial,
  normalizeAutopublishDial,
  resolveFetchConfig,
  resolveCanaryThresholds,
  FETCH_DEFAULTS,
} from '../src/modules/decks-meta/limitless.config';

/**
 * DECKS-META Fase 2 — superficie ANTI-SSRF y config (spec §9). Las URLs se construyen SÓLO desde
 * IDs numéricos validados; nada del usuario entra en la URL. Diales fail-closed. (Lo revisa SEGURIDAD.)
 */
describe('anti-SSRF: validación de IDs y construcción de URL (§9)', () => {
  it('isValidLimitlessId acepta sólo dígitos', () => {
    expect(isValidLimitlessId('28760')).toBe(true);
    expect(isValidLimitlessId('0')).toBe(true);
    expect(isValidLimitlessId('28760/../../etc')).toBe(false);
    expect(isValidLimitlessId('abc')).toBe(false);
    expect(isValidLimitlessId('12a')).toBe(false);
    expect(isValidLimitlessId('')).toBe(false);
    expect(isValidLimitlessId(undefined)).toBe(false);
    expect(isValidLimitlessId('  12  ')).toBe(false);
  });

  it('build*Url construye siempre sobre limitlesstcg.com y sólo con IDs numéricos', () => {
    expect(buildHomeUrl()).toBe('https://limitlesstcg.com/');
    expect(buildDeckListUrl('28760')).toBe('https://limitlesstcg.com/decks/list/28760');
    expect(buildArchetypeUrl('284')).toBe('https://limitlesstcg.com/decks/284');
  });

  it('build*Url LANZA (defensa en profundidad) ante un ID no numérico', () => {
    expect(() => buildDeckListUrl('28760@evil.com')).toThrow();
    expect(() => buildDeckListUrl('http://evil.com')).toThrow();
    expect(() => buildArchetypeUrl('../admin')).toThrow();
  });

  it('isValidFormatCode acepta el patrón del formato y rechaza basura', () => {
    expect(isValidFormatCode('TEF-PBL')).toBe(true);
    expect(isValidFormatCode('STD')).toBe(true);
    expect(isValidFormatCode('tef-pbl')).toBe(false); // minúsculas no
    expect(isValidFormatCode('TEF-PBL; DROP')).toBe(false);
    expect(isValidFormatCode('')).toBe(false);
  });
});

describe('diales fail-closed', () => {
  it('normalizeAutofetchDial: sólo on/dryrun válidos; todo lo demás ⇒ off', () => {
    expect(normalizeAutofetchDial('on')).toBe('on');
    expect(normalizeAutofetchDial('dryrun')).toBe('dryrun');
    expect(normalizeAutofetchDial('off')).toBe('off');
    expect(normalizeAutofetchDial('ON')).toBe('off');
    expect(normalizeAutofetchDial(null)).toBe('off');
    expect(normalizeAutofetchDial(true)).toBe('off');
    expect(normalizeAutofetchDial(undefined)).toBe('off');
  });

  it('normalizeAutopublishDial: sólo el booleano true enciende', () => {
    expect(normalizeAutopublishDial(true)).toBe(true);
    expect(normalizeAutopublishDial('true')).toBe(false);
    expect(normalizeAutopublishDial(1)).toBe(false);
    expect(normalizeAutopublishDial(undefined)).toBe(false);
  });
});

describe('resolveFetchConfig: tope DURO de requests', () => {
  it('defaults cuando no hay env', () => {
    const cfg = resolveFetchConfig(new ConfigService({}));
    expect(cfg).toMatchObject({ topN: 10, delayMs: 1500, timeoutMs: 10000, retries: 2, maxRequests: 12 });
    expect(cfg.maxBytes).toBe(FETCH_DEFAULTS.maxBytes);
  });

  it('maxRequests nunca supera el tope duro 12, y topN se recorta para 1(home)+topN ≤ maxRequests', () => {
    const cfg = resolveFetchConfig(new ConfigService({ META_FETCH_TOP_N: '50', META_FETCH_MAX_REQUESTS: '99' }));
    expect(cfg.maxRequests).toBe(12); // tope duro
    expect(cfg.topN).toBe(11); // 1 (home) + 11 = 12
  });

  it('overrides por env se respetan (devops afina sin redeploy)', () => {
    const cfg = resolveFetchConfig(new ConfigService({ META_FETCH_TOP_N: '5', META_FETCH_DELAY_MS: '0' }));
    expect(cfg.topN).toBe(5);
    expect(cfg.delayMs).toBe(0);
  });
});

describe('resolveCanaryThresholds + helpers', () => {
  it('defaults del canary', () => {
    expect(resolveCanaryThresholds(new ConfigService({}))).toEqual({
      minDecks: 6,
      cardsMin: 55,
      cardsMax: 61,
      matchFloor: 0.8,
      unmatchedSetMaxRatio: 0.1,
    });
  });

  it('overrides del canary por env', () => {
    const t = resolveCanaryThresholds(new ConfigService({ META_CANARY_MIN_DECKS: '8', META_CANARY_MATCH_FLOOR: '0.9' }));
    expect(t.minDecks).toBe(8);
    expect(t.matchFloor).toBe(0.9);
  });

  it('buildFormatLabel y slugifyDeckName', () => {
    expect(buildFormatLabel('TEF-PBL')).toBe('Standard TEF-PBL');
    expect(buildFormatLabel(null)).toBe('Standard');
    expect(slugifyDeckName('Dragapult ex')).toBe('dragapult-ex');
    expect(slugifyDeckName('Gardevoir / Zacian')).toBe('gardevoir-zacian');
  });
});
