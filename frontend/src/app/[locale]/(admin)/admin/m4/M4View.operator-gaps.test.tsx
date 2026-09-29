import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockInventory, mockLocations } from '@/lib/mock/fixtures';
import type { AdminShipmentDTO, ShipPreparationOrderDTO } from '@/types/contract';
import { M4View } from './M4View';

/**
 * Arreglos del recorrido del operador (auditoría 2026-09-29, production a2da420):
 * huecos 1 (ubicar desde «Pedidos a preparar»), 7 («Ver ficha» del operador), 15 (confirmar
 * «Marcar enviado/entregado»). El 12 («Calle Calle») vive en `M4View.test.tsx` (F9).
 */

// Rol mutable por prueba: el operador es el caso que la auditoría midió roto.
const role = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: role.isSuperAdmin ? 'super_admin' : 'vault_operator',
    setRole: () => {},
    isSuperAdmin: role.isSuperAdmin,
    canSwitchRole: false,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string; query?: Record<string, string> };
    children: React.ReactNode;
  }) => {
    const flat =
      typeof href === 'string'
        ? href
        : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query).toString()}` : ''}`;
    return (
      <a href={flat} {...props}>
        {children}
      </a>
    );
  },
}));

beforeEach(() => {
  vi.restoreAllMocks();
  role.isSuperAdmin = false;
});

const shipment = (over: Partial<AdminShipmentDTO>): AdminShipmentDTO =>
  ({
    id: 'shp-x',
    userId: 'u-42',
    status: 'guia',
    carrier: 'DHL',
    trackingNumber: '123',
    requestedAt: '2026-09-10T09:30:00Z',
    items: [{ inventoryItemId: 'inv-1' }],
    ...over,
  }) as AdminShipmentDTO;

function onlyShipments(rows: AdminShipmentDTO[]) {
  vi.spyOn(api, 'getAdminShipments').mockResolvedValue({
    data: rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
  });
  vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([]);
}

describe('M4View · hueco 7: «Ver ficha» según rol', () => {
  it('operador ⇒ enlaza a la bóveda del cliente (/admin/vaults/:userId), nunca a M6', async () => {
    onlyShipments([shipment({ id: 'shp-op' })]);
    renderWithProviders(<M4View />, 'es');
    const parties = await screen.findByTestId('shipment-parties-shp-op');
    expect(within(parties).getByRole('link', { name: 'Ver bóveda' })).toHaveAttribute('href', '/admin/vaults/u-42');
    expect(parties.querySelector('a[href*="/admin/m6"]')).toBeNull();
  });

  it('súper-admin ⇒ conserva «Ver ficha» a M6', async () => {
    role.isSuperAdmin = true;
    onlyShipments([shipment({ id: 'shp-sa' })]);
    renderWithProviders(<M4View />, 'es');
    const parties = await screen.findByTestId('shipment-parties-shp-sa');
    expect(within(parties).getByRole('link', { name: 'Ver ficha' })).toHaveAttribute(
      'href',
      '/admin/m6?user=u-42',
    );
  });
});

describe('M4View · hueco 15: «Marcar enviado/entregado» confirman', () => {
  it('«Marcar enviado» abre un diálogo neutro con el foco en «Cancelar»; cancelar NO cambia nada', async () => {
    onlyShipments([shipment({ id: 'shp-g', status: 'guia' })]);
    const spy = vi.spyOn(api, 'updateAdminShipmentStatus');
    renderWithProviders(<M4View />, 'es');
    await screen.findByTestId('shipment-parties-shp-g');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar enviado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Marcar como enviado' });
    expect(dialog).toHaveTextContent('¿Marcar el envío shp-g como enviado?');
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(spy).not.toHaveBeenCalled();

    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });

  it('confirmar «Marcar enviado» ⇒ PATCH guia→enviado', async () => {
    onlyShipments([shipment({ id: 'shp-g', status: 'guia' })]);
    const spy = vi
      .spyOn(api, 'updateAdminShipmentStatus')
      .mockResolvedValue({ id: 'shp-g', status: 'enviado' });
    renderWithProviders(<M4View />, 'es');
    await screen.findByTestId('shipment-parties-shp-g');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar enviado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Marcar como enviado' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar enviado' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-g', 'enviado'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('«Marcar entregado» también confirma, con el foco en «Cancelar» (en)', async () => {
    onlyShipments([shipment({ id: 'shp-e', status: 'enviado' })]);
    const spy = vi.spyOn(api, 'updateAdminShipmentStatus');
    renderWithProviders(<M4View />, 'en');
    await screen.findByTestId('shipment-parties-shp-e');

    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark as delivered' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('M4View · hueco 1: «Ubicar» una carta de un pedido de envío', () => {
  const order: ShipPreparationOrderDTO = {
    shipmentId: 'shp-p',
    orderId: 'ord-p',
    orderNumber: 'TCG-000777',
    destination: 'ship',
    requestedAt: '2026-09-01T10:00:00Z',
    customer: { lastName: 'Oak', fullName: 'Samuel Oak' },
    shipTo: {
      recipientName: 'Samuel Oak',
      line1: 'Calle Laboratorio 1',
      line2: null,
      neighborhood: null,
      city: 'Pueblo Paleta',
      state: 'KAN',
      postalCode: '00001',
      country: 'MX',
      phone: '5550000000',
    },
    items: [
      {
        shipmentItemId: 'si-1',
        inventoryItemId: 'inv-1001',
        folio: 'INV-000101',
        quantity: 1,
        card: { name: 'Charizard', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: null },
        currentLocation: { kind: 'unassigned' },
      },
    ],
  } as ShipPreparationOrderDTO;

  function setup() {
    vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    const queueSpy = vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([order]);
    vi.spyOn(api, 'getLocations').mockResolvedValue(mockLocations);
    const moveSpy = vi.spyOn(api, 'moveInventoryItem').mockResolvedValue({
      ...mockInventory[0],
      id: 'inv-1001',
      status: 'picking',
      location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' },
    });
    return { queueSpy, moveSpy };
  }

  it('«Sin ubicar» ⇒ «Ubicar» abre el selector (solo stock de plataforma), mueve y la tarjeta muestra la ubicación nueva', async () => {
    const { queueSpy, moveSpy } = setup();
    renderWithProviders(<M4View />, 'es');
    const loc = await screen.findByTestId('prep-location-si-1');
    expect(loc).toHaveTextContent('Sin ubicar');

    fireEvent.click(within(loc).getByRole('button', { name: 'Ubicar la carta con folio INV-000101' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ubicar carta' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus());
    const select = (await within(dialog).findByLabelText('Ubicación en stock de plataforma')) as HTMLSelectElement;
    // Solo `platform_stock` activas: nunca un cajón de custodia de cliente.
    expect(Array.from(select.options).map((o) => o.value).filter(Boolean)).toEqual(['loc-1', 'loc-2']);

    const save = within(dialog).getByRole('button', { name: 'Guardar ubicación' });
    expect(save).toBeDisabled();
    fireEvent.change(select, { target: { value: 'loc-2' } });
    fireEvent.click(save);

    await waitFor(() => expect(moveSpy).toHaveBeenCalledWith('inv-1001', { toLocationId: 'loc-2' }));
    // La tarjeta se reescribe CON LA RESPUESTA (sin otra ida a picking-list).
    await waitFor(() => expect(screen.getByTestId('prep-location-si-1')).toHaveTextContent('C03-F02-S16'));
    expect(screen.getByTestId('prep-location-si-1')).not.toHaveTextContent('Sin ubicar');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  it('una carta YA ubicada también ofrece «Ubicar» (corregir)', async () => {
    setup();
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([
      { ...order, items: [{ ...order.items[0], currentLocation: { kind: 'assigned', label: 'C03-F02-S15' } }] },
    ]);
    renderWithProviders(<M4View />, 'es');
    const loc = await screen.findByTestId('prep-location-si-1');
    expect(within(loc).getByRole('button', { name: 'Ubicar la carta con folio INV-000101' })).toBeInTheDocument();
  });

  it('error del move ⇒ se queda el diálogo con el error y la tarjeta no cambia', async () => {
    const { moveSpy } = setup();
    moveSpy.mockRejectedValue(new Error('boom'));
    renderWithProviders(<M4View />, 'es');
    const loc = await screen.findByTestId('prep-location-si-1');
    fireEvent.click(within(loc).getByRole('button', { name: 'Ubicar la carta con folio INV-000101' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ubicar carta' });
    fireEvent.change(await within(dialog).findByLabelText('Ubicación en stock de plataforma'), {
      target: { value: 'loc-1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar ubicación' }));
    expect(await within(dialog).findByText('No se pudo guardar la ubicación.')).toBeInTheDocument();
    expect(screen.getByTestId('prep-location-si-1')).toHaveTextContent('Sin ubicar');
  });
});
