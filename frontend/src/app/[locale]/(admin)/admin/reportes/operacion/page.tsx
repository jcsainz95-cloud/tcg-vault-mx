import { SALES_MAX_DAYS, parsePeriod } from '@/lib/reports/period';
import { OpsView } from '../OpsView';

/** `/admin/reportes/operacion` — Reportes › Operación (§REPORTES-CEO F1). Todo el personal; el dinero solo lo pide el súper-admin. */
export default async function OpsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <OpsView initialPeriod={parsePeriod((await searchParams) ?? {}, undefined, { maxDays: SALES_MAX_DAYS })} />;
}
