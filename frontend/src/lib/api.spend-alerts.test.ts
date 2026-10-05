import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSpendAlertSummary, listSpendAlerts, markSpendAlertsSeen, releaseShipmentLabel, updateSettings } from './api';
import { ApiClientError, setToken } from './api-client';
import { config } from './config';
import { mockSettings } from './mock/fixtures';

/**
 * Rama REAL de los verbos de v1.80.12.6–.10 (`API_CONTRACT §M4-SHIP.19.26.3 (b)`, `§19.29.9`, `§19.30.2`): lo que viaja
 * es exactamente lo que dice el contrato. Y dos conductas del servidor falso que la demo necesita (`OWNER_ONLY_SETTING`).
 */
describe('api (rama REAL) · avisos de gasto y «Liberar»', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;
  const ok = (body: unknown) => ({ status: 200, ok: true, json: async () => body }) as unknown as Response;

  beforeEach(() => {
    config.useMocks = false;
    setToken('access-token');
    fetchMock = vi.fn().mockResolvedValue(ok({ data: [], page: 1, pageSize: 25, total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = originalUseMocks;
    setToken(null);
    vi.unstubAllGlobals();
  });

  const lastUrl = () => new URL(String(fetchMock.mock.calls.at(-1)![0]), 'http://x');
  const lastBody = () => JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));

  it('UX-SDX-33 (red) · «Liberar» SIN conflicto ⇒ el cuerpo NO lleva `confirmConflict`; con él ⇒ `confirmConflict:true`', async () => {
    fetchMock.mockResolvedValue(ok({ outcome: 'released', shipment: { id: 's1' } }));
    await releaseShipmentLabel('s1', 'Revisé el panel');
    expect(lastBody()).toEqual({ note: 'Revisé el panel' });
    expect('confirmConflict' in lastBody()).toBe(false);
    await releaseShipmentLabel('s1', 'Revisé el panel', true);
    expect(lastBody()).toEqual({ note: 'Revisé el panel', confirmConflict: true });
    expect(lastUrl().pathname).toMatch(/\/admin\/shipments\/s1\/label\/release$/);
  });

  it('UX-GAS-2 (red) · los filtros viajan como query; `unseen` solo si es true', async () => {
    await listSpendAlerts({ kind: 'label_cap_blocked', severity: 'immediate', subjectUserId: 'u-1', unseen: true, from: '2026-10-03', to: '2026-10-04', page: 2 });
    const u = lastUrl();
    expect(u.pathname).toMatch(/\/admin\/spend-alerts$/);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      kind: 'label_cap_blocked',
      severity: 'immediate',
      subjectUserId: 'u-1',
      unseen: 'true',
      from: '2026-10-03',
      to: '2026-10-04',
      page: '2',
    });
    await listSpendAlerts({ unseen: false });
    expect(lastUrl().searchParams.has('unseen')).toBe(false);
  });

  it('`POST …/seen {ids}` y `GET …/summary?from&to`', async () => {
    fetchMock.mockResolvedValue(ok({ updated: 2, skipped: 0 }));
    await markSpendAlertsSeen(['a', 'b']);
    expect(lastUrl().pathname).toMatch(/\/admin\/spend-alerts\/seen$/);
    expect(lastBody()).toEqual({ ids: ['a', 'b'] });
    fetchMock.mockResolvedValue(ok({ from: 'd', to: 'd', byKind: [], labelSpendByPerson: [], costlyChoices: { count: 0, overRecommendedCents: 0, byPerson: [] } }));
    await getSpendAlertSummary('2026-10-03', '2026-10-03');
    expect(lastUrl().pathname).toMatch(/\/admin\/spend-alerts\/summary$/);
    expect(lastUrl().searchParams.get('from')).toBe('2026-10-03');
  });
});

describe('servidor falso · `PUT /admin/settings` con las claves del dueño (§19.30.2 (1))', () => {
  beforeEach(() => {
    window.localStorage.setItem('tcg.role', 'super_admin');
  });
  afterEach(() => {
    window.localStorage.removeItem('tcg.owner');
  });

  it('un súper-admin NO dueño que mueve el tope ⇒ `403 OWNER_ONLY_SETTING {keys}` y nada se escribe', async () => {
    window.localStorage.setItem('tcg.owner', 'false');
    const before = mockSettings.operatorLabelCap24hCents;
    const err = await updateSettings({ operatorLabelCap24hCents: 999900, shippingTrackingPollMinutes: 30 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('OWNER_ONLY_SETTING');
    expect((err as ApiClientError).details).toEqual({ keys: ['operatorLabelCap24hCents'] });
    expect(mockSettings.operatorLabelCap24hCents).toBe(before);
  });
});
