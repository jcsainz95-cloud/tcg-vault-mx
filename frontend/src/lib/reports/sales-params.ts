import type { SalesReportParams } from '@/types/contract';
import { spanDays, type ReportPeriod } from './period';

/**
 * Parámetros de `GET /admin/reports/sales` para el periodo vigente (§REPORTES-CEO §2): los atajos se resuelven SOLO en el
 * front y el selector NUNCA manda `preset` (el enum del servidor no cambia): siempre `custom` con `from`/`to` de México.
 * `groupBy=day` con más de 366 días da 400 ⇒ se baja a semana.
 */
export function salesParamsFor(p: ReportPeriod, groupBy: SalesReportParams['groupBy'] = 'day', extra: Pick<SalesReportParams, 'topSort'> = {}): SalesReportParams {
  const g = groupBy === 'day' && spanDays(p.from, p.to) > 366 ? 'week' : groupBy;
  return { preset: 'custom', from: p.from, to: p.to, groupBy: g, ...extra };
}
