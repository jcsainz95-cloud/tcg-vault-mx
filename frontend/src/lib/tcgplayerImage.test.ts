import { describe, expect, it } from 'vitest';
import { upgradeTcgplayerThumb } from './tcgplayerImage';

const base = 'https://tcgplayer-cdn.tcgplayer.com/product/123';
describe('upgradeTcgplayerThumb', () => {
  it('200w -> 1000x1000, idempotente', () => {
    const up = upgradeTcgplayerThumb(`${base}_200w.jpg`);
    expect(up).toBe(`${base}_in_1000x1000.jpg`);
    expect(upgradeTcgplayerThumb(up)).toBe(up);
  });
  it('otros hosts, vacío y null intactos', () => {
    const o = 'https://images.pokemontcg.io/sv1/1.png';
    expect(upgradeTcgplayerThumb(o)).toBe(o);
    expect(upgradeTcgplayerThumb(undefined)).toBeUndefined();
    expect(upgradeTcgplayerThumb(null)).toBeNull();
    expect(upgradeTcgplayerThumb('')).toBe('');
  });
});
