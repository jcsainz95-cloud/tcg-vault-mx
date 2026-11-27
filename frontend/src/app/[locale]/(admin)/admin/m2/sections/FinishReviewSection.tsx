'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { decideFinishReview, getFinishReview, type FinishReviewItem, type FinishReviewResult, type ReviewDecision } from '@/lib/api/catalog-finish-review';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §AUTO-ENLACE F4 (contrato §8b) — piezas antiguas por confirmar: «¿es 1.ª edición o Unlimited?». Nada se cambia solo:
 * el dueño decide por pieza. Los precios (actual y destino) se muestran tal cual los manda el servidor, en centavos.
 * `pending:0` o sin permiso ⇒ la sección no existe. El resultado queda junto a la pieza.
 */
export function FinishReviewSection() {
  const { isSuperAdmin } = useRole();
  const t = useTranslations('admin.m2.catalog.finishReview');
  const tf = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [extra, setExtra] = useState<FinishReviewItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, FinishReviewResult>>({});
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  const q = useQuery({ queryKey: ['finish-review'], queryFn: () => getFinishReview(null), retry: false, enabled: isSuperAdmin });
  const more = useMutation({
    mutationFn: (c: string) => getFinishReview(c),
    onSuccess: (p) => { setExtra((e) => [...e, ...p.items]); setCursor(p.nextCursor); },
  });
  const decide = useMutation({
    mutationFn: (v: { item: FinishReviewItem; decision: ReviewDecision }) => decideFinishReview(v.item.inventoryItemId, v.decision, v.item.currentFinish),
    onSuccess: (r) => {
      setResults((m) => ({ ...m, [r.inventoryItemId]: r }));
      setErrors((m) => { const n = { ...m }; delete n[r.inventoryItemId]; return n; });
      qc.invalidateQueries({ queryKey: ['link-exceptions'] });
    },
    onError: (e, v) => setErrors((m) => ({ ...m, [v.item.inventoryItemId]: e })),
  });
  if (!isSuperAdmin || !q.data) return null;
  const items = [...q.data.items, ...extra];
  const next = cursor ?? (extra.length ? null : q.data.nextCursor);
  // Las resueltas en esta sesión se quedan visibles con su resultado hasta recargar (no se refresca la lista).
  const shown = items;
  if (q.data.pending === 0 && Object.keys(results).length === 0) return null;

  const money = (c: number | null) => (c == null ? t('noPrice') : formatMoneyCents(c, locale));
  const errText = (e: unknown) => {
    const a = asApiError(e);
    if (a?.code === 'ITEM_LOCKED') return t('err.ITEM_LOCKED');
    if (a?.code === 'NO_TARGET_PRICE') return t('err.NO_TARGET_PRICE');
    if (a?.code === 'ALREADY_RESOLVED') return t('err.ALREADY_RESOLVED');
    if (a?.code === 'STALE') return t('err.STALE');
    return `${t('err.generic')} ${getError(e)}`;
  };
  const busy = decide.isPending;

  return (
    <section id="finish-review" aria-label={t('aria')} data-testid="finish-review">
      <Banner variant="info" role="status" title={t('title', { n: q.data.pending })}>
        <p className="text-sm">{t('lead')}</p>
        <ul className="mt-2 divide-y divide-border">
          {shown.map((it) => {
            const res = results[it.inventoryItemId];
            const err = errors[it.inventoryItemId];
            const locked = it.blockedReason != null;
            const pendingThis = busy && decide.variables?.item.inventoryItemId === it.inventoryItemId;
            return (
              <li key={it.inventoryItemId} className="py-2" data-testid="finish-review-item">
                <p className="text-sm font-medium break-words">
                  {it.cardName}{it.number ? ` #${it.number}` : ''} · {it.setName}
                </p>
                <p className="text-xs text-muted break-words">
                  {it.folio ? `${it.folio} · ` : ''}
                  {t('finishChange', { from: tf(`finish.${it.currentFinish}`), to: tf(`finish.${it.targetFinish}`) })}
                  {' · '}
                  {t('priceChange', { from: money(it.currentPriceCents), to: money(it.targetPriceCents) })}
                </p>
                {locked && <p className="text-xs text-muted" data-testid="finish-review-blocked">{tf(`blocked.${it.blockedReason}`)}</p>}
                {!res && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={pendingThis && decide.variables?.decision === 'first_edition'}
                      disabled={busy || it.blockedReason != null}
                      aria-label={t('firstAria', { name: it.cardName })}
                      onClick={() => decide.mutate({ item: it, decision: 'first_edition' })}
                    >
                      {t('first')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={pendingThis && decide.variables?.decision === 'keep'}
                      disabled={busy || (locked && it.blockedReason !== 'no_target_price')}
                      aria-label={t('keepAria', { name: it.cardName })}
                      onClick={() => decide.mutate({ item: it, decision: 'keep' })}
                    >
                      {t('keep')}
                    </Button>
                  </div>
                )}
                {res && (
                  <p role="status" className="mt-2 border-l-2 border-ink pl-2 text-sm" data-testid="finish-review-result">
                    {res.alreadyResolved
                      ? t('alreadyResolved')
                      : res.decision === 'keep'
                        ? t('doneKeep', { name: it.cardName })
                        : t('doneFirst', { name: it.cardName, price: money(res.after?.listPriceCents ?? res.after?.unitPriceCents ?? null) })}
                  </p>
                )}
                {err != null && !res && (
                  <p role="alert" className="mt-2 border-l-2 border-danger pl-2 text-sm text-danger" data-testid="finish-review-error">{errText(err)}</p>
                )}
              </li>
            );
          })}
        </ul>
        {next && (
          <Button size="sm" variant="secondary" className="mt-2" loading={more.isPending} onClick={() => more.mutate(next)}>
            {t('more')}
          </Button>
        )}
      </Banner>
    </section>
  );
}
