import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';
import es from '../../../../../../messages/es.json';
import { WishlistView } from './WishlistView';
import type { CardDTO, UserDTO, WishlistItemDTO, WishlistResponse } from '@/types/contract';

/**
 * §WSH-UX.3/.4 · «Mi lista de deseos» (`/account/wishlist`). WSH-F2 y WSH-F6 (versión unitaria), WSH-UX-6, y la
 * regla v1.87.1 de que «cabe» sale de `availableNow.fits` (⛔ el front no compara pesos).
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/account/wishlist',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const W = es.wishlist;
const mx = (cents: number) => `MX$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const customer: UserDTO = {
  id: 'u-1',
  email: 'ana@correo.mx',
  name: 'Ana',
  role: 'customer',
  locale: 'es',
  authProvider: 'local',
  emailVerified: true,
};

function item(id: string, over: Partial<WishlistItemDTO> = {}): WishlistItemDTO {
  return {
    id,
    card: { id: `c-${id}`, name: `Carta ${id}`, setName: 'Obsidian Flames', number: '125', imageSmallUrl: null },
    finish: 'reverse_holo',
    maxPct: 10,
    maxToday: { status: 'priced', maxDisplayCents: 110000, approximate: true },
    availableNow: null,
    lastNotifiedAt: null,
    createdAt: '2026-10-07T10:00:00Z',
    ...over,
  };
}

function list(items: WishlistItemDTO[], over: Partial<WishlistResponse> = {}): WishlistResponse {
  return {
    items,
    count: items.length,
    limit: 20,
    alertsPaused: false,
    emailVerified: true,
    ivaMode: 'with_iva',
    ivaRatePct: 16,
    ...over,
  };
}

function row(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('[data-testid="wishlist-row"]') as HTMLElement;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setStoredUser(customer);
});

describe('§WSH-UX.4 · el renglón de un deseo (WSH-F2)', () => {
  it('columnas: carta, acabado, Near Mint, %, máximo de hoy con IVA y «aproximado»', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a')], { ivaRatePct: 8 }));
    renderWithProviders(<WishlistView />, 'es');
    const r = await waitFor(() => row('Carta a'));
    expect(within(r).getByText(new RegExp(es.finish.reverse_holo))).toBeInTheDocument();
    expect(r.textContent).toContain('Near Mint');
    expect(within(r).getByText('Tu máximo: hasta 10 % sobre mercado sin IVA' /* §MIV.6: solo cambia el texto; el 10 % no */)).toBeInTheDocument();
    expect(within(r).getByText(`Hoy: hasta ${mx(110000)}`)).toBeInTheDocument();
    expect(within(r).getByText('IVA 8 % incluido')).toBeInTheDocument();
    expect(within(r).getByText(W.approx)).toBeInTheDocument();
    expect(within(r).getByText(W.row.notYet)).toBeInTheDocument();
    expect(within(r).getByText(W.row.neverNotified)).toBeInTheDocument();
  });

  it('«aproximado» despliega su ayuda con `aria-expanded` (sin tooltip solo-hover)', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a')]));
    renderWithProviders(<WishlistView />, 'es');
    const r = await waitFor(() => row('Carta a'));
    const help = within(r).getByRole('button', { name: W.approxHelpLabel });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(within(r).getByText(W.approxHelp)).toBeInTheDocument();
  });

  it('WSH-F2 / 807 · `no_market` ⇒ «Sin precio de mercado por ahora», sin MX$ ni veredicto', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(
      list([
        item('a', {
          maxToday: { status: 'no_market' },
          availableNow: { count: 1, fromDisplayCents: 99000, fits: null },
        }),
      ]),
    );
    renderWithProviders(<WishlistView />, 'es');
    const r = await waitFor(() => row('Carta a'));
    const line = within(r).getByText(W.noMarket);
    expect(line.textContent).not.toContain('MX$');
    expect(r.textContent).not.toContain('MX$0.00');
    expect(within(r).queryByText(W.row.fits)).toBeNull();
    expect(within(r).queryByText(W.row.above)).toBeNull();
  });

  it('v1.87.1 (Q-WSH-UX-3) · «cabe» lo dice `fits` del servidor, aunque los pesos digan otra cosa', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(
      list([
        // fits:true con el «desde» ARRIBA del máximo: si el front comparara, pintaría «arriba».
        item('si', { availableNow: { count: 2, fromDisplayCents: 133400, fits: true } }),
        // fits:false con el «desde» DEBAJO del máximo: si el front comparara, pintaría «cabe».
        item('no', { availableNow: { count: 1, fromDisplayCents: 50000, fits: false } }),
        item('nulo', { availableNow: { count: 1, fromDisplayCents: 50000, fits: null } }),
      ]),
    );
    renderWithProviders(<WishlistView />, 'es');
    const si = await waitFor(() => row('Carta si'));
    expect(within(si).getByText(W.row.fits)).toBeInTheDocument();
    expect(within(si).queryByText(W.row.above)).toBeNull();
    expect(within(si).getByText(`Disponible ahora: 2 · desde ${mx(133400)}`)).toBeInTheDocument();
    expect(within(si).getByRole('link', { name: new RegExp(W.row.seeCard) })).toHaveAttribute('href', '/catalog/c-si');

    const no = row('Carta no');
    expect(within(no).getByText(W.row.above)).toBeInTheDocument();
    expect(within(no).queryByText(W.row.fits)).toBeNull();

    const nulo = row('Carta nulo');
    expect(within(nulo).queryByText(W.row.fits)).toBeNull();
    expect(within(nulo).queryByText(W.row.above)).toBeNull();
  });

  it('WSH-UX-6 · cambiar el `select` de % NO llama a PATCH; «Guardar» sí, una vez', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a')]));
    const patch = vi
      .spyOn(api, 'updateWishlistItem')
      .mockResolvedValue(item('a', { maxPct: 16, maxToday: { status: 'priced', maxDisplayCents: 116000, approximate: true } }));
    renderWithProviders(<WishlistView />, 'es');
    const r = await waitFor(() => row('Carta a'));
    const select = within(r).getByLabelText(W.row.pctLabel) as HTMLSelectElement;
    expect(within(r).queryByRole('button', { name: W.row.save })).toBeNull();
    fireEvent.change(select, { target: { value: '5' } });
    fireEvent.change(select, { target: { value: '16' } });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(within(r).getByRole('button', { name: W.row.save }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('a', 16);
    expect(await within(r).findByText(`Hoy: hasta ${mx(116000)}`)).toBeInTheDocument();
    expect(within(r).getByText(W.saved)).toBeInTheDocument();
  });

  it('PATCH `404` ⇒ el renglón se retira con «Esa carta ya no estaba en tu lista.»', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a')]));
    vi.spyOn(api, 'updateWishlistItem').mockRejectedValue(new ApiClientError(404, { code: 'NOT_FOUND', message: 'x' }));
    renderWithProviders(<WishlistView />, 'es');
    const r = await waitFor(() => row('Carta a'));
    fireEvent.change(within(r).getByLabelText(W.row.pctLabel), { target: { value: '5' } });
    fireEvent.click(within(r).getByRole('button', { name: W.row.save }));
    expect(await screen.findByText(W.row.gone)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Carta a' })).toBeNull());
  });

  it('Quitar ⇒ DELETE sin diálogo, toast con «Deshacer» que re-crea con los mismos {cardId, finish, maxPct}', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a', { maxPct: 16 })]));
    const del = vi.spyOn(api, 'removeWishlistItem').mockResolvedValue(undefined);
    const add = vi.spyOn(api, 'addWishlistItem').mockResolvedValue(item('a2'));
    renderWithProviders(<WishlistView />, 'es');
    const r = await waitFor(() => row('Carta a'));
    fireEvent.click(within(r).getByRole('button', { name: `Quitar Carta a (${es.finish.reverse_holo}) de mi lista` }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('a'));
    expect(await screen.findByText('Quitamos Carta a de tu lista.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: W.row.undo }));
    });
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ cardId: 'c-a', finish: 'reverse_holo', maxPct: 16 }),
    );
  });
});

describe('§WSH-UX.3 · la página', () => {
  it('cabecera con {count} de {limit} del DTO y la nota de señal una vez', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a'), item('b')], { limit: 25 }));
    renderWithProviders(<WishlistView />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: W.page.title })).toBeInTheDocument();
    expect(screen.getByText(/2 de 25 cartas/)).toBeInTheDocument();
    expect(screen.getAllByText(W.page.signalNote)).toHaveLength(1);
  });

  it('vacío ⇒ EmptyState, con el buscador visible', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([]));
    renderWithProviders(<WishlistView />, 'es');
    expect(await screen.findByText(W.page.emptyTitle)).toBeInTheDocument();
    expect(screen.getByLabelText(W.page.searchLabel)).toBeInTheDocument();
  });

  it('`404 FEATURE_DISABLED` ⇒ «La lista de deseos aún no está disponible.» y nada más', async () => {
    vi.spyOn(api, 'getWishlist').mockRejectedValue(new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'off' }));
    renderWithProviders(<WishlistView />, 'es');
    expect(await screen.findByText(W.page.disabled)).toBeInTheDocument();
    expect(screen.queryByLabelText(W.page.searchLabel)).toBeNull();
  });

  it('pausados ⇒ banner con la segunda línea, y «Reanudar avisos» hace `PUT {paused:false}`', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a')], { alertsPaused: true }));
    const put = vi.spyOn(api, 'setWishlistAlertsPaused').mockResolvedValue({ alertsPaused: false });
    renderWithProviders(<WishlistView />, 'es');
    expect(await screen.findByText(W.page.pausedBanner)).toBeInTheDocument();
    expect(screen.getByText(W.page.pausedLost)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: W.page.resume })[0]);
    await waitFor(() => expect(put).toHaveBeenCalledWith(false));
    expect(await screen.findByText(W.page.resumed)).toBeInTheDocument();
  });

  it('lista llena ⇒ el buscador se sustituye por la línea de «llena»', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([item('a'), item('b')], { limit: 2 }));
    renderWithProviders(<WishlistView />, 'es');
    expect(await screen.findByText('Tu lista está llena (2 de 2). Quita una carta para agregar otra.')).toBeInTheDocument();
    expect(screen.queryByLabelText(W.page.searchLabel)).toBeNull();
  });
});

describe('WSH-F6 · buscador sobre `GET /buylist/cards` (Q-WSH-UX-4)', () => {
  const found: CardDTO = {
    id: 'c-cel25-7',
    externalId: 'cel25-7',
    name: 'Celebrations #7',
    number: '7',
    rarity: 'Holo Rare',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    setId: 'cel25',
    setName: 'Celebrations',
    setPtcgoCode: 'CEL',
    imageSmallUrl: 'https://images.pokemontcg.io/cel25/7.png',
    imageLargeUrl: 'https://images.pokemontcg.io/cel25/7.png',
    availableFinishes: ['holofoil'],
  };

  it('2+ caracteres ⇒ lista de ENLACES a la ficha; sin precios; con conteo anunciado', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([]));
    const search = vi
      .spyOn(api, 'searchBuylistCards')
      .mockResolvedValue({ data: [found], page: 1, pageSize: 8, total: 1 });
    renderWithProviders(<WishlistView />, 'es');
    const input = await screen.findByLabelText(W.page.searchLabel);
    fireEvent.change(input, { target: { value: 'c' } });
    await new Promise((r) => setTimeout(r, 350));
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Celeb' } });
    const link = await screen.findByRole('link', { name: /Celebrations #7/ }, { timeout: 2000 });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: 'Celeb' }));
    expect(link).toHaveAttribute('href', '/catalog/c-cel25-7');
    const results = screen.getByTestId('wishlist-search-results');
    expect(results.textContent).not.toContain('MX$');
    expect(screen.getByText('1 resultado')).toBeInTheDocument();
  });

  it('sin resultados ⇒ el texto de ayuda', async () => {
    vi.spyOn(api, 'getWishlist').mockResolvedValue(list([]));
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [], page: 1, pageSize: 8, total: 0 });
    renderWithProviders(<WishlistView />, 'es');
    fireEvent.change(await screen.findByLabelText(W.page.searchLabel), { target: { value: 'zzzz' } });
    expect(await screen.findByText(W.page.searchEmpty, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});
