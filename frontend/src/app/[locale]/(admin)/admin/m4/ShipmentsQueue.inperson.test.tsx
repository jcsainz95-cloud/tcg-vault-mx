import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ShipmentsQueue } from './ShipmentsQueue';
import * as api from '@/lib/api';
import * as inPerson from '@/lib/api/shipments-in-person';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO } from '@/types/contract';

/** §PERSONA — «Entregado en persona» (DECISIONES §PERSONA.9; criterio 9 de PROJECT §6). */
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
    preparedAt: '2026-09-21T10:00:00Z',
    requestedAt: '2026-09-20T10:00:00Z',
    addressSnapshot: { recipientName: 'Misty Waterflower', line1: 'Calle 1', city: 'Cerulean', state: 'KAN', postalCode: '10000', country: 'MX', phone: '5550000000' },
    customer: { userId: 'u-1', fullName: 'Misty Waterflower', email: 'misty@example.com' },
    items: [{ inventoryItemId: 'inv-1' }],
    ...over,
  }) as AdminShipmentDTO;

function serve(rows: AdminShipmentDTO[]) {
  return vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total: rows.length });
}

describe('§PERSONA · botón y predicado', () => {
  it('aparece solo con picking + preparado + sin guía', async () => {
    serve([
      row('ok'),
      row('sin-prep', { preparedAt: null }),
      row('con-guia', { labelSource: 'manual', trackingNumber: 'MX1' }),
      row('guia-st', { status: 'guia', trackingNumber: 'MX2' }),
    ]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByText('ok');
    expect(screen.getAllByRole('button', { name: 'Entregado en persona' })).toHaveLength(1);
  });

  it('predicado puro', () => {
    expect(inPerson.canDeliverInPerson({ status: 'picking', preparedAt: 'x', labelSource: null, trackingNumber: null })).toBe(true);
    expect(inPerson.canDeliverInPerson({ status: 'entregado', preparedAt: 'x', labelSource: 'in_person', trackingNumber: null })).toBe(false);
  });
});

describe('§PERSONA · confirmación y ejecución', () => {
  it('muestra el envío cobrado, foco en Cancelar, y solo llama al confirmar', async () => {
    serve([row('shp-1', { shippingFeeChargedCents: 9900 })]);
    const spy = vi.spyOn(inPerson, 'deliverShipmentInPerson').mockResolvedValue({ id: 'shp-1', status: 'entregado' } as never);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Entregado en persona' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Entregar shp-1 en persona?' });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(within(dialog).getByTestId('in-person-fee')).toHaveTextContent('Este pedido cobró envío');
    expect(within(dialog).getByTestId('in-person-fee')).toHaveTextContent('99');
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entregado en persona' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-1'));
  });

  it('sin envío cobrado no hay línea de envío', async () => {
    serve([row('shp-2', { shippingFeeChargedCents: 0 })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'en');
    fireEvent.click(await screen.findByRole('button', { name: 'Delivered in person' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('in-person-fee')).toBeNull();
  });

  it.each([
    ['SHIPMENT_NOT_PREPARED', 'SHIPMENT_NOT_PREPARED: el envío no está preparado'],
    ['SHIPMENT_HAS_LABEL', 'SHIPMENT_HAS_LABEL: el envío ya tiene guía'],
    ['CONFLICT', 'CONFLICT: el envío cambió'],
  ])('409 %s se nombra', async (code, text) => {
    serve([row('shp-3')]);
    vi.spyOn(inPerson, 'deliverShipmentInPerson').mockRejectedValue(new ApiClientError(409, { code, message: code }));
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Entregado en persona' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entregado en persona' }));
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  });
});

describe('§PERSONA · etiqueta in_person', () => {
  it('fila entregada con labelSource in_person lleva la etiqueta', async () => {
    serve([row('shp-4', { status: 'entregado', labelSource: 'in_person' })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    expect(await screen.findByTestId('in-person-tag-shp-4')).toHaveTextContent('Entregado en persona');
    expect(screen.queryByRole('button', { name: 'Entregado en persona' })).toBeNull();
  });
});
