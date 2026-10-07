import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { accDetail } from '@/test/accessories.testkit';

/**
 * AC-F3 / AC-UX-3 / AC-UX-4 (`API_CONTRACT §AC.3`, `DESIGN_SYSTEM §AC-UX.3`): la ficha. El selector va de
 * 1 a `maxQty − lo que ya hay en el carrito` (⛔ nunca un tope fijo de 99); con sesión, sin selector ni botón.
 */
const { session } = vi.hoisted(() => ({
  session: { current: { user: null as null | { id: string }, isAuthenticated: false, ready: true } },
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/accesorios/acc-1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  useSession: () => session.current,
}));

import { AccessoryDetailView } from './AccessoryDetailView';

const DETAIL = accDetail({ id: 'acc-1', name: 'Penny sleeves x100', description: 'Cien fundas.\nTransparentes.', maxQty: 3 });

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  session.current = { user: null, isAuthenticated: false, ready: true };
});

describe('AC-F3 · ficha de accesorio', () => {
  it('pinta nombre, precio, «IVA incluido», descripción y la nota de envío', async () => {
    vi.spyOn(api, 'getAccessory').mockResolvedValue(DETAIL);
    renderWithProviders(<AccessoryDetailView id="acc-1" />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: 'Penny sleeves x100' })).toBeInTheDocument();
    expect(screen.getByText('IVA incluido')).toBeInTheDocument();
    expect(screen.getByText(/Cien fundas\./)).toBeInTheDocument();
    expect(screen.getByText('Se envía a tu domicilio. Los accesorios no se guardan en la bóveda.')).toBeInTheDocument();
  });

  it('AC-UX-3 · el «+» se apaga en maxQty − enCarrito y «Agregar al carrito» suma lo elegido', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'tcg.cart',
      JSON.stringify({ ids: [], accessories: [{ id: 'acc-1', qty: 1 }], deckPulls: [], updatedAt: Date.now() }),
    );
    vi.spyOn(api, 'getAccessory').mockResolvedValue(DETAIL);
    renderWithProviders(<AccessoryDetailView id="acc-1" />, 'es');
    const plus = await screen.findByRole('button', { name: 'Agregar una' });
    const input = screen.getByRole('spinbutton', { name: 'Cantidad' });
    expect(input).toHaveValue(1);
    await user.click(plus);
    expect(input).toHaveValue(2);
    // 3 disponibles − 1 en el carrito = 2: el «+» se apaga.
    expect(plus).toBeDisabled();
    expect(screen.getByText('Puedes agregar hasta 2.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Agregar al carrito' }));
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).accessories).toEqual([{ id: 'acc-1', qty: 3 }]);
  });

  it('teclear fuera de rango se corrige al salir del campo', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getAccessory').mockResolvedValue(DETAIL);
    renderWithProviders(<AccessoryDetailView id="acc-1" />, 'es');
    const input = await screen.findByRole('spinbutton', { name: 'Cantidad' });
    await user.clear(input);
    await user.type(input, '50');
    await user.tab();
    expect(input).toHaveValue(3);
  });

  it('con todo lo disponible ya en el carrito: botón apagado con su razón y «Ir al carrito»', async () => {
    window.localStorage.setItem(
      'tcg.cart',
      JSON.stringify({ ids: [], accessories: [{ id: 'acc-1', qty: 3 }], deckPulls: [], updatedAt: Date.now() }),
    );
    vi.spyOn(api, 'getAccessory').mockResolvedValue(DETAIL);
    renderWithProviders(<AccessoryDetailView id="acc-1" />, 'es');
    const btn = await screen.findByRole('button', { name: 'Agregar al carrito' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(/Ya tienes en tu carrito todas las que hay\./);
    expect(screen.getByRole('link', { name: 'Ir al carrito' })).toHaveAttribute('href', '/checkout');
  });

  it('agotado: «AGOTADO» + «Se agotó. Vuelve pronto.», sin selector ni botón ni «Avísame»', async () => {
    vi.spyOn(api, 'getAccessory').mockResolvedValue({ ...DETAIL, soldOut: true, maxQty: 0 });
    renderWithProviders(<AccessoryDetailView id="acc-1" />, 'es');
    expect(await screen.findByText('AGOTADO')).toBeInTheDocument();
    expect(screen.getByText('Se agotó. Vuelve pronto.')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Cantidad' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar al carrito' })).toBeNull();
    expect(screen.queryByText(/Avísame/)).toBeNull();
  });

  it('404 ACCESSORY_NOT_FOUND: «Este accesorio ya no está a la venta» (⛔ no «no existe»)', async () => {
    vi.spyOn(api, 'getAccessory').mockRejectedValue(
      new ApiClientError(404, { code: 'ACCESSORY_NOT_FOUND', message: 'not found' }),
    );
    renderWithProviders(<AccessoryDetailView id="acc-x" />, 'es');
    expect(await screen.findByRole('heading', { name: 'Este accesorio ya no está a la venta' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver accesorios' })).toHaveAttribute('href', '/accesorios');
  });

  it('energía: el eyebrow dice «ENERGÍAS · FUEGO»', async () => {
    vi.spyOn(api, 'getAccessory').mockResolvedValue({ ...DETAIL, category: 'energy', energyType: 'fire', name: 'Energía Fuego' });
    renderWithProviders(<AccessoryDetailView id="acc-1" />, 'es');
    expect(await screen.findByText('Energías · Fuego')).toBeInTheDocument();
  });
});

describe('AC-UX-4 · ficha con sesión abierta', () => {
  it('sin selector ni botón; el aviso en su lugar, sin «cerrar sesión»', async () => {
    session.current = { user: { id: 'u1' }, isAuthenticated: true, ready: true };
    vi.spyOn(api, 'getAccessory').mockResolvedValue(DETAIL);
    renderWithProviders(<AccessoryDetailView id="acc-1" />, 'es');
    const note = await screen.findByText('Los accesorios se compran con envío a domicilio. Pronto también desde tu cuenta.');
    expect(note.closest('[role="note"]')).not.toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Cantidad' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar al carrito' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/cerrar sesión|invitado/i);
  });
});
