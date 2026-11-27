'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { confirmCardLink, getSetCards, type ReviewCard } from '@/lib/api/catalog-link-review';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §AUTO-ENLACE §9.4 — «Revisar N cartas»: cartas de un set con nombre distinto o número repetido, con los productos
 * candidatos del proveedor. «Es esta» liga y precia SOLO esa carta; la fila se quita en sitio. Precio = el del servidor.
 */
export interface CardReviewProgress { linked: number; priced: number }
/** El servidor llama `reverse_holofoil` al acabado que otras fuentes llaman `reverse_holo`. */
const FINISH_ALIAS: Record<string, string> = { reverse_holo: 'reverse_holofoil', reverseholo: 'reverse_holofoil' };

export function CardReviewPanel({ setId, setName, count, onProgress }: { setId: string; setName: string; count: number; onProgress?: (p: CardReviewProgress) => void }) {
  const t = useTranslations('admin.m2.catalog.cardReview');
  const tf = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<string, number>>({});
  const q = useQuery({ queryKey: ['link-set-cards', setId], queryFn: () => getSetCards(setId), enabled: open, retry: false });
  const confirm = useMutation({
    mutationFn: (v: { cardId: string; productId: number }) => confirmCardLink(setId, v.cardId, v.productId),
    onSuccess: (r) => {
      const next = { ...done, [r.cardId]: r.priced };
      setDone(next);
      // Sube el avance al padre: la fila del set puede desaparecer al refrescar y el mensaje no debe irse con ella.
      onProgress?.({ linked: Object.keys(next).length, priced: Object.values(next).filter((n) => n > 0).length });
      qc.invalidateQueries({ queryKey: ['link-exceptions'] });
      qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
    },
  });
  const errText = (e: unknown) => {
    const a = asApiError(e);
    if (a?.status === 429) return t('err.rate');
    if (a?.code === 'PRODUCT_TAKEN') return t('err.taken');
    if (a?.code === 'PRODUCT_NOT_CANDIDATE') return t('err.notCandidate');
    if (a?.status === 503 || a?.code === 'UPSTREAM_ERROR') return t('err.upstream');
    return `${t('err.generic')} ${getError(e)}`;
  };
  // §10.4: `no_source_product` es informativo (sin candidatos, sin botón) y no cuenta como «por revisar».
  const noSource = (q.data?.items ?? []).filter((c) => c.reason === 'no_source_product');
  const pending = (q.data?.items ?? []).filter((c) => c.reason !== 'no_source_product' && !(c.cardId in done));
  const finishes = (raw: string) => { const f = FINISH_ALIAS[raw] ?? raw; return tf(`finish.${f}`) === `admin.m2.catalog.cardReview.finish.${f}` ? raw : tf(`finish.${f}`); };
  const doneN = Object.keys(done).length;
  const donePriced = Object.values(done).filter((n) => n > 0).length;

  return (
    <div className="mt-2" data-testid="card-review">
      <Button size="sm" variant="secondary" aria-expanded={open} aria-label={t('openAria', { name: setName })} onClick={() => setOpen((o) => !o)}>
        {open ? t('close') : t('open', { n: count })}
      </Button>
      {open && (
        <div className="mt-2">
          {q.isLoading && <p className="text-xs text-muted" role="status">{t('loading')}</p>}
          {q.isError && (
            <p role="alert" className="text-xs text-danger" data-testid="card-review-load-error">
              {errText(q.error)}{' '}
              <button type="button" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => q.refetch()}>{t('retry')}</button>
            </p>
          )}
          {q.data && pending.length === 0 && <p className="text-xs text-muted" data-testid="card-review-empty">{t('empty')}</p>}
          <ul className="divide-y divide-border">
            {pending.map((c: ReviewCard) => (
              <li key={c.cardId} className="py-2" data-testid="card-review-item">
                <p className="text-sm font-medium break-words">{c.name}{c.number ? ` #${c.number}` : ''} · <span className="text-xs text-muted">{tf(`reason.${c.reason}`)}</span></p>
                {c.candidates.length === 0 && <p className="text-xs text-muted">{t('noCandidates')}</p>}
                <ul className="mt-1 space-y-1">
                  {c.candidates.map((p) => (
                    <li key={p.productId} className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-border pl-2">
                      <p className="min-w-0 text-xs break-words">
                        {c.name} ↔ <span className="font-medium">{p.name}</span>{p.number ? ` #${p.number}` : ''}
                        {p.finishes.length > 0 && ` · ${p.finishes.map(finishes).join(', ')}`}
                        {` · ${p.priceCents == null ? t('noPrice') : `${formatMoneyCents(p.priceCents, locale)} (${t('marketLabel')})`}`}
                      </p>
                      <Button
                        size="sm"
                        variant="primary"
                        aria-label={t('thisAria', { card: c.name, product: p.name })}
                        loading={confirm.isPending && confirm.variables?.cardId === c.cardId && confirm.variables?.productId === p.productId}
                        disabled={confirm.isPending}
                        onClick={() => confirm.mutate({ cardId: c.cardId, productId: p.productId })}
                      >
                        {t('this')}
                      </Button>
                    </li>
                  ))}
                </ul>
                {confirm.isError && confirm.variables?.cardId === c.cardId && (
                  <p role="alert" className="mt-1 text-xs text-danger" data-testid="card-review-error">{errText(confirm.error)}</p>
                )}
              </li>
            ))}
          </ul>
          {noSource.length > 0 && <p className="mt-2 text-xs text-muted" data-testid="card-review-no-source">{t('noSource', { n: noSource.length })}</p>}
          {doneN > 0 && (
            <p role="status" className="mt-2 border-l-2 border-ink pl-2 text-sm" data-testid="card-review-done">
              {donePriced > 0 && donePriced < doneN ? t('donePartial', { n: doneN, priced: donePriced, held: doneN - donePriced }) : t('done', { n: doneN, priced: donePriced })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
