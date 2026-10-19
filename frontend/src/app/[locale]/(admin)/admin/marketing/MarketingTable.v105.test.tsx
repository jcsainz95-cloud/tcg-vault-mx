/**
 * v1.105 (§MKT.H.9) · columnas nuevas del servidor, con la forma literal de `marketing-analytics.service.ts`: `pct`
 * llega en PUNTOS (`Math.round(x * 1000) / 10`: a5, d2, f3) y `tiempoMedio` (c1) en segundos con 1 decimal,
 * `kind: 'number'`. Comprueba que la pantalla los pinta con su unidad y que un `null` no se vuelve 0.
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { MarketingAggTable } from '@/types/contract';
import { MarketingTable } from './MarketingTable';

function desktop(id: string) {
  return within(screen.getByTestId(`mkt-table-${id}`).querySelector('table') as HTMLElement);
}

const A5: MarketingAggTable = {
  id: 'a5',
  title: 'Embudo sesiones → compra',
  source: 'GA4',
  columns: [
    { key: 'paso', labelEs: 'Paso', tech: 'eventName', kind: 'text' },
    { key: 'n', labelEs: 'Nº', tech: 'eventCount', kind: 'count' },
    { key: 'pct', labelEs: '% sobre el paso anterior', kind: 'pct' },
  ],
  rows: [
    { paso: 'Sesiones', n: 400, pct: null },
    { paso: 'view_item', n: 50, pct: 12.5 },
  ],
  measured: true,
};

const C1: MarketingAggTable = {
  id: 'c1',
  title: 'Páginas y fichas más vistas',
  source: 'GA4',
  columns: [
    { key: 'pagina', labelEs: 'Página o ficha', tech: 'pagePath', kind: 'text' },
    { key: 'vistas', labelEs: 'Vistas', tech: 'screenPageViews', kind: 'count' },
    { key: 'usuarios', labelEs: 'Usuarios', tech: 'totalUsers', kind: 'count' },
    { key: 'tiempoMedio', labelEs: 'Tiempo medio por vista (s)', tech: 'userEngagementDuration / screenPageViews', kind: 'number' },
  ],
  rows: [{ pagina: '/es/catalog', vistas: 1200, usuarios: 300, tiempoMedio: 37.4 }],
  measured: true,
};

describe('v1.105 · a5 (pct) y c1 (tiempoMedio) se pintan con su unidad', () => {
  it('a5: 12.5 puntos ⇒ «12.5 %»; el pct null del primer paso ⇒ «—», nunca 0', () => {
    renderWithProviders(<MarketingTable table={A5} />);
    const rows = desktop('a5').getAllByRole('row');
    const first = [...rows[1].querySelectorAll('[data-cell]')].map((c) => c.textContent?.replace(/\s/g, ' '));
    const second = [...rows[2].querySelectorAll('[data-cell]')].map((c) => c.textContent?.replace(/\s/g, ' '));
    expect(first[first.length - 1]).toMatch(/^—/); // «—» + «sin dato» para el lector (UX-MKT-2)
    expect(first[first.length - 1]).not.toMatch(/\d/);
    // Puntos, no fracción: 12.5 ⇒ «12.5%» (si se leyera como fracción saldría «1,250%»).
    expect(second[second.length - 1]).toMatch(/^12[.,]5\s?%$/);
  });

  it('c1: tiempoMedio 37.4 (s) ⇒ «37.4», sin moneda ni %', () => {
    renderWithProviders(<MarketingTable table={C1} />);
    const d = desktop('c1');
    expect(d.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Tiempo medio por vista (s)');
    const cells = [...d.getAllByRole('row')[1].querySelectorAll('[data-cell]')].map((c) => c.textContent ?? '');
    expect(cells[cells.length - 1]).toMatch(/^37[.,]4$/);
    expect(cells[1]).toMatch(/^1[,.\s]?200$/);
  });
});
