import { redirect } from '@/i18n/navigation';
import { routing, type AppLocale } from '@/i18n/routing';

/**
 * `/admin/manual-refunds` — v4.10 (`DESIGN_SYSTEM §37.20 c`): la lista SPEI vive ahora como la cubeta
 * «Transferencias SPEI» de `/admin/refunds` (la que abre por defecto). Esta ruta solo **redirige**, conservando el
 * idioma (`/es/…` → `/es/admin/refunds`). No se arrastran `status`/`q`: la lista nunca los leyó de la URL.
 * El detalle `/admin/manual-refunds/:id` se queda en su ruta (§37.20 c).
 */
export default async function ManualRefundsRedirectPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const target: AppLocale = (routing.locales as readonly string[]).includes(locale) ? (locale as AppLocale) : routing.defaultLocale;
  redirect({ href: '/admin/refunds', locale: target });
}
