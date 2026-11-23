'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Boxes, Landmark } from 'lucide-react';
import { getCustodyValue, getInventoryValue } from '@/lib/api';
import { usePickingSummary } from '@/hooks/usePickingSummary';
import { useRole } from '@/lib/role';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { formatCount, formatMoneyCents } from '@/lib/format';
import { QueryState } from '@/components/ui/QueryState';
import { StatCard } from '@/components/ui/StatCard';
import { BuyListTab, type BuyListUrlState } from '../m9/BuyListTab';
import { Figure } from './Figure';

/**
 * Reportes › Inventario (§REPORTES-CEO F1). Súper-admin: valor de inventario y de custodia (antes duplicado en Inicio y en
 * Finanzas) y «Qué reponer» (antes «Lista de compra» de Reportes). Operador: solo unidades (piezas por reponer), sin dinero;
 * las consultas de dinero y de la lista de compra NO se piden para él.
 */
export function StockView({ initialBuyList = { dir: 'desc' } }: { initialBuyList?: BuyListUrlState }) {
  const t = useTranslations('admin.reports.stock');
  const tm = useTranslations('admin.modules');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const inv = useQuery({ queryKey: ['finance-inventory-value'], queryFn: getInventoryValue, enabled: isSuperAdmin });
  const custody = useQuery({ queryKey: ['finance-custody-value'], queryFn: getCustodyValue, enabled: isSuperAdmin });
  const picking = usePickingSummary();
  const link = 'text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none';

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-h1 font-bold">{tm('reportsStock')}</h1>
      <p className="max-w-2xl text-sm text-muted">{t('intro')}</p>

      {isSuperAdmin ? (
        <section aria-labelledby="stock-values" className="flex flex-col gap-3">
          <h2 id="stock-values" className="text-h2 font-semibold">{t('values')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <QueryState isLoading={inv.isLoading} isError={inv.isError} error={inv.error} onRetry={() => inv.refetch()}>
              {inv.data && (
                <StatCard
                  label={t('reference')}
                  value={formatMoneyCents(inv.data.atReferenceCents, locale)}
                  sub={`${t('atCost')}: ${formatMoneyCents(inv.data.atCostCents, locale)} · ${t('pendingPrice', { count: inv.data.pendingPriceCount })}`}
                  icon={<Boxes size={18} />}
                />
              )}
            </QueryState>
            <QueryState isLoading={custody.isLoading} isError={custody.isError} error={custody.error} onRetry={() => custody.refetch()}>
              {custody.data && (
                <StatCard
                  label={t('custody')}
                  value={formatMoneyCents(custody.data.totalCustodyValueCents, locale)}
                  sub={t('custodyNote')}
                  icon={<Landmark size={18} />}
                />
              )}
            </QueryState>
          </div>
        </section>
      ) : (
        <section aria-labelledby="stock-units" className="flex flex-col gap-3" data-testid="stock-operator">
          <h2 id="stock-units" className="text-h2 font-semibold">{t('units')}</h2>
          <QueryState isLoading={picking.isLoading} isError={picking.isError} error={picking.error} onRetry={() => picking.refetch()}>
            {picking.data && (
              <div className="grid border border-border bg-surface sm:grid-cols-2">
                <Figure label={t('toReplace')} value={formatCount(picking.data.toReplace, locale)} />
              </div>
            )}
          </QueryState>
          <p className="text-sm text-muted">{t('operatorNote')}</p>
        </section>
      )}

      <p className="text-sm text-muted">
        {t.rich('edit', { link: (c) => <Link href="/admin/m1" className={link}>{c}</Link> })}
      </p>

      {isSuperAdmin && (
        <section id="reponer" aria-label={t('restock')} className="scroll-mt-6">
          <BuyListTab initial={initialBuyList} />
        </section>
      )}
    </div>
  );
}
