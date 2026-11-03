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
  return { ...actual, createGuestCheckoutSession: vi.fn() };
});

import { createGuestCheckoutSession } from '@/lib/api';
import { GuestOrderConfirmation } from './GuestOrderConfirmation';
import { GuestCheckoutView } from './GuestCheckoutView';
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('desktop');

/**
 * Paquete A (dueño, `HECHOS.md` 2026-11-02 «Checkout con menos captura…»): la cuenta que se crea tras pagar como
 * invitado (reclamo, §4-G.9) prellena también el NOMBRE (el de quien recibe, ya capturado), no solo el correo.
 * Editable: es un valor inicial.
 */
describe('GuestOrderConfirmation · alta de cuenta prellenada', () => {
  it('correo y nombre capturados en el formulario de registro', () => {
    renderWithProviders(
      <GuestOrderConfirmation orderNumber="TCG-1" orderId="o-1" email="juan@dominio.com" name="Juan Pérez" />,
      'es',
    );
    const claim = screen.getByRole('region');
    expect(within(claim).getByLabelText('Nombre')).toHaveValue('Juan Pérez');
    expect(within(claim).getByLabelText('Correo')).toHaveValue('juan@dominio.com');
  });

  it('de punta a punta: el nombre de quien recibe del checkout llega al registro de la confirmación', async () => {
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
    expect(screen.getByLabelText('Nombre')).toHaveValue('Juan Pérez');
  });
});
