'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { getReplacementCases } from '@/lib/api';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { ReplacementCaseSource } from '@/types/contract';
import { ReplacementCaseCard } from './ReplacementCaseCard';

export const CASES_KEY = ['admin-replacement-cases'] as const;

/**
 * **«Por reponer» — la lista** (`DESIGN_SYSTEM §37.8a` · contrato `§M4-SHIP.15.8`,
 * `GET /admin/replacement-cases`). Abiertos por antigüedad (los vencidos quedan arriba solos, porque vencer
 * depende solo de `openedAt`); resueltos por resolución reciente. Filtros: estado, «Solo vencidos», origen y
 * búsqueda; paginación del servidor. ⛔ «Vencido» lo dice `overdue` del servidor, nunca una resta aquí (S1).
 */
export function ReplacementCasesPanel() {
  const t = useTranslations('admin.m4.replace');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [source, setSource] = useState<'' | ReplacementCaseSource>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search, 400).trim();

  const cases = useQuery({
    queryKey: [...CASES_KEY, state, overdueOnly && state === 'open', source, q, page],
    queryFn: () =>
      getReplacementCases({
        state,
        overdue: state === 'open' && overdueOnly ? true : undefined,
        source: source || undefined,
        q: q || undefined,
        page,
      }),
  });
  const totalPages = cases.data && cases.data.pageSize > 0 ? Math.max(1, Math.ceil(cases.data.total / cases.data.pageSize)) : 1;

  const emptyCopy = q
    ? { title: t('empty.search', { q }) }
    : state === 'closed'
      ? { title: t('empty.closed') }
      : overdueOnly
        ? { title: t('empty.overdue') }
        : { title: t('empty.open.title'), body: t('empty.open.body') };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted">{t('hint')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="replace-state-label" className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            {t('filter.state')}
          </span>
          <div className="flex gap-2" role="group" aria-labelledby="replace-state-label">
            {(['open', 'closed'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={state === s}
                onClick={() => {
                  setState(s);
                  setPage(1);
                }}
                className={cn(
                  'inline-flex min-h-[44px] items-center border px-3.5 text-xs font-medium transition-colors',
                  state === s ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
                )}
              >
                {t(`filter.${s}`)}
              </button>
            ))}
          </div>
        </div>
        {state === 'open' && (
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="h-5 w-5 accent-text"
              checked={overdueOnly}
              onChange={(e) => {
                setOverdueOnly(e.target.checked);
                setPage(1);
              }}
            />
            {t('filter.overdueOnly')}
          </label>
        )}
        <Select
          label={t('filter.sourceLabel')}
          className="w-48"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as '' | ReplacementCaseSource);
            setPage(1);
          }}
          options={[
            { value: '', label: t('filter.source.all') },
            { value: 'withdrawal', label: t('filter.source.withdrawal') },
            { value: 'vault_purchase', label: t('filter.source.vault_purchase') },
          ]}
        />
        <div className="w-64">
          <Input
            label={t('search')}
            type="search"
            hint={t('searchHint')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted" role="status" data-testid="replace-live-region">
        {cases.isLoading || cases.isError ? '' : cases.data && cases.data.total === 0 ? emptyCopy.title : t('count', { count: cases.data?.total ?? 0 })}
      </p>

      <QueryState
        isLoading={cases.isLoading}
        isError={cases.isError}
        error={cases.error}
        onRetry={() => cases.refetch()}
        loading={
          <div className="flex flex-col gap-4" data-testid="replace-loading">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        }
      >
        {cases.data && cases.data.data.length === 0 ? (
          <EmptyState title={emptyCopy.title} body={emptyCopy.body} />
        ) : (
          <>
            <ol className="flex flex-col gap-4">
              {(cases.data?.data ?? []).map((c) => (
                <li key={c.id}>
                  <ReplacementCaseCard
                    kase={c}
                    locale={locale}
                    footer={
                      <Link
                        href={`/admin/m4/reponer/${c.id}`}
                        className="inline-flex min-h-[44px] items-center border border-text px-4 text-[10px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
                      >
                        {t('viewCase')}
                      </Link>
                    }
                  />
                </li>
              ))}
            </ol>
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  {tc('back')}
                </Button>
                <span className="tabular text-xs text-muted">
                  {cases.data?.page} / {totalPages}
                </span>
                <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  {tc('continue')}
                </Button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
