'use client';

import { useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { RefreshCw } from 'lucide-react';
import { groupLabel, readGroupUsed, readSetReason, repairCatalogLinks, type LinkGroupUsed, type LinkSetReason } from '@/lib/api/catalog-link-repair';
import { confirmLinkException, getLinkExceptions, NO_BUTTON_REASONS, type HeldSample, type LinkCandidate, type LinkConfirmResult } from '@/lib/api/catalog-link-exceptions';
import type { UnlinkedPriceReport } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { asApiError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';
import { useRole } from '@/lib/role';
import { CardReviewPanel, type CardReviewProgress } from './CardReviewPanel';
import { LinkRepairResultNotice } from './LinkRepairResultNotice';
import { LINK_REPAIR_KEY } from './useCatalogSync';

/** Fila normalizada: sale de `link-exceptions` (§AUTO-ENLACE §2) o, si no responde, de `sync-status.unlinkedPrice`. */
interface NoButtonRow {
  setId: string; name: string; unlinked: number; reasonKey: string; exception: LinkSetReason | null; groupUsed: LinkGroupUsed | null;
}

interface Row {
  setId: string;
  name: string;
  unlinked: number;
  total: number;
  collisions?: number | null;
  omittedProducts?: number | null;
  conflicts?: number | null;
  reason: LinkSetReason | null;
  groupUsed: LinkGroupUsed | null;
  nextAttemptAt: string | null;
  candidates: LinkCandidate[];
  canConfirm: boolean;
  reviewable?: number | null;
  noSourceProduct?: number | null;
  sample?: HeldSample[];
  b3Published?: number | null;
  b3Held?: number | null;
}

/**
 * §AUTO-ENLACE F1/F2/F4 — lista única de sets con cartas sin ligar. Un solo botón por set, «Actualizar este set»
 * (`POST /admin/catalog/link-repair`: enlaza y precia en la misma llamada). El resultado se pinta DENTRO de la fila
 * pulsada, nunca al final de la lista. Muestra el grupo de la fuente de precios usado y el motivo (solo lectura).
 */
export function UnlinkedPriceNotice({ report }: { report: UnlinkedPriceReport | undefined }) {
  const t = useTranslations('admin.m2.catalog.unlinkedPrice');
  const format = useFormatter();
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const tr = useTranslations('admin.m2.catalog.cardReview');
  const trf = useTranslations('admin.m2.catalog.cardReview.finish');
  // El aviso «Se ligó…» de «Revisar N cartas» vive aquí: al ligar la última carta la fila desaparece y su panel con ella.
  const [cardProgress, setCardProgress] = useState<(CardReviewProgress & { setId: string; name: string }) | null>(null);
  const exceptions = useQuery({ queryKey: ['link-exceptions'], queryFn: getLinkExceptions, retry: false });
  // M-3: el botón de la tabla general y el de esta lista comparten clave; mientras uno corre, ambos se deshabilitan.
  const anyRepairRunning = useIsMutating({ mutationKey: LINK_REPAIR_KEY }) > 0;
  // §AUTO-ENLACE F3: «Confirmar» un grupo candidato (liga y precia el set). El resultado queda junto al caso.
  const confirm = useMutation({
    mutationKey: LINK_REPAIR_KEY,
    mutationFn: (v: { setId: string; groupId: number }) => confirmLinkException(v.setId, v.groupId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
      qc.invalidateQueries({ queryKey: ['link-exceptions'] });
    },
  });
  const retry = useMutation({
    mutationKey: LINK_REPAIR_KEY,
    mutationFn: (v: { setId: string; name: string }) => repairCatalogLinks(v.setId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
      qc.invalidateQueries({ queryKey: ['link-exceptions'] });
    },
  });

  // Fase 1: `link-exceptions` aún no existe (404); el camino real es `sync-status.unlinkedPrice` con grupo y motivo.
  const fromReport: Row[] = (report?.sets ?? []).map((s) => ({
    ...s, reason: readSetReason(s.reason), groupUsed: readGroupUsed(s.groupUsed), nextAttemptAt: null, candidates: [], canConfirm: false,
  }));
  const fromApi = exceptions.data?.sets ?? null;
  const linkable: Row[] = fromApi ? fromApi.filter((s) => !(s.reason && NO_BUTTON_REASONS.includes(s.reason)) && s.unlinked > 0) : fromReport;
  const noButton: NoButtonRow[] = fromApi
    ? fromApi.filter((s) => s.reason && NO_BUTTON_REASONS.includes(s.reason)).map((s) => ({ setId: s.setId, name: s.name, unlinked: s.unlinked, reasonKey: s.reason === 'tcgcsv_source' ? 'tcgcsvSource' : 'notInProvider', exception: s.reason, groupUsed: s.groupUsed }))
    : (report?.notLinkable?.sets ?? []).map((s) => ({
        setId: s.setId, name: s.name, unlinked: s.unlinked,
        reasonKey: s.reason === 'no_group' ? 'noGroup' : s.reason === 'tcgcsv_source' ? 'tcgcsvSource' : 'other',
        exception: readSetReason(s.exceptionReason), groupUsed: readGroupUsed(s.groupUsed),
      }));
  const totalCards = fromApi ? linkable.reduce((n, s) => n + s.unlinked, 0) : (report?.totalCards ?? 0);
  const notLinkableCards = noButton.reduce((n, s) => n + s.unlinked, 0);

  /** «Revisar N cartas» usa el conteo revisable del servidor; sin él, lo sin ligar menos lo que no tiene producto en la fuente. */
  const reviewCount = (s: Row) => s.reviewable ?? Math.max(0, s.unlinked - (s.noSourceProduct ?? 0));
  const pendingId = retry.isPending ? retry.variables?.setId : null;
  const autoOn = exceptions.data?.summary.autoLinkEnabled === true;
  // El nombre viaja con la acción: la fila puede desaparecer al refrescar el contador.
  const lastName = retry.variables?.name ?? '';
  const lastSetId = retry.variables?.setId ?? null;

  const tf = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const reasonText = (k: string) => tf(`reason.${k}`);
  const setReasonText = (r: LinkSetReason) => tf(`setReason.${r}`);
  const hasLinkable = linkable.length > 0;
  // Si el reintento cae otro día, se dice la fecha (una espera de 7 días no puede decir solo «0:00»).
  const timeOf = (iso: string) => {
    const d = new Date(iso);
    return format.dateTime(d, d.toDateString() === new Date().toDateString() ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' });
  };
  const finishName = (raw: string) => { const f = raw === 'reverse_holo' ? 'reverse_holofoil' : raw; return trf.has(f as never) ? trf(f as never) : raw; };
  const hasResult = retry.isSuccess || retry.isError;
  const resultInRowEarly = retry.variables?.setId != null && linkable.some((s) => s.setId === retry.variables?.setId);
  if (!linkable.length && !noButton.length && !hasResult && !cardProgress) return null;
  const groupText = (g: LinkGroupUsed) => t('groupLine', { name: groupLabel(g, tf), via: tf(`via.${g.via}`) });

  /** Resultado de la última acción, con motivo en claro. Se monta junto a la fila pulsada. */
  const result = (
    <LinkRepairResultNotice
      onDismiss={!resultInRowEarly ? () => retry.reset() : undefined}
      name={lastName}
      result={retry.isSuccess ? retry.data : null}
      error={retry.isError ? retry.error : undefined}
    />
  );
  const resultInRow = lastSetId != null && linkable.some((s) => s.setId === lastSetId);
  // I-4: si la fila ya se resolvió (desapareció al refrescar), el resultado queda FIJO arriba de la lista.
  const resolvedOnTop = hasResult && !resultInRow;

  return (
    <Banner
      variant="warning"
      role="status"
      title={hasLinkable ? t('title', { cards: totalCards, sets: linkable.length }) : noButton.length ? t('notLinkableTitle', { count: notLinkableCards }) : t('resolvedTitle')}
    >
      {resolvedOnTop && <div data-testid="unlinked-resolved">{result}</div>}
      {cardProgress && !linkable.some((s) => s.setId === cardProgress.setId) && (
        <p role="status" className="mb-2 border-l-2 border-ink pl-2 text-sm" data-testid="card-review-done-top">
          {cardProgress.name}: {cardProgress.priced > 0 && cardProgress.priced < cardProgress.linked
            ? tr('donePartial', { n: cardProgress.linked, priced: cardProgress.priced, held: cardProgress.linked - cardProgress.priced })
            : tr('done', { n: cardProgress.linked, priced: cardProgress.priced })}
        </p>
      )}
      {hasLinkable && <p className="text-sm">{t('lead')}</p>}
      <ul className="mt-2 divide-y divide-border">
        {linkable.map((s) => (
          <li key={s.setId} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted">
                  {t('row', { unlinked: s.unlinked, total: s.total })}
                  {s.collisions != null && ` · ${t('collisions', { n: s.collisions })}`}
                  {s.omittedProducts != null && ` · ${t('omitted', { n: s.omittedProducts })}`}
                  {s.conflicts != null && s.conflicts > 0 && ` · ${t('conflictsCount', { n: s.conflicts })}`}
                </p>
                {s.reason && <p className="text-xs text-muted" data-testid="unlinked-reason">{setReasonText(s.reason)}</p>}
                {s.noSourceProduct != null && s.noSourceProduct > 0 && <p className="text-xs text-muted" data-testid="unlinked-no-source">{t('noSourceCount', { n: s.noSourceProduct })}</p>}
                {(fromApi || s.groupUsed || s.reason) && (
                  <p className="text-xs text-muted" data-testid="unlinked-group">
                    {s.groupUsed ? groupText(s.groupUsed) : t('groupNone')}
                    {s.nextAttemptAt && ` · ${autoOn ? t('autoNext', { when: timeOf(s.nextAttemptAt) }) : t('nextAttempt', { when: timeOf(s.nextAttemptAt) })}`}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                aria-label={t('aria', { name: s.name })}
                loading={pendingId === s.setId}
                disabled={retry.isPending || anyRepairRunning}
                onClick={() => retry.mutate({ setId: s.setId, name: s.name })}
              >
                <RefreshCw size={14} aria-hidden /> {pendingId === s.setId ? t('retrying') : t('retry')}
              </Button>
            </div>
            {s.reason === 'b3_unverified' && (
              <div className="mt-2 text-xs" data-testid="b3-held">
                <p>{t('b3Hint')}</p>
                {s.b3Published != null && s.b3Published > 0 && <p className="mt-1" data-testid="b3-published">{t('b3Published', { n: s.b3Published })}</p>}
                {s.b3Held != null && s.b3Held > 0 && <p className="mt-1" data-testid="b3-held-count">{t('b3Held', { n: s.b3Held })}</p>}
                {(s.sample ?? []).length > 0 && (
                  <ul className="mt-1 text-muted">
                    {(s.sample ?? []).map((x, i) => (
                      <li key={i} className="break-words">
                        {x.cardName}{x.number ? ` #${x.number}` : ''}{x.finish ? ` (${finishName(x.finish)})` : ''}: {x.newPriceCents == null ? tr('noPrice') : `${formatMoneyCents(x.newPriceCents, locale)} (${t('marketLabel')})`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {s.canConfirm && s.candidates.length > 0 && (
              <ul className="mt-2 space-y-1" data-testid="link-candidates" aria-label={t('candidates.aria', { name: s.name })}>
                {s.candidates.map((c, i) => (
                  <li key={c.groupId} className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-border pl-2">
                    <div className="min-w-0 text-xs">
                      <p className="font-medium break-words">
                        {i === 0 ? t('candidates.best') : t('candidates.other')}: {c.name || tf('groupId', { id: c.groupId })}
                      </p>
                      <p className="text-muted">
                        {c.productCount != null && t('candidates.products', { n: c.productCount })}
                        {c.publishedOn && `${c.productCount != null ? ' · ' : ''}${t('candidates.published', { date: c.publishedOn })}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={i === 0 ? 'primary' : 'secondary'}
                      aria-label={t('candidates.confirmAria', { group: c.name || tf('groupId', { id: c.groupId }), name: s.name })}
                      loading={confirm.isPending && confirm.variables?.setId === s.setId && confirm.variables?.groupId === c.groupId}
                      disabled={confirm.isPending || retry.isPending || anyRepairRunning}
                      onClick={() => confirm.mutate({ setId: s.setId, groupId: c.groupId })}
                    >
                      {t('candidates.confirm')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {isSuperAdmin && fromApi && (s.reason === 'name_mismatch' || s.reason === 'collisions') && (
              reviewCount(s) > 0 && (
                <CardReviewPanel setId={s.setId} setName={s.name} count={reviewCount(s)} onProgress={(p) => setCardProgress({ ...p, setId: s.setId, name: s.name })} />
              )
            )}
            {confirm.variables?.setId === s.setId && (confirm.isSuccess || confirm.isError) && (
              <ConfirmResultNotice name={s.name} result={confirm.isSuccess ? confirm.data : null} error={confirm.isError ? confirm.error : undefined} onDismiss={() => confirm.reset()} />
            )}
            {lastSetId === s.setId && result}
          </li>
        ))}
      </ul>
      {noButton.length > 0 && (
        <div className="mt-3" data-testid="unlinked-not-linkable">
          {hasLinkable && <p className="text-sm font-medium">{t('notLinkableTitle', { count: notLinkableCards })}</p>}
          <ul className="divide-y divide-border">
            {noButton.map((s) => (
              <li key={s.setId} className="py-2">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted">
                  {t('cardsCount', { n: s.unlinked })} · {s.exception ? setReasonText(s.exception) : reasonText(s.reasonKey)}
                </p>
                {s.groupUsed && <p className="text-xs text-muted" data-testid="unlinked-group">{groupText(s.groupUsed)}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Banner>
  );
}

/** §AUTO-ENLACE F3: resultado de «Confirmar», junto al caso. */
function ConfirmResultNotice({ name, result, error, onDismiss }: { name: string; result: LinkConfirmResult | null; error?: unknown; onDismiss: () => void }) {
  const t = useTranslations('admin.m2.catalog.unlinkedPrice.candidates');
  const getError = useErrorMessage('operator');
  const close = (
    <button type="button" onClick={onDismiss} className="ml-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="confirm-result-close">
      {t('dismiss')}
    </button>
  );
  if (error != null) {
    const e = asApiError(error) ?? { status: 0, code: '' };
    const text = e.status === 429 ? t('rate') : e.code === 'GROUP_NOT_FOUND' ? t('groupNotFound') : e.status >= 500 || e.code === 'UPSTREAM_ERROR' ? t('upstream') : `${t('err', { name })} ${getError(error)}`;
    return <p role="alert" className="mt-2 border-l-2 border-danger pl-2 text-sm text-danger" data-testid="confirm-error">{text}{close}</p>;
  }
  if (!result) return null;
  return (
    <p role="status" className="mt-2 border-l-2 border-ink pl-2 text-sm" data-testid="confirm-result">
      {t('done', { name, linked: result.linked, priced: result.priced })}
      {result.collisions > 0 && ` ${t('collisions', { n: result.collisions })}`}
      {result.conflicts > 0 && ` ${t('conflicts', { n: result.conflicts })}`}
      {close}
    </p>
  );
}
