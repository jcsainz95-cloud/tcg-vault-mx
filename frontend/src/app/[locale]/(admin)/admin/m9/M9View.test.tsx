import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M9View } from './M9View';
import * as download from '@/lib/download';

describe('M9View · Reportes', () => {
  it('renderiza las métricas de lanzamiento vs metas', async () => {
    renderWithProviders(<M9View />, 'es');
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
    renderWithProviders(<M9View />, 'es');
    const btn = await screen.findByRole('button', { name: /Exportar P&L/ });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatch(/\.csv$/);
    spy.mockRestore();
  });
});
