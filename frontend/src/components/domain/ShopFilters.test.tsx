import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ShopFilters } from './ShopFilters';
import type { CatalogFacetsDTO } from '@/types/contract';
import type { CatalogFilters } from '@/lib/api';

const facets: CatalogFacetsDTO = {
  rarities: ['Common', 'Illustration Rare', 'Ultra Rare', 'Special Illustration Rare'],
  sets: [
    { id: 'sv08', name: 'Surging Sparks', releaseDate: '2024/11/08', year: 2024 },
    { id: 'base1', name: 'Base Set', releaseDate: '1999/01/09', year: 1999 },
  ],
  productTypes: ['raw', 'graded', 'sealed'],
  sealedSubtypes: ['box', 'etb'],
  finishes: ['normal', 'reverse_holo', 'holofoil'],
  price: { minCents: 1000, maxCents: 500000, currency: 'MXN' },
};

function setup(filters: CatalogFilters = {}) {
  const onChange = vi.fn();
  renderWithIntl(<ShopFilters facets={facets} filters={filters} onChange={onChange} />, 'es');
  return { onChange };
}

describe('ShopFilters (§7.16)', () => {
  it('rareza multi-select: al marcar una rareza manda la rareza CRUDA en un arreglo', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByText('Illustration Rare'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rarity: ['Illustration Rare'] }));
  });

  it('rareza: el buscador filtra por texto de la etiqueta', () => {
    setup();
    const search = screen.getByLabelText('Buscar rareza…');
    fireEvent.change(search, { target: { value: 'ultra' } });
    expect(screen.getByText('Ultra Rare')).toBeInTheDocument();
    expect(screen.queryByText('Common')).not.toBeInTheDocument();
  });

  it('rareza: agrupa bajo encabezados de familia (presentación del front)', () => {
    setup();
    expect(screen.getByText('Comunes / estándar')).toBeInTheDocument();
    expect(screen.getByText('Ilustración / Arte')).toBeInTheDocument();
  });

  it('set con año: la opción muestra "Nombre (2024)" y manda el setId', () => {
    const { onChange } = setup();
    const option = screen.getByRole('option', { name: /Surging Sparks/ });
    expect(within(option).getByText('(2024)')).toBeInTheDocument();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ setId: 'sv08' }));
  });

  it('tipo sellado: muestra el sub-filtro de subtipo alimentado por facets', () => {
    setup({ productType: 'sealed' });
    expect(screen.getByLabelText('Subtipo de sellado')).toBeInTheDocument();
  });

  it('tipo raw: expone el sublabel de condición NM (único valor)', () => {
    setup({ productType: 'raw' });
    expect(screen.getByText('Casi nueva (NM)')).toBeInTheDocument();
  });

  it('precio: escribe el mínimo y lo envía en centavos', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('Mínimo'), { target: { value: '100' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minPriceCents: 10000 }));
  });

  it('acabado (v1.6-finish): chips alimentados por facets.finishes; al elegir manda el finish', () => {
    const { onChange } = setup();
    // El chip usa la etiqueta localizada del acabado (Reverse Holo).
    fireEvent.click(screen.getByRole('button', { name: 'Reverse Holo' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ finish: 'reverse_holo' }));
  });
});
