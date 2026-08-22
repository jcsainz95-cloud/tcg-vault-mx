'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, Package } from 'lucide-react';
import {
  getSealedInventorySets,
  getSealedInventorySet,
  getAdminInventory,
  bulkPublishItems,
} from '@/lib/api';
import type {
  InventoryItemDTO,
  SealedInventoryGroupDTO,
  SealedSetSummaryDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Link } from '@/i18n/navigation';
import { localUid } from '@/components/master-set/capture';
import { QuickAddSection } from './QuickAdd';
import { SealedAddFlow } from './SealedAddFlow';

/**
 * Pestaña «Sellado» — P-25 (DESIGN_SYSTEM §16.8). Índice por set → detalle con GRUPOS de
 * producto sellado (identidad §4.23). Alta rápida = MISMO QuickAdd P-19 (la aportación usa
 * `sealedMarketRef`; su ausencia deshabilita la tarjeta). SIN consola P-18 (el sellado conserva
 * su cadena H-1: solo precio manual por pieza). La cola de no-mapeados es `super_admin` (M2);
 * para vault_operator el grupo sin mapeo se lee como «SIN PRECIO DE MERCADO».
 */
export interface SealedTabProps {
  onOpenGroup: (setId: string, group: SealedInventoryGroupDTO) => void;
  onToast?: (msg: string) => void;
}

export function SealedTab({ onOpenGroup, onToast }: SealedTabProps) {
  const t = useTranslations('admin.inventory.sealedTab');
  const tAdd = useTranslations('admin.sealedAdd');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useRole();
  const [q, setQ] = useState('');
  const [openSet, setOpenSet] = useState<SealedSetSummaryDTO | null>(null);
  // P-35 (§16.8a): estado del flujo dedicado de alta de sellado. `presetSet` precarga el set cuando
  // se dispara desde el detalle («Agregar otra presentación»), saltando el selector.
  const [addFlow, setAddFlow] = useState<{ open: boolean; presetSet: { id: string; name: string } | null }>({
    open: false,
    presetSet: null,
  });

  const sets = useQuery({
    queryKey: ['sealed-sets', q],
    queryFn: () => getSealedInventorySets({ q: q.trim() || undefined }),
  });

  function refreshAfterAdd() {
    void queryClient.invalidateQueries({ queryKey: ['sealed-sets'] });
    void queryClient.invalidateQueries({ queryKey: ['sealed-set-detail'] });
  }

  const flow = addFlow.open ? (
    <SealedAddFlow
      open
      presetSet={addFlow.presetSet}
      onClose={() => setAddFlow({ open: false, presetSet: null })}
      onToast={onToast}
      onCreated={refreshAfterAdd}
    />
  ) : null;

  if (openSet) {
    return (
      <>
        <SealedSetDetail
          summary={openSet}
          onBack={() => setOpenSet(null)}
          onOpenGroup={onOpenGroup}
          onToast={onToast}
          onAddPresentation={() =>
            setAddFlow({ open: true, presetSet: { id: openSet.set.id, name: openSet.set.name } })
          }
        />
        {flow}
      </>
    );
  }

  const columns: Column<SealedSetSummaryDTO>[] = [
    {
      key: 'set',
      header: t('colSet'),
      render: (s) => (
        <button
          type="button"
          className="text-left hover:text-accent"
          onClick={() => setOpenSet(s)}
        >
          <span lang="en" className="font-medium">
            {s.set.name}
          </span>
          <span className="ml-2 font-mono text-xs text-muted">{s.set.id}</span>
        </button>
      ),
    },
    { key: 'pieces', header: t('colPieces'), align: 'right', render: (s) => <span className="tabular">{s.pieceCount}</span> },
    { key: 'listed', header: t('colListed'), align: 'right', render: (s) => <span className="tabular">{s.listedCount}</span> },
    {
      key: 'value',
      header: t('colValue'),
      align: 'right',
      render: (s) => (
        <span className="font-mono tabular-nums">
          {s.marketValueMxnCents != null ? formatMoneyCents(s.marketValueMxnCents, locale) : '—'}
        </span>
      ),
    },
    {
      key: 'unmapped',
      header: '',
      align: 'right',
      render: (s) =>
        s.unmappedCount > 0 ? (
          <span className="border border-accent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
            {t('unmappedBadge', { count: s.unmappedCount })}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input
          label={t('search')}
          className="w-64"
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex items-center gap-3">
          {/* Cola de no-mapeados: curación super_admin (M2). vault_operator no ve el enlace. */}
          {isSuperAdmin && sets.data && sets.data.unmappedTotal > 0 && (
            <Link
              href="/admin/m2"
              className="border-b border-accent pb-1 text-xs text-accent hover:text-text"
            >
              {t('unmappedQueue', { count: sets.data.unmappedTotal })}
            </Link>
          )}
          {/* P-35 (§16.8a): camino PRINCIPAL de alta de sellado — el flujo dedicado, NO el buscador
              de cartas. Siempre visible, no depende de que exista inventario. */}
          <Button onClick={() => setAddFlow({ open: true, presetSet: null })}>
            {tAdd('cta')}
          </Button>
        </div>
      </div>
      <QueryState
        isLoading={sets.isLoading}
        isError={sets.isError}
        error={sets.error}
        onRetry={() => sets.refetch()}
      >
        {sets.data &&
          (sets.data.data.length === 0 ? (
            <EmptyState
              title={t('emptyTitle')}
              body={tAdd('emptyBody')}
              action={
                <Button onClick={() => setAddFlow({ open: true, presetSet: null })}>
                  {tAdd('cta')}
                </Button>
              }
            />
          ) : (
            <DataTable columns={columns} rows={sets.data.data} rowKey={(s) => s.set.id} />
          ))}
      </QueryState>
      {flow}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalle de set: grupos con alta rápida / ver piezas / publicar.
// ---------------------------------------------------------------------------

function SealedSetDetail({
  summary,
  onBack,
  onOpenGroup,
  onToast,
  onAddPresentation,
}: {
  summary: SealedSetSummaryDTO;
  onBack: () => void;
  onOpenGroup: (setId: string, group: SealedInventoryGroupDTO) => void;
  onToast?: (msg: string) => void;
  onAddPresentation?: () => void;
}) {
  const t = useTranslations('admin.inventory.sealedTab');
  const tAdd = useTranslations('admin.sealedAdd');
  const tSub = useTranslations('status.sealedSubtype');
  const tCond = useTranslations('status.sealedCondition');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const errorMessage = useErrorMessage();
  const [quickAddKey, setQuickAddKey] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['sealed-set-detail', summary.set.id],
    queryFn: () => getSealedInventorySet(summary.set.id),
  });

  // Publicar por grupo = bulk-publish de sus folios in_stock (identidad recortada en cliente).
  // M-2 (fix): batchKey ESTABLE por sesión de publicación — useRef REAL (un objeto literal se
  // recrea por render y la idempotencia prometida no existe). Solo se limpia al ÉXITO; el
  // reintento tras error reusa la clave y el backend replayea idempotente.
  const publishKeyRef = useRef<string | null>(null);
  const publishGroup = useMutation({
    mutationFn: async (group: SealedInventoryGroupDTO) => {
      // M-2 (fix): pagina server-side hasta AGOTAR la carta (pageSize máx 100 del contrato).
      // Antes se pedía UNA página de 100 y se publicaba el subconjunto reportándolo como el
      // grupo completo — dinero deshonesto.
      const all: InventoryItemDTO[] = [];
      let page = 1;
      for (;;) {
        const res = await getAdminInventory({
          cardId: group.cardId,
          productType: 'sealed',
          ownerType: 'platform',
          page,
          pageSize: 100,
        });
        all.push(...res.data);
        if (res.data.length === 0 || all.length >= res.total) break;
        page += 1;
      }
      const ids = all
        .filter(
          (i) =>
            i.status === 'in_stock' &&
            (i.sealedSubtype ?? null) === group.sealedSubtype &&
            (i.sealedCondition ?? 'mint') === group.sealedCondition,
        )
        .map((i) => i.id);
      if (ids.length === 0) return null;
      if (publishKeyRef.current === null) publishKeyRef.current = localUid('pubsealed');
      // bulk-publish capea 200 líneas por request (contrato §M1): trozos con sufijo
      // DETERMINISTA sobre la misma clave base para conservar la idempotencia por trozo.
      let published = 0;
      let failedLines = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const res = await bulkPublishItems({
          batchKey: `${publishKeyRef.current}-${i / 200}`,
          items: ids.slice(i, i + 200).map((inventoryItemId) => ({ inventoryItemId })),
        });
        published += res.summary.published;
        failedLines += res.summary.failedLines;
      }
      return { published, failedLines };
    },
    onSuccess: (res) => {
      publishKeyRef.current = null;
      if (res) {
        onToast?.(
          t('publishGroupResult', { published: res.published, failed: res.failedLines }),
        );
      } else {
        onToast?.(t('publishGroupNone'));
      }
      void detail.refetch();
    },
  });

  const groupKey = (g: SealedInventoryGroupDTO) =>
    `${g.cardId}|${g.sealedSubtype ?? ''}|${g.sealedCondition}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('backToSets')}>
          <ChevronLeft size={18} /> {t('backToSets')}
        </Button>
        <h2 lang="en" className="text-h2">
          {summary.set.name}
        </h2>
        {onAddPresentation && (
          <Button size="sm" className="ml-auto" onClick={onAddPresentation}>
            {tAdd('addAnother')}
          </Button>
        )}
      </div>
      <QueryState
        isLoading={detail.isLoading}
        isError={detail.isError}
        error={detail.error}
        onRetry={() => detail.refetch()}
      >
        {detail.data && (
          <ul className="flex flex-col">
            {detail.data.groups.map((g) => {
              const ref = g.mapped ? g.sealedMarketRef?.referenceMxnCents ?? null : null;
              return (
                <li key={groupKey(g)} className="flex flex-col border-b border-border py-3">
                  <div className="flex min-h-[56px] flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="flex h-12 w-12 items-center justify-center bg-surface-2 text-muted">
                      <Package size={20} aria-hidden />
                    </span>
                    <span lang="en" className="min-w-0 flex-1 font-medium text-text">
                      {g.productName}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                      {t('sealedPill')}
                      {g.sealedSubtype ? ` · ${tSub(g.sealedSubtype)}` : ''}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text">
                      {tCond(g.sealedCondition)}
                    </span>
                    <span className="font-mono tabular-nums text-xs text-muted">
                      {t('groupCounts', { inStock: g.counts.inStock, listed: g.counts.listed })}
                    </span>
                    {ref != null ? (
                      <span className="font-mono tabular-nums text-sm text-text">
                        {formatMoneyCents(ref, locale)}
                      </span>
                    ) : (
                      <span className="border border-accent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                        {t('noMarket')}
                      </span>
                    )}
                    {isSuperAdmin && g.totalCostCents != null && (
                      <span className="font-mono tabular-nums text-xs text-muted">
                        {t('groupCost', { amount: formatMoneyCents(g.totalCostCents, locale) })}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-expanded={quickAddKey === groupKey(g)}
                      onClick={() => setQuickAddKey((k) => (k === groupKey(g) ? null : groupKey(g)))}
                    >
                      {t('quickAdd')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onOpenGroup(summary.set.id, g)}>
                      {t('viewPieces')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={publishGroup.isPending}
                      disabled={publishGroup.isPending || g.counts.inStock === 0}
                      onClick={() => publishGroup.mutate(g)}
                    >
                      {t('publishGroup')}
                    </Button>
                  </div>
                  {quickAddKey === groupKey(g) && (
                    <div className="mt-3 border border-border p-3">
                      <QuickAddSection
                        target={{
                          cardId: g.cardId,
                          productType: 'sealed',
                          finish: 'normal',
                          sealedSubtype: g.sealedSubtype,
                          sealedCondition: g.sealedCondition,
                        }}
                        buyEffectiveCents={null}
                        buySource={null}
                        marketRefCents={ref}
                        onToast={onToast}
                        onCreated={() => void detail.refetch()}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      {publishGroup.isError && (
        <Banner variant="danger" role="alert">
          {errorMessage(publishGroup.error)}
        </Banner>
      )}
    </div>
  );
}
