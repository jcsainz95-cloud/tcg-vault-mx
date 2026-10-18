/**
 * Candados del vocabulario de celdas del Panel de Marketing (`DESIGN_SYSTEM §MKT-UX.5`, §MKT-UX.16):
 * UX-MKT-1 (no medido ≠ 0), -2 (< 5 / Oculto / —), -3 (0 es dato), -4 (el significado es texto), -5 (nota al pie),
 * -6 (pesos, no centavos), -14 (texto de fuera como texto). Más el régimen `privacy` (decisión del dueño «si cifras
 * exactas», HECHOS 2026-10-18; campo pendiente de contrato): `exact` nunca dice «Oculto»; ausente ⇒ `small_cells`.
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { MarketingAggTable } from '@/types/contract';
import { MarketingTable, cellMeaning } from './MarketingTable';

function table(over: Partial<MarketingAggTable> = {}): MarketingAggTable {
  return {
    id: 'a3',
    title: 'Cotizaciones de buylist',
    source: 'BD',
    columns: [
      { key: 'etapa', labelEs: 'Etapa', kind: 'text' },
      { key: 'n', labelEs: 'Solicitudes', kind: 'count' },
      { key: 'mxn', labelEs: 'MX$', kind: 'money' },
    ],
    rows: [],
    measured: true,
    ...over,
  };
}

/** La versión de escritorio (la de tarjetas repite los mismos textos, oculta por CSS fuera de su ancho). */
function desktop(id = 'a3') {
  return within(screen.getByTestId(`mkt-table-${id}`).querySelector('table') as HTMLElement);
}

describe('UX-MKT-1 · tabla no medida', () => {
  it('pinta «No medido todavía» + el motivo y ningún 0, — ni celda vacía (sin columnas, como el servidor hoy)', () => {
    renderWithProviders(
      <MarketingTable table={table({ id: 'a4', measured: false, columns: [], notMeasuredReason: 'NO MEDIDO — GA4 sin encender' })} privacy="small_cells" />,
    );
    const sec = screen.getByTestId('mkt-table-a4');
    const block = within(sec).getByRole('group', { name: 'Cotizaciones de buylist: no medido todavía' });
    expect(block).toHaveTextContent('No medido todavía');
    expect(block).toHaveTextContent('NO MEDIDO — GA4 sin encender');
    expect(block).toHaveTextContent('Esto no es cero: todavía no hay dato.');
    // Ninguna celda pintada (ni «0» ni «—»): el motivo del servidor puede llevar «—» en su texto, las celdas no.
    expect(sec.querySelectorAll('[data-cell]')).toHaveLength(0);
    expect(sec.textContent).not.toMatch(/(^|\s)0(\s|$)/);
    expect(sec.querySelector('td:empty')).toBeNull();
  });

  it('con columnas conserva la cabecera y el cuerpo es UNA fila con el bloque (aunque lleguen filas)', () => {
    renderWithProviders(
      <MarketingTable
        table={table({ measured: false, notMeasuredReason: 'motivo', rows: [{ etapa: 'x', n: 0, mxn: 0 }] })}
        privacy="small_cells"
      />,
    );
    const d = desktop();
    expect(d.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Etapa', 'Solicitudes', 'MX$']);
    expect(d.getAllByRole('row')).toHaveLength(2);
    expect(d.getByRole('group')).toHaveTextContent('motivo');
    expect(d.queryByText('0')).toBeNull();
  });
});

describe('UX-MKT-2/3/6 · las celdas', () => {
  const t = table({
    rows: [
      { etapa: 'Enviadas', n: 12, mxn: 1250 },
      { etapa: 'Aceptadas', n: '< 5', mxn: null },
      { etapa: 'Sin monto', n: 7, mxn: null },
      { etapa: 'Cero', n: 0, mxn: 0 },
    ],
  });

  it('«< 5» visible + sr-only; null de dinero en fila con «< 5» ⇒ «Oculto»; null en fila sin «< 5» ⇒ «—»', () => {
    renderWithProviders(<MarketingTable table={t} privacy="small_cells" />);
    const rows = desktop().getAllByRole('row');
    expect(rows[2]).toHaveTextContent('< 5');
    expect(rows[2]).toHaveTextContent('menos de 5, oculto por privacidad');
    expect(within(rows[2]).getByText('Oculto')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('oculto por privacidad');
    expect(within(rows[3]).getByText('—')).toBeInTheDocument();
    expect(rows[3]).not.toHaveTextContent('Oculto');
  });

  it('UX-MKT-3: el número 0 se pinta «0» y «MX$0.00», nunca «—» ni «Oculto»', () => {
    renderWithProviders(<MarketingTable table={t} privacy="small_cells" />);
    const zero = desktop().getAllByRole('row')[4];
    expect(within(zero).getByText('0')).toBeInTheDocument();
    expect(within(zero).getByText('MX$0.00')).toBeInTheDocument();
    expect(zero.textContent).not.toMatch(/—|Oculto/);
  });

  it('UX-MKT-6: el dinero llega en PESOS y se pinta tal cual (1250 ⇒ MX$1,250.00), sin dividir', () => {
    renderWithProviders(<MarketingTable table={t} privacy="small_cells" />);
    expect(desktop().getAllByRole('row')[1]).toHaveTextContent('MX$1,250.00');
  });

  it('la fila «Otros (< 5 c/u)» se traduce por clave en inglés y conserva su posición', () => {
    renderWithProviders(
      <MarketingTable table={table({ rows: [{ etapa: 'A', n: 9, mxn: 1 }, { etapa: 'Otros (< 5 c/u)', n: '< 5', mxn: null }] })} privacy="small_cells" />,
      'en',
    );
    const rows = desktop().getAllByRole('row');
    expect(rows[2]).toHaveTextContent('Others (< 5 each)');
    expect(rows[2]).toHaveTextContent('Hidden');
  });
});

describe('`oculta` (§MKT.G.10, v1.103) · supresión coherente mes↔semanas', () => {
  it('un conteo `oculta` se lee «Oculto» en texto visible y arrastra su MX$ `null` a «Oculto»; activa la nota al pie', () => {
    renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'Mewtwo', n: 'oculta', mxn: null }] })} privacy="small_cells" />);
    const row = desktop().getAllByRole('row')[1];
    expect(within(row).getAllByText('Oculto')).toHaveLength(2);
    expect(row.textContent).not.toContain('oculta');
    expect(screen.getByTestId('mkt-footnote')).toBeInTheDocument();
  });
});

describe('UX-MKT-5 · nota al pie', () => {
  it('con alguna celda «< 5» u «Oculto» sale la nota; sin ellas, no', () => {
    const { unmount } = renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'x', n: '< 5', mxn: null }] })} privacy="small_cells" />);
    expect(screen.getByTestId('mkt-footnote')).toHaveTextContent('< 5 significa menos de 5.');
    unmount();
    renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'x', n: 9, mxn: 10 }] })} privacy="small_cells" />);
    expect(screen.queryByTestId('mkt-footnote')).toBeNull();
  });
});

describe('vacío ≠ no medido', () => {
  it('tabla medida sin filas: «Sin registros en este periodo.» y el aviso de que es dato', () => {
    renderWithProviders(<MarketingTable table={table()} privacy="small_cells" />);
    const empty = within(screen.getByTestId('mkt-table-a3')).getAllByTestId('mkt-table-empty')[0];
    expect(empty).toHaveTextContent('Sin registros en este periodo.');
    expect(empty).toHaveTextContent('Eso también es un dato: no hubo.');
    expect(screen.queryByText('No medido todavía')).toBeNull();
  });
});

describe('régimen de celdas (`privacy`)', () => {
  it('`exact`: un null de dinero en una fila con «< 5» NO se lee «Oculto» (nada se oculta): es «—»', () => {
    const col = { key: 'mxn', labelEs: 'MX$', kind: 'money' as const };
    expect(cellMeaning(null, col, true, 'small_cells')).toBe('hidden');
    expect(cellMeaning(null, col, true, 'exact')).toBe('none');
    renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'x', n: 3, mxn: 450 }] })} privacy="exact" />);
    const row = desktop().getAllByRole('row')[1];
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('MX$450.00');
    expect(screen.queryByTestId('mkt-footnote')).toBeNull();
  });
});

describe('UX-MKT-14 · lo de fuera es texto', () => {
  it('una etiqueta con <script> se ve literal y no crea nodos', () => {
    renderWithProviders(
      <MarketingTable table={table({ rows: [{ etapa: '<script>alert(1)</script>', n: 9, mxn: 1 }] })} privacy="small_cells" />,
    );
    const sec = screen.getByTestId('mkt-table-a3');
    expect(sec.querySelector('script')).toBeNull();
    expect(desktop().getByText('<script>alert(1)</script>')).toBeInTheDocument();
  });
});

describe('UX-MKT-4 · el significado vive en el TEXTO del DOM, no en color ni en `title`', () => {
  it('«< 5», «Oculto», «No medido todavía» y «—» son nodos de texto; ninguna celda usa `title`', () => {
    renderWithProviders(
      <>
        <MarketingTable table={table({ rows: [{ etapa: 'x', n: '< 5', mxn: null }, { etapa: 'y', n: 9, mxn: null }] })} privacy="small_cells" />
        <MarketingTable table={table({ id: 'a4', measured: false, columns: [], notMeasuredReason: 'r' })} privacy="small_cells" />
      </>,
    );
    const all = document.body.textContent ?? '';
    for (const word of ['< 5', 'Oculto', 'No medido todavía', '—']) expect(all).toContain(word);
    expect(document.querySelectorAll('[data-cell][title], [data-cell] [title]')).toHaveLength(0);
  });
});
