'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getLocations } from '@/lib/api';
import type {
  Finish,
  ProductType,
  SealedCondition,
  SealedInventoryGroupDTO,
  SealedSubtype,
} from '@/types/contract';
import { Toaster, useToasts } from '@/components/ui/Toast';
import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { SealedTab } from '../m1/SealedTab';
import { VariantDrawer } from '../m1/VariantDrawer';
import { PendingPublishQueue } from '../m1/PendingPublishQueue';
import { SealedPriceStatusSection } from './sections/SealedPriceStatusSection';
import { SealedDialsPanel } from './sections/SealedDialsPanel';

/**
 * §diseño §1/§2 — pantalla «Sellado» reordenada en TRES CAPAS por cómo se USA, no por cómo se
 * construyó. Regla de oro: **reubica y re-rotula superficie existente; no reimplementa lógica de
 * dinero ni toca endpoints/permisos.**
 *
 *  - **Capa 1 · Inventario de sellado (primario, arriba):** alta + inventario (`SealedTab` +
 *    `VariantDrawer`) y la cola «Listas para publicar» (`PendingPublishQueue?productType=sealed`).
 *    `vault_operator+` — el trabajo diario del operario, sin candado.
 *  - **Capa 2 · Precios de mercado de la colección (un botón):** `SealedPriceStatusSection`, que
 *    trae precios en un clic, pinta la foto en llano y lista los sets a arreglar. El botón es
 *    `super_admin` (acto de dinero, D-2); la foto la ve el operario.
 *  - **Capa 3 · Ajustes avanzados (plegado, `super_admin`):** la plomería (`SealedDialsPanel`:
 *    fuente automática, cómo se calculan los precios, márgenes) en UN acordeón cerrado por defecto.
 */
interface SealedDrawerState {
  cardId: string;
  cardName: string;
  cardNumber: string;
  finish: Finish;
  productType: ProductType;
  sealedSubtype?: SealedSubtype | null;
  sealedCondition?: SealedCondition;
  marketRefCents?: number | null;
}

export function M11View() {
  const t = useTranslations('admin.m11');
  const queryClient = useQueryClient();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const [drawer, setDrawer] = useState<SealedDrawerState | null>(null);

  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  function invalidateAggregates() {
    void queryClient.invalidateQueries({ queryKey: ['sealed-sets'] });
    void queryClient.invalidateQueries({ queryKey: ['sealed-set-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['pending-publish'] });
    void queryClient.invalidateQueries({ queryKey: ['sealed-price-status'] });
  }

  function openSealedGroup(_setId: string, group: SealedInventoryGroupDTO) {
    setDrawer({
      cardId: group.cardId,
      cardName: group.productName,
      cardNumber: '',
      finish: 'normal',
      productType: 'sealed',
      sealedSubtype: group.sealedSubtype,
      sealedCondition: group.sealedCondition,
      marketRefCents: group.sealedMarketRef?.referenceMxnCents ?? null,
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <Toaster toasts={toasts} onDismiss={dismissToast} />

      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
      </div>

      {/* ── Capa 1 · Inventario de sellado (alta + inventario) ──────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('inventory.title')}</h2>
        <p className="text-sm text-muted">{t('inventory.subtitle')}</p>
        <SealedTab
          onOpenGroup={openSealedGroup}
          onToast={(msg) => pushToast({ variant: 'success', title: t('title'), message: msg })}
        />
      </section>

      {/* ── Capa 1 · Cola «Listas para publicar» FILTRADA a sellado (junto al inventario). ── */}
      <section className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold">{t('queue.title')}</h2>
        <p className="text-sm text-muted">{t('queue.subtitle')}</p>
        <PendingPublishQueue productType="sealed" />
      </section>

      {/* ── Capa 2 · Precios de mercado de la colección (el botón único + la foto). ──────── */}
      <SealedPriceStatusSection onChanged={invalidateAggregates} />

      {/* ── Capa 3 · Ajustes avanzados — acordeón PLEGADO por defecto, `super_admin`. ────── */}
      <details className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <summary className="cursor-pointer text-h2 font-semibold">{t('advanced.title')}</summary>
        <p className="mt-1 max-w-[70ch] text-sm text-muted">{t('advanced.subtitle')}</p>
        <div className="mt-4">
          <SuperAdminOnly>
            <SealedDialsPanel onChanged={invalidateAggregates} />
          </SuperAdminOnly>
        </div>
      </details>

      {/* Drill-down por variante (editar/publicar/despublicar/formato/precio por pieza de sellado). */}
      {drawer && (
        <VariantDrawer
          {...drawer}
          locations={locations.data ?? []}
          onClose={() => setDrawer(null)}
          onChanged={invalidateAggregates}
          onToast={(msg) => pushToast({ variant: 'success', title: t('title'), message: msg })}
        />
      )}
    </div>
  );
}
