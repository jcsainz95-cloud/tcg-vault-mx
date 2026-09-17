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
 * M11 · Sellado (§diseño §1) — pantalla CONSOLIDADA de 4 secciones. Regla de oro: **reubica y expone
 * superficie existente; no reimplementa lógica de dinero.**
 *
 *  - (i) Alta de sellado + (ii) Inventario/ventana de publicación: `vault_operator+`, reusando
 *    `SealedTab` TAL CUAL (que ya monta `SealedAddFlow`/`QuickAdd` para el alta y agrupa por
 *    presentación) y `VariantDrawer` con `productType:'sealed'` para editar/publicar/despublicar.
 *  - (iii) Cola «Listas para publicar» filtrada a `sealed`: reusa `PendingPublishQueue` con el
 *    `?productType=` que el endpoint ya acepta.
 *  - (iv) Panel de los 6 diales de precio del sellado + botón «Traer precios ahora» + mapeo manual:
 *    `super_admin`, gateado DENTRO de la vista con `SuperAdminOnly` (el operador ve el candado ahí,
 *    y sigue usando i/ii/iii). La vista de estado por set (§10) es `vault_operator+`.
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

      {/* Secciones (i) + (ii): alta e inventario de sellado (reusa SealedTab + VariantDrawer). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('inventory.title')}</h2>
        <p className="text-sm text-muted">{t('inventory.subtitle')}</p>
        <SealedTab
          onOpenGroup={openSealedGroup}
          onToast={(msg) => pushToast({ variant: 'success', title: t('title'), message: msg })}
        />
      </section>

      {/* Sección de estado por set (§10) — `vault_operator+`, lee estado persistido (sin TCGCSV). */}
      <SealedPriceStatusSection />

      {/* Sección (iii): cola «Listas para publicar» FILTRADA a sellado. */}
      <section className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold">{t('queue.title')}</h2>
        <p className="text-sm text-muted">{t('queue.subtitle')}</p>
        <PendingPublishQueue productType="sealed" />
      </section>

      {/* Sección (iv): diales de precio del sellado + traer precios + mapeo manual. `super_admin`. */}
      <section className="flex flex-col gap-3" aria-label={t('dials.title')}>
        <h2 className="text-h2 font-semibold">{t('dials.title')}</h2>
        <SuperAdminOnly>
          <SealedDialsPanel onChanged={invalidateAggregates} />
        </SuperAdminOnly>
      </section>

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
