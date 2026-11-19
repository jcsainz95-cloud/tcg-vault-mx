import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import * as inPerson from '@/lib/api/shipments-in-person';
import type { AdminShipmentDTO } from '@/types/contract';
import { CaptureLabelDialog } from './CaptureLabelDialog';
import { TARGET, shipment } from './capture/sdx-test-fixtures';

/** §PERSONA — «¿El cliente lo recogió? Entregado en persona» dentro de «Capturar guía». */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'listShippingPackages').mockResolvedValue([] as never);
});

function open(s: AdminShipmentDTO) {
  vi.spyOn(api, 'getAdminShipment').mockResolvedValue(s);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<CaptureLabelDialog target={{ ...TARGET, orderNumber: null, folio: 'ENV-000045' }} onClose={onClose} onSaved={onSaved} />, 'es');
  return { onSaved, onClose };
}

describe('§PERSONA · ventana «Capturar guía»', () => {
  it('retiro de bóveda preparado: la alternativa sale arriba y entrega con confirmación y flete', async () => {
    const { onSaved, onClose } = open(shipment({ kind: 'vault_withdrawal', orderId: null, orderNumber: null, shippingFeeChargedCents: 9900 } as never));
    const block = await screen.findByTestId('capture-in-person');
    expect(block).toHaveTextContent('¿El cliente lo recogió?');
    const spy = vi.spyOn(inPerson, 'deliverShipmentInPerson').mockResolvedValue({ id: 'x', status: 'entregado' } as never);
    fireEvent.click(within(block).getByRole('button', { name: 'Entregado en persona' }));
    const dialog = await screen.findByRole('dialog', { name: /en persona\?/ });
    expect(within(dialog).getByTestId('in-person-fee')).toHaveTextContent('99');
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entregado en persona' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(TARGET.id));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ kind: 'in_person', ref: TARGET.ref }));
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['sin preparar', { preparedAt: null }],
    ['con guía', { labelSource: 'manual', trackingNumber: 'MX1' }],
    ['ya en guía', { status: 'guia' }],
  ])('no sale %s', async (_n, over) => {
    open(shipment(over as never));
    await screen.findByRole('dialog');
    await waitFor(() => expect(api.getAdminShipment).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('capture-in-person')).toBeNull();
  });
});
