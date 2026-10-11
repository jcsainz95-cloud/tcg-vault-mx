import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * §BMK — BMK-F8 (criterio 858) y BMK-UX-5 (DESIGN_SYSTEM §BMK.8/§BMK.11): las 11 claves nuevas existen en
 * es y en; cada `*AriaMarket` contiene literalmente `sellPrice.market` y `sellPrice.wePay` del mismo
 * idioma, y cada `*AriaPay` el de `wePay`. BMK-F7 (criterio 855): ninguna contiene porcentajes,
 * proporciones ni «ahorro».
 */
type Catalog = Record<string, unknown>;

function get(cat: Catalog, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Catalog)[k] : undefined), cat);
}

const NEW_KEYS = [
  'buylist.sellPrice.market',
  'buylist.sellPrice.wePay',
  'buylist.sellPrice.marketEach',
  'buylist.sellPrice.wePayEach',
  'masterSet.quoterAddAriaMarket',
  'masterSet.quoterAddAriaPay',
  'masterSet.separateProductAddAriaMarket',
  'masterSet.separateProductAddAriaPay',
  'masterSet.separateProductAriaMarket',
  'masterSet.separateProductAriaPay',
  'masterSet.quoterPriceNote',
] as const;

const EXPECTED: Record<'es' | 'en', Record<string, string>> = {
  es: {
    'buylist.sellPrice.market': 'Valor de mercado',
    'buylist.sellPrice.wePay': 'Te pagamos',
    'buylist.sellPrice.marketEach': 'Valor de mercado c/u',
    'buylist.sellPrice.wePayEach': 'Te pagamos c/u',
  },
  en: {
    'buylist.sellPrice.market': 'Market value',
    'buylist.sellPrice.wePay': 'We pay you',
    'buylist.sellPrice.marketEach': 'Market value per card',
    'buylist.sellPrice.wePayEach': 'We pay you per card',
  },
};

describe.each([
  ['es', es as Catalog],
  ['en', en as Catalog],
] as const)('§BMK · claves %s', (locale, cat) => {
  it('las 11 claves nuevas existen y son texto', () => {
    for (const k of NEW_KEYS) expect(typeof get(cat, k), k).toBe('string');
  });

  it('rótulos con el texto de DESIGN_SYSTEM §BMK.8', () => {
    for (const [k, v] of Object.entries(EXPECTED[locale])) expect(get(cat, k), k).toBe(v);
  });

  it('BMK-UX-5: cada *AriaMarket lleva market y wePay; cada *AriaPay lleva wePay y no market', () => {
    const market = get(cat, 'buylist.sellPrice.market') as string;
    const wePay = get(cat, 'buylist.sellPrice.wePay') as string;
    for (const k of NEW_KEYS.filter((x) => x.endsWith('AriaMarket'))) {
      const v = get(cat, k) as string;
      expect(v, k).toContain(`${market} {market}`);
      expect(v, k).toContain(`${wePay} {price}`);
    }
    for (const k of NEW_KEYS.filter((x) => x.endsWith('AriaPay'))) {
      const v = get(cat, k) as string;
      expect(v, k).toContain(`${wePay} {price}`);
      expect(v, k).not.toContain(market);
      expect(v, k).not.toContain('{market}');
    }
  });

  it('BMK-F7: ninguna clave nueva lleva porcentaje, proporción ni «ahorro»', () => {
    for (const k of NEW_KEYS) expect(get(cat, k) as string, k).not.toMatch(/%|mitad|half|ahorr|save/i);
  });
});
