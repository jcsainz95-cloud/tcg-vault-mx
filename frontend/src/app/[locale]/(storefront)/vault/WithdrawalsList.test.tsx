import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { CardDTO, ShipmentDTO } from '@/types/contract';
import { WithdrawalsList, addressSummary } from './WithdrawalsList';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

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

/**
 * §33.4 — la lista de retiros (+ disputas) EXTRAÍDA de /shipments a la pestaña «Retiros» de la
 * bóveda, sin cambio funcional. CTA «Solicitar retiro» arriba y en el vacío.
 */
describe('WithdrawalsList · retiros del cliente (§33.4)', () => {
  it('lista los retiros del fixture con el CTA «Solicitar retiro» → /shipments', async () => {
    renderWithProviders(<WithdrawalsList />, 'es');
    expect(await screen.findByRole('link', { name: 'shp-7001' })).toHaveAttribute('href', '/shipments/shp-7001');
    expect(screen.getByRole('heading', { name: 'Mis retiros' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mis disputas' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Solicitar retiro' })[0]).toHaveAttribute('href', '/shipments');
  });

  it('vacío: «Aún no tienes retiros.» + el mismo CTA', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<WithdrawalsList />, 'es');
    expect(await screen.findByText('Aún no tienes retiros.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Solicitar retiro' }).length).toBe(2);
  });

  it('§33.10c: el resumen de dirección antepone el destinatario; un snapshot viejo sin nombre, solo ciudad y estado', async () => {
    expect(
      addressSummary({ recipientName: 'Misty Waterflower', city: 'Guadalajara', state: 'JAL' }),
    ).toBe('Misty Waterflower · Guadalajara, JAL');
    expect(addressSummary({ city: 'Guadalajara', state: 'JAL' })).toBe('Guadalajara, JAL');
    expect(addressSummary({ recipientName: '  ', city: 'Guadalajara', state: 'JAL' })).toBe('Guadalajara, JAL');
    expect(addressSummary(undefined)).toBe('');

    const s = deliveredRecent();
    s.addressSnapshot = { recipientName: 'Misty Waterflower', city: 'Guadalajara', state: 'JAL' };
    vi.spyOn(api, 'getShipments').mockResolvedValue([s]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<WithdrawalsList />, 'es');
    expect(await screen.findByText('Misty Waterflower · Guadalajara, JAL')).toBeInTheDocument();
  });
});

/**
 * F6 · Disputas del cliente: "Abrir disputa" aparece SOLO en ítems elegibles de un envío
 * ENTREGADO (raw/sellado, dentro de la ventana de 7 días, sin disputa activa). El graded y el
 * envío fuera de plazo no ofrecen el botón (UI-gate; el backend sigue siendo la autoridad).
 * (Movidos tal cual desde `ShipmentsView.test.tsx`.)
 */
describe('WithdrawalsList · disputas (F6)', () => {
  it('"Abrir disputa" aparece solo en el ítem raw elegible, no en el graded', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([deliveredRecent()]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<WithdrawalsList />, 'es');

    await screen.findByText('Bulbasaur');
    expect(screen.getByText('Mewtwo')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Abrir disputa' })).toHaveLength(1);
  });

  it('fuera de la ventana de 7 días NO ofrece "Abrir disputa"', async () => {
    const old = deliveredRecent();
    old.deliveredAt = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    vi.spyOn(api, 'getShipments').mockResolvedValue([old]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<WithdrawalsList />, 'es');

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
      evidenceContact: 'evidencias@ejemplo.test',
    });
    renderWithProviders(<WithdrawalsList />, 'es');

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
    expect(await within(dialog).findByTestId('evidence-email')).toHaveTextContent(
      'evidencias@ejemplo.test',
    );
  });
});
