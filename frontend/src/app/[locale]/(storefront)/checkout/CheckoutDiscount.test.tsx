import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { resetMockDiscounts } from '@/lib/mock/discounts';
import type { UserDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

// eslint-disable-next-line import/first
import { CheckoutView } from './CheckoutView';
// eslint-disable-next-line import/first
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('desktop');

/**
 * §DSC en el checkout con cuenta (compra a bóveda) contra el simulador:
 *  - criterio 915: sin código, quote y sesión se llaman EXACTAMENTE como hoy y el desglose no gana filas;
 *  - DCO-F2: «Descuento (SEPT10) −MX$X» pinta `discount.discountCents` del servidor y el total es el del `breakdown`;
 *  - el código viaja en la sesión; un `422` del código en la sesión ⇒ C12, NO se abre el cobro, se re-cotiza sin él.
 */

const USER: UserDTO = { id: 'u-dsc', email: 'cliente@example.com', name: 'Cliente', role: 'customer', locale: 'es', emailVerified: true };

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetMockDiscounts();
  setStoredUser(USER);
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], accessories: [], deckPulls: [], updatedAt: Date.now() }));
});

const aside = () => screen.getByRole('complementary');

describe('checkout con cuenta · códigos de descuento', () => {
  it('915: sin código, la cotización y la sesión son las de hoy y el desglose no gana filas', async () => {
    const quote = vi.spyOn(api, 'getCheckoutQuote');
    const session = vi.spyOn(api, 'createCheckoutSession');
    renderWithProviders(<CheckoutView />, 'es');
    await within(await screen.findByRole('complementary')).findByTestId('amount-breakdown');
    expect(quote.mock.calls.every((c) => c.length === 1)).toBe(true);
    expect(within(aside()).queryByTestId('amount-breakdown-discount')).toBeNull();
    await userEvent.setup().click(within(aside()).getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(session).toHaveBeenCalledWith(['inv-1002']));
  });

  it('DCO-F2: aplicar SEPT10 pinta la fila con `discountCents` del servidor y el total del `breakdown`; la sesión lleva el código', async () => {
    const user = userEvent.setup();
    const session = vi.spyOn(api, 'createCheckoutSession');
    renderWithProviders(<CheckoutView />, 'es');
    await within(await screen.findByRole('complementary')).findByTestId('amount-breakdown');
    await user.click(screen.getByRole('button', { name: '¿Tienes un código?' }));
    await user.type(screen.getByLabelText('Código de descuento'), 'SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    const line = await within(aside()).findByTestId('amount-breakdown-discount');
    const served = await api.getCheckoutQuote(['inv-1002'], 'SEPT10');
    expect(served.discount?.outcome).toBe('applied');
    if (served.discount?.outcome !== 'applied') return;
    expect(line).toHaveTextContent(`Descuento (SEPT10)−MX$${(served.discount.discountCents / 100).toFixed(2)}`);
    expect(within(aside()).getByTestId('amount-breakdown')).toHaveTextContent(
      new RegExp(`Total a pagar\\s*MX\\$${(served.breakdown.totalCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`),
    );
    // La línea del carrito sigue en el precio exhibido (`unitPriceCents + unitDiscountCents`, I-3), igual que «Subtotal».
    expect(screen.getAllByText('MX$1,633.28').length).toBeGreaterThanOrEqual(2);
    await user.click(within(aside()).getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(session).toHaveBeenCalledWith(['inv-1002'], undefined, 'SEPT10'));
  });

  it('C12: la sesión responde 422 del código ⇒ no se abre el cobro, se quita con aviso y se re-cotiza sin él', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'createCheckoutSession').mockRejectedValueOnce(new ApiClientError(422, { code: 'DISCOUNT_CODE_INVALID', message: '' }));
    renderWithProviders(<CheckoutView />, 'es');
    await within(await screen.findByRole('complementary')).findByTestId('amount-breakdown');
    await user.click(screen.getByRole('button', { name: '¿Tienes un código?' }));
    await user.type(screen.getByLabelText('Código de descuento'), 'SEPT10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await within(aside()).findByTestId('amount-breakdown-discount');
    await user.click(within(aside()).getByRole('button', { name: /Pagar/ }));
    expect(await screen.findByText('SEPT10 ya no aplica a tu carrito y lo quitamos. Revisa el total antes de pagar.')).toBeInTheDocument();
    await waitFor(() => expect(within(aside()).queryByTestId('amount-breakdown-discount')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('C13a: un código de envío gratis en una compra a bóveda no aplica y lo dice', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CheckoutView />, 'es');
    await within(await screen.findByRole('complementary')).findByTestId('amount-breakdown');
    await user.click(screen.getByRole('button', { name: '¿Tienes un código?' }));
    await user.type(screen.getByLabelText('Código de descuento'), 'ENVIO25');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este código cubre el envío y tu pedido a bóveda no lleva envío.');
    expect(within(aside()).queryByTestId('amount-breakdown-discount')).toBeNull();
  });
});
