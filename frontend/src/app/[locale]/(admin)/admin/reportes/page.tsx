import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { SALES_MAX_DAYS, parsePeriod } from '@/lib/reports/period';
import { BoardView } from './BoardView';

/** `/admin/reportes` — Reportes › Junta de dirección (§REPORTES-CEO F1). `?preset=` o `?preset=custom&from=&to=` (días de México). */
export default async function BoardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  return (
    <SuperAdminOnly>
      <BoardView initialPeriod={parsePeriod(sp, undefined, { maxDays: SALES_MAX_DAYS })} />
    </SuperAdminOnly>
  );
}
