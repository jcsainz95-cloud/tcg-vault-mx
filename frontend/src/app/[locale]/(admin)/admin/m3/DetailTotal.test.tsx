import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import { formatMoneyCents } from '@/lib/format';
import type { AdminOrderDetailDTO, AdminOrderDTO } from '@/types/contract';
import { RefundOrderDialog, refundDialogOrderOfDetail } from './RefundOrderDialog';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';

/**
 * QA s5 IMPORTANTE-1 (2026-10-04) — el detalle M3 y el diálogo de reembolso total pintaban «MX$NaN» en producción:
 * leían `o.totalCents` en la RAÍZ y el contrato (§11 `AdminOrderDetailDTO`) lo pone en `breakdown.totalCents`. El
 * mock esparcía la fila del listado (que SÍ trae `totalCents` en la raíz) y por eso el defecto no se veía en local.
 *
 * Estas pruebas sirven al componente un detalle con la FORMA LITERAL DEL CONTRATO (sin `totalCents` en la raíz).
 * Mutación medida: volver a leer `o.totalCents` / `detail.data.totalCents` ⇒ rojas DT-1 y DT-2.
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

/** `GET /admin/orders/:id` tal cual lo declara el contrato §11: el total SOLO en `breakdown`. */
const CONTRACT_DETAIL: AdminOrderDetailDTO = {
  id: 'ord-7001',
  userId: 'u-701',
  orderNumber: 'TCG-007001',
  status: 'settled',
  breakdown: {
    subtotalCents: 80_000,
    ivaCents: 11_034,
    ivaRatePct: 16,
    processingFeeCents: 4_617,
    shippingFeeCents: 15_000,
    totalCents: 99_617,
    currency: 'MXN',
    priceConvention: 'IVA_INCLUSIVE',
    ivaIncluded: true,
  },
  items: [],
  cfdiStatus: 'no_aplica',
  invoiceRequested: false,
  stripePaymentIntentId: 'pi_x',
  fulfillmentMode: 'direct_ship',
  shippingFeeCents: 15_000,
  chargebackNeedsManual: false,
  disputeOutcome: null,
  isGuestOrder: false,
  createdAt: '2026-09-01T10:00:00Z',
  settledAt: '2026-09-01T10:02:00Z',
  refundedCents: 31_458,
  shipmentShipped: false,
  fullRefundReview: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
  window.localStorage.setItem('tcg.role', 'super_admin');
});
afterEach(() => {
  window.localStorage.removeItem('tcg.role');
});

describe('QA s5 IMPORTANTE-1 · el total del detalle M3 sale de `breakdown`', () => {
  it('la forma del contrato NO trae `totalCents` en la raíz (si alguien lo añade al fixture, esta prueba deja de probar nada)', () => {
    expect(Object.prototype.hasOwnProperty.call(CONTRACT_DETAIL, 'totalCents')).toBe(false);
  });

  it('DT-1 · la cabecera del detalle pinta `breakdown.totalCents`, ⛔ nunca «NaN»', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(CONTRACT_DETAIL));
    renderWithProviders(<M3OrderDetailView orderId="ord-7001" />, 'es');
    const total = await screen.findByTestId('m3-total');
    expect(total).toHaveTextContent(formatMoneyCents(99_617, 'es'));
    expect(total.textContent).not.toMatch(/NaN/);
  });

  it('DT-2 · el diálogo de reembolso total ofrece `breakdown.totalCents − refundedCents`, ⛔ nunca «NaN»', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(CONTRACT_DETAIL));
    renderWithProviders(
      <RefundOrderDialog order={refundDialogOrderOfDetail(CONTRACT_DETAIL)} open onClose={() => {}} onDone={() => {}} />,
      'es',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    const btn = within(dialog).getByTestId('m3-refund-confirm');
    await vi.waitFor(() => expect(btn).toHaveTextContent(formatMoneyCents(99_617 - 31_458, 'es')));
    expect(btn.textContent).not.toMatch(/NaN/);
  });

  it('DT-3 · desde el detalle, el diálogo recibe el total del `breakdown` (proyección `refundDialogOrderOfDetail`)', () => {
    expect(refundDialogOrderOfDetail(CONTRACT_DETAIL)).toEqual({
      id: 'ord-7001',
      totalCents: 99_617,
      fulfillmentMode: 'direct_ship',
      orderNumber: 'TCG-007001',
    });
  });

  it('DT-4 · el MOCK del detalle tiene la forma del contrato: sin `totalCents` en la raíz y con el total en `breakdown`', async () => {
    const list = await api.getAdminOrders({});
    const row = list.data.find((o: AdminOrderDTO) => o.id === 'ord-9001')!;
    const detail = await api.getAdminOrder('ord-9001');
    expect(Object.prototype.hasOwnProperty.call(detail, 'totalCents')).toBe(false);
    expect(detail.breakdown.totalCents).toBe(row.totalCents);
  });
});
