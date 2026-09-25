'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getAdminVaultPhysicalInventory } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Skeleton';
import { MasterSetPanel } from '@/components/master-set/MasterSetPanel';
import { SealedVaultPanel } from '@/components/domain/SealedVaultPanel';
import { PhysicalInventoryPanel, physicalInventoryQueryKey } from './PhysicalInventoryPanel';

/** Pestañas del detalle: «Cartas» (master set) · «Sellado» · «Qué debe haber» (§36.11, tercera). */
export type VaultDetailTab = 'cards' | 'sealed' | 'physical';
const TABS: VaultDetailTab[] = ['cards', 'sealed', 'physical'];

export function parseVaultDetailTab(raw: string | string[] | undefined): VaultDetailTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'sealed' || v === 'physical' ? v : 'cards';
}

/**
 * Detalle de la bóveda de un cliente (`/admin/vaults/<userId>`, H-6). Las tres pestañas son
 * lectura pura.
 *
 * ⭐ **La cabecera lee `owner` de `GET /admin/vaults/:userId/physical-inventory`** — la MISMA consulta
 * (misma clave) que la pestaña «Qué debe haber», así que el nombre de la cabecera y el de la pestaña
 * **salen del mismo dato**: una voz para la misma persona (H-1). El contrato lo permite
 * (`§M4-VAULT.12` H-6: `master-sets`, `sealed` y `physical-inventory` traen `owner` con el mismo `404`).
 */
export function VaultDetailView({ userId, initialTab }: { userId: string; initialTab: VaultDetailTab }) {
  const t = useTranslations('admin.vaults');
  const tName = useTranslations('admin.m4.prep.vault.nameMissing');
  const [tab, setTab] = useState<VaultDetailTab>(initialTab);

  const physical = useQuery({
    queryKey: physicalInventoryQueryKey(userId),
    queryFn: () => getAdminVaultPhysicalInventory(userId),
  });
  const owner = physical.data?.owner;
  const name = owner?.name?.trim() ? owner.name.trim() : null;
  const notFound = physical.error instanceof ApiClientError && physical.error.status === 404;

  function selectTab(next: VaultDetailTab) {
    setTab(next);
    // La pestaña vive en la URL (se comparte y sobrevive a recargar). `replaceState`: cambiar de
    // pestaña no es una navegación nueva en el historial. Next sincroniza su router con esto.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }

  const back = (
    <Link
      href="/admin/vaults"
      className="inline-flex min-h-[44px] items-center gap-1 text-[10px] font-medium uppercase tracking-label text-text hover:text-accent focus-visible:shadow-focus focus-visible:outline-none"
    >
      <ChevronLeft size={18} aria-hidden /> {t('back')}
    </Link>
  );

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Banner variant="danger" role="alert" title={t('physical.notFound')}>
          {null}
        </Banner>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {back}
        {physical.isLoading ? (
          <Skeleton className="h-8 w-56" />
        ) : owner ? (
          <div className="flex flex-col" data-testid="vault-detail-owner">
            {/* H-1: sin nombre ⇒ la marca de §36.4 ocupa el titular, y el correo lo desempata. */}
            {name !== null ? (
              <h1 className="text-h1 font-bold">{name}</h1>
            ) : (
              <h1 className="font-mono text-sm uppercase tracking-[0.06em] text-accent">{tName('tag')}</h1>
            )}
            <span className="break-all font-mono text-xs text-text">{owner.email}</span>
          </div>
        ) : null}
      </div>

      <div
        className="flex gap-5 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label={name ?? (owner ? `${tName('tag')} · ${owner.email}` : undefined)}
      >
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => selectTab(key)}
            className={`-mb-px min-h-[44px] shrink-0 border-b-2 px-1 pb-3 text-sm focus-visible:shadow-focus focus-visible:outline-none ${
              tab === key ? 'border-primary text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t(`detailTabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'cards' && <MasterSetPanel mode="user_vault_admin" userId={userId} />}
      {tab === 'sealed' && <SealedVaultPanel mode="admin" userId={userId} />}
      {tab === 'physical' && <PhysicalInventoryPanel userId={userId} />}
    </div>
  );
}
