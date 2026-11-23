import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { SalesTab } from './SalesTab';
import { SALES_DEFAULTS } from './salesParams';
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
    period: { preset: 'custom', from: '2026-11-01', to: '2026-11-23', days: 23, timezone: 'America/Mexico_City' },
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
    expect((await screen.findByTestId('sales-delta-orders')).textContent).toContain('+200 %');
  });

  it('m-3: si el servidor cayó a `span`, NO dice «a la fecha»: da el rango tal cual; con kind=month sí', async () => {
    serve('complete', { period: { preset: 'custom', from: '2026-11-05', to: '2026-11-23', days: 19, timezone: 'America/Mexico_City', kind: 'span' }, previousPeriod: { from: '2026-10-17', to: '2026-11-04', clamped: false } });
    const a = renderWithProviders(<SalesTab initial={{ ...SALES_DEFAULTS, ...MONTH, from: '2026-11-05' }} />, 'es');
    const note = await screen.findByTestId('sales-compare');
    expect(note).not.toHaveTextContent('a la fecha');
    expect(note).toHaveTextContent('5–23 nov comparado con 17 oct – 4 nov');
    a.unmount();
    serve('complete', { period: { preset: 'custom', from: '2026-11-01', to: '2026-11-23', days: 23, timezone: 'America/Mexico_City', kind: 'month' } });
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
});
