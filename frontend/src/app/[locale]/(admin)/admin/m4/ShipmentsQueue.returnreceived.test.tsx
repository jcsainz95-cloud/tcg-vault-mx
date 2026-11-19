import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ShipmentsQueue } from './ShipmentsQueue';
import * as api from '@/lib/api';
import * as ret from '@/lib/api/shipments-return-received';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO } from '@/types/contract';

/** §RETIRO-SALIDA.3 — «Recibimos la devolución» (aislado; borrable si el dueño no lo aprueba). */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));
beforeEach(() => vi.restoreAllMocks());

const row = (id: string, over: Record<string, unknown> = {}): AdminShipmentDTO =>
  ({
    id,
    userId: 'u-1',
    kind: 'vault_withdrawal',
    orderId: null,
    status: 'enviado',
    carrier: 'FedEx',
    trackingNumber: 'MX1',
    requestedAt: '2026-09-20T10:00:00Z',
    addressSnapshot: { recipientName: 'Misty', line1: 'Calle 1', city: 'Cerulean', state: 'KAN', postalCode: '10000', country: 'MX', phone: '5550000000' },
    items: [{ inventoryItemId: 'inv-1' }],
    ...over,
  }) as unknown as AdminShipmentDTO;
const serve = (rows: AdminShipmentDTO[]) =>
  vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total: rows.length });

describe('§RETIRO-SALIDA · return-received', () => {
  it('predicado puro', () => {
    expect(ret.canMarkReturnReceived({ status: 'enviado', kind: 'vault_withdrawal', orderId: null })).toBe(true);
    expect(ret.canMarkReturnReceived({ status: 'entregado', kind: 'vault_withdrawal', orderId: null })).toBe(true);
    expect(ret.canMarkReturnReceived({ status: 'guia', kind: 'vault_withdrawal', orderId: null })).toBe(false);
    expect(ret.canMarkReturnReceived({ status: 'enviado', kind: 'order_ship', orderId: 'o1' } as never)).toBe(false);
    expect(ret.canMarkReturnReceived({ status: 'enviado', kind: 'vault_withdrawal', orderId: null, returnedAt: '2026-11-19' })).toBe(false);
  });

  it('botón solo en retiros enviado/entregado sin devolver; pide confirmación y llama una vez', async () => {
    serve([row('ok'), row('picking', { status: 'picking' }), row('devuelto', { returnedAt: '2026-11-19T00:00:00Z' })]);
    const spy = vi.spyOn(ret, 'markShipmentReturnReceived').mockResolvedValue({ shipment: { id: 'ok' }, restored: 1, skipped: 0, won: true } as never);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    const btn = await screen.findByRole('button', { name: 'Recibimos la devolución' });
    expect(screen.getAllByRole('button', { name: 'Recibimos la devolución' })).toHaveLength(1);
    fireEvent.click(btn);
    const dialog = await screen.findByRole('dialog', { name: '¿Recibimos la devolución de ok?' });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, recibimos la devolución' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('ok'));
  });

  it.each([
    ['RETURN_NOT_APPLICABLE', 'no hay devolución que registrar'],
    ['RETURN_NOTHING_TO_RESTORE', 'No hay cartas que devolver'],
  ])('409 %s ⇒ texto propio', async (code, text) => {
    serve([row('ok')]);
    vi.spyOn(ret, 'markShipmentReturnReceived').mockRejectedValue(new ApiClientError(409, { code, message: 'x' } as never));
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Recibimos la devolución' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, recibimos la devolución' }));
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  });
});
