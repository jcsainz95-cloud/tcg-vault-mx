import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { photo } from '@/test/accessories.testkit';
import type { GuestOrderTrackingDTO } from '@/types/contract';

/**
 * `API_CONTRACT §AC.12` + `DESIGN_SYSTEM §AC-UX.13`: el seguimiento del invitado pinta los renglones de accesorio
 * DESPUÉS de las cartas («{nombre} ×{n} · {lineTotal}») y el paquete con su desglose. ⛔ Sin costo ni ids.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { PublicOrderTracking } from './PublicOrderTracking';

const DTO: GuestOrderTrackingDTO = {
  orderNumber: 'TCG-000400',
  status: 'preparando',
  placedAt: '2026-10-07T18:20:00.000Z',
  emailMasked: 'j***@***.com',
  items: [],
  breakdown: {
    subtotalCents: 19_800, shippingFeeCents: 17_500, ivaCents: 5_145, ivaRatePct: 16, processingFeeCents: 1_000,
    totalCents: 38_300, currency: 'MXN', priceConvention: 'IVA_INCLUSIVE', ivaIncluded: true,
  },
  shipping: { city: 'CDMX', state: 'CDMX', postalCodeMasked: '***00', recipientNameMasked: 'Juan P.' },
  claim: { available: false },
  support: { evidenceContact: 'evidencias@ejemplo.test', disputeWindowDays: 7 },
  tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString(),
  accessoryLines: [
    { name: 'Penny sleeves x100', photo: photo('acc-1'), quantity: 2, unitPriceCents: 8_900, lineTotalCents: 17_800, refundedQty: 1, deckName: null, components: [] },
    {
      name: 'Paquete de energías',
      photo: null,
      quantity: 1,
      unitPriceCents: 2_000,
      lineTotalCents: 2_000,
      refundedQty: 0,
      deckName: 'Dragapult ex',
      components: [
        { energyType: 'water', quantity: 4 },
        { energyType: 'fire', quantity: 8 },
      ],
    },
  ],
};

describe('§AC-UX.13 · seguimiento del invitado con accesorios', () => {
  it('renglones con cantidad y total del servidor, «1 reembolsadas» y el paquete con su desglose', () => {
    renderWithProviders(
      <PublicOrderTracking data={DTO} updatedAt={new Date()} isRefreshing={false} onRefresh={vi.fn()} onResendLink={vi.fn()} />,
      'es',
    );
    const list = screen.getByTestId('tracking-accessories');
    expect(within(list).getByText(/Penny sleeves x100 ×2 · .*178\.00/)).toBeInTheDocument();
    expect(within(list).getByText('1 reembolsadas')).toBeInTheDocument();
    expect(within(list).getByText(/Paquete de energías — Dragapult ex · .*20\.00/)).toBeInTheDocument();
    expect(within(list).getByText('Fuego ×8 · Agua ×4')).toBeInTheDocument();
  });
});
