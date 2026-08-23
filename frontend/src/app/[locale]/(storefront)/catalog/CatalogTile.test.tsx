import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { CatalogTile } from './CatalogTile';
import { GradingFootnoteBoundary } from '../_shared/grading/GradingFootnote';
import type {
  CardDTO,
  GradedEstimateDTO,
  GroupedListingDTO,
  ListingDTO,
} from '@/types/contract';

// La teja usa <Link> y useRouter de next-intl; se mockean para aislarla del router.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const card: CardDTO = {
  id: 'c-charizard',
  externalId: 'base1-4',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: ['Stage 2'],
  setId: 'base1',
  setName: 'Base Set',
  imageSmallUrl: 'https://img.example/charizard-small.png',
  imageLargeUrl: 'https://img.example/charizard-large.png',
  availableFinishes: ['normal', 'holofoil'],
};

const refValue: ListingDTO['referenceValue'] = {
  status: 'priced',
  referenceMxnCents: 128000,
  source: 'pokemontcg_io',
  capturedDate: '2026-08-13',
};

function listing(over: Partial<GroupedListingDTO> = {}): GroupedListingDTO {
  return {
    representativeInventoryItemId: 'inv-a',
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    gradeKey: 'raw:NM',
    stockCount: 2,
    salePriceCents: 140800,
    referenceValue: refValue,
    currency: 'MXN',
    ...over,
  };
}

describe('CatalogTile · P-39 grid denso conserva la imagen chica', () => {
  it('pinta imageSmallUrl (no la grande) por performance del grid', () => {
    renderWithIntl(<CatalogTile listing={listing()} inCart={false} onAdd={vi.fn()} />, 'es');
    const img = screen.getByAltText('Charizard');
    expect(img).toHaveAttribute('src', 'https://img.example/charizard-small.png');
  });
});

describe('CatalogTile · P-40 acabado legible', () => {
  it('muestra el acabado (Holofoil) en la ficha técnica de la teja', () => {
    renderWithIntl(<CatalogTile listing={listing({ finish: 'holofoil' })} inCart={false} onAdd={vi.fn()} />, 'es');
    // ListingSpec renderiza el acabado como último segmento del renglón mono (RAW · NM · HOLOFOIL).
    expect(screen.getByText(/Holofoil/)).toBeInTheDocument();
  });

  it('muestra «Reverse Holo» cuando el grupo es reverse_holo', () => {
    renderWithIntl(<CatalogTile listing={listing({ finish: 'reverse_holo' })} inCart={false} onAdd={vi.fn()} />, 'es');
    expect(screen.getByText(/Reverse Holo/)).toBeInTheDocument();
  });
});

describe('CatalogTile · P-44 rareza visible', () => {
  it('muestra la rareza de la carta (Rare Holo) junto al acabado', () => {
    renderWithIntl(<CatalogTile listing={listing()} inCart={false} onAdd={vi.fn()} />, 'es');
    const rarity = screen.getByText('Rare Holo');
    expect(rarity).toBeInTheDocument();
    // Etiqueta discreta con prefijo accesible localizado (el valor no se traduce).
    expect(rarity).toHaveAttribute('aria-label', 'Rareza: Rare Holo');
  });
});

// ===== v1.44-graded-estimate · badge del gancho de grading (§21.5) =====
const psa10: GradedEstimateDTO = {
  gradingCompany: 'PSA',
  gradeValue: '10',
  gradeKey: 'graded:PSA:10',
  estimate: { status: 'priced', referenceMxnCents: 290_000, capturedDate: '2026-08-22' },
};

/**
 * La teja SIEMPRE se pinta dentro de la página que hospeda la nota al pie (R3). Se devuelve además
 * el subárbol de LA TEJA (primer hijo de la boundary; el segundo es la nota) para poder afirmar
 * sobre ella sin que el texto del disclaimer contamine las búsquedas.
 */
function renderTile(over: Partial<GroupedListingDTO> = {}, locale: 'es' | 'en' = 'es') {
  const view = renderWithIntl(
    <GradingFootnoteBoundary active>
      <CatalogTile listing={listing(over)} inCart={false} onAdd={vi.fn()} />
    </GradingFootnoteBoundary>,
    locale,
  );
  return { ...view, tile: view.container.firstElementChild as HTMLElement };
}

describe('CatalogTile · §21.5 badge «estimado si se gradea»', () => {
  it('con `gradingHighlight` pinta eyebrow con la palabra ESTIMADO (sin abreviar) y la cifra condicional', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] });

    const eyebrow = within(tile).getByText('ESTIMADO SI SE GRADEA');
    expect(eyebrow).toBeInTheDocument();
    expect(eyebrow.textContent).not.toContain('EST.');
    // La frase completa lleva SIEMPRE el condicional delante: «estimado si se gradea, PSA 10 ≈ …».
    const figure = within(tile).getByText(/PSA 10/);
    expect(figure.textContent).toContain('PSA 10');
    expect(figure.textContent).toContain('MX$2,900.00');
    // El glifo ≈ va aria-hidden y su lectura viaja en prosa (§21.9).
    expect(figure.querySelector('[aria-hidden]')).toHaveTextContent('≈');
    expect(within(figure).getByText('aproximadamente')).toBeInTheDocument();
    // El precio REAL sigue siendo el dato principal de la teja y no se toca.
    expect(within(tile).getByText('MX$1,408.00')).toBeInTheDocument();
  });

  it('la llamada NO es un enlace en la teja (la teja entera ya lo es) y no se anuncia como «asterisco»', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] });
    const call = tile.querySelector('sup')!;
    expect(call.querySelector('a')).toBeNull();
    expect(call.querySelector('[aria-hidden]')).toHaveTextContent('*');
    expect(
      within(tile).getByText(
        'Ver nota al pie: cifra ilustrativa de mercado; no evaluamos el estado de esta carta.',
      ),
    ).toBeInTheDocument();
  });

  it('sin `gradingHighlight` la teja se ve EXACTAMENTE como hoy: sin badge, sin hueco reservado', () => {
    const plain = renderTile();
    expect(within(plain.tile).queryByText('ESTIMADO SI SE GRADEA')).not.toBeInTheDocument();
    // R4: ni «pendiente», ni guion, ni $0 — la teja no elegible no deja rastro visual.
    expect(plain.tile.textContent).not.toMatch(/pendiente|—|MX\$0\.00/);
    const plainText = plain.tile.textContent!;
    plain.unmount();

    // §21.7 (verificación visual): elegible y no elegible producen tejas IDÉNTICAS salvo el bloque
    // del badge — quitado ese bloque, el resto de la teja es exactamente el mismo.
    const withBadge = renderTile({ gradingHighlight: [psa10] });
    const badgeBlock = within(withBadge.tile).getByText('ESTIMADO SI SE GRADEA').parentElement!;
    badgeBlock.remove();
    expect(withBadge.tile.textContent).toBe(plainText);
  });

  it('R5 · el badge no filtra ninguna pieza del cálculo', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] });
    expect(tile.textContent).not.toMatch(/ganancia|multiplic|ROI|margen|costo/i);
  });

  it('EN: el eyebrow conserva la palabra ESTIMATED', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] }, 'en');
    expect(within(tile).getByText('ESTIMATED IF GRADED')).toBeInTheDocument();
  });
});
