import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { parsePeriod } from '@/lib/reports/period';
import { PurchasesView } from '../PurchasesView';

/** `/admin/reportes/compras` — Reportes › Compras a vendedores (§REPORTES-CEO F1). Solo súper-admin. */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <SuperAdminOnly>
      <PurchasesView initialPeriod={parsePeriod((await searchParams) ?? {})} />
    </SuperAdminOnly>
  );
}
