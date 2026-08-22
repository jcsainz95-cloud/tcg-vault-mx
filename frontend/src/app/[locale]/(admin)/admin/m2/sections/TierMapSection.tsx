'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Wand2 } from 'lucide-react';
import { getPricingTierMap, updatePricingTierMap, unifyRarities } from '@/lib/api';
import type { TierId } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { premiumFixedOffenders } from './tier-shared';

/**
 * M2 · Asignador rareza canónica → TIER (v1.37-pricing-tiers, P-34). Por cada rareza del catálogo, un
 * dropdown para elegir su tier (T0–T4). Consume GET/PUT /admin/pricing/tier-map (patch parcial: solo
 * las rarezas cambiadas). Money-safe: una rareza SIN tier cotiza por el fallback `pct` (nunca $0/bin
 * fijo) y se marca como «pendiente». Maneja 422 PREMIUM_RARITY_FIXED_TIER (una rareza premium no
 * puede caer en un tier de compra fija: muestra los pares infractores) y 422 UNKNOWN_RARITY. Hospeda
 * «Unificar rarezas» (§19.5): limpia la lista de rarezas que este asignador muestra.
 */
export function TierMapSection() {
  const t = useTranslations('admin.m2');
  const tt = useTranslations('admin.m2.tierMap');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const map = useQuery({ queryKey: ['pricing-tier-map'], queryFn: getPricingTierMap });
  const [draft, setDraft] = useState<Record<string, TierId>>({});

  const mutation = useMutation({
    mutationFn: (assignments: Record<string, TierId>) => updatePricingTierMap({ assignments }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing-tier-map'] });
      qc.invalidateQueries({ queryKey: ['pricing-tiers'] });
      setDraft({});
    },
  });

  // --- §19.5: «Unificar rarezas» — backfill LOCAL de rarityCanonical (money-safe, sin fuentes
  // externas). Al éxito recompone el asignador invalidando su query de mapa. ---
  const [unifyOpen, setUnifyOpen] = useState(false);
  const unifyMutation = useMutation({
    mutationFn: () => unifyRarities(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing-tier-map'] });
      qc.invalidateQueries({ queryKey: ['pricing-tiers'] });
    },
  });

  const dirty = Object.keys(draft).length > 0;
  const offenders = premiumFixedOffenders(mutation.error);

  function save() {
    if (!dirty) return;
    mutation.mutate(draft);
  }

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-h2 font-semibold">{tt('title')}</h2>
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
        <p className="text-sm text-muted">{tt('subtitle')}</p>
        {/* Invariante money-safe: una rareza premium NO puede ir a un tier de compra fija. */}
        <Banner variant="info" role="note">{tt('invariantNote')}</Banner>

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
                      <span lang="en" className="font-medium">{u.raw}</span>{' '}
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
          isLoading={map.isLoading}
          isError={map.isError}
          error={map.error}
          onRetry={() => map.refetch()}
        >
          {map.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto]">
                  <span>{tt('rarity')}</span>
                  <span className="text-right">{tt('cardCount')}</span>
                  <span>{tt('tier')}</span>
                  <span>{tt('source')}</span>
                </li>
                {map.data.rarities.map((row) => {
                  const selected = draft[row.canonical] ?? row.tierId ?? '';
                  const edited = draft[row.canonical] != null;
                  // Origen EFECTIVO: si se asignó tier en el borrador, ya no es fallback.
                  const effectiveSource = edited ? 'map' : row.source;
                  const isOffender =
                    offenders?.some((o) => o.rarity === row.canonical) ?? false;
                  return (
                    <li
                      key={row.canonical}
                      className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto]"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span lang="en">{row.canonical}</span>
                        {row.premium && (
                          <Badge tone="accent" shape="outline">{tt('premium')}</Badge>
                        )}
                        {row.mapped === false && (
                          <Badge tone="warning" shape="outline">{tt('unmapped')}</Badge>
                        )}
                        {isOffender && (
                          <Badge tone="danger" shape="outline">{tt('offender')}</Badge>
                        )}
                      </span>
                      <span className="tabular text-right text-sm text-muted">{row.cardCount}</span>
                      <Select
                        label={tt('tier')}
                        aria-label={tt('tierFor', { rarity: row.canonical })}
                        className="w-48"
                        placeholder={tt('unassigned')}
                        options={map.data.tiers.map((ti) => ({
                          value: ti.id,
                          label: `${ti.id} · ${ti.name}`,
                        }))}
                        value={selected}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return; // no permitimos "des-asignar" a vacío (patch parcial)
                          setDraft((p) => ({ ...p, [row.canonical]: v as TierId }));
                        }}
                      />
                      {/* Money-safe: sin tier → fallback pct (pendiente, nunca MX$0). */}
                      <Badge
                        tone={effectiveSource === 'map' ? 'info' : 'neutral'}
                        shape="outline"
                      >
                        {effectiveSource === 'map' ? tt('sourceMap') : tt('sourceFallback')}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={!dirty}
                  loading={mutation.isPending}
                  onClick={save}
                >
                  {tc('save')}
                </Button>
                {dirty && (
                  <Button variant="ghost" onClick={() => setDraft({})}>
                    {tc('cancel')}
                  </Button>
                )}
              </div>

              {mutation.isSuccess && (
                <Banner variant="success" role="status">{tt('saved')}</Banner>
              )}
              {/* 422 PREMIUM_RARITY_FIXED_TIER: pares (rareza premium → tier de compra fija). */}
              {offenders != null && (
                <Banner variant="danger" role="alert" title={tt('premiumFixedTitle')}>
                  <p>{tt('premiumFixedBody')}</p>
                  <ul className="mt-2 list-disc pl-5">
                    {offenders.map((o) => (
                      <li key={`${o.rarity}-${o.tierId}`}>
                        <span lang="en" className="font-medium">{o.rarity}</span> → {o.tierId}
                      </li>
                    ))}
                  </ul>
                </Banner>
              )}
              {mutation.isError && offenders == null && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                  {getError(mutation.error)}
                </Banner>
              )}
            </div>
          )}
        </QueryState>
      </section>

      {/* §19.5: confirmación one-shot money-safe de «Unificar rarezas». */}
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
