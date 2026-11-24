import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import * as api from '@/lib/api';
import { mockPnl } from '@/lib/mock/fixtures';
import { mockStatementOf } from '@/lib/mock/period-compare';
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
    period: { from: '2026-11-01', to: '2026-11-23', kind: 'month', days: 23, timezone: 'America/Mexico_City' },
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
    const prev = (i: number) => within(cells[i]).getByTestId('cmp-prev').textContent ?? '';
    const vari = (i: number) => within(cells[i]).getByTestId('cmp-var').textContent ?? '';
    expect(prev(0)).toContain('10,000.00'); // 1,000,000 ¢ = $10,000.00 (ventas)
    expect(vari(0)).toContain('+22.2 %'); // 2 222 pb tal cual, NO 111 111/1 000 000
    expect(vari(0)).toContain('1,111.11'); // deltaCents del servidor, NO cents − previousCents
    expect(vari(4)).toContain('+55.6 %');
    expect(vari(5)).toContain('−6.7 %');
    expect(vari(5)).toContain('18.00');
    expect(prev(7)).toContain('−'); // anterior negativo se pinta con su signo
    expect(vari(7)).toContain('+550 %');
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

    serve(pnl({ previousPeriod: { ...PREV, clamped: true } }, 'partial', '2026-10-12'));
    renderWithProviders(<M7View initialPeriod={month} />, 'es');
    const partial = await screen.findByTestId('pnl-compare');
    expect(partial).toHaveTextContent('contra lo que hay (datos desde 12 oct 2026)');
    expect(partial).toHaveAttribute('data-basis', 'partial');
    expect(screen.getByTestId('pnl-compare-clamped')).toHaveTextContent('El periodo anterior es más corto y se usó completo.');
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
});
