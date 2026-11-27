import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as exc from '@/lib/api/catalog-link-exceptions';
import { AutoLinkSummary } from './AutoLinkSummary';

const base = { unlinkedCards: 3, unlinkedSets: 1, repairedYesterday: 87, pricedYesterday: 87, lastRunAt: '2026-11-27T11:00:00Z', nextRunAt: '2026-11-28T11:00:00Z', waitingDecision: 0, pendingConfirm: 2 };
beforeEach(() => vi.restoreAllMocks());

describe('AutoLinkSummary (F2)', () => {
  it('contador y estado Encendida', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue({ unlinkedCards: 3, sets: [], summary: { ...base, autoLinkEnabled: true } });
    renderWithProviders(<AutoLinkSummary />);
    expect((await screen.findByTestId('auto-link-counter')).textContent).toBe('Quedan 3 cartas sin precio · ayer se repararon 87 (87 con precio)');
    expect(screen.getByTestId('auto-link-job').textContent).toMatch(/Reparación automática encendida.*próxima corrida/);
  });
  it('apagada: sin próxima corrida y con aviso', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue({ unlinkedCards: 3, sets: [], summary: { ...base, autoLinkEnabled: false } });
    renderWithProviders(<AutoLinkSummary />);
    await screen.findByTestId('auto-link-counter');
    expect(screen.getByTestId('auto-link-job').textContent).toMatch(/Reparación automática apagada/);
    expect(screen.getByTestId('auto-link-job').textContent).not.toMatch(/próxima corrida/);
  });
  it('sin endpoint (404) no pinta nada; campo ausente no se inventa', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockRejectedValue(new Error('404'));
    const { container } = renderWithProviders(<AutoLinkSummary />);
    expect(container.querySelector('[data-testid="auto-link-summary"]')).toBeNull();
  });
});
