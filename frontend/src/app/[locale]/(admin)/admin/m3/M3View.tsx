'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminOrders, refundOrder } from '@/lib/api';
import { useRole } from '@/lib/role';
import type { AppLocale } from '@/i18n/routing';
import type { AdminOrderDTO } from '@/types/contract';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';

/** Convierte pesos (texto) a centavos enteros; inválido/vacío → null (mismo helper que M5). */
function pesosToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const M3_PAGE_SIZE = 25;

export function M3View() {
  const t = useTranslations('admin.m3');
  const tt = useTranslations('admin.m3.table');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const te = useTranslations('error');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const getError = useErrorMessage();
  const [refundTarget, setRefundTarget] = useState<AdminOrderDTO | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundDone, setRefundDone] = useState<string | null>(null);

  // --- Filtros + paginación server-side (v1.25-buylist-orders-pagination · GET /admin/orders) ---
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minPesos, setMinPesos] = useState('');
  const [maxPesos, setMaxPesos] = useState('');
  // Debounce (P-5): el estado del input es inmediato (UX), pero sólo el VALOR DEBOUNCED alimenta el
  // `queryKey`/params server-side — así no se dispara un fetch por pulsación. Las fechas (`type=date`)
  // cambian de golpe y no necesitan debounce.
  const debouncedSearch = useDebouncedValue(search);
  const debouncedMinPesos = useDebouncedValue(minPesos);
  const debouncedMaxPesos = useDebouncedValue(maxPesos);
  const minCents = pesosToCents(debouncedMinPesos);
  const maxCents = pesosToCents(debouncedMaxPesos);
  const q = debouncedSearch.trim() === '' ? undefined : debouncedSearch.trim();
  // Cualquier cambio de filtro vuelve a la página 1.
  function resetPage() {
    setPage(1);
  }

  const query = useQuery({
    queryKey: [
      'admin-orders',
      page,
      q ?? '',
      from,
      to,
      minCents ?? '',
      maxCents ?? '',
    ],
    queryFn: () =>
      getAdminOrders({
        page,
        pageSize: M3_PAGE_SIZE,
        q,
        from: from || undefined,
        to: to || undefined,
        minCents: minCents ?? undefined,
        maxCents: maxCents ?? undefined,
      }),
  });
  const totalPages =
    query.data && query.data.pageSize > 0
      ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize))
      : 1;

  // Reembolso EXCEPCIONAL (contrato §M3 · POST /admin/orders/:id/refund, super_admin,
  // money-out): exige `reason` (queda en bitácora) y refresca la cola al confirmar.
  const refundMutation = useMutation({
    mutationFn: (vars: { orderId: string; reason: string }) =>
      refundOrder(vars.orderId, vars.reason),
    onSuccess: (d) => {
      closeRefund();
      setRefundDone(d.orderId);
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });

  function openRefund(order: AdminOrderDTO) {
    setRefundTarget(order);
    setRefundReason('');
    setRefundDone(null);
    refundMutation.reset();
  }
  function closeRefund() {
    setRefundTarget(null);
    setRefundReason('');
  }

  const columns: Column<AdminOrderDTO>[] = [
    { key: 'id', header: tt('order'), render: (o) => <span className="tabular font-medium">{o.id}</span> },
    { key: 'user', header: tt('user'), render: (o) => <span className="tabular text-muted">{o.userId}</span> },
    { key: 'status', header: tt('status'), render: (o) => <StatusBadge domain="order" value={o.status} /> },
    { key: 'total', header: tt('total'), numeric: true, render: (o) => formatMoneyCents(o.totalCents, locale) },
    { key: 'date', header: tt('date'), render: (o) => formatDate(o.createdAt, locale) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (o) =>
        o.status === 'settled' ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={!isSuperAdmin}
            title={!isSuperAdmin ? tm('masked') : undefined}
            onClick={() => openRefund(o)}
          >
            {t('refund')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>
      {!isSuperAdmin && <Banner variant="warning">{te('MONEY_OUT_FORBIDDEN')}</Banner>}
      {refundDone && (
        <Banner variant="success" role="status">
          {t('refundDone', { orderId: refundDone })}
        </Banner>
      )}

      {/* Buscador (folio/orderNumber + comprador) + filtros de fecha y monto, todos server-side. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Input
            label={t('searchLabel')}
            value={search}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="w-40">
          <Input
            label={t('filters.dateFrom')}
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="w-40">
          <Input
            label={t('filters.dateTo')}
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="w-32">
          <Input
            label={t('filters.minAmount')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={minPesos}
            onChange={(e) => {
              setMinPesos(e.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="w-32">
          <Input
            label={t('filters.maxAmount')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={maxPesos}
            onChange={(e) => {
              setMaxPesos(e.target.value);
              resetPage();
            }}
          />
        </div>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data &&
          (query.data.data.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-border bg-surface p-2">
                <DataTable columns={columns} rows={query.data.data} rowKey={(o) => o.id} />
              </div>
              {/* Paginación server-side (page/pageSize/total del contrato v1.25). */}
              {totalPages > 1 && (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('prev')}
                  </Button>
                  <span className="tabular text-xs text-muted">
                    {t('pageInfo', { page: query.data.page, totalPages })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('next')}
                  </Button>
                </div>
              )}
            </div>
          ))}
      </QueryState>

      <Modal
        open={!!refundTarget}
        onClose={closeRefund}
        title={t('refund')}
        footer={
          <>
            <Button variant="secondary" onClick={closeRefund}>
              {tc('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={refundReason.trim() === ''}
              loading={refundMutation.isPending}
              onClick={() =>
                refundTarget &&
                refundMutation.mutate({ orderId: refundTarget.id, reason: refundReason.trim() })
              }
            >
              {refundTarget && t('refundConfirm', { amount: formatMoneyCents(refundTarget.totalCents, locale) })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>{t('refundQuestion')}</p>
          <Input
            label={t('refundReasonLabel')}
            hint={t('refundReasonHint')}
            type="text"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
          />
          <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
          {refundMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(refundMutation.error)}
            </Banner>
          )}
        </div>
      </Modal>
    </div>
  );
}
