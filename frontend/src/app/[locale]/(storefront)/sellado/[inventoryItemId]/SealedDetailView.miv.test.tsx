import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedDetailView } from './SealedDetailView';
import * as api from '@/lib/api';
import { mockSealedGroups } from '@/lib/mock/fixtures';
import type { ListingDTO, SealedGroupDTO, SealedValueHistoryResponse } from '@/types/contract';

/**
 * §MIV (v1.90⟨miv⟩) · MIV-F4 — F1–F3 en la ficha de sellado. Mercado neto 200,000 (MX$2,000.00) ⇒ el
 * servidor manda `referenceDisplayCents` 232,000 (MX$2,320.00, criterio 861). Las cifras las inyecta el
 * test como servidor: ⛔ la pantalla no calcula.
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

function group(over: Partial<SealedGroupDTO> = {}): SealedGroupDTO {
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

function listings(g: SealedGroupDTO): ListingDTO[] {
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

function mockDetail(g: SealedGroupDTO, trendEnabled = false) {
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

describe('MIV-F4 · ficha de sellado', () => {
  it('F1: market + display ⇒ «MX$2,320.00» con su rótulo de IVA; ⛔ el neto «MX$2,000.00»', async () => {
    mockDetail(group());
    const { container } = renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText('Valor de mercado')).toBeInTheDocument();
    expect(screen.getByText('MX$2,320.00')).toBeInTheDocument();
    expect(screen.getByText('MX$2,668.00')).toBeInTheDocument();
    expect(container.textContent).not.toContain('MX$2,000.00');
    // vMIV-2 (MIV-UX-1): el PRECIO («Desde») conserva su tasa; el MERCADO dice «incluye IVA» (sin tasa).
    expect(screen.getAllByTestId('iva-label').map((n) => n.textContent)).toEqual([
      'IVA 16 % incluido',
      'incluye IVA',
    ]);
  });

  it('F8/UX-2 (vMIV-2): grupo accesible «Valor de mercado MX$2,320.00 incluye IVA» y orden cifra → IVA → fecha', async () => {
    mockDetail(group());
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    const g = await screen.findByRole('group', { name: 'Valor de mercado MX$2,320.00 incluye IVA' });
    expect(g.getAttribute('aria-label')).toBeNull();
    const text = g.textContent ?? '';
    expect(text.indexOf('MX$2,320.00')).toBeLessThan(text.indexOf('incluye IVA'));
    expect(text.indexOf('incluye IVA')).toBeLessThan(text.search(/9 oct/i));
    // ⛔ MIV-UX-3: el rótulo de mercado no lleva la tasa.
    expect(within(g).getByTestId('iva-label').textContent).not.toMatch(/16 %/);
    expect(within(g).getByTestId('iva-label').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('F8/UX-2 en inglés (vMIV-2)', async () => {
    mockDetail(group());
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'en');
    expect(
      await screen.findByRole('group', { name: 'Market value MX$2,320.00 VAT included' }),
    ).toBeInTheDocument();
  });

  it('F2: market SIN display ⇒ ni bloque, ni rótulo extra, ni «—», ni el neto; «Desde» a fila completa', async () => {
    const { referenceDisplayCents: _drop, ...noDisplay } = group();
    mockDetail(noDisplay as SealedGroupDTO);
    const { container } = renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(container.textContent).not.toContain('MX$2,000.00');
    expect(screen.getAllByTestId('iva-label')).toHaveLength(1);
    expect(cells()).toHaveLength(1);
    expect(cells()[0].className).toContain('sm:col-span-2');
  });

  it('F2: sin display tampoco se monta la TENDENCIA (mismo predicado, §MIV.3)', async () => {
    const { referenceDisplayCents: _drop, ...noDisplay } = group();
    mockDetail(noDisplay as SealedGroupDTO, true);
    const trend = vi.spyOn(api, 'getSealedValueHistory');
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Tendencia de valor')).toBeNull();
    expect(trend).not.toHaveBeenCalled();
  });

  it('F3: override con display presente (servidor erróneo) ⇒ sin bloque, sin cifra', async () => {
    mockDetail(group({ priceBasis: 'override', priceSource: 'override' }), true);
    const { container } = renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.innerHTML).not.toContain('MX$2,320.00');
    expect(screen.getAllByTestId('iva-label')).toHaveLength(1);
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
