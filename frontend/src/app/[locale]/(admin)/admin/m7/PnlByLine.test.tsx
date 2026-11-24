import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { expectOneDecimalPercents } from '@/test/pct';
import * as api from '@/lib/api';
import { mockPnl } from '@/lib/mock/fixtures';
import { mockPnlReport } from '@/lib/mock/pnl-lines';
import { periodFor } from '@/lib/reports/period';
import { PNL_FIGURES, PNL_LINES, type PnlColumnDTO, type PnlLineKey, type PnlReportDTO } from '@/types/reports-pnl';
import { M7View } from './M7View';
import { money } from '../m9/salesFormat';
import { fmtPct } from '@/lib/reports/comparison';

const role = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('@/lib/role', () => ({ useRole: () => ({ role: role.isSuperAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: role.isSuperAdmin, canSwitchRole: false }) }));

/**
 * §REPORTES-CEO F2b — Finanzas › «Resultado por línea de negocio». Los importes de ESTE fixture son inconsistentes a propósito
 * (cada celda distinta y sin cuadrar): si la pantalla sumara, restara o cruzara columnas, diría otra cosa que el JSON.
 */
const month = periodFor('month', '2026-11-23');
type ColKey = PnlLineKey | 'total';
// Cada celda lleva un número ÚNICO: línea i (1..6), renglón j (1..9): i·100 000 + j·1 111 (+ centavos distintos).
function col(i: number): PnlColumnDTO {
  const b = i * 100_000;
  return {
    grossSalesCents: b + 1_111,
    discountsCents: b + 2_222,
    refundsCents: b + 3_333,
    netSalesCents: b + 4_444,
    cogsCents: b + 5_555,
    grossProfitCents: b + 6_666,
    marginBps: 1_000 + i * 100 + 7,
    sellingCosts: { paymentFeeCents: b + 7_777, shippingResultCents: i === 5 ? -(b + 8_888) : b + 8_888 },
    contributionCents: b + 9_999,
  };
}
const LINE_INDEX: Record<ColKey, number> = { sealed: 1, raw: 2, graded: 3, accessory: 4, unassigned: 5, total: 6 };
const delta = (i: number) => ({ cents: i * 1000, previousCents: i * 900, deltaCents: i * 100 + 7, deltaBps: i * 111 });
const figs = (i: number) => Object.fromEntries(PNL_FIGURES.map((f, j) => [f, delta(i * 10 + j)])) as PnlReportDTO['comparison'] extends infer C ? (C extends { total: infer T } ? T : never) : never;

function report(over: Partial<PnlReportDTO> = {}, basis: 'complete' | 'partial' | 'none' = 'complete'): PnlReportDTO {
  const own = { ...Object.fromEntries(PNL_LINES.map((l) => [l, col(LINE_INDEX[l])])), total: { ...col(6), fixedCostsCents: null, resultCents: null } } as PnlReportDTO['own'];
  return {
    period: { from: '2026-11-01', to: '2026-11-23', kind: 'month', days: 23, timezone: 'America/Mexico_City', toDate: true },
    previousPeriod: { from: '2026-10-01', to: '2026-10-23', clamped: false },
    firstDataDay: '2024-03-01',
    own,
    marketplace: { available: false, gmvCents: null, commissionCents: null },
    total: own.total,
    memo: {
      iva: { collectedCents: 777_001, refundedCents: 777_002, netCents: 777_003 },
      inventoryPurchasesCents: 777_004,
      chargebacks: { orders: 3, cents: 777_005 },
      shrinkageCents: 777_006,
      shipping: { insuranceCents: 777_007, adjustmentsCents: 777_008 },
      buylist: { retainedFeeCents: 777_009, guideCostCents: 777_010 },
    },
    // el periodo anterior: otras cifras (col(i + 10)), para que «antes {margen}» no se confunda con el actual
    previous: {
      own: { ...Object.fromEntries(PNL_LINES.map((l) => [l, col(LINE_INDEX[l] + 10)])), total: { ...col(16), fixedCostsCents: null, resultCents: null } } as PnlReportDTO['own'],
      total: { ...col(16), fixedCostsCents: null, resultCents: null },
    },
    comparison: {
      basis,
      dataSince: null,
      total: figs(6),
      byLine: Object.fromEntries(PNL_LINES.map((l) => [l, figs(LINE_INDEX[l])])) as never,
    },
    costMissingCount: 0,
    stripeFeeEstimatedOrders: 0,
    allocationMismatchOrders: 0,
    ...over,
  };
}
const serve = (r: PnlReportDTO) => {
  vi.spyOn(api, 'getPnl').mockResolvedValue({ ...mockPnl });
  vi.spyOn(api, 'getPnlCalendar').mockResolvedValue(undefined as never);
  return vi.spyOn(api, 'getPnlReport').mockResolvedValue(r);
};
beforeEach(() => {
  role.isSuperAdmin = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const mount = (locale: 'es' | 'en' = 'es') => renderWithProviders(<M7View initialPeriod={month} />, locale);
const cell = (row: string, c: ColKey) => screen.getByTestId(`pl-${row}-${c}`);
const ROWFIELDS: [string, (c: PnlColumnDTO) => number][] = [
  ['grossSales', (c) => c.grossSalesCents],
  ['discounts', (c) => c.discountsCents],
  ['refunds', (c) => c.refundsCents],
  ['netSales', (c) => c.netSalesCents],
  ['cogs', (c) => c.cogsCents],
  ['grossProfit', (c) => c.grossProfitCents],
  ['paymentFee', (c) => c.sellingCosts.paymentFeeCents],
  ['shippingResult', (c) => c.sellingCosts.shippingResultCents],
  ['contribution', (c) => c.contributionCents],
];

describe('F2b · Resultado por línea de negocio (Finanzas, súper-admin)', () => {
  it('manda from/to/kind a la ruta nueva y pinta 6 columnas: Sellado, Cartas raw, Gradeadas, Accesorios, Sin línea y Total', async () => {
    const spy = serve(report());
    mount();
    const table = await screen.findByTestId('pnl-lines-table');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-01', to: '2026-11-23', kind: 'month' }));
    const heads = within(table).getAllByRole('columnheader').slice(1).map((h) => h.textContent);
    expect(heads).toEqual(['Sellado', 'Cartas raw', 'Gradeadas', 'Accesorios', 'Sin línea', 'Total']);
    expect(screen.getByRole('heading', { name: 'Resultado por línea de negocio' })).toBeInTheDocument();
  });

  it('renglón ↔ celda: cada una de las 9 cifras en cada una de las 6 columnas es la del servidor (54 celdas)', async () => {
    const r = report();
    serve(r);
    mount();
    await screen.findByTestId('pnl-lines-table');
    let n = 0;
    for (const c of [...PNL_LINES, 'total'] as ColKey[]) {
      const data = c === 'total' ? r.total : r.own[c];
      for (const [row, get] of ROWFIELDS) {
        expect(cell(row, c).textContent, `${row}/${c}`).toContain(money(get(data), 'es'));
        n++;
      }
      expect(cell('margin', c).textContent).toContain(`${(data.marginBps! / 100).toFixed(1)} %`);
    }
    expect(n).toBe(54);
    // Ninguna celda repite el importe de otra (si dos coincidieran, un cruce pasaría desapercibido).
    const texts = ROWFIELDS.flatMap(([row]) => ([...PNL_LINES, 'total'] as ColKey[]).map((c) => cell(row, c).childNodes[0]?.textContent));
    expect(new Set(texts).size).toBe(54);
  });

  it('el navegador no calcula: el total es el del JSON aunque no sea la suma de las líneas', async () => {
    const r = report();
    serve(r);
    mount();
    await screen.findByTestId('pnl-lines-table');
    const sum = PNL_LINES.reduce((s, l) => s + r.own[l].netSalesCents, 0);
    expect(sum).not.toBe(r.total.netSalesCents); // fixture inconsistente a propósito
    expect(cell('netSales', 'total').textContent).toContain(money(r.total.netSalesCents, 'es'));
    expect(cell('netSales', 'total').textContent).not.toContain(money(sum, 'es'));
    // cifras-titular = total del servidor
    const head = screen.getByTestId('pnl-lines-headline');
    expect(head).toHaveTextContent(money(r.total.netSalesCents, 'es'));
    expect(head).toHaveTextContent(money(r.total.grossProfitCents, 'es'));
    expect(head).toHaveTextContent(money(r.total.contributionCents, 'es'));
    expect(head).toHaveTextContent('Resultado antes de gastos fijos');
  });

  it('variaciones: deltaBps del servidor con un decimal; margen contra el anterior (previous.marginBps); «—» con basis none', async () => {
    const r = report();
    serve(r);
    const a = mount();
    await screen.findByTestId('pnl-lines-table');
    // sealed (línea 1), renglón j: deltaBps = (1·10+j)·111 ⇒ netSales es j=3: 13·111 = 1443 ⇒ 14.4 %
    expect(screen.getByTestId('pl-delta-netSales-sealed')).toHaveTextContent('+14.4 %');
    expect(screen.getByTestId('pl-delta-netSales-total')).toHaveTextContent('+69.9 %'); // (6·10+3)·111 = 6993 pb
    expect(cell('margin', 'raw')).toHaveTextContent('antes 22.1 %'); // previous.own.raw = col(12) ⇒ 2 207 pb
    expectOneDecimalPercents(screen.getByTestId('pnl-lines').textContent ?? '', 20);
    a.unmount();
    serve(report({}, 'none'));
    mount();
    await screen.findByTestId('pnl-lines-table');
    expect(screen.getByTestId('pl-delta-netSales-sealed')).toHaveTextContent('—');
    expect(screen.getByTestId('pl-delta-netSales-sealed').textContent).not.toMatch(/%/);
    expect(cell('margin', 'sealed').textContent).not.toContain('antes');
  });

  it('I-3: cada renglón con variación lleva la de SU cifra (costo ≠ ganancia bruta ≠ …), por línea y en el total', async () => {
    const r = report();
    serve(r);
    mount();
    await screen.findByTestId('pnl-lines-table');
    const FIG: Record<string, (typeof PNL_FIGURES)[number]> = {
      grossSales: 'grossSalesCents', discounts: 'discountsCents', refunds: 'refundsCents', netSales: 'netSalesCents', cogs: 'cogsCents',
      grossProfit: 'grossProfitCents', paymentFee: 'paymentFeeCents', shippingResult: 'shippingResultCents', contribution: 'contributionCents',
    };
    for (const c of ['sealed', 'unassigned', 'total'] as ColKey[]) {
      const d = c === 'total' ? r.comparison!.total : r.comparison!.byLine[c];
      for (const [row, fig] of Object.entries(FIG)) {
        expect(screen.getByTestId(`pl-delta-${row}-${c}`), `${row}/${c}`).toHaveTextContent(fmtPct(d[fig].deltaBps, 'es')!);
      }
    }
  });

  it('B-1: margen NEGATIVO conserva el «−» (por línea, «antes», titular y total)', async () => {
    const r = report();
    r.own.sealed = { ...r.own.sealed, marginBps: -8202 };
    r.total.marginBps = -3500;
    r.previous!.own.sealed = { ...r.previous!.own.sealed, marginBps: -1234 };
    serve(r);
    mount();
    await screen.findByTestId('pnl-lines-table');
    expect(cell('margin', 'sealed')).toHaveTextContent('−82.0 %');
    expect(cell('margin', 'sealed').textContent).not.toMatch(/(^|[^−\d.])82\.0 %/);
    expect(cell('margin', 'sealed')).toHaveTextContent('antes −12.3 %');
    expect(cell('margin', 'total')).toHaveTextContent('−35.0 %');
    expect(screen.getByTestId('pnl-lines-headline')).toHaveTextContent('Margen −35.0 % sobre ventas netas');
  });

  it('I-3: cada cifra-titular lleva SU variación (ventas netas, ganancia bruta, resultado), no la de otra', async () => {
    const r = report();
    serve(r);
    mount();
    const head = await screen.findByTestId('pnl-lines-headline');
    const deltas = within(head).getAllByTestId('delta').map((e) => e.textContent);
    const t = r.comparison!.total;
    expect(deltas).toHaveLength(3);
    [t.netSalesCents, t.grossProfitCents, t.contributionCents].forEach((d, i) => expect(deltas[i], `titular ${i}`).toContain(fmtPct(Math.abs(d.deltaBps!), 'es', false)!));
    expect(new Set(deltas.map((x) => x!.match(/\d+\.\d %/)![0])).size).toBe(3);
  });

  it('I-3: el IVA del memo es el NETO; cobrado y reembolsado van en el subrótulo', async () => {
    serve(report());
    mount();
    const memo = await screen.findByTestId('pnl-lines-memo');
    const dt = within(memo).getByText('IVA (neto)');
    expect(dt.nextElementSibling).toHaveTextContent(money(777_003, 'es'));
    expect(dt.nextElementSibling).not.toHaveTextContent(money(777_001, 'es'));
    expect(dt.closest('div')!.parentElement).toHaveTextContent(`Cobrado ${money(777_001, 'es')} · reembolsado ${money(777_002, 'es')}`);
  });

  it('«Todo» (sin comparación) y margen null ⇒ sin variaciones y «—» en el margen', async () => {
    const r = report({ period: null, previousPeriod: null, previous: null, comparison: null });
    r.own.unassigned = { ...r.own.unassigned, marginBps: null };
    serve(r);
    mount();
    await screen.findByTestId('pnl-lines-table');
    expect(screen.queryAllByTestId(/^pl-delta-/)).toHaveLength(0);
    expect(cell('margin', 'unassigned').textContent).toContain('—');
    expect(cell('margin', 'unassigned').textContent).not.toMatch(/%|0\.0/);
  });

  it('memo (contracargos, merma…) va aparte, rotulado «no se suma», y no entra en ninguna celda; Marketplace reservado sin cifras', async () => {
    serve(report());
    mount();
    const memo = await screen.findByTestId('pnl-lines-memo');
    expect(memo).toHaveTextContent('Informativo: no se suma al resultado');
    expect(memo).toHaveTextContent(money(777_005, 'es'));
    expect(memo).toHaveTextContent('3 pedidos');
    expect(memo).toHaveTextContent(money(777_006, 'es'));
    expect(within(screen.getByTestId('pnl-lines-table')).queryByText(money(777_005, 'es'))).toBeNull();
    const mk = screen.getByTestId('pnl-lines-marketplace');
    expect(mk).toHaveTextContent('Lugar reservado');
    expect(mk.textContent).not.toMatch(/MX\$|\d/); // ninguna cifra inventada: solo «—»
  });

  it('allocationMismatchOrders > 0 ⇒ aviso con el contador; 0 ⇒ nada. costMissing y comisión estimada junto a su renglón', async () => {
    serve(report({ allocationMismatchOrders: 2, costMissingCount: 3, stripeFeeEstimatedOrders: 1 }));
    const a = mount();
    const w = await screen.findByTestId('pnl-lines-mismatch');
    expect(w).toHaveTextContent('2 pedidos no cuadraron al repartirse entre líneas');
    expect(w.querySelector('[role="status"]')).not.toBeNull();
    expect(screen.getByTestId('pnl-lines-cost-missing')).toHaveTextContent('3 piezas vendidas sin costo capturado');
    expect(screen.getByTestId('pnl-lines-fee-estimated')).toHaveTextContent('1 pedido con comisión estimada');
    a.unmount();
    serve(report());
    mount();
    await screen.findByTestId('pnl-lines-table');
    expect(screen.queryByTestId('pnl-lines-mismatch')).toBeNull();
    expect(screen.queryByTestId('pnl-lines-cost-missing')).toBeNull();
  });

  it('gastos fijos aún null ⇒ «antes de gastos fijos»; con valor (F3) aparece su renglón y el «Resultado»', async () => {
    const r = report();
    serve(r);
    const a = mount();
    await screen.findByTestId('pnl-lines-table');
    expect(screen.queryByTestId('pl-row-fixedCosts')).toBeNull();
    expect(screen.getByTestId('pnl-lines-headline')).toHaveTextContent('Todavía no se descuentan gastos fijos');
    a.unmount();
    const f = report();
    f.total = { ...f.total, fixedCostsCents: 123_456, resultCents: 654_321 };
    serve(f);
    mount();
    await screen.findByTestId('pl-row-fixedCosts');
    expect(screen.getByTestId('pl-row-fixedCosts')).toHaveTextContent(money(123_456, 'es'));
    expect(screen.getByTestId('pnl-lines-headline')).toHaveTextContent(money(654_321, 'es'));
  });

  it('celular: el selector de línea muestra UNA línea junto al Total (las demás columnas se ocultan por CSS)', async () => {
    serve(report());
    mount();
    await screen.findByTestId('pnl-lines-table');
    const picker = screen.getByTestId('pnl-lines-picker');
    expect(within(picker).getByRole('button', { name: 'Sellado' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pl-head-sealed').className).not.toContain('hidden');
    expect(screen.getByTestId('pl-head-raw').className).toContain('hidden md:table-cell');
    expect(screen.getByTestId('pl-head-total').className).not.toContain('hidden');
    fireEvent.click(within(picker).getByRole('button', { name: 'Gradeadas' }));
    expect(screen.getByTestId('pl-head-graded').className).not.toContain('hidden');
    expect(screen.getByTestId('pl-head-sealed').className).toContain('hidden md:table-cell');
    expect(cell('netSales', 'graded').className).not.toContain('hidden');
    expect(cell('netSales', 'sealed').className).toContain('hidden md:table-cell');
  });

  it('en inglés', async () => {
    serve(report());
    mount('en');
    const table = await screen.findByTestId('pnl-lines-table');
    expect(within(table).getAllByRole('columnheader').slice(1).map((h) => h.textContent)).toEqual(['Sealed', 'Raw cards', 'Graded', 'Accessories', 'No line', 'Total']);
    expect(screen.getByTestId('pnl-lines-memo')).toHaveTextContent('For information: not added to the result');
    expect(screen.getByTestId('pnl-lines-marketplace')).toHaveTextContent('Reserved spot');
    expectOneDecimalPercents(screen.getByTestId('pnl-lines').textContent ?? '', 20);
  });

  it('con el mock espejo del contrato la pantalla cuadra: Σ de las 5 columnas = Total en la pantalla', async () => {
    const r = mockPnlReport({ from: '2026-11-01', to: '2026-11-23', kind: 'month' });
    serve(r);
    mount();
    await screen.findByTestId('pnl-lines-table');
    const read = (row: string, c: ColKey) => Number((cell(row, c).childNodes[0]?.textContent ?? '').replace(/[^\d-−]/g, '').replace('−', '-'));
    for (const row of ['grossSales', 'netSales', 'cogs', 'contribution']) {
      expect(PNL_LINES.reduce((s, l) => s + read(row, l), 0), row).toBe(read(row, 'total'));
    }
  });
});

describe('F2b · solo súper-admin', () => {
  it('operador: ni la sección ni la petición de dinero', async () => {
    role.isSuperAdmin = false;
    const spy = serve(report());
    const cal = vi.spyOn(api, 'getPnlCalendar');
    mount();
    await screen.findByTestId('period-selector');
    expect(screen.queryByTestId('pnl-lines')).toBeNull();
    expect(screen.queryByTestId('pnl-consolidated')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(cal).not.toHaveBeenCalled();
  });
  it('súper-admin: 422 de la ruta de líneas ⇒ vuelve a «Este mes» con aviso (respaldo)', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'getPnl').mockResolvedValue({ ...mockPnl });
    vi.spyOn(api, 'getPnlCalendar').mockResolvedValue(undefined as never);
    vi.spyOn(api, 'getPnlReport').mockImplementation(async (r) => {
      if (r?.kind === 'quarter') throw new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x' });
      return report();
    });
    renderWithProviders(<M7View initialPeriod={periodFor('quarter', '2026-11-23')} />, 'es');
    expect(await screen.findByText('Ese periodo no es válido: se muestra Este mes.')).toBeInTheDocument();
    await screen.findByTestId('pnl-lines-table');
  });
});
