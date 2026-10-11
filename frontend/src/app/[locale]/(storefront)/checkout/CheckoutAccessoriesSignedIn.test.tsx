import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import * as api from '@/lib/api';
import { accDetail } from '@/test/accessories.testkit';
import type { UserDTO } from '@/types/contract';

/**
 * AC-F7 / AC-UX-4 (`API_CONTRACT §AC.5`, `DESIGN_SYSTEM §AC-UX.4`): con sesión abierta el checkout con
 * cuenta ⛔ NUNCA manda accesorios (el servidor los rechazaría con `422 ACCESSORIES_REQUIRE_DIRECT_SHIP`).
 * Los accesorios del carrito local se pintan aparte, «NO VAN EN ESTE PAGO», sin sumar y con «Quitar».
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

import { CheckoutView } from './CheckoutView';

const USER: UserDTO = {
  id: 'u-1',
  email: 'cliente@example.com',
  name: 'Cliente',
  role: 'customer',
  locale: 'es',
  emailVerified: true,
};

function seed(ids: string[], accessories: { id: string; qty: number }[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids, accessories, deckPulls: [], updatedAt: Date.now() }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setStoredUser(USER);
  vi.spyOn(api, 'getAccessory').mockResolvedValue(accDetail({ id: 'acc-1', name: 'Penny sleeves x100' }));
});

describe('AC-F7 · checkout con cuenta y accesorios en el carrito local', () => {
  it('cotiza y paga SOLO las piezas; los accesorios van aparte y no se mandan', async () => {
    const usr = userEvent.setup();
    seed(['inv-1002'], [{ id: 'acc-1', qty: 2 }]);
    const quote = vi.spyOn(api, 'getCheckoutQuote');
    const session = vi.spyOn(api, 'createCheckoutSession');
    renderWithProviders(<CheckoutView />, 'es');

    const block = await screen.findByTestId('accessories-not-in-payment');
    expect(within(block).getByText('NO VAN EN ESTE PAGO')).toBeInTheDocument();
    expect(within(block).getByText('Los accesorios se compran con envío a domicilio. Pronto también desde tu cuenta.')).toBeInTheDocument();
    expect(await within(block).findByText('Penny sleeves x100')).toBeInTheDocument();
    expect(within(block).getByText('×2')).toBeInTheDocument();
    expect(block.textContent).not.toMatch(/cerrar sesión|invitado/i);

    await waitFor(() => expect(quote).toHaveBeenCalled());
    expect(quote.mock.calls.every((c) => c.length === 1 && Array.isArray(c[0]))).toBe(true);

    await usr.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(session).toHaveBeenCalled());
    const args = session.mock.calls[0];
    expect(args[0]).toEqual(['inv-1002']);
    expect(JSON.stringify(args)).not.toMatch(/accessor|deckPull/i);
  });

  it('«Quitar» en el bloque saca el accesorio del carrito local', async () => {
    const usr = userEvent.setup();
    seed(['inv-1002'], [{ id: 'acc-1', qty: 2 }]);
    renderWithProviders(<CheckoutView />, 'es');
    const block = await screen.findByTestId('accessories-not-in-payment');
    await usr.click(await within(block).findByRole('button', { name: 'Quitar Penny sleeves x100' }));
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).accessories).toEqual([]);
  });

  it('carrito SOLO de accesorios: no hay botón de pago ni cotización; queda el bloque con el aviso', async () => {
    seed([], [{ id: 'acc-1', qty: 1 }]);
    const quote = vi.spyOn(api, 'getCheckoutQuote');
    renderWithProviders(<CheckoutView />, 'es');
    expect(await screen.findByTestId('accessories-not-in-payment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pagar/ })).toBeNull();
    expect(quote).not.toHaveBeenCalled();
  });
});
