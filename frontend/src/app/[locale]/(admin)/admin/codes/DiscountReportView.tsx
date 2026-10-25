'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { downloadDiscountReportCsv, getDiscountCode, getDiscountCodeBatch, getDiscountReport } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { StatCard } from '@/components/ui/StatCard';
import { downloadTextFile } from '@/lib/download';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';

/**
 * Reporte por código o por lote (§DSC-UX.5 D9, contrato §DSC.7 `DiscountReportDTO`). «¿Cuánto me costó y cuánto
 * vendí?»: cada cifra es un campo del servidor (`discountGivenCents` es la suma de lo que Ventas muestra, 913). Cero
 * usos ⇒ ceros legítimos, no error (§DSC-UX.6).
 */
export function DiscountReportView({ kind, id }: { kind: 'code' | 'batch'; id: string }) {
  const t = useTranslations('admin.discounts');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage('operator');
  const money = (c: number) => formatMoneyCents(c, locale);
  const [csvError, setCsvError] = useState<string | null>(null);
  const subject = useQuery({
    queryKey: ['admin-discount-subject', kind, id],
    queryFn: async () => (kind === 'code' ? (await getDiscountCode(id)).code : (await getDiscountCodeBatch(id)).prefix),
  });
  const report = useQuery({ queryKey: ['admin-discount-report', kind, id], queryFn: () => getDiscountReport({ kind, id }) });

  async function csv() {
    try {
      const res = await downloadDiscountReportCsv({ kind, id });
      downloadTextFile(res.filename ?? `reporte-${subject.data ?? id}.csv`, await res.blob.text());
      setCsvError(null);
    } catch (e) {
      setCsvError(getMessage(e));
    }
  }

  const r = report.data;
  return (
    <div>
      <Link href="/admin/codes" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
        ← {t('back')}
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-3xl text-text [overflow-wrap:anywhere]">{t('report.title', { code: subject.data ?? '…' })}</h1>
        <Button variant="secondary" onClick={() => void csv()} disabled={!r}>
          {t('downloadCsv')}
        </Button>
      </div>
      {csvError && (
        <p role="alert" className="mt-3 font-mono text-xs text-accent">
          {csvError}
        </p>
      )}
      <div className="mt-6">
        <QueryState isLoading={report.isLoading} isError={report.isError} error={report.error} onRetry={() => report.refetch()}>
          {r && (
            <>
              <div className="grid border-y border-border sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label={t('report.uses')}
                  value={t('usage', { consumed: r.consumed, reserved: r.reservedNow, limit: r.limit ?? t('noLimit') })}
                  sub={t('report.usesSub')}
                />
                <StatCard label={t('report.given')} value={money(r.discountGivenCents)} sub={t('report.givenSub', { n: r.paidOrders })} />
                <StatCard label={t('report.sales')} value={money(r.salesCollectedCents)} sub={t('report.salesSub')} />
                <StatCard label={t('report.refunded')} value={t('report.refundedValue', { n: r.refundedOrders, amount: money(r.refundedCents) })} />
                {(r.shippingWaivedOrdersCents > 0 || r.shippingWaivedWithdrawalsCents > 0) && (
                  // ⛔ Sin sumar en el cliente: pedidos y retiros son dos campos del servidor y se pintan los dos.
                  <StatCard
                    label={t('report.waived')}
                    value={money(r.shippingWaivedOrdersCents)}
                    sub={t('report.waivedSub', { amount: money(r.shippingWaivedWithdrawalsCents), n: r.withdrawals })}
                  />
                )}
              </div>
              <p className="rule-note mt-4 text-[13px] text-muted">{t('report.refundNote')}</p>

              {r.rows.length === 0 ? (
                <div className="mt-8">
                  <EmptyState title={t('report.emptyRows')} />
                </div>
              ) : (
                <div className="mt-8 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="font-mono text-[10px] uppercase tracking-label text-muted">
                      <tr className="border-b border-border">
                        <th className="py-3 pr-4 font-normal">{t('report.columns.date')}</th>
                        <th className="py-3 pr-4 font-normal">{t('report.columns.folio')}</th>
                        <th className="py-3 pr-4 font-normal">{t('report.columns.email')}</th>
                        <th className="py-3 pr-4 text-right font-normal">{t('report.columns.discounted')}</th>
                        <th className="py-3 pr-4 text-right font-normal">{t('report.columns.collected')}</th>
                        <th className="py-3 font-normal">{t('report.columns.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row) => (
                        <tr key={`${row.folio}-${row.at}`} className="border-b border-border">
                          <td className="py-3 pr-4 text-muted">{formatDateTimeMx(row.at, locale)}</td>
                          <td className="py-3 pr-4 font-mono">{row.folio}</td>
                          <td className="py-3 pr-4 [overflow-wrap:anywhere]">{row.customerEmail ?? ''}</td>
                          <td className="tabular py-3 pr-4 text-right">{money(row.kind === 'withdrawal' ? row.shippingWaivedCents : row.discountCents)}</td>
                          <td className="tabular py-3 pr-4 text-right">{money(row.totalCents)}</td>
                          <td className="py-3 font-mono text-[11px] uppercase tracking-label">{t(`report.status.${row.status}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {kind === 'batch' && r.usedCodes && (
                <div className="mt-8">
                  <p className="eyebrow text-text">{t('report.usedCodes', { used: r.usedCodes.length, n: r.limit ?? r.usedCodes.length })}</p>
                  <ul className="mt-3 grid gap-1 text-sm">
                    {r.usedCodes.map((u) => (
                      <li key={u.code} className="flex flex-wrap gap-3">
                        <span className="font-mono">{u.code}</span>
                        <span className="text-muted">{formatDateTimeMx(u.at, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </QueryState>
      </div>
    </div>
  );
}
