import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
    registerEmailOnly: vi.fn(actual.registerEmailOnly),
    claimGuestOrders: vi.fn(actual.claimGuestOrders),
  };
});

import { claimGuestOrders, createGuestCheckoutSession, registerEmailOnly } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { GuestOrderConfirmation } from './GuestOrderConfirmation';
import { GuestCheckoutView } from './GuestCheckoutView';
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('desktop');

/**
 * CTA-F6 (API_CONTRACT §CTA.9, criterios 54/969/974): «Crear cuenta con este correo» de la confirmación del invitado usa
 * el alta con SOLO el correo (ya escrito). Antes (Paquete A, `HECHOS.md` 2026-11-02) prellenaba también el nombre con
 * contraseña; §CTA lo sustituye: el nombre se pone después, con el enlace del correo o desde «Mi cuenta».
 * El reclamo de una cuenta recién nacida responde `403 EMAIL_NOT_VERIFIED` (974) ⇒ NO es un error: «Abre el enlace de
 * tu correo para ver este pedido». Mutación: pintar error.
 */
describe('CTA-F6 · confirmación del invitado: cuenta con solo el correo', () => {
  it('el formulario trae solo el correo capturado: sin nombre ni contraseña', () => {
    renderWithProviders(<GuestOrderConfirmation orderNumber="TCG-1" orderId="o-1" email="juan@dominio.com" />, 'es');
    const claim = screen.getByRole('region');
    expect(within(claim).getByLabelText('Correo')).toHaveValue('juan@dominio.com');
    expect(within(claim).queryByLabelText('Nombre')).toBeNull();
    expect(claim.querySelector('input[type="password"]')).toBeNull();
  });

  it('crear cuenta ⇒ registerEmailOnly con el correo; reclamo 403 EMAIL_NOT_VERIFIED ⇒ aviso, no error', async () => {
    window.localStorage.clear();
    vi.mocked(claimGuestOrders).mockRejectedValueOnce(
      new ApiClientError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'verify' }),
    );
    const usr = userEvent.setup();
    renderWithProviders(<GuestOrderConfirmation orderNumber="TCG-1" orderId="o-1" email="juan@dominio.com" />, 'es');
    await usr.click(screen.getByRole('button', { name: 'Crear cuenta con este correo' }));
    const notice = await screen.findByText('Cuenta creada. Abre el enlace de tu correo para ver este pedido.');
    expect(notice).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(vi.mocked(registerEmailOnly)).toHaveBeenCalledWith(expect.objectContaining({ email: 'juan@dominio.com' }));
    expect(Object.keys(vi.mocked(registerEmailOnly).mock.calls[0][0]).sort()).toEqual(['email', 'locale']);
    expect(vi.mocked(claimGuestOrders)).toHaveBeenCalledWith(['o-1']);
  });

  it('de punta a punta: el correo del checkout llega al alta de la confirmación', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
    vi.mocked(createGuestCheckoutSession).mockResolvedValue({
      orderId: 'ord-g-1',
      orderNumber: 'TCG-000123',
      breakdown: { subtotalCents: 1000, shippingFeeCents: 17500, ivaCents: 160, ivaRatePct: 16, processingFeeCents: 0, totalCents: 18660, currency: 'MXN' },
      checkoutToken: 'tok',
      checkoutTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      stripe: { paymentIntentId: 'pi_g1', clientSecret: 'pi_g1_secret' },
      reused: false,
      reservedUntil: new Date(Date.now() + 1_800_000).toISOString(),
      supersededOrderIds: [],
    } as unknown as GuestCheckoutSessionResponse);
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await screen.findByLabelText('Correo electrónico');
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez ');
    await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
    await usr.type(screen.getByLabelText('Teléfono'), '5512345678');
    await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    const dialog = await screen.findByRole('dialog');
    await usr.click(within(dialog).getByRole('button', { name: /\(simulado\)/ }));
    await screen.findByTestId('guest-order-number', {}, { timeout: 4000 });
    expect(screen.getByLabelText('Correo')).toHaveValue('juan@dominio.com');
    expect(screen.queryByLabelText('Nombre')).toBeNull();
  });
});
