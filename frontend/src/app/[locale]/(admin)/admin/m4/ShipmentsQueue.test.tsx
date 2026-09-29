import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ShipmentsQueue } from './ShipmentsQueue';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO } from '@/types/contract';

/**
 * **La cola de envíos** (`DESIGN_SYSTEM §37.6` y `§37.11a`, contrato `§M4-SHIP.6/.7/.10`). Candado `PS-UI-10`
 * (confirmaciones con foco en «Cancelar»; ⛔ sin «Cancelar» en un envío pagado) y la copy por código del
 * `409` (`PAID_SHIPMENT_NOT_CANCELLABLE`, `CONFLICT nothing_to_ship`).
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const row = (id: string, over: Partial<AdminShipmentDTO> = {}): AdminShipmentDTO =>
  ({
    id,
    userId: 'u-1',
    kind: 'vault_withdrawal',
    orderId: null,
    status: 'picking',
    carrier: null,
    trackingNumber: null,
    requestedAt: '2026-09-20T10:00:00Z',
    addressSnapshot: { recipientName: 'Misty Waterflower', line1: 'Calle 1', city: 'Cerulean', state: 'KAN', postalCode: '10000', country: 'MX', phone: '5550000000' },
    customer: { userId: 'u-1', fullName: 'Misty Waterflower', email: 'misty@example.com' },
    items: [{ inventoryItemId: 'inv-1' }],
    ...over,
  }) as AdminShipmentDTO;

function serve(rows: AdminShipmentDTO[]) {
  return vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total: rows.length });
}

describe('PS-UI-10 · confirmaciones (§37.6, S9)', () => {
  it('«Marcar enviado» abre diálogo con foco en «Cancelar», nombra al destinatario y el PATCH sale al confirmar', async () => {
    serve([row('shp-g', { status: 'guia', carrier: 'DHL', trackingNumber: 'MX1' })]);
    const spy = vi.spyOn(api, 'updateAdminShipmentStatus').mockResolvedValue({ id: 'shp-g', status: 'enviado' } as never);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar enviado' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Marcar shp-g como enviado?' });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(dialog).toHaveTextContent('Para Misty Waterflower.');
    expect(spy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar enviado' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-g', 'enviado'));
  });

  it('«Marcar entregado» advierte que no hay vuelta atrás y confirma; «Cancelar» del diálogo no llama a nada', async () => {
    serve([row('shp-e', { status: 'enviado', carrier: 'DHL', trackingNumber: 'MX1' })]);
    const spy = vi.spyOn(api, 'updateAdminShipmentStatus');
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar entregado' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Marcar shp-e como entregado?' });
    expect(dialog).toHaveTextContent('desde esta pantalla no hay vuelta atrás');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });

  it('⛔ en `picking` y `guia` no existe ningún «Cancelar»; en `solicitado` sí, y su diálogo dice «Cancelar solicitud»', async () => {
    serve([row('shp-p', { status: 'picking' }), row('shp-g', { status: 'guia', carrier: 'DHL', trackingNumber: 'MX1' }), row('shp-s', { status: 'solicitado' })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');

    await screen.findByTestId('shipment-row-shp-p');
    expect(within(screen.getByTestId('shipment-row-shp-p')).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('shipment-row-shp-g')).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelar envío')).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('shipment-row-shp-s')).getByRole('button', { name: 'Cancelar' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Cancelar la solicitud shp-s?' });
    expect(within(dialog).getByRole('button', { name: 'Cancelar solicitud' })).toBeInTheDocument();
  });
});

describe('copy por código (§37.6)', () => {
  it('`409 PAID_SHIPMENT_NOT_CANCELLABLE` ⇒ la fila explica que un envío pagado no se cancela a mano', async () => {
    serve([row('shp-s', { status: 'solicitado' })]);
    vi.spyOn(api, 'updateAdminShipmentStatus').mockRejectedValue(new ApiClientError(409, { code: 'PAID_SHIPMENT_NOT_CANCELLABLE', message: 'paid', details: { status: 'picking' } }));
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar solicitud' }));
    const alert = await within(screen.getByTestId('shipment-row-shp-s')).findByRole('alert');
    expect(alert).toHaveTextContent('Este envío ya está pagado y no se cancela a mano (En preparación)');
  });

  it('`409 CONFLICT {reason: nothing_to_ship}` al marcar enviado ⇒ «no tiene ninguna carta que enviar» (v1.80.6)', async () => {
    serve([row('shp-g', { status: 'guia', carrier: 'DHL', trackingNumber: 'MX1' })]);
    vi.spyOn(api, 'updateAdminShipmentStatus').mockRejectedValue(new ApiClientError(409, { code: 'CONFLICT', message: 'nothing', details: { reason: 'nothing_to_ship' } }));
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar enviado' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Marcar enviado' }));
    const alert = await within(screen.getByTestId('shipment-row-shp-g')).findByRole('alert');
    expect(alert).toHaveTextContent('Este retiro no tiene ninguna carta que enviar');
  });
});

describe('§37.11a · quién es quién y búsqueda', () => {
  it('la fila lleva número de pedido, comprador con correo, «Ver pedido», preparado-por y faltantes', async () => {
    serve([
      row('shp-d', {
        kind: 'guest_direct_ship',
        orderId: 'ord-1',
        orderNumber: 'TCG-000123',
        preparedAt: '2026-09-28T17:20:00Z',
        preparedBy: { userId: 'u-op1', name: 'Operador Uno' },
        missingCount: 1,
      }),
    ]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');

    const r = await screen.findByTestId('shipment-row-shp-d');
    expect(r).toHaveTextContent('TCG-000123');
    expect(within(r).getByTestId('shipment-customer-shp-d')).toHaveTextContent('Cliente Misty Waterflower · misty@example.com');
    expect(within(r).getByRole('link', { name: 'Ver pedido' })).toHaveAttribute('href', '/admin/m3/ord-1');
    expect(r).toHaveTextContent('Preparado por Operador Uno');
    expect(r).toHaveTextContent('1 carta no sale');
    expect(screen.queryByText('u-1')).not.toBeInTheDocument();
  });

  it('un invitado se marca «Invitado» con su correo; un retiro se titula «Retiro de bóveda»', async () => {
    serve([row('shp-i', { kind: 'guest_direct_ship', orderId: 'ord-2', orderNumber: 'TCG-000124', userId: null, customer: null, guestEmail: 'guest@example.com' }), row('shp-w')]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');

    const guest = await screen.findByTestId('shipment-row-shp-i');
    expect(within(guest).getByTestId('shipment-customer-shp-i')).toHaveTextContent('Invitado · guest@example.com');
    expect(screen.getByTestId('shipment-row-shp-w')).toHaveTextContent('Retiro de bóveda');
  });

  it('la búsqueda alimenta `q` (con debounce) y el vacío nombra lo buscado', async () => {
    const spy = vi.spyOn(api, 'getAdminShipments').mockImplementation(async ({ q } = {}) => ({ data: q ? [] : [row('shp-w')], page: 1, pageSize: 20, total: q ? 0 : 1 }));
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('shipment-row-shp-w');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'TCG-000999' } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'TCG-000999' })), { timeout: 3000 });
    expect(await screen.findByText('Ningún envío coincide con «TCG-000999».')).toBeInTheDocument();
  });
});
