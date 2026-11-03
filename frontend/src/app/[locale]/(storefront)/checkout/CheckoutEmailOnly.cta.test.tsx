import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { getStoredUser, setStoredUser } from '@/lib/session';
import { mockListings, orderItemCard } from '@/lib/mock/fixtures';
import type { CheckoutQuoteResponse, CheckoutSessionResponse, UserDTO } from '@/types/contract';

let currentPath = '/es/checkout';
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, usePathname: () => currentPath };
});

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
    getCheckoutQuote: vi.fn(),
    createCheckoutSession: vi.fn(),
    registerEmailOnly: vi.fn(actual.registerEmailOnly),
    register: vi.fn(actual.register),
  };
});

import { createCheckoutSession, getCheckoutQuote, register, registerEmailOnly } from '@/lib/api';
import { VerifyEmailBanner } from '@/components/domain/VerifyEmailBanner';
import { clearUnavailableNotice } from './unavailable-notice';
import { CheckoutView } from './CheckoutView';
import { VaultUpsellPanel } from './VaultUpsellPanel';
import { IDS_EN } from '@/test/ids-defaults';

function quote(ids: string[]): CheckoutQuoteResponse {
  const listings = ids.map((id) => mockListings.find((l) => l.inventoryItemId === id)!);
  const subtotal = listings.reduce((s, l) => s + (l.displayPriceCents ?? 0), 0);
  return {
    items: listings.map((l) => ({ ...IDS_EN, inventoryItemId: l.inventoryItemId, card: orderItemCard(l), unitPriceCents: l.displayPriceCents ?? 0 })),
    breakdown: {
      subtotalCents: subtotal,
      ivaCents: 0,
      ivaRatePct: 16,
      processingFeeCents: 0,
      totalCents: subtotal,
      currency: 'MXN',
      priceConvention: 'IVA_INCLUSIVE',
      ivaIncluded: true,
    },
    unavailableItems: [],
  };
}

/** La cuenta que deja el alta con solo el correo (§CTA.4): sin verificar, sin contraseña. */
const emailOnly: UserDTO = {
  id: 'u-eo',
  email: 'ana@x.mx',
  name: 'ana',
  role: 'customer',
  locale: 'es',
  emailVerified: false,
  accountSetupPending: true,
  hasPassword: false,
};

beforeEach(() => {
  window.localStorage.clear();
  clearUnavailableNotice();
  currentPath = '/es/checkout';
  vi.mocked(getCheckoutQuote).mockReset();
  vi.mocked(createCheckoutSession).mockReset();
});

/**
 * CTA-F3 (API_CONTRACT §CTA.9, criterios 48/969/976): `201` del alta ⇒ sesión guardada y bóveda disponible
 * (`onAccountReady`), y PAGAR llama a `checkout/session` SIN el aviso de verificar correo (§CTA.5: comprar ya no lo
 * exige). Mutación: seguir pintando el aviso antes de pagar.
 */
describe('CTA-F3 · alta en el upsell y pago sin aviso de verificación', () => {
  it('upsell: solo el correo ⇒ registerEmailOnly, sesión guardada sin verificar y el checkout continúa con bóveda', async () => {
    const usr = userEvent.setup();
    const onAccountReady = vi.fn();
    renderWithProviders(<VaultUpsellPanel defaultEmail="ana@x.mx" onDismiss={vi.fn()} onAccountReady={onAccountReady} />, 'es');
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    expect(screen.queryByLabelText('Nombre')).toBeNull();
    await usr.click(screen.getByRole('button', { name: 'Crear cuenta y guardar en bóveda' }));
    await waitFor(() => expect(onAccountReady).toHaveBeenCalledTimes(1));
    expect(vi.mocked(registerEmailOnly)).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@x.mx' }));
    expect(vi.mocked(register)).not.toHaveBeenCalled();
    expect(getStoredUser()).toMatchObject({ email: 'ana@x.mx', emailVerified: false });
  });

  it('con la cuenta recién nacida, PAGAR llama a checkout/session y no se pinta ningún aviso de verificar', async () => {
    const usr = userEvent.setup();
    setStoredUser(emailOnly);
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1001'], updatedAt: Date.now() }));
    vi.mocked(getCheckoutQuote).mockImplementation(async (ids) => quote(ids));
    vi.mocked(createCheckoutSession).mockResolvedValue({
      orderId: 'o-1',
      orderNumber: 'TCG-1',
      breakdown: quote(['inv-1001']).breakdown,
      stripe: { paymentIntentId: 'pi_cta', clientSecret: 'pi_cta_secret' },
    } as unknown as CheckoutSessionResponse);

    // Lo que pinta el layout de la tienda (el aviso global) + el checkout.
    renderWithProviders(
      <>
        <VerifyEmailBanner />
        <CheckoutView />
      </>,
      'es',
    );
    expect(screen.queryByText('Verifica tu correo')).not.toBeInTheDocument();
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(vi.mocked(createCheckoutSession)).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Verifica tu correo')).not.toBeInTheDocument();
    expect(screen.queryByText('Verifica tu correo para completar esta acción')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reenviar correo/ })).not.toBeInTheDocument();
  });

  it('fuera del checkout el aviso de verificar sigue (reclamar, retirar y vender lo exigen)', () => {
    currentPath = '/es/account';
    setStoredUser(emailOnly);
    renderWithProviders(<VerifyEmailBanner />, 'es');
    expect(screen.getByText('Verifica tu correo')).toBeInTheDocument();
  });
});
