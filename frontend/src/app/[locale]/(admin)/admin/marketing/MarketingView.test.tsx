/**
 * Candados de la pantalla `/admin/marketing` (`DESIGN_SYSTEM §MKT-UX.16`): UX-MKT-7 (URL inválida no viaja), -8 (solo
 * periodos cerrados del servidor), -9 (rótulo y cifras viejos mientras carga), -10 (403 sin controles ni más
 * peticiones; menú), -11 (pestañas APG + Select en móvil), -15 (descarga por fetch), -17 (acceso solo súper-admin),
 * más el aviso del régimen exacto junto a las descargas. Se mockea el cliente (`@/lib/marketing-api`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import type { MarketingPeriodsResponse, MarketingScreenPayload } from '@/types/contract';
import { parseMktUrl } from './url-state';

const role = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: role.isSuperAdmin ? 'super_admin' : 'vault_operator',
    setRole: () => {},
    isSuperAdmin: role.isSuperAdmin,
    canSwitchRole: false,
  }),
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
  createMarketingAnnotation: vi.fn(),
  updateMarketingAnnotation: vi.fn(),
  deleteMarketingAnnotation: vi.fn(),
  listMarketingTokens: vi.fn(),
  issueMarketingToken: vi.fn(),
  revokeMarketingToken: vi.fn(),
}));
vi.mock('@/lib/marketing-api', () => api);

// eslint-disable-next-line import/first
import { MarketingView } from './MarketingView';
// eslint-disable-next-line import/first
import { AdminSidebar } from '@/components/layout/AdminSidebar';

const PERIODS: MarketingPeriodsResponse = {
  timezone: 'America/Mexico_City',
  lastClosedWeek: { weekStart: '2026-10-05', from: '2026-10-05', to: '2026-10-11' },
  closedWeeks: [
    { weekStart: '2026-10-05', from: '2026-10-05', to: '2026-10-11' },
    { weekStart: '2026-09-28', from: '2026-09-28', to: '2026-10-04' },
  ],
  closedMonths: [
    { month: '2026-09', from: '2026-09-01', to: '2026-09-30' },
    { month: '2026-08', from: '2026-08-01', to: '2026-08-31' },
  ],
};

function payload(from: string, to: string, over: Partial<MarketingScreenPayload> = {}): MarketingScreenPayload {
  return {
    screen: 'a',
    period: { kind: 'week', from, to, label: from, timezone: 'America/Mexico_City' },
    sourceLegend: {},
    tables: [
      {
        id: 'a1',
        title: 'Ventas',
        source: 'BD',
        columns: [
          { key: 'p', labelEs: 'Periodo', kind: 'text' },
          { key: 'n', labelEs: 'Pedidos', kind: 'count' },
        ],
        rows: [{ p: 'Periodo actual', n: from === '2026-10-05' ? 11 : 22 }],
        measured: true,
      },
    ],
    annotations: [],
    privacy: 'small_cells',
    ...over,
  };
}

const forbidden = () => new ApiClientError(403, { code: 'FORBIDDEN', message: 'Forbidden' });

beforeEach(() => {
  role.isSuperAdmin = true;
  window.history.replaceState(null, '', '/es/admin/marketing');
  api.getMarketingPeriods.mockResolvedValue(PERIODS);
  api.getMarketingPanel.mockImplementation(async (_s: string, q: { weekStart?: string }) =>
    q.weekStart === '2026-09-28' ? payload('2026-09-28', '2026-10-04') : payload('2026-10-05', '2026-10-11'),
  );
  api.downloadMarketingWeeklyExcel.mockResolvedValue({ blob: new Blob(['x']), filename: 'tcghunt_semana_2026-10-05_2026-10-11_corte-20261018-1200.xlsx' });
  api.exportMarketingScreen.mockResolvedValue({ blob: new Blob(['x']), filename: 'tcghunt_a.csv' });
  api.listMarketingAnnotations.mockResolvedValue([]);
  api.listMarketingTokens.mockResolvedValue({ items: [] });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.clearAllMocks());

const view = (q: Record<string, string> = {}, locale: 'es' | 'en' = 'es') =>
  renderWithProviders(<MarketingView initial={parseMktUrl(q)} />, locale);

describe('UX-MKT-7 · la URL inválida no viaja al servidor', () => {
  it('pantalla/semana/mes fuera de dominio se ignoran al parsear', () => {
    expect(parseMktUrl({ pantalla: 'zz', week: 'banana', month: '2026-13' })).toEqual({ view: 'a', kind: 'week', week: null, month: null });
    expect(parseMktUrl({ pantalla: 'acceso', periodo: 'mes', month: '2026-09' })).toEqual({ view: 'acceso', kind: 'month', week: null, month: '2026-09' });
  });

  it('una semana bien formada pero no cerrada (no está en la lista del servidor) ⇒ se pide la última cerrada', async () => {
    view({ week: '2030-W01', pantalla: 'q' });
    await screen.findByText('Periodo actual', { selector: '[data-cell]' }).catch(() => null);
    await waitFor(() => expect(api.getMarketingPanel).toHaveBeenCalled());
    for (const call of api.getMarketingPanel.mock.calls) expect(call).toEqual(['a', { weekStart: '2026-10-05' }]);
    expect(JSON.stringify(api.getMarketingPanel.mock.calls)).not.toMatch(/2030|q"/);
  });

  it('una semana de la lista (por su semana ISO) se respeta', async () => {
    view({ week: '2026-W40' });
    await waitFor(() => expect(api.getMarketingPanel).toHaveBeenCalledWith('a', { weekStart: '2026-09-28' }));
  });
});

describe('UX-MKT-8 · solo periodos cerrados, sin rango libre', () => {
  it('el selector ofrece exactamente la lista del servidor y la página no tiene campos de fecha', async () => {
    view();
    const select = (await screen.findByTestId('mkt-period-select')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['2026-W41', '2026-W40']);
    expect(select.options[0].textContent).toBe('Lun 5 – dom 11 oct 2026');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mes' }));
    await waitFor(() => expect(Array.from((screen.getByTestId('mkt-period-select') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['2026-09', '2026-08']));
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
});

describe('UX-MKT-9 · mientras carga un periodo, rótulo y cifras son los VIEJOS', () => {
  it('cambiar de semana deja el rótulo y la tabla anteriores (atenuados, «Actualizando…») hasta que llegan los nuevos', async () => {
    let release: (p: MarketingScreenPayload) => void = () => {};
    view();
    await screen.findByTestId('mkt-screen-a');
    expect(screen.getByTestId('mkt-period-label')).toHaveTextContent('Del 5 oct 2026 al 11 oct 2026');
    api.getMarketingPanel.mockImplementationOnce(() => new Promise<MarketingScreenPayload>((r) => (release = r)));
    fireEvent.change(screen.getByTestId('mkt-period-select'), { target: { value: '2026-W40' } });
    await screen.findByTestId('mkt-updating');
    expect(screen.getByTestId('mkt-period-label')).toHaveTextContent('Del 5 oct 2026 al 11 oct 2026');
    expect(screen.getByTestId('mkt-screen-a').dataset.periodFrom).toBe('2026-10-05');
    release(payload('2026-09-28', '2026-10-04'));
    await waitFor(() => expect(screen.getByTestId('mkt-period-label')).toHaveTextContent('Del 28 sep 2026 al 4 oct 2026'));
    expect(screen.getByTestId('mkt-screen-a').dataset.periodFrom).toBe('2026-09-28');
    expect(screen.queryByTestId('mkt-updating')).toBeNull();
  });
});

describe('UX-MKT-10 · 403 sin permiso', () => {
  it('403 en los periodos ⇒ solo el h1 y el mensaje neutro; sin pestañas, selector ni botones; sin pedir datos', async () => {
    api.getMarketingPeriods.mockRejectedValue(forbidden());
    view();
    const box = await screen.findByTestId('mkt-forbidden');
    expect(within(box).getByRole('heading', { level: 2 })).toHaveTextContent('Esta cuenta no tiene permiso para ver el Panel de Marketing.');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Volver al tablero' })).toHaveAttribute('href', '/admin');
    expect(api.getMarketingPanel).not.toHaveBeenCalled();
    expect(api.getMarketingPeriods).toHaveBeenCalledTimes(1);
  });

  it('403 a media sesión (en una descarga) descarta lo que había en pantalla', async () => {
    api.downloadMarketingWeeklyExcel.mockRejectedValue(forbidden());
    view();
    await screen.findByTestId('mkt-screen-a');
    await userEvent.setup().click(screen.getByTestId('mkt-download-weekly'));
    await screen.findByTestId('mkt-forbidden');
    expect(screen.queryByTestId('mkt-screen-a')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('el menú no pinta «Marketing» sin súper-admin, y sí con él', () => {
    role.isSuperAdmin = false;
    const { unmount } = renderWithProviders(<AdminSidebar />, 'es');
    expect(screen.queryByRole('link', { name: /Marketing/ })).toBeNull();
    unmount();
    role.isSuperAdmin = true;
    renderWithProviders(<AdminSidebar />, 'es');
    expect(screen.getByRole('link', { name: /Marketing/ })).toHaveAttribute('href', '/admin/marketing');
  });
});

describe('UX-MKT-11 · pestañas APG y Select en móvil', () => {
  it('role=tab + aria-selected; flechas, Home y End mueven la selección y el foco', async () => {
    view();
    await screen.findByTestId('mkt-screen-a');
    const list = screen.getByTestId('mkt-tablist');
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Resumen', 'Origen', 'Comportamiento', 'Catálogo', 'Buscadores e IA', 'Cookies', 'Promociones', 'Anotaciones', 'Acceso del analista',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(within(list).getByRole('tab', { name: 'Origen' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(within(list).getByRole('tab', { name: 'Origen' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(within(list).getByRole('tab', { name: 'Acceso del analista' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(within(list).getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(api.getMarketingPanel).toHaveBeenCalledWith('b', { weekStart: '2026-10-05' }));
  });

  it('< md: un Select con label «Pantalla» y el tablist oculto por CSS (display:none fuera de md)', () => {
    view();
    expect(screen.getByTestId('mkt-tablist').className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByTestId('mkt-tablist').className).toMatch(/md:flex/);
    const wrap = screen.getByTestId('mkt-screen-select');
    expect(wrap.className).toMatch(/md:hidden/);
    const sel = within(wrap).getByLabelText('Pantalla') as HTMLSelectElement;
    expect(sel.options).toHaveLength(9);
    fireEvent.change(sel, { target: { value: 'h' } });
    expect(within(screen.getByTestId('mkt-tablist')).getByRole('tab', { name: 'Anotaciones' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('UX-MKT-15 · descarga con fetch + blob', () => {
  it('loading deshabilita los botones; éxito anuncia el archivo; el blob se guarda con el nombre del servidor', async () => {
    let release: (v: { blob: Blob; filename: string }) => void = () => {};
    api.downloadMarketingWeeklyExcel.mockImplementationOnce(() => new Promise((r) => (release = r)));
    view();
    await screen.findByTestId('mkt-screen-a');
    const btn = screen.getByTestId('mkt-download-weekly');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveTextContent('Preparando el Excel…');
    expect(screen.getByTestId('mkt-export-xlsx')).toBeDisabled();
    expect(api.downloadMarketingWeeklyExcel).toHaveBeenCalledWith({ weekStart: '2026-10-05' });
    release({ blob: new Blob(['x']), filename: 'tcghunt_semana_x.xlsx' });
    await waitFor(() => expect(screen.getByTestId('mkt-download-status')).toHaveTextContent('Se descargó tcghunt_semana_x.xlsx.'));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('un 400 pinta el banner de periodo no cerrado y no navega', async () => {
    api.downloadMarketingWeeklyExcel.mockRejectedValue(new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x' }));
    const before = window.location.pathname;
    view();
    await screen.findByTestId('mkt-screen-a');
    await userEvent.setup().click(screen.getByTestId('mkt-download-weekly'));
    expect(await screen.findByTestId('mkt-download-error')).toHaveTextContent('Ese periodo todavía no está cerrado. Elige uno anterior.');
    expect(window.location.pathname).toBe(before);
    expect(document.querySelector('a[href*="/admin/marketing/"]')).toBeNull();
  });

  it('con Mes el botón dice «Descargar Excel del mes» y exporta la pantalla con su formato', async () => {
    view({ periodo: 'mes' });
    await waitFor(() => expect(screen.getByTestId('mkt-download-weekly')).toHaveTextContent('Descargar Excel del mes'));
    await waitFor(() => expect(screen.getByTestId('mkt-export-csv')).toBeEnabled());
    await userEvent.setup().click(screen.getByTestId('mkt-export-csv'));
    await waitFor(() => expect(api.exportMarketingScreen).toHaveBeenCalledWith('a', 'csv', { month: '2026-09' }));
  });
});

describe('régimen exacto (dueño 2026-10-18; §MKT.G.5; §MKT2-UX.14 C-F16) — aviso junto a las descargas', () => {
  it('`exact` ⇒ `exactNotice` en lugar de `helpAlways`, enlazado por aria-describedby; nada en storage', async () => {
    api.getMarketingPanel.mockResolvedValue(payload('2026-10-05', '2026-10-11', { privacy: 'exact' }));
    view();
    const notice = await screen.findByTestId('mkt-exact-notice');
    expect(notice).toHaveTextContent('Aquí ves las cifras exactas. El Excel y las exportaciones salen sin datos personales');
    expect(screen.queryByTestId('mkt-help-always')).toBeNull();
    for (const id of ['mkt-download-weekly', 'mkt-export-xlsx', 'mkt-export-csv']) {
      expect(screen.getByTestId(id)).toHaveAttribute('aria-describedby', notice.id);
    }
    // §MKT.G.5: un payload `exact` vive en memoria de la pestaña; ⛔ nada en storage.
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(stored).not.toMatch(/Periodo actual|"n":11/);
  });

  it('`small_cells` ⇒ `helpAlways` y no el aviso exacto', async () => {
    view();
    expect(await screen.findByTestId('mkt-help-always')).toHaveTextContent('El Excel sale sin datos personales');
    expect(screen.queryByTestId('mkt-exact-notice')).toBeNull();
  });

  it('sin `privacy` en el payload (servidor viejo) ⇒ se trata como `small_cells`', async () => {
    const { privacy: _drop, ...noPrivacy } = payload('2026-10-05', '2026-10-11');
    void _drop;
    api.getMarketingPanel.mockResolvedValue(noPrivacy);
    view();
    await screen.findByTestId('mkt-help-always');
    expect(screen.queryByTestId('mkt-exact-notice')).toBeNull();
  });

  it('con el payload cargando, ninguno de los dos', async () => {
    api.getMarketingPanel.mockImplementation(() => new Promise(() => {}));
    view();
    await screen.findByTestId('mkt-loading');
    expect(screen.queryByTestId('mkt-exact-notice')).toBeNull();
    expect(screen.queryByTestId('mkt-help-always')).toBeNull();
    expect(screen.getByTestId('mkt-download-weekly')).not.toHaveAttribute('aria-describedby');
  });
});

describe('UX-MKT-17 · «Acceso del analista» solo para súper-admin', () => {
  it('sin súper-admin: ni pestaña ni opción, `?pantalla=acceso` cae en Resumen y no se piden llaves', async () => {
    role.isSuperAdmin = false;
    view({ pantalla: 'acceso' });
    await screen.findByTestId('mkt-screen-a');
    expect(screen.queryByRole('tab', { name: 'Acceso del analista' })).toBeNull();
    const sel = within(screen.getByTestId('mkt-screen-select')).getByLabelText('Pantalla') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).not.toContain('acceso');
    expect(api.listMarketingTokens).not.toHaveBeenCalled();
  });

  it('con súper-admin: la pestaña existe y solo pide las llaves al abrirla', async () => {
    view();
    await screen.findByTestId('mkt-screen-a');
    expect(api.listMarketingTokens).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Acceso del analista' }));
    await screen.findByText('Nadie tiene acceso ahora.');
    expect(api.listMarketingTokens).toHaveBeenCalledTimes(1);
  });
});

describe('franja de anotaciones y estados', () => {
  it('la franja sale en Resumen con ≥1 anotación y «Gestionar» lleva a la pantalla de anotaciones', async () => {
    api.getMarketingPanel.mockResolvedValue(
      payload('2026-10-05', '2026-10-11', { annotations: [{ date: '2026-10-07', kind: 'promocion', label: 'Historia', destino: 'Perfil' }] }),
    );
    view();
    const strip = await screen.findByTestId('mkt-ann-strip');
    expect(strip).toHaveTextContent('(1)');
    expect(strip).toHaveTextContent('Historia → Perfil');
    await userEvent.setup().click(within(strip).getByText('Gestionar'));
    expect(screen.getByRole('tab', { name: 'Anotaciones' })).toHaveAttribute('aria-selected', 'true');
  });

  it('sin anotaciones no hay franja; error ⇒ banner con Reintentar', async () => {
    api.getMarketingPanel.mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }));
    view();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las cifras. Inténtalo de nuevo.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByTestId('mkt-screen-a');
    expect(screen.queryByTestId('mkt-ann-strip')).toBeNull();
  });

  it('carga: esqueleto con «Cargando el panel…» y aria-busy', async () => {
    api.getMarketingPanel.mockImplementation(() => new Promise(() => {}));
    view();
    const loading = await screen.findByTestId('mkt-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent('Cargando el panel…');
  });
});

// QA M3 (2026-10-19, sobre a1ba4d2e): el recuadro se titula «Cobertura» y la viñeta repetía «Cobertura: …».
describe('QA M3 · «Cobertura» una sola vez', () => {
  it('la viñeta del servidor pierde su prefijo «Cobertura:» al pintarse bajo el título; las otras notas, intactas', async () => {
    api.getMarketingPanel.mockResolvedValue(
      payload('2026-10-05', '2026-10-11', {
        notes: ['Cobertura: GA4 sin encender; el origen de los pedidos aún no se registra.', 'Otra nota: tal cual.'],
      }),
    );
    view();
    const box = await screen.findByTestId('mkt-coverage');
    const items = within(box).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['GA4 sin encender; el origen de los pedidos aún no se registra.', 'Otra nota: tal cual.']);
    expect(screen.getAllByText(/Cobertura/)).toHaveLength(1);
  });
});
