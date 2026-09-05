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

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * CANDADO de las dos mejoras de rendimiento de `171f24b` (M-1). Estaban BIEN, pero eran
 * invisibles para la suite: QA revirtió las dos (teja secundaria a `imageLargeUrl`, y
 * `priority` fuera de la líder) y la suite siguió verde. Una mejora sin test no es una
 * mejora: es una conducta que el siguiente refactor puede deshacer sin enterarse.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
describe('FeaturedCarousel · PERF (candado)', () => {
  /** Las tres secundarias de la pista de abajo: `[cardId, nombre]`. */
  const SECONDARY: [string, string][] = [
    ['c-2', 'Blastoise'],
    ['c-3', 'Venusaur'],
    ['c-4', 'Pikachu'],
  ];

  /** Líder + 3 secundarias, cada una con su par de URLs distinguible. */
  function pista() {
    mockCatalog([
      grp({ card: card('c-hero', 'Charizard') }),
      grp({ card: card('c-2', 'Blastoise') }),
      grp({ card: card('c-3', 'Venusaur') }),
      grp({ card: card('c-4', 'Pikachu') }),
    ]);
  }

  it('las tejas SECUNDARIAS piden la imagen CHICA, nunca la grande', async () => {
    pista();
    renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByAltText('Charizard');

    // Miden 160px (268px en lg): la grande (~734×1024) se descargaría entera para pintarse a
    // menos de un tercio de su ancho, y son SIETE en el primer bloque con imágenes de la home.
    for (const [id, name] of SECONDARY) {
      const img = screen.getByAltText(name);
      expect(img).toHaveAttribute('src', `https://img.example/${id}-small.png`);
      expect(img.getAttribute('src')).not.toContain('-large');
    }
  });

  it('la teja LÍDER conserva `priority`: eager + fetchpriority=high (candidata a LCP)', async () => {
    pista();
    renderWithProviders(<FeaturedCarousel />, 'es');

    const lead = await screen.findByAltText('Charizard');
    expect(lead).toHaveAttribute('loading', 'eager');
    expect(lead).toHaveAttribute('fetchpriority', 'high');
    // Sin fade-in: un `opacity-0` esperando al `onLoad` retrasa el PINTADO aunque los bytes
    // ya estén — justo la métrica que `priority` viene a mejorar.
    expect(lead.className).toContain('opacity-100');
  });

  it('`priority` es EXCLUSIVO de la líder: varias `high` a la vez se pelean el ancho de banda', async () => {
    pista();
    renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByAltText('Charizard');

    for (const [, name] of SECONDARY) {
      const img = screen.getByAltText(name);
      expect(img).toHaveAttribute('loading', 'lazy');
      expect(img).not.toHaveAttribute('fetchpriority');
    }
  });
});
