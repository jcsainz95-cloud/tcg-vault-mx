'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SupplierQueryState as QueryState } from './SupplierQueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { SUPPLY_TTL, listSupplierPurchases, type SupplyPurchase } from '@/lib/api/suppliers';
import { CardLine } from './CardLine';
import { Expiry } from './Expiry';
import { PURCHASE_TONE } from './supplier-labels';

/** Acuerdos, recogida y pago: solo lectura (contrato §4). */
export function SupplierPurchasesView() {
  const t = useTranslations('supplier.purchases');
  const query = useQuery({ queryKey: ['supplier', 'purchases'], queryFn: () => listSupplierPurchases() });
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl text-text">{t('title')}</h1>
        <p className="text-sm text-muted">{t('lead', { days: SUPPLY_TTL.purchaseDays })}</p>
      </header>
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} loading={<Skeleton className="h-40 w-full" />}>
        {query.data && query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {query.data?.data.map((p) => (
              <li key={p.id} className="py-5">
                <PurchaseRow p={p} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function PurchaseRow({ p }: { p: SupplyPurchase }) {
  const t = useTranslations('supplier.purchases');
  const ts = useTranslations('supplier.purchaseStatus');
  const tr = useTranslations('supplier.unitResult');
  const locale = useLocale() as AppLocale;
  return (
    <div className="flex flex-col gap-3">
      <CardLine card={p.card} />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <Badge tone={PURCHASE_TONE[p.status]}>{ts(p.status)}</Badge>
        <span className="font-mono text-text">{t('agreed', { qty: p.qty, unit: formatMoneyCents(p.agreedUnitCents, locale) })}</span>
        <span className="font-mono text-text">{t('total', { total: formatMoneyCents(p.totalCents, locale) })}</span>
      </div>
      {p.status === 'agreed' && (
        <>
          <p className="text-sm text-text">{t('bringIt')}</p>
          <Expiry iso={p.pickupDueAt} />
        </>
      )}
      {p.status === 'cancelled' && <p className="text-sm text-muted">{p.reason ? t(`cancelledReason.${p.reason}`) : t('cancelled')}</p>}
      {p.units.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {p.units.map((u) => (
            <li key={u.n} className="flex flex-wrap justify-between gap-2 font-mono">
              <span>{t('unit', { n: u.n, condition: u.condition })}</span>
              <span className="text-muted">
                {tr(u.result)}
                {u.unitPayableCents != null && ` · ${formatMoneyCents(u.unitPayableCents, locale)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.payableCents != null && (
        <p className="font-mono text-base text-text">{t('payable', { amount: formatMoneyCents(p.payableCents, locale) })}</p>
      )}
      {p.status === 'paid' && p.paidAt && (
        <p className="text-sm text-muted">
          {t('paidOn', { date: formatDateTimeMx(p.paidAt, locale), method: p.method ? t(`method.${p.method}`) : '' })}
          {p.reference ? ` · ${p.reference}` : ''}
        </p>
      )}
    </div>
  );
}
