import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CardDetailView } from './CardDetailView';
import * as api from '@/lib/api';
import type {
  CardDTO,
  GradedEstimateDTO,
  GroupedListingDTO,
  ListingDTO,
} from '@/types/contract';

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
    referenceValue: refValue,
    currency: 'MXN',
    ...over,
  };
}

function mockDetail(
  listings: GroupedListingDTO[],
  units: ListingDTO[],
  gradedEstimates?: GradedEstimateDTO[],
) {
  vi.spyOn(api, 'getCardDetail').mockResolvedValue({
    card,
    listings,
    units,
    ...(gradedEstimates ? { gradedEstimates } : {}),
  });
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

// ===== v1.44-graded-estimate · bloque de la ficha + nota al pie (DESIGN_SYSTEM §21.3/§21.4) =====
const est = (gradeValue: string, cents: number): GradedEstimateDTO => ({
  gradingCompany: 'PSA',
  gradeValue,
  gradeKey: `graded:PSA:${gradeValue}`,
  // El contrato OMITE `source` siempre: fase manual y fase automática son indistinguibles.
  estimate: { status: 'priced', referenceMxnCents: cents, capturedDate: '2026-08-22' },
});

describe('CardDetailView · §21.3 «valor estimado si se gradea»', () => {
  it('con `gradedEstimates` pinta el bloque junto al precio, con la fecha de refresco y su llamada', async () => {
    const { listings, units } = twoVariants();
    mockDetail(listings, units, [est('10', 2_900_000), est('9', 1_450_000)]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    expect(await screen.findByText('VALOR ESTIMADO SI SE GRADEA')).toBeInTheDocument();
    expect(screen.getByText('MX$29,000.00')).toBeInTheDocument();
    expect(screen.getByText('MX$14,500.00')).toBeInTheDocument();
    expect(screen.getByText('ESTIMADO · 22 ago 2026')).toBeInTheDocument();
    // Chip de grado HIPOTÉTICO (punteado, sin cert) y siempre tras el condicional «SI SALE».
    expect(screen.getAllByText('SI SALE')).toHaveLength(2);
    expect(
      screen.getByText('Grado hipotético: PSA 10. Esta carta no está gradeada.'),
    ).toBeInTheDocument();
  });

  it('el bloque va DESPUÉS del referenceExplainer y ANTES de «Ejemplares disponibles» (§21.3)', async () => {
    const { listings, units } = twoVariants();
    mockDetail(listings, units, [est('10', 2_900_000), est('9', 1_450_000)]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    const block = (await screen.findByText('VALOR ESTIMADO SI SE GRADEA')).closest('section')!;
    const instances = screen.getByRole('heading', { name: 'Ejemplares disponibles' });
    expect(block.compareDocumentPosition(instances) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // El bloque NO vive dentro de la retícula del precio real (mismo grid = misma categoría, R2).
    expect(block.contains(screen.getByText('Precio de venta'))).toBe(false);
  });

  it('R3 · la ficha con bloque renderiza SIEMPRE la nota al pie completa, sin interacción', async () => {
    const { listings, units } = twoVariants();
    mockDetail(listings, units, [est('10', 2_900_000), est('9', 1_450_000)]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    await screen.findByText('VALOR ESTIMADO SI SE GRADEA');
    const note = document.getElementById('nota-estimado')!;
    expect(note).toBeInTheDocument();
    expect(note.querySelector('details')).toBeNull();
    expect(screen.getByText(/INFORMACIÓN ILUSTRATIVA/)).toBeInTheDocument();
    // La llamada de la FICHA sí es un enlace al pie (la de la teja no: sería un ancla anidada).
    const call = document.getElementById('llamada-estimado')!.querySelector('a')!;
    expect(call).toHaveAttribute('href', '#nota-estimado');
    expect(call).toHaveAttribute(
      'aria-label',
      'Ver nota al pie: cifra ilustrativa de mercado; no evaluamos el estado de esta carta.',
    );
  });

  it('R4 · sin `gradedEstimates` no se pinta nada: ni bloque, ni nota al pie, ni «pendiente»', async () => {
    const { listings, units } = twoVariants();
    mockDetail(listings, units);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    await screen.findAllByRole('button', { name: 'Comprar' });
    expect(screen.queryByText('VALOR ESTIMADO SI SE GRADEA')).not.toBeInTheDocument();
    expect(document.getElementById('nota-estimado')).toBeNull();
    expect(screen.queryByText(/INFORMACIÓN ILUSTRATIVA/)).not.toBeInTheDocument();
  });

  it('la ficha NO está gateada por el ROI: pinta el bloque aunque el grupo no traiga `gradingHighlight`', async () => {
    // Estado NORMAL y esperado (§21.7): ficha con bloque y teja sin badge. No es un bug.
    const { listings, units } = twoVariants();
    expect(listings.every((l) => l.gradingHighlight === undefined)).toBe(true);
    mockDetail(listings, units, [est('10', 2_900_000), est('9', 1_450_000)]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    expect(await screen.findByText('VALOR ESTIMADO SI SE GRADEA')).toBeInTheDocument();
  });

  it('R5 · la ficha no muestra ninguna pieza del cálculo (ganancia, multiplicador, costo, margen)', async () => {
    const { listings, units } = twoVariants();
    mockDetail(listings, units, [est('10', 2_900_000), est('9', 1_450_000)]);
    const { container } = renderWithProviders(<CardDetailView cardId="c-test" />, 'es');

    await screen.findByText('VALOR ESTIMADO SI SE GRADEA');
    expect(container.textContent).not.toMatch(/multiplic|ganancia|ROI|rendimiento|costo de grade/i);
  });
});
