import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M9View } from './M9View';

/** §REPORTES-CEO F1: M9 es solo «Ventas» (informe comercial); «Actividad» y «Lista de compra» ya no son pestañas suyas. */
describe('M9View · Reportes › Ventas', () => {
  it('abre «Ventas» sin pestañas y sin pedir las métricas de lanzamiento', async () => {
    const api = await import('@/lib/api');
    const launch = vi.spyOn(api, 'getLaunchMetrics');
    const demand = vi.spyOn(api, 'getWishlistDemand');
    renderWithProviders(<M9View />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Ventas' })).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(await screen.findByTestId('sales-period-label')).toBeInTheDocument();
    expect(launch).not.toHaveBeenCalled();
    expect(demand).not.toHaveBeenCalled();
    launch.mockRestore();
    demand.mockRestore();
  });

  it('«Ventas de hoy» vive aquí (llegó desde Inicio)', async () => {
    renderWithProviders(<M9View />, 'es');
    expect(await screen.findByTestId('sales-today-card')).toBeInTheDocument();
  });
});
