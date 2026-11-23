import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import { mockAdminBuylist, mockAdminBuylistDTO } from '@/lib/mock/fixtures';
import type { AdminBuylistDTO } from '@/types/contract';
import { BuylistCycleQueues } from './BuylistCycleQueues';
import { PaymentReceipt, PayoutBar, RequestRibbon, ReviewLineFacts, SpeiPayModal } from './BuylistFlowParts';

function reqOf(id: string, over: Partial<AdminBuylistDTO> = {}): AdminBuylistDTO {
  const row = mockAdminBuylist.find((r) => r.id === id)!;
  return { ...mockAdminBuylistDTO(row), ...over };
}
const PAYOUT = { grossCents: 2653000, shippingFeeCents: 18000, netCents: 2635000, isFinal: true, clabeOnFile: true };

function openModal(req: AdminBuylistDTO, extra: Partial<React.ComponentProps<typeof SpeiPayModal>> = {}) {
  const props = { req, onClose: vi.fn(), onPaid: vi.fn(), onStale: vi.fn(), getError: (e: unknown) => String((e as Error).message), ...extra };
  renderWithProviders(<SpeiPayModal {...props} />, 'es');
  return props;
}

async function fillAndConfirm() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Referencia o clave de rastreo del SPEI'), { target: { value: 'REF-1' } });
  const confirm = await within(dialog).findByRole('button', { name: /Confirmar pago de/ });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  fireEvent.click(confirm);
  return dialog;
}

beforeEach(() => vi.restoreAllMocks());

describe('F1a · modal SPEI (un paso)', () => {
  it('muestra Se deposita, Bruto − Envío, CLABE y titular; el neto mostrado == expectedNetCents enviado', async () => {
    vi.spyOn(api, 'revealBuylistClabe').mockResolvedValue({ sellRequestId: 'sr-3003', clabe: '002010077777777771', holderName: 'Mariana Torres Ruiz' });
    const pay = vi.spyOn(api, 'paySpeiBuylist').mockResolvedValue({} as AdminBuylistDTO);
    const props = openModal(reqOf('sr-3003', { payout: PAYOUT }));
    expect(await screen.findByTestId('spei-clabe')).toHaveTextContent('002 010 07777777777 1');
    expect(screen.getByTestId('spei-holder')).toHaveTextContent('Mariana Torres Ruiz');
    const shown = screen.getByTestId('spei-net').textContent;
    expect(shown).toBe(formatMoneyCents(2635000, 'es'));
    await fillAndConfirm();
    await waitFor(() => expect(pay).toHaveBeenCalledWith('sr-3003', 'REF-1', 2635000));
    expect(shown).toBe(formatMoneyCents(pay.mock.calls[0][2] as number, 'es'));
    await waitFor(() => expect(props.onPaid).toHaveBeenCalledWith('sr-3003', null));
  });

  it('409 PAYOUT_CHANGED: recarga la solicitud, muestra el monto nuevo y reenvía ESE neto', async () => {
    vi.spyOn(api, 'revealBuylistClabe').mockResolvedValue({ sellRequestId: 'sr-3003', clabe: '002010077777777771', holderName: 'X' });
    const pay = vi
      .spyOn(api, 'paySpeiBuylist')
      .mockRejectedValueOnce(
        new ApiClientError(409, { code: 'PAYOUT_CHANGED', message: 'changed', details: { expectedNetCents: 2635000, currentNetCents: 2600000 } }),
      )
      .mockResolvedValue({} as AdminBuylistDTO);
    const props = openModal(reqOf('sr-3003', { payout: PAYOUT }));
    await fillAndConfirm();
    expect(await screen.findByTestId('spei-changed')).toHaveTextContent(formatMoneyCents(2600000, 'es'));
    expect(props.onStale).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('spei-net')).toHaveTextContent(formatMoneyCents(2600000, 'es'));
    expect(props.onPaid).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: /Confirmar pago de/ });
    fireEvent.click(confirm);
    await waitFor(() => expect(pay).toHaveBeenLastCalledWith('sr-3003', 'REF-1', 2600000));
  });

  it('F2c · 409 REVISION_PENDING: una baja sin respuesta bloquea el pago, con su copy y recarga', async () => {
    vi.spyOn(api, 'revealBuylistClabe').mockResolvedValue({ sellRequestId: 'sr-3003', clabe: '002010077777777771', holderName: 'X' });
    vi.spyOn(api, 'paySpeiBuylist').mockRejectedValue(
      new ApiClientError(409, { code: 'REVISION_PENDING', message: 'srv', details: { itemIds: ['sri-f2-3'] } }),
    );
    const props = openModal(reqOf('sr-3003', { payout: PAYOUT }));
    await fillAndConfirm();
    expect(await screen.findByText(/Hay una baja de precio esperando al vendedor/)).toBeInTheDocument();
    expect(props.onStale).toHaveBeenCalledTimes(1);
    expect(props.onPaid).not.toHaveBeenCalled();
  });

  it('422 CLABE_MISSING: el remedio sale en texto claro y no se puede confirmar', async () => {
    vi.spyOn(api, 'revealBuylistClabe').mockRejectedValue(
      new ApiClientError(422, { code: 'CLABE_MISSING', message: 'no clabe', details: { remedy: 'ask_seller_clabe' } }),
    );
    openModal(reqOf('sr-3003', { payout: PAYOUT }));
    expect(await screen.findByTestId('spei-clabe-missing')).toHaveTextContent(/no tiene CLABE guardada\. Pídele que la capture/);
    fireEvent.change(screen.getByLabelText('Referencia o clave de rastreo del SPEI'), { target: { value: 'R' } });
    expect(screen.getByRole('button', { name: /Confirmar pago de/ })).toBeDisabled();
  });
});

describe('I-1 · montos estimados: solo se rotulan, el monto es el del servidor', () => {
  it('barra: isFinal=false ⇒ «Se deposita (estimado)»; isFinal=true ⇒ «Se deposita»; el monto no cambia', () => {
    const est = reqOf('sr-3003', { payout: { ...PAYOUT, isFinal: false } });
    const { unmount } = renderWithProviders(<PayoutBar req={est} pendingDecisions={1} action={null} />, 'es');
    expect(screen.getByTestId('payout-net-label')).toHaveTextContent('Se deposita (estimado)');
    expect(screen.getByTestId('payout-net').textContent).toBe(formatMoneyCents(2635000, 'es'));
    unmount();
    renderWithProviders(<PayoutBar req={reqOf('sr-3003', { payout: PAYOUT })} pendingDecisions={0} action={null} />, 'es');
    expect(screen.getByTestId('payout-net-label').textContent).toBe('Se deposita');
  });

  it('modal SPEI con isFinal=false ⇒ «Se deposita (estimado)»', async () => {
    vi.spyOn(api, 'revealBuylistClabe').mockResolvedValue({ sellRequestId: 'sr-3003', clabe: '002010077777777771', holderName: 'X' });
    openModal(reqOf('sr-3003', { payout: { ...PAYOUT, isFinal: false } }));
    expect(await screen.findByTestId('spei-deposit')).toHaveTextContent('Se deposita (estimado)');
  });
});

describe('F1a · replay idempotente (qa M-4/M-3)', () => {
  it('onPaid recibe el neto de la RESPUESTA (lo sellado), no el enviado; el enviado es entero', async () => {
    vi.spyOn(api, 'revealBuylistClabe').mockResolvedValue({ sellRequestId: 'sr-3003', clabe: '002010077777777771', holderName: 'X' });
    const pay = vi.spyOn(api, 'paySpeiBuylist').mockResolvedValue({ payout: { ...PAYOUT, netCents: 2600000 } } as AdminBuylistDTO);
    const props = openModal(reqOf('sr-3003', { payout: PAYOUT }));
    await fillAndConfirm();
    await waitFor(() => expect(props.onPaid).toHaveBeenCalledWith('sr-3003', 2600000));
    expect(Number.isInteger(pay.mock.calls[0][2])).toBe(true);
  });
});

describe('F1b · fila de revisión', () => {
  it('pinta el PACTADO, no el cotizado, y el chip de mercado ±%', async () => {
    vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue({
      sellRequestId: 'x',
      lines: [{ itemId: 'it-1', marketMxnCents: 1920000 }],
    } as never);
    const item = { ...reqOf('sr-3003').items[0], id: 'it-1', quotedPriceCents: 2000000, offeredPriceCents: 1850000, agreedPriceCents: 1850000 };
    renderWithProviders(<ReviewLineFacts requestId="x" item={item} />, 'es');
    expect(screen.getByTestId('agreed-it-1')).toHaveTextContent(formatMoneyCents(1850000, 'es'));
    expect(screen.getByTestId('agreed-it-1')).not.toHaveTextContent(formatMoneyCents(2000000, 'es'));
    expect(await screen.findByTestId('market-chip-it-1')).toHaveTextContent('▲ +3.8 %');
  });
});

describe('F1b · ofertado original en revisión', () => {
  const base = () => ({ ...reqOf('sr-3003').items[0], id: 'it-1', quotedPriceCents: 2000000, offeredPriceCents: 1850000 });
  beforeEach(() => {
    vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue({ sellRequestId: 'x', lines: [] } as never);
  });
  it('baja aceptada: pactado y ofertado original', () => {
    renderWithProviders(<ReviewLineFacts requestId="x" item={{ ...base(), agreedPriceCents: 1500000 }} />, 'es');
    expect(screen.getByTestId('agreed-it-1')).toHaveTextContent(formatMoneyCents(1500000, 'es'));
    expect(screen.getByTestId('offered-original-it-1')).toHaveTextContent(`Ofertado: ${formatMoneyCents(1850000, 'es')}`);
    // m-29: con baja aceptada el rótulo NO dice «lo que ofrecimos» (contradiría al ofertado original).
    expect(screen.getByTestId('review-facts-it-1')).not.toHaveTextContent('lo que ofrecimos');
    expect(screen.getByTestId('review-facts-it-1')).toHaveTextContent('Precio pactado');
  });
  it('sin baja: el rótulo sigue «Precio pactado · lo que ofrecimos»', () => {
    renderWithProviders(<ReviewLineFacts requestId="x" item={{ ...base(), agreedPriceCents: 1850000 }} />, 'es');
    expect(screen.getByTestId('review-facts-it-1')).toHaveTextContent('Precio pactado · lo que ofrecimos');
  });
  it('m-34: en inglés el rótulo es «Agreed price» (con baja) y «Agreed price · what we offered» (sin baja)', () => {
    const a = renderWithProviders(<ReviewLineFacts requestId="x" item={{ ...base(), agreedPriceCents: 1500000 }} />, 'en');
    expect(screen.getByTestId('review-facts-it-1')).toHaveTextContent('Agreed price');
    expect(screen.getByTestId('review-facts-it-1')).not.toHaveTextContent('what we offered');
    expect(screen.getByTestId('review-facts-it-1')).not.toHaveTextContent('Precio pactado');
    a.unmount();
    renderWithProviders(<ReviewLineFacts requestId="x" item={{ ...base(), agreedPriceCents: 1850000 }} />, 'en');
    expect(screen.getByTestId('review-facts-it-1')).toHaveTextContent('Agreed price · what we offered');
  });
  it('m-27: sin ofertado (null) no pinta «MX$0.00» ni línea extra', () => {
    renderWithProviders(<ReviewLineFacts requestId="x" item={{ ...base(), offeredPriceCents: null, agreedPriceCents: 1500000 }} />, 'es');
    expect(screen.queryByTestId('offered-original-it-1')).toBeNull();
    expect(screen.getByTestId('review-facts-it-1')).not.toHaveTextContent('MX$0.00');
  });
  it('m-27: sin pactado (null) no pinta el ofertado original', () => {
    renderWithProviders(<ReviewLineFacts requestId="x" item={{ ...base(), agreedPriceCents: null }} />, 'es');
    expect(screen.queryByTestId('offered-original-it-1')).toBeNull();
  });
  it('iguales o sin pactado: sin línea extra', () => {
    renderWithProviders(<ReviewLineFacts requestId="x" item={{ ...base(), agreedPriceCents: 1850000 }} />, 'es');
    expect(screen.queryByTestId('offered-original-it-1')).toBeNull();
  });
});

describe('comprobantes y cinta', () => {
  it('comprobante de pago SPEI: referencia, fecha y neto', () => {
    const req = reqOf('sr-3003', { status: 'pagada', speiReference: 'MBAN-9', paidAt: '2026-11-20T18:00:00Z', payout: PAYOUT });
    renderWithProviders(<PaymentReceipt req={req} />, 'es');
    expect(screen.getByTestId('receipt-reference')).toHaveTextContent('MBAN-9');
    expect(screen.getByTestId('receipt-date')).toHaveTextContent(/20 nov 2026/);
    expect(screen.getByTestId('receipt-net')).toHaveTextContent(formatMoneyCents(2635000, 'es'));
  });

  it('cinta: ofertado neto, vence, rastreo con enlace y «lleva N días»', () => {
    const req = reqOf('sr-3003', {
      status: 'en_transito',
      offerNet: { grossCents: 2653000, shippingFeeCents: 18000, netCents: 2635000, expiresAt: '2026-11-25T18:00:00Z' },
      statusClock: { since: '2026-11-19T10:00:00Z', waitingDays: 3, dueAt: '2026-11-25T18:00:00Z', overdue: false },
      tracking: { carrier: 'Estafeta', number: '8012', url: 'https://track.example/8012', daysInTransit: 3 },
    });
    renderWithProviders(<RequestRibbon req={req} />, 'es');
    expect(screen.getByTestId('ribbon-net')).toHaveTextContent(formatMoneyCents(2635000, 'es'));
    expect(screen.getByTestId('ribbon-expires')).toHaveTextContent(/25 nov 2026/);
    expect(screen.getByTestId('ribbon-tracking-link')).toHaveAttribute('href', 'https://track.example/8012');
    expect(screen.getByTestId('ribbon-waiting')).toHaveTextContent('3 días en camino');
  });

  it('cinta sin statusClock (servidor anterior) no se pinta', () => {
    const { container } = renderWithProviders(<RequestRibbon req={reqOf('sr-3003', { statusClock: undefined })} />, 'es');
    expect(container.querySelector('[data-testid^="ribbon-"]')).toBeNull();
  });
});

describe('F1c · colas: enlace «Abrir solicitud»', () => {
  it('cada fila de la cola trae un enlace explícito que abre la solicitud', async () => {
    vi.spyOn(api, 'getPendingOfferAuthorizations').mockResolvedValue({
      data: [
        {
          sellRequestId: 'sr-auth-1', seller: { id: 'u', name: 'Ash', email: 'a@x.mx' }, preparedBy: 'op', offerPreparedAt: '2026-08-29T15:00:00.000Z',
          offerGrossCents: 200000, operatorCapCents: 150000, excessCents: 50000, lineCount: 4, buyLineCount: 3, caducityAt: '2026-12-01T18:00:00.000Z',
        },
      ],
      page: 1, pageSize: 20, total: 1,
    } as never);
    const onOpen = vi.fn();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin onOpenRequest={onOpen} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir solicitud sr-auth-1' }));
    expect(onOpen).toHaveBeenCalledWith('sr-auth-1');
  });
});

describe('fixture de la mesa', () => {
  it('el motivo sinceQuote concuerda con el signo del delta (no «bajó» cuando subió)', async () => {
    const { mockDecisionTable } = await import('@/lib/mock/fixtures');
    for (const r of mockAdminBuylist) {
      for (const l of mockDecisionTable(r.id).lines) {
        if (!l.sinceQuote) continue;
        expect(l.sinceQuote.reasonCode).toBe(l.sinceQuote.deltaCents > 0 ? 'MARKET_UP' : 'MARKET_DOWN');
      }
    }
  });
});
