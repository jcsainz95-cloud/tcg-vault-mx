import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl, renderWithProviders } from '@/test/render';
import { OrderDetailView } from './OrderDetailView';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import * as api from '@/lib/api';
import { MOCK_DISCOUNTED_ORDER_ID } from '@/lib/mock/discounts';
import type { OrderDetailDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/orders/ord-x',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * §DSC.6 «Dónde se ve el pedido» (criterio 914) en «Mis pedidos» (`GET /orders/:id`) y criterio 915 (sin código, igual que
 * hoy). Importes: exhibido 140 800, `SEPT10` 10 % ⇒ D 14 080, cobrado 126 720 (= `subtotalCents`, I-3).
 */
const PLAIN: OrderDetailDTO = {
  id: 'ord-x',
  orderNumber: 'TCG-100480',
  status: 'settled',
  createdAt: '2026-10-25T10:00:00Z',
  settledAt: '2026-10-25T10:01:00Z',
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
  items: [{ inventoryItemId: 'inv-1', card: { name: 'Charizard', setName: 'Base Set', number: '4', imageSmallUrl: null }, unitPriceCents: 140_800 }],
  cfdiStatus: 'no_aplica',
  invoiceRequested: false,
};
const DISCOUNTED: OrderDetailDTO = {
  ...PLAIN,
  breakdown: { ...PLAIN.breakdown, subtotalCents: 126_720, ivaCents: 17_479, processingFeeCents: 4_800, totalCents: 131_520 },
  items: [{ ...PLAIN.items[0], unitPriceCents: 126_720, unitDiscountCents: 14_080, unitPriceBeforeDiscountCents: 140_800 }],
  discount: { code: 'SEPT10', kind: 'percent', merchandiseBeforeDiscountCents: 140_800, discountCents: 14_080, shippingWaivedCents: 0 },
};

const rows = () =>
  Array.from(screen.getByTestId('amount-breakdown').querySelectorAll(':scope > div')).map((d) => d.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('OrderDetailView · §DSC.6 (914/915)', () => {
  it('OD-1 · con código: la carta dice el exhibido, «Subtotal» el de antes, «Descuento (SEPT10) −MX$140.80» y el total cobrado', async () => {
    vi.spyOn(api, 'getOrder').mockResolvedValue(structuredClone(DISCOUNTED));
    renderWithProviders(<OrderDetailView orderId="ord-x" />, 'es');
    expect(await screen.findByTestId('order-item-price-inv-1')).toHaveTextContent('MX$1,408.00');
    const r = rows();
    expect(r[0]).toMatch(/^Subtotal\s*MX\$1,408\.00$/);
    expect(r[1]).toBe('Descuento (SEPT10)−MX$140.80');
    expect(r.at(-1)).toMatch(/MX\$1,315\.20$/);
  });

  it('OD-2 · sin código (915): la carta y el desglose son, marcado a marcado, los de hoy', async () => {
    vi.spyOn(api, 'getOrder').mockResolvedValue(structuredClone(PLAIN));
    const { unmount } = renderWithProviders(<OrderDetailView orderId="ord-x" />, 'es');
    expect(await screen.findByTestId('order-item-price-inv-1')).toHaveTextContent('MX$1,408.00');
    expect(screen.queryByTestId('amount-breakdown-discount')).toBeNull();
    const surface = screen.getByTestId('amount-breakdown').innerHTML;
    unmount();
    renderWithIntl(<AmountBreakdown breakdown={PLAIN.breakdown} variant="purchase" />, 'es');
    expect(screen.getByTestId('amount-breakdown').innerHTML).toBe(surface);
  });

  it('OD-3 · EN: «Discount (SEPT10)»', async () => {
    vi.spyOn(api, 'getOrder').mockResolvedValue(structuredClone(DISCOUNTED));
    renderWithProviders(<OrderDetailView orderId="ord-x" />, 'en');
    expect(await screen.findByTestId('amount-breakdown-discount')).toHaveTextContent('Discount (SEPT10)');
  });

  it('OD-4 · el MOCK sirve el pedido con código en la forma del contrato y los demás sin la clave (I-1)', async () => {
    const d = await api.getOrder(MOCK_DISCOUNTED_ORDER_ID);
    expect(d.discount).toEqual({ code: 'SEPT10', kind: 'percent', merchandiseBeforeDiscountCents: 140_800, discountCents: 14_080, shippingWaivedCents: 0 });
    // v1.110.3: la proyección de línea del servidor (el antes del descuento por unidad).
    expect(d.items![0].unitPriceBeforeDiscountCents).toBe(140_800);
    // I-3: `subtotalCents` = Σ cobrado y `discountCents` = Σ unidades × `unitDiscountCents`.
    expect(d.items.reduce((s, it) => s + it.unitPriceCents, 0)).toBe(d.breakdown.subtotalCents);
    expect(d.items.reduce((s, it) => s + (it.unitDiscountCents ?? 0), 0)).toBe(d.discount!.discountCents);
    const plain = await api.getOrder('ord-9001');
    expect(plain).not.toHaveProperty('discount');
    for (const it of plain.items) expect(it).not.toHaveProperty('unitDiscountCents');
  });
});
