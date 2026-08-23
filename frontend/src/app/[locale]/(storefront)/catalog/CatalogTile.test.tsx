import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { expectNoMicroNotice, expectVisibleMicroNotice } from '@/test/grading';
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

/** El bloque del badge dentro de la teja: el contenedor del micro-aviso (§21.5). */
function badgeBlockOf(tile: HTMLElement): HTMLElement {
  return within(tile).getByText(/no evaluamos esta carta/i).closest('div')!;
}

describe('CatalogTile · §21.5 badge «estimado si se gradea»', () => {
  it('la cifra lleva el condicional INCORPORADO (sin eyebrow) en sus dos longitudes', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] });
    const badge = badgeBlockOf(tile);

    // El eyebrow se retiró (§21.5): decía la misma idea que «Ilustrativo» del micro-aviso.
    expect(within(tile).queryByText('ESTIMADO SI SE GRADEA')).not.toBeInTheDocument();
    // `sm+`: «En PSA 10 vale ≈ MX$2,900.00» · móvil: «PSA 10 ≈ MX$2,900.00». Prohibido «PSA 10:».
    expect(badge.textContent).toContain('En PSA 10 vale');
    expect(badge.textContent).toContain('MX$2,900.00');
    expect(badge.textContent).not.toContain('PSA 10:');
    const figure = badge.querySelector('p')!;
    // El glifo ≈ va aria-hidden y su lectura viaja en prosa (§21.9).
    expect(figure.querySelector('[aria-hidden]')).toHaveTextContent('≈');
    expect(within(figure).getAllByText('aproximadamente').length).toBeGreaterThan(0);
    // El precio REAL sigue siendo el dato principal de la teja y no se toca.
    expect(within(tile).getByText('MX$1,408.00')).toBeInTheDocument();
  });

  /** EL BLOQUEANTE DE QA: el aviso tiene que sobrevivir a ocultar todo lo `sr-only`. */
  it('R3.1 · el micro-aviso es VISIBLE (sobrevive a ocultar los `sr-only`) con las DOS ideas', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] });
    expectVisibleMicroNotice(tile, 'es');
    // Y no está escondido en un `title`/tooltip: es un <p> de texto real.
    const notice = within(tile).getByText(/no evaluamos esta carta/i).closest('p')!;
    expect(notice.className).not.toContain('sr-only');
    expect(notice.className).not.toContain('truncate');
    expect(notice.className).not.toContain('line-clamp');
  });

  it('la llamada NO es un enlace en la teja (la teja entera ya lo es) y no se anuncia como «asterisco»', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] });
    const call = tile.querySelector('sup')!;
    expect(call.querySelector('a')).toBeNull();
    expect(call.querySelector('[aria-hidden]')).toHaveTextContent('*');
    expect(within(tile).getByText('Ver nota al pie.')).toBeInTheDocument();
    // La llamada CIERRA el micro-aviso (§21.4a), no un eyebrow.
    expect(call.closest('p')).toBe(within(tile).getByText(/no evaluamos esta carta/i).closest('p'));
  });

  it('sin `gradingHighlight` la teja se ve EXACTAMENTE como hoy: sin badge, sin hueco reservado', () => {
    const plain = renderTile();
    expectNoMicroNotice(plain.tile, 'es');
    // R4: ni «pendiente», ni guion, ni $0 — la teja no elegible no deja rastro visual.
    expect(plain.tile.textContent).not.toMatch(/pendiente|—|MX\$0\.00/);
    const plainText = plain.tile.textContent!;
    plain.unmount();

    // §21.7 (verificación visual): elegible y no elegible producen tejas IDÉNTICAS salvo el bloque
    // del badge — quitado ese bloque, el resto de la teja es exactamente el mismo.
    const withBadge = renderTile({ gradingHighlight: [psa10] });
    badgeBlockOf(withBadge.tile).remove();
    expect(withBadge.tile.textContent).toBe(plainText);
  });

  it('R5 · el badge no filtra ninguna pieza del cálculo', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] });
    expect(tile.textContent).not.toMatch(/ganancia|multiplic|ROI|margen|costo de grade/i);
  });

  it('EN: cifra condicional y micro-aviso visible en inglés', () => {
    const { tile } = renderTile({ gradingHighlight: [psa10] }, 'en');
    expect(tile.textContent).toContain('At PSA 10 it is worth');
    expectVisibleMicroNotice(tile, 'en');
  });
});
