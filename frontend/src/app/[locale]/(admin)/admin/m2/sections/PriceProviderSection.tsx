'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getPriceProvider, updatePriceProvider } from '@/lib/api';
import type { PriceProvider } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { PRICE_PROVIDERS } from './shared';

/**
 * Sección 3b — proveedor de la ingesta masiva de precios (dial `priceProvider`, v1.14-price-ingest).
 * §19.7: la fuente PRIMARIA (TCGCSV) es FIJA no editable; el Select solo elige el RESPALDO/fallback.
 */
export function PriceProviderSection() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const priceProvider = useQuery({ queryKey: ['price-provider'], queryFn: getPriceProvider });
  const [providerDraft, setProviderDraft] = useState<PriceProvider | null>(null);
  const providerValue: PriceProvider = providerDraft ?? priceProvider.data ?? 'pokemontcg_io';
  const providerDirty = providerDraft != null && providerDraft !== priceProvider.data;
  const providerMutation = useMutation({
    mutationFn: (provider: PriceProvider) => updatePriceProvider(provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-provider'] });
      setProviderDraft(null);
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('priceIngest.title')}</h2>
      <p className="text-sm text-muted">{t('priceIngest.subtitle')}</p>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        {/* Selector del dial priceProvider (fuente del ingest, sin redeploy) */}
        <QueryState
          isLoading={priceProvider.isLoading}
          isError={priceProvider.isError}
          error={priceProvider.error}
          onRetry={() => priceProvider.refetch()}
        >
          <div className="flex flex-col gap-2">
            {/* §19.7: fila FIJA no editable de la fuente PRIMARIA (TCGCSV manda, no aparece en el
                Select). Deja claro que el dial de abajo solo elige el RESPALDO/fallback. */}
            <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-3">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
                {t('priceIngest.primarySourceLabel')}
              </span>
              <span className="font-mono text-sm font-semibold text-text">
                {t('priceIngest.primarySourceValue')}
              </span>
              <span className="text-xs text-muted">{t('priceIngest.primarySourceHint')}</span>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label={t('priceIngest.fallbackLabel')}
                className="w-64"
                options={PRICE_PROVIDERS.map((p) => ({
                  value: p,
                  label: t(`priceIngest.providerOptions.${p}`),
                }))}
                value={providerValue}
                onChange={(e) => setProviderDraft(e.target.value as PriceProvider)}
              />
              <Button
                variant="secondary"
                disabled={!providerDirty}
                loading={providerMutation.isPending}
                onClick={() => providerMutation.mutate(providerValue)}
              >
                {tc('save')}
              </Button>
            </div>
            <p className="text-xs text-muted">{t('priceIngest.fallbackHint')}</p>
            {/* Línea de precedencia money-safe (§19.7): primario → respaldo → override manual. */}
            <p className="text-xs text-muted">
              {t('priceIngest.precedenceHint', {
                fallback: t(`priceIngest.providerOptions.${providerValue}`),
              })}
            </p>
            {providerMutation.isSuccess && (
              <Banner variant="success" role="status">{t('priceIngest.providerSaved')}</Banner>
            )}
            {providerMutation.isError && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(providerMutation.error)}</Banner>
            )}
          </div>
        </QueryState>
      </div>
    </section>
  );
}
