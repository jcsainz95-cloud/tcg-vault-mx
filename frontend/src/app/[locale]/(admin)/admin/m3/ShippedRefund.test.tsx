import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import type { AdminOrderDTO, AdminOrderDetailDTO, FullRefundReviewDTO, RefundOrderResponse } from '@/types/contract';
import { RefundOrderDialog } from './RefundOrderDialog';
import { M3View } from './M3View';
import M3Page from './page';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';

/**
 * 💰 `DESIGN_SYSTEM §40` (v4.12) · `API_CONTRACT §M4-SHIP.18.12` (v1.80.8.6, punto 9 en v1.80.8.7) — reembolso TOTAL
 * «depende de si ya salió». Candados SR-UI-1…SR-UI-8 (§40.11) + el banner de §40.4 con `settledAt` (A-1).
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

const DIRECT: AdminOrderDTO = { id: 'ord-9002', orderNumber: 'TCG-009002', userId: 'u-780', status: 'settled', totalCents: 99_617, createdAt: '2026-09-01T10:00:00Z', fulfillmentMode: 'direct_ship' } as AdminOrderDTO;
const VAULT: AdminOrderDTO = { ...DIRECT, id: 'ord-9001', orderNumber: 'TCG-009001', fulfillmentMode: 'vault' } as AdminOrderDTO;
const OK: RefundOrderResponse = { orderId: 'ord-9002', status: 'refunded', refundId: 'pr_1' };

/** Detalle REAL del mock con `over` encima (lo que el servidor diría de ese pedido). */
function serveDetail(over: Partial<AdminOrderDetailDTO> | ((n: number) => Partial<AdminOrderDetailDTO>)) {
  const real = api.getAdminOrder;
  let n = 0;
  return vi.spyOn(api, 'getAdminOrder').mockImplementation(async (id: string) => {
    n += 1;
    const extra = typeof over === 'function' ? over(n) : over;
    return { ...(await real(id)), ...extra };
  });
}

function renderDialog(order: AdminOrderDTO = DIRECT, onDone = vi.fn()) {
  renderWithProviders(<RefundOrderDialog order={order} open onClose={() => {}} onDone={onDone} />, 'es');
  return onDone;
}
const confirmBtn = (dialog: HTMLElement) => within(dialog).getByTestId('m3-refund-confirm');

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
  window.localStorage.setItem('tcg.role', 'super_admin');
});
afterEach(() => {
  window.localStorage.removeItem('tcg.role');
});

describe('§40.2 · el diálogo de reembolso total (M3)', () => {
  it('SR-UI-1 · `shipmentShipped: true` ⇒ aviso, ningún radio marcado, «Reembolsar» apagado hasta motivo Y nota; el POST lleva `shippedReason`', async () => {
    serveDetail({ shipmentShipped: true });
    const post = vi.spyOn(api, 'refundOrder').mockResolvedValue(OK);
    const onDone = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });

    expect(await within(dialog).findByTestId('m3-shipped-warning')).toHaveTextContent('Las cartas no vuelven a inventario');
    expect(dialog).toHaveTextContent('Este pedido ya salió');
    const radios = within(within(dialog).getByTestId('m3-refund-shipped-reason')).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).not.toBeChecked();
    expect(dialog).toHaveTextContent('Elige uno de los dos para poder reembolsar.');
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('radio', { name: /No llegó/ }));
    expect(confirmBtn(dialog)).toBeDisabled(); // falta la nota
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: '  guía sin movimiento 10 días  ' } });
    expect(confirmBtn(dialog)).toBeEnabled();
    fireEvent.click(confirmBtn(dialog));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toEqual({ reason: 'guía sin movimiento 10 días', shippedReason: 'not_arrived' });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0][1]).toEqual({ shippedReason: 'not_arrived' });
  });

  it.each([
    ['directo', DIRECT],
    ['bóveda', VAULT],
  ])('SR-UI-2 · `shipmentShipped: false` (%s) ⇒ sin `fieldset` de motivo y el cuerpo SIN la clave `shippedReason`', async (_l, order) => {
    serveDetail({ shipmentShipped: false });
    const post = vi.spyOn(api, 'refundOrder').mockResolvedValue({ ...OK, orderId: order.id });
    renderDialog(order);
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    const reason = within(dialog).getByLabelText('Motivo del reembolso');
    fireEvent.change(reason, { target: { value: 'cobro doble' } });
    await waitFor(() => expect(confirmBtn(dialog)).toBeEnabled());
    expect(within(dialog).queryByTestId('m3-refund-shipped-reason')).toBeNull();
    expect(within(dialog).queryByTestId('m3-shipped-warning')).toBeNull();
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toEqual({ reason: 'cobro doble' });
    // `toEqual` ignora claves con `undefined`: se exige que la clave NO EXISTA.
    expect(Object.keys(post.mock.calls[0][1])).toEqual(['reason']);
  });

  it('SR-UI-3 · `422 {required:["shipped_reason"]}` ⇒ selector, la nota SIGUE, ⛔ sin casilla de bóveda, foco en la `legend`', async () => {
    serveDetail({ shipmentShipped: false });
    const post = vi
      .spyOn(api, 'refundOrder')
      .mockRejectedValueOnce(
        new ApiClientError(422, { code: 'REFUND_CONFIRMATION_REQUIRED', message: 'x', details: { required: ['shipped_reason'], shipmentStatus: 'enviado' } }),
      )
      .mockResolvedValueOnce(OK);
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    fireEvent.change(within(dialog).getByLabelText('Motivo del reembolso'), { target: { value: 'llegó roto' } });
    await waitFor(() => expect(confirmBtn(dialog)).toBeEnabled());
    fireEvent.click(confirmBtn(dialog));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Este pedido salió mientras tenías abierto el diálogo');
    expect(alert).toHaveTextContent('No se reembolsó nada.');
    const fieldset = within(dialog).getByTestId('m3-refund-shipped-reason');
    expect((within(dialog).getByLabelText('Qué pasó') as HTMLTextAreaElement).value).toBe('llegó roto');
    expect(within(dialog).queryByTestId('m3-confirm-pieces')).toBeNull();
    await waitFor(() => expect(fieldset.querySelector('legend')).toHaveFocus());
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Llegó en mala condición/ }));
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ reason: 'llegó roto', shippedReason: 'arrived_damaged' });
  });

  it('SR-UI-4 · `409 SHIPPED_REFUND_REASON_NOT_APPLICABLE` ⇒ el selector desaparece y el segundo POST va SIN `shippedReason`', async () => {
    serveDetail({ shipmentShipped: true });
    const post = vi
      .spyOn(api, 'refundOrder')
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'SHIPPED_REFUND_REASON_NOT_APPLICABLE', message: 'x', details: { afterShipment: false } }))
      .mockResolvedValueOnce(OK);
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    fireEvent.click(await within(dialog).findByRole('radio', { name: /No llegó/ }));
    fireEvent.change(within(dialog).getByLabelText('Qué pasó'), { target: { value: 'nota' } });
    fireEvent.click(confirmBtn(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Este pedido no ha salido: no lleva motivo de envío.');
    await waitFor(() => expect(within(dialog).queryByTestId('m3-refund-shipped-reason')).toBeNull());
    // La nota se conserva.
    expect((within(dialog).getByLabelText('Motivo del reembolso') as HTMLInputElement).value).toBe('nota');
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ reason: 'nota' });
    expect(Object.keys(post.mock.calls[1][1])).toEqual(['reason']);
  });

  it('el `422 {required:["pieces_with_customer"]}` sigue siendo la casilla de bóveda (sin regresión)', async () => {
    serveDetail({ shipmentShipped: false });
    vi.spyOn(api, 'refundOrder').mockRejectedValueOnce(
      new ApiClientError(422, {
        code: 'REFUND_CONFIRMATION_REQUIRED',
        message: 'x',
        details: { required: ['pieces_with_customer'], items: [{ inventoryItemId: 'inv-1090', folio: 'INV-001090', state: 'already_withdrawn' }] },
      }),
    );
    renderDialog(VAULT);
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    fireEvent.change(within(dialog).getByLabelText('Motivo del reembolso'), { target: { value: 'x' } });
    await waitFor(() => expect(confirmBtn(dialog)).toBeEnabled());
    fireEvent.click(confirmBtn(dialog));
    expect(await within(dialog).findByTestId('m3-confirm-pieces')).not.toBeChecked();
    expect(within(dialog).queryByTestId('m3-refund-shipped-reason')).toBeNull();
  });
});

describe('§40.3 (a)(b) · «Reembolso por revisar» en el listado', () => {
  const row = (id: string, refundReviewPending: boolean): AdminOrderDTO =>
    ({ id, orderNumber: id.toUpperCase(), userId: 'u-1', status: 'refunded', totalCents: 1000, createdAt: '2026-09-01T10:00:00Z', refundReviewPending }) as AdminOrderDTO;

  it('SR-UI-5 · la marca «Por revisar» solo en la fila con `refundReviewPending: true`', async () => {
    vi.spyOn(api, 'getAdminOrders').mockResolvedValue({ data: [row('ord-a', true), row('ord-b', false)], page: 1, pageSize: 25, total: 2 });
    renderWithProviders(<M3View />, 'es');
    const chips = await screen.findAllByTestId('m3-review-chip-ord-a');
    for (const c of chips) expect(c).toHaveTextContent('Por revisar');
    expect(screen.queryByTestId('m3-review-chip-ord-b')).toBeNull();
  });

  it('SR-UI-6 · `?refundReview=pending` ⇒ casilla marcada y la PRIMERA llamada lleva `refundReview:"pending"`; vacío con su texto', async () => {
    const spy = vi.spyOn(api, 'getAdminOrders').mockResolvedValue({ data: [], page: 1, pageSize: 25, total: 0 });
    renderWithProviders(await M3Page({ searchParams: Promise.resolve({ refundReview: 'pending' }) }), 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ refundReview: 'pending' });
    expect(screen.getByTestId('m3-refund-review-filter')).toBeChecked();
    expect(await screen.findByText('No hay reembolsos por revisar.')).toBeInTheDocument();
  });

  it('SR-UI-6 · `?refundReview=basura` ⇒ casilla desmarcada y la llamada SIN el parámetro; marcarla reemplaza la URL', async () => {
    const spy = vi.spyOn(api, 'getAdminOrders').mockResolvedValue({ data: [], page: 1, pageSize: 25, total: 0 });
    const replace = vi.spyOn(window.history, 'replaceState');
    renderWithProviders(await M3Page({ searchParams: Promise.resolve({ refundReview: 'basura' }) }), 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect('refundReview' in spy.mock.calls[0][0]!).toBe(false);
    const box = screen.getByTestId('m3-refund-review-filter');
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    await waitFor(() => expect(spy.mock.calls.at(-1)![0]).toMatchObject({ refundReview: 'pending', page: 1 }));
    expect(replace).toHaveBeenCalled();
    expect(String(replace.mock.calls.at(-1)![2])).toContain('refundReview=pending');
  });
});

describe('§40.3 (c)(d) y §40.4 · el detalle', () => {
  const PENDING: FullRefundReviewDTO = { afterShipment: true, pending: true, reason: null, note: null, recordedAt: null, recordedBy: null };
  const RECORDED: FullRefundReviewDTO = {
    afterShipment: true,
    pending: false,
    reason: 'not_arrived',
    note: 'guía perdida',
    recordedAt: '2026-10-04T15:00:00Z',
    recordedBy: { id: 'u-sa1', name: 'Dueño' },
  };

  it('SR-UI-7 · súper-admin: formulario ⇒ confirmar ⇒ POST con el motivo y la nota recortada; `200 recorded` ⇒ lectura sin botón', async () => {
    serveDetail((n) => ({ status: 'refunded', fullRefundReview: n === 1 ? PENDING : RECORDED }));
    const post = vi.spyOn(api, 'recordShippedRefundReason').mockResolvedValue({ orderId: 'ord-9001', outcome: 'recorded', fullRefundReview: RECORDED });
    renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');

    expect(await screen.findByTestId('m3-refund-review-banner')).toHaveTextContent('Falta registrar por qué.');
    const form = screen.getByTestId('m3-refund-review');
    const cta = within(form).getByRole('button', { name: 'Registrar motivo' });
    expect(cta).toBeDisabled();
    for (const r of within(form).getAllByRole('radio')) expect(r).not.toBeChecked();
    fireEvent.click(within(form).getByRole('radio', { name: /No llegó/ }));
    fireEvent.change(within(form).getByLabelText('Nota (opcional)'), { target: { value: '  guía perdida  ' } });
    fireEvent.click(cta);

    const dialog = await screen.findByRole('dialog', { name: '¿Registrar «No llegó» como motivo?' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toEqual(['ord-9001', { reason: 'not_arrived', note: 'guía perdida' }]);

    expect(await screen.findByTestId('m3-notice')).toHaveTextContent('Motivo registrado: «No llegó».');
    const done = await screen.findByTestId('m3-refund-review-done');
    expect(done).toHaveTextContent('Motivo: No llegó');
    expect(done).toHaveTextContent('Nota: guía perdida');
    expect(done).toHaveTextContent('Registrado por Dueño');
    expect(screen.queryByTestId('m3-refund-review')).toBeNull();
    expect(screen.queryByRole('button', { name: /Registrar/ })).toBeNull();
  });

  it('SR-UI-7 · nota vacía ⇒ el POST la OMITE', async () => {
    serveDetail({ status: 'refunded', fullRefundReview: PENDING });
    const post = vi.spyOn(api, 'recordShippedRefundReason').mockResolvedValue({ orderId: 'ord-9001', outcome: 'recorded', fullRefundReview: RECORDED });
    renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');
    const form = await screen.findByTestId('m3-refund-review');
    fireEvent.click(within(form).getByRole('radio', { name: /Llegó en mala condición/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar motivo' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toEqual({ reason: 'arrived_damaged' });
  });

  it('SR-UI-7 · operador ⇒ banner + «Solo el súper-admin…», NINGÚN botón «Registrar»', async () => {
    roleState.role = 'vault_operator';
    serveDetail({ status: 'refunded', fullRefundReview: PENDING });
    renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');
    expect(await screen.findByTestId('m3-refund-review-banner')).toBeInTheDocument();
    expect(screen.getByTestId('m3-refund-review-operator')).toHaveTextContent('Solo el súper-admin puede registrar el motivo.');
    expect(screen.queryByTestId('m3-refund-review')).toBeNull();
    expect(screen.queryByRole('button', { name: /Registrar/ })).toBeNull();
  });

  it('SR-UI-8 · `409 …ALREADY_SET {reason:"arrived_damaged"}` ⇒ nombra «Llegó en mala condición»; ⛔ el valor crudo', async () => {
    serveDetail({ status: 'refunded', fullRefundReview: PENDING });
    vi.spyOn(api, 'recordShippedRefundReason').mockRejectedValue(
      new ApiClientError(409, { code: 'SHIPPED_REFUND_REASON_ALREADY_SET', message: 'x', details: { reason: 'arrived_damaged' } }),
    );
    const { container } = renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');
    const form = await screen.findByTestId('m3-refund-review');
    fireEvent.click(within(form).getByRole('radio', { name: /No llegó/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar motivo' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Registrar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Alguien ya registró otro motivo: «Llegó en mala condición». El motivo no se cambia.');
    expect(container.textContent).not.toMatch(/arrived_damaged|not_arrived/);
  });

  it('§40.4 · `refunded ∧ settledAt === null` ⇒ «Reembolsado antes de quedar pagado»; con fecha o con la clave AUSENTE ⇒ no', async () => {
    const real = api.getAdminOrder;
    const spy = vi.spyOn(api, 'getAdminOrder');
    spy.mockImplementation(async (id) => ({ ...(await real(id)), status: 'refunded', settledAt: null, fullRefundReview: null }));
    const first = renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');
    expect(await screen.findByTestId('m3-unsettled-refund')).toHaveTextContent('volvieron solas a la venta');
    first.unmount();

    spy.mockImplementation(async (id) => ({ ...(await real(id)), status: 'refunded', settledAt: '2026-09-01T10:02:00Z' }));
    const second = renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');
    await screen.findByTestId('m3-shipments');
    expect(screen.queryByTestId('m3-unsettled-refund')).toBeNull();
    second.unmount();

    spy.mockImplementation(async (id) => {
      const { settledAt: _drop, ...rest } = { ...(await real(id)), status: 'refunded' as const };
      void _drop;
      return rest as AdminOrderDetailDTO;
    });
    renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');
    await screen.findByTestId('m3-shipments');
    expect(screen.queryByTestId('m3-unsettled-refund')).toBeNull();
  });
});
