/**
 * Cliente REAL de §REPORTES-CEO F2b (solo `super_admin`; `vault_operator` ⇒ 403): resultado por línea de negocio y consolidados.
 * ⛔ Sin mocks aquí (los mocks solo los importa `lib/api.ts`, R1): `getPnlReport`/`getPnlCalendar` de `lib/api.ts` deciden.
 */
import { apiRequest } from '../api-client';
import type { PeriodKind } from '@/types/contract';
import type { CalendarUnit, PnlCalendarDTO, PnlReportDTO } from '@/types/reports-pnl';

export interface PnlReportRange {
  from?: string;
  to?: string;
  kind?: PeriodKind;
}

/** `GET /admin/reports/finance/pnl?from&to&kind` — `from`/`to` ambos o ninguno (ninguno = histórico, sin comparación). */
export function fetchPnlReport(range: PnlReportRange = {}): Promise<PnlReportDTO> {
  const both = !!(range.from && range.to);
  return apiRequest<PnlReportDTO>('/admin/reports/finance/pnl', {
    query: { from: both ? range.from : undefined, to: both ? range.to : undefined, kind: both ? range.kind : undefined },
  });
}

export interface PnlCalendarParams {
  unit: CalendarUnit;
  /** periodos COMPLETOS anteriores (1..12, default 4 del servidor); +1 el en curso */
  count?: number;
  /** `YYYY-MM-DD`; por defecto hoy en México */
  asOf?: string;
}

/** `GET /admin/reports/finance/pnl/series?groupBy=month|quarter|semester|year&count&asOf` (§3b; sin `from`/`to`). */
export function fetchPnlCalendar(p: PnlCalendarParams): Promise<PnlCalendarDTO> {
  return apiRequest<PnlCalendarDTO>('/admin/reports/finance/pnl/series', {
    query: { groupBy: p.unit, count: p.count === undefined ? undefined : String(p.count), asOf: p.asOf },
  });
}
