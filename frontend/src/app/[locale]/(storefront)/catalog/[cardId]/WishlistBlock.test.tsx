import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';
import es from '../../../../../../messages/es.json';
import { CardDetailView } from './CardDetailView';
import type {
  CardDTO,
  GroupedListingDTO,
  UserDTO,
  WishlistItemDTO,
  WishlistPreviewResponse,
  WishlistResponse,
} from '@/types/contract';

/**
 * §WSH-UX.2 · bloque «Lista de deseos» de la ficha (API_CONTRACT §WSH.4 + errata v1.87.1).
 * Cubre WSH-F1 y WSH-F7 (versión unitaria; los E2E viven en `e2e/wishlist.spec.ts`) y los candados WSH-UX-1…5, más
 * Q-WSH-UX-6 (ninguna superficie para el staff).
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/catalog/c-test',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string; query?: Record<string, string> };
    children: React.ReactNode;
  }) => {
    const h =
      typeof href === 'string' ? href : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query)}` : ''}`;
    return (
      <a href={h} {...props}>
        {children}
      </a>
    );
  },
}));

const card: CardDTO = {
  id: 'c-test',
  externalId: 'x-1',
  name: 'Charizard ex',
  number: '125',
  rarity: 'Double Rare',
  supertype: 'Pokémon',
  subtypes: ['Stage 2'],
  setId: 'sv3',
  setName: 'Obsidian Flames',
  setPtcgoCode: 'OBF',
  imageSmallUrl: 'https://images.pokemontcg.io/sv3/125.png',
  imageLargeUrl: 'https://images.pokemontcg.io/sv3/125.png',
  availableFinishes: ['normal', 'reverse_holo'],
  // Canario de WSH-UX-1: «acabados con precio» ≠ los acabados de la carta. Pintar este campo es el defecto.
  displayFinishes: ['normal'],
};

const customer: UserDTO = {
  id: 'u-1',
  email: 'ana@correo.mx',
  name: 'Ana',
  role: 'customer',
  locale: 'es',
  authProvider: 'local',
  emailVerified: true,
};

const W = es.wishlist;
const mx = (cents: number) => `MX$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

function listResponse(items: WishlistItemDTO[] = [], over: Partial<WishlistResponse> = {}): WishlistResponse {
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

function preview(over: Partial<WishlistPreviewResponse> = {}): WishlistPreviewResponse {
  return {
    cardId: 'c-test',
    ivaMode: 'with_iva',
    ivaRatePct: 16,
    finishes: [
      {
        finish: 'normal',
        maxToday: {
          status: 'priced',
          approximate: true,
          tiers: [
            { maxPct: 5, maxDisplayCents: 105000 },
            { maxPct: 10, maxDisplayCents: 110000 },
            { maxPct: 16, maxDisplayCents: 116000 },
          ],
        },
      },
      { finish: 'reverse_holo', maxToday: { status: 'no_market' } },
    ],
    ...over,
  };
}

function item(over: Partial<WishlistItemDTO> = {}): WishlistItemDTO {
  return {
    id: 'w-1',
    card: { id: 'c-test', name: 'Charizard ex', setName: 'Obsidian Flames', number: '125', imageSmallUrl: null },
    finish: 'normal',
    maxPct: 10,
    maxToday: { status: 'priced', maxDisplayCents: 110000, approximate: true },
    availableNow: null,
    lastNotifiedAt: null,
    createdAt: '2026-10-07T10:00:00Z',
    ...over,
  };
}

function mockDetail(opts: { wishlistEnabled?: boolean; listings?: GroupedListingDTO[] } = {}) {
  vi.spyOn(api, 'getCardDetail').mockResolvedValue({
    card,
    listings: opts.listings ?? [],
    units: [],
    ...(opts.wishlistEnabled === undefined ? {} : { wishlistEnabled: opts.wishlistEnabled }),
  });
}

/** Toda cadena SIN placeholders de `wishlist.*` (para afirmar ausencia total, WSH-5). */
function plainWishlistStrings(): string[] {
  const out: string[] = [];
  const walk = (o: unknown) => {
    if (typeof o === 'string') {
      if (!o.includes('{')) out.push(o);
    } else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(W);
  return out;
}

async function block() {
  return screen.findByTestId('wishlist-block');
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('§WSH-UX.2 · la ficha monta el bloque solo con el dial encendido (WSH-5 · WSH-UX-1)', () => {
  it('WSH-UX-1 · `wishlistEnabled:false` ⇒ ningún texto `wishlist.*` y ninguna llamada a la lista', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: false });
    const getList = vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    const getPreview = vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findByRole('heading', { level: 1, name: 'Charizard ex' });
    const text = document.body.textContent ?? '';
    for (const s of plainWishlistStrings()) {
      if (s === W.card.notHere) continue; // la línea de la ficha sin piezas no es del bloque (WSH-UX.2 g)
      expect(text, `apareció «${s}» con el dial apagado`).not.toContain(s);
    }
    expect(screen.queryByTestId('wishlist-block')).toBeNull();
    expect(getList).not.toHaveBeenCalled();
    expect(getPreview).not.toHaveBeenCalled();
  });

  it('WSH-UX-1 · campo ausente (servidor anterior) ⇒ apagado', async () => {
    setStoredUser(customer);
    mockDetail({});
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findByRole('heading', { level: 1, name: 'Charizard ex' });
    expect(screen.queryByTestId('wishlist-block')).toBeNull();
  });

  it('WSH-UX-1 / WSH-F1 · con sesión: acabados = `availableFinishes` EXACTOS; % = {5,10,16} con 10 marcado; sin condición', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    const finishGroup = await within(b).findByRole('radiogroup', { name: W.block.finishLegend });
    const finishRadios = within(finishGroup).getAllByRole('radio');
    expect(finishRadios.map((r) => r.getAttribute('value'))).toEqual(['normal', 'reverse_holo']);
    expect(within(finishGroup).getByLabelText(es.finish.reverse_holo)).toBeInTheDocument();

    const pctGroup = within(b).getByRole('radiogroup', { name: W.block.pctLegend });
    const pctRadios = within(pctGroup).getAllByRole('radio') as HTMLInputElement[];
    expect(pctRadios.map((r) => r.value)).toEqual(['5', '10', '16']);
    expect(pctRadios.find((r) => r.value === '10')!.checked).toBe(true);
    expect(pctRadios.filter((r) => r.checked)).toHaveLength(1);

    // Ningún control de condición (criterio 800): solo los dos grupos de radios y ningún select.
    expect(within(b).getAllByRole('radiogroup')).toHaveLength(2);
    expect(b.querySelector('select')).toBeNull();
    expect(within(b).getByText(W.block.nmNote)).toBeInTheDocument();
    // El contador sale del DTO (`count` / `limit`), nunca un 20 escrito a mano.
    expect(within(b).getByText('0 de 20')).toBeInTheDocument();
  });

  it('WSH-UX-2 · el botón lleva el acabado elegido y cambia con él', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    expect(
      await within(b).findByRole('button', { name: `Agregar ${es.finish.normal} a mi lista` }),
    ).toBeInTheDocument();
    fireEvent.click(within(b).getByLabelText(es.finish.reverse_holo));
    expect(within(b).getByRole('button', { name: `Agregar ${es.finish.reverse_holo} a mi lista` })).toBeInTheDocument();
    expect(within(b).queryByRole('button', { name: `Agregar ${es.finish.normal} a mi lista` })).toBeNull();
  });

  it('WSH-F7 · bajo cada % van los pesos del PREVIEW, y son la misma cifra que aparece al guardar; IVA de `ivaRatePct`', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    // Tasa 8 a propósito: si el rótulo dijera 16, vendría de una constante y no del DTO.
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview({ ivaRatePct: 8 }));
    const add = vi.spyOn(api, 'addWishlistItem').mockResolvedValue(item());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    const pctGroup = await within(b).findByRole('radiogroup', { name: W.block.pctLegend });
    await within(pctGroup).findByText(`hasta ${mx(105000)}`);
    expect(within(pctGroup).getByText(`hasta ${mx(110000)}`)).toBeInTheDocument();
    expect(within(pctGroup).getByText(`hasta ${mx(116000)}`)).toBeInTheDocument();
    expect(within(b).getAllByText('IVA 8 % incluido').length).toBeGreaterThan(0);

    fireEvent.click(within(b).getByRole('button', { name: `Agregar ${es.finish.normal} a mi lista` }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ cardId: 'c-test', finish: 'normal', maxPct: 10 }));
    expect(await within(b).findByText(`Tu máximo de hoy: ${mx(110000)}`)).toBeInTheDocument();
  });

  it('WSH-F7 · acabado sin mercado ⇒ ninguna cifra bajo los %', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    const pctGroup = await within(b).findByRole('radiogroup', { name: W.block.pctLegend });
    await within(pctGroup).findByText(`hasta ${mx(110000)}`);
    fireEvent.click(within(b).getByLabelText(es.finish.reverse_holo));
    await waitFor(() => expect(pctGroup.textContent).not.toContain('MX$'));
    expect(within(b).getByText(W.block.noMarketLong)).toBeInTheDocument();
  });

  it('WSH-UX-3 · `409 WISHLIST_DUPLICATE` ⇒ «ya en tu lista» con el % del `details`', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    vi.spyOn(api, 'addWishlistItem').mockRejectedValue(
      new ApiClientError(409, { code: 'WISHLIST_DUPLICATE', message: 'dup', details: { wishlistItemId: 'w-9', maxPct: 16 } }),
    );
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    fireEvent.click(await within(b).findByRole('button', { name: `Agregar ${es.finish.normal} a mi lista` }));
    expect(await within(b).findByText(W.block.duplicate)).toBeInTheDocument();
    expect(within(b).getByText(`Está en tu lista · ${es.finish.normal} · hasta 16 % sobre mercado`)).toBeInTheDocument();
    expect(within(b).queryByRole('alert')).toBeNull();
  });

  it('WSH-UX-3 · `422 WISHLIST_LIMIT_REACHED` ⇒ «{count} de {limit}» + enlace a /account/wishlist, sin «Agregar»', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    vi.spyOn(api, 'addWishlistItem').mockRejectedValue(
      new ApiClientError(422, { code: 'WISHLIST_LIMIT_REACHED', message: 'full', details: { limit: 25, count: 25 } }),
    );
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    fireEvent.click(await within(b).findByRole('button', { name: `Agregar ${es.finish.normal} a mi lista` }));
    expect(await within(b).findByText('Tu lista está llena: tienes 25 de 25 cartas.')).toBeInTheDocument();
    expect(within(b).getByRole('link', { name: W.seeList })).toHaveAttribute('href', '/account/wishlist');
    expect(within(b).queryByRole('button', { name: /Agregar/ })).toBeNull();
  });

  it('WSH-F1 · lista llena al cargar (count ≥ limit y la variante no está) ⇒ estado (c) sin chips de %', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    const others = Array.from({ length: 3 }, (_, i) =>
      item({ id: `o-${i}`, card: { ...item().card, id: `c-o${i}` } }),
    );
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse(others, { limit: 3 }));
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    expect(await within(b).findByText('Tu lista está llena: tienes 3 de 3 cartas.')).toBeInTheDocument();
    expect(within(b).queryByRole('radiogroup', { name: W.block.pctLegend })).toBeNull();
  });

  it('WSH-UX-4 · invitado ⇒ enlace con `next=/catalog/{cardId}` y ningún radio', async () => {
    mockDetail({ wishlistEnabled: true });
    const getList = vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    const login = within(b).getByRole('link', { name: W.guest.login });
    expect(decodeURIComponent(login.getAttribute('href') ?? '')).toContain('next=/catalog/c-test');
    expect(within(b).queryAllByRole('radio')).toHaveLength(0);
    expect(getList).not.toHaveBeenCalled();
  });

  it('WSH-UX-5 · `maxToday.no_market` ⇒ «Sin precio de mercado por ahora» y ningún MX$ (ni MX$0.00)', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse([item({ maxToday: { status: 'no_market' } })]));
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    const line = await within(b).findByText(W.block.noMarketLong);
    expect(line.textContent).not.toContain('MX$');
    expect(b.textContent).not.toContain('MX$0.00');
  });

  it('estado (b) al arrancar: la variante ya está ⇒ cambiar el % hace UN `PATCH` con «Guardar cambio»', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse([item()]));
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    const patch = vi
      .spyOn(api, 'updateWishlistItem')
      .mockResolvedValue(item({ maxPct: 16, maxToday: { status: 'priced', maxDisplayCents: 116000, approximate: true } }));
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const b = await block();
    expect(await within(b).findByText(`Tu máximo de hoy: ${mx(110000)}`)).toBeInTheDocument();
    expect(within(b).getByText('Te avisaremos a ana@correo.mx.')).toBeInTheDocument();
    const save = within(b).getByRole('button', { name: W.block.saveChange });
    expect(save).toBeDisabled();
    fireEvent.click(within(within(b).getByRole('radiogroup', { name: W.block.changeLegend })).getByDisplayValue('16'));
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('w-1', 16);
    expect(await within(b).findByText(`Tu máximo de hoy: ${mx(116000)}`)).toBeInTheDocument();
  });

  it('Q-WSH-UX-6 · el staff no ve el bloque (ni la invitación)', async () => {
    setStoredUser({ ...customer, role: 'vault_operator' });
    mockDetail({ wishlistEnabled: true });
    const getList = vi.spyOn(api, 'getWishlist').mockResolvedValue(listResponse());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findByRole('heading', { level: 1, name: 'Charizard ex' });
    expect(screen.queryByTestId('wishlist-block')).toBeNull();
    expect(getList).not.toHaveBeenCalled();
  });

  it('`404 FEATURE_DISABLED` de la lista (carrera con el dial) ⇒ el bloque se desmonta', async () => {
    setStoredUser(customer);
    mockDetail({ wishlistEnabled: true });
    vi.spyOn(api, 'getWishlist').mockRejectedValue(new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'off' }));
    vi.spyOn(api, 'getWishlistPreview').mockResolvedValue(preview());
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findByRole('heading', { level: 1, name: 'Charizard ex' });
    await waitFor(() => expect(screen.queryByTestId('wishlist-block')).toBeNull());
  });

  it('WSH-UX.2 (g) · ficha sin piezas ⇒ «Hoy no tenemos esta carta.»', async () => {
    mockDetail({ wishlistEnabled: false });
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    expect(await screen.findByText(W.card.notHere)).toBeInTheDocument();
  });
});
