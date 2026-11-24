import { SALES_MAX_DAYS, parsePeriodNotice } from '@/lib/reports/period';
import { OpsView } from '../OpsView';

/** `/admin/reportes/operacion` — Reportes › Operación (§REPORTES-CEO F1). Todo el personal; el dinero solo lo pide el súper-admin. */
export default async function OpsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { period, notice } = parsePeriodNotice((await searchParams) ?? {}, undefined, { maxDays: SALES_MAX_DAYS });
  return <OpsView initialPeriod={period} initialNotice={notice} />;
}
