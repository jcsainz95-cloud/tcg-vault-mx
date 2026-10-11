import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import es from '../../../../../../messages/es.json';
import { SalesTab } from './SalesTab';
import { SALES_DEFAULTS } from './salesParams';
import { figures, report, reportP2 } from './sales.testkit';
import type { SalesReportDTO } from '@/types/contract';

/**
 * Candados de la pestaña «Ventas» (`DESIGN_SYSTEM §AN-UX.15` UX-AN-1..9, 13, 14, 16..20; `API_CONTRACT §15.6`
 * AN-F-1, AN-F-2, AN-F-4, AN-F-5). Deterministas: N=1 basta (sin carreras ni reloj; el reloj solo decide «en curso»
 * y las fixtures están en el pasado salvo donde se dice).
 * Enganche: espías sobre `@/lib/api` (MSW no es dependencia del proyecto; ⛔ no se instala).
 */

function serve(...responses: Array<SalesReportDTO | Error | Promise<SalesReportDTO>>) {
  const spy = vi.spyOn(api, 'getSalesReport');
  for (const r of responses) {
    if (r instanceof Error) spy.mockRejectedValueOnce(r);
    else spy.mockImplementationOnce(() => (r instanceof Promise ? r : Promise.resolve(r)));
  }
  // TD-AN-11: una petición que la prueba no previó falla en voz alta, no cae al servidor falso.
  spy.mockRejectedValue(new Error('llamada no esperada'));
  return spy;
}

function mount() {
  return renderWithProviders(<SalesTab initial={SALES_DEFAULTS} />, 'es');
}

afterEach(() => vi.restoreAllMocks());

describe('UX-AN-1 (AN-F-1) · `null` es «—», nunca MX$0.00/NaN/Infinity', () => {
  it('con 0 pedidos, ticket y piezas por pedido pintan «—» con su sr-only', async () => {
    serve(report({ totals: figures(), rows: report().rows.map((r) => ({ ...r, ...figures() })) }));
    const { container } = mount();
    const ticket = await screen.findByTestId('sales-card-avgTicketCents');
    const ppo = screen.getByTestId('sales-card-piecesPerOrder');
    for (const el of [ticket, ppo]) {
      expect(el.textContent).toContain('—');
      expect(el.textContent).toContain(es.admin.m9.sales.noData);
      expect(el.textContent).not.toContain('MX$0.00');
    }
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe('AN-1 · el ticket y las piezas por pedido son los del DTO (⛔ calcularlos en el navegador)', () => {
  it('con un DTO cuyo ticket NO es cobrado ÷ pedidos, se pinta el del DTO', async () => {
    // 987654 / 3 = 329218: el DTO dice otra cosa a propósito.
    serve(report({ totals: { ...report().totals, avgTicketCents: 111111, piecesPerOrder: 1.5 } }));
    mount();
    expect((await screen.findByTestId('sales-card-avgTicketCents')).textContent).toBe('MX$1,111.11');
    expect(screen.getByTestId('sales-card-piecesPerOrder').textContent).toBe('1.5');
  });
});

describe('UX-AN-2 (AN-F-1) · unidades ANTES que el %; sin anterior, sin %', () => {
  it('3 vs 1 ⇒ «+2 pedidos» antes que «+200 %»', async () => {
    serve(report());
    mount();
    const txt = (await screen.findByTestId('sales-delta-orders')).textContent ?? '';
    expect(txt).toContain('+2 pedidos');
    expect(txt).toContain('+200 %');
    expect(txt.indexOf('+2 pedidos')).toBeLessThan(txt.indexOf('+200 %'));
  });
  it('anterior con 0 pedidos ⇒ «sin ventas en el periodo anterior» y ningún «%»', async () => {
    serve(report({ previousTotals: figures(), comparison: { ...report().comparison, orders: { diff: 3, pct: null } } }));
    mount();
    const txt = (await screen.findByTestId('sales-delta-orders')).textContent ?? '';
    expect(txt).toContain('+3 pedidos');
    expect(txt).toContain(es.admin.m9.sales.delta.noPrevious);
    expect(txt).not.toContain('%');
  });
});

describe('UX-AN-3 (AN-F-2) · una barra por fila, mismo valor, ceros visibles', () => {
  it('nº de barras = rows.length; cada data-value = su fila; las de cero existen como marca', async () => {
    const rep = report();
    serve(rep);
    mount();
    await screen.findByTestId('sales-period-label');
    const bars = screen.getAllByTestId('sales-bar');
    expect(bars).toHaveLength(rep.rows.length);
    bars.forEach((b, i) => expect(Number(b.getAttribute('data-value'))).toBe(rep.rows[i].orders));
    const zeros = bars.filter((b) => b.getAttribute('data-zero') === 'true');
    expect(zeros).toHaveLength(rep.rows.filter((r) => r.orders === 0).length);
    expect(zeros.length).toBe(5);
  });
});

describe('UX-AN-4 · todas las filas, y el pie con `totals` (⛔ suma de filas)', () => {
  it('7 filas con ventas en 2; el tfoot pinta los totales del DTO aunque no cuadren con las filas', async () => {
    serve(report());
    mount();
    await screen.findByTestId('sales-period-label');
    expect(screen.getAllByTestId('sales-row')).toHaveLength(7);
    const foot = screen.getByTestId('sales-total-row');
    expect(foot.textContent).toContain('MX$9,876.54'); // totals.chargedCents
    expect(foot.textContent).not.toContain('MX$1,500.00'); // Σ rows.chargedCents
  });
});

describe('UX-AN-5 · el rótulo sale de la RESPUESTA (AN-4)', () => {
  it('mientras el periodo nuevo carga, el rótulo sigue siendo el del anterior', async () => {
    const pending = new Promise<SalesReportDTO>(() => {});
    serve(report(), pending);
    mount();
    const label = await screen.findByTestId('sales-period-label');
    expect(label).toHaveAttribute('data-from', '2026-09-30');
    fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.period.today }));
    await waitFor(() => expect(screen.getByTestId('sales-region')).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByTestId('sales-period-label')).toHaveAttribute('data-from', '2026-09-30');
    expect(screen.getByTestId('sales-period-label').textContent).toContain('7 días');
  });
});

describe('UX-AN-6 · cambiar `groupBy` pide con `groupBy` y las celdas pintan los `totals` de la respuesta', () => {
  it('semana', async () => {
    const week = report({
      groupBy: 'week',
      rows: [
        { ...report().rows[0], from: '2026-09-30', to: '2026-10-04', ...figures({ orders: 3, chargedCents: 150000 }) },
        { ...report().rows[0], from: '2026-10-05', to: '2026-10-06', ...figures() },
      ],
    });
    const spy = serve(report(), week);
    mount();
    await screen.findByTestId('sales-period-label');
    fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.groupBy.week }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: 'week' })));
    await waitFor(() => expect(screen.getAllByTestId('sales-row')).toHaveLength(2));
    expect(screen.getByTestId('sales-card-chargedCents').textContent).toBe('MX$9,876.54');
    expect(screen.getByTestId('sales-card-orders').textContent).toBe('3');
  });
});

describe('UX-AN-7 · rango a mano: se valida antes de mandar; el `400` va bajo su campo', () => {
  async function openCustom() {
    const spy = serve(report());
    mount();
    await screen.findByTestId('sales-period-label');
    fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.period.custom }));
    return spy;
  }
  const set = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
  const ver = () => fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.period.apply }));
  const R = es.admin.m9.sales.range;

  it.each([
    ['falta una', '2026-09-01', '', R.bothRequired],
    ['desde > hasta', '2026-09-10', '2026-09-01', R.fromAfterTo],
    ['hasta > hoy', '2026-09-01', '2999-01-01', R.toFuture],
    ['más de 366 días', '2024-01-01', '2026-01-01', R.tooLong],
  ])('%s ⇒ su texto y NINGUNA petición', async (_n, from, to, msg) => {
    const spy = await openCustom();
    const calls = spy.mock.calls.length;
    set(es.admin.m9.sales.period.from, from);
    set(es.admin.m9.sales.period.to, to);
    ver();
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(spy.mock.calls.length).toBe(calls);
  });

  it('un `400 {field:"to"}` del servidor: mensaje genérico (AN-1.2, sin `reason`) bajo «Hasta»', async () => {
    const spy = await openCustom();
    spy.mockRejectedValueOnce(new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'to' } }));
    set(es.admin.m9.sales.period.from, '2026-09-01');
    set(es.admin.m9.sales.period.to, '2026-09-05');
    ver();
    const to = screen.getByLabelText(es.admin.m9.sales.period.to);
    await waitFor(() => expect(to).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(to.getAttribute('aria-describedby') ?? '')?.textContent).toBe(R.invalid);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'custom', from: '2026-09-01', to: '2026-09-05' }));
  });
});

describe('UX-AN-8 · `topSort` lo ordena el servidor', () => {
  it('«Piezas» pide `topSort=pieces` y pinta el orden del fixture tal cual (aunque no sea por piezas)', async () => {
    const spy = serve(report(), report({ top: { ...report().top, sort: 'pieces' } }));
    mount();
    await screen.findByTestId('sales-period-label');
    const group = screen.getByRole('group', { name: es.admin.m9.sales.top.sortLabel });
    fireEvent.click(within(group).getByRole('button', { name: es.admin.m9.sales.top.sortPieces }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ topSort: 'pieces' })));
    await waitFor(() => expect(within(group).getByRole('button', { name: es.admin.m9.sales.top.sortPieces })).toHaveAttribute('aria-pressed', 'true'));
    const pieces = screen.getAllByTestId('sales-top-card').map((r) => r.querySelectorAll('td')[2].textContent);
    expect(pieces).toEqual(['1', '3', '1']); // el del DTO, no reordenado
  });
});

describe('UX-AN-9 · dos acabados = dos filas, cada una con su FinishMark', () => {
  it('Charizard reverse y holo', async () => {
    serve(report());
    mount();
    await screen.findByTestId('sales-period-label');
    const rows = screen.getAllByTestId('sales-top-card').filter((r) => r.textContent?.includes('Charizard'));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByLabelText(es.finish.reverse_holo)).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText(es.finish.holofoil)).toBeInTheDocument();
  });
});

describe('AN-1.2 · sellado sin set ⇒ «—»', () => {
  it('`setName: null` pinta «—» con su sr-only, nunca «null»', async () => {
    serve(report({ top: { ...report().top, sealed: [{ sealedProductId: null, name: 'Lata', setName: null, pieces: 1, netCents: 45000 }] } }));
    mount();
    await screen.findByTestId('sales-period-label');
    fireEvent.click(screen.getByRole('tab', { name: es.admin.m9.sales.top.sealed }));
    const row = await screen.findByTestId('sales-top-sealed');
    expect(row.textContent).toContain('Lata · —');
    expect(row.textContent).toContain(es.admin.m9.sales.noData);
    expect(row.textContent).not.toContain('null');
  });
});

describe('UX-AN-13 · P2 se pinta solo si llega (⛔ `?? 0`)', () => {
  it('sin P2: ni conmutador de columnas, ni bloques P2', async () => {
    serve(report());
    mount();
    await screen.findByTestId('sales-period-label');
    expect(screen.queryByRole('group', { name: es.admin.m9.sales.table.colsLabel })).toBeNull();
    expect(screen.queryByTestId('sales-p2-totals')).toBeNull();
    expect(screen.queryByTestId('sales-when')).toBeNull();
    expect(screen.queryByTestId('sales-mix')).toBeNull();
  });
  it('con P2: conmutador y bloques; sin `buylistRevenueCents` no hay esa columna', async () => {
    serve(reportP2());
    mount();
    await screen.findByTestId('sales-period-label');
    const cols = screen.getByRole('group', { name: es.admin.m9.sales.table.colsLabel });
    expect(screen.getByTestId('sales-p2-totals')).toBeInTheDocument();
    expect(screen.getByTestId('sales-when')).toBeInTheDocument();
    expect(screen.getByTestId('sales-mix')).toBeInTheDocument();
    fireEvent.click(within(cols).getByRole('button', { name: es.admin.m9.sales.table.colsMoney }));
    const table = screen.getByTestId('sales-table');
    expect(within(table).getByText(es.admin.m9.sales.table.profit)).toBeInTheDocument();
    expect(within(table).queryByText(es.admin.m9.sales.table.buylistRevenue)).toBeNull();
    expect(within(table).queryByText(es.admin.m9.sales.table.buylistCost)).toBeNull();
  });
});

describe('UX-AN-14 · el CSV lleva el mismo periodo y agrupación que la pantalla', () => {
  it('con «Mes pasado» por semana: manda las FECHAS del DTO, no el preset (el servidor no lo re-resuelve al exportar)', async () => {
    const shown = report({ period: { ...report().period, preset: 'last_month', from: '2026-09-01', to: '2026-09-30', days: 30 }, groupBy: 'week' });
    serve(shown);
    const csv = vi.spyOn(api, 'exportSalesCsv').mockResolvedValue({ blob: new Blob(['x']), filename: 'ventas.csv' });
    const create = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    mount();
    fireEvent.click(await screen.findByTestId('sales-csv'));
    await waitFor(() => expect(csv).toHaveBeenCalled());
    expect(csv.mock.calls[0][0]).toEqual({ preset: 'custom', from: '2026-09-01', to: '2026-09-30', groupBy: 'week' });
  });
});

describe('UX-AN-16 (AN-F-4) · sin script ni cookie nuevos', () => {
  it('la pestaña no inyecta <script> ni escribe cookie', async () => {
    const scripts = document.querySelectorAll('script').length;
    const cookie = document.cookie;
    serve(reportP2());
    mount();
    await screen.findByTestId('sales-period-label');
    expect(document.querySelectorAll('script').length).toBe(scripts);
    expect(document.cookie).toBe(cookie);
  });
});

describe('UX-AN-17 · los deltas no se colorean; dicen «subió/bajó»', () => {
  it('sin text-success/danger/accent; sr-only en cada uno', async () => {
    serve(report({ comparison: { ...report().comparison, netSalesCents: { diff: -5000, pct: -11 } } }));
    mount();
    await screen.findByTestId('sales-period-label');
    const deltas = screen.getAllByTestId(/^sales-delta-/);
    expect(deltas.length).toBeGreaterThanOrEqual(5);
    for (const d of deltas) {
      expect(d.outerHTML).not.toMatch(/text-(success|danger|accent)/);
    }
    expect(screen.getByTestId('sales-delta-orders').querySelector('.sr-only')?.textContent).toContain(es.admin.m9.sales.delta.up);
    const down = screen.getByTestId('sales-delta-netSalesCents');
    expect(down.querySelector('.sr-only')?.textContent).toContain(es.admin.m9.sales.delta.down);
    expect(down.textContent).toContain('−MX$50.00');
  });
});

describe('UX-AN-18 (AN-F-5) · «Resultado del envío» es el del DTO, con signo y en tinta', () => {
  it('no es cobrado − costo: se pinta el valor del DTO; «Puede ser menor» con costos faltantes', async () => {
    const base = reportP2();
    const shipping = { chargedNetCents: 30000, costNetCents: 23600, costMissingCount: 2, adjustmentsCents: 0, resultNetCents: -8000 };
    serve({
      ...base,
      totals: { ...base.totals, shipping },
      rows: base.rows.map((r, i) => ({ ...r, shipping: { ...shipping, resultNetCents: i === 0 ? 12000 : 0, costMissingCount: i === 0 ? 1 : 0 } })),
    });
    mount();
    const cell = await screen.findByTestId('sales-card-shippingResult');
    expect(cell.textContent).toBe('−MX$80.00'); // ≠ 300.00 − 236.00 = +64.00
    expect(cell.closest('div')?.textContent).toContain(es.admin.m9.sales.p2.shippingResultMaybeLower);
    fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.table.colsMoney }));
    const cols = screen.getAllByTestId('sales-shipping-result');
    expect(cols[0].textContent).toContain('+MX$120.00');
    expect(cols[0].textContent).toContain(es.admin.m9.sales.table.shippingResultMaybeLower);
    expect(cols[1].textContent).toBe('MX$0.00');
    for (const c of [cell, ...cols]) expect(c.outerHTML).not.toMatch(/text-(success|danger)/);
  });
});

describe('UX-AN-19 (AN-F-5) · contracargos y «Qué se vende» solo si llegan', () => {
  const cb = { count: 1, amountCents: 95000, byOutcome: { open: { count: 1, amountCents: 95000 }, won: { count: 0, amountCents: 0 }, lost: { count: 0, amountCents: 0 } } };
  it('ausentes ⇒ ni tabla, ni columna/celda, ni aviso', async () => {
    serve(reportP2());
    mount();
    await screen.findByTestId('sales-period-label');
    expect(screen.queryByTestId('sales-mix-product-type')).toBeNull();
    expect(screen.queryByTestId('sales-card-chargebacks')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.table.colsMoney }));
    expect(within(screen.getByTestId('sales-table')).queryByText(es.admin.m9.sales.table.chargebacks)).toBeNull();
    expect(screen.queryByTestId('sales-chargebacks-undated')).toBeNull();
  });
  it('`chargebacksUndatedCount = 0` ⇒ sin aviso; `3` ⇒ el aviso dice 3', async () => {
    const base = reportP2();
    const withCb = (n: number) => ({
      ...base,
      totals: { ...base.totals, chargebacks: cb },
      rows: base.rows.map((r) => ({ ...r, chargebacks: cb })),
      chargebacksUndatedCount: n,
      mix: { ...base.mix!, byProductType: { raw: { pieces: 4, netCents: 1 }, graded: { pieces: 2, netCents: 2 }, sealed: { pieces: 0, netCents: 0 } } },
    });
    serve(withCb(0));
    const first = mount();
    await screen.findByTestId('sales-card-chargebacks');
    expect(screen.getByTestId('sales-mix-product-type')).toBeInTheDocument();
    expect(screen.queryByTestId('sales-card-chargebacks-undated')).toBeNull();
    first.unmount();
    serve(withCb(3));
    mount();
    expect((await screen.findByTestId('sales-card-chargebacks-undated')).textContent).toContain('3');
    fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.table.colsMoney }));
    expect(within(screen.getByTestId('sales-table')).getByText(es.admin.m9.sales.table.chargebacks)).toBeInTheDocument();
    expect(screen.getByTestId('sales-chargebacks-undated').textContent).toContain('3');
  });
});

describe('UX-AN-20 · el CSV no habla de centavos', () => {
  it('ni el DOM de la pestaña', async () => {
    serve(report());
    const { container } = mount();
    await screen.findByTestId('sales-period-label');
    expect(container.textContent).not.toMatch(/centavo|cents/i);
  });
});

describe('§AN-UX.10 · estados', () => {
  it('periodo sin ventas: banner y TODO lo demás se pinta (filas de cero, barras-marca)', async () => {
    serve(report({ totals: figures(), rows: report().rows.map((r) => ({ ...r, ...figures() })) }));
    mount();
    expect(await screen.findByTestId('sales-empty')).toHaveTextContent(es.admin.m9.sales.state.empty);
    expect(screen.getAllByTestId('sales-row')).toHaveLength(7);
    expect(screen.getAllByTestId('sales-bar').every((b) => b.getAttribute('data-zero') === 'true')).toBe(true);
  });
  it('`403` ⇒ «Solo el súper-admin…» sin reintentar', async () => {
    serve(new ApiClientError(403, { code: 'FORBIDDEN', message: 'x' }));
    mount();
    expect(await screen.findByText(es.admin.m9.sales.state.forbidden)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.common.retry })).toBeNull();
  });
  it('error de red ⇒ banner con «Reintentar»; los datos previos se quedan visibles', async () => {
    const spy = serve(report(), new Error('network'));
    mount();
    await screen.findByTestId('sales-period-label');
    fireEvent.click(screen.getByRole('button', { name: es.admin.m9.sales.period.yesterday }));
    expect(await screen.findByText(es.admin.m9.sales.state.error)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: es.common.retry })).toBeInTheDocument();
    expect(screen.getByTestId('sales-card-orders').textContent).toBe('3');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
