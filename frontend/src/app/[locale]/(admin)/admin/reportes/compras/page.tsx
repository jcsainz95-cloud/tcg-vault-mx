import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { SALES_MAX_DAYS, parsePeriodNotice } from '@/lib/reports/period';
import { PurchasesView } from '../PurchasesView';

/** `/admin/reportes/compras` — Reportes › Compras a vendedores (§REPORTES-CEO F1). Solo súper-admin. */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { period, notice } = parsePeriodNotice((await searchParams) ?? {}, undefined, { maxDays: SALES_MAX_DAYS });
  return (
    <SuperAdminOnly>
      <PurchasesView initialPeriod={period} initialNotice={notice} />
    </SuperAdminOnly>
  );
}
