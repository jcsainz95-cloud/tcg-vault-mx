import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import { breakdownOf, guestQuote } from '@/test/accessories.testkit';
import type { GuestCheckoutQuoteResponse, GuestCheckoutSessionResponse, UserDTO } from '@/types/contract';

/**
 * CHK-MOVIL.2.4 (opción A) en <lg — barra fija con T3 + «Ver desglose» y TOTAL + PAGAR. Viewport MÓVIL
 * (`matchMedia` = false). ⛔ Ningún importe se escribe aquí: todos salen de la cotización mockeada.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

import { GuestCheckoutView } from './GuestCheckoutView';
import { CheckoutView } from './CheckoutView';
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('mobile');

const CARD_ITEM = {
  inventoryItemId: 'inv-1002',
  card: { cardId: 'c-1', name: 'Charizard', setName: 'Base Set', number: '4', productType: 'raw', rawCondition: 'NM', imageSmallUrl: null },
  unitPriceCents: 100_000,
} as unknown as GuestCheckoutQuoteResponse['items'][number];

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, accessories: [], deckPulls: [], updatedAt: Date.now() }));
}

function renderGuest() {
  return renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(api, 'getAccessorySuggestions').mockResolvedValue({ items: [] });
  seedCart(['inv-1002']);
});

describe('CHK-MOVIL.2.4 · barra fija (invitado)', () => {
  it('una sola copia de PAGAR y del desglose; sin `aside`; T3a con los importes del quote', async () => {
    // Importes deliberadamente raros (12345 / 678): si la barra los inventara, no casarían.
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({ items: [CARD_ITEM], breakdown: { ...breakdownOf(100_000, 12_345, 113_023), processingFeeCents: 678 } }),
    );
    renderGuest();
    const bar = await screen.findByTestId('checkout-pay-bar');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Pagar/ })).toHaveLength(1);
    expect(within(bar).getByRole('button', { name: 'Pagar' })).toBeInTheDocument();
    expect(within(bar).getByTestId('checkout-pay-bar-summary')).toHaveTextContent(
      'Incluye envío MX$123.45 y comisión de plataforma MX$6.78',
    );
    expect(within(bar).getByTestId('checkout-pay-bar-total')).toHaveTextContent('MX$1,130.23');
    // Desglose plegado: no hay copia del desglose en el DOM hasta abrirlo.
    expect(screen.queryByTestId('amount-breakdown')).toBeNull();
  });

  it('«Ver desglose» abre la región con AmountBreakdown; Esc la cierra y devuelve el foco', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ items: [CARD_ITEM] }));
    renderGuest();
    const bar = await screen.findByTestId('checkout-pay-bar');
    const toggle = within(bar).getByRole('button', { name: /Ver desglose/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = within(bar).getByRole('region', { name: 'Resumen' });
    expect(within(region).getByTestId('amount-breakdown')).toBeInTheDocument();
    expect(region).not.toHaveAttribute('aria-modal');
    expect(screen.getAllByTestId('amount-breakdown')).toHaveLength(1);
    fireEvent.keyDown(within(region).getByTestId('amount-breakdown'), { key: 'Escape' });
    expect(within(bar).queryByRole('region')).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it('con un campo de texto enfocado la barra no se pinta; al salir, vuelve', async () => {
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ items: [CARD_ITEM] }));
    renderGuest();
    await screen.findByTestId('checkout-pay-bar');
    const email = screen.getByLabelText('Correo electrónico');
    email.focus();
    await waitFor(() => expect(screen.queryByTestId('checkout-pay-bar')).toBeNull());
    email.blur();
    await waitFor(() => expect(screen.getByTestId('checkout-pay-bar')).toBeInTheDocument());
  });

  it('elegir bóveda: la línea 1 se sustituye por la explicación y describe a PAGAR (§15.9)', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ items: [CARD_ITEM] }));
    renderGuest();
    await screen.findByTestId('checkout-pay-bar');
    await user.click(screen.getByRole('button', { name: /Guardar en mi bóveda/ }));
    const bar = screen.getByTestId('checkout-pay-bar');
    expect(within(bar).queryByRole('button', { name: /Ver desglose/ })).toBeNull();
    const pay = within(bar).getByRole('button', { name: 'Pagar' });
    expect(pay).toBeDisabled();
    expect(pay).toHaveAccessibleDescription('Para pagar, crea tu cuenta o elige envío a domicilio.');
  });

  it('T3a con envío 0: «Incluye envío gratis y comisión…»; T9 con cualquier clase y falta > 0', async () => {
    const spy = vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(
      guestQuote({
        items: [CARD_ITEM],
        breakdown: breakdownOf(100_000, 0, 100_400),
        shippingRule: { kind: 'sealed', freeFromCents: 400_000, freeShippingRemainingCents: 0, freeShippingApplied: true, boxFeeApplies: false },
      }),
    );
    const { unmount } = renderGuest();
    const bar = await screen.findByTestId('checkout-pay-bar');
    expect(within(bar).getByTestId('checkout-pay-bar-summary')).toHaveTextContent('Incluye envío gratis y comisión de plataforma MX$4.00');
    expect(screen.queryByTestId('free-shipping-remaining')).toBeNull();
    unmount();

    spy.mockResolvedValue(
      guestQuote({
        items: [CARD_ITEM],
        shippingRule: { kind: 'sealed', freeFromCents: 400_000, freeShippingRemainingCents: 123_456, freeShippingApplied: false, boxFeeApplies: false },
      }),
    );
    const second = renderGuest();
    expect(await screen.findByTestId('free-shipping-remaining')).toHaveTextContent('Te faltan MX$1,234.56 para envío gratis');
    second.unmount();

    // Solo cartas (dueño 2026-10-25, opción A): el umbral también vale ⇒ T9 con el número del backend.
    spy.mockResolvedValue(
      guestQuote({
        items: [CARD_ITEM],
        shippingRule: { kind: 'cards_only', freeFromCents: 400_000, freeShippingRemainingCents: 98_765, freeShippingApplied: false, boxFeeApplies: false },
      }),
    );
    const third = renderGuest();
    expect(await screen.findByTestId('free-shipping-remaining')).toHaveTextContent('Te faltan MX$987.65 para envío gratis');
    third.unmount();

    // Servidor que aún manda `null` en solo cartas (contrato v1.109.1) ⇒ sin T9: el front no calcula la falta.
    spy.mockResolvedValue(
      guestQuote({
        items: [CARD_ITEM],
        shippingRule: { kind: 'cards_only', freeFromCents: null, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: false },
      }),
    );
    renderGuest();
    await screen.findByTestId('checkout-pay-bar');
    expect(screen.queryByTestId('free-shipping-remaining')).toBeNull();
  });

  it('L6 (unidad): doble toque en PAGAR con el formulario completo crea UNA sola sesión', async () => {
    const usr = userEvent.setup();
    vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ items: [CARD_ITEM] }));
    let release: (v: GuestCheckoutSessionResponse) => void = () => {};
    const session = vi.spyOn(api, 'createGuestCheckoutSession').mockImplementation(
      () => new Promise<GuestCheckoutSessionResponse>((r) => (release = r)),
    );
    renderGuest();
    await screen.findByTestId('checkout-pay-bar');
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
    (document.activeElement as HTMLElement | null)?.blur();

    const pay = await screen.findByRole('button', { name: 'Pagar' });
    // Dos eventos en el MISMO tick: el estado `creating` aún no se ha pintado cuando llega el segundo.
    fireEvent.click(pay);
    fireEvent.click(pay);
    await waitFor(() => expect(session).toHaveBeenCalledTimes(1));
    release({
      orderId: 'o-1',
      orderNumber: 'TH-1',
      breakdown: breakdownOf(100_000, 17_500, 117_900),
      stripe: { paymentIntentId: 'pi_1', clientSecret: 'cs_1' },
      checkoutToken: 'tok',
      checkoutTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    } as unknown as GuestCheckoutSessionResponse);
    await waitFor(() => expect(session).toHaveBeenCalledTimes(1));
  });
});

describe('CHK-MOVIL.2.4/2.6 · barra fija (con cuenta)', () => {
  const user: UserDTO = { id: 'u-1', email: 'cliente@example.com', name: 'Cliente', role: 'customer', locale: 'es', emailVerified: true };

  it('T3b con la comisión del quote, sin envío; sin el bloque de 3 beneficios; T8 junto a «ventas finales»', async () => {
    setStoredUser(user);
    vi.spyOn(api, 'getCheckoutQuote').mockResolvedValue({
      items: [CARD_ITEM],
      breakdown: { ...breakdownOf(100_000, undefined, 100_987), processingFeeCents: 987 },
      unavailableItems: [],
      ownReservation: null,
    });
    renderWithProviders(<CheckoutView />, 'es');
    const bar = await screen.findByTestId('checkout-pay-bar');
    expect(within(bar).getByTestId('checkout-pay-bar-summary')).toHaveTextContent('Incluye comisión de plataforma MX$9.87');
    expect(within(bar).getByTestId('checkout-pay-bar-summary')).not.toHaveTextContent(/envío/i);
    expect(screen.queryByText('Custodia con condición verificada y garantizada.')).toBeNull();
    expect(screen.getByText('Si tu carta llega dañada o equivocada, te reembolsamos.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Pagar/ })).toHaveLength(1);
  });
});
