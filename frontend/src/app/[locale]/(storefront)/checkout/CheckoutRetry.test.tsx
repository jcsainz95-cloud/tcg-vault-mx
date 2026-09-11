import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import type { CheckoutSessionResponse, GuestCheckoutSessionResponse, UserDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

// Las DOS sessions se mockean para dictar el desenlace del reintento (§4-R); los quotes van por
// la rama mock real (fixtures), que es la que ejercita el resto de la vista.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    createCheckoutSession: vi.fn(),
    createGuestCheckoutSession: vi.fn(),
    // Los quotes conservan la rama mock por defecto; cada test los redefine cuando dicta la forma.
    getCheckoutQuote: vi.fn(actual.getCheckoutQuote),
    getGuestCheckoutQuote: vi.fn(actual.getGuestCheckoutQuote),
  };
});

import { createCheckoutSession, createGuestCheckoutSession, getCheckoutQuote, getGuestCheckoutQuote } from '@/lib/api';
import { mockListings, orderItemCard } from '@/lib/mock/fixtures';
import type { CheckoutQuoteResponse } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';
import { CheckoutView } from './CheckoutView';
import { GuestCheckoutView } from './GuestCheckoutView';
import { GUEST_RETRY_TOKEN_KEY } from './guest-retry-token';
import { clearUnavailableNotice } from './unavailable-notice';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Contrato v1.68 · **§4-R «la reserva tiene DUEÑO»** (P-59). El reintento del MISMO cliente
 * sobre su propia reserva ya no muere en `ITEM_UNAVAILABLE`: responde `200 reused` (mismo
 * pedido, mismo PI), `201` con `supersededOrderIds`, o `409 PAYMENT_IN_PROGRESS`. Lo que se
 * fija aquí es lo que el cliente LEE en cada uno — porque es dinero, y la pregunta que se hace
 * es «¿me van a cobrar dos veces?».
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

const user: UserDTO = {
  id: 'u-1',
  email: 'cliente@example.com',
  name: 'Cliente',
  role: 'customer',
  locale: 'es',
  emailVerified: true,
};

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, updatedAt: Date.now() }));
}

const IN_30_MIN = () => new Date(Date.now() + 30 * 60_000).toISOString();

function customerSession(over: Partial<CheckoutSessionResponse> = {}): CheckoutSessionResponse {
  return {
    orderId: 'ord-1',
    orderNumber: 'TCG-000001',
    breakdown: { subtotalCents: 1000, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 1160, currency: 'MXN' },
    stripe: { paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret' },
    reused: false,
    reservedUntil: IN_30_MIN(),
    supersededOrderIds: [],
    ...over,
  };
}

function guestSession(over: Partial<GuestCheckoutSessionResponse> = {}): GuestCheckoutSessionResponse {
  return {
    orderId: 'ord-g-1',
    orderNumber: 'TCG-000123',
    breakdown: { subtotalCents: 1000, shippingFeeCents: 17500, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 18660, currency: 'MXN' },
    checkoutToken: 'tok-first',
    checkoutTokenExpiresAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    stripe: { paymentIntentId: 'pi_g1', clientSecret: 'pi_g1_secret' },
    reused: false,
    reservedUntil: IN_30_MIN(),
    supersededOrderIds: [],
    ...over,
  };
}

function storedIds(): string[] {
  return JSON.parse(window.localStorage.getItem('tcg.cart')!).ids;
}

/** Quote `customer` (§4 + v1.68.1 §4-R.5) construido a mano para dictar `reservedByYou` / `ownReservation`. */
function customerQuote(over: Partial<CheckoutQuoteResponse> = {}): CheckoutQuoteResponse {
  const l = mockListings.find((x) => x.inventoryItemId === 'inv-1002')!;
  return {
    items: [{ inventoryItemId: 'inv-1002', card: orderItemCard(l), unitPriceCents: l.salePriceCents ?? 0 }],
    breakdown: { subtotalCents: 1000, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 1160, currency: 'MXN' },
    unavailableItems: [],
    ownReservation: null,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearUnavailableNotice();
  vi.mocked(createCheckoutSession).mockReset();
  vi.mocked(createGuestCheckoutSession).mockReset();
  vi.mocked(getCheckoutQuote).mockReset();
  vi.mocked(getGuestCheckoutQuote).mockReset();
  seedCart(['inv-1002']);
});

describe('checkout con cuenta · reintento sobre la propia reserva (§4-R.2)', () => {
  beforeEach(() => setStoredUser(user));

  it('201 normal: pinta la cuenta atrás con el `reservedUntil` DEL SERVIDOR y ningún aviso de reuso', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession());
    renderWithProviders(<CheckoutView />, 'es');

    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    await screen.findByRole('dialog');

    const countdown = await screen.findByTestId('reservation-countdown');
    expect(countdown).toHaveTextContent(/Reservado para ti hasta las \d{1,2}:\d{2}/);
    expect(screen.getByTestId('reservation-remaining')).toHaveTextContent(/Tiempo restante: \d{2}:\d{2}/);
    expect(screen.queryByText(/Recuperamos tu reserva/)).toBeNull();
    expect(screen.queryByText(/se cancel/)).toBeNull();
  });

  it('200 reused: «mismo pedido, mismo cobro» con el folio, y el aviso SOBREVIVE al cierre del modal', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession({ reused: true }));
    renderWithProviders(<CheckoutView />, 'es');

    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByText('Recuperamos tu reserva anterior (TCG-000001): es el mismo pedido y el mismo cobro, no se duplica nada.')).toBeInTheDocument();

    // El cliente cierra el modal sin pagar: la reserva sigue siendo suya y lo sigue viendo.
    await usr.click(within(dialog).getByRole('button', { name: /Close|Cerrar/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Recuperamos tu reserva anterior/)).toBeInTheDocument();
    expect(screen.getByTestId('reservation-countdown')).toBeInTheDocument();
  });

  it('201 con supersededOrderIds: «tu intento anterior se canceló; solo se cobra este»', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession({ supersededOrderIds: ['ord-0'] }));
    renderWithProviders(<CheckoutView />, 'es');

    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    expect(await screen.findByText('Tu intento anterior se canceló: este pedido lo sustituye y solo se cobra este.')).toBeInTheDocument();
    // Es información (`status`), no un error: ningún `alert` en pantalla.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('plural: dos intentos sustituidos', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession({ supersededOrderIds: ['ord-0', 'ord-00'] }));
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    expect(await screen.findByText(/Tus 2 intentos anteriores se cancelaron/)).toBeInTheDocument();
  });

  it('409 PAYMENT_IN_PROGRESS: bloqueo explicado, enlace al pedido y «Reintentar en un momento» que vuelve a llamar', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession)
      .mockRejectedValueOnce(
        new ApiClientError(409, {
          code: 'PAYMENT_IN_PROGRESS',
          message: 'Previous payment can no longer be canceled',
          details: { orderId: 'ord-prev', orderNumber: 'TCG-000009' },
        }),
      )
      .mockResolvedValueOnce(customerSession({ reused: true, orderId: 'ord-prev', orderNumber: 'TCG-000009' }));
    renderWithProviders(<CheckoutView />, 'es');

    const pay = await screen.findByRole('button', { name: /Pagar/ });
    await usr.click(pay);

    const block = await screen.findByTestId('payment-in-progress');
    expect(block).toHaveAttribute('role', 'alert');
    expect(block).toHaveTextContent('no se cobra dos veces');
    expect(within(block).getByRole('link', { name: 'Ver pedido TCG-000009' })).toHaveAttribute('href', '/orders/ord-prev');
    // El botón principal se apaga: la salida es el enlace o el reintento explícito.
    expect(screen.getByRole('button', { name: /Pagar MX\$/ })).toBeDisabled();
    // Ni el modal ni el genérico.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Algo salió mal')).toBeNull();

    await usr.click(within(block).getByRole('button', { name: 'Reintentar en un momento' }));
    await waitFor(() => expect(vi.mocked(createCheckoutSession)).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-in-progress')).toBeNull();
    // El botón principal vive en el aside; el del modal simulado es otro.
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: /Pagar MX\$/ })).not.toBeDisabled();
  });

  it('sin `reservedUntil` (backend anterior a v1.68) no se pinta ninguna cuenta atrás: nada inventado', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue({
      orderId: 'ord-old',
      breakdown: customerSession().breakdown,
      stripe: { paymentIntentId: 'pi_old', clientSecret: 'pi_old_secret' },
    });
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('checkout-retry-notice')).toBeNull();
    expect(screen.queryByTestId('reservation-countdown')).toBeNull();
  });

  it('reservedUntil YA VENCIDO: dice que venció, sin contador', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(
      customerSession({ reservedUntil: new Date(Date.now() - 60_000).toISOString() }),
    );
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    expect(await screen.findByTestId('reservation-expired')).toHaveTextContent('La reserva venció');
    expect(screen.queryByTestId('reservation-remaining')).toBeNull();
  });
});

describe('checkout con cuenta · el QUOTE conoce la reserva propia (v1.68.1 §4-R.5)', () => {
  beforeEach(() => setStoredUser(user));

  it('⭐ NO poda una pieza `reservedByYou` aunque el servidor la liste también como no disponible', async () => {
    vi.mocked(getCheckoutQuote).mockResolvedValue(
      customerQuote({
        items: [{ ...customerQuote().items[0], reservedByYou: true }],
        unavailableItems: [{ inventoryItemId: 'inv-1002', cardName: 'Blastoise' }],
        ownReservation: { orderId: 'ord-own', orderNumber: 'TCG-000777', reservedUntil: IN_30_MIN(), expired: false, coversCart: true },
      }),
    );
    renderWithProviders(<CheckoutView />, 'es');

    expect(await screen.findByTestId('own-reservation-active')).toHaveTextContent('reservado a tu nombre (TCG-000777)');
    // Sigue en el carrito y en pantalla; ningún aviso de poda.
    expect(screen.getByText('Blastoise')).toBeInTheDocument();
    expect(storedIds()).toEqual(['inv-1002']);
    expect(screen.queryByTestId('unavailable-notice')).toBeNull();
    // Y la cuenta atrás sale del `reservedUntil` de la reserva propia, antes de pagar.
    expect(screen.getByTestId('reservation-countdown')).toHaveTextContent(/Reservado para ti hasta las \d{1,2}:\d{2}/);
  });

  it('una pieza muerta de verdad SÍ se poda aunque otra sea `reservedByYou`', async () => {
    seedCart(['inv-1002', 'inv-dead']);
    vi.mocked(getCheckoutQuote).mockImplementation(async (ids) =>
      customerQuote({
        items: ids.includes('inv-1002') ? [{ ...customerQuote().items[0], reservedByYou: true }] : [],
        unavailableItems: ids.includes('inv-dead') ? [{ inventoryItemId: 'inv-dead', cardName: null }] : [],
        ownReservation: { orderId: 'ord-own', orderNumber: 'TCG-000777', reservedUntil: IN_30_MIN(), expired: false, coversCart: false },
      }),
    );
    renderWithProviders(<CheckoutView />, 'es');
    await waitFor(() => expect(storedIds()).toEqual(['inv-1002']));
    expect(await screen.findByTestId('unavailable-notice')).toBeInTheDocument();
  });

  it('reserva propia VENCIDA (`expired: true`): «tu reserva venció: al pagar se renovará», sin cuenta atrás', async () => {
    vi.mocked(getCheckoutQuote).mockResolvedValue(
      customerQuote({
        items: [{ ...customerQuote().items[0], reservedByYou: true }],
        ownReservation: { orderId: 'ord-own', orderNumber: 'TCG-000777', reservedUntil: new Date(Date.now() - 60_000).toISOString(), expired: true, coversCart: true },
      }),
    );
    renderWithProviders(<CheckoutView />, 'es');
    expect(await screen.findByTestId('own-reservation-expired')).toHaveTextContent('venció');
    expect(screen.queryByTestId('reservation-countdown')).toBeNull();
    expect(screen.queryByTestId('reservation-expired')).toBeNull();
    expect(storedIds()).toEqual(['inv-1002']);
  });

  it('`ownReservation: null` (o ausente, backend anterior): no pinta nada', async () => {
    vi.mocked(getCheckoutQuote).mockResolvedValue(customerQuote({ ownReservation: null }));
    renderWithProviders(<CheckoutView />, 'es');
    await screen.findByText('Blastoise');
    expect(screen.queryByTestId('checkout-retry-notice')).toBeNull();
  });

  it('tras pagar, el desenlace de la SESSION manda sobre el aviso del quote (un solo aviso)', async () => {
    const usr = userEvent.setup();
    vi.mocked(getCheckoutQuote).mockResolvedValue(
      customerQuote({
        items: [{ ...customerQuote().items[0], reservedByYou: true }],
        ownReservation: { orderId: 'ord-own', orderNumber: 'TCG-000777', reservedUntil: IN_30_MIN(), expired: false, coversCart: true },
      }),
    );
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession({ reused: true, orderId: 'ord-own', orderNumber: 'TCG-000777' }));
    renderWithProviders(<CheckoutView />, 'es');
    await screen.findByTestId('own-reservation-active');
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(await screen.findByText(/Recuperamos tu reserva anterior \(TCG-000777\)/)).toBeInTheDocument();
    expect(screen.queryByTestId('own-reservation-active')).toBeNull();
  });
});

describe('checkout de invitado · el token es la llave del reintento (§4-R.3)', () => {
  async function fillGuestForm(usr: ReturnType<typeof userEvent.setup>) {
    await usr.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Ciudad'), 'CDMX');
    await usr.type(screen.getByLabelText('Estado'), 'CDMX');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
  }

  it('el primer intento guarda el checkoutToken en sessionStorage (nunca localStorage) y el reintento lo manda como retryOfCheckoutToken', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession)
      .mockResolvedValueOnce(guestSession({ checkoutToken: 'tok-first' }))
      .mockResolvedValueOnce(guestSession({ reused: true, checkoutToken: 'tok-second' }));
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[0][0]).not.toHaveProperty('retryOfCheckoutToken');
    expect(JSON.parse(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)!).token).toBe('tok-first');
    expect(window.localStorage.getItem(GUEST_RETRY_TOKEN_KEY)).toBeNull();

    // Intento caído: cierra el modal y vuelve a pagar.
    await usr.click(within(dialog).getByRole('button', { name: /Close|Cerrar/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));

    await waitFor(() => expect(vi.mocked(createGuestCheckoutSession)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createGuestCheckoutSession).mock.calls[1][0].retryOfCheckoutToken).toBe('tok-first');
    // El `200` de reuso emite token nuevo: sustituye al anterior.
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)!).token).toBe('tok-second'),
    );
    expect(await screen.findByText(/Recuperamos tu reserva anterior \(TCG-000123\)/)).toBeInTheDocument();
  });

  it('v1.68.1: tras el primer intento el QUOTE viaja con `retryOfCheckoutToken` + `email` (y antes, sin ellos)', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValueOnce(guestSession({ checkoutToken: 'tok-first' }));
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    // Antes de la sesión: sin token (aunque el correo ya esté confirmado).
    await waitFor(() => expect(vi.mocked(getGuestCheckoutQuote)).toHaveBeenCalled());
    expect(vi.mocked(getGuestCheckoutQuote).mock.calls.every(([, , retry]) => retry === undefined)).toBe(true);

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await screen.findByRole('dialog');
    // Con token y correo confirmado, el quote se re-pide con los dos (normalizados).
    await waitFor(() =>
      expect(vi.mocked(getGuestCheckoutQuote).mock.calls.at(-1)?.[2]).toEqual({
        retryOfCheckoutToken: 'tok-first',
        email: 'juan@dominio.com',
      }),
    );
  });

  it('v1.68.1: al montar con token en sessionStorage pero correo SIN confirmar, el quote no manda el token (token sin email ⇒ 400)', async () => {
    window.sessionStorage.setItem(GUEST_RETRY_TOKEN_KEY, JSON.stringify({ token: 'tok-old', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await screen.findByTestId('amount-breakdown');
    expect(vi.mocked(getGuestCheckoutQuote).mock.calls.every(([, , retry]) => retry === undefined)).toBe(true);
  });

  it('tras pagar (simulado) el token de reintento se borra: un pedido pagado no se reintenta', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).not.toBeNull();

    await usr.click(within(dialog).getByRole('button', { name: /Pagar .*\(simulado\)|Pagar \(simulado\)/ }));
    await waitFor(() => expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).toBeNull(), { timeout: 4000 });
  });

  it('409 PAYMENT_IN_PROGRESS: bloqueo explicado SIN enlace a /orders (no hay cuenta) y con reintento', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockRejectedValue(
      new ApiClientError(409, { code: 'PAYMENT_IN_PROGRESS', message: 'x', details: { orderId: 'ord-g-0', orderNumber: 'TCG-000100' } }),
    );
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));

    const block = await screen.findByTestId('payment-in-progress');
    expect(block).toHaveTextContent('con este correo');
    expect(within(block).queryByRole('link')).toBeNull();
    expect(within(block).getByRole('button', { name: 'Reintentar en un momento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pagar MX\$/ })).toBeDisabled();
  });
});
