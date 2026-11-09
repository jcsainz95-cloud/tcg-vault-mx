'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  getTcgcsvGroups,
  type TcgcsvImportResult,
} from '@/lib/api/tcgcsv-promos';
import { QueryState } from '@/components/ui/QueryState';
import { computeVerdict, type Verdict } from '@/lib/verdict';
import type { CatalogSyncPromos } from '@/types/contract';
import { PromoAutoFacts } from './CatalogSyncSection';

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

export function TcgcsvPromosSection({ promos }: { promos?: CatalogSyncPromos } = {}) {
  const t = useTranslations('admin.m2.tcgcsvPromos');

  const groups = useQuery({ queryKey: ['tcgcsv-groups'], queryFn: getTcgcsvGroups });

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
        <PromoAutoFacts promos={promos} />
      </div>

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
              return (
                <li
                  key={g.groupId}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{g.name}</span>
                    <span className="font-mono text-xs text-muted">
                      {t('meta', { id: g.groupId, products: g.productCount == null ? '—' : g.productCount, count: g.cardCount })}
                      {g.imported ? ` · ${t('imported')}` : ''}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </section>
  );
}
