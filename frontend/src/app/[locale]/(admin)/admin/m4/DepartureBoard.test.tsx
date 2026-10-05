import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { DepartureBoardDTO } from '@/types/contract';
import { DepartureBoard } from './DepartureBoard';
import { parseM4Tab } from './tabs';

/** «Salida de hoy» (`DESIGN_SYSTEM §43.9` · contrato `§M4-SHIP.19.9`). */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const BOARD: DepartureBoardDTO = {
  date: '2026-10-04',
  groups: [
    {
      carrierName: 'ninetynineminutes',
      carrierLabel: '99minutos',
      dropoff: { name: 'Punto99 · Periférico Sur 4249', address: 'Av. Periférico Sur 4249, 14210 CDMX' },
      isPreferred: true,
      shipments: [
        { shipmentId: 's1', orderNumber: 'TCG-1', kind: 'guest_direct_ship', recipientName: 'Ana', city: 'Guadalajara', trackingNumber: 'G1', labelAvailable: true, labelPurchasedAt: '2026-10-04T10:00:00Z' },
        { shipmentId: 's2', orderNumber: null, kind: 'vault_withdrawal', recipientName: 'Beto', city: 'León', trackingNumber: 'G2', labelAvailable: false, labelPurchasedAt: '2026-10-04T11:00:00Z' },
      ],
    },
    { carrierName: 'fedex', carrierLabel: 'FedEx', dropoff: null, isPreferred: false, shipments: [{ shipmentId: 's3', orderNumber: 'TCG-3', kind: 'guest_direct_ship', recipientName: 'Caro', city: 'Monterrey', trackingNumber: 'G3', labelAvailable: true, labelPurchasedAt: '2026-10-04T12:00:00Z' }] },
  ],
  manualPending: 2,
};

beforeEach(() => vi.restoreAllMocks());

describe('«Salida de hoy»', () => {
  it('`?tab=salida` es una pestaña válida', () => {
    expect(parseM4Tab('salida')).toBe('salida');
  });
  it('grupos del servidor, preferida, sin sucursal, sin precios; «Ya los dejé» confirma y reporta por partes', async () => {
    vi.spyOn(api, 'getDepartureBoard').mockResolvedValue(BOARD);
    const dep = vi.spyOn(api, 'markShipmentsDeparted').mockResolvedValue({
      results: [
        { shipmentId: 's1', outcome: 'shipped' },
        { shipmentId: 's2', outcome: 'rejected', code: 'ORDER_NOT_SETTLED' },
      ],
    });
    renderWithProviders(<DepartureBoard />, 'es');
    const g = await screen.findByTestId('departure-group-ninetynineminutes');
    expect(within(g).getByText('99minutos · Punto99 · Periférico Sur 4249')).toBeInTheDocument();
    expect(within(g).getByText('Preferida')).toBeInTheDocument();
    expect(screen.getByText('FedEx · sin sucursal configurada')).toBeInTheDocument();
    expect(screen.getByTestId('departure-board').textContent).not.toMatch(/MX\$/);
    expect(screen.getByText(/2 envíos con guía a mano por salir/)).toBeInTheDocument();
    // Solo la de etiqueta disponible ofrece «Imprimir etiqueta».
    expect(within(screen.getByTestId('departure-row-s2')).queryByRole('button', { name: 'Imprimir etiqueta' })).not.toBeInTheDocument();
    fireEvent.click(within(g).getByRole('checkbox', { name: 'Seleccionar los de 99minutos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ya los dejé en la sucursal (2)' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Marcar 2 paquetes como enviados?' });
    expect(dep).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar enviados' }));
    await waitFor(() => expect(dep).toHaveBeenCalledWith(['s1', 's2']));
    expect(await screen.findByText('1 marcados como enviados · 1 no se movieron.')).toBeInTheDocument();
  });
  it('vacío ⇒ «Nada por salir…»', async () => {
    vi.spyOn(api, 'getDepartureBoard').mockResolvedValue({ date: '2026-10-04', groups: [], manualPending: 0 });
    renderWithProviders(<DepartureBoard />, 'es');
    expect(await screen.findByText('Nada por salir: no hay guías de Skydropx esperando.')).toBeInTheDocument();
  });
});
