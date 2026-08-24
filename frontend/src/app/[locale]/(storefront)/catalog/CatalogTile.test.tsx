import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { CatalogTile } from './CatalogTile';
import type { CardDTO, GroupedListingDTO, ListingDTO } from '@/types/contract';

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
    priceBasis: 'market',
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
