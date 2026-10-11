import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PasteListView } from './PasteListView';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { DeckMetaPasteResponse, MetaDeckLineDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const available: MetaDeckLineDTO = {
  rawName: 'Dragapult ex',
  setCode: 'TWM',
  number: '130',
  quantity: 2,
  group: 'pokemon',
  matchStatus: 'matched',
  card: { cardId: 'c-1', name: 'Dragapult ex', imageUrl: 'https://img/x.png' },
  availableQty: 2,
  unitPriceMxnCents: 61500,
  unitInventoryItemIds: ['inv-1', 'inv-2'],
};

const pasteResult: DeckMetaPasteResponse = {
  groups: { pokemon: [available], trainer: [], energy: [] },
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('PasteListView · pegar lista (§13 POST /decks-meta/paste)', () => {
  it('estado inicial: vacío honesto, sin pedir todavía', () => {
    renderWithProviders(<PasteListView />, 'es');
    expect(screen.getByText('Pega una lista para empezar')).toBeInTheDocument();
  });

  it('al pegar y enviar, muestra la MISMA vista de disponibilidad («de jalón»)', async () => {
    const spy = vi.spyOn(api, 'pasteDeckList').mockResolvedValue(pasteResult);
    renderWithProviders(<PasteListView />, 'es');

    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: '2 Dragapult ex TWM 130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver disponibilidad' }));

    expect(await screen.findByText('Disponible')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith('2 Dragapult ex TWM 130');
    expect(screen.getByRole('button', { name: 'Agregar de jalón' })).toBeEnabled();
  });

  it('422 DECK_LIST_UNPARSEABLE (texto sin líneas válidas) muestra el error del contrato', async () => {
    vi.spyOn(api, 'pasteDeckList').mockRejectedValue(
      new ApiClientError(422, { code: 'DECK_LIST_UNPARSEABLE', message: 'unparseable' }),
    );
    renderWithProviders(<PasteListView />, 'es');

    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: 'basura' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver disponibilidad' }));

    expect(await screen.findByText(/No pudimos leer ninguna carta de tu lista/)).toBeInTheDocument();
  });

  it('«Limpiar» resetea la vista al estado inicial', async () => {
    vi.spyOn(api, 'pasteDeckList').mockResolvedValue(pasteResult);
    renderWithProviders(<PasteListView />, 'es');

    fireEvent.change(screen.getByLabelText('Tu lista'), { target: { value: '2 Dragapult ex TWM 130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver disponibilidad' }));
    await screen.findByText('Disponible');

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    await waitFor(() => expect(screen.getByText('Pega una lista para empezar')).toBeInTheDocument());
    expect(screen.getByLabelText('Tu lista')).toHaveValue('');
  });
});
