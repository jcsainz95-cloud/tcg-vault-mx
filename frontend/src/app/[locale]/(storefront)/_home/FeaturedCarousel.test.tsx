import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { FeaturedCarousel } from './FeaturedCarousel';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingSummaryDTO } from '@/types/contract';

// El carrusel usa <Link> de next-intl; se mockea a un <a> plano para aislar la vista.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function card(id: string, name: string): CardDTO {
  return {
    id,
    externalId: `base1-${id}`,
    name,
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: `https://img.example/${id}-small.png`,
    imageLargeUrl: `https://img.example/${id}-large.png`,
    availableFinishes: ['normal', 'reverse_holo'],
  };
}

// v2.1.9 (D2): las tejas del carrusel consumen el DTO de la REJILLA, sin las dos señales de precio.
function grp(over: Partial<GroupedListingSummaryDTO> & { card: CardDTO }): GroupedListingSummaryDTO {
  return {
    representativeInventoryItemId: `inv-${over.card.id}`,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    salePriceCents: 140800,
    currency: 'MXN',
    ...over,
  };
}

function mockCatalog(data: GroupedListingSummaryDTO[]) {
  vi.spyOn(api, 'getCatalog').mockResolvedValue({
    data,
    page: 1,
    pageSize: data.length,
    total: data.length,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('FeaturedCarousel · P-39 imagen de alta resolución', () => {
  it('la teja destacada (hero) pinta imageLargeUrl, no la chica', async () => {
    const hero = grp({ card: card('c-hero', 'Charizard'), finish: 'reverse_holo' });
    mockCatalog([hero, grp({ card: card('c-2', 'Blastoise'), finish: 'holofoil' })]);
    renderWithProviders(<FeaturedCarousel />, 'es');

    const heroImg = await screen.findByAltText('Charizard');
    expect(heroImg).toHaveAttribute('src', 'https://img.example/c-hero-large.png');
  });

  it('cae a imageSmallUrl cuando imageLargeUrl es null (nunca imagen rota)', async () => {
    const c = card('c-hero', 'Charizard');
    // El backend podría emitir null; el fallback debe usar la chica.
    (c as { imageLargeUrl: string | null }).imageLargeUrl = null;
    mockCatalog([grp({ card: c })]);
    renderWithProviders(<FeaturedCarousel />, 'es');

    const heroImg = await screen.findByAltText('Charizard');
    expect(heroImg).toHaveAttribute('src', 'https://img.example/c-hero-small.png');
  });
});

describe('FeaturedCarousel · P-40 etiqueta de acabado', () => {
  it('pinta el acabado legible de cada teja (Reverse Holo / Holofoil)', async () => {
    mockCatalog([
      grp({ card: card('c-hero', 'Charizard'), finish: 'reverse_holo' }),
      grp({ card: card('c-2', 'Blastoise'), finish: 'holofoil' }),
    ]);
    renderWithProviders(<FeaturedCarousel />, 'es');

    expect(await screen.findByText('Reverse Holo')).toBeInTheDocument();
    expect(screen.getByText('Holofoil')).toBeInTheDocument();
  });
});
