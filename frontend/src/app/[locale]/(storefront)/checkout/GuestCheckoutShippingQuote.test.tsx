import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import type { GuestCheckoutSessionResponse } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, createGuestCheckoutSession: vi.fn(), getGuestCheckoutQuote: vi.fn(actual.getGuestCheckoutQuote) };
});
vi.mock('@/lib/api/shipping-quote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/shipping-quote')>();
  return { ...actual, postShippingQuote: vi.fn() };
});

import { createGuestCheckoutSession, getGuestCheckoutQuote } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { postShippingQuote, type ShippingQuoteDTO } from '@/lib/api/shipping-quote';
import { GuestCheckoutView } from './GuestCheckoutView';
import { setShippingQuoteDebounceMs } from './use-shipping-quote';
import { clearUnavailableNotice } from './unavailable-notice';
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('desktop');

const quote = (over: Partial<ShippingQuoteDTO> = {}): ShippingQuoteDTO => ({
  quoteId: 'sq-1',
  shippingFeeCents: 21000,
  service: 'FedEx Standard Overnight',
  etaDays: 1,
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  ...over,
});

function session(): GuestCheckoutSessionResponse {
  return {
    orderId: 'ord-g-1',
    orderNumber: 'TCG-000123',
    breakdown: { subtotalCents: 1000, shippingFeeCents: 21000, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 22160, currency: 'MXN', priceConvention: 'IVA_EXCLUSIVE', ivaIncluded: false },
    checkoutToken: 'tok-first',
    checkoutTokenExpiresAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    stripe: { paymentIntentId: 'pi_g1', clientSecret: 'pi_g1_secret' },
    reused: false,
    reservedUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
    supersededOrderIds: [],
  };
}

async function fillForm(usr: ReturnType<typeof userEvent.setup>, cp = '44100') {
  await screen.findByLabelText('Correo electrónico');
  await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
  await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
  await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
  await usr.type(screen.getByLabelText('Calle y número'), 'Av. Vallarta 1234');
  await usr.type(screen.getByLabelText('Código postal'), cp);
  await usr.type(screen.getByLabelText('Teléfono'), '3312345678');
  await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
  await screen.findByRole('option', { name: 'Guadalajara Centro' });
  await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Guadalajara Centro');
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearUnavailableNotice();
  setShippingQuoteDebounceMs(0);
  vi.mocked(createGuestCheckoutSession).mockReset();
  vi.mocked(postShippingQuote).mockReset();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
});

describe('§ENV3 · envío por CP en el checkout de invitado', () => {
  it('sin CP pide el CP; con CP espera (aviso), luego muestra días e importe del servidor y el umbral de gratis', async () => {
    let resolve!: (q: ShippingQuoteDTO) => void;
    vi.mocked(postShippingQuote).mockReturnValue(new Promise((r) => (resolve = r)));
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await screen.findByLabelText('Correo electrónico');
    expect(await screen.findByTestId('shipping-quote-line')).toHaveTextContent('Escribe tu código postal para calcular el envío.');
    expect(postShippingQuote).not.toHaveBeenCalled();
    await usr.type(screen.getByLabelText('Código postal'), '44100');
    expect(await screen.findByTestId('shipping-quote-waiting')).toHaveTextContent('Calculando tu envío con FedEx…');
    expect(postShippingQuote).toHaveBeenCalledWith({ cp: '44100', items: [{ inventoryItemId: 'inv-1002' }] }, expect.anything());
    await act(async () => resolve(quote()));
    expect(await screen.findByTestId('shipping-quote-amount')).toHaveTextContent('MX$210.00');
    expect(screen.getByTestId('shipping-quote-line')).toHaveTextContent('Envío FedEx (llega en 1 día)');
    await waitFor(() => expect(screen.getByTestId('shipping-quote-line')).toHaveTextContent(/Gratis desde MX\$4,000\.00/));
  });

  it('PAGAR espera la cotización; la session lleva el `shippingQuoteId` y el quote se re-hace con él', async () => {
    let resolve!: (q: ShippingQuoteDTO) => void;
    vi.mocked(postShippingQuote).mockReturnValue(new Promise((r) => (resolve = r)));
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(session());
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillForm(usr);
    const pay = () => screen.getAllByRole('button', { name: /Pagar/ })[0];
    await waitFor(() => expect(pay()).toBeDisabled());
    await act(async () => resolve(quote()));
    await waitFor(() => expect(pay()).toBeEnabled());
    await waitFor(() =>
      expect(vi.mocked(getGuestCheckoutQuote).mock.calls.some((c) => c[3]?.shippingQuoteId === 'sq-1')).toBe(true),
    );
    await usr.click(pay());
    await waitFor(() => expect(createGuestCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[0][0]).toMatchObject({ shippingQuoteId: 'sq-1' });
  });

  it('409 SHIPPING_QUOTE_STALE: nada cobrado, muestra el importe nuevo y NO pierde lo capturado', async () => {
    vi.mocked(postShippingQuote).mockResolvedValue(quote());
    vi.mocked(createGuestCheckoutSession)
      .mockRejectedValueOnce(
        new ApiClientError(409, {
          code: 'SHIPPING_QUOTE_STALE',
          message: 'stale',
          details: { newQuote: quote({ quoteId: 'sq-2', shippingFeeCents: 25500 }) },
        }),
      )
      .mockResolvedValue(session());
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillForm(usr);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Pagar/ })[0]).toBeEnabled());
    await usr.click(screen.getAllByRole('button', { name: /Pagar/ })[0]);
    expect(await screen.findByText(/Tu cotización de envío caducó o cambió: ahora es MX\$255\.00\. No se cobró nada/)).toBeInTheDocument();
    expect(screen.getByTestId('shipping-quote-amount')).toHaveTextContent('MX$255.00');
    // lo capturado sigue ahí
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('juan@dominio.com');
    expect(screen.getByLabelText('Calle y número')).toHaveValue('Av. Vallarta 1234');
    expect(screen.getByLabelText('Código postal')).toHaveValue('44100');
    // reconfirma: la segunda session ya lleva la cotización nueva
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Pagar/ })[0]).toBeEnabled());
    await usr.click(screen.getAllByRole('button', { name: /Pagar/ })[0]);
    await waitFor(() => expect(createGuestCheckoutSession).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[1][0]).toMatchObject({ shippingQuoteId: 'sq-2' });
  });

  it('si la cotización falla: aviso con «Reintentar», PAGAR bloqueado, y al reintentar se recupera', async () => {
    vi.mocked(postShippingQuote).mockRejectedValue(new ApiClientError(503, { code: 'INTERNAL', message: 'down' }));
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillForm(usr);
    await screen.findByText('No pudimos calcular el envío. Revisa tu conexión e inténtalo de nuevo.', undefined, { timeout: 4000 });
    expect(screen.getAllByRole('button', { name: /Pagar/ })[0]).toBeDisabled();
    vi.mocked(postShippingQuote).mockResolvedValue(quote());
    await usr.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('shipping-quote-amount')).toHaveTextContent('MX$210.00');
  });

  it('envío 0 (≥ umbral) se dice «Gratis»; en inglés, el mismo flujo', async () => {
    vi.mocked(postShippingQuote).mockResolvedValue(quote({ shippingFeeCents: 0 }));
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'en');
    await screen.findByLabelText('Email');
    await usr.type(screen.getByLabelText('Postal code'), '44100');
    expect(await screen.findByTestId('shipping-quote-amount')).toHaveTextContent('Free');
    expect(screen.getByTestId('shipping-quote-line')).toHaveTextContent('FedEx shipping (arrives in 1 day)');
    await waitFor(() => expect(screen.getByTestId('shipping-quote-line')).toHaveTextContent('Free from MX$4,000.00'));
  });
});
