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
 * 🔒 Mientras el texto tenga marcadores (datos del dueño P-LEG-1…3, notas para el abogado), en
 * producción responde 404 y el pie no la enlaza (`legal-gate.ts`). En la vista previa de Vercel se
 * ve como borrador, con los huecos resaltados y `noindex`.
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
