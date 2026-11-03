/**
 * IDS-F2 (API_CONTRACT §IDS.5 «Filtros» v1.116.2, criterio 521) — las opciones de versión salen de las FACETAS:
 * «Español» solo con `es ∈ facets.languages`; «Cartas de liga y promos» solo con `facets.stamped`. Sin conteos.
 * Un filtro ya activo en la URL sigue visible (y marcado) aunque la faceta no lo traiga: si no, no se podría quitar.
 * Un servidor anterior a §IDS (facetas sin `languages`/`stamped`) ⇒ el bloque no se pinta.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ShopFilters } from './ShopFilters';
import type { CatalogFacetsDTO } from '@/types/contract';
import type { CatalogFilters } from '@/lib/api';

const base: CatalogFacetsDTO = {
  rarities: ['Common'],
  sets: [],
  productTypes: ['raw'],
  sealedSubtypes: [],
  finishes: ['normal'],
  price: { minCents: 1000, maxCents: 500000, currency: 'MXN' },
};

function setup(facets: CatalogFacetsDTO, filters: CatalogFilters = {}) {
  const onChange = vi.fn();
  renderWithIntl(<ShopFilters facets={facets} filters={filters} onChange={onChange} />, 'es');
  return { onChange };
}
const chips = () => within(screen.getByTestId('version-filter')).getAllByRole('button').map((b) => b.textContent);

describe('IDS-F2 · filtros de versión por facetas', () => {
  it('`languages` [en, es] + `stamped` ⇒ Todos · Inglés · Español y «Cartas de liga y promos»; elegir manda la query', () => {
    const { onChange } = setup({ ...base, languages: ['en', 'es'], stamped: true });
    expect(chips()).toEqual(['Todos', 'Inglés', 'Español', 'Cartas de liga y promos']);
    fireEvent.click(screen.getByRole('button', { name: 'Español' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cartas de liga y promos' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stamped: true }));
  });

  it('solo inglés sin liga ⇒ el bloque no existe', () => {
    setup({ ...base, languages: ['en'], stamped: false });
    expect(screen.queryByTestId('version-filter')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Español' })).toBeNull();
  });

  it('`es` sin liga ⇒ idioma sí, «Cartas de liga y promos» no', () => {
    setup({ ...base, languages: ['en', 'es'], stamped: false });
    expect(chips()).toEqual(['Todos', 'Inglés', 'Español']);
  });

  it('liga sin `es` ⇒ «Cartas de liga y promos» sí, «Español» no', () => {
    setup({ ...base, languages: ['en'], stamped: true });
    expect(chips()).toEqual(['Cartas de liga y promos']);
  });

  it('un filtro activo en la URL que la faceta ya no trae sigue visible y marcado (para poder quitarlo)', () => {
    const { onChange } = setup({ ...base, languages: ['en'], stamped: false }, { language: 'es', stamped: true });
    const es = screen.getByRole('button', { name: 'Español' });
    expect(es).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Cartas de liga y promos' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(es);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: undefined }));
  });

  it('servidor anterior a §IDS (facetas sin `languages`/`stamped`) ⇒ sin bloque', () => {
    setup(base);
    expect(screen.queryByTestId('version-filter')).toBeNull();
  });
});
