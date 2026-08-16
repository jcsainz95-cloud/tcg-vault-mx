import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import * as download from '@/lib/download';

describe('M7View · Finanzas (P&L)', () => {
  it('renderiza el P&L con el desglose de la fórmula y la ganancia', async () => {
    renderWithProviders(<M7View />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: /Finanzas/ })).toBeInTheDocument();

    // Etiquetas de la fórmula ingresos + envío − costo − Stripe = ganancia.
    expect(await screen.findByText('Ingresos (ventas)')).toBeInTheDocument();
    expect(screen.getByText('Costo de lo vendido')).toBeInTheDocument();
    expect(screen.getByText('Comisiones Stripe')).toBeInTheDocument();
    expect(screen.getByText('Ganancia del periodo')).toBeInTheDocument();

    // Ganancia mock = 1250000 + 52500 − 640000 − 48300 = 614200 cts = MX$6,142.00.
    expect(await screen.findByText('MX$6,142.00')).toBeInTheDocument();
  });

  it('muestra valor de inventario, custodia e IVA acumulado', async () => {
    renderWithProviders(<M7View />, 'es');
    expect(await screen.findByText('Inventario (a referencia)')).toBeInTheDocument();
    expect(await screen.findByText('Valor en custodia de clientes')).toBeInTheDocument();
    expect(await screen.findByText('IVA acumulado')).toBeInTheDocument();
    // Desglose de IVA por orden (DataTable pinta vista desktop + móvil).
    expect((await screen.findAllByText('ord-9001')).length).toBeGreaterThan(0);
  });

  it('exporta el CSV de P&L descargando un archivo', async () => {
    const spy = vi.spyOn(download, 'downloadTextFile').mockImplementation(() => {});
    renderWithProviders(<M7View />, 'es');
    const btn = await screen.findByRole('button', { name: /Exportar P&L/ });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    const [filename, csv] = spy.mock.calls[0];
    expect(filename).toMatch(/\.csv$/);
    expect(csv).toContain('profitCents');
    spy.mockRestore();
  });
});
