import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { redirect } from '@/i18n/navigation';
import { routing, type AppLocale } from '@/i18n/routing';
import { M9View } from './M9View';
import { parseSalesUrl } from './salesParams';

/**
 * `/admin/m9` — Reportes › Ventas (`DESIGN_SYSTEM §AN-UX.1`). El estado de «Ventas» (`preset`, `from`, `to`, `groupBy`,
 * `topSort`, `chart`, `cols`, `top`) vive en la URL. Enlaces guardados de las pestañas que ya no existen (§REPORTES-CEO F1):
 * `?tab=compra` → Inventario › Qué reponer (conserva `sort`/`dir`); `?tab=actividad` → Junta de dirección, franja «Metas de lanzamiento» (§6, CR-2b).
 */
export default async function M9Page({
  params,
  searchParams,
}: {
  params?: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const raw = params ? (await params).locale : undefined;
  const locale: AppLocale = (routing.locales as readonly string[]).includes(raw ?? '') ? (raw as AppLocale) : routing.defaultLocale;
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  if (tab === 'actividad') redirect({ href: '/admin/reportes#metas', locale });
  if (tab === 'compra') {
    const q = new URLSearchParams();
    for (const k of ['sort', 'dir']) {
      const v = Array.isArray(sp[k]) ? sp[k]![0] : sp[k];
      if (typeof v === 'string') q.set(k, v);
    }
    const qs = q.toString();
    redirect({ href: `/admin/reportes/inventario${qs ? `?${qs}` : ''}#reponer`, locale });
  }
  return (
    <SuperAdminOnly>
      <M9View initialSales={parseSalesUrl(sp)} />
    </SuperAdminOnly>
  );
}
