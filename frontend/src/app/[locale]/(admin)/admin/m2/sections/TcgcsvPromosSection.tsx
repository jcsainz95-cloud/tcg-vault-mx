'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import {
  getTcgcsvGroups,
  importTcgcsvSet,
  type TcgcsvGroupDTO,
  type TcgcsvImportResult,
} from '@/lib/api/tcgcsv-promos';
import { Button } from '@/components/ui/Button';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { VerdictBanner } from '@/components/ui/VerdictNotice';
import { computeVerdict, type Verdict } from '@/lib/verdict';

/**
 * Veredicto de «Importar promos de TCGCSV» (PROMO-F1). Misma norma que §32.4: sale de las cifras,
 * nunca de `isSuccess`. Escritura = creadas + actualizadas. Omitidas con motivo ⇒ `partial`
 * (se muestran siempre, íntegras). «Sin precio» NO es fallo: es un estado (precio pendiente).
 */
export function promoImportVerdict(r: TcgcsvImportResult): Verdict {
  return computeVerdict({
    nothingRan: false,
    writes: [r.created + r.updated],
    failedOrPending: r.skipped.length > 0,
    hadWork: true,
  });
}

export function TcgcsvPromosSection() {
  const t = useTranslations('admin.m2.tcgcsvPromos');
  const tv = useTranslations('common.verdict');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const [lastGroup, setLastGroup] = useState<TcgcsvGroupDTO | null>(null);

  const groups = useQuery({ queryKey: ['tcgcsv-groups'], queryFn: getTcgcsvGroups });
  const importMutation = useMutation({
    mutationFn: (g: TcgcsvGroupDTO) => importTcgcsvSet(g.groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tcgcsv-groups'] });
    },
  });
  const result = importMutation.data;
  const verdict = result ? promoImportVerdict(result) : null;

  return (
    <section
      role="group"
      aria-labelledby="m2-tcgcsv-promos"
      className="flex flex-col gap-3 border-t border-border pt-8"
    >
      <div className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{t('eyebrow')}</p>
        <h2 id="m2-tcgcsv-promos" className="text-h2 font-semibold">{t('title')}</h2>
        <p className="max-w-3xl text-sm text-muted">{t('subtitle')}</p>
      </div>

      {verdict != null && result != null && (
        <VerdictBanner verdict={verdict} label={tv(verdict)}>
          <p data-testid="promo-summary">
            {t('summary', {
              group: lastGroup?.name ?? '',
              created: result.created,
              updated: result.updated,
              stamped: result.stamped,
            })}
          </p>
          {result.noPrice > 0 && (
            <p data-testid="promo-nopricing">{t('noPrice', { count: result.noPrice })}</p>
          )}
          {result.skipped.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              <p className="font-medium">{t('skippedTitle', { count: result.skipped.length })}</p>
              <ul className="list-disc pl-5" data-testid="promo-skipped">
                {result.skipped.map((s) => (
                  <li key={s.productId}>
                    <span className="font-medium">{s.name}</span>{' '}
                    <span className="text-muted">
                      {t.has(`reason.${s.reason}`) ? t(`reason.${s.reason}`) : s.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </VerdictBanner>
      )}
      {importMutation.isError && (
        <VerdictBanner verdict="failed" label={tv('failed')}>
          <span className="font-medium">{tc('errorTitle')}</span> {getError(importMutation.error)}
        </VerdictBanner>
      )}

      <QueryState
        isLoading={groups.isLoading}
        isError={groups.isError}
        error={groups.error}
        onRetry={() => groups.refetch()}
      >
        {groups.data && groups.data.length === 0 && (
          <p className="text-sm text-muted">{t('empty')}</p>
        )}
        {groups.data && groups.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-border border border-border">
            {groups.data.map((g) => {
              const mine = importMutation.isPending && importMutation.variables?.groupId === g.groupId;
              return (
                <li
                  key={g.groupId}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{g.name}</span>
                    <span className="font-mono text-xs text-muted">
                      {t('meta', { id: g.groupId, count: g.cardCount })}
                      {g.imported ? ` · ${t('imported')}` : ''}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full sm:w-auto"
                    loading={mine}
                    disabled={importMutation.isPending}
                    onClick={() => {
                      setLastGroup(g);
                      importMutation.mutate(g);
                    }}
                  >
                    <Download size={14} aria-hidden />{' '}
                    {g.imported ? t('reimport', { name: g.name }) : t('import', { name: g.name })}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </section>
  );
}
