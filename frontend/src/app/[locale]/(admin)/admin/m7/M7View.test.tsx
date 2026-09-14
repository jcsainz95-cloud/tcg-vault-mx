import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import { presetRange } from '@/lib/dateRange';
import * as download from '@/lib/download';

describe('M7View · Finanzas (P&L)', () => {
  it('renderiza el P&L con el desglose de la fórmula y la ganancia', async () => {
    renderWithProviders(<M7View />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: /Finanzas/ })).toBeInTheDocument();

    // Etiquetas de la fórmula: ingresos + ingreso de envío − costo − Stripe − costo de envío = ganancia (v1.4-finance).
    expect(await screen.findByText('Ingresos (ventas)')).toBeInTheDocument();
    expect(screen.getByText('Ingreso por envío (cobrado)')).toBeInTheDocument();
    expect(screen.getByText('Costo de lo vendido')).toBeInTheDocument();
    expect(screen.getByText('Comisiones Stripe')).toBeInTheDocument();
    expect(screen.getByText('Costo de envío (paquetería, neto)')).toBeInTheDocument();
    expect(screen.getByText('Ganancia del periodo')).toBeInTheDocument();

    // Ganancia mock = 1250000 + 52500 − 640000 − 48300 − 31800 = 582400 cts = MX$5,824.00.
    expect(await screen.findByText('MX$5,824.00')).toBeInTheDocument();
  });

  it('muestra valor de inventario, custodia e IVA acumulado', async () => {
    renderWithProviders(<M7View />, 'es');
    expect(await screen.findByText('Inventario (a referencia)')).toBeInTheDocument();
    expect(await screen.findByText('Valor en custodia de clientes')).toBeInTheDocument();
    expect(await screen.findByText('IVA acumulado')).toBeInTheDocument();
    // Desglose de IVA por orden (DataTable pinta vista desktop + móvil).
    expect((await screen.findAllByText('ord-9001')).length).toBeGreaterThan(0);
  });

  it('los botones de preset setean el rango from/to del selector', async () => {
    renderWithProviders(<M7View />, 'es');

    const fromInput = await screen.findByLabelText('Desde') as HTMLInputElement;
    const toInput = screen.getByLabelText('Hasta') as HTMLInputElement;
    expect(fromInput.value).toBe('');
    expect(toInput.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Este año' }));
    const year = presetRange('year');
    expect(fromInput.value).toBe(year.from);
    expect(toInput.value).toBe(year.to);

    fireEvent.click(screen.getByRole('button', { name: 'Último mes' }));
    const month = presetRange('month');
    expect(fromInput.value).toBe(month.from);
    expect(toInput.value).toBe(month.to);
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

/**
 * ⭐ **§M10-IVA.8 — `shippingCostMissingCount`: hacer VISIBLE una ambigüedad que no se puede
 * resolver.**
 *
 * `ShipmentRequest.shippingCostCents` es `@default(0)` ⇒ en las filas existentes **«costó cero» y
 * «no se capturó» son indistinguibles**. ⛔ No se hace nullable (exigiría un backfill que **inventa**
 * esa distinción) y ⛔ el contador **no es una afirmación fiscal**: es una señal para un humano.
 */
describe('M7View · §M10-IVA.8 el cero del costo de envío que significa dos cosas', () => {
  it('avisa de los envíos liquidados SIN costo capturado, sin sumarlos a ninguna línea', async () => {
    renderWithProviders(<M7View />, 'es');
    const aviso = await screen.findByTestId('shipping-cost-missing');
    expect(aviso).toHaveTextContent(/2 envíos liquidados no tienen costo/);
    // ⛔ Es un AVISO, no un renglón del P&L: no lleva signo ni entra en la fórmula.
    expect(aviso.textContent).not.toMatch(/^[+−-]/);
  });

  /**
   * ⭐ **La mitad que evita el «indicador vacío» del criterio 202(c):** con `0` no hay nada que
   * revisar y **no se pinta aviso**. ⛔ Rojo si alguien lo cambia por un `??` y deja el banner fijo
   * diciendo «0 envíos».
   */
  it('⛔ con el contador en 0 NO se pinta aviso', async () => {
    const { mockPnl } = await import('@/lib/mock/fixtures');
    const previo = mockPnl.shippingCostMissingCount;
    mockPnl.shippingCostMissingCount = 0;
    try {
      renderWithProviders(<M7View />, 'es');
      expect(await screen.findByText('Estado de resultados (P&L)')).toBeInTheDocument();
      expect(screen.queryByTestId('shipping-cost-missing')).toBeNull();
    } finally {
      mockPnl.shippingCostMissingCount = previo;
    }
  });

  /** El rótulo dice **neto**: sus dos términos de envío están ahora en la misma base (§M10-IVA.8). */
  it('el renglón del costo de envío se rotula NETO', async () => {
    renderWithProviders(<M7View />, 'es');
    expect(await screen.findByText('Costo de envío (paquetería, neto)')).toBeInTheDocument();
  });
});
