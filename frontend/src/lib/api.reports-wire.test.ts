import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from './config';
import { exportSalesCsv, getPnl, getSalesReport } from './api';
import { setRefreshToken, setToken } from './api-client';

/**
 * I-2 (qa, §REPORTES-CEO F2a) · lo que VIAJA por el cable. El selector manda `kind` para que el servidor compare el MISMO tramo
 * del periodo anterior; sin `from`/`to` («Todo», atajos del servidor) el `kind` no se manda; y el CSV de Ventas NO lleva `kind`
 * (exporta lo que se ve, con el `groupBy` de la pantalla). Rama REAL (`config.useMocks = false`), `fetch` simulado.
 */
const ok = (body: unknown = {}) =>
  ({ status: 200, ok: true, json: async () => body, text: async () => '', blob: async () => new Blob(['x']), headers: new Headers() }) as unknown as Response;

describe('cable de los reportes (kind)', () => {
  const original = config.useMocks;
  let fetchMock: ReturnType<typeof vi.fn>;
  const lastUrl = () => new URL(String((fetchMock.mock.calls.at(-1) as [string])[0]), 'http://x');

  beforeEach(() => {
    config.useMocks = false;
    setToken('t');
    setRefreshToken('r');
    fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = original;
    setToken(null);
    setRefreshToken(null);
    vi.unstubAllGlobals();
  });

  it('getPnl: con from/to manda kind; sin rango («Todo») NO manda kind ni fechas', async () => {
    await getPnl({ from: '2026-11-01', to: '2026-11-23', kind: 'month' });
    expect(lastUrl().pathname.endsWith('/admin/finance/pnl')).toBe(true);
    expect(lastUrl().searchParams.get('kind')).toBe('month');
    expect(lastUrl().searchParams.get('from')).toBe('2026-11-01');
    await getPnl({ kind: 'month' });
    expect(lastUrl().searchParams.has('kind')).toBe(false);
    await getPnl({ from: '2026-11-01', kind: 'month' });
    expect(lastUrl().searchParams.has('kind')).toBe(false); // a medias no es rango
    await getPnl({});
    expect(lastUrl().search).toBe('');
  });

  it('getSalesReport: con from/to viaja kind y preset=custom; con solo preset no viaja kind', async () => {
    await getSalesReport({ kind: 'quarter', from: '2026-10-01', to: '2026-11-23', groupBy: 'week' });
    expect(lastUrl().pathname.endsWith('/admin/reports/sales')).toBe(true);
    expect(lastUrl().searchParams.get('kind')).toBe('quarter');
    expect(lastUrl().searchParams.get('preset')).toBe('custom');
    expect(lastUrl().searchParams.get('groupBy')).toBe('week');
    await getSalesReport({ kind: 'quarter', preset: 'last30' });
    expect(lastUrl().searchParams.has('kind')).toBe(false);
    expect(lastUrl().searchParams.get('preset')).toBe('last30');
  });

  it('exportSalesCsv: NO manda kind ni topSort, sí las fechas y el groupBy que se ven', async () => {
    await exportSalesCsv({ kind: 'month', topSort: 'net', preset: 'custom', from: '2026-11-01', to: '2026-11-23', groupBy: 'day' });
    expect(lastUrl().pathname.endsWith('/admin/reports/sales/export.csv')).toBe(true);
    expect(lastUrl().searchParams.has('kind')).toBe(false);
    expect(lastUrl().searchParams.has('topSort')).toBe(false);
    expect(lastUrl().searchParams.get('from')).toBe('2026-11-01');
    expect(lastUrl().searchParams.get('to')).toBe('2026-11-23');
    expect(lastUrl().searchParams.get('groupBy')).toBe('day');
  });
});
