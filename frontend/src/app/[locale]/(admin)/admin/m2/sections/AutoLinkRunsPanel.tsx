'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { getAutoLinkRuns, unlinkSet, type RunSet, type UnlinkResult } from '@/lib/api/catalog-link-review';
import { getLinkExceptions } from '@/lib/api/catalog-link-exceptions';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §AUTO-ENLACE §9.6 — «Ver lo que hizo ayer»: corridas del job con sus sets y muestras (precio nuevo vs anterior, del servidor)
 * y, por set, «Deshacer este set» con confirmación (solo super_admin; si backend aún no lo expone, el error se dice claro).
 */
export function AutoLinkRunsPanel({ canUnlink }: { canUnlink: boolean }) {
  const t = useTranslations('admin.m2.catalog.autoLinkRuns');
  const tf = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const format = useFormatter();
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RunSet | null>(null);
  const [undone, setUndone] = useState<Record<string, UnlinkResult>>({});
  const q = useQuery({ queryKey: ['auto-link-runs'], queryFn: () => getAutoLinkRuns(7), enabled: open, retry: false });
  // Mismo caché que la lista de excepciones: un set revertido ya no ofrece «Deshacer».
  const exc = useQuery({ queryKey: ['link-exceptions'], queryFn: getLinkExceptions, retry: false, enabled: open });
  const revertedIds = new Set((exc.data?.sets ?? []).filter((x) => x.reason === 'reverted').map((x) => x.setId));
  const undo = useMutation({
    mutationFn: (setId: string) => unlinkSet(setId),
    onSuccess: (d, setId) => {
      setUndone((u) => ({ ...u, [setId]: d }));
      setTarget(null);
      qc.invalidateQueries({ queryKey: ['link-exceptions'] });
      qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
    },
  });
  const money = (c: number | null) => (c == null ? t('noPrice') : formatMoneyCents(c, locale));
  const at = (iso: string) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' }) : '');
  const tc = useTranslations('admin.m2.catalog.cardReview.finish');
  const finishName = (raw: string) => { const f = raw === 'reverse_holo' ? 'reverse_holofoil' : raw; return tc.has(f as never) ? tc(f as never) : raw; };
  const abortText = (code: string) => (tf(`abortReason.${code}`) === `admin.m2.catalog.autoLinkRuns.abortReason.${code}` ? code : tf(`abortReason.${code}`));
  const undoErr = (e: unknown) => {
    const a = asApiError(e);
    if (a?.status === 404) return t('undoUnavailable');
    if (a?.code === 'NOTHING_TO_UNLINK') return t('nothingToUnlink');
    if (a?.status === 429) return t('undoRate');
    return `${t('undoErr')} ${getError(e)}`;
  };

  return (
    <div className="mt-1" data-testid="auto-link-runs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-xs underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        data-testid="auto-link-runs-toggle"
      >
        {open ? t('hide') : t('show')}
      </button>
      {open && (
        <div className="mt-2 text-xs">
          {q.isLoading && <p role="status" className="text-muted">{t('loading')}</p>}
          {q.isError && (
            <p role="alert" className="text-danger" data-testid="auto-link-runs-error">
              {t('loadErr')} {getError(q.error)}{' '}
              <button type="button" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => q.refetch()}>{t('retry')}</button>
            </p>
          )}
          {q.data && q.data.length === 0 && <p className="text-muted" data-testid="auto-link-runs-empty">{t('none')}</p>}
          {q.data?.map((r) => (
            <section key={r.runId} className="mt-2 border-l-2 border-border pl-2" data-testid="auto-link-run" aria-label={t('runAria', { when: at(r.at) })}>
              <p className="font-medium">
                {t('run', { when: at(r.at), linked: r.linked, priced: r.priced })}
                {r.held > 0 && ` · ${t('held', { n: r.held })}`}
                {r.aborted != null && ` · ${t('aborted')}: ${abortText(r.aborted)}`}
              </p>
              <ul className="mt-1 space-y-2">
                {r.sets.map((s) => (
                  <li key={s.setId || s.name}>
                    <p className="break-words">
                      <span className="font-medium">{s.name}</span> · {tf(`via.${s.via}`) === `admin.m2.catalog.autoLinkRuns.via.${s.via}` ? s.via : tf(`via.${s.via}`)}
                      {` · ${t('setLine', { linked: s.linked, priced: s.priced })}`}
                      {s.held > 0 && ` · ${t('held', { n: s.held })}`}
                      {s.finishesAdded > 0 && ` · ${t('finishes', { n: s.finishesAdded })}`}
                    </p>
                    {s.sample.length > 0 && (
                      <ul className="text-muted">
                        {s.sample.map((x, i) => (
                          <li key={i} className="break-words">
                            {x.cardName}{x.number ? ` #${x.number}` : ''}{x.finish ? ` (${finishName(x.finish)})` : ''}: {x.previousPriceCents == null ? t('noPrice') : money(x.previousPriceCents)} → {money(x.newPriceCents)} <span className="whitespace-nowrap">{t('marketLabel')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {canUnlink && s.setId && s.linked > 0 && !revertedIds.has(s.setId) && (
                      undone[s.setId]
                        ? <p role="status" className="mt-1" data-testid="auto-link-undone">{t('undone', { n: undone[s.setId].unlinked, prices: undone[s.setId].pricesRemoved })}</p>
                        : <Button size="sm" variant="secondary" className="mt-1" aria-label={t('undoAria', { name: s.name })} onClick={() => { undo.reset(); setTarget(s); }}>{t('undo')}</Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Modal
        open={target != null}
        onClose={() => setTarget(null)}
        title={t('undoTitle', { name: target?.name ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>{t('cancel')}</Button>
            <Button loading={undo.isPending} onClick={() => target && undo.mutate(target.setId)} data-testid="auto-link-undo-confirm">{t('undoConfirm')}</Button>
          </>
        }
      >
        <p className="text-sm">{t('undoBody')}</p>
        {undo.isError && <p role="alert" className="mt-2 text-sm text-danger" data-testid="auto-link-undo-error">{undoErr(undo.error)}</p>}
      </Modal>
    </div>
  );
}
