'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { DeckMetaDetailResponse } from '@/types/contract';
import { getDeckMeta } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { DeckAvailability } from '../DeckAvailability';

export function DeckDetailView({ slug }: { slug: string }) {
  const query = useQuery({ queryKey: ['deck-meta', slug], queryFn: () => getDeckMeta(slug) });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
      loading={
        <div className="gutter flex flex-col gap-4 py-12">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      {query.data && <Detail detail={query.data} />}
    </QueryState>
  );
}

function Detail({ detail }: { detail: DeckMetaDetailResponse }) {
  const t = useTranslations('decksMeta');
  const locale = useLocale() as AppLocale;

  return (
    <div className="gutter py-10">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-3 border-b border-border py-5 font-mono text-xs tracking-[0.06em] text-muted"
      >
        <Link href="/decks-meta" className="hover:text-text">
          {t('detail.back')}
        </Link>
        <span aria-hidden>›</span>
        <span className="text-text" aria-current="page" lang="en">
          {detail.name}
        </span>
      </nav>

      <header className="pt-8">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular text-accent">{t('list.rank', { rank: detail.rank })}</span>
          {detail.sharePct != null && (
            <span className="font-mono text-[11px] tabular text-muted">{t('list.share', { share: detail.sharePct })}</span>
          )}
        </div>
        <h1 className="mt-2 font-serif text-[32px] leading-[1.05] text-text lg:text-[42px]" lang="en">
          {detail.name}
        </h1>

        {/* LEGALIDAD VISIBLE arriba del todo: «solo ofrecemos lo vigente para jugar». */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge tone="success" shape="outline">
            {t('detail.legalityVerified', { date: formatDate(detail.legalityVerifiedAt, locale) })}
          </Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          <span>{t('detail.source', { source: detail.source })}</span>
          {detail.sourceTournament && <span>{t('detail.sourceTournament', { tournament: detail.sourceTournament })}</span>}
          {detail.sourceUrl && (
            <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-text">
              {t('detail.viewSource')}
            </a>
          )}
        </div>
      </header>

      <div className="mt-6">
        <DeckAvailability groups={detail.groups} />
      </div>
    </div>
  );
}
