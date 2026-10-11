import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { accCard } from '@/test/accessories.testkit';

/**
 * AC-F2 / AC-UX-2 / AC-UX-4 (`API_CONTRACT §AC.3`, `DESIGN_SYSTEM §AC-UX.2`, `§AC-UX.4`): listado de
 * accesorios. «Agotado» sin botón; «Agregar» suma 1; con sesión, ni un «Agregar» y el aviso una vez.
 */
const { urlParams, session, router } = vi.hoisted(() => ({
  urlParams: { current: new URLSearchParams() },
  session: { current: { user: null as null | { id: string }, isAuthenticated: false, ready: true } },
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlParams.current }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/accesorios',
  useRouter: () => router,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  useSession: () => session.current,
}));

import { AccessoriesShopView } from './AccessoriesShopView';

const SLEEVES = accCard({ id: 'acc-1', name: 'Penny sleeves x100', priceCents: 8900 });
const FIRE = accCard({ id: 'acc-fire', name: 'Energía Fuego', category: 'energy', energyType: 'fire', priceCents: 500 });
const MAT = accCard({ id: 'acc-mat', name: 'Playmat Dragapult', category: 'playmats', soldOut: true, priceCents: 45000 });

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  urlParams.current = new URLSearchParams();
  session.current = { user: null, isAuthenticated: false, ready: true };
  router.replace.mockReset();
});

function mockList(items = [SLEEVES, FIRE, MAT]) {
  return vi.spyOn(api, 'getAccessories').mockResolvedValue({ items, page: 1, pageSize: 24, total: items.length });
}

describe('AC-F2 · listado de accesorios', () => {
  it('cabecera, filtro por categoría en el orden del enum y la búsqueda con su etiqueta', async () => {
    mockList();
    renderWithProviders(<AccessoriesShopView />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: 'Accesorios' })).toBeInTheDocument();
    const cats = screen.getByRole('navigation', { name: 'Categorías de accesorios' });
    expect(within(cats).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Todo',
      'Fundas / penny sleeves',
      'Toploaders',
      'Carpetas',
      'Cajas de mazo',
      'Playmats',
      'Energías',
      'Otros',
    ]);
    expect(within(cats).getByRole('link', { name: 'Todo' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('Buscar accesorios')).toHaveAttribute('maxLength', '60');
  });

  it('pinta el orden del servidor (no reordena) y el precio que dice el servidor', async () => {
    mockList();
    renderWithProviders(<AccessoriesShopView />, 'es');
    const tiles = await screen.findAllByTestId(/^accessory-tile-/);
    expect(tiles.map((t) => t.dataset.testid)).toEqual([
      'accessory-tile-acc-1',
      'accessory-tile-acc-fire',
      'accessory-tile-acc-mat',
    ]);
    expect(within(tiles[0]).getByText(/89\.00/)).toBeInTheDocument();
    // Energías: el eyebrow dice la categoría.
    expect(within(tiles[1]).getByText('Energías')).toBeInTheDocument();
  });

  it('AC-UX-2 · agotado: «AGOTADO» y NINGÚN botón «Agregar» (ni apagado); la ficha sigue enlazada', async () => {
    mockList();
    renderWithProviders(<AccessoriesShopView />, 'es');
    const tile = await screen.findByTestId('accessory-tile-acc-mat');
    expect(within(tile).getByText('AGOTADO')).toBeInTheDocument();
    expect(within(tile).queryByRole('button')).toBeNull();
    expect(within(tile).getAllByRole('link')[0]).toHaveAttribute('href', '/accesorios/acc-mat');
  });

  it('«Agregar» suma exactamente 1 unidad al carrito y no está dentro del enlace', async () => {
    const user = userEvent.setup();
    mockList();
    renderWithProviders(<AccessoriesShopView />, 'es');
    const btn = await screen.findByRole('button', { name: 'Agregar Penny sleeves x100 al carrito' });
    expect(btn.closest('a')).toBeNull();
    await user.click(btn);
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).accessories).toEqual([{ id: 'acc-1', qty: 1 }]);
  });

  it('la categoría de la URL viaja al servidor; una categoría inválida se trata como «Todo»', async () => {
    const spy = mockList([SLEEVES]);
    urlParams.current = new URLSearchParams('category=playmats&q=dragapult');
    const { unmount } = renderWithProviders(<AccessoriesShopView />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ category: 'playmats', q: 'dragapult' })));
    unmount();
    spy.mockClear();
    urlParams.current = new URLSearchParams('category=pokebolas');
    renderWithProviders(<AccessoriesShopView />, 'es');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0].category).toBeUndefined();
  });

  it('vacíos: sin filtro, con categoría y con búsqueda', async () => {
    vi.spyOn(api, 'getAccessories').mockResolvedValue({ items: [], page: 1, pageSize: 24, total: 0 });
    const { unmount } = renderWithProviders(<AccessoriesShopView />, 'es');
    expect(await screen.findByText('Pronto tendremos accesorios aquí')).toBeInTheDocument();
    unmount();
    urlParams.current = new URLSearchParams('category=binders');
    const r2 = renderWithProviders(<AccessoriesShopView />, 'es');
    expect(await screen.findByText('No hay Carpetas por ahora.')).toBeInTheDocument();
    r2.unmount();
    urlParams.current = new URLSearchParams('q=zzz');
    renderWithProviders(<AccessoriesShopView />, 'es');
    expect(await screen.findByText('No encontramos accesorios con «zzz».')).toBeInTheDocument();
  });

  it('error de red: aviso con «Reintentar»', async () => {
    vi.spyOn(api, 'getAccessories').mockRejectedValue(new Error('boom'));
    renderWithProviders(<AccessoriesShopView />, 'es');
    expect(await screen.findByText('No pudimos cargar los accesorios.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('AC-UX-4 (AC-F7) · con sesión abierta', () => {
  it('ninguna teja tiene «Agregar»; el aviso aparece UNA vez y no habla de cerrar sesión', async () => {
    session.current = { user: { id: 'u1' }, isAuthenticated: true, ready: true };
    mockList();
    renderWithProviders(<AccessoriesShopView />, 'es');
    await screen.findByTestId('accessory-tile-acc-1');
    expect(screen.queryAllByRole('button', { name: /^Agregar/ })).toHaveLength(0);
    const notes = screen.getAllByText('Los accesorios se compran con envío a domicilio. Pronto también desde tu cuenta.');
    expect(notes).toHaveLength(1);
    expect(notes[0].closest('[role="note"]')?.textContent ?? '').not.toMatch(/cerrar sesión|sign out|invitado/i);
  });
});
