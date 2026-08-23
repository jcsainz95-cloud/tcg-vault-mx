import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { GradedEstimateDTO, GroupedListingDTO } from '@/types/contract';
import { GradingGemsShelf } from './GradingGemsShelf';
import { GradingFootnoteBoundary } from '../_shared/grading/GradingFootnote';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const psa10: GradedEstimateDTO = {
  gradingCompany: 'PSA',
  gradeValue: '10',
  gradeKey: 'graded:PSA:10',
  estimate: { status: 'priced', referenceMxnCents: 290_000, capturedDate: '2026-08-22' },
};

const gem = (id: string): GroupedListingDTO => ({
  representativeInventoryItemId: id,
  card: {
    id: `c-${id}`,
    externalId: `base1-${id}`,
    name: `Card ${id}`,
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: 'https://img.example/s.png',
    imageLargeUrl: 'https://img.example/l.png',
    availableFinishes: ['normal'],
  },
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  gradeKey: 'raw:NM',
  stockCount: 1,
  salePriceCents: 140800,
  referenceValue: { status: 'priced', referenceMxnCents: 128000, capturedDate: '2026-08-13' },
  currency: 'MXN',
  gradingHighlight: [psa10],
});

function mockGems(data: GroupedListingDTO[]) {
  return vi
    .spyOn(api, 'getCatalog')
    .mockResolvedValue({ data, page: 1, pageSize: 8, total: data.length });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('GradingGemsShelf · §21.6 vitrina «Joyas para gradear»', () => {
  it('pide al servidor la lista YA CURADA Y ORDENADA (?gradingHighlight=true&sort=grading_showcase&pageSize=8)', async () => {
    const spy = mockGems([gem('inv-a')]);
    renderWithProviders(
      <GradingFootnoteBoundary active>
        <GradingGemsShelf />
      </GradingFootnoteBoundary>,
      'es',
    );

    await screen.findByText('Joyas para gradear');
    expect(spy).toHaveBeenCalledWith({
      gradingHighlight: true,
      sort: 'grading_showcase',
      pageSize: 8,
    });
  });

  it('el encabezado gasta el kicker en la salvedad y el subtítulo NO nombra el criterio de selección (R5)', async () => {
    mockGems([gem('inv-a')]);
    renderWithProviders(
      <GradingFootnoteBoundary active>
        <GradingGemsShelf />
      </GradingFootnoteBoundary>,
      'es',
    );

    expect(await screen.findByText('ILUSTRATIVO · NO EVALUAMOS LA PIEZA')).toBeInTheDocument();
    const subtitle = screen.getByText(/Cartas sin gradear/);
    expect(subtitle.textContent).not.toMatch(/margen|ROI|vale la pena|ganancia|inversión|garantiz/i);
    // Cada entrada es la teja de Compra CON su badge y su MICRO-AVISO visible, sin variación: el
    // kicker es refuerzo, NO sustituye al aviso de ninguna teja (§21.6 / R3.1).
    expect(screen.getByText(/no evaluamos esta carta/i)).toBeInTheDocument();
  });

  it('sin cartas elegibles la vitrina COMPLETA no existe (ni encabezado, ni kicker, ni regla)', async () => {
    mockGems([]);
    const { container } = renderWithProviders(<GradingGemsShelf />, 'es');

    // Se espera a que la query resuelva; el estado de carga tampoco pinta nada (sin skeleton).
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Joyas para gradear')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('carga sin skeleton (excepción ratificada a §8.1): no reserva espacio para una promesa que puede no existir', () => {
    mockGems([gem('inv-a')]);
    const { container } = renderWithProviders(<GradingGemsShelf />, 'es');
    // Render síncrono inicial = la query aún no resolvió ⇒ NADA en el DOM.
    expect(container).toBeEmptyDOMElement();
  });

  it('sin «Ver todas» mientras el contrato no exponga una vista de Compra filtrada por elegibles', async () => {
    mockGems([gem('inv-a')]);
    renderWithProviders(
      <GradingFootnoteBoundary active>
        <GradingGemsShelf />
      </GradingFootnoteBoundary>,
      'es',
    );

    await screen.findByText('Joyas para gradear');
    expect(screen.queryByRole('link', { name: /ver todas/i })).not.toBeInTheDocument();
  });
});
