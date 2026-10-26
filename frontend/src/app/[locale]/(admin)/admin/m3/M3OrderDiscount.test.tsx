import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl, renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import { MOCK_DISCOUNTED_ORDER_ID } from '@/lib/mock/discounts';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import type { AdminOrderDetailDTO } from '@/types/contract';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';

/**
 * §DSC.6 «Dónde se ve el pedido» (criterio 914) en Ventas (`GET /admin/orders/:id`) y criterio 915. §DSC-UX.5: «En el pedido
 * de Ventas (también para `vault_operator`): dos filas, «Código» y «Descuento ({CÓDIGO}) −MX$X»». La carta dice el exhibido
 * (como el checkout) y, debajo, lo COBRADO: es la base de todo reembolso (I-3), y el operador la necesita a la vista.
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

const PLAIN: AdminOrderDetailDTO = {
  id: 'ord-7101',
  userId: 'u-701',
  orderNumber: 'TCG-007101',
  status: 'settled',
  breakdown: {
    subtotalCents: 140_800,
    ivaCents: 19_421,
    ivaRatePct: 16,
    processingFeeCents: 5_300,
    totalCents: 146_100,
    currency: 'MXN',
    priceConvention: 'IVA_INCLUSIVE',
    ivaIncluded: true,
  },
  items: [
    {
      inventoryItemId: 'inv-1',
      card: { name: 'Charizard', setName: 'Base Set', number: '4', imageSmallUrl: null },
      unitPriceCents: 140_800,
      refund: null,
      orderItemId: 'oi-1',
      deliveredRefund: { kind: 'not_refundable', reason: 'not_direct_ship' },
    },
  ],
  accessoryLines: [
    { id: 'acc-1', kind: 'accessory', name: 'Micas', photo: null, quantity: 2, unitPriceCents: 10_000, lineTotalCents: 20_000, refundedQty: 0, deckName: null, components: [] },
  ],
  cfdiStatus: 'no_aplica',
  fulfillmentMode: 'vault',
  isGuestOrder: false,
  createdAt: '2026-10-25T10:00:00Z',
  settledAt: '2026-10-25T10:01:00Z',
  refundedCents: 0,
  fullRefundReview: null,
};
// exhibido: 140 800 + 2 × 10 000 = 160 800; D = 14 080 + 2 × 1 000 = 16 080; cobrado 144 720.
const DISCOUNTED: AdminOrderDetailDTO = {
  ...PLAIN,
  breakdown: { ...PLAIN.breakdown, subtotalCents: 144_720, totalCents: 149_520 },
  items: [{ ...PLAIN.items![0], unitPriceCents: 126_720, unitDiscountCents: 14_080 }],
  accessoryLines: [{ ...PLAIN.accessoryLines![0], unitPriceCents: 9_000, lineTotalCents: 18_000, unitDiscountCents: 1_000 }],
  discount: { code: 'SEPT10', kind: 'percent', discountCents: 16_080, shippingWaivedCents: 0 },
};

const rows = () =>
  Array.from(screen.getByTestId('amount-breakdown').querySelectorAll(':scope > div')).map((d) => d.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
});
afterEach(() => {
  window.localStorage.removeItem('tcg.role');
});

describe('M3 · detalle del pedido con código (914)', () => {
  it('MD-1 · fila «Código SEPT10», carta en exhibido con «Cobrado …» debajo, y «Descuento (SEPT10)» en el desglose', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(DISCOUNTED));
    renderWithProviders(<M3OrderDetailView orderId="ord-7101" />, 'es');
    expect(await screen.findByTestId('m3-discount-code')).toHaveTextContent(/^Código\s*SEPT10$/);
    expect(screen.getByTestId('m3-item-price-inv-1')).toHaveTextContent('MX$1,408.00');
    expect(screen.getByTestId('m3-item-charged-inv-1')).toHaveTextContent('Cobrado MX$1,267.20 con el código');
    expect(screen.getByTestId('m3-accessory-acc-1')).toHaveTextContent('MX$200.00');
    expect(screen.getByTestId('m3-accessory-charged-acc-1')).toHaveTextContent('Cobrado MX$180.00 con el código');
    const r = rows();
    expect(r[0]).toMatch(/^Subtotal\s*MX\$1,608\.00$/);
    expect(r[1]).toBe('Descuento (SEPT10)−MX$160.80');
    expect(r.at(-1)).toMatch(/MX\$1,495\.20$/);
    expect(screen.getByTestId('m3-total')).toHaveTextContent('MX$1,495.20');
  });

  it('MD-2 · el operador de bóveda también lo ve (lectura)', async () => {
    roleState.role = 'vault_operator';
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(DISCOUNTED));
    renderWithProviders(<M3OrderDetailView orderId="ord-7101" />, 'es');
    expect(await screen.findByTestId('m3-discount-code')).toHaveTextContent('SEPT10');
    expect(screen.getByTestId('amount-breakdown-discount')).toHaveTextContent('Descuento (SEPT10)');
  });

  it('MD-3 · sin código (915): ni «Código» ni «Cobrado», carta al precio de hoy y desglose marcado a marcado el de hoy', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(PLAIN));
    const { unmount } = renderWithProviders(<M3OrderDetailView orderId="ord-7101" />, 'es');
    expect(await screen.findByTestId('m3-item-price-inv-1')).toHaveTextContent('MX$1,408.00');
    expect(screen.queryByTestId('m3-discount-code')).toBeNull();
    expect(screen.queryByTestId('m3-item-charged-inv-1')).toBeNull();
    expect(screen.queryByTestId('m3-accessory-charged-acc-1')).toBeNull();
    expect(screen.getByTestId('m3-accessory-acc-1')).toHaveTextContent('MX$200.00');
    const surface = screen.getByTestId('amount-breakdown').innerHTML;
    unmount();
    renderWithIntl(<AmountBreakdown breakdown={PLAIN.breakdown} variant="purchase" />, 'es');
    expect(screen.getByTestId('amount-breakdown').innerHTML).toBe(surface);
  });

  it('MD-4 · EN: «Code», «Charged … with the code», «Discount (SEPT10)»', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(structuredClone(DISCOUNTED));
    renderWithProviders(<M3OrderDetailView orderId="ord-7101" />, 'en');
    expect(await screen.findByTestId('m3-discount-code')).toHaveTextContent(/^Code\s*SEPT10$/);
    expect(screen.getByTestId('m3-item-charged-inv-1')).toHaveTextContent('Charged MX$1,267.20 with the code');
    expect(screen.getByTestId('amount-breakdown-discount')).toHaveTextContent('Discount (SEPT10)');
  });

  it('MD-5 · el MOCK de Ventas sirve el pedido con código (forma del contrato, sin `totalCents` en la raíz) y el resto sin la clave', async () => {
    const d = await api.getAdminOrder(MOCK_DISCOUNTED_ORDER_ID);
    expect(d.discount).toEqual({ code: 'SEPT10', kind: 'percent', discountCents: 14_080, shippingWaivedCents: 0 });
    expect(Object.prototype.hasOwnProperty.call(d, 'totalCents')).toBe(false);
    expect((d.items ?? []).reduce((s, it) => s + it.unitPriceCents, 0)).toBe(d.breakdown.subtotalCents);
    expect((d.items ?? []).reduce((s, it) => s + (it.unitDiscountCents ?? 0), 0)).toBe(d.discount!.discountCents);
    const plain = await api.getAdminOrder('ord-9001');
    expect(plain).not.toHaveProperty('discount');
    for (const it of plain.items ?? []) expect(it).not.toHaveProperty('unitDiscountCents');
  });
});
