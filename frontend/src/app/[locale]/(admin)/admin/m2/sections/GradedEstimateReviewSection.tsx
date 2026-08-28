'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getGradedEstimateReview } from '@/lib/api';
import {
  GRADED_REVIEW_DEFAULT_REASONS,
  type GradedEstimateReviewItemDTO,
  type GradedEstimateReviewReason,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';

const PAGE_SIZE = 25;

/**
 * Sección 5e — **LISTA DE REVISIÓN del gancho** (contrato v1.50.3
 * `GET /admin/pricing/graded-estimates/review`, **criterio 111(e)**).
 *
 * **Por qué existe, y por qué el copy lo dice en voz alta.** Aceptamos **no ocultar** en la ficha
 * una cifra que el sistema considera incoherente —la ficha *informa* lo que hay— **a cambio** de que
 * alguien pudiera revisarla. Esta lista **es** esa contrapartida: sin ella publicaríamos el número
 * malo **y** perderíamos la señal, que es estrictamente peor que ocultarlo.
 *
 * **No duplica el pre-vuelo de la captura.** `preview` exige `cardId` y responde «¿por qué **esta**
 * carta no está destacada?»: solo sirve si **ya sospechabas**. Esto responde **«¿de qué cartas debo
 * sospechar?»**, que es la pregunta que nadie podía hacer.
 *
 * **Cuatro reglas del contrato que la UI no puede relajar:**
 *  1. **El default son los TRES motivos de coherencia.** `SLAB_PUBLISHED` es **opt-in** — es
 *     accionable, pero no es un dato erróneo, y meterlo por defecto **ahogaría la señal**.
 *  2. **`truncated` se PINTA.** Prohibido truncar en silencio: una lista incompleta presentada como
 *     completa produce la falsa confianza de «no hay nada que revisar».
 *  3. **Funciona con la feature APAGADA** y se dice. Si solo funcionara encendida, obligaría a
 *     publicar las cifras malas para poder descubrirlas.
 *  4. **`409 GRADED_CONFIG_INVALID` no se degrada a lista vacía:** una lista calculada contra un
 *     umbral corrupto es peor que no tener lista, así que se muestra el error y **no** una tabla.
 *
 * **Fuera de alcance declarado (v1.50.3, no se cuela «de paso»):** marcar una carta como revisada
 * —exige estado persistido ⇒ tabla nueva ⇒ DDL— y los avisos proactivos. El operador corrige con
 * las herramientas que ya existen: recapturar el estimado o borrar el dato.
 */
export function GradedEstimateReviewSection() {
  const t = useTranslations('admin.m2.gradedEstimateReview');
  const tReason = useTranslations('admin.m2.gradedEstimateCapture.diagnosis.reason');
  const locale = useLocale() as AppLocale;

  /** `false` = default del contrato (solo coherencia). `true` = además INV-D. */
  const [includeSlabPublished, setIncludeSlabPublished] = useState(false);
  const [page, setPage] = useState(1);

  const reason: GradedEstimateReviewReason[] = includeSlabPublished
    ? [...GRADED_REVIEW_DEFAULT_REASONS, 'SLAB_PUBLISHED']
    : GRADED_REVIEW_DEFAULT_REASONS;

  const query = useQuery({
    queryKey: ['graded-estimate-review', includeSlabPublished, page],
    queryFn: () => getGradedEstimateReview({ reason, page, pageSize: PAGE_SIZE }),
  });

  const totalPages =
    query.data && query.data.pageSize > 0
      ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize))
      : 1;

  const columns: Column<GradedEstimateReviewItemDTO>[] = [
    {
      key: 'card',
      header: t('colCard'),
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span lang="en" className="font-medium">
            {r.cardName}
          </span>
          <span className="font-mono text-xs text-muted">
            <span lang="en">{r.setName}</span> · <span className="tabular">#{r.number}</span> ·{' '}
            {r.finish}
          </span>
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('colReason'),
      render: (r) => (
        <span className="flex flex-col gap-1">
          <Badge tone="warning" shape="outline">
            {r.reason ? t(`reasonShort.${r.reason}`) : '—'}
          </Badge>
          {/* El motivo largo dice QUÉ ERROR suele haber detrás: es lo que convierte la fila en una
              acción («esto huele a dólares capturados como pesos») y no en una etiqueta. */}
          <span className="text-xs text-muted">{r.reason ? tReason(r.reason) : ''}</span>
        </span>
      ),
    },
    {
      key: 'raw',
      header: t('colRaw'),
      align: 'right',
      render: (r) => <span className="tabular">{formatMoneyCents(r.salePriceCents, locale)}</span>,
    },
    {
      key: 'psa10',
      header: 'PSA 10',
      align: 'right',
      render: (r) => (
        // Money-safe: un monto no resoluble llega `null` y se pinta «sin dato», NUNCA MX$0.00.
        <span className="tabular">
          {r.psa10MxnCents != null ? formatMoneyCents(r.psa10MxnCents, locale) : t('noData')}
        </span>
      ),
    },
    {
      key: 'psa9',
      header: 'PSA 9',
      align: 'right',
      render: (r) => (
        <span className="tabular">
          {r.psa9MxnCents != null ? formatMoneyCents(r.psa9MxnCents, locale) : t('noData')}
        </span>
      ),
    },
    {
      key: 'maxAllowed',
      header: t('colMaxAllowed'),
      align: 'right',
      render: (r) => (
        <span className="tabular text-muted">
          {r.maxAllowedPsa10MxnCents != null
            ? formatMoneyCents(r.maxAllowedPsa10MxnCents, locale)
            : t('noData')}
        </span>
      ),
    },
    {
      key: 'captured',
      header: t('colCaptured'),
      align: 'right',
      render: (r) => (
        <span className="tabular text-muted">
          {r.capturedDate ? formatDate(r.capturedDate, locale) : t('noData')}
        </span>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeSlabPublished}
            onChange={(e) => {
              setIncludeSlabPublished(e.target.checked);
              setPage(1);
            }}
          />
          {t('includeSlabPublished')}
        </label>
        <p className="text-xs text-muted">{t('includeSlabPublishedHint')}</p>

        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data && (
            <div className="flex flex-col gap-3">
              {/* La lista evalúa aunque el dial esté apagado: se dice, para que nadie lea la lista
                  como «lo que se está publicando ahora mismo». */}
              {!query.data.enabled && <Banner variant="info">{t('featureOffBanner')}</Banner>}
              {/* Prohibido truncar en silencio (contrato). */}
              {query.data.truncated && (
                <Banner variant="warning" role="alert" title={t('truncatedTitle')}>
                  {t('truncatedBody', { scanned: query.data.scannedCards })}
                </Banner>
              )}

              <p className="text-xs text-muted">
                {t('summary', { total: query.data.total, scanned: query.data.scannedCards })}
              </p>

              {/* `data: []` NO es un logro que celebrar con un placeholder: es una lista vacía. */}
              <div className="rounded-lg border border-border p-2">
                <DataTable
                  columns={columns}
                  rows={query.data.data}
                  rowKey={(r) => `${r.cardId}|${r.representativeInventoryItemId}|${r.finish}`}
                />
              </div>

              <p className="text-xs text-muted">{t('howToFix')}</p>

              {totalPages > 1 && (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('prev')}
                  </Button>
                  <span className="tabular text-xs text-muted">
                    {t('pageInfo', { page: query.data.page, totalPages })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('next')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </QueryState>
      </div>
    </section>
  );
}
