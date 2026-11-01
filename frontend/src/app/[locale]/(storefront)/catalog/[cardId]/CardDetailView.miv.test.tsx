import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CardDetailView } from './CardDetailView';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingDTO, ListingDTO } from '@/types/contract';

/**
 * §A1 (MKT-26a, D2=A · dueño 2026-10-16 · HECHOS:65) — **la ficha PÚBLICA de carta ya NO pinta
 * «Valor de mercado»**, ni el neto, ni la cifra con IVA, ni el explicador de comparación. Este
 * fichero (antes la suite §MIV, que fijaba que el mercado se pintara CON IVA) se reconvierte en el
 * LOCK de la retirada: antes mordía «la cifra con IVA aparece»; ahora muerde lo contrario —el bloque
 * NO se monta—, con los mismos datos de servidor que antes lo encendían (market + `referenceDisplayCents`),
 * para que un regreso accidental del bloque vuelva a ponerse en rojo.
 *
 * La API sigue entregando `referenceValue` (neto) y `referenceDisplayCents` (con IVA): no cambia el
 * contrato. Lo único que cambia es que la ficha de venta no los renderiza.
 */

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
  id: 'c-miv',
  externalId: 'base1-4',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: ['Stage 2'],
  setId: 'base1',
  setName: 'Base Set',
  setPtcgoCode: null,
  imageSmallUrl: 'https://img.example/s.png',
  imageLargeUrl: 'https://img.example/l.png',
  availableFinishes: ['normal'],
};

const NET = 100000; // MX$1,000.00 de mercado guardado (neto) — jamás debe pintarse
const WITH_IVA = 116000; // mercado CON IVA MX$1,160.00 — jamás debe pintarse en la ficha pública
const PRICE = 133400; // MX$1,334.00 — el PRECIO sí se pinta

const refValue: ListingDTO['referenceValue'] = {
  status: 'priced',
  referenceMxnCents: NET,
  source: 'pokemontcg_io',
  capturedDate: '2026-10-09',
};

function unit(over: Partial<ListingDTO> = {}): ListingDTO {
  return {
    inventoryItemId: 'inv-a',
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    referenceValue: refValue,
    displayPriceCents: PRICE,
    ivaIncluded: true,
    ivaRatePct: 16,
    priceBasis: 'market',
    sellable: true,
    ...over,
  };
}

function grp(over: Partial<GroupedListingDTO> = {}): GroupedListingDTO {
  return {
    representativeInventoryItemId: 'inv-a',
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    displayPriceCents: PRICE,
    ivaIncluded: true,
    ivaRatePct: 16,
    priceBasis: 'market',
    referenceValue: refValue,
    referenceDisplayCents: WITH_IVA,
    currency: 'MXN',
    ...over,
  };
}

function mockDetail(listing: GroupedListingDTO, u: ListingDTO = unit()) {
  vi.spyOn(api, 'getCardDetail').mockResolvedValue({ card, listings: [listing], units: [u] });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('§A1 · la ficha pública de carta NO pinta «Valor de mercado» (ni neto ni con IVA)', () => {
  it('market + `referenceDisplayCents`: ni rótulo, ni cifra de mercado; el PRECIO sí', async () => {
    mockDetail(grp());
    const { container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');

    // El precio de venta se pinta (en la celda y en el renglón de la pieza).
    expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
    expect(screen.getAllByText('MX$1,334.00').length).toBeGreaterThan(0);

    // ⛔ nada de mercado: ni rótulo, ni neto, ni la cifra con IVA, ni grupo accesible.
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.textContent).not.toContain('MX$1,000.00');
    expect(container.textContent).not.toContain('MX$1,160.00');
    expect(screen.queryByRole('group', { name: /Valor de mercado/ })).toBeNull();
  });

  it('gradeada: igual que raw — tampoco pinta el mercado', async () => {
    mockDetail(
      grp({ productType: 'graded', rawCondition: undefined, gradingCompany: 'PSA', gradeValue: '9', gradeKey: 'graded:PSA:9' }),
      unit({ productType: 'graded', rawCondition: undefined, gradingCompany: 'PSA', gradeValue: '9' }),
    );
    const { container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.textContent).not.toContain('MX$1,000.00');
    expect(container.textContent).not.toContain('MX$1,160.00');
  });

  it('en inglés: tampoco «Market value»', async () => {
    mockDetail(grp());
    const { container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'en');
    expect(await screen.findByText('Sale price')).toBeInTheDocument();
    expect(screen.queryByText('Market value')).toBeNull();
    expect(screen.queryByRole('group', { name: /Market value/ })).toBeNull();
    expect(container.textContent).not.toContain('MX$1,160.00');
  });

  it('floor / override: igual (el mercado nunca estuvo y sigue sin estar)', async () => {
    for (const basis of ['floor', 'override'] as const) {
      vi.restoreAllMocks();
      mockDetail(grp({ priceBasis: basis }), unit({ priceBasis: basis }));
      const { unmount, container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
      expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
      expect(screen.queryByText('Valor de mercado'), `priceBasis=${basis}`).toBeNull();
      expect(container.textContent).not.toContain('MX$1,160.00');
      unmount();
    }
  });

  it('la nota al pie NUNCA es el explicador de comparación «…para que los compares tal cual»', async () => {
    mockDetail(grp());
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    await screen.findByText('Precio de venta');
    // MKT-CONV.2 (B6b): la frase de sistema se retiró de la ficha; y jamás `referenceExplainerWithMarket`.
    expect(screen.queryByText('El precio de venta es el precio publicado de esta carta.')).toBeNull();
    expect(screen.queryByText(/para que los compares tal cual/i)).toBeNull();
    expect(screen.queryByText(/valor de mercado es la referencia del día/i)).toBeNull();
  });
});
