import * as fs from 'fs';
import * as path from 'path';
import { parseCardPricing, toCents, TcgdexShapeError, finishOfTcgplayerVariant } from './tcgdex-shape';

const FIX = path.join(__dirname, '../../../../test/fixtures/tcgdex');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

describe('tcgdex-shape — parser PURO + candado de forma (M-75 §PRE, DINERO, fixtures REALES)', () => {
  describe('toCents', () => {
    it('convierte unidades de divisa a centavos enteros', () => {
      expect(toCents(0.11)).toBe(11);
      expect(toCents(0.1)).toBe(10);
      expect(toCents(0.24)).toBe(24);
      expect(toCents(1.845)).toBe(185); // redondeo a centavos
    });
    it('rechaza no-positivos / no-finitos (sin precio usable ⇒ null)', () => {
      expect(toCents(0)).toBeNull();
      expect(toCents(-1)).toBeNull();
      expect(toCents(undefined)).toBeNull();
      expect(toCents('0.11')).toBeNull();
      expect(toCents(NaN)).toBeNull();
    });
  });

  it('mapea las 3 claves de variante tcgplayer a nuestro Finish', () => {
    expect(finishOfTcgplayerVariant('normal')).toBe('normal');
    expect(finishOfTcgplayerVariant('holofoil')).toBe('holofoil');
    expect(finishOfTcgplayerVariant('reverse-holofoil')).toBe('reverse_holo');
  });

  describe('Archaludon sv08.5-070 (Rare holo: holofoil + reverse-holofoil; cardmarket plano)', () => {
    const quotes = parseCardPricing(load('card-sv08.5-070.json').pricing);
    it('lee el marketPrice USD de holofoil = 11¢ ($0.11)', () => {
      const tp = quotes.find((q) => q.feed === 'tcgplayer' && q.finish === 'holofoil');
      expect(tp).toMatchObject({ amountCents: 11, currency: 'USD' });
    });
    it('lee el reverse-holofoil tcgplayer como finish reverse_holo (16¢)', () => {
      const r = quotes.find((q) => q.feed === 'tcgplayer' && q.finish === 'reverse_holo');
      expect(r).toMatchObject({ amountCents: 16, currency: 'USD' });
    });
    it('lee avg-holo EUR de cardmarket = 10¢ (€0.10) y lo mapea a holofoil', () => {
      const cm = quotes.find((q) => q.feed === 'cardmarket' && q.finish === 'holofoil');
      expect(cm).toMatchObject({ amountCents: 10, currency: 'EUR' });
    });
    it('lee avg EUR de cardmarket (base) = 5¢ y lo mapea a normal', () => {
      const cm = quotes.find((q) => q.feed === 'cardmarket' && q.finish === 'normal');
      expect(cm).toMatchObject({ amountCents: 5, currency: 'EUR' });
    });
    it('⚠️ cardmarket NO emite un reverse_holo (no distingue reverse) — §91', () => {
      expect(quotes.some((q) => q.feed === 'cardmarket' && q.finish === 'reverse_holo')).toBe(false);
    });
  });

  describe('Exeggcute sv08.5-001 (Common: normal + reverse-holofoil, SIN holofoil)', () => {
    const quotes = parseCardPricing(load('card-sv08.5-001.json').pricing);
    it('lee normal tcgplayer (5¢) y NO inventa holofoil', () => {
      expect(quotes.find((q) => q.feed === 'tcgplayer' && q.finish === 'normal')).toMatchObject({ amountCents: 5 });
      expect(quotes.some((q) => q.feed === 'tcgplayer' && q.finish === 'holofoil')).toBe(false);
    });
    it('lee reverse-holofoil tcgplayer (16¢) como reverse_holo', () => {
      expect(quotes.find((q) => q.feed === 'tcgplayer' && q.finish === 'reverse_holo')).toMatchObject({ amountCents: 16 });
    });
  });

  describe('Noctowl sv08.5-078 (holofoil 24¢)', () => {
    it('lee holofoil marketPrice = 24¢ ($0.24)', () => {
      const quotes = parseCardPricing(load('card-sv08.5-078.json').pricing);
      expect(quotes.find((q) => q.feed === 'tcgplayer' && q.finish === 'holofoil')).toMatchObject({ amountCents: 24 });
    });
  });

  describe('tolerancia', () => {
    it('pricing ausente ⇒ []', () => {
      expect(parseCardPricing(undefined)).toEqual([]);
      expect(parseCardPricing(null)).toEqual([]);
    });
    it('solo un sub-feed presente ⇒ solo ese', () => {
      const only = parseCardPricing({ tcgplayer: { unit: 'USD', updated: '2026-10-10T00:00:00Z', normal: { marketPrice: 0.5 } } });
      expect(only).toHaveLength(1);
      expect(only[0]).toMatchObject({ feed: 'tcgplayer', finish: 'normal', amountCents: 50 });
    });
  });

  // 🔒 CANDADO DE FORMA — el canario que MUERDE si TCGdex cambia la estructura.
  describe('🔒 candado de forma (criterio del arquitecto §4.PRE (e))', () => {
    it('LANZA si pricing no es objeto', () => {
      expect(() => parseCardPricing(42)).toThrow(TcgdexShapeError);
    });
    it('LANZA si tcgplayer.unit deja de ser USD (moneda cambió)', () => {
      expect(() => parseCardPricing({ tcgplayer: { unit: 'MXN', updated: 'x', normal: { marketPrice: 1 } } })).toThrow(TcgdexShapeError);
    });
    it('LANZA si cardmarket.unit deja de ser EUR', () => {
      expect(() => parseCardPricing({ cardmarket: { unit: 'USD', updated: 'x', avg: 1 } })).toThrow(TcgdexShapeError);
    });
    it('LANZA si tcgplayer deja de ser objeto (p. ej. pasa a array/escalar)', () => {
      expect(() => parseCardPricing({ tcgplayer: [1, 2, 3] })).toThrow(TcgdexShapeError);
    });
    it('LANZA si una variante presente deja de ser objeto', () => {
      expect(() => parseCardPricing({ tcgplayer: { unit: 'USD', updated: 'x', holofoil: 0.5 } })).toThrow(TcgdexShapeError);
    });
    it('LANZA si falta `updated` en un sub-feed presente', () => {
      expect(() => parseCardPricing({ tcgplayer: { unit: 'USD', normal: { marketPrice: 1 } } })).toThrow(TcgdexShapeError);
    });
  });
});
