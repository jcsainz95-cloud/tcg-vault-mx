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
 * Responsive: en < md cada fila colapsa a card (label: valor).
 */
export function DataTable<T>({ columns, rows, rowKey }: DataTableProps<T>) {
  return (
    <div className="w-full">
      {/* Tabla (md+) */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted',
                  c.align === 'right' || c.numeric ? 'text-right' : 'text-left',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border hover:bg-surface-2">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-3 py-3 text-sm text-text',
                    (c.align === 'right' || c.numeric) && 'text-right tabular',
                  )}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Cards (< md) */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <div key={rowKey(row)} className="rounded-lg border border-border bg-surface p-3">
            {columns.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-3 py-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  {c.header}
                </span>
                <span className={cn('text-sm text-text', c.numeric && 'tabular')}>{c.render(row)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
