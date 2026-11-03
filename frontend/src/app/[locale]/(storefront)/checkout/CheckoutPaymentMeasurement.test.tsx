import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getCheckoutQuote: vi.fn(actual.getCheckoutQuote),
    getGuestCheckoutQuote: vi.fn(actual.getGuestCheckoutQuote),
    createCheckoutSession: vi.fn(),
    createGuestCheckoutSession: vi.fn(),
  };
});

import { createCheckoutSession, createGuestCheckoutSession, getCheckoutQuote, getGuestCheckoutQuote } from '@/lib/api';
import { setRuntimeConsent } from '@/lib/measurement/track';
import { CheckoutView } from './CheckoutView';
import { GuestCheckoutView } from './GuestCheckoutView';
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('desktop');

/**
 * C-F11 (API_CONTRACT §MKT.H.4 v1.116, ARCHITECTURE §14.5): los dos pasos de pago se miden donde ocurren.
 *  - `begin_checkout`: al pulsar PAGAR, tras las guardas locales y ANTES de pedir la sesión; una vez por cotización.
 *    ⛔ Ya no al recibir la cotización (el «Carrito» de la cabecera lleva a /checkout).
 *  - `add_payment_info`: con la sesión resuelta (`clientSecret`), una vez por `paymentIntentId`; `value` = total de la
 *    SESIÓN; ⛔ sin `payment_type` (C-F6). Sesión rechazada ⇒ no sale.
 * Mutaciones que la ponen roja: volver a disparar `begin_checkout` en el efecto de la cotización; disparar
 * `add_payment_info` antes de la respuesta.
 */
type W = { gtag?: unknown; fbq?: unknown };
let gtag: ReturnType<typeof vi.fn>;
let fbq: ReturnType<typeof vi.fn>;

const ga = (name: string) => gtag.mock.calls.filter((c) => c[0] === 'event' && c[1] === name);
const px = (name: string) => fbq.mock.calls.filter((c) => c[1] === name);

const IN_30 = () => new Date(Date.now() + 30 * 60_000).toISOString();
const customerSession = (pi = 'pi_1', totalCents = 1160): CheckoutSessionResponse =>
  ({
    orderId: 'ord-1',
    orderNumber: 'TCG-000001',
    breakdown: { subtotalCents: 1000, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents, currency: 'MXN', priceConvention: 'IVA_EXCLUSIVE', ivaIncluded: false },
    stripe: { paymentIntentId: pi, clientSecret: `${pi}_secret` },
    reused: false,
    reservedUntil: IN_30(),
    supersededOrderIds: [],
  }) as unknown as CheckoutSessionResponse;
const guestSession = (): GuestCheckoutSessionResponse =>
  ({
    ...(customerSession('pi_g1', 18660) as unknown as GuestCheckoutSessionResponse),
    checkoutToken: 'tok',
    checkoutTokenExpiresAt: new Date(Date.now() + 120 * 60_000).toISOString(),
  }) as GuestCheckoutSessionResponse;

const user: UserDTO = { id: 'u-1', email: 'cliente@example.com', name: 'Cliente', role: 'customer', locale: 'es', emailVerified: true };

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(createCheckoutSession).mockReset();
  vi.mocked(createGuestCheckoutSession).mockReset();
  vi.mocked(getCheckoutQuote).mockClear();
  vi.mocked(getGuestCheckoutQuote).mockClear();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
  window.history.replaceState(null, '', '/es/checkout');
  vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
  setRuntimeConsent({ analytics: true, ads: true });
  gtag = vi.fn();
  fbq = vi.fn();
  (window as unknown as W).gtag = gtag;
  (window as unknown as W).fbq = fbq;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRuntimeConsent(null);
  delete (window as unknown as W).gtag;
  delete (window as unknown as W).fbq;
  window.history.replaceState(null, '', '/');
  setStoredUser(null);
});

async function quoteTotal(fn: ReturnType<typeof vi.fn>): Promise<number> {
  await waitFor(() => expect(fn).toHaveBeenCalled());
  const r = (await fn.mock.results[fn.mock.results.length - 1].value) as { breakdown: { totalCents: number } };
  return r.breakdown.totalCents / 100;
}

describe('C-F11 · checkout con cuenta', () => {
  beforeEach(() => setStoredUser(user));

  it('cotización sin pulsar ⇒ 0; PAGAR ⇒ 1 `begin_checkout` ANTES de la sesión; sesión ⇒ 1 `add_payment_info` con el total de la sesión', async () => {
    let release: (v: CheckoutSessionResponse) => void = () => {};
    vi.mocked(createCheckoutSession).mockImplementation(() => new Promise((r) => (release = r)));
    const usr = userEvent.setup();
    renderWithProviders(<CheckoutView />, 'es');
    const pay = await screen.findByRole('button', { name: /Pagar/ });
    const quoteValue = await quoteTotal(vi.mocked(getCheckoutQuote));
    expect(ga('begin_checkout'), 'la cotización sola no es «empezar a pagar»').toHaveLength(0);
    expect(px('InitiateCheckout')).toHaveLength(0);

    await usr.click(pay);
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(ga('begin_checkout')).toHaveLength(1);
    expect(ga('begin_checkout')[0][2]).toMatchObject({ value: quoteValue, currency: 'MXN' });
    expect(px('InitiateCheckout')).toHaveLength(1);
    // ANTES de pedir la sesión.
    const beginOrder = gtag.mock.invocationCallOrder[gtag.mock.calls.indexOf(ga('begin_checkout')[0])];
    expect(beginOrder).toBeLessThan(vi.mocked(createCheckoutSession).mock.invocationCallOrder[0]);
    // Sin respuesta todavía ⇒ ningún `add_payment_info`.
    expect(ga('add_payment_info')).toHaveLength(0);

    release(customerSession('pi_1', 1160));
    await screen.findByRole('dialog');
    expect(ga('add_payment_info')).toHaveLength(1);
    const params = ga('add_payment_info')[0][2] as Record<string, unknown>;
    expect(params).toMatchObject({ value: 11.6, currency: 'MXN' });
    expect(Array.isArray(params.items)).toBe(true);
    expect(params).not.toHaveProperty('payment_type');
    expect(params).not.toHaveProperty('payment_methods_offered');
    expect(px('AddPaymentInfo')).toHaveLength(1);
  });

  it('segunda sesión con el MISMO paymentIntentId (reuso §4-R) ⇒ sigue 1; la misma cotización no repite `begin_checkout`', async () => {
    vi.mocked(createCheckoutSession).mockResolvedValue(customerSession('pi_same'));
    const usr = userEvent.setup();
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await screen.findByRole('dialog');
    expect(createCheckoutSession).toHaveBeenCalledTimes(2);
    expect(ga('add_payment_info')).toHaveLength(1);
    expect(ga('begin_checkout')).toHaveLength(1);
  });

  it('sesión rechazada ⇒ 0 `add_payment_info`', async () => {
    vi.mocked(createCheckoutSession).mockRejectedValue(new Error('boom'));
    const usr = userEvent.setup();
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(ga('begin_checkout')).toHaveLength(1);
    expect(ga('add_payment_info')).toHaveLength(0);
  });
});

describe('C-F11 · checkout de invitado', () => {
  async function fill(usr: ReturnType<typeof userEvent.setup>, phone = '5512345678') {
    await screen.findByLabelText('Correo electrónico');
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
    await usr.type(screen.getByLabelText('Teléfono'), phone);
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
  }

  it('formulario incompleto ⇒ 0; completo ⇒ 1 `begin_checkout` antes de la sesión y 1 `add_payment_info` con el total de la sesión', async () => {
    vi.mocked(createGuestCheckoutSession).mockResolvedValue(guestSession());
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fill(usr, '55123');
    const quoteValue = await quoteTotal(vi.mocked(getGuestCheckoutQuote));
    expect(ga('begin_checkout')).toHaveLength(0);
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(ga('begin_checkout'), 'guarda local (formulario) no pasada').toHaveLength(0);
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();

    await usr.type(screen.getByLabelText('Teléfono'), '45678');
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await screen.findByRole('dialog');
    expect(ga('begin_checkout')).toHaveLength(1);
    expect(ga('begin_checkout')[0][2]).toMatchObject({ value: quoteValue, currency: 'MXN' });
    const beginOrder = gtag.mock.invocationCallOrder[gtag.mock.calls.indexOf(ga('begin_checkout')[0])];
    expect(beginOrder).toBeLessThan(vi.mocked(createGuestCheckoutSession).mock.invocationCallOrder[0]);
    expect(ga('add_payment_info')).toHaveLength(1);
    expect(ga('add_payment_info')[0][2]).toMatchObject({ value: 186.6, currency: 'MXN' });
    expect(ga('add_payment_info')[0][2]).not.toHaveProperty('payment_type');
  });

  it('elegir bóveda (abre el upsell) ⇒ 0 `begin_checkout`', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fill(usr);
    await usr.click(screen.getByRole('button', { name: /Guardar en mi bóveda/ }));
    expect(screen.getByRole('button', { name: /Pagar/ })).toBeDisabled();
    expect(ga('begin_checkout')).toHaveLength(0);
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
  });
});
