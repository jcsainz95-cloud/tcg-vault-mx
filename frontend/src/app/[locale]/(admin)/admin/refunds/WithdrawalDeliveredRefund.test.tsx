import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import { formatMoneyCents } from '@/lib/format';
import type { ManualRefundDTO } from '@/types/contract';

/**
 * 💰 DESIGN_SYSTEM §60.4 · contrato v1.82 §PNL.3 — «Devolver una carta de un retiro entregado» por SPEI.
 * Candados WDR-UI-1 (= FE-WDR-1), WDR-UI-2 y WDR-UI-3. El «servidor» es el mock con estado (`shp-7201`, Ana, entregado).
 */
const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/refunds',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import { RefundsView } from './RefundsView';
// eslint-disable-next-line import/first
import { ManualRefundsView } from '../manual-refunds/ManualRefundsView';
// eslint-disable-next-line import/first
import { ManualRefundDetailView } from '../manual-refunds/[id]/ManualRefundDetailView';

const money = (c: number) => formatMoneyCents(c, 'es');

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
  window.localStorage.setItem('tcg.role', 'super_admin');
});
afterEach(() => window.localStorage.removeItem('tcg.role'));

async function toStep3() {
  renderWithProviders(<RefundsView />, 'es');
  fireEvent.click(await screen.findByTestId('refunds-withdrawal-delivered-cta'));
  const dialog = await screen.findByRole('dialog', { name: 'Devolver una carta de un retiro entregado' });
  fireEvent.change(within(dialog).getByTestId('wd-refund-search'), { target: { value: 'Ana' } });
  fireEvent.click(await within(dialog).findByTestId('wd-refund-result-shp-7201', {}, { timeout: 3000 }));
  const radios = await within(dialog).findAllByRole('radio', { name: /Charizard|Blastoise/ });
  for (const r of radios) expect(r).not.toBeChecked(); // ⛔ sin preselección
  fireEvent.click(within(dialog).getByRole('radio', { name: /Charizard/ }));
  fireEvent.click(within(dialog).getByTestId('wd-refund-next'));
  await within(dialog).findByTestId('wd-refund-amount');
  return dialog;
}

describe('§60.4 · SPEI de UNA carta de un retiro ENTREGADO', () => {
  it('paso 1: un retiro NO entregado se ve deshabilitado con su razón; paso 2: la que faltó al preparar, deshabilitada', async () => {
    renderWithProviders(<RefundsView />, 'es');
    fireEvent.click(await screen.findByTestId('refunds-withdrawal-delivered-cta'));
    const dialog = await screen.findByRole('dialog', { name: 'Devolver una carta de un retiro entregado' });
    fireEvent.change(within(dialog).getByTestId('wd-refund-search'), { target: { value: 'example' } });
    const results = await within(dialog).findByTestId('wd-refund-results', {}, { timeout: 3000 });
    const notDelivered = within(results).getAllByRole('button').filter((b) => b.hasAttribute('disabled'));
    expect(notDelivered.length).toBeGreaterThan(0);
    expect(notDelivered[0]).toHaveTextContent(/Aún no está entregado/);
    fireEvent.click(within(dialog).getByTestId('wd-refund-result-shp-7201'));
    expect(await within(dialog).findByRole('radio', { name: /Blastoise/ })).toBeDisabled();
  });

  it('WDR-UI-2 · el monto nace VACÍO con referencias (y la nota pide la cifra)', async () => {
    const dialog = await toStep3();
    expect(within(dialog).getByTestId('wd-refund-amount')).toHaveValue('');
    expect(await within(dialog).findByText(`Pagó ${money(52_000)} por esta carta`)).toBeInTheDocument();
  });

  it('WDR-UI-2 · sin compra de origen ni mercado: el monto también nace vacío y lo dice', async () => {
    vi.spyOn(api, 'previewWithdrawalDeliveredRefund').mockResolvedValue({
      amountCents: null, paidReferenceCents: null, market: null, referenceCents: 0, confirmAboveCents: 0, limitCents: 0, confirmation: null,
    });
    const dialog = await toStep3();
    expect(within(dialog).getByTestId('wd-refund-amount')).toHaveValue('');
    expect(await within(dialog).findByText('Sin compra de origen conocida')).toBeInTheDocument();
    expect(within(dialog).getByText('Sin referencia de mercado')).toBeInTheDocument();
  });

  it('WDR-UI-1 · monto > 2R ⇒ segundo diálogo; pegar bloqueado; el reenvío lleva `confirmAboveReference: true`', async () => {
    const create = vi.spyOn(api, 'createWithdrawalDeliveredRefund');
    const dialog = await toStep3();
    fireEvent.change(within(dialog).getByTestId('wd-refund-amount'), { target: { value: '1100' } }); // 110000 > 2·52000
    fireEvent.click(within(dialog).getByLabelText(/Llegó en mala condición/));
    fireEvent.change(within(dialog).getByTestId('wd-refund-note'), { target: { value: 'Llegó doblada; TCGplayer NM 1100' } });
    await within(dialog).findByText(/te pediremos escribir el monto otra vez/, {}, { timeout: 3000 });
    fireEvent.click(within(dialog).getByTestId('wd-refund-submit'));

    const retype = await screen.findByRole('dialog', { name: 'Confirma el monto escribiéndolo otra vez' });
    expect(create).not.toHaveBeenCalled();
    const input = within(retype).getByTestId('wd-refund-retype');
    fireEvent.paste(input, { clipboardData: { getData: () => '1100' } });
    expect(input).toHaveValue('');
    expect(within(retype).getByText('Escríbelo a mano')).toBeInTheDocument();
    expect(within(retype).getByTestId('wd-refund-retype-submit')).toBeDisabled();
    fireEvent.change(input, { target: { value: '1100' } });
    fireEvent.click(within(retype).getByTestId('wd-refund-retype-submit'));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toEqual({
      shipmentItemId: 'sit-7201-1',
      reason: 'arrived_damaged',
      note: 'Llegó doblada; TCGplayer NM 1100',
      amountCents: 110_000,
      confirmAboveReference: true,
    });
    expect(await screen.findByTestId('refunds-withdrawal-delivered-done')).toHaveTextContent(`Transferencia de ${money(110_000)} creada para`);
  });

  it('monto ≤ 2R ⇒ sin segundo diálogo y sin `confirmAboveReference`', async () => {
    const create = vi.spyOn(api, 'createWithdrawalDeliveredRefund');
    const dialog = await toStep3();
    fireEvent.change(within(dialog).getByTestId('wd-refund-amount'), { target: { value: '520' } });
    fireEvent.click(within(dialog).getByLabelText(/No llegó/));
    fireEvent.change(within(dialog).getByTestId('wd-refund-note'), { target: { value: 'no llegó el sobre' } });
    await within(dialog).findByText('Todo va por transferencia (cubeta SPEI): no se toca la tarjeta.', {}, { timeout: 3000 });
    fireEvent.click(within(dialog).getByTestId('wd-refund-submit'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).not.toHaveProperty('confirmAboveReference');
  });
});

/** WDR-UI-3: una fila `case: null, source: 'withdrawal_delivered'` ⇒ la lista y el detalle pintan sin error. */
describe('WDR-UI-3 · la cubeta SPEI con `case: null`', () => {
  const row: ManualRefundDTO = {
    id: 'mr-wd-1', source: 'withdrawal_delivered', status: 'pending', amountCents: 52_000,
    components: { merchandiseCents: 0, merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 52_000 },
    customer: { userId: 'u-777', fullName: 'Ana López', email: 'ana@example.com' },
    beneficiaryName: 'Ana López', clabeOnFile: true, clabeMasked: '****1234',
    case: null,
    withdrawal: {
      shipmentId: 'shp-7201', shipmentItemId: 'sit-7201-1',
      card: { name: 'Charizard', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
      folio: 'INV-007201', reason: 'arrived_damaged', note: 'Llegó doblada', deliveredAt: '2026-09-25T18:00:00Z',
    },
    origin: null, paymentRefundId: null, createdAt: '2026-10-05T00:00:00Z', createdBy: { userId: 'u-admin', name: 'Dueño' },
    paidAt: null, paidBy: null, speiReference: null, paidNote: null, paidToCurrentClabe: null,
    cancelledAt: null, cancelledBy: null, cancelNote: null,
    clabeUpdatedAt: null, clabeChangedRecently: false, reissuedFromId: null, reissuedAsId: null,
  };

  it('lista: «Por qué» = «Retiro entregado · carta · folio · motivo»', async () => {
    vi.spyOn(api, 'getManualRefunds').mockResolvedValue({ data: [row], page: 1, pageSize: 25, total: 1, pendingCents: 52_000 });
    renderWithProviders(<ManualRefundsView />, 'es');
    const r = await screen.findByTestId('mr-row-mr-wd-1');
    expect(r).toHaveTextContent('Retiro entregado · Charizard · INV-007201 · Llegó en mala condición');
  });

  it('detalle: bloque «Retiro entregado» con motivo y nota; sin enlace a caso', async () => {
    vi.spyOn(api, 'getManualRefund').mockResolvedValue(row);
    renderWithProviders(<ManualRefundDetailView id="mr-wd-1" />, 'es');
    const block = await screen.findByTestId('mr-withdrawal-block');
    expect(block).toHaveTextContent('Retiro entregado');
    expect(block).toHaveTextContent('Llegó en mala condición');
    expect(block).toHaveTextContent('Llegó doblada');
    expect(screen.queryByText('Ver caso')).not.toBeInTheDocument();
  });
});
