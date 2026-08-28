import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CardDetailView } from './CardDetailView';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingDTO, ListingDTO } from '@/types/contract';

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

const refValue: ListingDTO['referenceValue'] = {
  status: 'priced',
  referenceMxnCents: 128000,
  source: 'pokemontcg_io',
  capturedDate: '2026-08-13',
};

// v1.38-grouped-listings: una PIEZA física (units[], por-pieza) para resolver el add-to-cart.
function unit(id: string, over: Partial<ListingDTO> = {}): ListingDTO {
  return {
    inventoryItemId: id,
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    referenceValue: refValue,
    salePriceCents: 140800,
    priceBasis: 'market',
    sellable: true,
    ...over,
  };
}

// v1.38-grouped-listings: un GRUPO (la grilla de la ficha) por (variante, condición) con stockCount.
function grp(over: Partial<GroupedListingDTO> = {}): GroupedListingDTO {
  return {
    representativeInventoryItemId: 'inv-a',
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    salePriceCents: 140800,
    // v2.0 (P-48): el mercado fijó el precio ⇒ la ficha SÍ muestra «Valor de mercado» (§21.8a).
    priceBasis: 'market',
    referenceValue: refValue,
    currency: 'MXN',
    ...over,
  };
}

function mockDetail(listings: GroupedListingDTO[], units: ListingDTO[]) {
  vi.spyOn(api, 'getCardDetail').mockResolvedValue({ card, listings, units });
}

/** Ficha con DOS variantes (dos grupos), cada una con una pieza: el CTA es por grupo. */
function twoVariants() {
  const listings = [
    grp({ representativeInventoryItemId: 'inv-a', finish: 'normal' }),
    grp({ representativeInventoryItemId: 'inv-b', finish: 'reverse_holo' }),
  ];
  const units = [unit('inv-a', { finish: 'normal' }), unit('inv-b', { finish: 'reverse_holo' })];
  return { listings, units };
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  window.localStorage.clear();
});

describe('CardDetailView · feedback del CTA «Comprar» (carrito local, shape agrupado)', () => {
  it('agregar un grupo (última pieza) cambia SU CTA a «En el carrito» y confirma con el toast', async () => {
    const { listings, units } = twoVariants();
    mockDetail(listings, units);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    const buyButtons = await screen.findAllByRole('button', { name: 'Comprar' });
    expect(buyButtons).toHaveLength(2);
    fireEvent.click(buyButtons[0]);

    // El grupo agregado (una sola pieza ⇒ agotado en carrito) cambia; el otro sigue en «Comprar».
    expect(await screen.findByRole('button', { name: 'En el carrito' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Comprar' })).toHaveLength(1);

    // Toast de confirmación (role=status, aria-live) con enlace al carrito.
    expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito');
    expect(screen.getByRole('link', { name: 'Ver carrito' })).toHaveAttribute('href', '/checkout');

    // El add-to-cart resolvió la pieza representativa del grupo (units), no el grupo.
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-a']);
  });

  it('el segundo clic («En el carrito») no re-agrega: navega al carrito (/checkout)', async () => {
    const { listings, units } = twoVariants();
    mockDetail(listings, units);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Comprar' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'En el carrito' }));

    expect(push).toHaveBeenCalledWith('/checkout');
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-a']);
  });

  it('un grupo con todas sus piezas en el carrito al montar → CTA inicial «En el carrito»', async () => {
    window.localStorage.setItem('tcg.cart', JSON.stringify(['inv-b']));
    const { listings, units } = twoVariants();
    mockDetail(listings, units);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    expect(await screen.findByRole('button', { name: 'En el carrito' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Comprar' })).toHaveLength(1);
    // El toast solo confirma un add de esta sesión de vista, no el estado inicial.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('un grupo con varias piezas agrega ids DISTINTOS de units (cheapest-first) hasta agotar el stock', async () => {
    const listings = [grp({ representativeInventoryItemId: 'inv-a', stockCount: 2 })];
    const units = [
      unit('inv-a', { salePriceCents: 140800 }),
      unit('inv-a2', { salePriceCents: 145000 }),
    ];
    mockDetail(listings, units);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    // Primer clic: agrega la pieza más barata; queda 1 pieza ⇒ el CTA SIGUE «Comprar».
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }));
    // Segundo clic: agrega la otra pieza (id distinto) ⇒ grupo agotado en carrito.
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar' }));

    expect(await screen.findByRole('button', { name: 'En el carrito' })).toBeInTheDocument();
    const ids = JSON.parse(window.localStorage.getItem('tcg.cart')!).ids;
    expect([...ids].sort()).toEqual(['inv-a', 'inv-a2']);
  });

  it('un grupo sin piezas vendibles (agotado, defensivo) deja su CTA deshabilitado («No disponible»)', async () => {
    const listings = [
      grp({ representativeInventoryItemId: 'inv-a' }),
      grp({ representativeInventoryItemId: 'inv-c', finish: 'holofoil', stockCount: 0 }),
    ];
    const units = [
      unit('inv-a'),
      unit('inv-c', { finish: 'holofoil', sellable: false, salePriceCents: undefined }),
    ];
    mockDetail(listings, units);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    const disabledCta = await screen.findByRole('button', { name: 'No disponible' });
    expect(disabledCta).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Comprar' })).toHaveLength(1);
  });
});

/**
 * §21.8 — «Valor de mercado» que DESAPARECE. La UI **obedece** `priceBasis`; está prohibido
 * inferirlo comparando `referenceValue` contra `salePriceCents` (el DTO sigue trayendo la
 * referencia porque alimenta superficies de admin y de valuación).
 */
describe('CardDetailView · bloque «Valor de mercado» condicional (P-48, §21.8)', () => {
  it('priceBasis="market": el bloque se muestra, con su fecha y la nota al pie que lo explica', async () => {
    mockDetail([grp()], [unit('inv-a')]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    expect(await screen.findByText('Valor de mercado')).toBeInTheDocument();
    expect(screen.getByText('MX$1,280.00')).toBeInTheDocument();
    expect(
      screen.getByText(/El valor de mercado es la referencia del día con la que valuamos las cartas/),
    ).toBeInTheDocument();
  });

  it('priceBasis="floor": el bloque NO ESTÁ EN EL DOM — ni en cero, ni tachado, ni «—»', async () => {
    // El piso ganó: el mercado no produjo el precio, así que el número no explica nada. La
    // referencia SIGUE viajando en el DTO y aun así no se pinta.
    mockDetail(
      [grp({ priceBasis: 'floor', salePriceCents: 2500 })],
      [unit('inv-a', { priceBasis: 'floor', salePriceCents: 2500 })],
    );
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    // Nada lo sustituye: ni «—» donde estaba el bloque, ni la cifra de referencia por otra vía.
    expect(screen.queryByText('MX$1,280.00')).toBeNull();
    // La nota al pie cambia con el bloque y NO menciona el mercado ni insinúa que falte algo.
    expect(
      screen.getByText('El precio de venta es el precio publicado de esta carta, sin IVA.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/valor de mercado es la referencia del día/i)).toBeNull();
  });

  it('priceBasis="override": tampoco se muestra (lo fijó una decisión humana, no el mercado)', async () => {
    mockDetail(
      [grp({ priceBasis: 'override' })],
      [unit('inv-a', { priceBasis: 'override' })],
    );
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
  });

  it('§21.8b: sin mercado la fila del dinero NO queda coja y el divisor es de la POSICIÓN', async () => {
    // Con mercado: 4 hechos ⇒ la 2ª y la 4ª celda llevan divisor izquierdo.
    const withMarket = mockDetail([grp()], [unit('inv-a')]);
    void withMarket;
    const { unmount } = renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findByText('Valor de mercado');
    const cells = () =>
      Array.from(document.querySelectorAll('div.border-b.border-border.py-6')) as HTMLElement[];
    expect(cells()).toHaveLength(4);
    expect(cells()[0].className).not.toContain('sm:border-l');
    expect(cells()[1].className).toContain('sm:border-l');
    expect(cells()[2].className).not.toContain('sm:border-l');
    expect(cells()[3].className).toContain('sm:border-l');
    unmount();

    // Sin mercado: 3 hechos. La celda de venta ocupa la fila completa y el divisor lo hereda la
    // celda que NO abre fila — «Acabado», no «Condición». (El bug era `sm:border-l` hardcodeado.)
    mockDetail(
      [grp({ priceBasis: 'floor', salePriceCents: 2500 })],
      [unit('inv-a', { priceBasis: 'floor', salePriceCents: 2500 })],
    );
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findByText('Precio de venta');
    const c = cells();
    expect(c).toHaveLength(3);
    expect(c[0].className).toContain('sm:col-span-2');
    expect(c[1].className).not.toContain('sm:border-l');
    expect(c[2].className).toContain('sm:border-l');
  });
});
