import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { SalesTab } from './SalesTab';
import { SALES_DEFAULTS } from './salesParams';
import { expectOneDecimalPercents } from '@/test/pct';
import { report } from './sales.testkit';
import type { ComparisonBasis, SalesReportDTO } from '@/types/contract';

/** §REPORTES-CEO F2a — Ventas: el atajo manda su `kind` y el rótulo dice contra qué se compara; `{diff,pct}` se conserva tal cual. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const MONTH = { preset: 'month' as const, from: '2026-11-01', to: '2026-11-23' };
function serve(basis: ComparisonBasis, extra: Partial<SalesReportDTO> = {}, dataSince: string | null = null) {
  const r = report();
  return vi.spyOn(api, 'getSalesReport').mockResolvedValue({
    ...r,
    period: { preset: 'custom', from: '2026-11-01', to: '2026-11-23', days: 23, timezone: 'America/Mexico_City', kind: 'month', toDate: true },
    previousPeriod: { from: '2026-10-01', to: '2026-10-23', clamped: false },
    firstDataDay: '2024-03-01',
    comparison: { ...r.comparison, basis, dataSince },
    ...extra,
  });
}
const mount = () => renderWithProviders(<SalesTab initial={{ ...SALES_DEFAULTS, ...MONTH }} />, 'es');

describe('§2 F2a · Ventas', () => {
  it('«Este mes» manda kind=month y se rotula «Mes a la fecha · 1–23 nov comparado con 1–23 oct»', async () => {
    const spy = serve('complete');
    mount();
    expect(await screen.findByTestId('sales-compare')).toHaveTextContent('Mes a la fecha · 1–23 nov comparado con 1–23 oct');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'month', from: '2026-11-01', to: '2026-11-23' }));
    // `{diff,pct}` del servidor, sin tocar (F2a no unifica el formato en Ventas).
    expect((await screen.findByTestId('sales-delta-orders')).textContent).toContain('+200.0 %');
    expectOneDecimalPercents(screen.getByTestId('sales-card-orders').closest('section')!.textContent ?? '');
  });

  it('m-3: si el servidor cayó a `span`, NO dice «a la fecha»: da el rango tal cual; con kind=month sí', async () => {
    serve('complete', { period: { preset: 'custom', from: '2026-11-05', to: '2026-11-23', days: 19, timezone: 'America/Mexico_City', kind: 'span', toDate: true }, previousPeriod: { from: '2026-10-17', to: '2026-11-04', clamped: false } });
    const a = renderWithProviders(<SalesTab initial={{ ...SALES_DEFAULTS, ...MONTH, from: '2026-11-05' }} />, 'es');
    const note = await screen.findByTestId('sales-compare');
    expect(note).not.toHaveTextContent('a la fecha');
    expect(note).toHaveTextContent('5–23 nov comparado con 17 oct – 4 nov');
    a.unmount();
    serve('complete', { period: { preset: 'custom', from: '2026-11-01', to: '2026-11-23', days: 23, timezone: 'America/Mexico_City', kind: 'month', toDate: true } });
    mount();
    expect(await screen.findByTestId('sales-compare')).toHaveTextContent('Mes a la fecha');
  });

  it('m-2: «El periodo anterior es más corto» solo con clamped:true (mes cerrado vs febrero completo va sin aviso)', async () => {
    serve('complete', { previousPeriod: { from: '2027-02-01', to: '2027-02-28', clamped: false } });
    mount();
    await screen.findByTestId('sales-compare');
    expect(screen.queryByTestId('sales-compare-clamped')).toBeNull();
  });

  it('contra lo que hay, periodo anterior más corto y sin comparación', async () => {
    serve('partial', { previousPeriod: { from: '2026-10-01', to: '2026-10-23', clamped: true } }, '2026-10-12');
    const a = mount();
    const note = await screen.findByTestId('sales-compare');
    expect(note).toHaveTextContent('contra lo que hay (datos desde 12 oct 2026)');
    expect(screen.getByTestId('sales-compare-clamped')).toBeInTheDocument();
    a.unmount();

    serve('none');
    mount();
    const none = await screen.findByTestId('sales-compare');
    expect(none).toHaveAttribute('data-basis', 'none');
    expect(none).toHaveTextContent('Sin ventas en el periodo anterior (1–23 oct)');
    expect(document.body.textContent).not.toMatch(/MTD|YTD|basis|clamped/);
  });

  it('m-1: basis none ⇒ «—» en las 7 variaciones (nunca un número ni «0 %»), aunque el JSON traiga {diff,pct}', async () => {
    serve('none');
    const none = mount();
    await screen.findByTestId('sales-compare');
    for (const k of ['orders', 'chargedCents', 'netSalesCents', 'refundsAmountCents', 'netSalesAfterRefundsCents', 'avgTicketCents', 'piecesPerOrder']) {
      const el = await screen.findByTestId(`sales-delta-${k}`);
      expect(el.textContent, k).toContain('—');
      expect(el.textContent, k).not.toMatch(/\d|%/);
      expect(el).toHaveAttribute('data-basis', 'none');
    }
    none.unmount();
    // con base, el mismo informe SÍ pinta variaciones (el «—» no es el defecto).
    serve('complete');
    mount();
    expect((await screen.findByTestId('sales-delta-orders')).textContent).toMatch(/%/);
  });

  // I-2: «Mes a la fecha» sale del informe que SE VE. Al elegir «Hoy», mientras la consulta nueva carga, el rótulo y las cifras
  // siguen siendo los del mes (con su «a la fecha»), nunca el rótulo del periodo nuevo sobre cifras del viejo.
  it('mientras carga un periodo nuevo, el rótulo sigue siendo el del informe visible (a la fecha del mes)', async () => {
    const first = serve('complete');
    mount();
    expect(await screen.findByTestId('sales-compare')).toHaveTextContent('Mes a la fecha · 1–23 nov');
    first.mockImplementation(() => new Promise(() => {})); // la consulta de «Hoy» no llega
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    await waitFor(() => expect(first).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('sales-compare')).toHaveTextContent('Mes a la fecha · 1–23 nov comparado con 1–23 oct');
    expect(screen.getByTestId('sales-period-label')).toHaveAttribute('data-from', '2026-11-01');
  });

  it('I-1 aviso de la URL en Ventas: allUnavailable con {days}=366; se va al elegir otro periodo', async () => {
    serve('complete');
    renderWithProviders(<SalesTab initial={{ ...SALES_DEFAULTS, ...MONTH }} initialNotice="allUnavailable" />, 'es');
    const b = await screen.findByText('«Todo» no está disponible aquí (máximo 366 días): se muestra Este mes.');
    expect(b.closest('[role="status"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    await waitFor(() => expect(screen.queryByText(/no está disponible aquí/)).toBeNull());
  });
});
