import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CardDetailView } from './CardDetailView';
import * as api from '@/lib/api';
import type { CardDTO, ListingDTO } from '@/types/contract';

// El CTA «En el carrito» navega con el router de next-intl; se mockea para
// aislar la vista y espiar la navegación (mismo patrón que BuylistView.test).
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const card: CardDTO = {
  id: 'c-test',
  externalId: 'base1-4',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: ['Stage 2'],
  setId: 'base1',
  setName: 'Base Set',
  imageSmallUrl: 'https://img.example/s.png',
  imageLargeUrl: 'https://img.example/l.png',
  availableFinishes: ['normal'],
};

function listing(id: string, over: Partial<ListingDTO> = {}): ListingDTO {
  return {
    inventoryItemId: id,
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    referenceValue: {
      status: 'priced',
      referenceMxnCents: 128000,
      source: 'pokemontcg_io',
      capturedDate: '2026-08-13',
    },
    salePriceCents: 140800,
    sellable: true,
    ...over,
  };
}

/** Ficha con DOS ejemplares vendibles: el estado del CTA es por pieza. */
function mockDetail(listings: ListingDTO[] = [listing('inv-a'), listing('inv-b')]) {
  vi.spyOn(api, 'getCardDetail').mockResolvedValue({ card, listings });
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  window.localStorage.clear();
});

describe('CardDetailView · feedback del CTA «Comprar» (carrito local)', () => {
  it('agregar cambia el CTA de ESA pieza a «En el carrito» y confirma con el toast', async () => {
    mockDetail();
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    const buyButtons = await screen.findAllByRole('button', { name: 'Comprar' });
    expect(buyButtons).toHaveLength(2);
    fireEvent.click(buyButtons[0]);

    // El CTA de la pieza agregada cambia; la otra pieza sigue en «Comprar».
    expect(await screen.findByRole('button', { name: 'En el carrito' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Comprar' })).toHaveLength(1);

    // Toast de confirmación (role=status, aria-live) con enlace al carrito.
    expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito');
    expect(screen.getByRole('link', { name: 'Ver carrito' })).toHaveAttribute('href', '/checkout');

    // Persistió en el carrito local (pieza única deduplicada; formato v2 { ids, updatedAt }).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-a']);
  });

  it('el segundo clic («En el carrito») no re-agrega: navega al carrito (/checkout)', async () => {
    mockDetail();
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Comprar' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'En el carrito' }));

    expect(push).toHaveBeenCalledWith('/checkout');
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-a']);
  });

  it('pieza ya en el carrito al montar → CTA inicial «En el carrito» (sin toast)', async () => {
    window.localStorage.setItem('tcg.cart', JSON.stringify(['inv-b']));
    mockDetail();
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    expect(await screen.findByRole('button', { name: 'En el carrito' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Comprar' })).toHaveLength(1);
    // El toast solo confirma un add de esta sesión de vista, no el estado inicial.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('un ejemplar no vendible mantiene su CTA deshabilitado («No disponible»)', async () => {
    mockDetail([listing('inv-a'), listing('inv-c', { sellable: false, salePriceCents: undefined })]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    const disabledCta = await screen.findByRole('button', { name: 'No disponible' });
    expect(disabledCta).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Comprar' })).toHaveLength(1);
  });
});
