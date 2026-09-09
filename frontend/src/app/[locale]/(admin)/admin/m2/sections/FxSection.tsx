'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { getFx, updateFx, refreshFx } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import type { FxSource } from '@/types/contract';
import { isKnownFxSource, isKnownFxRefreshReason } from '@/types/contract';
import type { BadgeTone } from '@/lib/status-map';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/**
 * Sección 3 — FX: tasa + colchón vigentes con override manual (#13: se puede guardar SOLO el
 * colchón, dejando la tasa vacía → el backend conserva la tasa vigente) y refresco desde Banxico.
 *
 * ⚠️ v1.63 (contrato §M2-F, DESIGN_SYSTEM §30.5/§30.7). Este panel es la superficie VIVA a la que
 * desemboca el interruptor de modo, y traía dos mentiras que QA marcó como bloqueantes:
 *
 *  B-1 · `source: "fallback"` no tenía rama. El backend YA lo emite (tabla `FxRate` vacía + modo
 *        `auto`) y aquí se pintaba con `t('fx.sourceLabel.fallback')` inexistente (ruta de clave
 *        cruda en pantalla) y con tono `info` — un badge **informativo** sobre un 18 **que nadie
 *        tecleó**. Ahora `fallback` tiene rótulo propio (`SIN RESPALDO REAL`), acento, y el
 *        párrafo que dice de dónde sale ese número. ⛔ **Jamás se pinta como `MANUAL`.**
 *
 *  B-2 · el refresco fallido se pintaba VERDE. `POST /admin/fx/refresh` contesta `200` aunque el
 *        fetch no haya ocurrido, y la pantalla decía «Tipo de cambio actualizado» sin mirar
 *        `refresh.outcome` (§M2-F.5: «la UI está OBLIGADA a distinguir `failed` visualmente»).
 *        Ahora el desenlace se LEE: `updated`/`unchanged` avisan lo que pasó de verdad y `failed`
 *        va en `Banner danger` persistente con `role="alert"`, su motivo traducido y `Reintentar`.
 */

/**
 * `source` → tono, y es un MAPA, no una derivación (DESIGN_SYSTEM §30.5, tabla de §17.2).
 * `manual` y `banxico` van en TINTA (`primary`): son los dos estados normales y el caso normal no
 * grita. El acento queda para `fallback`, que es **el peor estado del sistema**.
 */
const SOURCE_TONE: Record<FxSource, BadgeTone> = {
  banxico: 'primary',
  manual: 'primary',
  fallback: 'accent',
};

/** Clave del rótulo por valor del enum. ⛔ Nada de claves dinámicas: un valor nuevo cae al neutro. */
const SOURCE_LABEL_KEY: Record<FxSource, string> = {
  banxico: 'fx.sourceLabel.banxico',
  manual: 'fx.sourceLabel.manual',
  fallback: 'fx.sourceLabel.fallback',
};

export function FxSection() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

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

  /** Las cifras se le pasan al copy YA formateadas (§9.3): el texto no concatena unidades. */
  const rateText = (value: number) => value.toFixed(4);

  /** Rótulo de la fuente. Un valor que esta pantalla no conoce se pinta NEUTRO y lo dice. */
  const sourceLabel = (source: string) =>
    isKnownFxSource(source) ? t(SOURCE_LABEL_KEY[source]) : t('fx.sourceLabel.unknown');
  const sourceTone = (source: string): BadgeTone => (isKnownFxSource(source) ? SOURCE_TONE[source] : 'neutral');

  /**
   * El desenlace del refresco (§M2-F.5). ⛔ **Nada se anuncia como éxito antes de leerlo.** Si el
   * bloque `refresh` no viaja, o si el `outcome` no es uno de los tres, **no se cae al copy de
   * éxito**: se pinta el fallo con el motivo neutro. Un `200` no es un éxito.
   */
  const refreshed = fxRefreshMutation.data;
  const refresh = refreshed?.refresh;
  const refreshSucceeded = refresh?.outcome === 'updated' || refresh?.outcome === 'unchanged';
  const refreshFailed = fxRefreshMutation.isSuccess && !refreshSucceeded;
  const refreshReasonKey =
    refresh?.reason != null && isKnownFxRefreshReason(refresh.reason)
      ? `fx.refresh.reason.${refresh.reason}`
      : 'fx.refresh.reason.unknown';

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('fx.title')}</h2>
      <QueryState isLoading={fx.isLoading} isError={fx.isError} error={fx.error} onRetry={() => fx.refetch()}>
        {fx.data && (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.rate')}</p>
                <p className="tabular text-h2 font-semibold">{rateText(fx.data.rate)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.buffer')}</p>
                <p className="tabular text-h2 font-semibold">{fx.data.bufferPct}%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.source')}</p>
                <Badge tone={sourceTone(fx.data.source)} shape="soft">
                  {sourceLabel(fx.data.source)}
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">{t('fx.effectiveDate')}</p>
                <p className="tabular text-sm">{formatDate(fx.data.effectiveDate, locale)}</p>
              </div>
            </div>

            {/*
              §30.5 — `fallback` NO es un vacío: es un estado que hay que arreglar, y se dice con
              todas las letras. Las dos palancas que lo arreglan (refrescar Banxico y guardar una
              tasa manual) están justo debajo. ⛔ Sin botón de descartar.
            */}
            {fx.data.source === 'fallback' && (
              <Banner variant="warning" role="status">
                {t('fx.sourceBody.fallback')}
              </Banner>
            )}
            {!isKnownFxSource(fx.data.source) && (
              <Banner variant="info" role="status">
                {t('fx.sourceBody.unknown')}
              </Banner>
            )}

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
            {/* `updated`: el fetch OCURRIÓ y el número es distinto, así que se guardó. */}
            {refreshed && refresh?.outcome === 'updated' && (
              <Banner variant="success" role="status">
                {t('fx.refresh.updated', { rate: rateText(refresh.fetchedRate ?? refreshed.rate) })}
                {/* En modo manual el refresco NO cambia cuál rige: solo la cifra de comparación. */}
                {refreshed.mode === 'manual' && refreshed.manual.rate != null && (
                  <> {t('fx.refresh.updatedWhileManual', { rate: rateText(refreshed.manual.rate) })}</>
                )}
              </Banner>
            )}
            {/* `unchanged`: fue bien y no cambió nada. ⛔ No se anuncia como una actualización. */}
            {refreshed && refresh?.outcome === 'unchanged' && (
              <Banner variant="info" role="status">
                {t('fx.refresh.unchanged', { rate: rateText(refresh.fetchedRate ?? refreshed.rate) })}
              </Banner>
            )}
            {/*
              `failed` (o desenlace ilegible): `Banner danger` PERSISTENTE con `role="alert"` —
              divergencia consciente de §28.10, porque es el resultado inmediato de un botón que el
              humano acaba de pulsar y que NO hizo lo que decía. El resto del panel sigue vivo: el
              `FxStateDTO` de vuelta es válido, solo falló la fuente externa.
            */}
            {refreshFailed && refreshed && (
              <Banner
                variant="danger"
                role="alert"
                title={t('fx.refresh.failedTitle')}
                action={
                  <Button variant="ghost" loading={fxRefreshMutation.isPending} onClick={() => fxRefreshMutation.mutate()}>
                    {tc('retry')}
                  </Button>
                }
              >
                <p>
                  {t('fx.refresh.failedBody', {
                    rate: rateText(refreshed.rate),
                    source: sourceLabel(refreshed.source),
                  })}
                </p>
                <p>{t(refreshReasonKey)}</p>
              </Banner>
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
