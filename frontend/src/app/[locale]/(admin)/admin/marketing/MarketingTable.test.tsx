/**
 * Candados del vocabulario de celdas del Panel de Marketing (`DESIGN_SYSTEM §MKT-UX.5`, §MKT-UX.16):
 * UX-MKT-1 (no medido ≠ 0), -2 (< 5 / Oculto / —), -3 (0 es dato), -4 (el significado es texto), -5 (nota al pie),
 * -6 (pesos, no centavos), -14 (texto de fuera como texto). Las filas suprimidas llegan con la forma del servidor v1.106
 * (C-P1, `sealHiddenRows`): `'< 5'`/`'oculta'` en el conteo y `'oculta'` en el resto; `null` es «—» siempre.
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
      <MarketingTable table={table({ id: 'a4', measured: false, columns: [], notMeasuredReason: 'NO MEDIDO — GA4 sin encender' })} />,
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
      { etapa: 'Aceptadas', n: '< 5', mxn: 'oculta' },
      { etapa: 'Sin monto', n: 7, mxn: null },
      { etapa: 'Cero', n: 0, mxn: 0 },
    ],
  });

  it('«< 5» visible + sr-only; el MX$ `oculta` de esa fila ⇒ «Oculto»; null en fila sin «< 5» ⇒ «—»', () => {
    renderWithProviders(<MarketingTable table={t} />);
    const rows = desktop().getAllByRole('row');
    expect(rows[2]).toHaveTextContent('< 5');
    expect(rows[2]).toHaveTextContent('menos de 5, oculto por privacidad');
    expect(within(rows[2]).getByText('Oculto')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('oculto por privacidad');
    expect(within(rows[3]).getByText('—')).toBeInTheDocument();
    expect(rows[3]).not.toHaveTextContent('Oculto');
  });

  it('UX-MKT-3: el número 0 se pinta «0» y «MX$0.00», nunca «—» ni «Oculto»', () => {
    renderWithProviders(<MarketingTable table={t} />);
    const zero = desktop().getAllByRole('row')[4];
    expect(within(zero).getByText('0')).toBeInTheDocument();
    expect(within(zero).getByText('MX$0.00')).toBeInTheDocument();
    expect(zero.textContent).not.toMatch(/—|Oculto/);
  });

  it('UX-MKT-6: el dinero llega en PESOS y se pinta tal cual (1250 ⇒ MX$1,250.00), sin dividir', () => {
    renderWithProviders(<MarketingTable table={t} />);
    expect(desktop().getAllByRole('row')[1]).toHaveTextContent('MX$1,250.00');
  });

  it('la fila «Otros (< 5 c/u)» se traduce por clave en inglés y conserva su posición', () => {
    renderWithProviders(
      <MarketingTable table={table({ rows: [{ etapa: 'A', n: 9, mxn: 1 }, { etapa: 'Otros (< 5 c/u)', n: '< 5', mxn: 'oculta' }] })} />,
      'en',
    );
    const rows = desktop().getAllByRole('row');
    expect(rows[2]).toHaveTextContent('Others (< 5 each)');
    expect(rows[2]).toHaveTextContent('Hidden');
  });
});

describe('`oculta` (§MKT.G.10, v1.103) · supresión coherente mes↔semanas', () => {
  it('un conteo `oculta` (y su MX$ `oculta`, C-P1) se lee «Oculto» en texto visible; activa la nota al pie', () => {
    renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'Mewtwo', n: 'oculta', mxn: 'oculta' }] })} />);
    const row = desktop().getAllByRole('row')[1];
    expect(within(row).getAllByText('Oculto')).toHaveLength(2);
    expect(row.textContent).not.toContain('oculta');
    expect(screen.getByTestId('mkt-footnote')).toBeInTheDocument();
  });
});

describe('UX-MKT-5 · nota al pie', () => {
  it('con alguna celda «< 5» u «Oculto» sale la nota; sin ellas, no', () => {
    const { unmount } = renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'x', n: '< 5', mxn: null }] })} />);
    expect(screen.getByTestId('mkt-footnote')).toHaveTextContent('< 5 significa menos de 5.');
    unmount();
    renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'x', n: 9, mxn: 10 }] })} />);
    expect(screen.queryByTestId('mkt-footnote')).toBeNull();
  });
});

describe('vacío ≠ no medido', () => {
  it('tabla medida sin filas: «Sin registros en este periodo.» y el aviso de que es dato', () => {
    renderWithProviders(<MarketingTable table={table()} />);
    const empty = within(screen.getByTestId('mkt-table-a3')).getAllByTestId('mkt-table-empty')[0];
    expect(empty).toHaveTextContent('Sin registros en este periodo.');
    expect(empty).toHaveTextContent('Eso también es un dato: no hubo.');
    expect(screen.queryByText('No medido todavía')).toBeNull();
  });
});

describe('régimen de celdas (`privacy`) · lo aplica el servidor', () => {
  it('`exact` (vista del dueño): conteos pequeños llegan como número y se pintan tal cual, sin nota al pie', () => {
    renderWithProviders(<MarketingTable table={table({ rows: [{ etapa: 'x', n: 3, mxn: 450 }] })} />);
    const row = desktop().getAllByRole('row')[1];
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('MX$450.00');
    expect(screen.queryByTestId('mkt-footnote')).toBeNull();
  });
});

describe('UX-MKT-14 · lo de fuera es texto', () => {
  it('una etiqueta con <script> se ve literal y no crea nodos', () => {
    renderWithProviders(
      <MarketingTable table={table({ rows: [{ etapa: '<script>alert(1)</script>', n: 9, mxn: 1 }] })} />,
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
        <MarketingTable table={table({ rows: [{ etapa: 'x', n: '< 5', mxn: 'oculta' }, { etapa: 'y', n: 9, mxn: null }] })} />
        <MarketingTable table={table({ id: 'a4', measured: false, columns: [], notMeasuredReason: 'r' })} />
      </>,
    );
    const all = document.body.textContent ?? '';
    for (const word of ['< 5', 'Oculto', 'No medido todavía', '—']) expect(all).toContain(word);
    expect(document.querySelectorAll('[data-cell][title], [data-cell] [title]')).toHaveLength(0);
  });
});

/** C-P1 (API_CONTRACT §MKT.H.11 / §MKT.G.5, v1.106, TL-MKT2-C1): `null` = «—» siempre; fila suprimida = `'oculta'`. */
describe('C-P1 · null siempre «—»; la fila suprimida del servidor v1.106 se lee «Oculto» entera', () => {
  const cols = [
    { key: 'etapa', labelEs: 'Etapa', kind: 'text' as const },
    { key: 'n', labelEs: 'Pedidos', kind: 'count' as const },
    { key: 'vistas', labelEs: 'Vistas', kind: 'count' as const },
    { key: 't', labelEs: 'Tiempo', kind: 'number' as const },
    { key: 'pct', labelEs: '%', kind: 'pct' as const },
    { key: 'mxn', labelEs: 'MX$', kind: 'money' as const },
  ];

  it('fila sin supresión: null en count, number, pct y money ⇒ «—» (cuatro), nunca «Oculto»', () => {
    renderWithProviders(
      <MarketingTable table={table({ id: 'c1', columns: cols, rows: [{ etapa: 'A', n: 12, vistas: null, t: null, pct: null, mxn: null }] })} />,
    );
    const row = desktop('c1').getAllByRole('row')[1];
    expect(within(row).getAllByText('—')).toHaveLength(4);
    expect(row).not.toHaveTextContent('Oculto');
  });

  it('fila suprimida (forma v1.106): «< 5» en el conteo y `oculta` en el resto ⇒ «Oculto» en cada celda no texto', () => {
    renderWithProviders(
      <MarketingTable
        table={table({ id: 'c1', columns: cols, rows: [{ etapa: 'B', n: '< 5', vistas: 'oculta', t: 'oculta', pct: 'oculta', mxn: 'oculta' }] })}
       
      />,
    );
    const row = desktop('c1').getAllByRole('row')[1];
    expect(within(row).getAllByText('Oculto')).toHaveLength(4);
    expect(row).not.toHaveTextContent('—');
  });

  /**
   * TL-MKT2b-c (2026-10-19) cierra FE-MKT2-4: sin compatibilidad pre-v1.106. La pantalla NO adivina por vecindad: un
   * `null` en una fila con «< 5»/«oculta» es «—» en todo `kind` (el servidor ya selló esa fila con `'oculta'`).
   * Muerde si vuelve la rama `LEGACY_NULL_HIDDEN_COMPAT` (MX$/% `null` + fila suprimida ⇒ «Oculto»).
   */
  it('null en una fila suprimida ⇒ «—» en count, number, pct y money; nunca «Oculto» por vecindad', () => {
    for (const cell of [null, undefined]) expect(cellMeaning(cell)).toBe('none');
    renderWithProviders(
      <MarketingTable table={table({ id: 'c1', columns: cols, rows: [{ etapa: 'B', n: '< 5', vistas: null, t: null, pct: null, mxn: null }] })} />,
    );
    const row = desktop('c1').getAllByRole('row')[1];
    expect(within(row).getAllByText('—')).toHaveLength(4);
    expect(row).not.toHaveTextContent('Oculto');
  });
});
