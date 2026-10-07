import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { SalesTab } from './SalesTab';
import { SALES_DEFAULTS } from './salesParams';
import { reportP2 } from './sales.testkit';

/**
 * AC-F15 (`API_CONTRACT §AC.12` «Analítica»): `mix.byProductType` gana `accessory`, y la tabla «Qué se vende»
 * pinta la celda «Accesorios» con las piezas y la venta sin IVA DEL SERVIDOR. Sin la llave (servidor anterior),
 * no hay fila (⛔ no se inventa un 0).
 */
afterEach(() => vi.restoreAllMocks());

function serveWith(accessory?: { pieces: number; netCents: number }) {
  const base = reportP2();
  vi.spyOn(api, 'getSalesReport').mockResolvedValue({
    ...base,
    mix: {
      ...base.mix!,
      byProductType: {
        raw: { pieces: 4, netCents: 100_00 },
        graded: { pieces: 2, netCents: 200_00 },
        sealed: { pieces: 0, netCents: 0 },
        ...(accessory ? { accessory } : {}),
      },
    },
  });
}

describe('AC-F15 · celda «Accesorios»', () => {
  it('con `accessory` ⇒ fila «Accesorios» con sus cifras', async () => {
    serveWith({ pieces: 7, netCents: 123_45 });
    renderWithProviders(<SalesTab initial={SALES_DEFAULTS} />, 'es');
    const table = await screen.findByTestId('sales-mix-product-type');
    const row = within(table).getByRole('row', { name: /Accesorios/ });
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByText(/123\.45/)).toBeInTheDocument();
  });

  it('sin `accessory` ⇒ sin fila', async () => {
    serveWith();
    renderWithProviders(<SalesTab initial={SALES_DEFAULTS} />, 'es');
    const table = await screen.findByTestId('sales-mix-product-type');
    expect(within(table).queryByRole('row', { name: /Accesorios/ })).toBeNull();
  });
});
