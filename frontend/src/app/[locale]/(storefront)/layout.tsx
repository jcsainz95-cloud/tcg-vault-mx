import { useTranslations } from 'next-intl';
import { StorefrontHeader } from '@/components/layout/StorefrontHeader';
import { Link } from '@/i18n/navigation';

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <StorefrontHeader />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted sm:px-6 lg:px-8">
          <Footer />
        </div>
      </footer>
    </div>
  );
}

function SkipLink() {
  const t = useTranslations('common');
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg"
    >
      {t('skipToContent')}
    </a>
  );
}

function Footer() {
  const t = useTranslations('common');
  const tn = useTranslations('nav');
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p>
        {t('appName')} · {t('tagline')} · MXN
      </p>
      <Link href="/terminos" className="font-medium text-muted underline underline-offset-2 hover:text-text">
        {tn('terms')}
      </Link>
    </div>
  );
}
