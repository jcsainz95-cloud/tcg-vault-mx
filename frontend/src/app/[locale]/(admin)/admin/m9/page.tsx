import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { M9View } from './M9View';
import { parseM9Tab, parseSalesUrl } from './salesParams';

/**
 * `/admin/m9` — Reportes (`DESIGN_SYSTEM §AN-UX.1`): pestañas «Ventas» (por defecto) y «Actividad», `?tab=`; el resto del
 * estado de «Ventas» (`preset`, `from`, `to`, `groupBy`, `topSort`, `chart`, `cols`, `top`) también vive en la URL.
 */
export default async function M9Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  return (
    <SuperAdminOnly>
      <M9View initialTab={parseM9Tab(sp.tab)} initialSales={parseSalesUrl(sp)} />
    </SuperAdminOnly>
  );
}
