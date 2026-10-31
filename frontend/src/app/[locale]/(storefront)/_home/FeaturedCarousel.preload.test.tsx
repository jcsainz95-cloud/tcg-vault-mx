import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { CardDTO, FeaturedListingDTO } from '@/types/contract';

/**
 * §DYN.6.2 + §DYN.6.6 — «precarga la imagen líder». `ReactDOM.preload` es de React 19 (App Router); aquí (React 18) se
 * inyecta un doble para fijar QUÉ se precarga: la foto grande de la teja 1 POR `/_next/image`, con el MISMO
 * `srcset`/`sizes` que su `<img>` y prioridad alta, una sola vez; y nada sin datos.
 * Mutaciones que lo ponen rojo: quitar la llamada, precargar otra teja o la URL original (doble descarga).
 */
const preload = vi.hoisted(() => vi.fn());
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), preload }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { FeaturedCarousel } from './FeaturedCarousel';

function tile(i: number): FeaturedListingDTO {
  const card: CardDTO = {
    id: `c-${i}`,
    externalId: `x-${i}`,
    name: `Carta ${i}`,
    number: '1',
    rarity: 'Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's1',
    setName: 'Set', setPtcgoCode: null,
    imageSmallUrl: `https://img.example/${i}-s.png`,
    imageLargeUrl: `https://img.example/${i}-l.png`,
    availableFinishes: ['normal'],
  };
  return {
    representativeInventoryItemId: `inv-${i}`,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    displayPriceCents: 1000,
    ivaIncluded: true,
    ivaRatePct: 16,
    currency: 'MXN',
    card,
    featuredSlot: 'pool',
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  preload.mockReset();
});

describe('§DYN.6.2 · precarga de la foto líder', () => {
  it('precarga la foto GRANDE de la teja 1 por /_next/image, con el srcset/sizes de su <img>, una vez', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-29', data: [tile(0), tile(1)] });
    renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByText('Carta 1');
    const img = screen.getByAltText('Carta 0');
    // UNA llamada, y con los atributos de la `<img>` (mismo `getImageProps()`).
    expect(preload.mock.calls).toEqual([
      [
        img.getAttribute('src'),
        { as: 'image', imageSrcSet: img.getAttribute('srcset'), imageSizes: img.getAttribute('sizes'), fetchPriority: 'high' },
      ],
    ]);
    expect(new URL(preload.mock.calls[0][0], 'http://t.test').searchParams.get('url')).toBe('https://img.example/0-l.png');
  });

  it('sin datos no precarga nada', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: null, data: [] });
    renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByText('Sin resultados');
    expect(preload).not.toHaveBeenCalled();
  });
});
