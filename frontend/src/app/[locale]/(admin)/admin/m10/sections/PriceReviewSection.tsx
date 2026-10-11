'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Lock, PencilLine } from 'lucide-react';
import { getPriceReviewQueue, resolvePriceReviewCase } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents, formatDate } from '@/lib/format';
import type {
  PriceAxis,
  PriceReviewCaseDTO,
  PriceReviewStatus,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { cn } from '@/lib/cn';
import { pesosToCents, sanitizeDecimalInput, isSaveableRuleValue } from '../../m2/sections/shared';

/** Ancla del enlace «Precios por revisar» (si otra pantalla enlaza aquí). */
export const PRICE_REVIEW_ANCHOR = 'precios-por-revisar';

/** Los cinco estados del caso, en el orden de triaje (abierto primero). */
const STATUSES: readonly PriceReviewStatus[] = ['open', 'accepted', 'kept', 'manual', 'superseded'];
const AXES: readonly (PriceAxis | 'all')[] = ['all', 'sell', 'buy'];

/**
 * El salto `jumpFactorMilli` viene ×1000 entero (×55 = 55000; ⛔ sin float en el contrato). Aquí se
 * divide SOLO para pintar y en lenguaje llano: «×55» (o «×5.5» si no es entero). ⛔ No se usa para
 * ninguna decisión; es presentación.
 */
function formatJump(milli: number, locale: AppLocale): string {
  const n = milli / 1000;
  return `×${new Intl.NumberFormat(locale === 'es' ? 'es-MX' : 'en-US', { maximumFractionDigits: 2 }).format(n)}`;
}

/** Tono del badge de estado, para que `open` resalte y los resueltos se apaguen. */
const STATUS_TONE: Record<PriceReviewStatus, 'accent' | 'success' | 'neutral'> = {
  open: 'accent',
  accepted: 'success',
  kept: 'neutral',
  manual: 'neutral',
  superseded: 'neutral',
};

/**
 * 💰 **«Precios por revisar»** — la cola del candado anti-inflado (`API_CONTRACT §PRE.D/E/F`,
 * criterio 876/877). El candado detiene un salto grande sin consenso y abre un `PriceReviewCase`;
 * aquí el DUEÑO (`super_admin`, la pantalla entera va bajo `SuperAdminOnly`) ve el caso con los
 * datos delante y lo resuelve.
 *
 * - **Qué carta** (nombre · set · número · acabado), **el precio propuesto** (lo que el candado
 *   detuvo), **el precio base** (último sano) y **el salto** en pesos y en «×N».
 * - **Qué dijo cada fuente** (`quotes`): fuente, precio en pesos, fecha y si está vieja — para que
 *   vea POR QUÉ se detuvo.
 * - **Tres acciones:** «Aceptar» (publica el propuesto), «Conservar» (deja el actual), «Precio a
 *   mano» (abre input de pesos y resuelve con `manual`). Todo en pesos, sin jerga.
 * - Contador de casos abiertos (`counts.open`) siempre visible.
 * - `409 CONFLICT` (el caso ya lo resolvió otra pestaña/barrido) ⇒ aviso y refresco.
 */
export function PriceReviewSection() {
  const t = useTranslations('admin.m10.priceReview');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const [status, setStatus] = useState<PriceReviewStatus>('open');
  const [axis, setAxis] = useState<PriceAxis | 'all'>('all');
  const [manualTarget, setManualTarget] = useState<PriceReviewCaseDTO | null>(null);
  const [manualValue, setManualValue] = useState('');

  const queue = useQuery({
    queryKey: ['price-review-queue', status, axis],
    queryFn: () => getPriceReviewQueue({ status, axis: axis === 'all' ? undefined : axis }),
  });

  const resolveMutation = useMutation({
    mutationFn: (vars: { id: string; action: 'accept' | 'keep' | 'manual'; manualPriceMxnCents?: number }) =>
      vars.action === 'manual'
        ? resolvePriceReviewCase(vars.id, { action: 'manual', manualPriceMxnCents: vars.manualPriceMxnCents! })
        : resolvePriceReviewCase(vars.id, { action: vars.action }),
    onSuccess: () => {
      setManualTarget(null);
      setManualValue('');
      void qc.invalidateQueries({ queryKey: ['price-review-queue'] });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
      // El precio pudo cambiar en la tienda ⇒ refrescar lo que lo consume.
      void qc.invalidateQueries({ queryKey: ['pending-prices'] });
    },
    onError: (err) => {
      // 409: el caso ya no está `open` (otra pestaña o el barrido lo cerró). Refrescar para que la
      // lista deje de ofrecer acciones sobre un caso muerto (contrato §PRE.F).
      if (asApiError(err)?.status === 409) {
        void qc.invalidateQueries({ queryKey: ['price-review-queue'] });
        setManualTarget(null);
      }
    },
  });

  const pendingVars = resolveMutation.isPending ? resolveMutation.variables : undefined;
  const conflict = asApiError(resolveMutation.error)?.status === 409;

  // Precio a mano: entero de centavos > 0 (misma guarda money-safe que el override de M2).
  const manualCents = pesosToCents(manualValue);
  const manualInvalid = !isSaveableRuleValue(manualValue) || manualCents <= 0;

  const openCount = queue.data?.counts.open ?? null;

  return (
    <section
      id={PRICE_REVIEW_ANCHOR}
      className="flex scroll-mt-24 flex-col gap-3"
      aria-labelledby="m10-price-review"
      data-testid="m10-price-review"
    >
      <h2 id="m10-price-review" className="text-h2 font-semibold">
        {t('title')}
      </h2>
      <p className="max-w-[70ch] text-sm text-muted">{t('intro')}</p>

      {/* Contador de casos abiertos: SIEMPRE visible (criterio 876), venga del servidor. */}
      {openCount !== null && (
        <p
          className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent"
          data-testid="price-review-open-count"
        >
          <span className="tabular-nums">{t('openCount', { count: openCount })}</span>
        </p>
      )}

      {/* Filtro por estado (abierto por defecto) y por eje. */}
      <div className="flex flex-col gap-2">
        <div role="tablist" aria-label={t('statusLabel')} className="flex flex-wrap gap-1 border-b border-border">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="tab"
              type="button"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                '-mb-px rounded-t-md px-3 py-2 text-sm font-medium',
                status === s ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
              )}
              data-testid={`price-review-status-${s}`}
            >
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">{t('axisLabel')}</span>
          {AXES.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={axis === a}
              onClick={() => setAxis(a)}
              className={cn(
                'min-h-[44px] px-3 font-mono text-[11px] uppercase tracking-[0.06em] sm:min-h-0 sm:py-2',
                axis === a
                  ? 'border-b-2 border-accent text-text'
                  : 'border-b-2 border-transparent text-muted hover:text-text',
              )}
            >
              {a === 'all' ? t('axisAll') : t(`axis.${a}`)}
            </button>
          ))}
        </div>
      </div>

      {conflict && (
        <Banner variant="warning" role="alert" title={t('conflict.title')}>
          {t('conflict.body')}
        </Banner>
      )}

      <QueryState
        isLoading={queue.isLoading}
        isError={queue.isError}
        error={queue.error}
        onRetry={() => queue.refetch()}
      >
        {queue.data &&
          (queue.data.data.length === 0 ? (
            <EmptyState tone={status === 'open' ? 'positive' : 'neutral'} title={t(`empty.${status === 'open' ? 'open' : 'other'}`)} />
          ) : (
            <ul className="flex flex-col gap-4">
              {queue.data.data.map((c) => (
                <li key={c.id}>
                  <CaseCard
                    kase={c}
                    locale={locale}
                    busyAction={pendingVars?.id === c.id ? pendingVars.action : null}
                    onAccept={() => resolveMutation.mutate({ id: c.id, action: 'accept' })}
                    onKeep={() => resolveMutation.mutate({ id: c.id, action: 'keep' })}
                    onManual={() => {
                      setManualValue('');
                      setManualTarget(c);
                    }}
                  />
                </li>
              ))}
            </ul>
          ))}
      </QueryState>

      {/* Precio a mano: resuelve con `manual` + el precio en centavos (contrato §PRE.F). */}
      <Modal
        open={!!manualTarget}
        onClose={() => setManualTarget(null)}
        title={t('manual.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setManualTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={manualInvalid}
              loading={pendingVars?.action === 'manual'}
              onClick={() =>
                manualTarget &&
                !manualInvalid &&
                resolveMutation.mutate({ id: manualTarget.id, action: 'manual', manualPriceMxnCents: manualCents })
              }
            >
              {t('manual.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {manualTarget && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span lang="en" className="font-medium text-text">
                {manualTarget.card.name}
              </span>
              <span className="tabular text-muted">
                {manualTarget.card.setName} · #{manualTarget.card.number}
              </span>
              <FinishBadge finish={manualTarget.finish} productType={manualTarget.productType} />
            </p>
          )}
          <p className="text-sm text-muted">{t('manual.help')}</p>
          <Input
            label={t('manual.priceLabel')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={manualValue}
            onChange={(e) => setManualValue(sanitizeDecimalInput(e.target.value))}
          />
          {manualValue !== '' && manualInvalid && (
            <Banner variant="warning" role="alert">{t('manual.invalid')}</Banner>
          )}
          {manualValue !== '' && !manualInvalid && (
            <p className="text-xs text-muted">= {formatMoneyCents(manualCents, locale)}</p>
          )}
          {resolveMutation.isError && !conflict && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(resolveMutation.error)}
            </Banner>
          )}
        </div>
      </Modal>
    </section>
  );
}

/** Una tarjeta de caso: identidad, propuesto/base/salto, qué dijo cada fuente y las tres acciones. */
function CaseCard({
  kase,
  locale,
  busyAction,
  onAccept,
  onKeep,
  onManual,
}: {
  kase: PriceReviewCaseDTO;
  locale: AppLocale;
  busyAction: 'accept' | 'keep' | 'manual' | null;
  onAccept: () => void;
  onKeep: () => void;
  onManual: () => void;
}) {
  const t = useTranslations('admin.m10.priceReview');
  const busy = busyAction !== null;
  const isOpen = kase.status === 'open';

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4" data-testid={`price-review-case-${kase.id}`}>
      {/* Identidad + estado + eje */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span lang="en" className="font-medium text-text">
            {kase.card.name}
          </span>
          <span className="text-sm text-muted">
            <span lang="en">{kase.card.setName}</span>
            {kase.card.number && kase.card.number !== '—' ? (
              <span className="tabular"> · #{kase.card.number}</span>
            ) : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <FinishBadge finish={kase.finish} productType={kase.productType} />
            <Badge tone="neutral">{t(`productType.${kase.productType}`)}</Badge>
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={STATUS_TONE[kase.status]} shape="outline">
            {t(`status.${kase.status}`)}
          </Badge>
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
            {t(`axisTag.${kase.axis}`)}
          </span>
        </div>
      </div>

      {/* Propuesto · base · salto */}
      <div className="grid gap-3 rounded-md bg-bg/40 p-3 sm:grid-cols-3">
        <Figure label={t('proposed')} value={formatMoneyCents(kase.proposedMxnCents, locale)} emphasis />
        <Figure
          label={t('baseline')}
          value={kase.baselineMxnCents === null ? t('noBaseline') : formatMoneyCents(kase.baselineMxnCents, locale)}
        />
        <Figure
          label={t('jump')}
          value={kase.baselineMxnCents === null ? '—' : formatJump(kase.jumpFactorMilli, locale)}
        />
      </div>

      {/* Por qué se detuvo: consenso + qué dijo cada fuente */}
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">
          {kase.consensus
            ? t('consensus.yes', { families: kase.familyCount })
            : t('consensus.no', { sources: kase.sourceCount, families: kase.familyCount })}
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.04em] text-muted">
                <th className="px-3 py-2 font-medium">{t('quote.source')}</th>
                <th className="px-3 py-2 font-medium">{t('quote.family')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('quote.price')}</th>
                <th className="px-3 py-2 font-medium">{t('quote.date')}</th>
              </tr>
            </thead>
            <tbody>
              {kase.quotes.map((q, i) => (
                <tr key={`${q.source}-${q.family}-${i}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{q.source}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{q.family}</td>
                  <td className="px-3 py-2 text-right tabular">{formatMoneyCents(q.priceMxnCents, locale)}</td>
                  <td className="px-3 py-2">
                    <span className="tabular text-muted">{formatDate(q.capturedDate, locale)}</span>
                    {q.stale && (
                      <Badge tone="warning" className="ml-2">
                        {t('quote.stale')}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Acciones: solo cuando el caso está ABIERTO. Resuelto ⇒ quién y cuándo. */}
      {isOpen ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} loading={busyAction === 'accept'} onClick={onAccept}>
              <Check size={16} /> {t('actions.accept')}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} loading={busyAction === 'keep'} onClick={onKeep}>
              <Lock size={16} /> {t('actions.keep')}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onManual}>
              <PencilLine size={16} /> {t('actions.manual')}
            </Button>
          </div>
          <p className="max-w-[70ch] text-xs text-muted">
            {kase.baselineMxnCents === null
              ? t('actions.helpNoBaseline', { proposed: formatMoneyCents(kase.proposedMxnCents, locale) })
              : t('actions.help', {
                  proposed: formatMoneyCents(kase.proposedMxnCents, locale),
                  baseline: formatMoneyCents(kase.baselineMxnCents, locale),
                })}
          </p>
          <p className="font-mono text-[11px] text-muted">{t('actions.audit')}</p>
        </div>
      ) : (
        <p className="text-xs text-muted" data-testid={`price-review-resolved-${kase.id}`}>
          {t('resolved', {
            action: kase.resolvedAction ? t(`actions.${kase.resolvedAction}`) : '—',
            who: kase.resolvedBy ?? '—',
            when: kase.resolvedAt ? formatDate(kase.resolvedAt, locale) : '—',
          })}
        </p>
      )}
    </div>
  );
}

/** Una cifra etiquetada del bloque propuesto/base/salto. */
function Figure({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-[0.04em] text-muted">{label}</span>
      <span className={cn('tabular', emphasis ? 'text-lg font-semibold text-text' : 'text-text')}>{value}</span>
    </div>
  );
}
