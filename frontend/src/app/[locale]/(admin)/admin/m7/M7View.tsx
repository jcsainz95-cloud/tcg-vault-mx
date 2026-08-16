'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { DownloadCloud, TrendingUp, Boxes, Landmark, ReceiptText } from 'lucide-react';
import {
  getPnl,
  getInventoryValue,
  getCustodyValue,
  getIvaReport,
  exportFinanceCsv,
  type FinanceRange,
  type FinanceCsvReport,
} from '@/lib/api';
import type { IvaByOrderEntryDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { downloadTextFile } from '@/lib/download';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { StatCard } from '@/components/ui/StatCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';

/** Fila del desglose del P&L (fórmula: ingresos + envío − COGS − Stripe = ganancia). */
function PnlLine({ label, value, sign }: { label: string; value: string; sign: '+' | '−' | '=' }) {
  const tone = sign === '−' ? 'text-danger' : sign === '=' ? 'text-text' : 'text-text';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2 text-sm">
        <span aria-hidden className={`w-4 tabular font-semibold ${sign === '−' ? 'text-danger' : 'text-muted'}`}>{sign}</span>
        <span className="text-muted">{label}</span>
      </span>
      <span className={`tabular font-medium ${tone}`}>{value}</span>
    </div>
  );
}

export function M7View() {
  const t = useTranslations('admin.m7');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range: FinanceRange = { from: from || undefined, to: to || undefined };

  const pnl = useQuery({ queryKey: ['finance-pnl', range], queryFn: () => getPnl(range) });
  const inventoryValue = useQuery({ queryKey: ['finance-inventory-value'], queryFn: getInventoryValue });
  const custodyValue = useQuery({ queryKey: ['finance-custody-value'], queryFn: getCustodyValue });
  const iva = useQuery({ queryKey: ['finance-iva', range], queryFn: () => getIvaReport(range) });

  const exportMutation = useMutation({
    mutationFn: async (report: FinanceCsvReport) => {
      const csv = await exportFinanceCsv({ report, from: range.from, to: range.to, source: 'finance' });
      const suffix = [range.from, range.to].filter(Boolean).join('_') || 'all';
      downloadTextFile(`tcgvault_${report}_${suffix}.csv`, csv);
      return report;
    },
  });

  const ivaColumns: Column<IvaByOrderEntryDTO>[] = useMemo(
    () => [
      { key: 'orderId', header: t('iva.order'), render: (o) => <span className="tabular">{o.orderId}</span> },
      { key: 'iva', header: t('iva.amount'), align: 'right', render: (o) => <span className="tabular">{formatMoneyCents(o.ivaCents, locale)}</span> },
      { key: 'date', header: t('iva.date'), render: (o) => <span className="tabular text-muted">{o.settledAt ? formatDate(o.settledAt, locale) : '—'}</span> },
    ],
    [t, locale],
  );

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      {/* Selector de rango de fechas (aplica a P&L e IVA) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('range.title')}</h2>
        <p className="text-sm text-muted">{t('range.subtitle')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input label={t('range.from')} type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t('range.to')} type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && (
            <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>
              {t('range.clear')}
            </Button>
          )}
        </div>
      </section>

      {/* P&L con el desglose de la fórmula */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('pnl.title')}</h2>
        <p className="text-sm text-muted">{t('pnl.formula')}</p>
        <QueryState isLoading={pnl.isLoading} isError={pnl.isError} error={pnl.error} onRetry={() => pnl.refetch()}>
          {pnl.data && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-col divide-y divide-border">
                <PnlLine sign="+" label={t('pnl.income')} value={formatMoneyCents(pnl.data.incomeCents, locale)} />
                <PnlLine sign="+" label={t('pnl.shipping')} value={formatMoneyCents(pnl.data.shippingCents, locale)} />
                <PnlLine sign="−" label={t('pnl.cogs')} value={formatMoneyCents(pnl.data.cogsCents, locale)} />
                <PnlLine sign="−" label={t('pnl.stripeFees')} value={formatMoneyCents(pnl.data.stripeFeesCents, locale)} />
              </div>
              <div className="mt-1 flex items-center justify-between border-t-2 border-border-strong pt-3">
                <span className="flex items-center gap-2 font-semibold">
                  <TrendingUp size={18} className={pnl.data.profitCents >= 0 ? 'text-success' : 'text-danger'} />
                  {t('pnl.profit')}
                </span>
                <span className={`tabular text-h2 font-bold ${pnl.data.profitCents >= 0 ? 'text-success' : 'text-danger'}`}>
                  {formatMoneyCents(pnl.data.profitCents, locale)}
                </span>
              </div>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={exportMutation.isPending && exportMutation.variables === 'pnl'}
                  onClick={() => exportMutation.mutate('pnl')}
                >
                  <DownloadCloud size={16} /> {t('export.pnl')}
                </Button>
              </div>
            </div>
          )}
        </QueryState>
      </section>

      {/* Valor de inventario / bóveda / custodia */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('values.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <QueryState isLoading={inventoryValue.isLoading} isError={inventoryValue.isError} error={inventoryValue.error} onRetry={() => inventoryValue.refetch()}>
            {inventoryValue.data && (
              <StatCard
                label={t('values.inventoryAtReference')}
                value={formatMoneyCents(inventoryValue.data.atReferenceCents, locale)}
                sub={`${t('values.inventoryAtCost')}: ${formatMoneyCents(inventoryValue.data.atCostCents, locale)} · ${t('values.pendingPrice', { count: inventoryValue.data.pendingPriceCount })}`}
                icon={<Boxes size={18} />}
              />
            )}
          </QueryState>
          <QueryState isLoading={custodyValue.isLoading} isError={custodyValue.isError} error={custodyValue.error} onRetry={() => custodyValue.refetch()}>
            {custodyValue.data && (
              <StatCard
                label={t('values.custody')}
                value={formatMoneyCents(custodyValue.data.totalCustodyValueCents, locale)}
                sub={t('values.custodyNote')}
                icon={<Landmark size={18} />}
              />
            )}
          </QueryState>
          <QueryState isLoading={iva.isLoading} isError={iva.isError} error={iva.error} onRetry={() => iva.refetch()}>
            {iva.data && (
              <StatCard
                label={t('iva.collected')}
                value={formatMoneyCents(iva.data.ivaCollectedCents, locale)}
                sub={t('iva.note')}
                icon={<ReceiptText size={18} />}
              />
            )}
          </QueryState>
        </div>
      </section>

      {/* IVA acumulado — desglose por orden + export */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('iva.title')}</h2>
        <p className="text-sm text-muted">{t('iva.subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={exportMutation.isPending && exportMutation.variables === 'iva'}
            onClick={() => exportMutation.mutate('iva')}
          >
            <DownloadCloud size={16} /> {t('export.iva')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={exportMutation.isPending && exportMutation.variables === 'inventory'}
            onClick={() => exportMutation.mutate('inventory')}
          >
            <DownloadCloud size={16} /> {t('export.inventory')}
          </Button>
        </div>
        {exportMutation.isError && <Banner variant="danger" role="alert">{tc('errorGeneric')}</Banner>}
        <QueryState isLoading={iva.isLoading} isError={iva.isError} error={iva.error} onRetry={() => iva.refetch()}>
          {iva.data &&
            (iva.data.byOrder.length > 0 ? (
              <div className="rounded-lg border border-border bg-surface p-2">
                <DataTable columns={ivaColumns} rows={iva.data.byOrder} rowKey={(o) => o.orderId} />
              </div>
            ) : (
              <EmptyState title={t('iva.empty')} />
            ))}
        </QueryState>
      </section>
    </div>
  );
}
