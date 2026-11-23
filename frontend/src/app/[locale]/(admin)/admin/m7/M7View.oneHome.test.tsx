import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';

/**
 * §REPORTES-CEO F1 (CR-2) — cada cifra en UNA casa. Finanzas ya no repite «Volumen y ticket» (vive en Reportes › Ventas) ni
 * el valor de inventario y de custodia (viven en Reportes › Inventario): ni se pintan ni se piden.
 */
describe('Finanzas · una sola casa por cifra', () => {
  it('no pide ventas ni inventario ni custodia, y no pinta «Volumen y ticket» ni «Valor de inventario»', async () => {
    const api = await import('@/lib/api');
    const sales = vi.spyOn(api, 'getSalesReport');
    const inv = vi.spyOn(api, 'getInventoryValue');
    const custody = vi.spyOn(api, 'getCustodyValue');
    const { container } = renderWithProviders(<M7View />, 'es');
    expect(await screen.findByText('IVA acumulado')).toBeInTheDocument();
    for (const gone of ['Volumen y ticket', 'Ticket promedio', 'Inventario (a referencia)', 'Valor en custodia de clientes', 'Valor de inventario y custodia']) {
      expect(container.textContent).not.toContain(gone);
    }
    expect(sales).not.toHaveBeenCalled();
    expect(inv).not.toHaveBeenCalled();
    expect(custody).not.toHaveBeenCalled();
    sales.mockRestore();
    inv.mockRestore();
    custody.mockRestore();
  });

  it('el periodo que manda la Junta llega a los campos de fecha', () => {
    renderWithProviders(<M7View initialPeriod={{ preset: 'custom', from: '2026-11-01', to: '2026-11-22' }} />, 'es');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-11-22');
  });
});
