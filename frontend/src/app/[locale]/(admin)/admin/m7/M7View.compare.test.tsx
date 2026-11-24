import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import * as api from '@/lib/api';
import { mockPnl } from '@/lib/mock/fixtures';
import { mockStatementOf } from '@/lib/mock/period-compare';
import { expectOneDecimalPercents } from '@/test/pct';
import { periodFor } from '@/lib/reports/period';
import type { ComparisonBasis, MoneyDeltaDTO, PnlDTO } from '@/types/contract';

/**
 * §REPORTES-CEO F2a — Finanzas: la columna «vs periodo anterior» de las 8 cifras sale TAL CUAL del servidor. Los números
 * de estos fixtures son INCONSISTENTES a propósito (deltaCents ≠ cents − previousCents, deltaBps ≠ deltaCents/previous):
 * si el navegador calculara algo, la pantalla diría otra cosa que el JSON.
 */
const d = (cents: number, previousCents: number, deltaCents: number, deltaBps: number | null): MoneyDeltaDTO => ({ cents, previousCents, deltaCents, deltaBps });
const FIG = {
  salesCents: d(1_302_500, 1_000_000, 111_111, 2_222),
  returnsAndRefundsCents: d(100_000, 80_000, 20_000, null),
  netRevenueCents: d(1_202_500, 920_000, 222_222, 3_333),
  cogsCents: d(640_000, 500_000, 33_333, 4_444),
  stripeFeesCents: d(48_300, 40_000, 8_300, 5_555),
  shippingCostCents: d(31_800, 30_000, -1_800, -666),
  grossMarginCents: d(450_000, 300_000, 150_000, 5_000),
  netResultCents: d(450_000, -100_000, 550_000, 55_000),
};
const PREV = { from: '2026-10-01', to: '2026-10-23', clamped: false };

function pnl(over: Partial<PnlDTO> = {}, basis: ComparisonBasis = 'complete', dataSince: string | null = null): PnlDTO {
  return {
    ...mockPnl,
    statement: mockStatementOf(mockPnl),
    period: { from: '2026-11-01', to: '2026-11-23', kind: 'month', days: 23, timezone: 'America/Mexico_City', toDate: true },
    previousPeriod: PREV,
    comparison: { basis, dataSince, figures: FIG },
    ...over,
  };
}
const serve = (p: PnlDTO) => vi.spyOn(api, 'getPnl').mockResolvedValue(p);
// «Hoy» fijo: el año del rótulo («1–23 nov» vs «1–23 nov 2026») depende de la fecha de México.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const month = periodFor('month', '2026-11-23');

describe('§2 F2a · Finanzas: estado de resultados contra el periodo anterior', () => {
  it('las 8 cifras llevan su anterior y su variación del servidor; el kind del atajo viaja a la ruta', async () => {
    const spy = serve(pnl());
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    await screen.findByTestId('pnl-statement');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'month', from: month.from, to: month.to }));
    const cells = screen.getAllByTestId('cmp-cells');
    // 7 renglones del bloque (ventas, devoluciones, ventas netas, costo, comisión, envío, margen) + el resultado neto.
    expect(cells).toHaveLength(8);
    // M-9: 7 porcentajes (el de devoluciones es «—»), todos con UN decimal fijo.
    expect(expectOneDecimalPercents(document.body.textContent ?? '', 7)).toBe(7);
  });

  /**
   * I-2 (qa): cada renglón lleva SU cifra — una mutación que cambie `cell('cogsCents')` por `cell('stripeFeesCents')` (o cualquier
   * par) pinta el anterior/variación de otra fila. Los 8 anterior/variación del fixture son distintos entre sí y se verifican por
   * rótulo (no por posición); `deltaBps` y `deltaCents` salen del JSON, no de cents − previousCents.
   */
  it('renglón ↔ cifra: cada una de las 8 filas pinta SU anterior, SU variación y SU diferencia (candado por rótulo)', async () => {
    serve(pnl());
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    await screen.findByTestId('pnl-statement');
    const rowOfSpan = (label: string) => screen.getAllByText(label, { selector: 'span' }).map((e) => e.closest('[data-testid="pnl-subtotal"],[data-testid="stmt-line"]')).find(Boolean) as HTMLElement;
    const rows: [string, HTMLElement, string, string, string | null, string | null][] = [
      ['salesCents', rowOfSpan('Ventas'), '10,000.00', '+22.2 %', '1,111.11', null],
      ['returnsAndRefundsCents', screen.getByText('Devoluciones y reembolsos', { selector: 'p' }).parentElement as HTMLElement, '800.00', '—', null, '+'],
      ['netRevenueCents', rowOfSpan('Ventas netas'), '9,200.00', '+33.3 %', '2,222.22', null],
      ['cogsCents', rowOfSpan('Costo de lo vendido'), '5,000.00', '+44.4 %', '333.33', null],
      ['stripeFeesCents', rowOfSpan('Comisiones Stripe'), '400.00', '+55.6 %', '83.00', null],
      ['shippingCostCents', rowOfSpan('Costo de envío (paquetería, neto)'), '300.00', '−6.7 %', '18.00', null],
      ['grossMarginCents', rowOfSpan('Margen bruto'), '3,000.00', '+50.0 %', '1,500.00', null],
      ['netResultCents', screen.getByTestId('cmp-net'), '1,000.00', '+550.0 %', '5,500.00', null],
    ].map(([k, el, a, b, c, d]) => [k, el, a, b, c, d] as [string, HTMLElement, string, string, string | null, string | null]);
    expect(rows.every(([, el]) => !!el)).toBe(true);
    for (const [fig, row, prev, pct, delta] of rows) {
      const c = within(row).getByTestId('cmp-cells');
      const p = within(c).getByTestId('cmp-prev').textContent ?? '';
      const v = within(c).getByTestId('cmp-var').textContent ?? '';
      expect(p, `${fig} anterior`).toContain(prev);
      expect(v, `${fig} variación`).toContain(pct);
      if (delta) expect(v, `${fig} diferencia`).toContain(delta);
    }
    // Ninguna fila repite el anterior de otra (si dos coincidieran, el candado no distinguiría un cruce).
    const prevs = rows.map(([, row]) => within(within(row).getByTestId('cmp-cells')).getByTestId('cmp-prev').textContent);
    expect(new Set(prevs).size).toBe(8);
    expect(within(rows[7][1]).getByTestId('cmp-prev').textContent).toContain('−'); // anterior negativo con su signo
  });

  it('deltaBps null ⇒ «—» (nunca 0 %) pero el importe anterior se conserva', async () => {
    serve(pnl());
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    await screen.findByTestId('pnl-statement');
    const returns = screen.getAllByTestId('cmp-cells')[1];
    expect(within(returns).getByTestId('cmp-var').textContent).toContain('—');
    expect(within(returns).getByTestId('cmp-var').textContent).not.toContain('%');
    expect(within(returns).getByTestId('cmp-prev').textContent).toContain('800.00');
  });

  it('basis none ⇒ «—» en anterior y variación y rótulo «sin periodo anterior para comparar» (aunque el JSON traiga números)', async () => {
    serve(pnl({}, 'none'));
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    await screen.findByTestId('pnl-statement');
    for (const c of screen.getAllByTestId('cmp-cells')) {
      expect(within(c).getByTestId('cmp-prev').textContent).toContain('—');
      expect(within(c).getByTestId('cmp-var').textContent).not.toContain('%');
    }
    expect(screen.getByTestId('pnl-compare')).toHaveAttribute('data-basis', 'none');
    expect(screen.getByTestId('pnl-compare')).toHaveTextContent('Sin ventas en el periodo anterior (1–23 oct)');
  });

  it('rótulos: «Mes a la fecha · 1–23 nov comparado con 1–23 oct»; partial ⇒ «contra lo que hay (datos desde …)»; clamped ⇒ aviso', async () => {
    serve(pnl());
    const first = renderWithProviders(<M7View initialPeriod={month} />, 'es');
    const note = await screen.findByTestId('pnl-compare');
    expect(note).toHaveTextContent('Mes a la fecha · 1–23 nov comparado con 1–23 oct');
    expect(note).not.toHaveTextContent('contra lo que hay');
    expect(screen.queryByTestId('pnl-compare-clamped')).toBeNull();
    first.unmount();

    serve(pnl({}, 'partial', '2026-10-12'));
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    const partial = await screen.findByTestId('pnl-compare');
    expect(partial).toHaveTextContent('contra lo que hay (datos desde 12 oct 2026)');
    expect(partial).toHaveAttribute('data-basis', 'partial');
    // Nunca jerga interna en pantalla.
    expect(document.body.textContent).not.toMatch(/MTD|YTD|basis|clamped/);
  });

  it('«Todo» (comparison null) ⇒ sin columnas y «sin periodo anterior para comparar»', async () => {
    const spy = serve(pnl({ period: null, previousPeriod: null, comparison: null }));
    renderWithProviders(<M7View initialPeriod={periodFor('all', '2026-11-23')} />, 'es');
    await screen.findByTestId('pnl-statement');
    expect(spy).toHaveBeenCalledWith({});
    expect(screen.queryByTestId('cmp-cells')).toBeNull();
    expect(screen.queryByTestId('cmp-header')).toBeNull();
    expect(screen.getByTestId('pnl-compare')).toHaveAttribute('data-basis', 'none');
  });

  it('servidor anterior (sin period/comparison) ⇒ no se rompe ni inventa columnas', async () => {
    serve({ ...mockPnl, statement: mockStatementOf(mockPnl) });
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    await screen.findByTestId('pnl-statement');
    expect(screen.queryByTestId('cmp-cells')).toBeNull();
  });

  it('el candado de la fórmula (UX-PNL-1) no se mueve: la columna nueva no usa pnl-amount ni stmt-amount', async () => {
    serve(pnl());
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    await screen.findByTestId('pnl-statement');
    for (const c of screen.getAllByTestId('cmp-cells')) {
      expect(within(c).queryByTestId('pnl-amount')).toBeNull();
      expect(within(c).queryByTestId('stmt-amount')).toBeNull();
    }
    expect(screen.getAllByTestId('pnl-line').length).toBeGreaterThan(0);
  });

  it('en inglés: «Month to date · Nov 1–23 compared with Oct 1–23»', async () => {
    serve(pnl());
    renderWithProviders(<M7View initialPeriod={month} />, 'en');
    expect(await screen.findByTestId('pnl-compare')).toHaveTextContent('Month to date · Nov 1–23 compared with Oct 1–23');
  });

  it('operador / sin permiso (403): no hay rótulo ni columnas; los tipos toleran null en period/previousPeriod/comparison', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    vi.spyOn(api, 'getPnl').mockRejectedValue(new ApiClientError(403, { code: 'FORBIDDEN', message: 'no' }));
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    await screen.findByTestId('period-selector');
    expect(screen.queryByTestId('pnl-compare')).toBeNull();
    expect(screen.queryByTestId('cmp-cells')).toBeNull();
    vi.restoreAllMocks();
    serve({ ...mockPnl, period: null, previousPeriod: null, comparison: null });
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    expect((await screen.findAllByTestId('pnl-compare')).at(-1)).toHaveAttribute('data-basis', 'none');
  });

  it('422 del servidor ⇒ vuelve a «Este mes» con aviso (m-19); en el defecto no hay bucle', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    const spy = vi.spyOn(api, 'getPnl').mockImplementation(async (r) => {
      if (r?.kind === 'quarter') throw new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'periodo' });
      return pnl();
    });
    renderWithProviders(<M7View initialPeriod={periodFor('quarter', '2026-11-23')} />, 'es');
    expect(await screen.findByText('Ese periodo no es válido: se muestra Este mes.')).toBeInTheDocument();
    await screen.findByTestId('pnl-statement');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'month' }));
    expect(screen.getByRole('button', { name: 'Este mes' })).toHaveAttribute('aria-pressed', 'true');
  });

  // M-8 (m-2, m-7): `toDate` y `clamped` salen de la respuesta; 30-mar-2027 recorta a «28 feb»; 31-mar es periodo cerrado.
  const mar = (to: string, toDate: boolean, prevTo: string, clamped: boolean) =>
    pnl({
      period: { from: '2027-03-01', to, kind: 'month', days: Number(to.slice(8)), timezone: 'America/Mexico_City', toDate },
      previousPeriod: { from: '2027-02-01', to: prevTo, clamped },
    });
  it('M-8 clamped (es): 30-mar-2027 ⇒ «no tiene día 30 … (28 feb)» y «Mes a la fecha»', async () => {
    serve(mar('2027-03-30', true, '2027-02-28', true));
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    const note = await screen.findByTestId('pnl-compare');
    expect(note).toHaveTextContent('Mes a la fecha');
    expect(screen.getByTestId('pnl-compare-clamped')).toHaveTextContent('El mes de comparación no tiene día 30: se comparó hasta su último día (28 feb).');
    expect(document.body.textContent).not.toMatch(/MTD|YTD|basis|clamped/);
  });
  it('M-8 clamped (en): «The comparison month has no day 30: compared through its last day (Feb 28).»', async () => {
    serve(mar('2027-03-30', true, '2027-02-28', true));
    renderWithProviders(<M7View initialPeriod={month} />, 'en');
    await screen.findByTestId('pnl-compare');
    expect(screen.getByTestId('pnl-compare-clamped')).toHaveTextContent('The comparison month has no day 30: compared through its last day (Feb 28).');
  });
  it('M-8 31-mar (periodo cerrado, toDate:false): sin «a la fecha», sin clamped y contra febrero completo', async () => {
    serve(mar('2027-03-31', false, '2027-02-28', false));
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    const note = await screen.findByTestId('pnl-compare');
    expect(note).not.toHaveTextContent('a la fecha');
    expect(note).toHaveTextContent('comparado con 1–28 feb');
    expect(screen.queryByTestId('pnl-compare-clamped')).toBeNull();
  });
  it('m-7: sin `toDate` en la respuesta (servidor viejo) o con toDate:false NUNCA hay «a la fecha», aunque el atajo sea «Este mes»', async () => {
    const noFlag = pnl();
    noFlag.period = { ...noFlag.period!, toDate: undefined };
    serve(noFlag);
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    expect(await screen.findByTestId('pnl-compare')).not.toHaveTextContent('a la fecha');
  });
});
