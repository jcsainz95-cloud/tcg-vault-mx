import { describe, it, expect } from 'vitest';
import type { CatalogFilters } from '@/lib/api';
import {
  catalogFiltersKey,
  catalogPageHref,
  parseUrlFilters,
  serializeCatalogFilters,
} from './catalog-url';

/**
 * MK-D5 / R1 del techlead sobre `561ad425`: la URL es la ÚNICA fuente de los filtros del catálogo. Para que lo sea,
 * `parseUrlFilters` necesita su inversa exacta (filtros → query) y la vista necesita una clave de consulta que no
 * dependa del orden de los campos (antes `JSON.stringify` en `sameFilters`).
 */
const CASES: CatalogFilters[] = [
  {},
  { setId: 'base1' },
  { q: 'pika chu', setId: 'sv3', page: 2 },
  { productType: 'graded', finish: 'reverse_holo', rarity: ['Rare Holo', 'Common'], sort: 'price_asc', page: 7 },
  { productType: 'raw', condition: 'NM', minPriceCents: 1050, maxPriceCents: 250_000, sort: 'newest' },
];

describe('MK-D5 · serializeCatalogFilters es la inversa de parseUrlFilters', () => {
  it.each(CASES.map((f) => [JSON.stringify(f), f] as const))('ida y vuelta %s', (_, f) => {
    expect(parseUrlFilters(serializeCatalogFilters(f))).toEqual(f);
  });

  it('la página 1 no se escribe (una sola URL por página)', () => {
    expect(serializeCatalogFilters({ setId: 'a', page: 1 }).has('page')).toBe(false);
  });
});

describe('MK-D5 · catalogFiltersKey no depende del orden de campos', () => {
  it('mismos filtros en otro orden (y con campos undefined) ⇒ misma clave', () => {
    const a: CatalogFilters = { setId: 'base1', productType: 'graded', rarity: ['Rare', 'Common'] };
    const b: CatalogFilters = { page: undefined, rarity: ['Common', 'Rare'], productType: 'graded', setId: 'base1' };
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)); // lo que comparaba `sameFilters` antes
    expect(catalogFiltersKey(a)).toBe(catalogFiltersKey(b));
  });

  it('el orden por defecto explícito pide lo mismo que sin orden', () => {
    expect(catalogFiltersKey({ sort: 'newest' })).toBe(catalogFiltersKey({}));
  });

  it('filtros distintos ⇒ claves distintas', () => {
    expect(catalogFiltersKey({ setId: 'a' })).not.toBe(catalogFiltersKey({ setId: 'b' }));
    expect(catalogFiltersKey({ setId: 'a', page: 2 })).not.toBe(catalogFiltersKey({ setId: 'a' }));
    expect(catalogFiltersKey({ minPriceCents: 100 })).not.toBe(catalogFiltersKey({ maxPriceCents: 100 }));
  });
});

describe('MK-D5 · catalogPageHref sale de los filtros', () => {
  it('la flecha de página lleva los filtros del panel (Ctrl+clic / recarga conservan el filtro)', () => {
    expect(catalogPageHref({ setId: 'base1', finish: 'holofoil' }, 2)).toBe(
      '/catalog?setId=base1&finish=holofoil&page=2',
    );
    expect(catalogPageHref({ setId: 'base1', page: 3 }, 1)).toBe('/catalog?setId=base1');
    expect(catalogPageHref({}, 1)).toBe('/catalog');
  });

  it('conserva los parámetros que no son filtros (p. ej. utm) y reemplaza los de filtro viejos', () => {
    const sp = new URLSearchParams('utm_source=x&type=graded&page=4&setId=viejo');
    expect(catalogPageHref({ productType: 'graded', setId: 'nuevo' }, 2, sp)).toBe(
      '/catalog?utm_source=x&setId=nuevo&productType=graded&page=2',
    );
  });
});
