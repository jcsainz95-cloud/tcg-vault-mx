import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
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

  /**
   * **QA IMPORTANTE sobre `4ca6c45` (2026-09-29).** El selector ofrecía cajones de «Custodia de
   * clientes» a una pieza de plataforma `in_stock`/`listed`; el backend responde
   * `422 LOCATION_NOT_AVAILABLE reason=not_platform_stock` (`item-location.rules.ts ·
   * assertMoveDestination`) y el banner pintaba el inglés del servidor. Una pieza de la tienda solo
   * vive en `platform_stock`, en CUALQUIER estado — no solo en `picking`.
   */
  it.each(['in_stock', 'listed'] as const)(
    'en `%s` ofrece mover SOLO a stock de plataforma activo (ningún cajón de custodia) y sigue la merma',
    async (status) => {
      vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail(status));
      const locations = [
        ...mockLocations,
        // Un estante de plataforma INACTIVO tampoco se ofrece (`reason:'inactive'`).
        { ...mockLocations[1], id: 'loc-6', label: 'C03-F02-S17', isActive: false },
      ];
      renderWithProviders(
        <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={locations} />,
        'es',
      );
      const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
      expect(await within(dialog).findByRole('heading', { name: /Mover de ubicación/ })).toBeInTheDocument();
      expect(within(dialog).getByRole('heading', { name: /Marcar pérdida/ })).toBeInTheDocument();
      const select = within(dialog).getByLabelText('Nueva ubicación') as HTMLSelectElement;
      const options = Array.from(select.options).filter((o) => o.value);
      expect(options.map((o) => o.value)).toEqual(['loc-2']);
      expect(options.map((o) => o.textContent)).toEqual(['C03-F02-S16 · Stock de plataforma']);
    },
  );

  it('un `422 LOCATION_NOT_AVAILABLE` del move se pinta TRADUCIDO con su motivo, nunca el inglés del servidor', async () => {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail('in_stock'));
    // Forma EXACTA del backend (`item-location.rules.ts · locationError`). `not_platform_stock` ya no
    // debería poder producirse desde esta UI (el selector no lo ofrece), pero es el `reason` que QA
    // midió y el que un backend/lista rancia puede seguir devolviendo.
    vi.spyOn(api, 'moveInventoryItem').mockRejectedValue(
      new ApiClientError(422, {
        code: 'LOCATION_NOT_AVAILABLE',
        message: 'Location not available: not_platform_stock',
        details: { reason: 'not_platform_stock' },
      }),
    );
    renderWithProviders(
      <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={mockLocations} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    const select = (await within(dialog).findByLabelText('Nueva ubicación')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'loc-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo mover el item.');
    // El motivo, en castellano: la pieza es de la tienda y el destino no era un estante de la tienda.
    expect(alert).toHaveTextContent('solo puede ir a un estante de stock de plataforma');
    expect(alert).toHaveTextContent('No se guardó nada');
    expect(alert.textContent).not.toMatch(/Location not available|not_platform_stock/);
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
