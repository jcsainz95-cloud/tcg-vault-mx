import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistKycForm } from './BuylistKycForm';
import * as api from '@/lib/api';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-ine');
  vi.restoreAllMocks();
});

const RAW_ITEMS = [{ cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const }];

describe('BuylistKycForm — cableado KYC/INE del buylist (contrato §6/§8)', () => {
  it('renderiza CLABE, los dos slots de INE (anverso/reverso) y el aviso de privacidad', () => {
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    expect(screen.getByLabelText(/CLABE/)).toBeInTheDocument();
    expect(screen.getByText('INE (anverso)')).toBeInTheDocument();
    expect(screen.getByText('INE (reverso)')).toBeInTheDocument();
    expect(screen.getByText(/se guarda cifrado/)).toBeInTheDocument();
  });

  it('valida la CLABE en cliente (18 dígitos) y no llama al backend si es inválida', () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    expect(screen.getByText('La CLABE debe tener 18 dígitos.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('con CLABE válida crea la solicitud con TODOS los items del carrito y reporta el id', async () => {
    const onCreated = vi.fn();
    const spy = vi.spyOn(api, 'createSellRequest');
    // Carrito expandido por cantidad: 2 Charizard + 1 Pikachu.
    const items = [
      { cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const },
      { cardId: 'c-charizard', productType: 'raw' as const, rawCondition: 'NM' as const },
      { cardId: 'c-pikachu', productType: 'raw' as const, rawCondition: 'NM' as const },
    ];
    renderWithProviders(<BuylistKycForm items={items} onCreated={onCreated} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // El payload lleva los 3 items (sin precio/categoría; solo cardId/productType/rawCondition).
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ clabe: '002010077777777771', items }),
    );
  });

  it('mapea 422 INE_REQUIRED a la petición de subir el INE', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'createSellRequest').mockRejectedValueOnce(
      new ApiClientError(422, { code: 'INE_REQUIRED', message: 'INE required' }),
    );
    renderWithProviders(<BuylistKycForm items={RAW_ITEMS} onCreated={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() =>
      expect(screen.getAllByText(/sube tu INE/).length).toBeGreaterThan(0),
    );
  });
});
