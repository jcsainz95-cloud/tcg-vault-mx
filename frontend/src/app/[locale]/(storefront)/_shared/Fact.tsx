'use client';

import { cn } from '@/lib/cn';

/**
 * Celda de la ficha: etiqueta mono arriba, dato debajo, reglas alrededor.
 *
 * Extraída de `catalog/[cardId]/CardDetailView.tsx` (misma marcación, cero cambio visual) para que
 * el bloque de estimados de §22.3 use **exactamente la misma celda** en vez de inventar una: el
 * diseño pide «cero componentes nuevos y cero modificaciones» y la retícula del gancho es la misma
 * de dos columnas que ya usa la ficha para «Precio de venta / Valor de mercado».
 *
 * `label` acepta `ReactNode` (antes `string`) porque la etiqueta del gancho es «SI SALE» + el chip
 * de grado hipotético (§22.2). Es un ensanchamiento compatible: todos los usos previos pasan string.
 */
export function Fact({
  label,
  children,
  note,
  className,
  labelId,
  labelledBy,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  note?: string;
  className?: string;
  /** §MIV.5 — id del rótulo, para que la celda lo cite en su nombre accesible. */
  labelId?: string;
  /**
   * §MIV.5 (criterio 863) — si viene, la celda es un `role="group"` nombrado por ESTOS nodos visibles
   * (rótulo, cifra, rótulo de IVA). ⛔ Nunca un `aria-label` con una cadena aparte. Sin él, la celda
   * queda exactamente como antes.
   */
  labelledBy?: string;
}) {
  return (
    <div
      className={cn('border-b border-border py-6', className)}
      {...(labelledBy ? { role: 'group', 'aria-labelledby': labelledBy } : {})}
    >
      <div className="eyebrow" id={labelId}>
        {label}
      </div>
      <div className="mt-2.5">{children}</div>
      {note && <div className="mt-2 font-mono text-[11px] leading-none text-muted">{note}</div>}
    </div>
  );
}
