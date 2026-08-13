import { useTranslations } from 'next-intl';
import { ShieldCheck, Package, TrendingUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export default function HomePage() {
  const t = useTranslations('home');
  const trust = [
    { icon: ShieldCheck, text: t('trustAuth') },
    { icon: Package, text: t('trustCustody') },
    { icon: TrendingUp, text: t('trustPrice') },
  ];
  return (
    <div className="flex flex-col gap-10">
      <section className="rounded-xl border border-border bg-surface p-8 shadow-sm sm:p-12">
        <div className="max-w-2xl">
          <h1 className="text-h1 font-bold sm:text-display">{t('heroTitle')}</h1>
          <p className="mt-4 text-lg text-muted">{t('heroSubtitle')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/catalog"
              className="inline-flex min-h-[48px] items-center rounded-md bg-accent px-5 font-semibold text-accent-fg hover:brightness-95"
            >
              {t('ctaCatalog')}
            </Link>
            <Link
              href="/buylist"
              className="inline-flex min-h-[48px] items-center rounded-md border border-border-strong px-5 font-medium hover:bg-surface-2"
            >
              {t('ctaBuylist')}
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {trust.map((item, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
              <item.icon size={20} aria-hidden />
            </span>
            <p className="text-sm text-text">{item.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
