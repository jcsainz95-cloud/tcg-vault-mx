import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from './config';
import { exportFinanceCsv } from './api';
import { getRefreshToken, getToken, setRefreshToken, setToken } from './api-client';
import { getStoredUser, setStoredUser } from './session';
import type { UserDTO } from '@/types/contract';

/**
 * FE-15 (TECH_DEBT) · `exportFinanceCsv` pasa por el núcleo de sesión (`requestText` → `fetchWithSession`):
 * 401 → refresh → UN reintento con el token nuevo. Antes hacía su propio `fetch` y un token vencido daba 401 seco.
 * Rama REAL (`config.useMocks = false`), `fetch` simulado.
 */
const user: UserDTO = { id: 'u1', email: 'admin@example.com', name: 'Admin', role: 'super_admin', locale: 'es' };
const json = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;
const csv = (status: number, text: string) =>
  ({ status, ok: status >= 200 && status < 300, text: async () => text, json: async () => ({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }) }) as unknown as Response;

describe('exportFinanceCsv · FE-15 (refresh de sesión)', () => {
  const original = config.useMocks;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config.useMocks = false;
    setToken('old.token');
    setRefreshToken('refresh.1');
    setStoredUser(user);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    config.useMocks = original;
    setToken(null);
    setRefreshToken(null);
    setStoredUser(null);
    vi.unstubAllGlobals();
  });

  it('401 → refresh → reintenta UNA vez con el token nuevo y devuelve el texto del CSV', async () => {
    fetchMock
      .mockResolvedValueOnce(csv(401, ''))
      .mockResolvedValueOnce(json(200, { accessToken: 'new.token', refreshToken: 'refresh.2' }))
      .mockResolvedValueOnce(csv(200, 'fecha,total\n2026-10-01,100'));

    const out = await exportFinanceCsv({ report: 'pnl', from: '2026-10-01', to: '2026-10-31', source: 'reports' });

    expect(out).toBe('fecha,total\n2026-10-01,100');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toContain('/admin/reports/export.csv?report=pnl&from=2026-10-01&to=2026-10-31');
    expect((firstInit.headers as Record<string, string>).Authorization).toBe('Bearer old.token');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/refresh');
    const [retryUrl, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(retryUrl).toBe(firstUrl);
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer new.token');
    expect(getToken()).toBe('new.token');
    expect(getRefreshToken()).toBe('refresh.2');
  });

  it('sin rango, M7: solo `report`; refresh fallido ⇒ limpia la sesión y propaga el 401', async () => {
    fetchMock.mockResolvedValueOnce(csv(401, '')).mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'dead' } }));
    await expect(exportFinanceCsv({ report: 'iva' })).rejects.toMatchObject({ status: 401 });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/admin\/finance\/export\.csv\?report=iva$/);
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });
});
