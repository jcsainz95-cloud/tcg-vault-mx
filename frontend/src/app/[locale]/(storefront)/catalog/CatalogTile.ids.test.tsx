/**
 * §IDS (API_CONTRACT §IDS.5; DESIGN_SYSTEM §IDS-UX.4) — la teja del catálogo con versión.
 *  - fila PROPIA de insignias (solo si hay), orden idioma → tipo; inglés sin liga sin insignia;
 *  - candado 5: la teja no pinta «Inglés», el detalle («Prize Pack», `stamp.label`) ni «sello»;
 *  - candado 6: la insignia nunca es hija del contenedor de la foto;
 *  - el enlace lleva `?version=<versionOptionKey>` tal cual vino (⛔ no se compone);
 *  - la ficha técnica usa `finishLabel` (Cosmos Holo); el nombre accesible añade la versión.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { CatalogTile } from './CatalogTile';
import type { CardDTO, GroupedListingSummaryDTO } from '@/types/contract';
import { IDS_EN_SUMMARY } from '@/test/ids-defaults';

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
  id: 'c-poffin',
  externalId: 'sv5-144',
  name: 'Buddy-Buddy Poffin',
  number: '144',
  rarity: 'Uncommon',
  supertype: 'Trainer',
  subtypes: ['Item'],
  setId: 'sv5',
  setName: 'Temporal Forces',
  setPtcgoCode: 'TEF',
  imageSmallUrl: 'https://img.example/s.png',
  imageLargeUrl: 'https://img.example/l.png',
  availableFinishes: ['normal', 'reverse_holo'],
};

const COSMOS = { type: 'prize_pack' as const, label: 'Cosmos Holo', productId: 703819 };

function tile(over: Partial<GroupedListingSummaryDTO>): GroupedListingSummaryDTO {
  return {
    ...IDS_EN_SUMMARY,
    representativeInventoryItemId: 'inv-a',
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    displayPriceCents: 36000,
    ivaIncluded: true,
    ivaRatePct: 16,
    currency: 'MXN',
    ...over,
  };
}

const esCosmos = tile({
  version: { key: 'es.703819', language: 'es', stamp: COSMOS },
  finish: 'holofoil',
  finishLabel: 'cosmos_holo',
  versionOptionKey: 'es.703819.holofoil',
});

describe('CatalogTile · versión (§IDS-UX.4)', () => {
  it('español de liga: dos insignias en su fila, «Español» → «De liga», sin el detalle ni «Inglés» ni «sello»', () => {
    const { container } = renderWithIntl(<CatalogTile listing={esCosmos} inCart={false} onAdd={vi.fn()} />);
    const row = screen.getByTestId('tile-version-chips');
    expect(Array.from(row.children).map((c) => c.textContent)).toEqual(['Español', 'De liga']);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Inglés|Prize Pack|sello/i);
    expect(text).not.toContain('Cosmos Holo · '); // el detalle del proveedor no sale como texto suelto
  });

  it('(15) la ficha técnica usa finishLabel en su forma corta en la teja («Cosmos»; el nombre accesible lo dice entero)', () => {
    renderWithIntl(<CatalogTile listing={esCosmos} inCart={false} onAdd={vi.fn()} />);
    const spec = screen.getByText(/· NM · Cosmos$/);
    expect(spec.getAttribute('aria-label')).toMatch(/· NM · Cosmos Holo\./);
  });

  it('(6) la fila de insignias NO es hija del contenedor de la foto', () => {
    const { container } = renderWithIntl(<CatalogTile listing={esCosmos} inCart={false} onAdd={vi.fn()} />);
    const img = container.querySelector('img')!;
    const photoLink = img.closest('a')!;
    expect(photoLink.querySelector('[data-version-chip]')).toBeNull();
    expect(img.parentElement!.querySelector('[data-version-chip]')).toBeNull();
  });

  it('el enlace lleva ?version=<versionOptionKey> tal cual vino; el nombre accesible añade la versión', () => {
    renderWithIntl(<CatalogTile listing={esCosmos} inCart={false} onAdd={vi.fn()} />);
    const named = screen.getByRole('link', { name: 'Buddy-Buddy Poffin, español, de liga' });
    expect(named).toHaveAttribute('href', '/catalog/c-poffin?version=es.703819.holofoil');
  });

  it('inglés sin liga: sin fila de insignias y el enlace de siempre (sin parámetro)', () => {
    renderWithIntl(<CatalogTile listing={tile({})} inCart={false} onAdd={vi.fn()} />);
    expect(screen.queryByTestId('tile-version-chips')).toBeNull();
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).toBe('/catalog/c-poffin');
  });

  it('español sin liga: solo «Español»; inglés de liga: solo la insignia de tipo (nunca «Inglés»)', () => {
    const { unmount } = renderWithIntl(
      <CatalogTile listing={tile({ version: { key: 'es', language: 'es', stamp: null }, versionOptionKey: 'es' })} inCart={false} onAdd={vi.fn()} />,
    );
    expect(screen.getByTestId('tile-version-chips').textContent).toBe('Español');
    unmount();
    renderWithIntl(
      <CatalogTile
        listing={tile({ version: { key: 'en.1', language: 'en', stamp: { type: 'staff', label: null, productId: 1 } }, versionOptionKey: 'en.1.normal' })}
        inCart={false}
        onAdd={vi.fn()}
      />,
      'en',
    );
    expect(screen.getByTestId('tile-version-chips').textContent).toBe('Staff');
  });

  it('precio y CTA anclados abajo: el bloque inferior lleva `mt-auto`', () => {
    renderWithIntl(<CatalogTile listing={esCosmos} inCart={false} onAdd={vi.fn()} />);
    expect(screen.getByTestId('tile-price-row').parentElement!.className.split(/\s+/)).toContain('mt-auto');
  });
});
