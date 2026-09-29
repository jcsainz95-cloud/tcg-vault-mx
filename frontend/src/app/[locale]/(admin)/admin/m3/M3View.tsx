'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminOrders } from '@/lib/api';
import { useRole } from '@/lib/role';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { AdminOrderDTO } from '@/types/contract';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { RefundOrderDialog } from './RefundOrderDialog';

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
  const te = useTranslations('error');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const [refundTarget, setRefundTarget] = useState<AdminOrderDTO | null>(null);
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

  // Reembolso TOTAL, excepcional (contrato §M3 · POST /admin/orders/:id/refund, super_admin, money-out):
  // vive en `RefundOrderDialog` (§37.10: vaultPieces, confirmación de piezas, retiro empacado).
  function openRefund(order: AdminOrderDTO) {
    setRefundTarget(order);
    setRefundDone(null);
  }
  function closeRefund() {
    setRefundTarget(null);
  }

  // §37.11: la fila dice QUIÉN compró (nombre + correo; «Invitado» si no hay cuenta) y cuánto se le devolvió.
  function customerCell(o: AdminOrderDTO) {
    const name = o.customer?.fullName?.trim();
    const email = o.customer?.email ?? o.guestEmail ?? null;
    return (
      <span className="flex flex-col">
        <span>{name || (o.isGuestOrder || !o.customer ? t('guest') : t('nameMissing'))}</span>
        {email && <span className="text-xs text-muted">{email}</span>}
      </span>
    );
  }

  const columns: Column<AdminOrderDTO>[] = [
    {
      key: 'id',
      header: tt('order'),
      render: (o) => (
        <Link href={`/admin/m3/${o.id}`} className="tabular font-medium underline underline-offset-4 hover:text-accent" data-testid={`m3-order-link-${o.id}`}>
          {o.orderNumber ?? o.id}
        </Link>
      ),
    },
    { key: 'customer', header: tt('customer'), render: customerCell },
    { key: 'status', header: tt('status'), render: (o) => <StatusBadge domain="order" value={o.status} /> },
    { key: 'total', header: tt('total'), numeric: true, render: (o) => formatMoneyCents(o.totalCents, locale) },
    {
      key: 'refunded',
      header: tt('refunded'),
      numeric: true,
      render: (o) => (o.refundedCents ? <span className="tabular">{formatMoneyCents(o.refundedCents, locale)}</span> : <span className="text-muted">—</span>),
    },
    { key: 'date', header: tt('date'), render: (o) => formatDate(o.createdAt, locale) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (o) => (
        <span className="flex items-center justify-end gap-2">
          <Link href={`/admin/m3/${o.id}`} className="text-sm underline underline-offset-4 hover:text-accent">
            {t('viewDetail')}
          </Link>
          {o.status === 'settled' && isSuperAdmin && (
            <Button variant="destructive" size="sm" onClick={() => openRefund(o)}>
              {t('refund')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        {isSuperAdmin && (
          <Link href="/admin/refunds" className="text-sm underline underline-offset-4 hover:text-accent" data-testid="m3-operator-refunds-link">
            {t('operatorRefundsLink')}
          </Link>
        )}
      </div>
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

      <RefundOrderDialog
        order={refundTarget}
        open={!!refundTarget}
        onClose={closeRefund}
        onDone={(res) => {
          closeRefund();
          setRefundDone(res.orderId);
        }}
      />
    </div>
  );
}
