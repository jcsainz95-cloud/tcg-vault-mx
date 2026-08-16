'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getHoldings, getShipmentQuote, getShipments } from '@/lib/api';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useShipmentSteps } from '@/lib/pipelines';
import { cn } from '@/lib/cn';

/**
 * 6h — Selección de cartas liquidadas con casilla y folio; las no elegibles se
 * apartan tras una regla bermellón en vez de encerrarlas en una caja de color, y
 * el stepper del envío es una línea de tiempo tipográfica (ver PipelineStepper).
 */
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
    <div>
      <div className="gutter pb-6 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[28px] leading-[1.12] text-text lg:text-[40px]">{t('title')}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>
      </div>

      <div className="grid border-t border-border lg:grid-cols-[1fr_400px]">
        <div className="gutter border-b border-border pb-12 pt-6 lg:border-b-0 lg:border-r">
          <p className="rule-note mb-5 text-[13px] leading-[1.7] text-muted">{t('onlySettledNotice')}</p>

          <QueryState
            isLoading={holdingsQuery.isLoading}
            isError={holdingsQuery.isError}
            error={holdingsQuery.error}
            onRetry={() => holdingsQuery.refetch()}
          >
            <div>
              {settledItems.map((h) => {
                const checked = selected.includes(h.inventoryItemId);
                return (
                  <label
                    key={h.inventoryItemId}
                    className="flex cursor-pointer items-center gap-4 border-t border-border py-4 last:border-b"
                  >
                    {/* Casilla del índice: cuadrado de 16px que se rellena de tinta.
                        Es el <input> real (appearance-none), no un span decorativo:
                        así sigue siendo clicable y navegable con teclado. */}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(h.inventoryItemId)}
                      aria-label={`${t('selectAddress')} ${h.folio}`}
                      className="h-4 w-4 shrink-0 cursor-pointer appearance-none border border-border-strong checked:border-text checked:bg-text"
                    />
                    <span className="tabular font-mono text-xs text-muted">{h.folio}</span>
                    <span className="flex-1 text-[15px] text-text" lang="en">
                      {h.card.name}
                    </span>
                    <StatusBadge domain="ownership" value={h.ownershipStatus} />
                  </label>
                );
              })}

              {pendingItems.length > 0 && (
                <div className="rule-note mt-8">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-label text-accent">
                    {t('ineligibleTitle')}
                  </p>
                  {pendingItems.map((h) => (
                    <div key={h.inventoryItemId} className="mt-3 flex items-center gap-4 text-sm text-muted">
                      <span className="tabular font-mono text-xs">{h.folio}</span>
                      <span className="flex-1" lang="en">
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

        <aside className="gutter h-fit pb-12 pt-6 lg:px-10">
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
            <p className="rule-note mt-5 text-[13px] leading-[1.7] text-accent" role="alert">
              {te('ADDRESS_NOT_MX')}
            </p>
          )}
          <p className="mt-5 text-xs leading-[1.65] text-muted">
            {t('flatFeeNotice')} {t('onlyMx')}
          </p>

          {isMx && selected.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
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
            </div>
          )}

          <Button
            variant="accent"
            disabled={!isMx || selected.length === 0}
            className="mt-6 w-full"
          >
            {t('requestWithdrawal')}
          </Button>
        </aside>
      </div>

      <section className="gutter border-t border-border pb-14 pt-10">
        <h2 className="font-serif text-[20px] leading-tight text-text lg:text-[28px]">{t('myShipments')}</h2>
        <div className="mt-5">
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
                <div key={s.id} className="border-t border-border pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                      <span className="tabular font-mono text-[13px] text-text">{s.id}</span>
                      <StatusBadge domain="shipment" value={s.status} />
                    </span>
                    {s.trackingNumber && (
                      <span className="font-mono text-[11px] text-muted">
                        {s.carrier} · {t('tracking')} {s.trackingNumber}
                      </span>
                    )}
                  </div>
                  <div className="mt-5">
                    <PipelineStepper steps={shipmentSteps} current={s.status} />
                  </div>
                </div>
              ))
            )}
          </QueryState>
        </div>
      </section>
    </div>
  );
}
