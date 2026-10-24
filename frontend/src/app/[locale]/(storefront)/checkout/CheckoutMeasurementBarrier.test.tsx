import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import type { CheckoutSessionResponse, GuestCheckoutSessionResponse, OrderItemPreview, UserDTO } from '@/types/contract';

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
  return { ...actual, createCheckoutSession: vi.fn(), createGuestCheckoutSession: vi.fn() };
});

// `trackPurchase` real por defecto; la prueba de ORDEN lo sustituye para leer el estado en el instante de la llamada.
vi.mock('@/lib/measurement/ecommerce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/measurement/ecommerce')>();
  return { ...actual, trackPurchase: vi.fn(actual.trackPurchase) };
});

import { createCheckoutSession, createGuestCheckoutSession } from '@/lib/api';
import { trackPurchase } from '@/lib/measurement/ecommerce';
import { setRuntimeConsent } from '@/lib/measurement/track';
import { CheckoutView } from './CheckoutView';
import { GuestCheckoutView } from './GuestCheckoutView';
import { GUEST_RETRY_TOKEN_KEY } from './guest-retry-token';
import { clearUnavailableNotice } from './unavailable-notice';
import { setCheckoutViewport } from './test-viewport';

// Escritas para el layout de escritorio (`aside`); la barra fija móvil tiene su prueba propia (CheckoutPayBar.test.tsx).
setCheckoutViewport('desktop');

/**
 * TL R1 (2026-10-19) — la medición no puede dejar colgado un cobro ya hecho.
 * `gtag`/`fbq` son código de terceros: si lanzan, el pago termina igual (sesión limpia, carrito vacío,
 * token de reintento borrado, pantalla de pagado). Y `purchase` se manda DESPUÉS del estado de dinero.
 */

const user: UserDTO = { id: 'u-1', email: 'cliente@example.com', name: 'Cliente', role: 'customer', locale: 'es', emailVerified: true };
const IN_30_MIN = () => new Date(Date.now() + 30 * 60_000).toISOString();

function customerSession(): CheckoutSessionResponse {
  return {
    orderId: 'ord-1',
    orderNumber: 'TCG-000001',
    breakdown: { subtotalCents: 1000, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 1160, currency: 'MXN', priceConvention: 'IVA_EXCLUSIVE', ivaIncluded: false },
    stripe: { paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret' },
    reused: false,
    reservedUntil: IN_30_MIN(),
    supersededOrderIds: [],
  };
}

function guestSession(): GuestCheckoutSessionResponse {
  return {
    orderId: 'ord-g-1',
    orderNumber: 'TCG-000123',
    breakdown: { subtotalCents: 1000, shippingFeeCents: 17500, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 18660, currency: 'MXN', priceConvention: 'IVA_EXCLUSIVE', ivaIncluded: false },
    checkoutToken: 'tok-first',
    checkoutTokenExpiresAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    stripe: { paymentIntentId: 'pi_g1', clientSecret: 'pi_g1_secret' },
    reused: false,
    reservedUntil: IN_30_MIN(),
    supersededOrderIds: [],
  };
}

const storedIds = (): string[] => JSON.parse(window.localStorage.getItem('tcg.cart') ?? '{"ids":[]}').ids;

async function fillGuestForm(usr: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText('Correo electrónico'); // CHK-MOVIL.2.1: el formulario está desde el primer pintado
  await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
  await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
  await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
  await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
  await usr.type(screen.getByLabelText('Código postal'), '06600');
  await screen.findByRole('option', { name: 'Juárez' });
  await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
  await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
  await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
}

type W = { gtag?: unknown; fbq?: unknown };
let gtag: ReturnType<typeof vi.fn>;
let fbq: ReturnType<typeof vi.fn>;
let throwAll = false;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearUnavailableNotice();
  vi.mocked(createCheckoutSession).mockReset();
  vi.mocked(createGuestCheckoutSession).mockReset();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
  window.history.replaceState(null, '', '/es/checkout');
  // Modo `on`, elección completa y las DOS etiquetas lanzando en `purchase` (como un `fbevents.js`
  // roto). `throwAll` las hace lanzar en todo (también en el `begin_checkout` de la cotización).
  vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
  setRuntimeConsent({ analytics: true, ads: true });
  throwAll = false;
  gtag = vi.fn((_cmd: unknown, name: unknown) => {
    if (throwAll || name === 'purchase') throw new Error('gtag roto');
  });
  fbq = vi.fn((_cmd: unknown, name: unknown) => {
    if (throwAll || name === 'Purchase') throw new Error('fbq roto');
  });
  (window as unknown as W).gtag = gtag;
  (window as unknown as W).fbq = fbq;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRuntimeConsent(null);
  delete (window as unknown as W).gtag;
  delete (window as unknown as W).fbq;
  window.history.replaceState(null, '', '/');
});

const purchaseCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter((c) => c[1] === 'purchase' || c[1] === 'Purchase');

describe('TL R1 · checkout con cuenta: gtag/fbq lanzando no cuelgan el pago', () => {
  beforeEach(() => setStoredUser(user));

  it('el pago termina: sin modal, carrito vacío, pantalla «Pago en proceso»; y sí se intentó `purchase`', async () => {
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession());
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));

    expect(await screen.findByText('Pago en proceso', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storedIds()).toEqual([]);
    // El instrumento corrió de verdad: las dos etiquetas recibieron `purchase` y lanzaron.
    expect(purchaseCalls(gtag)).toHaveLength(1);
    expect(purchaseCalls(fbq)).toHaveLength(1);
  });

  it('etiquetas que lanzan en TODO: la cotización (begin_checkout) se pinta y el pago termina', async () => {
    throwAll = true;
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession());
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));
    expect(await screen.findByText('Pago en proceso', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(storedIds()).toEqual([]);
    expect(gtag.mock.calls.some((c) => c[1] === 'begin_checkout')).toBe(true);
  });

  it('ORDEN: cuando se llama `trackPurchase`, el carrito ya está vacío', async () => {
    const usr = userEvent.setup();
    let cartAtTrack: string[] | null = null;
    vi.mocked(trackPurchase).mockImplementationOnce(() => {
      cartAtTrack = storedIds();
    });
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession());
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));
    await waitFor(() => expect(cartAtTrack).not.toBeNull(), { timeout: 4000 });
    expect(cartAtTrack).toEqual([]);
  });
});

describe('TL R1 · checkout de invitado: gtag/fbq lanzando no cuelgan el pago', () => {
  it('el pago termina: token de reintento borrado, carrito vacío, confirmación con folio', async () => {
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    const onPaid = vi.fn();
    renderWithProviders(<GuestCheckoutView onPaid={onPaid} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).not.toBeNull();
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));

    expect(await screen.findByTestId('guest-order-number', {}, { timeout: 4000 })).toHaveTextContent('TCG-000123');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).toBeNull();
    expect(storedIds()).toEqual([]);
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(purchaseCalls(gtag)).toHaveLength(1);
    expect(purchaseCalls(fbq)).toHaveLength(1);
  });

  it('ORDEN: cuando se llama `trackPurchase`, el token ya no está y el carrito ya está vacío', async () => {
    const usr = userEvent.setup();
    let at: { token: string | null; cart: string[] } | null = null;
    vi.mocked(trackPurchase).mockImplementationOnce(() => {
      at = { token: window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY), cart: storedIds() };
    });
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));
    await waitFor(() => expect(at).not.toBeNull(), { timeout: 4000 });
    expect(at).toEqual({ token: null, cart: [] });
  });
});

/**
 * TL-MKT2b-a + QA menor 2 (2026-10-19) — un dato roto DENTRO de la medición (no en la etiqueta del tercero):
 * una línea con `card: null` hace lanzar a `measurementItemOf` en `itemsFromQuote`. Antes eso se evaluaba
 * fuera de `neverThrow` y salía de `onConfirmed`/`handleMockPay` como rechazo sin capturar. La cotización no
 * puede PINTAR `card: null` (lee `item.card.name`), así que la línea se añade en la frontera de medición: el
 * `trackPurchase` REAL recibe la cotización de verdad más esa línea.
 * Muerde con: quitar el `neverThrow` de `trackPurchase` (ecommerce.ts) **o** hacer que `neverThrow` relance (track.ts).
 */
const NULL_CARD_LINE = { inventoryItemId: 'inv-null', card: null, unitPriceCents: 500 } as unknown as OrderItemPreview;

async function purchaseWithNullCard(): Promise<{ ran: () => boolean }> {
  const real = await vi.importActual<typeof import('@/lib/measurement/ecommerce')>('@/lib/measurement/ecommerce');
  let ran = false;
  vi.mocked(trackPurchase).mockImplementationOnce((orderId, breakdown, items) => {
    ran = true;
    real.trackPurchase(orderId, breakdown, [...(items ?? []), NULL_CARD_LINE]);
  });
  return { ran: () => ran };
}

describe('TL-MKT2b-a · `card: null` en la medición no deja un rechazo sin capturar en el pago', () => {
  let rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  beforeEach(() => {
    rejections = [];
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });
  /** El rechazo de `handleMockPay` se notifica tras vaciar las microtareas: se le da un turno al bucle. */
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it('con cuenta: el pago termina, carrito vacío, y ningún rechazo sin capturar', async () => {
    setStoredUser(user);
    const probe = await purchaseWithNullCard();
    const usr = userEvent.setup();
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession());
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));
    expect(await screen.findByText('Pago en proceso', {}, { timeout: 4000 })).toBeInTheDocument();
    await settle();
    expect(probe.ran()).toBe(true);
    expect(storedIds()).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('invitado: el pago termina, token borrado, y ningún rechazo sin capturar', async () => {
    const probe = await purchaseWithNullCard();
    const usr = userEvent.setup();
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillGuestForm(usr);
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));
    expect(await screen.findByTestId('guest-order-number', {}, { timeout: 4000 })).toHaveTextContent('TCG-000123');
    await settle();
    expect(probe.ran()).toBe(true);
    expect(window.sessionStorage.getItem(GUEST_RETRY_TOKEN_KEY)).toBeNull();
    expect(rejections).toEqual([]);
  });
});
