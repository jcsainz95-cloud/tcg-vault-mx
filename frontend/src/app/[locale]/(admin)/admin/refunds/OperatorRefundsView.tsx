'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminRefunds, getOperatorRefundSummary, retryRefund } from '@/lib/api';
import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatDate, formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { AdminRefundRowDTO, OperatorRefundSummaryDTO, PaymentRefundKind, PaymentRefundStatus, Role } from '@/types/contract';

const DASH = '—';
const KINDS: PaymentRefundKind[] = ['item_missing', 'order_remaining', 'shipment_fee', 'order_full', 'case_refund'];
const STATUSES: PaymentRefundStatus[] = ['requested', 'submitted', 'succeeded', 'failed'];

/**
 * **«Reembolsos de operadores»** (v4.10: cubeta `?tab=operadores` de `/admin/refunds`, §37.20 · `DESIGN_SYSTEM §37.11b` · contrato `§M4-SHIP.17.5`). Es la vigilancia del
 * súper-admin sobre la política nueva de `§M4-SHIP.8` («también el operador reembolsa»): el resumen por operador
 * (24 h / 7 d / 30 d, tope usado, tasa de faltantes, merma, «repuso lo que marcó») y el libro filtrable con
 * «Reintentar». ⛔ Sin correo (D-13): el panel es el aviso.
 */
export function OperatorRefundsView() {
  return (
    <SuperAdminOnly>
      <OperatorRefunds />
    </SuperAdminOnly>
  );
}

function OperatorRefunds() {
  const t = useTranslations('admin.refunds');
  const tr = useTranslations('admin.m3.refunds');
  const tRole = useTranslations('admin.m3.role');
  const tRefund = useTranslations('status.paymentRefund');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [role, setRole] = useState<'' | Role>('');
  const [kind, setKind] = useState<'' | PaymentRefundKind>('');
  const [status, setStatus] = useState<'' | PaymentRefundStatus>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [retried, setRetried] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useQuery({ queryKey: ['admin-operator-summary'], queryFn: getOperatorRefundSummary });
  const ledger = useQuery({
    queryKey: ['admin-refunds', role, kind, status, from, to, page],
    queryFn: () => getAdminRefunds({ requestedByRole: role || undefined, kind: kind || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: 25 }),
  });
  const totalPages = ledger.data && ledger.data.pageSize > 0 ? Math.max(1, Math.ceil(ledger.data.total / ledger.data.pageSize)) : 1;

  const retry = useMutation({
    mutationFn: (id: string) => retryRefund(id),
    onSuccess: (res) => {
      setError(null);
      setRetried(t('retried', { status: tRefund(res.status) }));
      void qc.invalidateQueries({ queryKey: ['admin-refunds'] });
      void qc.invalidateQueries({ queryKey: ['admin-operator-summary'] });
    },
    onError: (e) => setError(getError(e)),
  });

  const summaryColumns: Column<OperatorRefundSummaryDTO>[] = [
    {
      key: 'operator',
      header: t('col.operator'),
      render: (r) => (
        <span className="flex flex-col">
          <span>{r.user.name?.trim() || t('noName')}</span>
          <span className="text-muted">
            {/* ⭐ v1.80.9 (§42.5.1, UX-8 = STF-27): `email ?? username`, ⛔ nunca un hueco. */}
            {r.user.email ?? r.user.username ?? '—'}
            {!r.user.active && <> · {t('inactive')}</>}
          </span>
        </span>
      ),
    },
    { key: 'h24', header: t('col.h24'), numeric: true, render: (r) => t('countAmount', { count: r.refunds.last24h.count, amount: formatMoneyCents(r.refunds.last24h.cents, locale) }) },
    { key: 'd7', header: t('col.d7'), numeric: true, render: (r) => t('countAmount', { count: r.refunds.last7d.count, amount: formatMoneyCents(r.refunds.last7d.cents, locale) }) },
    { key: 'd30', header: t('col.d30'), numeric: true, render: (r) => t('countAmount', { count: r.refunds.last30d.count, amount: formatMoneyCents(r.refunds.last30d.cents, locale) }) },
    { key: 'cap', header: t('col.cap'), numeric: true, render: (r) => t('capUsed', { used: formatMoneyCents(r.capUsedCents, locale), cap: formatMoneyCents(summary.data?.capCents ?? 0, locale) }) },
    { key: 'prepared', header: t('col.prepared'), numeric: true, render: (r) => String(r.prepared30d.shipments) },
    {
      key: 'missing',
      header: t('col.missing'),
      numeric: true,
      render: (r) => (r.prepared30d.missingRatePct === null ? t('noLines') : t('missingRate', { missing: r.prepared30d.missingLines, lines: r.prepared30d.lines, pct: r.prepared30d.missingRatePct })),
    },
    { key: 'shrinkage', header: t('col.shrinkage'), numeric: true, render: (r) => t('shrinkage', { pieces: r.shrinkage30d.pieces, amount: formatMoneyCents(r.shrinkage30d.costCents, locale) }) },
    { key: 'self', header: t('col.selfReplaced'), numeric: true, render: (r) => String(r.selfReplaced30d) },
  ];

  const ledgerColumns: Column<AdminRefundRowDTO>[] = [
    { key: 'date', header: t('col.date'), render: (r) => formatDateTimeMx(r.requestedAt, locale) },
    { key: 'who', header: t('col.who'), render: (r) => `${r.requestedBy.name?.trim() || t('noName')} (${tRole(r.requestedBy.role)})` },
    {
      key: 'order',
      header: t('col.order'),
      render: (r) =>
        r.order ? (
          <Link href={`/admin/m3/${r.order.id}`} className="tabular underline underline-offset-4 hover:text-accent">
            {r.order.orderNumber ?? r.order.id}
          </Link>
        ) : (
          <span className="tabular font-mono">{r.shipmentId ?? DASH}</span>
        ),
    },
    { key: 'card', header: t('col.card'), render: (r) => (r.item ? <span lang="en">{r.item.cardName} · {r.item.folio}</span> : DASH) },
    { key: 'kind', header: t('col.kind'), render: (r) => tr(`kind.${r.kind}`) },
    { key: 'amount', header: t('col.amount'), numeric: true, render: (r) => formatMoneyCents(r.amountCents, locale) },
    {
      key: 'status',
      header: t('col.status'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span>{tRefund(r.status)}</span>
          {r.status === 'requested' && (
            <Button size="sm" variant="ghost" loading={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}>
              {t('retry')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* §37.20 b: la cubeta pierde su `h1` — el de la página es uno solo («Reembolsos»); el `hint` se queda. */}
      <p className="text-sm text-muted">{t('hint')}</p>
      {retried && (
        <Banner variant="success" role="status">
          {retried}
        </Banner>
      )}
      {error && (
        <Banner variant="danger" role="alert" title={tc('errorTitle')}>
          {error}
        </Banner>
      )}

      <section className="flex flex-col gap-3" data-testid="operator-summary">
        <h2 className="text-h2 font-semibold">{t('summaryTitle')}</h2>
        <QueryState isLoading={summary.isLoading} isError={summary.isError} error={summary.error} onRetry={() => summary.refetch()}>
          {summary.data && (
            <>
              <p className="text-sm text-muted">{t('generatedAt', { date: formatDateTimeMx(summary.data.generatedAt, locale), cap: formatMoneyCents(summary.data.capCents, locale) })}</p>
              {summary.data.operators.length === 0 ? (
                <EmptyState title={t('summaryEmpty')} />
              ) : (
                <div className="rounded-lg border border-border bg-surface p-2">
                  <DataTable columns={summaryColumns} rows={summary.data.operators} rowKey={(r) => r.user.userId} />
                </div>
              )}
            </>
          )}
        </QueryState>
      </section>

      <section className="flex flex-col gap-3" data-testid="refund-ledger">
        <h2 className="text-h2 font-semibold">{t('ledgerTitle')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Select label={t('filter.role')} className="w-40" value={role} onChange={(e) => { setRole(e.target.value as '' | Role); setPage(1); }} options={[{ value: '', label: t('filter.roleAll') }, { value: 'vault_operator', label: tRole('vault_operator') }, { value: 'super_admin', label: tRole('super_admin') }]} />
          <Select label={t('filter.kind')} className="w-48" value={kind} onChange={(e) => { setKind(e.target.value as '' | PaymentRefundKind); setPage(1); }} options={[{ value: '', label: t('filter.kindAll') }, ...KINDS.map((k) => ({ value: k, label: tr(`kind.${k}`) }))]} />
          <Select label={t('filter.status')} className="w-44" value={status} onChange={(e) => { setStatus(e.target.value as '' | PaymentRefundStatus); setPage(1); }} options={[{ value: '', label: t('filter.statusAll') }, ...STATUSES.map((s) => ({ value: s, label: tRefund(s) }))]} />
          <div className="w-40">
            <Input label={t('filter.from')} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="w-40">
            <Input label={t('filter.to')} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
        </div>
        <QueryState isLoading={ledger.isLoading} isError={ledger.isError} error={ledger.error} onRetry={() => ledger.refetch()}>
          {ledger.data && (
            <>
              <p className="tabular text-sm text-text">{t('ledgerSum', { count: ledger.data.total, amount: formatMoneyCents(ledger.data.sumCents, locale) })}</p>
              {ledger.data.data.length === 0 ? (
                <EmptyState title={t('ledgerEmpty')} />
              ) : (
                <div className="rounded-lg border border-border bg-surface p-2">
                  <DataTable columns={ledgerColumns} rows={ledger.data.data} rowKey={(r) => r.id} />
                </div>
              )}
              {totalPages > 1 && (
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    {tc('back')}
                  </Button>
                  <span className="tabular text-xs text-muted">
                    {ledger.data.page} / {totalPages} · {formatDate(new Date().toISOString(), locale)}
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
    </div>
  );
}
