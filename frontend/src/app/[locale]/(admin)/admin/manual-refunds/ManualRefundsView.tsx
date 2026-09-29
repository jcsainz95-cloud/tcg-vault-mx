'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { getManualRefunds } from '@/lib/api';
import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { ManualRefundDTO, ManualRefundStatus } from '@/types/contract';

const DASH = '—';
export const MANUAL_REFUNDS_KEY = ['admin-manual-refunds'] as const;
const TAG = 'font-mono text-[11px] uppercase tracking-[0.06em]';
const LABEL = `${TAG} text-muted`;

/** Días enteros desde una fecha — SOLO para mostrar la antigüedad de la más vieja. */
function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor((Date.now() - ms) / (24 * 3600 * 1000)));
}

/**
 * **La cubeta «Reembolsos manuales (SPEI)» — lista** (`DESIGN_SYSTEM §37.9a` · contrato `§M4-SHIP.15.13`
 * `GET /admin/manual-refunds`). Lo que hay que transferir a mano, lo más viejo primero. **Solo súper-admin**
 * (S6): al operador no le existe ni en menú ni en tablero. ⛔ La CLABE nunca en claro aquí: `clabeMasked` tal cual (S5).
 */
export function ManualRefundsView() {
  return (
    <SuperAdminOnly>
      <ManualRefundsList />
    </SuperAdminOnly>
  );
}

function ManualRefundsList() {
  const t = useTranslations('admin.manualRefunds');
  const tStatus = useTranslations('status.manualRefund');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const [status, setStatus] = useState<ManualRefundStatus>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search, 400).trim();

  const list = useQuery({
    queryKey: [...MANUAL_REFUNDS_KEY, status, q, page],
    queryFn: () => getManualRefunds({ status, q: q || undefined, page }),
  });
  const totalPages = list.data && list.data.pageSize > 0 ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <p className="text-sm text-muted">{t('hint')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="mr-status-label" className={LABEL}>
            {t('filter.label')}
          </span>
          <div className="flex gap-2" role="group" aria-labelledby="mr-status-label">
            {(['pending', 'paid', 'cancelled'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => {
                  setStatus(s);
                  setPage(1);
                }}
                className={cn(
                  'inline-flex min-h-[44px] items-center border px-3.5 text-xs font-medium transition-colors',
                  status === s ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
                )}
              >
                {t(`filter.${s}`)}
              </button>
            ))}
          </div>
        </div>
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

      <QueryState isLoading={list.isLoading} isError={list.isError} error={list.error} onRetry={() => list.refetch()}>
        {list.data && (
          <>
            {status === 'pending' && list.data.total > 0 && (
              <p className="tabular text-sm text-text" data-testid="mr-summary">
                {t('summary', { count: list.data.total, amount: formatMoneyCents(list.data.pendingCents, locale), days: daysSince(list.data.data[0]?.createdAt) })}
              </p>
            )}
            {list.data.data.length === 0 ? (
              <EmptyState title={q ? t('empty.search', { q }) : t(`empty.${status}`)} />
            ) : (
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {list.data.data.map((m) => (
                  <ManualRefundRow key={m.id} m={m} locale={locale} t={t} tStatus={tStatus} />
                ))}
              </ul>
            )}
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  {tc('back')}
                </Button>
                <span className="tabular text-xs text-muted">
                  {list.data.page} / {totalPages}
                </span>
                <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  {tc('continue')}
                </Button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

function ManualRefundRow({ m, locale, t, tStatus }: { m: ManualRefundDTO; locale: AppLocale; t: ReturnType<typeof useTranslations>; tStatus: ReturnType<typeof useTranslations> }) {
  const beneficiary = m.beneficiaryName?.trim() || m.customer.fullName?.trim() || t('noName');
  return (
    <li data-testid={`mr-row-${m.id}`} className="grid gap-x-6 gap-y-2 py-4 text-sm text-text md:grid-cols-[1.4fr_auto_1.6fr_1fr_1fr_1fr_auto] md:items-start">
      <div className="flex min-w-0 flex-col">
        <span className={LABEL}>{t('col.beneficiary')}</span>
        <span>{beneficiary}</span>
        <span className="truncate text-muted">{m.customer.email}</span>
      </div>
      <div className="flex flex-col md:text-right">
        <span className={LABEL}>{t('col.amount')}</span>
        <span className="tabular font-medium">{formatMoneyCents(m.amountCents, locale)}</span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className={LABEL}>{t('col.why')}</span>
        <span lang="en">{t(`source.${m.source}`, { card: m.case.card.name, folio: m.case.folio })}</span>
      </div>
      <div className="flex flex-col">
        <span className={LABEL}>{t('col.purchase')}</span>
        {m.origin ? (
          <Link href={`/admin/m3/${m.origin.orderId}`} className="tabular underline underline-offset-4 hover:text-accent">
            {m.origin.orderNumber ?? m.origin.orderId}
          </Link>
        ) : (
          <span className="text-muted">{t('noOrigin')}</span>
        )}
        {m.origin && m.origin.orderStatus !== 'settled' && <span className={cn(TAG, 'text-accent')}>{t('originNotSettled')}</span>}
      </div>
      <div className="flex flex-col">
        <span className={LABEL}>{t('col.clabe')}</span>
        {m.clabeMasked ? <span className="tabular font-mono">{m.clabeMasked}</span> : <span className={cn(TAG, 'text-accent')}>{t('noClabe')}</span>}
      </div>
      <div className="flex flex-col">
        <span className={LABEL}>{t('col.created')}</span>
        <span>{formatDate(m.createdAt, locale) || DASH}</span>
        <span className="text-muted">{m.createdBy.name?.trim() || DASH}</span>
      </div>
      <div className="flex flex-col items-start gap-2 md:items-end">
        <span className={cn(TAG, m.status === 'paid' ? 'text-success' : m.status === 'cancelled' ? 'text-muted' : 'text-text')}>{tStatus(m.status)}</span>
        <Link
          href={`/admin/manual-refunds/${m.id}`}
          className="inline-flex min-h-[44px] items-center border border-text px-4 text-[10px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
        >
          {t('view')}
        </Link>
      </div>
    </li>
  );
}
