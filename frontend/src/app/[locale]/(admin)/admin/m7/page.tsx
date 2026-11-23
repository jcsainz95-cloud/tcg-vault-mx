import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { parsePeriod } from '@/lib/reports/period';
import { M7View } from './M7View';

/** `/admin/m7` — Finanzas. `?preset=` (o `custom` + `from`/`to` reales, días de México); sin nada, este mes (§REPORTES-CEO §2). */
export default async function M7Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <SuperAdminOnly>
      <M7View initialPeriod={parsePeriod((await searchParams) ?? {})} />
    </SuperAdminOnly>
  );
}
