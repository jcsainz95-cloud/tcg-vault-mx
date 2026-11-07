import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, renderWithIntl } from '@/test/render';
import * as promos from '@/lib/api/tcgcsv-promos';
import { PriceTag } from '@/components/ui/PriceTag';
import { TcgcsvPromosSection, promoImportVerdict } from './TcgcsvPromosSection';

vi.mock('@/lib/api/tcgcsv-promos', async (orig) => {
  const real = await orig<typeof import('@/lib/api/tcgcsv-promos')>();
  return { ...real, getTcgcsvGroups: vi.fn(), importTcgcsvSet: vi.fn() };
});

const GROUPS: promos.TcgcsvGroupDTO[] = [
  { groupId: 24451, name: 'ME: Mega Evolution Promo', publishedOn: null, imported: false, cardCount: 148 },
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

describe('PROMO-F1 · importar un grupo de promos TCGCSV', () => {
  it('lista el grupo, importa por groupId y muestra resumen, sin precio y omitidos con motivo', async () => {
    renderWithProviders(<TcgcsvPromosSection />);
    fireEvent.click(await screen.findByRole('button', { name: /Importar ME: Mega Evolution Promo/ }));
    await waitFor(() => expect(promos.importTcgcsvSet).toHaveBeenCalledWith(24451));
    expect((await screen.findByTestId('promo-summary')).textContent).toMatch(/130 cartas creadas.*6 versiones con sello/);
    expect(screen.getByTestId('promo-nopricing').textContent).toMatch(/10 cartas sin precio.*precio pendiente/);
    const skipped = screen.getByTestId('promo-skipped');
    expect(skipped.textContent).toMatch(/Paradise Resort 092 \[Staff\]/);
    expect(skipped.textContent).toMatch(/más de una carta base/);
    expect(skipped.textContent).toMatch(/ya existe en pokemontcg\.io/);
    expect(skipped.textContent).toMatch(/motivo_nuevo/); // desconocido ⇒ crudo
  });

  it('con omitidas el veredicto NO es verde (parcial); sin omitidas y con escritura sí', () => {
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
