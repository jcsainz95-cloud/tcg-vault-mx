import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedRestockForm } from './SealedRestockForm';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

function fillEmail(value = 'yo@ejemplo.com') {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value } });
}

describe('SealedRestockForm · flag ENCENDIDO (suscripción acepta)', () => {
  it('el CTA queda deshabilitado hasta que el correo es válido', async () => {
    renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');

    expect(await screen.findByText('Avísame cuando vuelva')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avisarme' })).toBeDisabled();
    fillEmail();
    expect(screen.getByRole('button', { name: 'Avisarme' })).toBeEnabled();
  });

  it('al suscribir con éxito muestra la confirmación neutra', async () => {
    vi.spyOn(api, 'subscribeSealedRestock').mockResolvedValue({ subscribed: true });
    renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');

    fillEmail();
    fireEvent.click(await screen.findByRole('button', { name: 'Avisarme' }));

    expect(await screen.findByText('Listo. Si se agota y vuelve, te escribimos una sola vez.')).toBeInTheDocument();
  });

  it('errata v1.87.3 (B-1): el cuerpo es EXACTAMENTE { email, inventoryItemId } — sin cardId/subtipo/condición', async () => {
    const sub = vi.spyOn(api, 'subscribeSealedRestock').mockResolvedValue({ subscribed: true });
    renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');

    fillEmail('  yo@ejemplo.com ');
    fireEvent.click(await screen.findByRole('button', { name: 'Avisarme' }));

    await waitFor(() => expect(sub).toHaveBeenCalledTimes(1));
    expect(sub.mock.calls[0][0]).toEqual({ email: 'yo@ejemplo.com', inventoryItemId: 'inv-1' });
    expect(Object.keys(sub.mock.calls[0][0]).sort()).toEqual(['email', 'inventoryItemId']);
  });
});

describe('SealedRestockForm · flag APAGADO (404 FEATURE_DISABLED)', () => {
  it('si el endpoint responde 404 FEATURE_DISABLED el componente se oculta limpio', async () => {
    vi.spyOn(api, 'subscribeSealedRestock').mockRejectedValue(
      new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'off' }),
    );
    renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');

    fillEmail();
    fireEvent.click(await screen.findByRole('button', { name: 'Avisarme' }));

    await waitFor(() => expect(screen.queryByText('Avísame cuando vuelva')).toBeNull());
  });

  it('un error genérico (no 404) mantiene el formulario y avisa del fallo', async () => {
    vi.spyOn(api, 'subscribeSealedRestock').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');

    fillEmail();
    fireEvent.click(await screen.findByRole('button', { name: 'Avisarme' }));

    // El formulario sigue presente (no se oculta) y muestra el error genérico.
    expect(await screen.findByText('No se pudo cargar la información.')).toBeInTheDocument();
    expect(screen.getByText('Avísame cuando vuelva')).toBeInTheDocument();
  });
});
