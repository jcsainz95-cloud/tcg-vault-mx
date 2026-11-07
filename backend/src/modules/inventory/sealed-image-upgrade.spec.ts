import { upgradeSealedImageUrl } from './sealed-image-host';

describe('upgradeSealedImageUrl', () => {
  const base = 'https://tcgplayer-cdn.tcgplayer.com/product/123456';
  it('200w -> 1000x1000', () => {
    expect(upgradeSealedImageUrl(`${base}_200w.jpg`)).toBe(`${base}_in_1000x1000.jpg`);
    expect(upgradeSealedImageUrl(`${base}_400w.jpg`)).toBe(`${base}_in_1000x1000.jpg`);
  });
  it('idempotente', () => {
    const once = upgradeSealedImageUrl(`${base}_200w.jpg`);
    expect(upgradeSealedImageUrl(once)).toBe(once);
  });
  it('otro host o sin sufijo: intacto', () => {
    const other = 'https://images.pokemontcg.io/product/1_200w.jpg';
    expect(upgradeSealedImageUrl(other)).toBe(other);
    expect(upgradeSealedImageUrl(`${base}.jpg`)).toBe(`${base}.jpg`);
    expect(upgradeSealedImageUrl(null)).toBeNull();
    expect(upgradeSealedImageUrl('no-url')).toBe('no-url');
  });
});
