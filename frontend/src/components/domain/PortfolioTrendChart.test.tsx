import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type {
  PortfolioHistoryResponse,
  PortfolioRange,
  SetValueHistoryResponse,
  SetValueRange,
} from '@/types/contract';

const getPortfolioHistory = vi.fn();
const getFeaturedSetValueHistory = vi.fn();
vi.mock('@/lib/api', () => ({
  getPortfolioHistory: (range: PortfolioRange) => getPortfolioHistory(range),
  getFeaturedSetValueHistory: (range: SetValueRange) => getFeaturedSetValueHistory(range),
}));

// Import after mock so the component picks up the mocked module.
import { PortfolioTrendChart, FeaturedSetGlance } from './PortfolioTrendChart';

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

const setRef = { id: 'sv08', name: 'Surging Sparks', series: 'Scarlet & Violet', releaseDate: '2024/11/08' };

const setSeries: SetValueHistoryResponse = {
  set: setRef,
  range: '1m',
  points: [
    { date: '2026-07-16', valueMxnCents: 128450000, pricedCardCount: 182 },
    { date: '2026-08-15', valueMxnCents: 131920000, pricedCardCount: 184 },
  ],
  change: { absMxnCents: 3470000, pct: 2.7, direction: 'up' },
};

const setOnePoint: SetValueHistoryResponse = {
  set: setRef,
  range: '1m',
  points: [{ date: '2026-08-15', valueMxnCents: 131920000, pricedCardCount: 184 }],
  change: { absMxnCents: 0, pct: null, direction: 'flat' },
};

const setEmpty: SetValueHistoryResponse = {
  set: setRef,
  range: '1m',
  points: [],
  change: { absMxnCents: 0, pct: null, direction: 'flat' },
};

const setNull: SetValueHistoryResponse = {
  set: null,
  range: '1m',
  points: [],
  change: { absMxnCents: 0, pct: null, direction: 'flat' },
};

describe('FeaturedSetGlance (§7.18)', () => {
  beforeEach(() => getFeaturedSetValueHistory.mockReset());

  it('pide el historial del set destacado con rango fijo 1m', async () => {
    getFeaturedSetValueHistory.mockResolvedValue(setSeries);
    renderWithProviders(<FeaturedSetGlance />, 'es');
    await waitFor(() => expect(getFeaturedSetValueHistory).toHaveBeenCalledWith('1m'));
  });

  it('con serie (≥2 puntos) muestra nombre del set, etiqueta de mercado, cifra y delta con flecha', async () => {
    getFeaturedSetValueHistory.mockResolvedValue(setSeries);
    renderWithProviders(<FeaturedSetGlance />, 'es');

    // Nombre del set en inglés (dato de catálogo, no traducido) marcado lang="en".
    const name = await screen.findByText('Surging Sparks');
    expect(name).toHaveAttribute('lang', 'en');
    // Etiqueta de mercado (i18n) + delta con signo/flecha (no solo color).
    expect(screen.getByText('Valor de mercado · Set destacado')).toBeInTheDocument();
    expect(screen.getByText('▲')).toBeInTheDocument();
    expect(screen.getAllByText(/2\.70/).length).toBeGreaterThan(0);
    // No aparece el microcopy de "recopilando" cuando sí hay curva.
    expect(screen.queryByText('Recopilando historial')).not.toBeInTheDocument();
  });

  it('con 1 punto muestra la cifra de hoy + "Recopilando historial" y NO dibuja curva', async () => {
    getFeaturedSetValueHistory.mockResolvedValue(setOnePoint);
    const { container } = renderWithProviders(<FeaturedSetGlance />, 'es');

    await screen.findByText('Surging Sparks');
    expect(screen.getByText('Recopilando historial')).toBeInTheDocument();
    // Sin flecha de delta (no hay curva ni cambio narrado).
    expect(screen.queryByText('▲')).not.toBeInTheDocument();
    // El Sparkline (svg de recharts) no se dibuja con < 2 puntos.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('con points:[] degrada al sub-encabezado + "Recopilando historial", sin cifra ni curva', async () => {
    getFeaturedSetValueHistory.mockResolvedValue(setEmpty);
    const { container } = renderWithProviders(<FeaturedSetGlance />, 'es');

    await screen.findByText('Surging Sparks');
    expect(screen.getByText('Recopilando historial')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('con set:null degrada a nada (render vacío) para que el panel caiga a su forma previa', async () => {
    getFeaturedSetValueHistory.mockResolvedValue(setNull);
    const { container } = renderWithProviders(<FeaturedSetGlance />, 'es');

    await waitFor(() => expect(getFeaturedSetValueHistory).toHaveBeenCalledWith('1m'));
    // Nunca un placeholder roto ni un cero: el componente no pinta nada.
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
