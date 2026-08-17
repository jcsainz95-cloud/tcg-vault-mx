import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';
import type { CardDTO, ShipmentDTO } from '@/types/contract';

// useSearchParams: sin ?item= (selección arranca vacía).
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

// Link de i18n (deep-link al detalle del retiro) → <a> simple en el test.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

/**
 * F6 · Disputas del cliente: "Abrir disputa" aparece SOLO en ítems elegibles de un envío
 * ENTREGADO (raw/sellado, dentro de la ventana de 7 días, sin disputa activa). El graded y el
 * envío fuera de plazo no ofrecen el botón (UI-gate; el backend sigue siendo la autoridad).
 */
describe('ShipmentsView · disputas (F6)', () => {
  function card(id: string, name: string): CardDTO {
    return {
      id,
      externalId: `ext-${id}`,
      name,
      number: '1',
      rarity: 'Rare',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'base1',
      setName: 'Base Set',
      imageSmallUrl: `https://images.pokemontcg.io/base1/1.png`,
      imageLargeUrl: `https://images.pokemontcg.io/base1/1_hires.png`,
      availableFinishes: ['normal'],
    };
  }

  const deliveredRecent = (): ShipmentDTO => ({
    id: 'shp-del',
    status: 'entregado',
    carrier: 'Estafeta',
    trackingNumber: '999',
    createdAt: '2026-08-10T10:00:00Z',
    deliveredAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    items: [
      { inventoryItemId: 'inv-raw', folio: 'INV-RAW', card: card('c-raw', 'Bulbasaur'), productType: 'raw' },
      { inventoryItemId: 'inv-grd', folio: 'INV-GRD', card: card('c-grd', 'Mewtwo'), productType: 'graded' },
    ],
  });

  it('"Abrir disputa" aparece solo en el ítem raw elegible, no en el graded', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([deliveredRecent()]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<ShipmentsView />, 'es');

    await screen.findByText('Bulbasaur');
    expect(screen.getByText('Mewtwo')).toBeInTheDocument();
    // Solo el ítem raw ofrece el botón (el modal aún no está abierto → 1 instancia).
    expect(screen.getAllByRole('button', { name: 'Abrir disputa' })).toHaveLength(1);
  });

  it('fuera de la ventana de 7 días NO ofrece "Abrir disputa"', async () => {
    const old = deliveredRecent();
    old.deliveredAt = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    vi.spyOn(api, 'getShipments').mockResolvedValue([old]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<ShipmentsView />, 'es');

    await screen.findByText('Bulbasaur');
    expect(screen.queryByRole('button', { name: 'Abrir disputa' })).not.toBeInTheDocument();
  });

  it('abrir el modal, describir y enviar → createDispute + contacto de evidencia', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([deliveredRecent()]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    const spy = vi.spyOn(api, 'createDispute').mockResolvedValue({
      disputeId: 'dsp-new-1',
      status: 'abierta',
      type: 'condition_raw',
      deadlineAt: '2026-08-24T00:00:00Z',
      evidenceContact: 'soporte@tcgvaultmx.com',
    });
    renderWithProviders(<ShipmentsView />, 'es');

    await screen.findByText('Bulbasaur');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir disputa' }));

    const dialog = await screen.findByRole('dialog', { name: 'Abrir disputa de condición' });
    fireEvent.change(within(dialog).getByLabelText('Describe el problema'), {
      target: { value: 'Corner wear on arrival, reported same day.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abrir disputa' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        inventoryItemId: 'inv-raw',
        description: 'Corner wear on arrival, reported same day.',
      }),
    );
    // Tras el 201 se muestra el contacto de soporte (evidenceContact) para enviar la evidencia.
    expect(await within(dialog).findByTestId('evidence-email')).toHaveTextContent(
      'soporte@tcgvaultmx.com',
    );
  });
});
