import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import { formatMoneyCents } from '@/lib/format';
import type { AdminOrderDetailDTO } from '@/types/contract';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';

/**
 * 💰 DESIGN_SYSTEM §60.3 · contrato v1.82 §PNL.2 — «Reembolsar esta carta» de un pedido directo ENTREGADO.
 * Candados IDR-UI-1 (= FE-IDR-1), IDR-UI-2 (= FE-IDR-2) e IDR-UI-3.
 */
const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const card = (name: string) => ({ name, setName: 'Base Set', number: '4', imageSmallUrl: null });

const DETAIL: AdminOrderDetailDTO = {
  id: 'ord-7001',
  userId: 'u-701',
  orderNumber: 'TCG-007001',
  status: 'settled',
  breakdown: {
    subtotalCents: 80_000, ivaCents: 11_034, ivaRatePct: 16, processingFeeCents: 4_617, shippingFeeCents: 15_000,
    totalCents: 99_617, currency: 'MXN', priceConvention: 'IVA_INCLUSIVE', ivaIncluded: true,
  },
  items: [
    { inventoryItemId: 'inv-a', orderItemId: 'oi-a', card: card('Charizard'), unitPriceCents: 30_000, refund: null, deliveredRefund: { kind: 'refundable', amountCents: 31_458 } },
    { inventoryItemId: 'inv-b', orderItemId: 'oi-b', card: card('Blastoise'), unitPriceCents: 50_000, refund: null, deliveredRefund: { kind: 'not_refundable', reason: 'not_delivered' } },
  ] as AdminOrderDetailDTO['items'],
  fulfillmentMode: 'direct_ship',
  createdAt: '2026-09-01T10:00:00Z',
  settledAt: '2026-09-01T10:02:00Z',
  fullRefundReview: null,
};

const money = (c: number) => formatMoneyCents(c, 'es');

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
});
afterEach(() => window.localStorage.removeItem('tcg.role'));

async function openDialog() {
  vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(DETAIL));
  renderWithProviders(<M3OrderDetailView orderId="ord-7001" />, 'es');
  fireEvent.click(await screen.findByTestId('m3-item-refund-oi-a'));
  return screen.findByRole('dialog', { name: 'Reembolsar una carta entregada' });
}

describe('§60.3 · «Reembolsar esta carta» en M3', () => {
  it('IDR-UI-1 · súper-admin: botón SOLO en la línea `refundable` con la cifra del servidor; la otra dice por qué no', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(DETAIL));
    renderWithProviders(<M3OrderDetailView orderId="ord-7001" />, 'es');
    const btn = await screen.findByTestId('m3-item-refund-oi-a');
    expect(btn).toHaveTextContent(`Reembolsar esta carta · ${money(31_458)}`);
    expect(screen.queryByTestId('m3-item-refund-oi-b')).not.toBeInTheDocument();
    expect(screen.getByTestId('m3-item-not-refundable-inv-b')).toHaveTextContent('Se podrá reembolsar cuando su envío esté entregado.');
  });

  it('IDR-UI-1 · operador: ni botón ni texto (no hay nada que él complete)', async () => {
    roleState.role = 'vault_operator';
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(DETAIL));
    renderWithProviders(<M3OrderDetailView orderId="ord-7001" />, 'es');
    await screen.findByText('Charizard');
    expect(screen.queryByTestId('m3-item-refund-oi-a')).not.toBeInTheDocument();
    expect(screen.queryByText(/Reembolsar esta carta/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('m3-item-not-refundable-inv-b')).not.toBeInTheDocument();
  });

  it('IDR-UI-3 · ningún motivo marcado al abrir; deshabilitado sin motivo o con nota < 3', async () => {
    const dialog = await openDialog();
    const radios = within(dialog).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).not.toBeChecked();
    const confirm = within(dialog).getByTestId('m3-item-refund-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: 'llegó doblada' } });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText(/Llegó en mala condición/));
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: ' a ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: 'abc' } });
    expect(confirm).toBeEnabled();
  });

  it('IDR-UI-1 · el POST lleva `expectedRefundCents` = la cifra mostrada y ⛔ NO lleva `amountCents`', async () => {
    const spy = vi.spyOn(api, 'refundDeliveredItem').mockResolvedValue({
      refund: {
        id: 'pr-1', kind: 'item_delivered', status: 'requested', amountCents: 31_458, missingReason: null, deliveredReason: 'arrived_damaged',
        requestedAt: '2026-10-05T00:00:00Z', requestedBy: { userId: 'u', name: 'A', role: 'super_admin' },
        submittedAt: null, succeededAt: null, failedAt: null, failureCode: null,
      },
    });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByLabelText(/Llegó en mala condición/));
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: '  llegó doblada, foto por correo  ' } });
    fireEvent.click(within(dialog).getByTestId('m3-item-refund-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [orderId, orderItemId, body] = spy.mock.calls[0];
    expect(orderId).toBe('ord-7001');
    expect(orderItemId).toBe('oi-a');
    expect(body).toEqual({ reason: 'arrived_damaged', note: 'llegó doblada, foto por correo', expectedRefundCents: 31_458 });
    expect(Object.prototype.hasOwnProperty.call(body, 'amountCents')).toBe(false);
    expect(await screen.findByTestId('m3-notice')).toHaveTextContent(
      `Reembolso de ${money(31_458)} pedido a Stripe por Charizard. Motivo: «Llegó en mala condición».`,
    );
  });

  it('IDR-UI-2 · 409 REFUND_PREVIEW_STALE ⇒ el diálogo SIGUE abierto, la cifra nueva en botón y bloque, motivo y nota conservados', async () => {
    const spy = vi.spyOn(api, 'refundDeliveredItem').mockRejectedValueOnce(
      new ApiClientError(409, { code: 'REFUND_PREVIEW_STALE', message: 'stale', details: { refundCents: 31_500 } }),
    );
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByLabelText(/No llegó/));
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: 'no llegó nunca' } });
    fireEvent.click(within(dialog).getByTestId('m3-item-refund-confirm'));
    expect(await within(dialog).findByTestId('m3-item-refund-error')).toHaveTextContent(
      `El importe cambió mientras confirmabas: ahora son ${money(31_500)}. No se reembolsó nada.`,
    );
    expect(screen.getByRole('dialog', { name: 'Reembolsar una carta entregada' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('m3-item-refund-amount')).toHaveTextContent(`Se devuelven ${money(31_500)}`);
    expect(within(dialog).getByTestId('m3-item-refund-confirm')).toHaveTextContent(`Reembolsar ${money(31_500)}`);
    expect(within(dialog).getByLabelText(/No llegó/)).toBeChecked();
    expect(within(dialog).getByLabelText('Qué pasó')).toHaveValue('no llegó nunca');
    // Reenvío: ahora con la cifra nueva.
    spy.mockResolvedValueOnce({ refund: { id: 'pr-2', kind: 'item_delivered', status: 'submitted', amountCents: 31_500, missingReason: null, deliveredReason: 'not_arrived', requestedAt: '', requestedBy: { userId: 'u', name: null, role: 'super_admin' }, submittedAt: null, succeededAt: null, failedAt: null, failureCode: null } });
    fireEvent.click(within(dialog).getByTestId('m3-item-refund-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][2].expectedRefundCents).toBe(31_500);
  });

  it('409 ITEM_REFUND_NOT_AVAILABLE already_refunded ⇒ cierra y la página lo dice', async () => {
    vi.spyOn(api, 'refundDeliveredItem').mockRejectedValueOnce(
      new ApiClientError(409, { code: 'ITEM_REFUND_NOT_AVAILABLE', message: 'x', details: { reason: 'already_refunded', refundId: 'pr-9' } }),
    );
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByLabelText(/No llegó/));
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: 'no llegó' } });
    fireEvent.click(within(dialog).getByTestId('m3-item-refund-confirm'));
    expect(await screen.findByText('Esta carta ya se había reembolsado. No se reembolsó otra vez.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reembolsar una carta entregada' })).not.toBeInTheDocument());
  });

  it('el libro pinta `item_delivered` como «Carta tras la entrega»', async () => {
    const d = structuredClone(DETAIL);
    d.refunds = [{ id: 'pr-1', kind: 'item_delivered', status: 'succeeded', amountCents: 31_458, missingReason: null, deliveredReason: 'not_arrived', requestedAt: '2026-10-05T00:00:00Z', requestedBy: { userId: 'u', name: 'Dueño', role: 'super_admin' }, submittedAt: null, succeededAt: null, failedAt: null, failureCode: null }];
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(d);
    renderWithProviders(<M3OrderDetailView orderId="ord-7001" />, 'es');
    expect(await screen.findByTestId('m3-refund-pr-1')).toHaveTextContent('Carta tras la entrega');
  });
});
