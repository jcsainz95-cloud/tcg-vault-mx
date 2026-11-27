'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { LinkRepairResult, LinkSetReason } from '@/lib/api/catalog-link-repair';
import { asApiError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §AUTO-ENLACE — resultado de «Actualizar este set» (link-repair), el MISMO para la lista de cartas sin ligar y para
 * la fila de la tabla general de M2. Pinta: ligadas, precios escritos, grupo usado, motivo y próximo reintento.
 * `imported` = cartas traídas por `sync` en la misma acción (null/undefined = no hubo sync).
 */
export function LinkRepairResultNotice({
  name, result, error, imported, linkSkipped,
}: {
  name: string;
  result?: LinkRepairResult | null;
  error?: unknown;
  imported?: number | null;
  /** `sync` respondió sin `localSetId` (backend previo): no se pudo ligar. */
  linkSkipped?: boolean;
}) {
  const t = useTranslations('admin.m2.catalog.unlinkedPrice');
  const format = useFormatter();
  const getError = useErrorMessage('operator');
  const tf = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const dateOf = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  const reasonText = (k: string) => tf(`reason.${k}`);
  const countText = (k: string, n: number) => tf(`reasonCount.${k}`, { n });
  const setReasonText = (r: LinkSetReason) => tf(`setReason.${r}`);

  const hasError = error != null;
  const apiErr = hasError ? asApiError(error) : null;
  const errorText = (() => {
    if (!apiErr) return null;
    if (apiErr.status === 429) {
      const secs = Number((apiErr.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
      return Number.isFinite(secs) && secs > 0 ? t('rate', { minutes: Math.max(1, Math.ceil(secs / 60)) }) : t('rateGeneric');
    }
    if (apiErr.status === 503 || apiErr.code === 'UPSTREAM_ERROR') return t('upstream');
    return null;
  })();

  return (
    <>
      {!hasError && linkSkipped && (
        <p role="status" className="mt-2 border-l-2 border-ink pl-2 text-sm" data-testid="unlinked-result">
          {imported != null && `${t('imported', { n: imported })} `}
          {t('noLocalId', { name })}
        </p>
      )}
      {!hasError && !linkSkipped && result && (
        <p role="status" className="mt-2 border-l-2 border-ink pl-2 text-sm" data-testid="unlinked-result">
          {imported != null && `${t('imported', { n: imported })} `}
          {result.linked > 0
            ? t('ok', { n: result.linked, name })
            : (result.priced ?? 0) > 0
              ? t('pricedOnly', { name })
              : t('none', {
                  name,
                  reason: result.reason
                    ? setReasonText(result.reason)
                    : result.reasons.map((r) => (r.count == null ? reasonText(r.key) : countText(r.key, r.count))).join(', '),
                })}
          {result.priced != null && result.priced > 0 && ` ${t('priced', { n: result.priced })}`}
          {result.piecesCorrected > 0 && ` ${t('piecesCorrected', { n: result.piecesCorrected })}`}
          {result.piecesExcluded.length > 0 &&
            ` ${t('piecesExcluded', { list: result.piecesExcluded.map((e) => tf(`excl.${e.key}`, { n: e.count })).join(', ') })}`}
          {result.groupUsed && ` ${t('groupUsed', { name: result.groupUsed.name })}`}
          {result.nextAttemptAt && ` ${t('nextAttempt', { when: dateOf(result.nextAttemptAt) })}`}
        </p>
      )}
      {hasError && (
        <p role="alert" className="mt-2 border-l-2 border-danger pl-2 text-sm text-danger" data-testid="unlinked-error">
          {errorText ?? `${t('err', { name })} ${getError(error)}`}
        </p>
      )}
    </>
  );
}
