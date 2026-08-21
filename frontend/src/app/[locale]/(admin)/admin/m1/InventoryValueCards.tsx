'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getInventoryValue } from '@/lib/api';
import type { InventoryValueBucketDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Link } from '@/i18n/navigation';

/**
 * Tarjetas de valor del inventario — P-24 (DESIGN_SYSTEM §16.2). Consumen
 * GET /admin/finance/inventory-value (breakdown v1.28). SOLO super_admin: para vault_operator
 * el PADRE omite la fila por completo (sin candados — coherente con el guard del endpoint).
 * Regla de confianza: las piezas sin precio están EXCLUIDAS del total; la línea "N sin precio"
 * hace esa exclusión visible (enlace a la cola M2), nunca silenciosa.
 */
export function InventoryValueCards() {
  const t = useTranslations('admin.inventory.value');
  const locale = useLocale() as AppLocale;

  const value = useQuery({ queryKey: ['inventory-value'], queryFn: getInventoryValue });

  if (value.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-bg px-6 py-7">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-7 w-36" />
          </div>
        ))}
      </div>
    );
  }
  if (value.isError) {
    return (
      <div className="flex items-center justify-between gap-3 border border-border px-4 py-3">
        <span className="text-sm text-muted">{t('loadError')}</span>
        <Button size="sm" variant="secondary" onClick={() => value.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  const data = value.data;
  if (!data) return null;

  const buckets: { label: string; bucket: InventoryValueBucketDTO }[] = [
    {
      label: t('total'),
      bucket: {
        atReferenceCents: data.atReferenceCents,
        atCostCents: data.atCostCents,
        pieceCount: 0,
        pendingPriceCount: data.pendingPriceCount,
      },
    },
    ...(data.breakdown
      ? [
          { label: t('raw'), bucket: data.breakdown.raw },
          { label: t('sealed'), bucket: data.breakdown.sealed },
          { label: t('graded'), bucket: data.breakdown.graded },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {buckets.map(({ label, bucket }) => (
        <StatCard
          key={label}
          className="bg-bg"
          label={label}
          value={formatMoneyCents(bucket.atReferenceCents, locale)}
          sub={
            <span className="flex flex-col gap-1">
              <span>{t('cost', { amount: formatMoneyCents(bucket.atCostCents, locale) })}</span>
              {bucket.pendingPriceCount > 0 && (
                <Link
                  href="/admin/m2?context=inventory"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {t('pendingCount', { count: bucket.pendingPriceCount })}
                </Link>
              )}
            </span>
          }
        />
      ))}
    </div>
  );
}
