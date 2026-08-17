import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';

// useSearchParams: sin ?item= (selección arranca vacía).
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

// Módulo de API real (rama mock) salvo createShipment, que controlamos para el caso 403.
// vi.hoisted: la fábrica de vi.mock se iza al top, así que el mock debe crearse con hoisted.
const { createShipmentMock } = vi.hoisted(() => ({ createShipmentMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, createShipment: createShipmentMock };
});

import { ShipmentsView } from './ShipmentsView';

beforeEach(() => {
  createShipmentMock.mockReset();
});

describe('ShipmentsView · estado del botón de retiro (WS-F · F3)', () => {
  it('el botón se habilita solo con dirección (auto-default MX) + al menos un ítem', async () => {
    renderWithProviders(<ShipmentsView />, 'es');

    // Espera a que carguen holdings (checkbox de una carta settled) y la dirección default.
    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Av\. Reforma 222/);

    const button = screen.getByRole('button', { name: 'Pagar envío y solicitar' });
    // Con dirección auto-seleccionada pero sin ítems → deshabilitado.
    expect(button).toBeDisabled();

    // Selecciona la carta settled → habilitado.
    const row = blastoise.closest('label')!;
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('un 403 EMAIL_NOT_VERIFIED muestra el banner de verificación (no un error genérico)', async () => {
    createShipmentMock.mockRejectedValue(
      new ApiClientError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'verify email' }),
    );
    renderWithProviders(<ShipmentsView />, 'es');

    const blastoise = await screen.findByText('Blastoise');
    await screen.findByText(/Av\. Reforma 222/);
    const checkbox = blastoise.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    const button = screen.getByRole('button', { name: 'Pagar envío y solicitar' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    // El banner de verificación (verifyEmail.blockedTitle) aparece; createShipment fue llamado.
    await screen.findByText('Verifica tu correo para completar esta acción');
    expect(createShipmentMock).toHaveBeenCalledWith(['inv-1002'], 'addr-1');
  });
});
