'use client';

import { useTranslations } from 'next-intl';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { useErrorMessage } from '@/components/ui/QueryState';
import { SyncProgress } from './shared';
import type { CatalogSync } from './useCatalogSync';

/**
 * Sección 1 — «Actualizar precios» (PRIMARIA · G3): UNA acción de disparo del ingest masivo, su
 * feedback (encolado / ya corriendo / error), avisos de límite diario y la barra de progreso del
 * barrido de PRECIOS. Comparte el estado del barrido con el catálogo vía `useCatalogSync` (el
 * «Sync completo» por-fila del catálogo también arranca este barrido).
 */
export function PriceIngestSection({ catalog }: { catalog: CatalogSync }) {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const getError = useErrorMessage();
  const { ingestMutation, priceSyncStatus } = catalog;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('updatePrices.title')}</h2>
      <p className="text-sm text-muted">{t('updatePrices.subtitle')}</p>
      <div>
        <Button size="lg" loading={ingestMutation.isPending} onClick={() => ingestMutation.mutate()}>
          <Zap size={18} /> {t('priceIngest.trigger')}
        </Button>
      </div>
      <p className="text-xs text-muted">{t('priceIngest.triggerHint')}</p>
      {ingestMutation.isSuccess && (
        <Banner variant="success" role="status">
          {/* single-flight: enqueued=false = ya había un pase en curso. */}
          {ingestMutation.data.enqueued
            ? t('priceIngest.queued')
            : t('priceIngest.alreadyRunning')}
        </Banner>
      )}
      {ingestMutation.isError && (
        <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(ingestMutation.error)}</Banner>
      )}

      {/* Aviso de pausa por límite diario del proveedor de paga (retoma a las 00:00 UTC). */}
      {priceSyncStatus.data?.dailyLimited && (
        <Banner variant="warning" role="status">
          {t('priceIngest.dailyLimited', { pending: priceSyncStatus.data.pending })}
        </Banner>
      )}
      {/* Presupuesto diario restante del proveedor, cuando el estado lo reporta. */}
      {priceSyncStatus.data?.dailyRemaining != null && (
        <p className="text-xs text-muted">
          {t('priceIngest.dailyRemaining', { remaining: priceSyncStatus.data.dailyRemaining })}
        </p>
      )}

      {/* Barra de progreso del barrido de PRECIOS en curso / recién terminado (poll cada 3 s).
          Reusa el mismo SyncProgress (role="progressbar" accesible) que el sync de catálogo. */}
      {priceSyncStatus.data && (priceSyncStatus.data.running || priceSyncStatus.data.total > 0) && (
        <SyncProgress
          running={priceSyncStatus.data.running}
          done={priceSyncStatus.data.done}
          total={priceSyncStatus.data.total}
          labels={{
            running: t('priceIngest.sweepRunning', {
              done: Math.min(priceSyncStatus.data.done, priceSyncStatus.data.total),
              total: priceSyncStatus.data.total,
            }),
            runningHint: t('priceIngest.sweepRunningHint'),
            done: t('priceIngest.sweepDone', { total: priceSyncStatus.data.total }),
          }}
        />
      )}
    </section>
  );
}
