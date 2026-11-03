import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { guestQuote } from '@/test/accessories.testkit';
import type { GuestCheckoutQuoteResponse } from '@/types/contract';

/**
 * N1 (ux-review de marketing 2026-11-03): el destino es un control de DOS opciones. Antes «Envío a mi domicilio» era
 * un `<div>` sin control: tras tocar la bóveda, PAGAR quedaba deshabilitado y tocar «Envío a mi domicilio» no hacía
 * nada; la única salida quedaba ~740 px más abajo. Aquí: las dos opciones son botones `aria-pressed`, «Envío a mi
 * domicilio» vuelve a envío desde cualquier estado, el aviso de bloqueo lleva a esa opción y en modo bóveda la
 * dirección de envío no se pinta (sin perder lo capturado).
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
import { setCheckoutViewport } from './test-viewport';

const CARD_ITEM = {
  inventoryItemId: 'inv-1002',
  card: { cardId: 'c-1', name: 'Charizard', setName: 'Base Set', number: '4', productType: 'raw', rawCondition: 'NM', imageSmallUrl: null },
  unitPriceCents: 100_000,
} as unknown as GuestCheckoutQuoteResponse['items'][number];

const BLOCKED = 'Para pagar, crea tu cuenta o elige envío a domicilio.';

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], accessories: [], deckPulls: [], updatedAt: Date.now() }));
  vi.spyOn(api, 'getAccessorySuggestions').mockResolvedValue({ items: [] });
  vi.spyOn(api, 'getGuestCheckoutQuote').mockResolvedValue(guestQuote({ items: [CARD_ITEM] }));
});

async function renderReadyToPay() {
  const user = userEvent.setup();
  renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
  const email = await screen.findByLabelText('Correo electrónico');
  await user.type(email, 'juan@dominio.com');
  await user.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
  const region = screen.getByRole('region', { name: 'DESTINO' });
  const ship = within(region).getByRole('button', { name: /Envío a mi domicilio/ });
  const vault = within(region).getByRole('button', { name: /Guardar en mi bóveda/ });
  return { user, ship, vault };
}

describe.each(['desktop', 'mobile'] as const)('N1 · selector de destino (%s)', (kind) => {
  setCheckoutViewport(kind);

  const payButton = () => screen.getByRole('button', { name: /^Pagar/ });

  it('las dos opciones son controles con estado: envío por defecto, bóveda seleccionable', async () => {
    const { ship, vault } = await renderReadyToPay();
    expect(ship).toHaveAttribute('aria-pressed', 'true');
    expect(vault).toHaveAttribute('aria-pressed', 'false');
    expect(vault).not.toBeDisabled();
    expect(payButton()).toBeEnabled();
  });

  it('bóveda → «Envío a mi domicilio» → PAGAR habilitado (el flujo del informe)', async () => {
    const { user, ship, vault } = await renderReadyToPay();
    await user.click(vault);
    expect(vault).toHaveAttribute('aria-pressed', 'true');
    expect(ship).toHaveAttribute('aria-pressed', 'false');
    expect(payButton()).toBeDisabled();
    // Menor: apagado no solo por color — regla discontinua (además de `cursor-not-allowed` del botón base).
    expect(payButton()).toHaveClass('border-dashed');
    expect(screen.getByTestId('vault-upsell')).toBeInTheDocument();

    await user.click(ship);
    await waitFor(() => expect(screen.queryByTestId('vault-upsell')).toBeNull());
    expect(ship).toHaveAttribute('aria-pressed', 'true');
    expect(vault).toHaveAttribute('aria-pressed', 'false');
    expect(payButton()).toBeEnabled();
    expect(payButton()).not.toHaveClass('border-dashed');
    expect(screen.queryByText(BLOCKED)).toBeNull();
  });

  it('el aviso de bloqueo lleva a envío a domicilio con un toque y deja el foco en esa opción', async () => {
    const { user, ship, vault } = await renderReadyToPay();
    await user.click(vault);
    expect(screen.getByText(BLOCKED)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elegir envío a domicilio' }));
    await waitFor(() => expect(payButton()).toBeEnabled());
    expect(ship).toHaveAttribute('aria-pressed', 'true');
    expect(ship).toHaveFocus();
  });

  it('en modo bóveda la dirección de envío no se pinta; al volver, lo capturado sigue ahí', async () => {
    const { user, ship, vault } = await renderReadyToPay();
    await user.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
    await user.click(vault);
    expect(screen.queryByRole('region', { name: 'ENVÍO A MÉXICO' })).toBeNull();
    expect(screen.getByLabelText('Nombre de quien recibe')).not.toBeVisible();
    await user.click(ship);
    expect(screen.getByRole('region', { name: 'ENVÍO A MÉXICO' })).toBeVisible();
    expect(screen.getByLabelText('Nombre de quien recibe')).toHaveValue('Juan Pérez');
  });
});
