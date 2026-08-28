'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Wand2 } from 'lucide-react';
import { getRarityHealth, unifyRarities } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/**
 * M2 › **Salud del catálogo de rarezas** (DESIGN_SYSTEM §21.7b). Sustituye al asignador
 * rareza→tier, que se retiró con el pricing por tiers: las rarezas **ya no fijan precios**.
 *
 * Es de **solo lectura** y existe por dos razones: (a) respalda el **guardarraíl** —una carta de
 * rareza premium que aterriza en el piso no se publica—, y (b) es el anfitrión natural de
 * «Unificar rarezas» (§19.5), cuyo *information scent* se conserva intacto: el remedio sigue junto
 * al síntoma (la lista fragmentada), solo que la lista ya no es un editor de precios.
 *
 * Consume `GET /admin/pricing/rarities` (re-propositado en v2.0: sin `rule`, sin `tierId`).
 */
export function RarityHealthSection() {
  const t = useTranslations('admin.m2');
  const tt = useTranslations('admin.m2.rarityHealth');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const health = useQuery({ queryKey: ['rarity-health'], queryFn: getRarityHealth });

  const [unifyOpen, setUnifyOpen] = useState(false);
  const unifyMutation = useMutation({
    mutationFn: () => unifyRarities(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rarity-health'] });
    },
  });

  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="rarity-health-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="rarity-health-title" className="text-h2 font-semibold">
            {tt('title')}
          </h2>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              size="sm"
              loading={unifyMutation.isPending}
              onClick={() => setUnifyOpen(true)}
            >
              <Wand2 size={14} aria-hidden /> {t('unifyRarities.button')}
            </Button>
            <p className="max-w-xs text-right text-xs text-muted">{t('unifyRarities.hint')}</p>
          </div>
        </div>
        <p className="max-w-3xl text-sm text-muted">{tt('subtitle')}</p>

        {unifyMutation.isSuccess && (
          <Banner variant="success" role="status">
            <span className="font-medium">{t('unifyRarities.done')}</span>{' '}
            {t('unifyRarities.summary', {
              updated: unifyMutation.data.cardsUpdated,
              processed: unifyMutation.data.cardsProcessed,
              distinct: unifyMutation.data.distinctCanonical,
            })}
            {unifyMutation.data.unmapped.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                <p className="font-medium">
                  {t('unifyRarities.unmappedTitle', { count: unifyMutation.data.unmapped.length })}
                </p>
                <ul className="list-disc pl-5">
                  {unifyMutation.data.unmapped.map((u) => (
                    <li key={u.raw}>
                      <span lang="en" className="font-medium">
                        {u.raw}
                      </span>{' '}
                      <span className="tabular text-muted">({u.count})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Banner>
        )}
        {unifyMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {getError(unifyMutation.error)}
          </Banner>
        )}

        <QueryState
          isLoading={health.isLoading}
          isError={health.isError}
          error={health.error}
          onRetry={() => health.refetch()}
        >
          {health.data && (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface p-4">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">{tt('title')}</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="eyebrow py-2 font-normal">
                      {tt('canonicalCol')}
                    </th>
                    <th scope="col" className="eyebrow py-2 font-normal">
                      {tt('premiumCol')}
                    </th>
                    <th scope="col" className="eyebrow py-2 font-normal">
                      {tt('mappedCol')}
                    </th>
                    <th scope="col" className="eyebrow py-2 text-right font-normal">
                      {tt('cardCountCol')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {health.data.rarities.map((row) => (
                    <tr key={row.canonical} className="border-b border-border">
                      <th scope="row" className="py-2 pr-3 text-sm font-medium" lang="en">
                        {row.canonical}
                      </th>
                      <td className="py-2 pr-3">
                        {row.premium && (
                          <Badge tone="accent" shape="outline">
                            {tt('premium')}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {!row.mapped && (
                          <Badge tone="warning" shape="outline">
                            {tt('unmapped')}
                          </Badge>
                        )}
                      </td>
                      <td className="tabular py-2 text-right text-sm text-muted">{row.cardCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </section>

      {/* §19.5 + §21.7b: la confirmación dice ahora las DOS consecuencias — no cambia precios, pero
          sí puede cambiar QUÉ CARTAS quedan retenidas por el guardarraíl (mira la rareza premium). */}
      <Modal
        open={unifyOpen}
        onClose={() => setUnifyOpen(false)}
        title={t('unifyRarities.confirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnifyOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={unifyMutation.isPending}
              onClick={() => {
                setUnifyOpen(false);
                unifyMutation.mutate();
              }}
            >
              {t('unifyRarities.confirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('unifyRarities.confirmBody')}</p>
      </Modal>
    </>
  );
}
