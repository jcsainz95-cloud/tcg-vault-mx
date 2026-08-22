'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { getFx, updateFx, refreshFx } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/**
 * Sección 3 — FX: tasa + colchón vigentes con override manual (#13: se puede guardar SOLO el
 * colchón, dejando la tasa vacía → el backend conserva la tasa vigente) y refresco desde Banxico.
 */
export function FxSection() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const fx = useQuery({ queryKey: ['admin-fx'], queryFn: getFx });
  const [fxRate, setFxRate] = useState('');
  const [fxBuffer, setFxBuffer] = useState('');
  // #13: se puede guardar SOLO el colchón. El payload se arma con las keys realmente
  // capturadas: si la tasa queda vacía, se manda `{ bufferPct }` sin `rate` → el backend
  // conserva la tasa vigente y no pinnea un override manual de tasa.
  const fxUpdateMutation = useMutation({
    mutationFn: (payload: { rate?: number; bufferPct?: number }) => updateFx(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fx'] }),
  });
  const fxRefreshMutation = useMutation({
    mutationFn: refreshFx,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fx'] }),
  });
  function saveFx() {
    const payload: { rate?: number; bufferPct?: number } = {};
    if (fxRate !== '') payload.rate = Number(fxRate);
    if (fxBuffer !== '') payload.bufferPct = Number(fxBuffer);
    fxUpdateMutation.mutate(payload);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('fx.title')}</h2>
      <QueryState isLoading={fx.isLoading} isError={fx.isError} error={fx.error} onRetry={() => fx.refetch()}>
        {fx.data && (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.rate')}</p>
                <p className="tabular text-h2 font-semibold">{fx.data.rate.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.buffer')}</p>
                <p className="tabular text-h2 font-semibold">{fx.data.bufferPct}%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.source')}</p>
                <Badge tone={fx.data.source === 'manual' ? 'accent' : 'info'} shape="soft">
                  {t(`fx.sourceLabel.${fx.data.source}`)}
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.effectiveDate')}</p>
                <p className="tabular text-sm">{formatDate(fx.data.effectiveDate, locale)}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Input
                label={t('fx.newRate')}
                type="text"
                inputMode="decimal"
                className="w-32"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                placeholder={String(fx.data.rate)}
              />
              <Input
                label={t('fx.newBuffer')}
                type="text"
                inputMode="decimal"
                className="w-32"
                value={fxBuffer}
                onChange={(e) => setFxBuffer(e.target.value)}
                placeholder={String(fx.data.bufferPct)}
              />
              <Button
                variant="secondary"
                // #13: habilitado si AL MENOS uno de los dos tiene valor (permite guardar
                // solo el colchón dejando la tasa vacía).
                disabled={fxRate === '' && fxBuffer === ''}
                loading={fxUpdateMutation.isPending}
                onClick={saveFx}
              >
                {t('fx.saveOverride')}
              </Button>
              <Button variant="ghost" loading={fxRefreshMutation.isPending} onClick={() => fxRefreshMutation.mutate()}>
                <RefreshCw size={18} /> {t('fx.refreshBanxico')}
              </Button>
            </div>
            <p className="text-xs text-muted">{t('fx.hint')}</p>
            <p className="text-xs text-muted">{t('fx.bufferOnlyHint')}</p>
            {fxUpdateMutation.isSuccess && (
              <Banner variant="success" role="status">
                {/* Mensaje claro según lo que se guardó: solo colchón vs tasa (+colchón). */}
                {fxUpdateMutation.variables?.rate === undefined
                  ? t('fx.savedBufferOnly')
                  : t('fx.saved')}
              </Banner>
            )}
            {fxRefreshMutation.isSuccess && (
              <Banner variant="success" role="status">{t('fx.saved')}</Banner>
            )}
            {fxUpdateMutation.isError && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(fxUpdateMutation.error)}</Banner>
            )}
            {fxRefreshMutation.isError && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(fxRefreshMutation.error)}</Banner>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}
