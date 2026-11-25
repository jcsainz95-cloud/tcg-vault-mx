'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { syncCatalog } from '@/lib/api';
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
    mutationFn: (setId: string) => syncCatalog({ setId, force: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['catalog-sync-status'] }),
  });
  if (!report || !(report.totalCards > 0) || !report.sets?.length) return null;
  const pendingId = retry.isPending ? retry.variables : null;
  const lastName = report.sets.find((s) => s.setId === retry.variables)?.name ?? '';

  return (
    <Banner variant="warning" role="status" title={t('title', { count: report.totalCards })}>
      <p className="text-sm">{t('lead')}</p>
      <ul className="mt-2 divide-y divide-border">
        {report.sets.map((s) => (
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
      {retry.isSuccess && <p role="status" className="mt-2 text-sm">{t('ok', { name: lastName })}</p>}
      {retry.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {t('err', { name: lastName })} {getError(retry.error)}
        </p>
      )}
    </Banner>
  );
}
