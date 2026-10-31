import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedDetailView } from './SealedDetailView';
import * as api from '@/lib/api';
import { mockSealedGroups, type PricedSealedGroupDTO } from '@/lib/mock/fixtures';
import type { ListingDTO, SealedValueHistoryResponse } from '@/types/contract';

/**
 * §A1 (MKT-26a, D2=A · dueño 2026-10-16 · HECHOS:65) — **la ficha PÚBLICA de sellado ya NO pinta la
 * celda «Valor de mercado»**, ni el neto ni la cifra con IVA. Este fichero (antes la suite §MIV-F4)
 * se reconvierte en el LOCK de la retirada de la CELDA: con los mismos datos de servidor que antes la
 * encendían (market + `referenceDisplayCents`), la celda NO debe montarse.
 *
 * La «Tendencia de valor» (gateada por `trendEnabled`, §MIV.3) **no es parte de A1 y sigue**: sus dos
 * tests se conservan intactos, porque siguen obedeciendo el mismo predicado de mercado.
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

const BASE = mockSealedGroups[0];

function group(over: Partial<PricedSealedGroupDTO> = {}): PricedSealedGroupDTO {
  return {
    ...BASE,
    fromPriceCents: 266800,
    ivaIncluded: true,
    ivaRatePct: 16,
    priceSource: 'subtype_spread',
    priceBasis: 'market',
    referenceValue: { status: 'priced', referenceMxnCents: 200000, source: 'tcgcsv', capturedDate: '2026-10-09' },
    referenceDisplayCents: 232000,
    ...over,
  };
}

function listings(g: PricedSealedGroupDTO): ListingDTO[] {
  return [
    {
      inventoryItemId: 'inv-s1',
      card: g.card,
      productType: 'sealed',
      sealedSubtype: g.sealedSubtype ?? undefined,
      sealedCondition: g.sealedCondition,
      finish: 'normal',
      referenceValue: g.referenceValue,
      priceBasis: g.priceBasis,
      displayPriceCents: g.fromPriceCents,
      ivaIncluded: true,
      ivaRatePct: g.ivaRatePct,
      sellable: true,
    },
  ];
}

function mockDetail(g: PricedSealedGroupDTO, trendEnabled = false) {
  vi.spyOn(api, 'getSealedGroupDetail').mockResolvedValue({
    group: g,
    listings: listings(g),
    trendEnabled,
    restockEnabled: false,
  });
}

const cells = () => Array.from(document.querySelectorAll('div.border-b.border-border.py-6')) as HTMLElement[];

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('§A1 · la ficha pública de sellado NO pinta la celda «Valor de mercado»', () => {
  it('market + display: ni rótulo, ni neto, ni cifra con IVA; «Desde» a fila completa con su rótulo de IVA', async () => {
    mockDetail(group());
    const { container } = renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.getAllByText('MX$2,668.00').length).toBeGreaterThan(0); // el PRECIO «desde» sí
    // ⛔ nada de mercado: ni rótulo, ni neto (MX$2,000.00), ni la cifra con IVA (MX$2,320.00).
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.textContent).not.toContain('MX$2,000.00');
    expect(container.textContent).not.toContain('MX$2,320.00');
    expect(screen.queryByRole('group', { name: /Valor de mercado/ })).toBeNull();
    // Una sola celda de dinero, a fila completa.
    expect(cells()).toHaveLength(1);
    expect(cells()[0].className).toContain('sm:col-span-2');
  });

  it('en inglés: tampoco «Market value»', async () => {
    mockDetail(group());
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'en');
    expect(await screen.findByText('From')).toBeInTheDocument();
    expect(screen.queryByText('Market value')).toBeNull();
    expect(screen.queryByRole('group', { name: /Market value/ })).toBeNull();
  });

  it('override (o market sin display): igual — una sola celda, sin cifra de mercado', async () => {
    mockDetail(group({ priceBasis: 'override', priceSource: 'override' }), true);
    const { container } = renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.textContent).not.toContain('MX$2,320.00');
    expect(cells()).toHaveLength(1);
    expect(cells()[0].className).toContain('sm:col-span-2');
  });

  it('market sin display: tampoco cifra, «Desde» a fila completa', async () => {
    const { referenceDisplayCents: _drop, ...noDisplay } = group();
    mockDetail(noDisplay as PricedSealedGroupDTO);
    const { container } = renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.textContent).not.toContain('MX$2,000.00');
    expect(cells()).toHaveLength(1);
    expect(cells()[0].className).toContain('sm:col-span-2');
  });
});

/**
 * La «Tendencia de valor» NO es A1: sigue viva y sigue obedeciendo el predicado de mercado (§MIV.3).
 * Estos dos tests se conservan de la suite §MIV original (seguían verdes tras A1).
 */
describe('Tendencia de valor del sellado (fuera de A1 · §MIV.3)', () => {
  it('sin display no se monta la TENDENCIA (mismo predicado de mercado)', async () => {
    const { referenceDisplayCents: _drop, ...noDisplay } = group();
    mockDetail(noDisplay as PricedSealedGroupDTO, true);
    const trend = vi.spyOn(api, 'getSealedValueHistory');
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Tendencia de valor')).toBeNull();
    expect(trend).not.toHaveBeenCalled();
  });

  it('la tendencia rotula «incluye IVA» (vMIV-2: sin tasa, sea cual sea `ivaRatePct` del grupo)', async () => {
    mockDetail(group({ ivaRatePct: 8, referenceDisplayCents: 216000 }), true);
    const history: SealedValueHistoryResponse = {
      product: { inventoryItemId: 'inv-1008' },
      range: '1m',
      points: [
        { date: '2026-10-08', valueMxnCents: 190000, displayValueMxnCents: 205200, pricedCardCount: 1 },
        { date: '2026-10-09', valueMxnCents: 200000, displayValueMxnCents: 216000, pricedCardCount: 1 },
      ],
      change: { absMxnCents: 10000, pct: 5.26, direction: 'up', displayAbsMxnCents: 10800 },
    };
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(history);
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    expect(await screen.findByRole('group', { name: 'MX$2,160.00 incluye IVA' })).toBeInTheDocument();
  });
});
