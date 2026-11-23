'use client';

import { useTranslations } from 'next-intl';
import { SalesTodayCard } from '../SalesTodayCard';
import { SalesTab } from './SalesTab';
import type { SalesUrlState } from './salesParams';
import { SALES_DEFAULTS } from './salesParams';

/**
 * Reportes › Ventas (`/admin/m9`, §REPORTES-CEO F1): el informe comercial de `GET /admin/reports/sales`. La ruta conserva su
 * nombre (enlaces guardados); las pestañas «Actividad» y «Lista de compra» ya no existen: sus cifras viven en Finanzas
 * (exportaciones) y en Reportes › Inventario › «Qué reponer» (`/admin/m9?tab=…` redirige desde `page.tsx`).
 * «Ventas de hoy» llegó desde Inicio: una sola casa para el dinero de las ventas.
 */
export function M9View({ initialSales = SALES_DEFAULTS }: { initialSales?: SalesUrlState }) {
  const tModules = useTranslations('admin.modules'); // §37.2: h1 = rótulo del menú
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{tModules('m9')}</h1>
      <div className="border-y border-border">
        <SalesTodayCard />
      </div>
      <SalesTab initial={initialSales} />
    </div>
  );
}
