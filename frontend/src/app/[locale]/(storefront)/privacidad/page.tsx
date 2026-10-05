import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { privacyNoticeEs } from '@/content/legal/privacidad.es';
import { legalEnvFromProcess, privacyVisibility } from '@/content/legal/legal-gate';
import { PrivacyNoticeView } from './PrivacyNoticeView';

/**
 * LIVE-8 · `/privacidad` (ES y EN; el texto es español, con la línea «Legal notice available in
 * Spanish only» en inglés — ARCHITECTURE §4.63.7). Pública, sin sesión.
 *
 * 🔒 Si el texto tuviera marcadores o el modo provisional fuera incoherente (§14.17), en producción
 * respondería 404 y el pie no la enlazaría (`legal-gate.ts`); en la vista previa de Vercel se vería
 * como borrador, con los huecos resaltados y `noindex`. Hoy se publica en modo provisional: sin
 * razón social/RFC/domicilio, con la frase fija (HECHOS 2026-10-05 sesión 6).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'privacy' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  const draft = privacyVisibility(privacyNoticeEs, legalEnvFromProcess()) !== 'published';
  return {
    title: `${tc('appName')} — ${t('title')}`,
    robots: draft ? { index: false, follow: false } : undefined,
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const visibility = privacyVisibility(privacyNoticeEs, legalEnvFromProcess());
  if (visibility === 'hidden') notFound();
  return (
    <PrivacyNoticeView doc={privacyNoticeEs} draft={visibility === 'draft'} showSpanishOnly={locale !== 'es'} />
  );
}
