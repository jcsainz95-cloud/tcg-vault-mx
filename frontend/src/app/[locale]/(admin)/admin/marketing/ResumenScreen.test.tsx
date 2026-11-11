/**
 * Pestaña «Resumen» (§MKT-V2): 8 cifras con flecha, avisos con sus números, gráfica diaria SOLO con `privacy: 'exact'`,
 * y los candados de §6.10 (abre en la última semana cerrada, ofrece la más reciente) y §6.6 (sin el aviso viejo de SC).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { renderWithProviders } from '@/test/render';
import type { MarketingAggTable, MarketingPeriodsResponse, MarketingScreenPayload } from '@/types/contract';
import { parseMktUrl, mktSearch } from './url-state';
import { deltaKindOf, ResumenScreen } from './ResumenScreen';

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/marketing',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));
const api = vi.hoisted(() => ({
  getMarketingPeriods: vi.fn(),
  getMarketingPanel: vi.fn(),
  downloadMarketingWeeklyExcel: vi.fn(),
  exportMarketingScreen: vi.fn(),
  listMarketingAnnotations: vi.fn(),
  listMarketingTokens: vi.fn(),
}));
vi.mock('@/lib/marketing-api', () => api);
// eslint-disable-next-line import/first
import { MarketingView } from './MarketingView';

const R1: MarketingAggTable = {
  id: 'r1',
  title: 'Cifras de la semana',
  source: 'mixed',
  columns: [
    { key: 'cifra', labelEs: 'Cifra', kind: 'text' },
    { key: 'actual', labelEs: 'Actual', kind: 'number' },
    { key: 'anterior', labelEs: 'Anterior', kind: 'number' },
    { key: 'delta_abs', labelEs: 'Cambio', kind: 'number' },
    { key: 'delta_pct', labelEs: 'Cambio %', kind: 'pct' },
  ],
  rows: [
    { cifra: 'Fichas vistas', actual: 60, anterior: 40, delta_abs: 20, delta_pct: 50 },
    { cifra: 'Inicios de pago', actual: 3, anterior: 8, delta_abs: -5, delta_pct: -62.5 },
    { cifra: 'Clics en Google', actual: 9, anterior: 0, delta_abs: 9, delta_pct: null },
    { cifra: 'Agregados al carrito', actual: 2, anterior: 3, delta_abs: -1, delta_pct: -33 },
    { cifra: 'Visitantes reales', actual: 'NO MEDIDO — GA4 sin conectar', anterior: null, delta_abs: null, delta_pct: null },
    { cifra: 'Sesiones desde Instagram', actual: '< 5', anterior: '< 5', delta_abs: null, delta_pct: null },
  ],
  measured: true,
};
const R2: MarketingAggTable = {
  id: 'r2',
  title: 'Qué hacer esta semana',
  source: 'mixed',
  columns: [
    { key: 'regla', labelEs: 'Regla', kind: 'text' },
    { key: 'gravedad', labelEs: 'Gravedad', kind: 'text' },
    { key: 'titulo', labelEs: 'Aviso', kind: 'text' },
    { key: 'evidencia', labelEs: 'Evidencia', kind: 'text' },
    { key: 'accion', labelEs: 'Qué hacer', kind: 'text' },
  ],
  rows: [{ regla: 'AV1', gravedad: 'alta', titulo: 'Nadie pagó', evidencia: '7 inicios de pago, 0 pedidos', accion: 'Prueba el pago tú mismo.' }],
  measured: true,
};
const R3: MarketingAggTable = {
  id: 'r3',
  title: 'Día por día',
  source: 'GA4',
  columns: [
    { key: 'dia', labelEs: 'Día', kind: 'text' },
    { key: 'nuevos', labelEs: 'Nuevos', kind: 'count' },
    { key: 'recurrentes', labelEs: 'Recurrentes', kind: 'count' },
  ],
  rows: [{ dia: '2026-11-02', nuevos: 3, recurrentes: 1 }],
  measured: true,
};

function payload(privacy: 'exact' | 'small_cells', tables: MarketingAggTable[]): MarketingScreenPayload {
  return {
    screen: 'r',
    period: { kind: 'week', from: '2026-11-02', to: '2026-11-08', label: 'x', timezone: 'America/Mexico_City' },
    sourceLegend: {},
    tables,
    annotations: [],
    privacy,
  };
}

const PERIODS: MarketingPeriodsResponse = {
  timezone: 'America/Mexico_City',
  lastClosedWeek: { weekStart: '2026-11-02', from: '2026-11-02', to: '2026-11-08' },
  closedWeeks: [
    { weekStart: '2026-11-02', from: '2026-11-02', to: '2026-11-08' },
    { weekStart: '2026-10-26', from: '2026-10-26', to: '2026-11-01' },
  ],
  closedMonths: [{ month: '2026-10', from: '2026-10-01', to: '2026-10-31' }],
};

describe('deltaKindOf', () => {
  it('flecha por el signo del servidor, «nuevo» si antes era 0, ruido si ambos < 5, nada si no hay números', () => {
    const k = (i: number) => deltaKindOf(R1.rows[i]);
    expect(k(0)).toBe('up');
    expect(k(1)).toBe('down'); // 3 vs 8: la anterior ≥ 5 ⇒ no es ruido
    expect(k(2)).toBe('new');
    expect(k(3)).toBe('noise'); // 2 vs 3
    expect(k(4)).toBe('none'); // NO MEDIDO
    expect(k(5)).toBe('none'); // '< 5'
  });

  it('delta_abs null con números (neutro del servidor) ⇒ «≈», nunca se recalcula', () => {
    expect(deltaKindOf({ cifra: 'Ventas', actual: 1200, anterior: 600, delta_abs: null, delta_pct: null })).toBe('noise');
    expect(deltaKindOf({ cifra: 'Ventas', actual: 600, anterior: 1200, delta_abs: null, delta_pct: null })).toBe('noise');
    expect(deltaKindOf({ cifra: 'Ventas', actual: 1200, anterior: 600, delta_abs: 600, delta_pct: 100 })).toBe('up');
  });
});

describe('ResumenScreen', () => {
  it('pinta las cifras con flecha, el aviso con sus números y el NO MEDIDO literal; sin r3 en small_cells', () => {
    renderWithProviders(<ResumenScreen data={payload('small_cells', [R1, R2, R3])} />);
    const figs = screen.getAllByTestId('mkt-figure');
    expect(figs).toHaveLength(6);
    expect(within(figs[0]).getByText('Fichas vistas')).toBeInTheDocument();
    expect(figs[0].querySelector('[data-delta="up"]')).not.toBeNull();
    expect(figs[1].querySelector('[data-delta="down"]')).not.toBeNull();
    expect(figs[2].querySelector('[data-delta="new"]')).not.toBeNull();
    expect(figs[3].querySelector('[data-delta="noise"]')).not.toBeNull();
    expect(figs[4]).toHaveTextContent('GA4 sin conectar');
    expect(screen.getByTestId('mkt-r2')).toHaveTextContent('7 inicios de pago, 0 pedidos');
    expect(screen.getByTestId('mkt-r2')).toHaveTextContent('Prioridad alta');
    // Aunque r3 llegara por error, sin régimen exacto no se pinta.
    expect(screen.queryByTestId('mkt-r3')).toBeNull();
  });

  it('con exact y r3: título, nota «Solo visible para ti» y la tabla alternativa', () => {
    renderWithProviders(<ResumenScreen data={payload('exact', [R1, R2, R3])} />);
    expect(screen.getByTestId('mkt-r3')).toBeInTheDocument();
    expect(screen.getByTestId('mkt-r3-private')).toHaveTextContent('Solo visible para ti');
    expect(screen.getByTestId('mkt-r3-charts')).toBeInTheDocument();
  });

  it('AV7 (§GSHOP): el aviso de indexación llega como texto del servidor y se pinta sin claves nuevas, también en inglés', () => {
    const av7 = {
      regla: 'AV7',
      gravedad: 'info',
      titulo: 'No se evaluó la indexación: sin permiso de Search Console',
      evidencia: '',
      accion: 'Da permiso de lectura a la cuenta en Search Console.',
    };
    for (const loc of ['es', 'en'] as const) {
      const { unmount } = renderWithProviders(
        <ResumenScreen data={payload('small_cells', [R1, { ...R2, rows: [av7] }])} />,
        loc,
      );
      const box = screen.getByTestId('mkt-r2');
      expect(box).toHaveTextContent('No se evaluó la indexación: sin permiso de Search Console');
      expect(box.querySelector('ul')?.getAttribute('lang')).toBe(loc === 'es' ? null : 'es');
      unmount();
    }
  });

  it('sin avisos: «Sin avisos esta semana»', () => {
    renderWithProviders(<ResumenScreen data={payload('small_cells', [R1, { ...R2, rows: [] }])} />);
    expect(screen.getByTestId('mkt-r2')).toHaveTextContent('Sin avisos esta semana');
  });

  it('en inglés: rótulos propios traducidos', () => {
    renderWithProviders(<ResumenScreen data={payload('exact', [R1, R2, R3])} />, 'en');
    expect(screen.getByText("This week's numbers")).toBeInTheDocument();
    expect(screen.getByText('Only visible to you')).toBeInTheDocument();
  });
});

describe('url-state de Resumen', () => {
  it('sin pantalla ⇒ r; r no se escribe en la URL', () => {
    expect(parseMktUrl({}).view).toBe('r');
    expect(mktSearch({ view: 'r', kind: 'week', week: null, month: null })).toBe('');
    expect(mktSearch({ view: 'a', kind: 'week', week: null, month: null })).toBe('?pantalla=a');
  });
});

describe('MarketingView · Resumen (§6.10 y §6.6)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/es/admin/marketing');
    api.getMarketingPeriods.mockResolvedValue(PERIODS);
    api.getMarketingPanel.mockImplementation(async (s: string) => ({ ...payload('exact', [R1, R2, R3]), screen: s }));
    api.listMarketingAnnotations.mockResolvedValue([]);
    api.listMarketingTokens.mockResolvedValue({ items: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it('abre en Resumen y en la última semana cerrada aunque la URL traiga un ?week= viejo', async () => {
    renderWithProviders(<MarketingView initial={parseMktUrl({ week: '2026-W44' })} />);
    await waitFor(() => expect(api.getMarketingPanel).toHaveBeenCalled());
    for (const call of api.getMarketingPanel.mock.calls) expect(call).toEqual(['r', { weekStart: '2026-11-02' }]);
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('mkt-newer-week')).toBeNull();
    expect(await screen.findByTestId('mkt-resumen')).toBeInTheDocument();
  });

  it('si la semana explícita ya no es la más reciente, ofrece un clic para saltar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MarketingView initial={parseMktUrl({})} />);
    await screen.findByTestId('mkt-resumen');
    await user.selectOptions(screen.getByTestId('mkt-period-select'), '2026-W44');
    expect(await screen.findByTestId('mkt-newer-week')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver la más reciente' }));
    await waitFor(() => expect(screen.queryByTestId('mkt-newer-week')).toBeNull());
  });

  it('la pantalla «Buscadores e IA» ya no lleva el aviso viejo de Search Console', async () => {
    renderWithProviders(<MarketingView initial={parseMktUrl({ pantalla: 'e' })} />);
    await screen.findByTestId('mkt-screen-e');
    expect(screen.queryByText(/se llenará cuando se encienda/i)).toBeNull();
  });
});
