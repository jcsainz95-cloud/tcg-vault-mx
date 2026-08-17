import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M1View } from './M1View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { CardDTO, Paginated } from '@/types/contract';

beforeEach(() => {
  vi.restoreAllMocks();
});

function fakeCard(i: number): CardDTO {
  return {
    id: `c-fake-${i}`,
    externalId: `c-fake-${i}`,
    name: `Fake Card ${i}`,
    number: String(i),
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: `https://img.example/${i}.png`,
    imageLargeUrl: `https://img.example/${i}_hires.png`,
    availableFinishes: ['normal'],
  };
}

function page(cards: CardDTO[], pageNum: number, total: number): Paginated<CardDTO> {
  return { data: cards, page: pageNum, pageSize: 20, total };
}

async function openModalAndSearch(term: string) {
  fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
  fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: term } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
  return dialog;
}

describe('M1View · Buscador / picker del catálogo', () => {
  it('los resultados muestran miniatura, #número, rareza y acabados disponibles', async () => {
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Charizard');

    const option = await within(dialog).findByRole('option', { name: /Charizard/ });
    // #número + rareza (CardDTO ya los trae) + badges de acabados (v1.6-finish).
    expect(within(option).getByText('#4')).toBeInTheDocument();
    expect(within(option).getByText('Rare Holo')).toBeInTheDocument();
    expect(within(option).getByText('Holofoil')).toBeInTheDocument();
    expect(within(option).getByText('Reverse Holo')).toBeInTheDocument();
  });

  it('pagina con "Cargar más": pide page=2 y acumula resultados (raíz de "veo pocas cartas")', async () => {
    const spy = vi
      .spyOn(api, 'searchBuylistCards')
      .mockImplementation(async (filters) =>
        (filters?.page ?? 1) === 1
          ? page(Array.from({ length: 20 }, (_, i) => fakeCard(i + 1)), 1, 25)
          : page(Array.from({ length: 5 }, (_, i) => fakeCard(i + 21)), 2, 25),
      );
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Fake');

    expect(await within(dialog).findByText('20 de 25 cartas')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Fake', page: 1, pageSize: 20 }),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cargar más' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'Fake', page: 2, pageSize: 20 })),
    );
    expect(await within(dialog).findByText('25 de 25 cartas')).toBeInTheDocument();
    // Con todo cargado, el botón desaparece.
    expect(within(dialog).queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('una carta raw con UN solo acabado lo muestra fijo (no lo oculta en silencio)', async () => {
    renderWithProviders(<M1View />, 'es');
    // c-latias-sir solo existe en holofoil.
    const dialog = await openModalAndSearch('Latias');
    fireEvent.click(await within(dialog).findByRole('option', { name: /Latias/ }));

    expect(
      await within(dialog).findByText('Acabado: Holofoil (único disponible para esta carta).'),
    ).toBeInTheDocument();
  });

  it('P-4: el alta usa el folio devuelto para confirmar el éxito', async () => {
    vi.spyOn(api, 'createInventoryItem').mockResolvedValue({
      id: 'inv-new-1',
      folio: 'INV-000777',
      status: 'in_stock',
      acquisitionCostCents: 0,
    });
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Pikachu');
    fireEvent.click((await within(dialog).findAllByRole('option', { name: /Pikachu/ }))[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));

    expect(
      await screen.findByText('Item creado en bóveda · folio INV-000777.'),
    ).toBeInTheDocument();
  });

  it('P-4: un error del alta muestra el mensaje real del contrato (PRICE_PENDING)', async () => {
    vi.spyOn(api, 'createInventoryItem').mockRejectedValue(
      new ApiClientError(422, { code: 'PRICE_PENDING', message: 'price pending' }),
    );
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Pikachu');
    fireEvent.click((await within(dialog).findAllByRole('option', { name: /Pikachu/ }))[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));

    expect(
      await within(dialog).findByText('Esta carta tiene precio pendiente y aún no se puede comprar.'),
    ).toBeInTheDocument();
  });
});
