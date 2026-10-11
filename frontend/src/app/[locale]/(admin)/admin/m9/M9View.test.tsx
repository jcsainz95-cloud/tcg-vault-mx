import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M9View } from './M9View';
import * as download from '@/lib/download';

describe('M9View · Reportes › pestaña «Actividad» (lo de antes, sin cambio)', () => {
  it('renderiza las métricas de lanzamiento vs metas', async () => {
    renderWithProviders(<M9View initialTab="actividad" />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: /Reportes/ })).toBeInTheDocument();

    expect(await screen.findByText('Usuarios activos')).toBeInTheDocument();
    expect(screen.getByText('Ventas liquidadas')).toBeInTheDocument();
    expect(screen.getByText('Buylist pagadas')).toBeInTheDocument();
    expect(screen.getByText('Retiros sin disputa')).toBeInTheDocument();

    // Progreso contra meta N=100 con 42 usuarios → "42 de 100 · 42%".
    expect(await screen.findByText('42 de 100 · 42%')).toBeInTheDocument();
  });

  it('exporta un reporte en CSV', async () => {
    const spy = vi.spyOn(download, 'downloadTextFile').mockImplementation(() => {});
    renderWithProviders(<M9View initialTab="actividad" />, 'es');
    const btn = await screen.findByRole('button', { name: /Exportar P&L/ });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatch(/\.csv$/);
    spy.mockRestore();
  });
});

/** §AN-UX.1: «Ventas» primera y por defecto; cada pestaña monta su consulta solo cuando está activa. */
describe('M9View · pestañas (§AN-UX.1)', () => {
  it('sin `tab`, abre «Ventas» y no pide las métricas de «Actividad»', async () => {
    const api = await import('@/lib/api');
    const launch = vi.spyOn(api, 'getLaunchMetrics');
    renderWithProviders(<M9View />, 'es');
    const tabs = screen.getAllByRole('tab');
    // ⭐ §WSH-UX.7: tercera pestaña «Lista de compra».
    expect(tabs.map((t) => t.textContent)).toEqual(['Ventas', 'Actividad', 'Lista de compra']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('sales-period-label')).toBeInTheDocument();
    expect(launch).not.toHaveBeenCalled();
    fireEvent.click(tabs[1]);
    expect(await screen.findByText('Usuarios activos')).toBeInTheDocument();
    expect(launch).toHaveBeenCalled();
    launch.mockRestore();
  });

  it('§WSH-UX.7 · «Lista de compra» monta su consulta solo al abrirla y escribe `tab=compra`', async () => {
    const api = await import('@/lib/api');
    const demand = vi.spyOn(api, 'getWishlistDemand');
    renderWithProviders(<M9View />, 'es');
    expect(demand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Lista de compra' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Cartas que te piden y no tienes' })).toBeInTheDocument();
    expect(demand).toHaveBeenCalledWith({});
    expect(window.location.search).toContain('tab=compra');
    demand.mockRestore();
  });
});
