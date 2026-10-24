/**
 * v1.109 (MKT-MEDIR-CS a; §MKT.G.4/§MKT.H.14) · la pantalla b pinta b5/b6 tal como los sirve el mock (que copia el servicio:
 * `marketing.parity.test.ts`): dos componentes `avisame`/`torneo`, sin MX$, y en `small_cells` cada uno «< 5» por separado.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { MarketingAggTable } from '@/types/contract';
import { mockMarketingPanel, mockMarketingPeriods } from '@/lib/mock/marketing';
import { MarketingTable } from './MarketingTable';

afterEach(() => window.localStorage.removeItem('tcg.mktPrivacy'));

function screenB(privacy: 'exact' | 'small_cells', month = false) {
  if (privacy === 'small_cells') window.localStorage.setItem('tcg.mktPrivacy', 'small_cells');
  const q = month ? { month: mockMarketingPeriods().closedMonths[0].month } : {};
  return mockMarketingPanel('b', q);
}

function renderTables(tables: MarketingAggTable[]) {
  renderWithProviders(
    <>
      {tables.map((t) => (
        <MarketingTable key={t.id} table={t} />
      ))}
    </>,
    'es',
  );
}

describe('pantalla b · b5/b6 del Card Show', () => {
  it('el mock sirve b1..b6 en el orden del catálogo, b5 con una fila por día del periodo y sin columnas de dinero', () => {
    const p = screenB('exact');
    expect(p.tables.map((t) => t.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
    const [b5, b6] = p.tables.slice(4);
    expect(b5.rows.map((r) => r.dia)).toEqual(
      Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${p.period.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)),
    );
    for (const t of [b5, b6]) {
      expect(t.columns.map((c) => c.key).slice(1)).toEqual(['avisame', 'torneo']);
      expect(t.columns.some((c) => c.kind === 'money')).toBe(false);
    }
    expect(screenB('exact', true).tables[4].rows.length).toBeGreaterThanOrEqual(28);
  });

  it('la pantalla pinta b5 y b6 con su título, sus dos columnas y sus notas', () => {
    const [, , , , b5, b6] = screenB('exact').tables;
    renderTables([b5, b6]);
    for (const t of [b5, b6]) {
      const box = screen.getByTestId(`mkt-table-${t.id}`);
      expect(within(box).getByRole('heading', { name: t.title })).toBeInTheDocument();
      const table = within(box.querySelector('table') as HTMLElement);
      expect(table.getByText('Avísame (registros confirmados)')).toBeInTheDocument();
      expect(table.getByText('Torneo (preinscripciones confirmadas)')).toBeInTheDocument();
      expect(box.textContent).not.toMatch(/MX\$/);
    }
    expect(within(screen.getByTestId('mkt-table-b6')).getAllByText('Sin UTM').length).toBeGreaterThan(0);
  });

  it('small_cells: «< 5» por componente (una fila puede tener avisame con número y torneo oculto)', () => {
    const b6 = screenB('small_cells').tables[5];
    const mixed = b6.rows.find((r) => typeof r.avisame === 'number' && r.torneo === '< 5');
    expect(mixed, 'fila con un componente visible y el otro oculto').toBeTruthy();
    renderTables([b6]);
    expect(within(screen.getByTestId('mkt-table-b6')).getAllByText('< 5').length).toBeGreaterThan(0);
  });
});
