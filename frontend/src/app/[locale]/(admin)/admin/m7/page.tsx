import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { parsePeriod } from '@/lib/reports/period';
import { M7View } from './M7View';

/** `/admin/m7` — Finanzas. `?preset=custom&from=&to=` (días de México) llega de la Junta de dirección; sin ellos, todo el histórico como siempre. */
export default async function M7Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const p = sp.preset === 'custom' ? parsePeriod(sp) : null;
  return (
    <SuperAdminOnly>
      <M7View initialRange={p ? { from: p.from, to: p.to } : undefined} />
    </SuperAdminOnly>
  );
}
