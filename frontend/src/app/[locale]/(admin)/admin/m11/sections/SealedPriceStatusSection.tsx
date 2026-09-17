'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSealedPriceStatus } from '@/lib/api';
import type { SealedPriceState, SealedPriceStatusRowDTO } from '@/types/contract';
import { useRole } from '@/lib/role';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { SealedSetMappingModal } from './SealedSetMappingModal';

/** Tono del badge por estado: preciado = éxito, mapeado-sin-precio = aviso, sin mapear = atención. */
const STATE_TONE: Record<SealedPriceState, 'success' | 'warning' | 'accent'> = {
  priced: 'success',
  mapped_unpriced: 'warning',
  unmapped: 'accent',
};

/**
 * §diseño §10 — vista de estado por set del sellado (`vault_operator+`). Dice, POR SET, si su precio
 * está: **con precio · emparejado sin precio · SIN emparejar**, y por qué (`reason`). Lee estado
 * PERSISTIDO (sin TCGCSV, O-17 safe). Es lo que deja ver **por qué** un set no trae precio, para
 * decidir si hace falta corregir el mapeo (§11) o solo disparar la ingesta (§9).
 *
 * Acciones por fila: «SIN emparejar» abre el mapeo manual (§11, solo `super_admin`); «emparejado sin
 * precio» con el dial `on` remite a «Traer precios ahora» (arriba, §9); con el dial `off` explica que
 * falta encender el maestro.
 */
export function SealedPriceStatusSection() {
  const t = useTranslations('admin.m11.status');
  const tState = useTranslations('admin.m11.status.state');
  const tReason = useTranslations('admin.m11.status.reason');
  const { isSuperAdmin } = useRole();

  const [q, setQ] = useState('');
  const [mapping, setMapping] = useState<SealedPriceStatusRowDTO | null>(null);

  const status = useQuery({
    queryKey: ['sealed-price-status', q],
    queryFn: () => getSealedPriceStatus({ q: q.trim() || undefined }),
  });

  return (
    <section className="flex flex-col gap-3" aria-label={t('title')}>
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('search')}
          className="w-64"
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <QueryState
        isLoading={status.isLoading}
        isError={status.isError}
        error={status.error}
        onRetry={() => status.refetch()}
      >
        {status.data &&
          (status.data.data.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">{t('colSet')}</th>
                  <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">{t('colState')}</th>
                  <th scope="col" className="eyebrow px-3 py-2 text-right font-normal">{t('colBreakdown')}</th>
                  <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">{t('colWhy')}</th>
                  <th scope="col" className="eyebrow px-3 py-2 text-right font-normal" />
                </tr>
              </thead>
              <tbody>
                {status.data.data.map((row) => (
                  <tr key={row.set.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-3 align-top text-sm text-text">
                      <span lang="en" className="font-medium">{row.set.name}</span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge tone={STATE_TONE[row.state]} shape="outline">
                        {tState(row.state)}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 align-top text-right">
                      <span className="font-mono tabular-nums text-xs text-muted">
                        {t('breakdown', {
                          priced: row.priced,
                          mapped: row.mappedUnpriced,
                          unmapped: row.unmapped,
                        })}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top text-sm text-muted">
                      {row.reason ? tReason(row.reason) : '—'}
                    </td>
                    <td className="px-3 py-3 align-top text-right">
                      {/* El mapeo manual solo es `super_admin` (el backend además 403ea). */}
                      {isSuperAdmin && (
                        <Button variant="secondary" size="sm" onClick={() => setMapping(row)}>
                          {row.state === 'unmapped' ? t('mapCta') : t('remapCta')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </QueryState>

      {mapping && (
        <SealedSetMappingModal row={mapping} onClose={() => setMapping(null)} />
      )}
    </section>
  );
}
