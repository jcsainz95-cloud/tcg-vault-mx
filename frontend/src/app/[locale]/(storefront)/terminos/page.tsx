import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ShieldCheck, BadgeCheck } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { fetchSupportContactForServer } from './support-contact-server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  // Patrón de título §17.4: «TCG HUNT — {página}».
  return {
    title: `${tc('appName')} — ${t('title')}`,
    description: t('refundBody'),
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  const contact = await fetchSupportContactForServer();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <p className="text-muted">{t('intro')}</p>
        <p className="text-sm text-muted">{t('scopeNote')}</p>
      </header>

      <Banner variant="warning" title={t('refundTitle')}>
        {t('refundBody')}
      </Banner>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-h3 font-semibold">
          <BadgeCheck size={20} className="shrink-0 text-success" aria-hidden />
          {t('platformErrorTitle')}
        </h2>
        <p className="text-sm text-text/90">{t('platformErrorBody')}</p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-h3 font-semibold">
          <ShieldCheck size={20} className="shrink-0 text-info" aria-hidden />
          {t('deliveryIssueTitle')}
        </h2>
        {/* HECHOS 2026-10-05: sin plazo escrito y sin mencionar el contracargo del banco. */}
        <p className="text-sm text-text/90">{t('deliveryIssueBody', { contact })}</p>
        <p className="text-sm font-medium text-text">{t('deliveryIssueOutcome')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-h3 font-semibold">{t('questionsTitle')}</h2>
        <p className="text-sm text-muted">{t('questionsBody', { contact })}</p>
      </section>
    </div>
  );
}
