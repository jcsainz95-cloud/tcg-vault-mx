import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockInventory, mockLocations } from '@/lib/mock/fixtures';
import type { AdminInventoryItemDetailDTO, InventoryStatus } from '@/types/contract';
import { ItemDetailModal } from './ItemDetailModal';

beforeEach(() => {
  vi.restoreAllMocks();
});

function detail(status: InventoryStatus): AdminInventoryItemDetailDTO {
  return {
    ...mockInventory[0],
    status,
    // En `loc-1` (stock de plataforma) ⇒ el destino posible en stock es `loc-2`.
    location: { id: 'loc-1', label: 'C03-F02-S15', zone: 'platform_stock' },
    movements: [],
  };
}

/**
 * **Hueco 1 (auditoría del operador, 2026-09-29).** Una carta vendida en preparación (`picking`) tiene
 * que poder ubicarse/corregirse desde el detalle de M1. SOLO «Mover de ubicación»: la merma no.
 */
describe('ItemDetailModal · hueco 1: mover una pieza en `picking`', () => {
  it('en `picking` ofrece «Mover de ubicación» (solo stock de plataforma) y NO la merma ni publicar', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('picking'));
    const moveSpy = vi.spyOn(api, 'moveInventoryItem').mockResolvedValue({
      ...detail('picking'),
      location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' },
    });
    renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    expect(await within(dialog).findByRole('heading', { name: /Mover de ubicación/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: /Marcar pérdida/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();

    const select = within(dialog).getByLabelText('Nueva ubicación') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    // Solo stock de plataforma, sin la actual: nunca un cajón de custodia de cliente.
    expect(values).toEqual(['loc-2']);

    fireEvent.change(select, { target: { value: 'loc-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    await waitFor(() =>
      expect(moveSpy).toHaveBeenCalledWith('inv-1001', { toLocationId: 'loc-2', note: undefined }),
    );
  });

  it('en `in_stock` sigue ofreciendo mover (todas las zonas) y la merma — sin cambio', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('in_stock'));
    renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    expect(await within(dialog).findByRole('heading', { name: /Mover de ubicación/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /Marcar pérdida/ })).toBeInTheDocument();
    const select = within(dialog).getByLabelText('Nueva ubicación') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value).filter(Boolean)).toEqual([
      'loc-2',
      'loc-3',
      'loc-4',
      'loc-5',
    ]);
  });

  it('en `shipped` no ofrece mover (una pieza que ya salió no se reubica)', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('shipped'));
    renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    await within(dialog).findByText('Historial de movimientos');
    expect(within(dialog).queryByRole('heading', { name: /Mover de ubicación/ })).not.toBeInTheDocument();
  });
});
