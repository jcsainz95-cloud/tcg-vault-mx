'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { groupLabel, type LinkRepairResult, type LinkSetReason } from '@/lib/api/catalog-link-repair';
import { asApiError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §AUTO-ENLACE — resultado de «Actualizar este set» (link-repair), el MISMO para la lista de cartas sin ligar y para
 * la fila de la tabla general de M2. Pinta: ligadas, precios escritos, grupo usado, motivo y próximo reintento.
 * `imported` = cartas traídas por `sync` en la misma acción (null/undefined = no hubo sync).
 */
export function LinkRepairResultNotice({
  name, result, error, imported, linkSkipped, failedPhase, onDismiss,
}: {
  name: string;
  result?: LinkRepairResult | null;
  error?: unknown;
  imported?: number | null;
  /** `sync` respondió sin `localSetId` (backend previo): no se pudo ligar. */
  linkSkipped?: boolean;
  /** Fase en la que falló la acción de la tabla: `catalog` = la importación de cartas (`sync`); `variants` = `link-repair`. */
  failedPhase?: 'catalog' | 'variants' | null;
  /** Si viene, el resultado se puede cerrar (resultado fijo de I-4, §7.7). */
  onDismiss?: () => void;
}) {
  const t = useTranslations('admin.m2.catalog.unlinkedPrice');
  const format = useFormatter();
  const getError = useErrorMessage('operator');
  const tf = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const timeOf = (iso: string) => format.dateTime(new Date(iso), { timeStyle: 'short' });
  const reasonText = (k: string) => tf(`reason.${k}`);
  const countText = (k: string, n: number) => tf(`reasonCount.${k}`, { n });
  const setReasonText = (r: LinkSetReason) => tf(`setReason.${r}`);

  const hasError = error != null;
  const apiErr = hasError ? asApiError(error) : null;
  const importFailed = failedPhase === 'catalog';
  const errorText = (() => {
    if (!apiErr) return null;
    if (apiErr.status === 429) {
      const secs = Number((apiErr.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
      return Number.isFinite(secs) && secs > 0 ? t('rate', { minutes: Math.max(1, Math.ceil(secs / 60)) }) : t('rateGeneric');
    }
    if (importFailed) return null;
    if (apiErr.status === 503 || apiErr.code === 'UPSTREAM_ERROR') return t('upstream');
    return null;
  })();

  // Motivos que ya van en la frase principal (solo la rama `none` los pinta); el resto se avisa aparte, una sola vez.
  const pricedOnly = !!result && result.linked === 0 && (result.priced ?? 0) > 0;
  const leadKeys: string[] = result && result.linked === 0 && !pricedOnly && !result.reason ? result.reasons.map((r) => r.key) : [];
  // `pricedOnly` no pinta motivos: los de cartas (salvo acabado y nombre, que tienen su aviso) se listan en su propia frase.
  const pricedOnlyReasons = pricedOnly && result
    ? result.reasons.filter((r) => r.key !== 'finishNotInProduct' && r.key !== 'nameMismatch')
    : [];

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
          {pricedOnlyReasons.length > 0 &&
            ` ${t('reasonsNote', { list: pricedOnlyReasons.map((r) => (r.count == null ? reasonText(r.key) : countText(r.key, r.count))).join(', ') })}`}
          {(result.finishNotInProduct ?? 0) > 0 && !leadKeys.includes('finishNotInProduct') &&
            ` ${t('finishNotice', { n: result.finishNotInProduct ?? 0 })}`}
          {(result.nameMismatch ?? 0) > 0 && !leadKeys.includes('nameMismatch') &&
            ` ${t('nameMismatchNotice', { n: result.nameMismatch ?? 0 })}`}
          {result.groupUsed && ` ${t('groupUsed', { name: groupLabel(result.groupUsed, tf) })}`}
          {result.nextAttemptAt && ` ${t('nextAttempt', { when: timeOf(result.nextAttemptAt) })}`}
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="ml-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="unlinked-result-close">
              {t('dismiss')}
            </button>
          )}
        </p>
      )}
      {hasError && (
        <p role="alert" className="mt-2 border-l-2 border-danger pl-2 text-sm text-danger" data-testid="unlinked-error">
          {!importFailed && imported != null && `${t('imported', { n: imported })} `}
          {errorText ?? `${importFailed ? t('errImport', { name }) : t('err', { name })} ${getError(error)}`}
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="ml-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="unlinked-result-close">
              {t('dismiss')}
            </button>
          )}
        </p>
      )}
    </>
  );
}
