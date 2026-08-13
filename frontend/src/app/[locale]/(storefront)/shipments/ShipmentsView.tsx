'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getHoldings, getShipmentQuote, getShipments } from '@/lib/api';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useShipmentSteps } from '@/lib/pipelines';

export function ShipmentsView() {
  const t = useTranslations('shipments');
  const te = useTranslations('error');
  const shipmentSteps = useShipmentSteps();
  const [country, setCountry] = useState('MX');
  const [selected, setSelected] = useState<string[]>([]);

  const holdingsQuery = useQuery({ queryKey: ['holdings'], queryFn: getHoldings });
  const shipmentsQuery = useQuery({ queryKey: ['shipments'], queryFn: getShipments });

  const settledItems = useMemo(
    () => (holdingsQuery.data?.data ?? []).filter((h) => h.ownershipStatus === 'settled'),
    [holdingsQuery.data],
  );
  const pendingItems = useMemo(
    () => (holdingsQuery.data?.data ?? []).filter((h) => h.ownershipStatus !== 'settled'),
    [holdingsQuery.data],
  );

  const quoteQuery = useQuery({
    queryKey: ['shipment-quote', selected],
    queryFn: () => getShipmentQuote(selected, 'addr-mock'),
    enabled: selected.length > 0 && country === 'MX',
  });

  const isMx = country === 'MX';

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <p className="mt-1 text-muted">{t('subtitle')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,380px]">
        <div className="flex flex-col gap-4">
          <Banner variant="info">{t('onlySettledNotice')}</Banner>

          <QueryState
            isLoading={holdingsQuery.isLoading}
            isError={holdingsQuery.isError}
            error={holdingsQuery.error}
            onRetry={() => holdingsQuery.refetch()}
          >
            <div className="flex flex-col gap-2">
              {settledItems.map((h) => (
                <label
                  key={h.inventoryItemId}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[color:var(--color-primary)]"
                    checked={selected.includes(h.inventoryItemId)}
                    onChange={() => toggle(h.inventoryItemId)}
                    aria-label={`${t('selectAddress')} ${h.folio}`}
                  />
                  <span className="tabular text-xs text-muted">{h.folio}</span>
                  <span className="flex-1 text-sm font-medium" lang="en">
                    {h.card.name}
                  </span>
                  <StatusBadge domain="ownership" value={h.ownershipStatus} />
                </label>
              ))}

              {pendingItems.length > 0 && (
                <div className="rounded-lg border border-dashed border-warning/50 bg-warning-bg p-3">
                  <p className="mb-2 text-xs font-semibold text-warning">{t('ineligibleTitle')}</p>
                  {pendingItems.map((h) => (
                    <div key={h.inventoryItemId} className="flex items-center gap-2 py-1 opacity-70">
                      <span className="tabular text-xs text-muted">{h.folio}</span>
                      <span className="flex-1 text-sm" lang="en">
                        {h.card.name}
                      </span>
                      <StatusBadge domain="ownership" value={h.ownershipStatus} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </QueryState>
        </div>

        <aside className="flex h-fit flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <Select
            label={t('selectAddress')}
            options={[
              { value: 'MX', label: 'México (MX)' },
              { value: 'US', label: 'United States (US)' },
            ]}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
          {!isMx && (
            <Banner variant="danger" role="alert">
              {te('ADDRESS_NOT_MX')}
            </Banner>
          )}
          <Banner variant="info">{t('flatFeeNotice')}</Banner>

          {isMx && selected.length > 0 && (
            <QueryState
              isLoading={quoteQuery.isLoading}
              isError={quoteQuery.isError}
              error={quoteQuery.error}
              onRetry={() => quoteQuery.refetch()}
            >
              {quoteQuery.data && (
                <AmountBreakdown breakdown={quoteQuery.data.breakdown} variant="shipment" />
              )}
            </QueryState>
          )}

          <Button variant="accent" disabled={!isMx || selected.length === 0} className="w-full">
            {t('requestWithdrawal')}
          </Button>
        </aside>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{t('myShipments')}</h2>
        <QueryState
          isLoading={shipmentsQuery.isLoading}
          isError={shipmentsQuery.isError}
          error={shipmentsQuery.error}
          onRetry={() => shipmentsQuery.refetch()}
        >
          {(shipmentsQuery.data?.length ?? 0) === 0 ? (
            <EmptyState title={t('noShipments')} />
          ) : (
            shipmentsQuery.data!.map((s) => (
              <div key={s.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="tabular text-sm font-medium">{s.id}</span>
                    <StatusBadge domain="shipment" value={s.status} />
                  </div>
                  {s.trackingNumber && (
                    <span className="text-xs text-muted">
                      {s.carrier} · {t('tracking')} {s.trackingNumber}
                    </span>
                  )}
                </div>
                <PipelineStepper steps={shipmentSteps} current={s.status} />
              </div>
            ))
          )}
        </QueryState>
      </section>
    </div>
  );
}
