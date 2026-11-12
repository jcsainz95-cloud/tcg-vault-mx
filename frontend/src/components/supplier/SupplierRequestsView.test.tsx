import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { SupplierRequestsView } from './SupplierRequestsView';
import * as api from '@/lib/api/suppliers';

const card = { cardId: 'c1', name: 'Erika Victreebel', nameEs: null, number: '6', setId: 's', setName: 'Ascended Heroes', imageUrl: null, rarity: null, finish: 'holofoil' as const };

describe('§PROV F1 · portal: lo que buscamos', () => {
  it('pinta el precio en pesos, la caducidad y el envío de la oferta sin precio propio (F3 no existe)', async () => {
    vi.spyOn(api, 'listSupplierRequests').mockResolvedValue({
      data: [{ id: 'r1', card, minCondition: 'NM', qtyOpen: 3, unitCents: 12000, expiresAt: '2099-01-01T00:00:00Z', myOfferStatus: null }],
      page: 1, pageSize: 20, total: 1,
    });
    const create = vi.spyOn(api, 'createSupplierOffer').mockResolvedValue({} as never);
    renderWithProviders(<SupplierRequestsView />);
    expect(await screen.findByText(/120\.00/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/mercado|market|margen|%/i);
    await userEvent.click(screen.getByRole('button', { name: /la tengo/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar oferta/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('r1', { qty: 1, condition: 'NM' }));
  });
});
