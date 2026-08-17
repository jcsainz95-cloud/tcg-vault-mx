'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMasterSets, type MasterSetIndexFilters } from '@/lib/api';
import type { MasterSetSort, MasterSetSummaryDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';

const SORTS: MasterSetSort[] = ['release_desc', 'completion_asc', 'pieces_desc'];
const PAGE_SIZE = 20;

interface Props {
  onOpenSet: (set: MasterSetSummaryDTO) => void;
}

/**
 * Índice Master Set: grid de sets con completitud (cartas distintas / catalogCardCount) y
 * conteo de piezas (contrato §M1 · GET /admin/inventory/master-sets). Click → binder.
 */
export function MasterSetIndex({ onOpenSet }: Props) {
  const t = useTranslations('admin.m1.masterSet');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<MasterSetSort>('release_desc');
  const [page, setPage] = useState(1);

  const filters: MasterSetIndexFilters = {
    q: q.trim() || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };
  const index = useQuery({
    queryKey: ['master-sets', filters],
    queryFn: () => getMasterSets(filters),
  });

  const totalPages = index.data ? Math.max(1, Math.ceil(index.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('searchSet')}
          className="w-64"
          placeholder={t('searchSetPlaceholder')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          label={t('sortLabel')}
          className="w-56"
          options={SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) }))}
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as MasterSetSort);
            setPage(1);
          }}
        />
      </div>

      <QueryState
        isLoading={index.isLoading}
        isError={index.isError}
        error={index.error}
        onRetry={() => index.refetch()}
      >
        {index.data &&
          (index.data.data.length === 0 ? (
            <EmptyState title={t('emptyIndexTitle')} body={t('emptyIndexBody')} />
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {index.data.data.map((s) => (
                  <li key={s.setId}>
                    <button
                      type="button"
                      onClick={() => onOpenSet(s)}
                      className="flex w-full flex-col gap-3 border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span lang="en" className="text-h3">
                          {s.name}
                        </span>
                        <span lang="en" className="font-mono text-xs text-muted">
                          {[s.series, s.year].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {/* Completitud = cartas distintas / catálogo del set. */}
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-xs uppercase tracking-wide text-muted">
                            {t('completionLabel')}
                          </span>
                          <span className="font-mono tabular-nums text-sm">
                            {t('completionValue', {
                              owned: s.distinctCardsOwned,
                              total: s.catalogCardCount,
                              pct: s.completionPct ?? 0,
                            })}
                          </span>
                        </div>
                        <ProgressBar pct={s.completionPct ?? 0} />
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-xs uppercase tracking-wide text-muted">
                            {t('piecesLabel')}
                          </span>
                          <span className="font-mono tabular-nums text-sm">
                            {t('piecesValue', { count: s.totalPieces })}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  {t('pageInfo', { page: index.data.page, totalPages, total: index.data.total })}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={16} /> {t('prev')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('next')} <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </>
          ))}
      </QueryState>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="h-1.5 w-full bg-surface-2"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full bg-accent" style={{ width: `${clamped}%` }} />
    </div>
  );
}
