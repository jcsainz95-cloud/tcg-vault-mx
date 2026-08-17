'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getAdminVaults, type AdminVaultFilters } from '@/lib/api';
import type { AdminVaultSort, AdminVaultSummaryDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { MasterSetPanel } from '@/components/master-set/MasterSetPanel';

const SORTS: AdminVaultSort[] = ['value_desc', 'pieces_desc', 'name_asc'];
const PAGE_SIZE = 20;

/** Retícula compartida de cabecera y renglones de la lista. */
const ROW = 'grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[1.4fr_1.6fr_auto_auto_auto] sm:gap-4';

/**
 * «Bóvedas de clientes» (contrato §M1 v1.20 · GET /admin/vaults, `vault_operator+`):
 * lista de clientes con bóveda (piezas + valor estimado con la MISMA base del portafolio §3).
 * Clic en un cliente → su master set (vista (ii), scope user_vault) reutilizando los
 * componentes compartidos en modo LECTURA: sin captura/publicación/ajuste y sin `buyable`.
 */
export function VaultsView() {
  const t = useTranslations('admin.vaults');
  const locale = useLocale() as AppLocale;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<AdminVaultSort>('value_desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminVaultSummaryDTO | null>(null);

  const filters: AdminVaultFilters = {
    q: q.trim() || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };
  const vaults = useQuery({
    queryKey: ['admin-vaults', filters],
    queryFn: () => getAdminVaults(filters),
    enabled: selected === null,
  });

  const totalPages = vaults.data ? Math.max(1, Math.ceil(vaults.data.total / PAGE_SIZE)) : 1;

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)} aria-label={t('back')}>
            <ChevronLeft size={18} /> {t('back')}
          </Button>
          <h1 className="text-h1 font-bold">{selected.name}</h1>
          <span className="font-mono text-xs text-muted">{selected.email}</span>
        </div>
        {/* Vista (ii): binder de la bóveda del cliente — lectura pura (§4.20a). */}
        <MasterSetPanel mode="user_vault_admin" userId={selected.userId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('search')}
          className="w-64"
          placeholder={t('searchPlaceholder')}
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
            setSort(e.target.value as AdminVaultSort);
            setPage(1);
          }}
        />
      </div>

      <QueryState
        isLoading={vaults.isLoading}
        isError={vaults.isError}
        error={vaults.error}
        onRetry={() => vaults.refetch()}
      >
        {vaults.data &&
          (vaults.data.data.length === 0 ? (
            <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
          ) : (
            <>
              <div className={`${ROW} hidden border-b border-border py-3 sm:grid`}>
                <span className="eyebrow">{t('colName')}</span>
                <span className="eyebrow">{t('colEmail')}</span>
                <span className="eyebrow text-right">{t('colPieces')}</span>
                <span className="eyebrow text-right">{t('colValue')}</span>
                <span className="eyebrow text-right">{t('colPending')}</span>
              </div>
              <ul>
                {vaults.data.data.map((v) => (
                  <li key={v.userId}>
                    <button
                      type="button"
                      onClick={() => setSelected(v)}
                      aria-label={`${t('open')} · ${v.name}`}
                      className={`${ROW} w-full border-b border-border py-3 text-left transition-colors hover:bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none`}
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{v.name}</span>
                      <span className="hidden min-w-0 truncate font-mono text-xs text-muted sm:block">
                        {v.email}
                      </span>
                      <span className="font-mono tabular-nums text-xs sm:text-right">
                        {t('pieces', { count: v.pieceCount })}
                      </span>
                      <span className="hidden font-mono tabular-nums text-sm sm:block sm:text-right">
                        {formatMoneyCents(v.totalValueMxnCents, locale)}
                      </span>
                      <span className="hidden font-mono tabular-nums text-xs text-muted sm:block sm:text-right">
                        {v.pendingPriceCount}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  {t('pageInfo', { page: vaults.data.page, totalPages, total: vaults.data.total })}
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
