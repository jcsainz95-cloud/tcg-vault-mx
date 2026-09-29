import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockInventory, mockLocations } from '@/lib/mock/fixtures';
import type { AdminInventoryItemDetailDTO, InventoryItemDTO, InventoryStatus } from '@/types/contract';
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
  /*
   * Respuesta REAL del move, en sus DOS formas: `sin location` = la fila de `toAdminInventoryItemRow`
   * (`locationId`, SIN `location`), lo que sirve production hoy (QA, medido contra el stack
   * 2026-09-29 — la prueba anterior simulaba un `location` que ese backend no produce, y por eso no
   * veía el aviso «Item movido a .»); `con location` = lo que añade el backend de esta rama
   * (`inventory.service.ts · moveItem`). Front y back se publican por separado: valen las dos.
   */
  it.each([
    ['sin location', false],
    ['con location', true],
  ])('en `picking` ofrece «Mover de ubicación» (solo stock de plataforma) y NO la merma ni publicar (respuesta %s)', async (_shape, withLocation) => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('picking'));
    const row: InventoryItemDTO = { ...mockInventory[0], status: 'picking' };
    delete row.location;
    const moveSpy = vi.spyOn(api, 'moveInventoryItem').mockResolvedValue({
      ...row,
      locationId: 'loc-2',
      ...(withLocation
        ? { location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' as const } }
        : {}),
    } as InventoryItemDTO);
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
    // El aviso nombra la ubicación ELEGIDA — nunca «Item movido a .» con la etiqueta vacía.
    const ok = await within(dialog).findByRole('status');
    expect(ok).toHaveTextContent('Item movido a C03-F02-S16.');
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
