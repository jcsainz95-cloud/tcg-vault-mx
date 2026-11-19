import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PreparationQueue } from './PreparationQueue';
import * as api from '@/lib/api';
import * as inPerson from '@/lib/api/shipments-in-person';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO, ShipPreparationItemDTO, ShipPreparationOrderDTO } from '@/types/contract';

/** §PERSONA — «Entregado en persona» en la tarjeta de «Preparar» (envío directo y retiro de bóveda). */
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

const picked: ShipPreparationItemDTO = {
  shipmentItemId: 'sit-a',
  inventoryItemId: 'inv-a',
  folio: 'INV-a',
  quantity: 1,
  card: { name: 'Carta a', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
  currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
  prepStatus: 'picked',
  missingReason: null,
  prepMarkedBy: null,
  availability: { kind: 'available' },
  refund: { kind: 'refundable', amountCents: 0 },
};
const counts = { total: 1, pending: 0, picked: 1, missing: 0, blocked: 0 };

function order(over: Partial<ShipPreparationOrderDTO> & { prepared?: boolean } = {}): ShipPreparationOrderDTO {
  const { prepared = true, ...rest } = over;
  return {
    destination: 'ship',
    shipmentId: 'shp-1',
    kind: 'vault_withdrawal',
    orderId: null,
    orderNumber: null,
    requestedAt: '2026-09-20T10:00:00Z',
    customer: { userId: 'u-1', email: 'misty@example.com', lastName: 'Waterflower', fullName: 'Misty Waterflower' },
    preparation: prepared
      ? { status: 'prepared', preparedAt: '2026-09-28T17:20:00Z', preparedBy: { userId: 'u-op1', name: 'Operador' }, openReplacements: 0, ...counts }
      : { status: 'in_progress', refundPreviewCents: 0, ...counts },
    shipTo: { recipientName: 'Misty Waterflower', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5550000000' },
    items: [picked],
    ...rest,
  } as ShipPreparationOrderDTO;
}

function serve(o: ShipPreparationOrderDTO) {
  vi.spyOn(api, 'getAdminPreparationQueue').mockImplementation(async ({ destination } = {}) => (!destination || destination === 'ship' ? [o] : []));
}
const btn = () => within(screen.getByTestId('prep-order-shp-1')).queryByRole('button', { name: 'Entregado en persona' });

describe('§PERSONA · tarjeta de Preparar', () => {
  it('el botón sale con retiro de bóveda preparado y con envío directo preparado', async () => {
    serve(order());
    const a = renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('prep-order-shp-1');
    expect(btn()).not.toBeNull();
    a.unmount();
    serve(order({ kind: 'guest_direct_ship', orderId: 'ord-1', orderNumber: 'TCG-000123' }));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('prep-order-shp-1');
    expect(btn()).not.toBeNull();
  });

  it('no sale sin preparar ni con una guía en curso', async () => {
    serve(order({ prepared: false }));
    const a = renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('prep-order-shp-1');
    expect(btn()).toBeNull();
    a.unmount();
    serve(order({ labelPending: { state: 'processing', since: '2026-09-28T18:00:00Z', carrierLabel: null, serviceName: null, chosenBy: null } }));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('prep-order-shp-1');
    expect(btn()).toBeNull();
  });

  it('retiro de bóveda: confirma con el flete cobrado y llama a la misma mutación', async () => {
    serve(order());
    vi.spyOn(api, 'getAdminShipment').mockResolvedValue({ id: 'shp-1', status: 'picking', shippingFeeChargedCents: 9900 } as AdminShipmentDTO);
    const spy = vi.spyOn(inPerson, 'deliverShipmentInPerson').mockResolvedValue({ id: 'shp-1', status: 'entregado' } as never);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('prep-order-shp-1');
    fireEvent.click(btn()!);
    const dialog = await screen.findByRole('dialog', { name: /en persona\?/ });
    expect(await within(dialog).findByTestId('in-person-fee')).toHaveTextContent('99');
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entregado en persona' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-1'));
    expect(await screen.findByText(/Entregado en persona: /)).toBeInTheDocument();
  });

  it('409 SHIPMENT_HAS_LABEL se nombra', async () => {
    serve(order());
    vi.spyOn(api, 'getAdminShipment').mockResolvedValue({ id: 'shp-1', status: 'picking' } as AdminShipmentDTO);
    vi.spyOn(inPerson, 'deliverShipmentInPerson').mockRejectedValue(new ApiClientError(409, { code: 'SHIPMENT_HAS_LABEL', message: 'x' }));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('prep-order-shp-1');
    fireEvent.click(btn()!);
    const dialog = await screen.findByRole('dialog', { name: /en persona\?/ });
    const confirm = within(dialog).getByRole('button', { name: 'Entregado en persona' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByText(/SHIPMENT_HAS_LABEL: el envío ya tiene guía/)).toBeInTheDocument();
  });
});
