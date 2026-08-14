import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { PortfolioHistoryResponse, PortfolioRange } from '@/types/contract';

const getPortfolioHistory = vi.fn();
vi.mock('@/lib/api', () => ({
  getPortfolioHistory: (range: PortfolioRange) => getPortfolioHistory(range),
}));

// Import after mock so the component picks up the mocked module.
import { PortfolioTrendChart } from './PortfolioTrendChart';

const series: PortfolioHistoryResponse = {
  range: '1m',
  points: [
    { date: '2026-07-15', valueMxnCents: 512000, costBasisMxnCents: 400000 },
    { date: '2026-08-14', valueMxnCents: 543200, costBasisMxnCents: 400000 },
  ],
  change: { absMxnCents: 31200, pct: 6.09, direction: 'up' },
};

const empty: PortfolioHistoryResponse = {
  range: '1m',
  points: [],
  change: { absMxnCents: 0, pct: null, direction: 'flat' },
};

describe('PortfolioTrendChart (§7.17)', () => {
  beforeEach(() => getPortfolioHistory.mockReset());

  it('muestra el estado vacío "recopilando datos" cuando no hay snapshots', async () => {
    getPortfolioHistory.mockResolvedValue(empty);
    renderWithProviders(<PortfolioTrendChart currentValueFallbackCents={543200} />, 'es');
    await waitFor(() => expect(screen.getByText('Estamos recopilando datos')).toBeInTheDocument());
  });

  it('renderiza el toggle de 8 rangos y el delta con signo y porcentaje', async () => {
    getPortfolioHistory.mockResolvedValue(series);
    renderWithProviders(<PortfolioTrendChart />, 'es');

    // el porcentaje aparece (en el delta y en el resumen accesible)
    await waitFor(() => expect(screen.getAllByText(/6\.09/).length).toBeGreaterThan(0));

    const group = screen.getByRole('group', { name: 'Rango de tiempo' });
    const buttons = group.querySelectorAll('button');
    expect(buttons.length).toBe(8);
    // Flecha ▲ presente además del color (no depender solo del color).
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('al cambiar de rango vuelve a pedir el historial con el nuevo rango', async () => {
    getPortfolioHistory.mockResolvedValue(series);
    renderWithProviders(<PortfolioTrendChart />, 'es');
    await waitFor(() => expect(getPortfolioHistory).toHaveBeenCalledWith('1m'));

    fireEvent.click(screen.getByRole('button', { name: '6m' }));
    await waitFor(() => expect(getPortfolioHistory).toHaveBeenCalledWith('6m'));
  });
});
