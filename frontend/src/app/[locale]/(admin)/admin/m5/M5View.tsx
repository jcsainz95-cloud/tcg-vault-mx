'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminBuylist } from '@/lib/api';
import { useRole } from '@/lib/role';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState } from '@/components/ui/QueryState';
import { useBuylistSteps } from '@/lib/pipelines';

export function M5View() {
  const t = useTranslations('admin.m5');
  const tm = useTranslations('admin');
  const te = useTranslations('error');
  const locale = useLocale() as AppLocale;
  const steps = useBuylistSteps();
  const { isSuperAdmin } = useRole();
  const query = useQuery({ queryKey: ['admin-buylist'], queryFn: getAdminBuylist });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('cherryPick')}</p>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {(query.data ?? []).map((req) => (
          <div key={req.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="tabular text-sm font-medium">{req.id}</span>
                <StatusBadge domain="sellRequest" value={req.status} />
                <span className="tabular text-xs text-muted">{req.userId}</span>
              </div>
              <span className="tabular text-sm">{formatMoneyCents(req.quotedTotalCents, locale)}</span>
            </div>

            <PipelineStepper steps={steps} current={req.status} />

            <div className="flex flex-col divide-y divide-border">
              {req.items.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium" lang="en">
                      {it.card.name}
                    </span>
                    <span className="tabular text-xs text-muted">
                      {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                    </span>
                    <StatusBadge domain="sellItem" value={it.itemStatus} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary">{t('approve')}</Button>
                    <Button size="sm" variant="ghost">{t('adjust')}</Button>
                    <Button size="sm" variant="ghost">{t('reject')}</Button>
                    <Button size="sm" variant="secondary">{t('convert')}</Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{tm('moneyOutNote')}</span>
              <Button
                variant="accent"
                size="sm"
                disabled={!isSuperAdmin || req.status !== 'aprobada'}
                title={!isSuperAdmin ? tm('masked') : undefined}
              >
                {t('paySpei')}
              </Button>
            </div>
            {!isSuperAdmin && <Banner variant="warning">{te('MONEY_OUT_FORBIDDEN')}</Banner>}
          </div>
        ))}
      </QueryState>
    </div>
  );
}
