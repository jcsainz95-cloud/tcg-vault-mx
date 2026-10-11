import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';

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
import { GuestCheckoutView } from './GuestCheckoutView';
import { clearUnavailableNotice } from './unavailable-notice';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearUnavailableNotice();
  vi.mocked(createGuestCheckoutSession).mockReset();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
});

/**
 * FRONTEND_NOTES §91 — el foco va al resumen de errores SOLO en el intento de pago (DESIGN_SYSTEM §15.3
 * «Resumen de errores al intentar pagar … el foco va al bloque»), nunca cuando cambia el número de errores.
 * Defecto en producción: el efecto dependía de `listed.length`; al teclear la primera letra en un campo con
 * error, ese error desaparecía, el número cambiaba y el foco saltaba al resumen — solo entraba esa letra.
 */
describe('checkout de invitado · foco del resumen de errores (§91)', () => {
  async function failedPayAttempt(usr: ReturnType<typeof userEvent.setup>) {
    await usr.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('alert'));
  }

  it('tras un pago fallido, teclear en un campo con error conserva todas las letras y el foco no sale', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await failedPayAttempt(usr);

    const name = screen.getByLabelText('Nombre de quien recibe') as HTMLInputElement;
    await usr.type(name, 'Juan Pérez');
    expect(name.value).toBe('Juan Pérez');
    expect(document.activeElement).toBe(name);

    const street = screen.getByLabelText('Calle y número') as HTMLInputElement;
    await usr.type(street, 'Av. Vallarta 1234');
    expect(street.value).toBe('Av. Vallarta 1234');
    expect(document.activeElement).toBe(street);
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
  });

  it('cada clic en pagar con errores vuelve a llevar el foco al resumen', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await failedPayAttempt(usr);
    const name = screen.getByLabelText('Nombre de quien recibe');
    await usr.type(name, 'Juan');
    expect(document.activeElement).toBe(name);

    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('alert'));
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
  });
});
