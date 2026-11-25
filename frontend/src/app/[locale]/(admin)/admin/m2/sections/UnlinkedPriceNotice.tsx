'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { repairCatalogLinks } from '@/lib/api/catalog-link-repair';
import { asApiError } from '@/lib/api-client';
import type { UnlinkedPriceReport } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/components/ui/QueryState';

/**
 * §PRECIO-SIN-ENLACE — aviso de cartas sin precio ligado (`sync-status.unlinkedPrice`).
 * Ausente o 0 cartas ⇒ no pinta nada. «Reintentar enlace» = `POST /admin/catalog/sync {setId, force:true}`.
 */
export function UnlinkedPriceNotice({ report }: { report: UnlinkedPriceReport | undefined }) {
  const t = useTranslations('admin.m2.catalog.unlinkedPrice');
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: (setId: string) => repairCatalogLinks(setId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['catalog-sync-status'] }),
  });
  const notLinkable = report?.notLinkable?.sets ?? [];
  if (!report || (!(report.totalCards > 0 && report.sets?.length) && !notLinkable.length)) return null;
  const pendingId = retry.isPending ? retry.variables : null;
  const lastName = report.sets.find((s) => s.setId === retry.variables)?.name ?? '';

  const rateLimited = retry.isError && asApiError(retry.error)?.status === 429;
  const res = retry.data;
  const reasonText = (k: string) => t(`reason.${k}` as never);
  const hasLinkable = report.totalCards > 0 && report.sets?.length > 0;

  return (
    <Banner
      variant="warning"
      role="status"
      title={hasLinkable ? t('title', { cards: report.totalCards, sets: report.sets.length }) : t('notLinkableTitle', { count: report.notLinkable?.totalCards ?? 0 })}
    >
      {hasLinkable && <p className="text-sm">{t('lead')}</p>}
      <ul className="mt-2 divide-y divide-border">
        {(hasLinkable ? report.sets : []).map((s) => (
          <li key={s.setId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                {t('row', { unlinked: s.unlinked, total: s.total })}
                {s.collisions != null && ` · ${t('collisions', { n: s.collisions })}`}
                {s.omittedProducts != null && ` · ${t('omitted', { n: s.omittedProducts })}`}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('aria', { name: s.name })}
              loading={pendingId === s.setId}
              disabled={retry.isPending}
              onClick={() => retry.mutate(s.setId)}
            >
              <RefreshCw size={14} aria-hidden /> {pendingId === s.setId ? t('retrying') : t('retry')}
            </Button>
          </li>
        ))}
      </ul>
      {retry.isSuccess && res && (
        <p role="status" className="mt-2 text-sm" data-testid="unlinked-result">
          {res.linked > 0
            ? t('ok', { n: res.linked, name: lastName })
            : t('none', { name: lastName, reason: reasonText(res.reason ?? 'other') })}
        </p>
      )}
      {retry.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {rateLimited ? t('rate') : `${t('err', { name: lastName })} ${getError(retry.error)}`}
        </p>
      )}
      {notLinkable.length > 0 && (
        <div className="mt-3" data-testid="unlinked-not-linkable">
          {hasLinkable && <p className="text-sm font-medium">{t('notLinkableTitle', { count: report.notLinkable?.totalCards ?? 0 })}</p>}
          <ul className="divide-y divide-border">
            {notLinkable.map((s) => (
              <li key={s.setId} className="py-2">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted">
                  {t('cardsCount', { n: s.unlinked })} · {reasonText(s.reason === 'no_group' ? 'noGroup' : s.reason === 'tcgcsv_source' ? 'tcgcsvSource' : 'other')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Banner>
  );
}
