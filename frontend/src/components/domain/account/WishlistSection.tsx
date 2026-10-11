'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { WishlistResponse } from '@/types/contract';
import { Skeleton } from '@/components/ui/Skeleton';
import { SectionError, SectionShell } from './SectionShell';

/**
 * «Lista de deseos» en «Mi cuenta» (`#wishlist`, DESIGN_SYSTEM §WSH-UX.3 a): resumen y enlace a `/account/wishlist`.
 * La consulta vive en `AccountView` (decide si la sección EXISTE: con `404 FEATURE_DISABLED` no existe, WSH-5); aquí
 * solo se pintan sus estados.
 */
export function WishlistSection({
  data,
  isLoading,
  error,
  onRetry,
}: {
  data: WishlistResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const t = useTranslations('wishlist');
  return (
    <SectionShell id="wishlist" title={t('account.title')}>
      {isLoading ? (
        <Skeleton className="h-5 w-64" />
      ) : error ? (
        <SectionError error={error} onRetry={onRetry} />
      ) : data ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-[15px] text-muted">
            {data.count === 0
              ? t('account.summaryEmpty')
              : data.alertsPaused
                ? t('account.summaryPaused', { count: data.count, limit: data.limit })
                : t('account.summary', { count: data.count, limit: data.limit })}
          </p>
          <Link
            href="/account/wishlist"
            className="inline-flex min-h-[44px] items-center border border-text px-4 font-mono text-[10px] uppercase tracking-label text-text hover:bg-text hover:text-primary-fg focus-visible:shadow-focus"
          >
            {t('seeList')}
          </Link>
        </div>
      ) : null}
    </SectionShell>
  );
}
