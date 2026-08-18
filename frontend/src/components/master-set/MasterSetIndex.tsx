'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getMasterSets,
  getAdminVaultMasterSets,
  getVaultMasterSets,
  listBuylistSets,
  type MasterSetIndexFilters,
} from '@/lib/api';
import type { MasterSetIndexResponse, MasterSetSort, MasterSetSummaryDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import type { MasterSetViewMode } from './mode';

const SORTS: MasterSetSort[] = ['release_desc', 'completion_asc', 'pieces_desc'];
const PAGE_SIZE = 20;

interface Props {
  mode: MasterSetViewMode;
  /** Requerido en `user_vault_admin` (bóveda de ESE cliente). */
  userId?: string;
  onOpenSet: (set: MasterSetSummaryDTO) => void;
}

/**
 * mode="quoter" (cotizador): SIN endpoint de índice propio — se compone client-side con
 * `GET /buylist/sets` (público, ya usado por el cotizador) filtrando/ordenando/paginando en
 * el cliente. Sin inventario/bóveda: no hay completitud/piezas que agregar (van en 0/null y
 * la UI las oculta para este modo — ver `MasterSetIndex`).
 */
async function fetchQuoterIndex(filters: MasterSetIndexFilters): Promise<MasterSetIndexResponse> {
  const sets = await listBuylistSets();
  const q = (filters.q ?? '').trim().toLowerCase();
  const matched = q ? sets.filter((s) => s.name.toLowerCase().includes(q)) : sets;
  const sorted = [...matched].sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name),
  );
  const pageSize = filters.pageSize ?? PAGE_SIZE;
  const page = filters.page ?? 1;
  const start = (page - 1) * pageSize;
  const data: MasterSetSummaryDTO[] = sorted.slice(start, start + pageSize).map((s) => ({
    setId: s.id,
    name: s.name,
    series: s.series,
    releaseDate: s.releaseDate,
    year: s.year,
    catalogCardCount: 0,
    distinctCardsOwned: 0,
    completionPct: null,
    totalPieces: 0,
    catalogVariantCount: 0,
    distinctVariantsOwned: 0,
    variantCompletionPct: null,
  }));
  return { data, page, pageSize, total: sorted.length, scope: 'platform' };
}

/** Un solo lugar decide el endpoint por modo (contrato v1.20: mismo shape, distinto scope). */
function fetchIndex(
  mode: MasterSetViewMode,
  userId: string | undefined,
  filters: MasterSetIndexFilters,
): Promise<MasterSetIndexResponse> {
  if (mode === 'quoter') return fetchQuoterIndex(filters);
  if (mode === 'user_vault_self') return getVaultMasterSets(filters);
  if (mode === 'user_vault_admin') return getAdminVaultMasterSets(userId ?? '', filters);
  return getMasterSets(filters);
}

/**
 * Índice Master Set COMPARTIDO (§4.20f): grid de sets con completitud POR VARIANTE
 * (v1.20: distinctVariantsOwned / catalogVariantCount · variantCompletionPct — los
 * contadores «X/Y» cuentan variantes, no cartas) y conteo de piezas. Click → binder.
 */
export function MasterSetIndex({ mode, userId, onOpenSet }: Props) {
  const t = useTranslations('masterSet');
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
    queryKey: ['master-sets', mode, userId ?? null, filters],
    queryFn: () => fetchIndex(mode, userId, filters),
  });

  const totalPages = index.data ? Math.max(1, Math.ceil(index.data.total / PAGE_SIZE)) : 1;
  const owner = index.data?.owner;

  return (
    <div className="flex flex-col gap-4">
      {/* Dueño de la bóveda (solo scope user_vault; email solo en la vista admin). */}
      {mode === 'user_vault_admin' && owner && (
        <p className="font-mono text-xs text-muted">
          {t('ownerVault', { name: owner.name })}
          {owner.email ? ` · ${owner.email}` : ''}
        </p>
      )}

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
        {/* Ordenar por completitud/piezas no aplica en quoter (sin inventario/bóveda que agregar):
            el índice del cotizador siempre ordena por lanzamiento (server-side no hay qué elegir). */}
        {mode !== 'quoter' && (
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
        )}
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
                      {/* Completitud/piezas: conceptos de INVENTARIO/bóveda — no aplican en quoter
                          (el cotizador no posee las cartas, solo las cotiza). */}
                      {mode !== 'quoter' && (
                        <div className="flex flex-col gap-2">
                          {/* v1.20: completitud POR VARIANTE (carta+acabado), no por carta. */}
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-xs uppercase tracking-wide text-muted">
                              {t('completionLabel')}
                            </span>
                            <span className="font-mono tabular-nums text-sm">
                              {t('completionValue', {
                                owned: s.distinctVariantsOwned,
                                total: s.catalogVariantCount,
                                pct: s.variantCompletionPct ?? 0,
                              })}
                            </span>
                          </div>
                          <ProgressBar pct={s.variantCompletionPct ?? 0} />
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-xs uppercase tracking-wide text-muted">
                              {t('piecesLabel')}
                            </span>
                            <span className="font-mono tabular-nums text-sm">
                              {t('piecesValue', { count: s.totalPieces })}
                            </span>
                          </div>
                        </div>
                      )}
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
