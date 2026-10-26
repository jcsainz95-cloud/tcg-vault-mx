import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl, renderWithProviders } from '@/test/render';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { trackGuestOrder } from '@/lib/api';
import type { GuestOrderTrackingDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { PublicOrderTracking } from './PublicOrderTracking';

/**
 * §DSC.6 «Dónde se ve el pedido» (criterio 914) en el seguimiento del invitado (`POST /orders/guest/track`) y criterio 915.
 * Dos casos del contrato: código de mercancía (`SEPT10`, 10 %) y código de envío gratis (`ENVIO25`): «Envío» sigue con su
 * tarifa y «Envío gratis (ENVIO25)» la resta, como en el checkout (§DSC-UX.2).
 */
const PLAIN: GuestOrderTrackingDTO = {
  orderNumber: 'TCG-000123',
  status: 'preparando',
  placedAt: '2026-10-25T18:20:00.000Z',
  paidAt: '2026-10-25T18:21:10.000Z',
  emailMasked: 'j***@***.com',
  items: [
    { name: 'Blastoise', setName: 'Base Set', number: '2', finish: 'normal', productType: 'raw', rawCondition: 'NM', unitPriceCents: 350_000 },
  ],
  breakdown: {
    subtotalCents: 370_000,
    shippingFeeCents: 17_500,
    ivaCents: 53_448,
    ivaRatePct: 16,
    processingFeeCents: 13_900,
    totalCents: 401_400,
    currency: 'MXN',
    priceConvention: 'IVA_INCLUSIVE',
    ivaIncluded: true,
  },
  shipping: { city: 'Guadalajara', state: 'Jalisco', postalCodeMasked: '***45', recipientNameMasked: 'Juan P.' },
  payment: { brand: 'visa', last4: '4242' },
  claim: { available: true },
  support: { evidenceContact: 'evidencias@ejemplo.test', disputeWindowDays: 7 },
  tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString(),
  accessoryLines: [
    { id: 'acc-1', kind: 'accessory', name: 'Micas', photo: null, quantity: 2, unitPriceCents: 10_000, lineTotalCents: 20_000, refundedQty: 0, deckName: null, components: [] },
  ],
};

const render = (data: GuestOrderTrackingDTO) =>
  renderWithProviders(
    <PublicOrderTracking data={data} updatedAt={new Date('2026-10-26T10:30:00.000Z')} isRefreshing={false} onRefresh={vi.fn()} onResendLink={vi.fn()} />,
    'es',
  );
const rows = () =>
  Array.from(screen.getByTestId('amount-breakdown').querySelectorAll(':scope > div')).map((d) => d.textContent?.replace(/\s+/g, ' ').trim());

describe('PublicOrderTracking · §DSC.6 (914/915)', () => {
  it('PT-1 · 10 %: carta y accesorio en exhibido, «Subtotal» antes del descuento y «Descuento (SEPT10)» debajo', () => {
    // exhibido: carta 350 000 + micas 2 × 10 000 = 370 000; D = 35 000 + 2 × 1 000 = 37 000; cobrado 333 000.
    render({
      ...PLAIN,
      items: [{ ...PLAIN.items[0], unitPriceCents: 315_000, unitDiscountCents: 35_000 }],
      accessoryLines: [{ ...PLAIN.accessoryLines![0], unitPriceCents: 9_000, lineTotalCents: 18_000, unitDiscountCents: 1_000 }],
      breakdown: { ...PLAIN.breakdown, subtotalCents: 333_000, totalCents: 364_400 },
      discount: { code: 'SEPT10', kind: 'percent', discountCents: 37_000, shippingWaivedCents: 0 },
    });
    expect(screen.getByText('MX$3,500.00')).toBeInTheDocument();
    expect(screen.getByTestId('tracking-accessories')).toHaveTextContent('MX$200.00');
    const r = rows();
    expect(r[0]).toMatch(/^Subtotal\s*MX\$3,700\.00$/);
    expect(r[1]).toBe('Descuento (SEPT10)−MX$370.00');
    expect(r.at(-1)).toMatch(/MX\$3,644\.00$/);
  });

  it('PT-2 · envío gratis: «Envío MX$175.00» y «Envío gratis (ENVIO25) −MX$175.00»; la mercancía no cambia', () => {
    render({
      ...PLAIN,
      breakdown: { ...PLAIN.breakdown, shippingFeeCents: 0, totalCents: 383_900 },
      discount: { code: 'ENVIO25', kind: 'free_shipping', discountCents: 0, shippingWaivedCents: 17_500 },
    });
    const r = rows();
    expect(r[0]).toMatch(/^Subtotal\s*MX\$3,700\.00$/);
    expect(r[1]).toMatch(/^Envío\s*MX\$175\.00$/);
    expect(r[2]).toBe('Envío gratis (ENVIO25)−MX$175.00');
  });

  it('PT-3 · sin código (915): el desglose es, marcado a marcado, el de hoy', () => {
    const { unmount } = render(PLAIN);
    expect(screen.queryByTestId('amount-breakdown-discount')).toBeNull();
    expect(screen.getByTestId('tracking-accessories')).toHaveTextContent('MX$200.00');
    const surface = screen.getByTestId('amount-breakdown').innerHTML;
    unmount();
    renderWithIntl(<AmountBreakdown breakdown={PLAIN.breakdown} variant="purchase" />, 'es');
    expect(screen.getByTestId('amount-breakdown').innerHTML).toBe(surface);
  });

  it('PT-4 · el MOCK: `mock…discount…` trae `discount` con Σ unidades = D y Σ cobrado = subtotal; `mock` a secas, ni la clave', async () => {
    const d = await trackGuestOrder('mock-discount');
    expect(d.discount).toMatchObject({ code: 'SEPT10', kind: 'percent', shippingWaivedCents: 0 });
    expect(d.items.reduce((s, it) => s + (it.unitDiscountCents ?? 0), 0)).toBe(d.discount!.discountCents);
    expect(d.items.reduce((s, it) => s + it.unitPriceCents, 0)).toBe(d.breakdown.subtotalCents);
    const plain = await trackGuestOrder('mock');
    expect(plain).not.toHaveProperty('discount');
    for (const it of plain.items) expect(it).not.toHaveProperty('unitDiscountCents');
  });
});
