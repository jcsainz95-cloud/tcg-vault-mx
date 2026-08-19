import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { mockListings } from '@/lib/mock/fixtures';
import type { GuestCheckoutQuoteResponse } from '@/types/contract';

// Link de i18n → <a> plano para el render de prueba.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

// Solo el quote de invitado se mockea para fijar valores distintos en `breakdown` (envío) y
// `vaultBreakdown` (bóveda) y probar la conmutación reactiva sin refetch (v1.21.4-dual-breakdown,
// N-12). El resto del módulo API queda intacto.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, getGuestCheckoutQuote: vi.fn() };
});

import { getGuestCheckoutQuote } from '@/lib/api';
import { GuestCheckoutView } from './GuestCheckoutView';

// Valores del ejemplo normativo del contrato (§4-G.1): DOS desgloses del MISMO subtotal.
// `breakdown` (envío directo) trae `shippingFeeCents` y un total mayor; `vaultBreakdown` NO trae
// envío y recalcula IVA/fee/total sobre la base menor.
const SHIP_TOTAL_CENTS = 51200;
const VAULT_TOTAL_CENTS = 30400;

function guestQuote(ids: string[]): GuestCheckoutQuoteResponse {
  const listing = mockListings.find((l) => l.inventoryItemId === ids[0]) ?? mockListings[0];
  return {
    items: ids.map((id, i) => ({
      inventoryItemId: id,
      card: listing.card,
      unitPriceCents: 12500 + i,
    })),
    fulfillmentMode: 'direct_ship',
    breakdown: {
      subtotalCents: 25000,
      shippingFeeCents: 17500,
      ivaCents: 6800,
      ivaRatePct: 16,
      processingFeeCents: 1900,
      totalCents: SHIP_TOTAL_CENTS,
      currency: 'MXN',
    },
    vaultBreakdown: {
      subtotalCents: 25000,
      ivaCents: 4000,
      ivaRatePct: 16,
      processingFeeCents: 1400,
      totalCents: VAULT_TOTAL_CENTS,
      currency: 'MXN',
    },
    notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
    unavailableItems: [],
  };
}

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, updatedAt: Date.now() }));
}

/** Selector de destino del FORMULARIO (única `region` con nombre "DESTINO"; el aside es un radiogroup). */
function destinationForm() {
  return screen.getByRole('region', { name: 'DESTINO' });
}

describe('GuestCheckoutView · resumen reactivo al destino (v1.21.4-dual-breakdown, N-12)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedCart(['inv-1002']);
    vi.mocked(getGuestCheckoutQuote).mockReset();
    vi.mocked(getGuestCheckoutQuote).mockImplementation(async (ids) => guestQuote(ids));
  });

  it('destino=envío: el resumen muestra la línea de envío y el total = breakdown.totalCents', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));

    const breakdown = screen.getByTestId('amount-breakdown');
    // La línea de envío está presente (el destino por defecto es "recibir en casa").
    expect(within(breakdown).getByText('Envío')).toBeInTheDocument();
    // El total del resumen y el del botón usan el desglose de ENVÍO.
    expect(within(breakdown).getByText('MX$512.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pagar/ })).toHaveTextContent('MX$512.00');
  });

  it('destino=bóveda: el resumen QUITA la línea de envío y el total = vaultBreakdown.totalCents', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    await user.click(within(destinationForm()).getByRole('radio', { name: /Guardar en mi bóveda/ }));

    const breakdown = screen.getByTestId('amount-breakdown');
    // Sin línea de envío: la bóveda no se envía (el desglose conmuta a vaultBreakdown).
    expect(within(breakdown).queryByText('Envío')).not.toBeInTheDocument();
    // Total del resumen y del botón = total de BÓVEDA (menor, sin envío).
    expect(within(breakdown).getByText('MX$304.00')).toBeInTheDocument();
    expect(within(breakdown).queryByText('MX$512.00')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pagar/ })).toHaveTextContent('MX$304.00');
  });

  it('alternar destino es INSTANTÁNEO y no dispara un nuevo fetch (ambos desgloses en la misma respuesta)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    const breakdown = screen.getByTestId('amount-breakdown');
    const form = destinationForm();

    // Un solo fetch tras el render inicial.
    expect(vi.mocked(getGuestCheckoutQuote).mock.calls.length).toBe(1);
    expect(within(breakdown).getByText('MX$512.00')).toBeInTheDocument();

    // Envío → bóveda: el resumen cambia sin volver a llamar a la API.
    await user.click(within(form).getByRole('radio', { name: /Guardar en mi bóveda/ }));
    expect(within(breakdown).getByText('MX$304.00')).toBeInTheDocument();
    expect(within(breakdown).queryByText('Envío')).not.toBeInTheDocument();

    // Bóveda → envío: vuelve al desglose con envío, también sin refetch.
    await user.click(within(form).getByRole('radio', { name: /Envío a mi domicilio/ }));
    expect(within(breakdown).getByText('MX$512.00')).toBeInTheDocument();
    expect(within(breakdown).getByText('Envío')).toBeInTheDocument();

    // Ningún toggle disparó un fetch adicional.
    expect(vi.mocked(getGuestCheckoutQuote).mock.calls.length).toBe(1);
  });
});
