'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getVaultSealed, getAdminVaultSealed } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import type { VaultSealedGroupDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { CardImage } from '@/components/ui/CardImage';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';

export interface SealedVaultPanelProps {
  /** `self` = mi bóveda (GET /vault/sealed); `admin` = bóveda de un cliente (requiere userId). */
  mode: 'self' | 'admin';
  userId?: string;
}

const ROW =
  'grid grid-cols-[52px_1fr_auto] items-center gap-4 lg:grid-cols-[64px_2fr_1fr_1fr_1fr] lg:gap-5';

/**
 * Pestaña «Sellado» de la bóveda (contrato §3 · GET /vault/sealed y §M1 · GET
 * /admin/vaults/:userId/sealed). Agrupa las piezas selladas del usuario por producto+condición con
 * imagen, condición, cantidad y valor de mercado actual. Lectura pura (sin acciones); piezas sin
 * mercado se marcan «precio pendiente» y se excluyen del total.
 */
export function SealedVaultPanel({ mode, userId }: SealedVaultPanelProps) {
  const t = useTranslations('sealed.vault');
  const locale = useLocale() as AppLocale;

  const query = useQuery({
    queryKey: mode === 'self' ? ['vault-sealed'] : ['admin-vault-sealed', userId],
    queryFn: () => (mode === 'self' ? getVaultSealed() : getAdminVaultSealed(userId!)),
    enabled: mode === 'self' || !!userId,
  });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data &&
        (query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <div>
            {/* Total valuado a mercado (misma base del portafolio, §3) + conteo de precio pendiente. */}
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border py-6">
              <div>
                <div className="eyebrow">{t('totalValue')}</div>
                <div className="tabular mt-2.5 text-2xl font-medium leading-none text-text">
                  {formatMoneyCents(query.data.totalValueMxnCents, locale)}
                </div>
              </div>
              {query.data.pendingPriceCount > 0 && (
                <p className="font-mono text-[11px] text-accent">
                  {t('pendingPrice', { count: query.data.pendingPriceCount })}
                </p>
              )}
            </div>

            {/* Cabecera de columnas (lg+). */}
            <div className={`${ROW} hidden border-b border-border py-4 lg:grid`}>
              <span />
              <span className="eyebrow">{t('productColumn')}</span>
              <span className="eyebrow">{t('conditionColumn')}</span>
              <span className="eyebrow">{t('countColumn')}</span>
              <span className="eyebrow">{t('marketValueColumn')}</span>
            </div>

            {query.data.data.map((g) => (
              <SealedRow key={rowKey(g)} group={g} locale={locale} />
            ))}

            <p className="mt-5 font-mono text-xs text-muted">{t('valuationNote')}</p>
          </div>
        ))}
    </QueryState>
  );
}

function rowKey(g: VaultSealedGroupDTO): string {
  return `${g.card.id}-${g.sealedSubtype ?? 'none'}-${g.sealedCondition}`;
}

function SealedRow({ group, locale }: { group: VaultSealedGroupDTO; locale: AppLocale }) {
  const t = useTranslations('sealed.vault');
  const tSub = useTranslations('status.sealedSubtype');
  const tSealed = useTranslations('sealed');
  const priced = group.marketValue.status === 'priced' && group.marketValue.referenceMxnCents != null;
  return (
    <div className={`${ROW} border-b border-border py-4`}>
      <CardImage src={group.imageUrl ?? undefined} alt={group.productName} className="p-1" />

      <div className="min-w-0">
        <p className="truncate font-serif text-base font-medium leading-tight text-text" lang="en">
          {group.productName}
        </p>
        <p className="mt-1.5 font-mono text-[11px] text-muted" lang="en">
          {group.card.setName}
        </p>
        {/* En móvil: condición, cantidad y valor viajan bajo el nombre. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted lg:hidden">
          <span>{group.sealedSubtype ? tSub(group.sealedSubtype) : tSealed('badge')}</span>
          <span>· {tSealed(`condition.${group.sealedCondition}`)}</span>
          <span>· {t('countValue', { count: group.count })}</span>
          <span>
            ·{' '}
            {group.totalMarketValueMxnCents != null
              ? formatMoneyCents(group.totalMarketValueMxnCents, locale)
              : t('pendingLabel')}
          </span>
        </div>
      </div>

      {/* Condición (lg+): badge «Sellado» + subtipo + condición. */}
      <span className="hidden flex-wrap items-center gap-x-2 font-mono text-[11px] uppercase tracking-[0.06em] lg:flex">
        <Badge tone="info" shape="soft">
          {tSealed('badge')}
        </Badge>
        {group.sealedSubtype && <span className="text-muted">{tSub(group.sealedSubtype)}</span>}
        <span className={group.sealedCondition === 'mint' ? 'text-success' : 'text-accent'}>
          {tSealed(`condition.${group.sealedCondition}`)}
        </span>
      </span>

      <span className="tabular hidden font-mono text-sm text-muted lg:block">
        {t('countValue', { count: group.count })}
      </span>

      <span className="tabular hidden text-base font-medium text-text lg:block">
        {priced ? (
          formatMoneyCents(group.totalMarketValueMxnCents!, locale)
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
            {t('pendingLabel')}
          </span>
        )}
      </span>
    </div>
  );
}
