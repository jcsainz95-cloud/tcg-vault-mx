'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

  const query = useQuery({ queryKey: ['admin-orders'], queryFn: getAdminOrders });

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

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <div className="rounded-lg border border-border bg-surface p-2">
            <DataTable columns={columns} rows={query.data} rowKey={(o) => o.id} />
          </div>
        )}
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
