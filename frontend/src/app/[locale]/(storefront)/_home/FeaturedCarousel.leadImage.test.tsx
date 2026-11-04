import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderWithProviders } from '@/test/render';
import { applyNextImageConfig } from '@/test/next-image-config';
import { stripComments } from '@/test/strip-comments';
import * as api from '@/lib/api';
import type { CardDTO, FeaturedListingDTO, GradedEstimateDTO, GroupedListingSummaryDTO } from '@/types/contract';
import { OPTIMIZED_IMAGE_SIZES, OPTIMIZED_TILE_IMAGE_SIZES } from '@/components/ui/CardImage';
import { FeaturedCarousel } from './FeaturedCarousel';
import { GradingGemsShelf } from './GradingGemsShelf';
import { GradingFootnoteBoundary } from '../_shared/grading/GradingFootnote';
import { IDS_EN_SUMMARY } from '@/test/ids-defaults';

/**
 * 🔒 DYN-F8 (a) · API_CONTRACT §DYN.6.6, ARCHITECTURE §4.DYN (f) 7 — la foto de la teja LÍDER sale de `/_next/image`
 * (WebP 384/640, opción A del dueño, `HECHOS` 2026-10-30) y, desde el 2026-11-04 («Pásalas por el reductor», `HECHOS`
 * 2026-11-04), TAMBIÉN las tejas secundarias de Destacadas (la chica por el optimizador, `sizes` de teja 136/244 px).
 * NINGUNA otra imagen de la portada —ni del catálogo— pasa por el optimizador: el coste es por imagen origen distinta
 * y el catálogo son miles (el dueño decide aparte, con coste medido).
 *
 * Corre con los `images` REALES de `next.config.mjs` aplicados a `getImageProps()` (`applyNextImageConfig`): sin eso,
 * la suite mediría la config por defecto de Next (16…3840 px), no la nuestra.
 * Mutaciones que lo ponen rojo (medidas, ver FRONTEND_NOTES §DYN): `src={imageLargeUrl}` crudo (quitar `optimized`);
 * `sizes` ausente o `100vw`; precargar la URL original; añadir 1080 a los anchos; una teja secundaria CRUDA (sin
 * `optimized`) o con el `sizes` de la líder; `optimized` en cualquier fichero que no sea FeaturedCarousel.tsx.
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

let restoreImageConfig: () => void = () => undefined;
beforeAll(() => {
  restoreImageConfig = applyNextImageConfig();
});
afterAll(() => restoreImageConfig());

function card(i: number, large: string | null = `https://img.example/${i}-l.png`): CardDTO {
  return {
    id: `c-${i}`,
    externalId: `x-${i}`,
    name: `Carta ${i}`,
    number: '1',
    rarity: 'Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's1',
    setName: 'Set',
    setPtcgoCode: null,
    imageSmallUrl: `https://img.example/${i}-s.png`,
    imageLargeUrl: large as string,
    availableFinishes: ['normal'],
  };
}

function tile(i: number, large?: string | null): FeaturedListingDTO {
  return {
    ...IDS_EN_SUMMARY,
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
    card: card(i, large),
    featuredSlot: 'pool',
  };
}

const psa10: GradedEstimateDTO = {
  gradingCompany: 'PSA',
  gradeValue: '10',
  gradeKey: 'graded:PSA:10',
  estimate: { status: 'priced', referenceMxnCents: 290_000, capturedDate: '2026-08-22' },
};

function gem(i: number): GroupedListingSummaryDTO {
  const { featuredSlot: _slot, ...rest } = tile(100 + i);
  void _slot;
  return { ...rest, displayPriceCents: 140_800, gradingHighlight: [psa10] };
}

const optimizer = (src: string | null) => {
  const u = new URL(src ?? '', 'http://tienda.test');
  return u.pathname === '/_next/image' ? u : null;
};

beforeEach(() => {
  vi.restoreAllMocks();
  preload.mockReset();
  window.localStorage.clear();
});

describe('DYN-F8 (a) · la teja líder por /_next/image; nada más', () => {
  it('líder: url = imageLargeUrl, srcset SOLO 384w/640w, el sizes de §4.DYN (f) 7, q=75, fetchpriority=high y eager', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-30', data: [0, 1, 2, 3].map((i) => tile(i)) });
    renderWithProviders(<FeaturedCarousel />, 'es');
    const lead = await screen.findByAltText('Carta 0');

    const src = optimizer(lead.getAttribute('src'));
    expect(src?.searchParams.get('url')).toBe('https://img.example/0-l.png');
    expect(src?.searchParams.get('q')).toBe('75');
    const srcset = (lead.getAttribute('srcset') ?? '').split(',').map((s) => s.trim().split(/\s+/));
    expect(srcset.map(([, w]) => w)).toEqual(['384w', '640w']);
    for (const [u, w] of srcset) {
      const p = optimizer(u);
      expect(p?.searchParams.get('url')).toBe('https://img.example/0-l.png');
      expect(`${p?.searchParams.get('w')}w`).toBe(w);
    }
    expect(lead.getAttribute('sizes')).toBe('(min-width: 1024px) 376px, 212px');
    expect(OPTIMIZED_IMAGE_SIZES).toBe('(min-width: 1024px) 376px, 212px');
    expect(lead).toHaveAttribute('fetchpriority', 'high');
    expect(lead).toHaveAttribute('loading', 'eager');
  });

  it('sin imageLargeUrl, la líder optimiza imageSmallUrl (nunca imagen rota)', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-30', data: [tile(0, null), tile(1)] });
    renderWithProviders(<FeaturedCarousel />, 'es');
    const lead = await screen.findByAltText('Carta 0');
    expect(optimizer(lead.getAttribute('src'))?.searchParams.get('url')).toBe('https://img.example/0-s.png');
  });

  it('preload UNA vez, con imageSrcSet/imageSizes idénticos a los de la <img> (nunca la URL original)', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-10-30', data: [0, 1, 2].map((i) => tile(i)) });
    renderWithProviders(<FeaturedCarousel />, 'es');
    const lead = await screen.findByAltText('Carta 0');
    await screen.findByAltText('Carta 2');
    expect(preload).toHaveBeenCalledTimes(1);
    const [href, opts] = preload.mock.calls[0];
    expect(href).toBe(lead.getAttribute('src'));
    expect(opts).toEqual({
      as: 'image',
      imageSrcSet: lead.getAttribute('srcset'),
      imageSizes: lead.getAttribute('sizes'),
      fetchPriority: 'high',
    });
    expect(optimizer(href)).not.toBeNull();
  });

  it('tejas secundarias (01…): la CHICA por /_next/image, srcset SOLO 384w/640w, sizes de teja 136/244 px, q=75; nunca la grande', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-11-04', data: [0, 1, 2, 3, 4].map((i) => tile(i)) });
    renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByAltText('Carta 4');
    expect(OPTIMIZED_TILE_IMAGE_SIZES).toBe('(min-width: 1024px) 244px, 136px');
    for (const i of [1, 2, 3, 4]) {
      const img = screen.getByAltText(`Carta ${i}`);
      const src = optimizer(img.getAttribute('src'));
      expect(src?.searchParams.get('url')).toBe(`https://img.example/${i}-s.png`);
      expect(src?.searchParams.get('q')).toBe('75');
      const srcset = (img.getAttribute('srcset') ?? '').split(',').map((s) => s.trim().split(/\s+/));
      expect(srcset.map(([, w]) => w)).toEqual(['384w', '640w']);
      for (const [u] of srcset) expect(optimizer(u)?.searchParams.get('url')).toBe(`https://img.example/${i}-s.png`);
      expect(img.getAttribute('sizes')).toBe('(min-width: 1024px) 244px, 136px');
      expect(img).not.toHaveAttribute('fetchpriority');
    }
  });

  it('posición: 01–03 (caben en el primer viewport) eager; 04+ lazy; decoding=async en todas', async () => {
    vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-11-04', data: [0, 1, 2, 3, 4, 5].map((i) => tile(i)) });
    renderWithProviders(<FeaturedCarousel />, 'es');
    await screen.findByAltText('Carta 5');
    for (const i of [1, 2, 3]) expect(screen.getByAltText(`Carta ${i}`)).toHaveAttribute('loading', 'eager');
    for (const i of [4, 5]) expect(screen.getByAltText(`Carta ${i}`)).toHaveAttribute('loading', 'lazy');
    for (const i of [0, 1, 2, 3, 4, 5]) expect(screen.getByAltText(`Carta ${i}`)).toHaveAttribute('decoding', 'async');
  });

  it('interruptor de emergencia encendido: líder Y tejas vuelven a la URL original, sin srcset', async () => {
    const KEY = 'NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH';
    const before = process.env[KEY];
    process.env[KEY] = 'on';
    try {
      vi.spyOn(api, 'getFeatured').mockResolvedValue({ businessDate: '2026-11-04', data: [0, 1, 2].map((i) => tile(i)) });
      renderWithProviders(<FeaturedCarousel />, 'es');
      await screen.findByAltText('Carta 2');
      expect(screen.getByAltText('Carta 0')).toHaveAttribute('src', 'https://img.example/0-l.png');
      for (const i of [1, 2]) {
        expect(screen.getByAltText(`Carta ${i}`)).toHaveAttribute('src', `https://img.example/${i}-s.png`);
        expect(screen.getByAltText(`Carta ${i}`)).not.toHaveAttribute('srcset');
      }
    } finally {
      if (before === undefined) delete process.env[KEY];
      else process.env[KEY] = before;
    }
  });

  it('la vitrina «Joyas para gradear» tampoco pasa por /_next/image', async () => {
    vi.spyOn(api, 'getCatalog').mockResolvedValue({ data: [gem(0), gem(1)], page: 1, pageSize: 8, total: 2 });
    renderWithProviders(
      <GradingFootnoteBoundary active>
        <GradingGemsShelf />
      </GradingFootnoteBoundary>,
      'es',
    );
    const imgs = await screen.findAllByAltText(/Carta 10[01]/);
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      expect(optimizer(img.getAttribute('src'))).toBeNull();
      expect(img).not.toHaveAttribute('srcset');
    }
  });

  it('fuente: `optimized` aparece SOLO en FeaturedCarousel.tsx (líder + tejas = 2 usos); en ningún otro fichero de src/ (catálogo incluido)', () => {
    const SRC = join(__dirname, '../../../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !p.endsWith('components/ui/CardImage.tsx')) {
          const code = stripComments(readFileSync(p, "utf8"), p);
          const n = (code.match(/<CardImage\b[^>]*\boptimized\b/g) ?? []).length;
          if (n > 0) hits.push(`${relative(SRC, p)}×${n}`);
        }
      }
    };
    walk(SRC);
    // ×2 exactos: una teja cruda en Destacadas (×1) o un uso en CatalogTile (fichero extra) lo ponen rojo.
    expect(hits).toEqual(['app/[locale]/(storefront)/_home/FeaturedCarousel.tsx×2']);
  });
});
