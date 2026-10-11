import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { RefundOrderDialog } from './RefundOrderDialog';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import type { AdminOrderDTO } from '@/types/contract';

/**
 * 💰 **El reembolso TOTAL de M3 sobre una compra a BÓVEDA** (`DESIGN_SYSTEM §37.10`, contrato §M3 v1.80.4/.80.5).
 * Candado `PS-UI-14`: `409 VAULT_PIECE_IN_PACKED_WITHDRAWAL` nombra el retiro con enlace y pide deshacer el preparado;
 * `422 REFUND_CONFIRMATION_REQUIRED` vuelve con la casilla SIN marcar y el segundo `POST` lleva
 * `confirmPiecesWithCustomer: true`. Antes de confirmar se pintan las `vaultPieces` (qué carta está dónde).
 */

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const vaultOrder: AdminOrderDTO = {
  id: 'ord-9001',
  orderNumber: 'TCG-009001',
  userId: 'u-777',
  status: 'settled',
  totalCents: 168520,
  createdAt: '2026-08-10T18:20:00Z',
  fulfillmentMode: 'vault',
} as AdminOrderDTO;

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  window.localStorage.setItem('tcg.role', 'super_admin');
});
afterEach(() => {
  window.localStorage.removeItem('tcg.role');
});

function renderDialog(onDone = vi.fn()) {
  renderWithProviders(<RefundOrderDialog order={vaultOrder} open onClose={() => {}} onDone={onDone} />, 'es');
  return onDone;
}

describe('PS-UI-14 · reembolso total de bóveda', () => {
  it('pinta las `vaultPieces` con su estado antes de confirmar; el resto por devolver es cifra del servidor', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    const pieces = await within(dialog).findByTestId('vault-pieces');
    expect(within(pieces).getByTestId('vault-piece-inv-1002')).toHaveTextContent('En su bóveda');
    expect(within(pieces).getByTestId('vault-piece-inv-1090')).toHaveTextContent('Ya la tiene el cliente');
    expect(dialog).toHaveTextContent('vuelven a la plataforma');
  });

  it('`422 REFUND_CONFIRMATION_REQUIRED` ⇒ la casilla aparece SIN marcar y el segundo POST lleva `confirmPiecesWithCustomer: true`', async () => {
    const spy = vi.spyOn(api, 'refundOrder');
    const onDone = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    await within(dialog).findByTestId('vault-pieces');

    fireEvent.change(within(dialog).getByLabelText('Motivo del reembolso'), { target: { value: 'cliente insatisfecho' } });
    fireEvent.click(within(dialog).getByTestId('m3-refund-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][1]).toEqual({ reason: 'cliente insatisfecho' });

    const box = await within(dialog).findByTestId('m3-confirm-pieces');
    expect(box).not.toBeChecked();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Falta confirmar lo de arriba.');
    // Sin marcar la casilla el botón queda apagado: no hay segundo POST por accidente.
    expect(within(dialog).getByTestId('m3-refund-confirm')).toBeDisabled();

    fireEvent.click(box);
    fireEvent.click(within(dialog).getByTestId('m3-refund-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][1]).toEqual({ reason: 'cliente insatisfecho', confirmPiecesWithCustomer: true });
    // §40.10: `onDone(res, { shippedReason })` — bóveda nunca lleva motivo de envío (P-S11-4).
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0][0]).toEqual(expect.objectContaining({ orderId: 'ord-9001', status: 'refunded' }));
    expect(onDone.mock.calls[0][1]).toEqual({ shippedReason: null, contents: 'cards' });
  });

  it('`409 VAULT_PIECE_IN_PACKED_WITHDRAWAL {items}` ⇒ el alert nombra el retiro con enlace y pide deshacer el preparado', async () => {
    vi.spyOn(api, 'refundOrder').mockRejectedValue(
      new ApiClientError(409, {
        code: 'VAULT_PIECE_IN_PACKED_WITHDRAWAL',
        message: 'packed',
        details: { items: [{ inventoryItemId: 'inv-1002', folio: 'INV-001002', shipmentId: 'shp-7006', shipmentStatus: 'picking' }] },
      }),
    );
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    await within(dialog).findByTestId('vault-pieces');
    fireEvent.change(within(dialog).getByLabelText('Motivo del reembolso'), { target: { value: 'cobro doble' } });
    fireEvent.click(within(dialog).getByTestId('m3-refund-confirm'));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('retiro shp-7006 ya preparado o con guía. No se reembolsó nada. Deshaz el preparado');
    expect(within(alert).getByRole('link', { name: 'Ver retiro shp-7006 en Pedidos por preparar' })).toHaveAttribute('href', '/admin/m4');
  });
});
