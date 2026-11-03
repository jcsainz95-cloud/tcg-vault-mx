import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  return { ...actual, createCheckoutSession: vi.fn(), createGuestCheckoutSession: vi.fn() };
});

/** El modal se sustituye por un doble que guarda sus props: aquí se prueba QUÉ le pasa cada vista. */
const { modalProps } = vi.hoisted(() => ({ modalProps: [] as Array<Record<string, unknown>> }));
vi.mock('@/components/domain/StripePaymentModal', () => ({
  StripePaymentModal: (props: Record<string, unknown>) => {
    modalProps.push(props);
    return props.open ? <div role="dialog" aria-label="pago" /> : null;
  },
}));

import { createCheckoutSession, createGuestCheckoutSession } from '@/lib/api';
import { CheckoutView } from './CheckoutView';
import { GuestCheckoutView } from './GuestCheckoutView';
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('desktop');

/**
 * Paquete A (dueño, `HECHOS.md` 2026-11-02 «Checkout con menos captura…» (5)): el modal de Stripe recibe el correo y
 * el nombre ya conocidos. Con cuenta: correo de la cuenta y nombre solo si no es derivado (`nameSource`, v1.67);
 * invitado: lo que capturó (correo y nombre de quien recibe).
 */
const session = (): CheckoutSessionResponse =>
  ({
    orderId: 'ord-1',
    orderNumber: 'TCG-000001',
    breakdown: { subtotalCents: 1000, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 1160, currency: 'MXN' },
    stripe: { paymentIntentId: 'pi_1', clientSecret: 'pi_1_secret' },
    reused: false,
    reservedUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
    supersededOrderIds: [],
  }) as unknown as CheckoutSessionResponse;

const lastOpenProps = () => [...modalProps].reverse().find((p) => p.open);

const user: UserDTO = { id: 'u-1', email: 'cliente@example.com', name: 'Ana López', role: 'customer', locale: 'es', emailVerified: true, nameSource: 'user' };

beforeEach(() => {
  modalProps.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(createCheckoutSession).mockReset();
  vi.mocked(createGuestCheckoutSession).mockReset();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
});

describe('billingDetails · checkout con cuenta', () => {
  it('correo y nombre de la cuenta', async () => {
    setStoredUser(user);
    vi.mocked(createCheckoutSession).mockResolvedValue(session());
    const usr = userEvent.setup();
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(lastOpenProps()).toBeDefined());
    expect(lastOpenProps()!.billingDetails).toEqual({ email: 'cliente@example.com', name: 'Ana López' });
  });

  it('⛔ nombre derivado del correo ⇒ solo el correo', async () => {
    setStoredUser({ ...user, name: 'cliente', nameSource: 'derived' });
    vi.mocked(createCheckoutSession).mockResolvedValue(session());
    const usr = userEvent.setup();
    renderWithProviders(<CheckoutView />, 'es');
    await usr.click(await screen.findByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(lastOpenProps()).toBeDefined());
    expect(lastOpenProps()!.billingDetails).toEqual({ email: 'cliente@example.com', name: undefined });
  });
});

describe('billingDetails · checkout de invitado', () => {
  it('lo capturado: correo y nombre de quien recibe (recortados)', async () => {
    setStoredUser(null);
    vi.mocked(createGuestCheckoutSession).mockResolvedValue({
      ...(session() as unknown as GuestCheckoutSessionResponse),
      checkoutToken: 'tok',
      checkoutTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await screen.findByLabelText('Correo electrónico');
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), '  Juan Pérez ');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
    await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(lastOpenProps()).toBeDefined());
    expect(lastOpenProps()!.billingDetails).toEqual({ email: 'juan@dominio.com', name: 'Juan Pérez' });
  });
});
