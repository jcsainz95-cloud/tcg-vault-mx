import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as demand from '@/lib/api/demand';
import { ApiClientError } from '@/lib/api-client';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import { DemandGapsSection } from './DemandGapsSection';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m9',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const T = es.admin.m9.demand;
type Resp = demand.DemandGapsResponse;
const card: demand.DemandGapRowDTO = {
  key: 'c1', kind: 'card', cardId: 'c1', term: null, cardName: 'Charizard ex', setName: 'Obsidian Flames', finish: 'holofoil',
  imageSmallUrl: null, signals: [{ kind: 'wishlist', count: 4, unit: 'clientes', windowDays: null }, { kind: 'search', count: 7, unit: 'personas', windowDays: 30, days: 3 }],
  score: 19, marketCents: null, buylistTodayCents: 70000,
};
const term: demand.DemandGapRowDTO = {
  key: 'term:umbreon', kind: 'term', cardId: null, term: 'umbreon', cardName: 'umbreon', setName: null, finish: null, imageSmallUrl: null,
  signals: [{ kind: 'search', count: 6, unit: 'personas', windowDays: 30, days: 2 }], score: 6, marketCents: null, buylistTodayCents: null,
};
function resp(over: Partial<Resp> = {}): Resp {
  return { generatedAt: new Date().toISOString(), windowDays: 30, totalRows: 2, sources: { wishlist: 'ok', search: 'ok', matchedAt: new Date().toISOString() }, rows: [card, term], ...over };
}

describe('DemandGapsSection (§DEMANDA F1)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fila carta y fila término (sin acciones); null no es $0', async () => {
    vi.spyOn(demand, 'getDemandGaps').mockResolvedValue(resp());
    renderWithProviders(<DemandGapsSection />);
    await screen.findByText('Charizard ex');
    expect(screen.getByTestId('demand-term-row')).toHaveTextContent(T.termBadge);
    expect(screen.getByTestId('demand-term-row').querySelectorAll('button,a')).toHaveLength(0);
    expect(screen.getByTestId('demand-card-row')).not.toHaveTextContent('$0');
    expect(screen.getByTestId('demand-card-row')).toHaveTextContent('700');
    expect(screen.queryByTestId('demand-stale')).toBeNull();
  });

  it('vacío, search apagado, fuente en error y dato viejo', async () => {
    vi.spyOn(demand, 'getDemandGaps').mockResolvedValue(resp({ rows: [], totalRows: 0 }));
    const { unmount } = renderWithProviders(<DemandGapsSection />);
    await screen.findByText(T.empty);
    unmount();
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    vi.spyOn(demand, 'getDemandGaps').mockResolvedValue(resp({ sources: { wishlist: 'error', search: 'off', matchedAt: old } }));
    renderWithProviders(<DemandGapsSection />);
    await screen.findByText(T.searchOff);
    expect(screen.getByText(T.sourceError)).toBeInTheDocument();
    expect(screen.getByTestId('demand-stale')).toHaveTextContent('5');
  });

  it('limit=200; totalRows > filas ⇒ aviso «Mostrando N de M»; plural singular', async () => {
    const one = { ...card, signals: [{ kind: 'wishlist' as const, count: 1, unit: 'clientes' as const, windowDays: null }, { kind: 'search' as const, count: 1, unit: 'personas' as const, windowDays: 30, days: 1 }] };
    const spy = vi.spyOn(demand, 'getDemandGaps').mockResolvedValue(resp({ rows: [one], totalRows: 350 }));
    renderWithProviders(<DemandGapsSection />);
    await screen.findByText(/Mostrando 1 de 350; descarga el CSV/);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
    expect(screen.getByText('1 cliente')).toBeInTheDocument();
    expect(screen.getByText('1 persona')).toBeInTheDocument();
    expect(screen.getByText('1 día')).toBeInTheDocument();
  });

  it('error ⇒ aviso; 403 ⇒ sección oculta', async () => {
    vi.spyOn(demand, 'getDemandGaps').mockRejectedValue(new ApiClientError(500, { code: 'X', message: 'x' }));
    const { unmount } = renderWithProviders(<DemandGapsSection />);
    await screen.findByText(T.loadError, undefined, { timeout: 4000 });
    unmount();
    vi.spyOn(demand, 'getDemandGaps').mockRejectedValue(new ApiClientError(403, { code: 'FORBIDDEN', message: 'x' }));
    renderWithProviders(<DemandGapsSection />);
    await waitFor(() => expect(screen.queryByTestId('demand-gaps')).toBeNull());
  });

  it('paridad i18n es/en de admin.m9.demand', () => {
    const flat = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v as object, `${p}${k}.`) : [`${p}${k}`]));
    expect(flat(en.admin.m9.demand).sort()).toEqual(flat(es.admin.m9.demand).sort());
  });
});
