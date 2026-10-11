import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import type { AdminOrderDetailDTO, PaymentRefundDTO } from '@/types/contract';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';

/**
 * LIVE-5 (`API_CONTRACT §14.5`, techlead C-1 «menor»): el `409 CASE_ORIGIN_NOT_SETTLED` de `to-manual` trae
 * `originStatus:'settled'` cuando el motivo es del COBRO (`reason`). El mensaje dice el motivo real — ⛔ nunca
 * «reembolsada» para una orden que sigue `settled`.
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

const FAILED: PaymentRefundDTO = {
  id: 'pr-x1', kind: 'case_refund', status: 'failed', amountCents: 40_000, missingReason: null,
  requestedAt: '2026-09-02T10:00:00Z', requestedBy: { userId: 'u-sa1', name: 'Dueño', role: 'super_admin' },
  submittedAt: null, succeededAt: null, failedAt: '2026-09-02T10:01:00Z', failureCode: 'charge_already_refunded',
};

const DETAIL = {
  id: 'ord-7101', userId: 'u-701', orderNumber: 'TCG-007101', status: 'settled',
  breakdown: {
    subtotalCents: 40_000, ivaCents: 5_517, ivaRatePct: 16, processingFeeCents: 0, shippingFeeCents: 0,
    totalCents: 40_000, currency: 'MXN', priceConvention: 'IVA_INCLUSIVE', ivaIncluded: true,
  },
  items: [],
  fulfillmentMode: 'vault',
  createdAt: '2026-09-01T10:00:00Z',
  settledAt: '2026-09-01T10:02:00Z',
  fullRefundReview: null,
  refunds: [FAILED],
} as unknown as AdminOrderDetailDTO;

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
});

async function toManualFails(details: Record<string, unknown>) {
  vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(DETAIL));
  vi.spyOn(api, 'refundToManual').mockRejectedValue(new ApiClientError(409, { code: 'CASE_ORIGIN_NOT_SETTLED', message: 'x', details }));
  renderWithProviders(<M3OrderDetailView orderId="ord-7101" />, 'es');
  fireEvent.click(await screen.findByTestId('m3-to-manual-pr-x1'));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Pasar a SPEI' }));
  return screen.findByText(/No se crea nada/);
}

describe('LIVE-5 · `to-manual` 409 CASE_ORIGIN_NOT_SETTLED: el mensaje sigue a `reason`', () => {
  it('`payment_other_mode` (orden `settled`) ⇒ habla de modo prueba, no de «reembolsada»', async () => {
    const msg = await toManualFails({ originStatus: 'settled', reason: 'payment_other_mode' });
    expect(msg).toHaveTextContent(/modo prueba/);
    expect(msg).not.toHaveTextContent(/reembolsada|en disputa/);
  });

  it('`charge_disputed` (orden `settled`) ⇒ habla del contracargo, no de «reembolsada»', async () => {
    const msg = await toManualFails({ originStatus: 'settled', reason: 'charge_disputed' });
    expect(msg).toHaveTextContent(/contracargo/);
    expect(msg).not.toHaveTextContent(/reembolsada/);
  });

  it('sin `reason` y orden `chargeback` ⇒ «en disputa» (lo de siempre)', async () => {
    const msg = await toManualFails({ originStatus: 'chargeback' });
    expect(msg).toHaveTextContent(/en disputa/);
  });

  it('sin `reason` y orden `refunded` ⇒ «reembolsada» (lo de siempre)', async () => {
    const msg = await toManualFails({ originStatus: 'refunded' });
    expect(msg).toHaveTextContent(/reembolsada/);
  });
});
