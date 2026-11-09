import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, renderWithIntl } from '@/test/render';
import * as promos from '@/lib/api/tcgcsv-promos';
import { PriceTag } from '@/components/ui/PriceTag';
import { TcgcsvPromosSection, promoImportVerdict } from './TcgcsvPromosSection';

vi.mock('@/lib/api/tcgcsv-promos', async (orig) => {
  const real = await orig<typeof import('@/lib/api/tcgcsv-promos')>();
  return { ...real, getTcgcsvGroups: vi.fn(), importTcgcsvSet: vi.fn() };
});

const GROUPS: promos.TcgcsvGroupDTO[] = [
  { groupId: 24451, name: 'ME: Mega Evolution Promo', publishedOn: null, imported: false, cardCount: 0, productCount: 148 },
  { groupId: 24500, name: 'Trick or Trade 2025', publishedOn: null, imported: false, cardCount: 0, productCount: null },
];
const RESULT: promos.TcgcsvImportResult = {
  setId: 's1',
  created: 130,
  updated: 0,
  stamped: 6,
  noPrice: 10,
  skipped: [{ productId: 7, name: 'Paradise Resort 092 [Staff]', reason: 'ambiguous_base' }, { productId: 8, name: 'Foo 001', reason: 'card_exists_in_pokemontcg' }, { productId: 9, name: 'Bar 002', reason: 'motivo_nuevo' }],
};

beforeEach(() => {
  vi.mocked(promos.getTcgcsvGroups).mockResolvedValue(GROUPS);
  vi.mocked(promos.importTcgcsvSet).mockResolvedValue(RESULT);
});

describe('PMS-F2 · solo lectura', () => {
  it('lista los grupos (productCount y cardCount por separado; null ⇒ «—») y NO ofrece importar', async () => {
    renderWithProviders(<TcgcsvPromosSection />);
    await screen.findByText('ME: Mega Evolution Promo');
    expect(screen.getByText(/Grupo 24451 · 148 productos en la fuente \(varios son versiones de una misma carta\) · 0 cartas importadas/)).toBeInTheDocument();
    expect(screen.getByText(/Grupo 24500 · — productos en la fuente/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(promos.importTcgcsvSet).not.toHaveBeenCalled();
  });

  it('el veredicto de un resultado con omitidas NO es verde; sin omitidas y con escritura sí', () => {
    expect(promoImportVerdict(RESULT)).toBe('partial');
    expect(promoImportVerdict({ ...RESULT, skipped: [] })).toBe('done');
    expect(promoImportVerdict({ ...RESULT, created: 0, updated: 0, skipped: [] })).not.toBe('done');
  });
});

describe('PROMO-F2 · carta sin precio', () => {
  it('muestra «Precio pendiente» y nunca $0', () => {
    const { container } = renderWithIntl(<PriceTag reference={{ status: 'pending' }} />);
    expect(screen.getByText('Precio pendiente')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$\s?0(\D|$)/);
  });
});
