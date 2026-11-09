import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, renderWithIntl } from '@/test/render';
import * as api from '@/lib/api';
import type { CatalogSyncStatusResponse, RefreshVariantsStatusResponse } from '@/types/contract';
import { AutoStatusLine, CatalogSyncSection } from './CatalogSyncSection';
import { useCatalogSync } from './useCatalogSync';

const IDLE: CatalogSyncStatusResponse = {
  running: false, jobId: null, total: 0, done: 0, startedAt: null, finishedAt: null, summary: null,
};
const IDLE_V: RefreshVariantsStatusResponse = { ...IDLE } as RefreshVariantsStatusResponse;
const NOW = new Date('2026-11-09T18:00:00Z');

describe('AUTO-F1 · estado del catálogo (lastSuccessAt / lastTrigger / attempt)', () => {
  it('hoy 01:12 · reintento 2 de 6', () => {
    renderWithIntl(
      <AutoStatusLine now={NOW} status={{ ...IDLE, lastSuccessAt: '2026-11-09T07:12:00Z', lastTrigger: 'job', attempt: 2 }} />,
      'es',
    );
    const txt = screen.getByTestId('auto-status').textContent ?? '';
    expect(txt).toContain('Última actualización automática: hoy');
    expect(txt).toMatch(/1:12/);
    expect(txt).toContain('reintento 2 de 6');
  });
  it('intento 1 ⇒ sin «reintento»; disparo de admin ⇒ «manual»; otro día ⇒ fecha completa', () => {
    renderWithIntl(
      <AutoStatusLine now={NOW} status={{ ...IDLE, lastSuccessAt: '2026-11-07T07:12:00Z', lastTrigger: 'admin', attempt: 1 }} />,
      'es',
    );
    const txt = screen.getByTestId('auto-status').textContent ?? '';
    expect(txt).toContain('(manual)');
    expect(txt).not.toContain('reintento');
    expect(txt).not.toContain('hoy');
  });
  it('EN y null ⇒ «No catalog update on record yet.»; campos ausentes ⇒ nada', () => {
    const a = renderWithIntl(<AutoStatusLine now={NOW} status={{ ...IDLE, lastSuccessAt: null }} />, 'en');
    expect(screen.getByTestId('auto-status').textContent).toBe('No catalog update on record yet.');
    a.unmount();
    const b = renderWithIntl(
      <AutoStatusLine now={NOW} status={{ ...IDLE, lastSuccessAt: '2026-11-09T07:12:00Z', lastTrigger: 'job', attempt: 3 }} />,
      'en',
    );
    expect(screen.getByTestId('auto-status').textContent).toContain('Last automatic update: today');
    expect(screen.getByTestId('auto-status').textContent).toContain('retry 3 of 6');
    b.unmount();
    const c = renderWithIntl(<AutoStatusLine now={NOW} status={IDLE} />, 'es');
    expect(c.container.textContent).toBe('');
  });
});

function Harness() {
  return <CatalogSyncSection catalog={useCatalogSync()} />;
}

describe('REMOTE-DEGRADED · aviso propio de lista incompleta (antes NO MEDIDO)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(IDLE);
    vi.spyOn(api, 'getRefreshVariantsStatus').mockResolvedValue(IDLE_V);
  });
  it('degraded:true ⇒ aviso «La lista está incompleta» con Reintentar que vuelve a pedir', async () => {
    const spy = vi.spyOn(api, 'getRemoteSets').mockResolvedValue({ data: [], degraded: true, source: 'local' });
    renderWithProviders(<Harness />, 'es');
    expect(await screen.findByText('La lista está incompleta')).toBeInTheDocument();
    const calls = spy.mock.calls.length;
    screen.getByRole('button', { name: 'Reintentar' }).click();
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(calls));
  });
  it('degraded ausente/false ⇒ sin aviso', async () => {
    vi.spyOn(api, 'getRemoteSets').mockResolvedValue({ data: [], source: 'remote' });
    renderWithProviders(<Harness />, 'es');
    await waitFor(() => expect(api.getRemoteSets).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('La lista está incompleta')).toBeNull();
  });
});
