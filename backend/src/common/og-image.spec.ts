import { absoluteOgImageUrl } from './og-image';

/**
 * §MKT.A / §13.2.3 — `absoluteOgImageUrl`: devuelve la primera candidata ABSOLUTA http(s); si ninguna,
 * `null` (⇒ frontend omite `og:image`, ⛔ nunca inventa arte). ⚠️ NO verifica el tamaño (≥1200×630).
 */
describe('absoluteOgImageUrl (§MKT.A / §13.2.3)', () => {
  it('devuelve la primera candidata absoluta (la grande gana cuando viene primero)', () => {
    expect(
      absoluteOgImageUrl('https://images.pokemontcg.io/sv8/1_hires.png', 'https://images.pokemontcg.io/sv8/1.png'),
    ).toBe('https://images.pokemontcg.io/sv8/1_hires.png');
  });

  it('cae a la segunda candidata si la primera es null/undefined', () => {
    expect(absoluteOgImageUrl(null, 'https://images.pokemontcg.io/sv8/1.png')).toBe(
      'https://images.pokemontcg.io/sv8/1.png',
    );
    expect(absoluteOgImageUrl(undefined, 'http://cdn.example.com/box.jpg')).toBe('http://cdn.example.com/box.jpg');
  });

  it('descarta una URL RELATIVA y devuelve null si no hay ninguna absoluta', () => {
    expect(absoluteOgImageUrl('/images/box.png')).toBeNull();
    expect(absoluteOgImageUrl('images/box.png')).toBeNull();
  });

  it('salta la relativa y toma la absoluta posterior', () => {
    expect(absoluteOgImageUrl('/rel.png', 'https://abs.example.com/x.png')).toBe('https://abs.example.com/x.png');
  });

  it('devuelve null cuando no hay candidatas o todas son nulas/vacías', () => {
    expect(absoluteOgImageUrl()).toBeNull();
    expect(absoluteOgImageUrl(null, undefined, '')).toBeNull();
    expect(absoluteOgImageUrl('   ')).toBeNull();
  });

  it('hace trim de la candidata devuelta', () => {
    expect(absoluteOgImageUrl('  https://abs.example.com/x.png  ')).toBe('https://abs.example.com/x.png');
  });
});
