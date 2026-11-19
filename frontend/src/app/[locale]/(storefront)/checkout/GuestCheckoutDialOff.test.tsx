import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  return {
    ...actual,
    createGuestCheckoutSession: vi.fn(),
    getGuestCheckoutQuote: vi.fn(actual.getGuestCheckoutQuote),
    getPublicShippingRule: vi.fn(),
  };
});
vi.mock('@/lib/api/shipping-quote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/shipping-quote')>();
  return { ...actual, postShippingQuote: vi.fn() };
});

import { createGuestCheckoutSession, getPublicShippingRule } from '@/lib/api';
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
  vi.mocked(getPublicShippingRule).mockReset();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
});
const RULE = { cardsOnlyFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000, currency: 'MXN' as const, ivaIncluded: true as const };

/** §ENV3 (DECISIONES §ENV3.17, qa QA-ENV3-OFF / seguridad ENV3-1): `v3Enabled=false` ⇒ regla fija de hoy. */
describe('§ENV3 · dial apagado (v3Enabled=false) en el checkout de invitado', () => {
  it('sin línea de cotización, sin llamar a shipping-quote, PAGAR habilitado y la session SIN shippingQuoteId', async () => {
    vi.mocked(getPublicShippingRule).mockResolvedValue({ ...RULE, v3Enabled: false });
    vi.mocked(postShippingQuote).mockResolvedValue({ quoteId: 'no', shippingFeeCents: 1, service: 'x', etaDays: 1, expiresAt: '' });
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(session());
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillForm(usr);
    await waitFor(() => expect(getPublicShippingRule).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Pagar/ })[0]).toBeEnabled());
    expect(screen.queryByTestId('shipping-quote-line')).toBeNull();
    expect(postShippingQuote).not.toHaveBeenCalled();
    await usr.click(screen.getAllByRole('button', { name: /Pagar/ })[0]);
    await waitFor(() => expect(createGuestCheckoutSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[0][0]).not.toHaveProperty('shippingQuoteId');
  });

  it('con v3Enabled=true sigue la cotización (línea visible y shipping-quote llamado)', async () => {
    vi.mocked(getPublicShippingRule).mockResolvedValue({ ...RULE, v3Enabled: true });
    vi.mocked(postShippingQuote).mockResolvedValue({ quoteId: 'sq-1', shippingFeeCents: 21000, service: 'x', etaDays: 1, expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillForm(usr);
    expect(await screen.findByTestId('shipping-quote-amount')).toHaveTextContent('MX$210.00');
    expect(postShippingQuote).toHaveBeenCalled();
  });
});
