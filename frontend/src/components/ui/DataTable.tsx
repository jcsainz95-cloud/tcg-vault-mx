'use client';

import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  numeric?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}

/**
 * DataTable / cola de trabajo (DESIGN_SYSTEM §7.7).
 * Responsive: en < md cada fila colapsa a un bloque (label: valor).
 *
 * Dirección 5a: la tabla pierde el fondo y el hover coloreado; se apoya solo en
 * reglas y en la numeración monoespaciada de las cabeceras.
 */
export function DataTable<T>({ columns, rows, rowKey }: DataTableProps<T>) {
  return (
    <div className="w-full">
      {/* Tabla (md+) */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="border-y border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn('eyebrow py-3.5 font-medium', c.align === 'right' || c.numeric ? 'text-right' : 'text-left')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'py-4 pr-5 text-sm text-text last:pr-0',
                    (c.align === 'right' || c.numeric) && 'text-right tabular font-medium',
                  )}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Bloques (< md) */}
      <div className="md:hidden">
        {rows.map((row) => (
          <div key={rowKey(row)} className="border-b border-border py-4 first:border-t">
            {columns.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-3 py-1.5">
                <span className="eyebrow">{c.header}</span>
                <span className={cn('text-sm text-text', c.numeric && 'tabular font-medium')}>
                  {c.render(row)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
