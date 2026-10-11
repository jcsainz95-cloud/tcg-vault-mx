import { redirect } from '@/i18n/navigation';
import { routing, type AppLocale } from '@/i18n/routing';

/**
 * `/admin/m8` — F-26 (contrato §PNL.10.7 · `DESIGN_SYSTEM §60.8`): M8 «Disputas» se retiró de la interfaz. Desde PNL-1
 * nadie escribe disputas y el dueño leyó cero abiertas/en revisión (`HECHOS.md:50` (3)). La ruta solo **redirige** a
 * `/admin`, conservando el idioma, como `/admin/manual-refunds` (§37.20 c). ⛔ Sin página «esta sección ya no existe».
 * La API de disputas sigue (lecturas y `resolve`): si la medición posterior al despliegue da alguna, se revierte el
 * commit de F-26 y vuelven menú, ruta y enlace.
 */
export default async function M8RedirectPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const target: AppLocale = (routing.locales as readonly string[]).includes(locale) ? (locale as AppLocale) : routing.defaultLocale;
  redirect({ href: '/admin', locale: target });
}
