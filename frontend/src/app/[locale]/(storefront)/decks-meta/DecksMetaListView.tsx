'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { MetaDeckSummaryDTO } from '@/types/contract';
import { getDecksMeta } from '@/lib/api';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { CardImage } from '@/components/ui/CardImage';
import { Badge } from '@/components/ui/Badge';

/** Flecha de tendencia en el meta (sube/baja/igual). El texto accesible lo porta `aria-label`. */
function Trend({ trend }: { trend?: number }) {
  const t = useTranslations('decksMeta');
  if (trend == null || trend === 0) return null;
  const up = trend > 0;
  return (
    <span
      className={up ? 'text-success' : 'text-accent'}
      aria-label={up ? t('list.trendUp') : t('list.trendDown')}
      title={up ? t('list.trendUp') : t('list.trendDown')}
    >
      {up ? '▲' : '▼'}
    </span>
  );
}

export function DecksMetaListView() {
  const query = useQuery({ queryKey: ['decks-meta'], queryFn: getDecksMeta });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
      loading={
        <div className="gutter grid gap-6 py-12 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      }
    >
      {query.data && <List response={query.data} />}
    </QueryState>
  );
}

function List({ response }: { response: { data: MetaDeckSummaryDTO[]; updatedAt: string; source: string } }) {
  const t = useTranslations('decksMeta');
  const locale = useLocale() as AppLocale;

  return (
    <div className="gutter py-12">
      <header className="max-w-2xl">
        <h1 className="font-serif text-[32px] leading-[1.05] text-text lg:text-[42px]">{t('metaTitle')}</h1>
        <p className="mt-3 text-[15px] leading-[1.7] text-muted">{t('metaSubtitle')}</p>
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-border py-4">
        {/* Cita de fuente obligatoria (§13). */}
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          {t('list.sourceLine', { source: response.source, date: formatDate(response.updatedAt, locale) })}
        </p>
        <Link
          href="/decks-meta/pegar"
          className="border border-text px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
        >
          {t('pasteLink')}
        </Link>
      </div>

      {response.data.length === 0 ? (
        <div className="mt-10">
          <EmptyState title={t('list.emptyTitle')} body={t('list.emptyBody')} />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {response.data.map((deck) => (
            <DeckTile key={deck.slug} deck={deck} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckTile({ deck }: { deck: MetaDeckSummaryDTO }) {
  const t = useTranslations('decksMeta');
  const locale = useLocale() as AppLocale;

  return (
    <Link
      href={`/decks-meta/${deck.slug}`}
      className="group flex flex-col border border-border transition-colors hover:border-text"
    >
      <div className="flex items-center justify-center border-b border-border bg-surface-2 px-6 py-8">
        {deck.imageUrl ? (
          <CardImage src={deck.imageUrl} alt={deck.name} className="w-full max-w-[180px] bg-transparent p-0" />
        ) : (
          <div className="aspect-[5/7] w-full max-w-[180px] border border-dashed border-border" aria-hidden />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular text-accent">{t('list.rank', { rank: deck.rank })}</span>
          {deck.sharePct != null && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] tabular text-muted">
              <Trend trend={deck.trend} />
              {t('list.share', { share: deck.sharePct })}
            </span>
          )}
        </div>
        <h2 className="font-serif text-[20px] leading-tight text-text" lang="en">
          {deck.name}
        </h2>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <Badge tone="neutral">{t('list.availability', { available: deck.availableCount, total: deck.totalCount })}</Badge>
          {deck.fromPriceMxnCents != null && (
            <span className="tabular text-[13px] font-medium text-text">
              {t('list.fromPrice', { price: formatMoneyCents(deck.fromPriceMxnCents, locale) })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
