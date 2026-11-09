import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchMissTerm, sendSearchMiss } from './search-miss';

const cfg = vi.hoisted(() => ({ useMocks: false, apiBaseUrl: 'https://api.test/api/v1' }));
vi.mock('@/lib/config', () => ({ config: cfg }));

describe('search-miss (§MKT-V2 c6)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    cfg.useMocks = false;
    window.sessionStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('el término sale recortado, en minúsculas y ≤ 80; muy corto ⇒ nada', () => {
    expect(searchMissTerm('  Charizard   VMAX ')).toBe('charizard vmax');
    expect(searchMissTerm('x'.repeat(200))).toHaveLength(80);
    expect(searchMissTerm('a')).toBeNull();
    expect(searchMissTerm('')).toBeNull();
  });

  it('manda {term, kind} sin credenciales y una sola vez por término y pestaña', () => {
    sendSearchMiss('Charizard VMAX', 'card');
    sendSearchMiss('charizard  vmax', 'card');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/v1/marketing/search-miss');
    expect(JSON.parse(String(init.body))).toEqual({ term: 'charizard vmax', kind: 'card' });
    expect(init.credentials).toBe('omit');
    sendSearchMiss('charizard vmax', 'sealed');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('tráfico propio o modo mocks: no manda', () => {
    window.localStorage.setItem('tcg_int', '1');
    sendSearchMiss('pikachu raro', 'card');
    window.localStorage.removeItem('tcg_int');
    cfg.useMocks = true;
    sendSearchMiss('pikachu raro', 'card');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
