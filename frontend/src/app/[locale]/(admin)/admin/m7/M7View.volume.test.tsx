import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import { mockSalesReport } from '@/lib/mock/sales';
import { formatMoneyCents } from '@/lib/format';
import type { SalesReportDTO } from '@/types/contract';

/**
 * 💰 §M10-IVA.8-bis (D) — volumen y ticket en Finanzas, REUSO de `GET /admin/reports/sales` (⛔ cero backend nuevo).
 *
 * Para el MISMO rango que el P&L, M7 lee `totals.{orders, avgTicketCents, piecesPerOrder, pieces}`. Son cifras de lo
 * PAGADO (IVA + comisión + envío dentro). `null` (orders=0) ⇒ «—», ⛔ nunca «MX$0.00»/«NaN». `getSalesReport` se mockea
 * aquí para fijar los dos casos; `getPnl`/`getInventoryValue`/… siguen con el fixture real (importOriginal).
 */

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, getSalesReport: vi.fn() };
});

import { getSalesReport } from '@/lib/api';
const getSalesReportMock = vi.mocked(getSalesReport);

const BASE: SalesReportDTO = mockSalesReport({ preset: 'custom', from: '2026-08-01', to: '2026-08-31', groupBy: 'day' });

function setRange() {
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-08-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-08-31' } });
}

beforeEach(() => {
  getSalesReportMock.mockReset();
});

describe('§M10-IVA.8-bis (D) · volumen y ticket en Finanzas', () => {
  it('sin rango no llama a reports/sales e invita a elegir un rango', () => {
    renderWithProviders(<M7View />, 'es');
    expect(screen.getByText('Elige un rango de fechas para ver el volumen y el ticket promedio.')).toBeInTheDocument();
    expect(getSalesReportMock).not.toHaveBeenCalled();
  });

  it('con rango pinta pedidos, ticket (MX$), piezas por pedido y piezas, para el MISMO rango', async () => {
    const totals = { ...BASE.totals, orders: 48, avgTicketCents: 127_500, piecesPerOrder: 3.5, pieces: 168 };
    getSalesReportMock.mockResolvedValue({ ...BASE, totals });
    renderWithProviders(<M7View />, 'es');
    setRange();

    const grid = await screen.findByTestId('finance-volume');
    expect(within(grid).getByText('48')).toBeInTheDocument();
    expect(within(grid).getByText(formatMoneyCents(127_500, 'es'))).toBeInTheDocument();
    expect(within(grid).getByText('3.5')).toBeInTheDocument();
    expect(within(grid).getByText('168')).toBeInTheDocument();
    expect(within(grid).getByText('Ticket promedio')).toBeInTheDocument();

    // Mismo rango que el P&L: preset=custom con las fechas tecleadas.
    expect(getSalesReportMock).toHaveBeenCalledWith({ preset: 'custom', from: '2026-08-01', to: '2026-08-31', groupBy: 'day' });
  });

  it('orders=0 ⇒ ticket y piezas por pedido muestran «—», ⛔ nunca «MX$0.00»', async () => {
    const totals = { ...BASE.totals, orders: 0, avgTicketCents: null, piecesPerOrder: null, pieces: 0 };
    getSalesReportMock.mockResolvedValue({ ...BASE, totals });
    renderWithProviders(<M7View />, 'es');
    setRange();

    const grid = await screen.findByTestId('finance-volume');
    // Exactamente dos «—» en el bloque: ticket y piezas por pedido; ⛔ ningún «MX$0.00»/«NaN».
    expect(within(grid).getAllByText('—')).toHaveLength(2);
    expect(within(grid).queryByText('MX$0.00')).toBeNull();
    expect(within(grid).queryByText(/NaN/)).toBeNull();
  });
});
