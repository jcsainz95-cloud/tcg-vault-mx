'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw, DownloadCloud, Layers } from 'lucide-react';
import {
  syncPricing,
  getPendingPrices,
  overridePrice,
  getFx,
  updateFx,
  refreshFx,
  getRarityMap,
  updateRarityMap,
  getRemoteSets,
  syncCatalog,
  backfillCatalog,
  syncAllCatalog,
} from '@/lib/api';
import type {
  PendingPriceEntryDTO,
  RarityMapEntryDTO,
  RemoteSetDTO,
  BuylistCategory,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';

const CATEGORIES: BuylistCategory[] = ['comun', 'reverse_holo', 'ex_plus'];

/** Convierte pesos (texto) a centavos enteros. */
function pesosToCents(value: string): number {
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function M2View() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const tcat = useTranslations('buylist.categoryLabel');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();

  // --- Sección 1: sync de precios de bóveda ---
  const syncMutation = useMutation({
    mutationFn: () => syncPricing({ scope: 'all_vault' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-prices'] }),
  });

  // --- Sección 2: cola de precio pendiente + override ---
  const pending = useQuery({ queryKey: ['pending-prices'], queryFn: getPendingPrices });
  const [overrideTarget, setOverrideTarget] = useState<PendingPriceEntryDTO | null>(null);
  const [overridePriceValue, setOverridePriceValue] = useState('');
  const overrideMutation = useMutation({
    mutationFn: (entry: PendingPriceEntryDTO) =>
      overridePrice({
        cardId: entry.cardId,
        productType: entry.productType,
        gradeKey: entry.gradeKey,
        priceMxnCents: pesosToCents(overridePriceValue),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
      setOverrideTarget(null);
      setOverridePriceValue('');
    },
  });

  const pendingColumns: Column<PendingPriceEntryDTO>[] = [
    { key: 'card', header: t('pending.card'), render: (e) => <span lang="en">{e.cardName ?? e.cardId}</span> },
    { key: 'type', header: t('pending.type'), render: (e) => e.productType },
    { key: 'gradeKey', header: t('pending.gradeKey'), render: (e) => <span className="tabular">{e.gradeKey}</span> },
    { key: 'context', header: t('pending.context'), render: (e) => <Badge tone="warning" shape="outline">{e.context}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <Button size="sm" variant="secondary" onClick={() => { setOverrideTarget(e); setOverridePriceValue(''); }}>
          {t('pending.setPrice')}
        </Button>
      ),
    },
  ];

  // --- Sección 3: FX ---
  const fx = useQuery({ queryKey: ['admin-fx'], queryFn: getFx });
  const [fxRate, setFxRate] = useState('');
  const [fxBuffer, setFxBuffer] = useState('');
  const fxUpdateMutation = useMutation({
    mutationFn: () => updateFx({ rate: Number(fxRate), bufferPct: Number(fxBuffer) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fx'] }),
  });
  const fxRefreshMutation = useMutation({
    mutationFn: refreshFx,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fx'] }),
  });

  // --- Sección 4: rareza → categoría ---
  const rarityMap = useQuery({ queryKey: ['rarity-map'], queryFn: getRarityMap });
  const [draftMap, setDraftMap] = useState<RarityMapEntryDTO[] | null>(null);
  const effectiveMap = draftMap ?? rarityMap.data ?? [];
  const rarityMutation = useMutation({
    mutationFn: (entries: RarityMapEntryDTO[]) => updateRarityMap(entries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rarity-map'] });
      setDraftMap(null);
    },
  });

  // --- Sección 5: sync de catálogo ---
  const remoteSets = useQuery({ queryKey: ['remote-sets'], queryFn: getRemoteSets });
  const catalogSyncMutation = useMutation({
    mutationFn: (setId?: string) => syncCatalog(setId ? { setId } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  const backfillMutation = useMutation({
    mutationFn: () => backfillCatalog({ batchSize: 10 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  // v1.3: sync-all puede no existir en backend; se usa condicionalmente y su fallo
  // no rompe la vista (se muestra aviso). Ver contrato §M2.
  const syncAllMutation = useMutation({
    mutationFn: syncAllCatalog,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });

  const setColumns: Column<RemoteSetDTO>[] = [
    { key: 'name', header: t('catalog.set'), render: (s) => <span lang="en">{s.name}</span> },
    { key: 'release', header: t('catalog.releaseDate'), render: (s) => <span className="tabular">{s.releaseDate ?? '—'}</span> },
    {
      key: 'imported',
      header: t('catalog.imported'),
      render: (s) =>
        s.imported ? (
          <Badge tone="success" shape="soft">{t('catalog.yes')}</Badge>
        ) : (
          <Badge tone="neutral" shape="outline">{t('catalog.no')}</Badge>
        ),
    },
    { key: 'cardCount', header: t('catalog.cardCount'), align: 'right', render: (s) => <span className="tabular">{s.cardCount}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <Button
          size="sm"
          variant="secondary"
          loading={catalogSyncMutation.isPending && catalogSyncMutation.variables === s.id}
          onClick={() => catalogSyncMutation.mutate(s.id)}
        >
          {s.imported ? t('catalog.resync') : t('catalog.import')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      {/* Sección 1: sync de precios */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('sync.title')}</h2>
        <p className="text-sm text-muted">{t('sync.subtitle')}</p>
        <div>
          <Button loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
            <RefreshCw size={18} /> {t('sync.launch')}
          </Button>
        </div>
        {syncMutation.isSuccess && (
          <Banner variant="success" role="status">
            {t('sync.queued', { count: syncMutation.data.queued, jobId: syncMutation.data.jobId })}
          </Banner>
        )}
        {syncMutation.isError && <Banner variant="danger" role="alert">{tc('errorGeneric')}</Banner>}
      </section>

      {/* Sección 2: cola de precio pendiente + override */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('pending.title')}</h2>
        <p className="text-sm text-muted">{t('pending.subtitle')}</p>
        <QueryState
          isLoading={pending.isLoading}
          isError={pending.isError}
          error={pending.error}
          onRetry={() => pending.refetch()}
        >
          {pending.data && pending.data.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface p-2">
              <DataTable columns={pendingColumns} rows={pending.data} rowKey={(e) => e.id} />
            </div>
          ) : (
            <EmptyState tone="positive" title={t('pending.empty')} />
          )}
        </QueryState>
      </section>

      {/* Sección 3: FX */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('fx.title')}</h2>
        <QueryState isLoading={fx.isLoading} isError={fx.isError} error={fx.error} onRetry={() => fx.refetch()}>
          {fx.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.rate')}</p>
                  <p className="tabular text-h2 font-semibold">{fx.data.rate.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.buffer')}</p>
                  <p className="tabular text-h2 font-semibold">{fx.data.bufferPct}%</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.source')}</p>
                  <Badge tone={fx.data.source === 'manual' ? 'accent' : 'info'} shape="soft">
                    {t(`fx.sourceLabel.${fx.data.source}`)}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.effectiveDate')}</p>
                  <p className="tabular text-sm">{formatDate(fx.data.effectiveDate, locale)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label={t('fx.newRate')}
                  type="text"
                  inputMode="decimal"
                  className="w-32"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder={String(fx.data.rate)}
                />
                <Input
                  label={t('fx.newBuffer')}
                  type="text"
                  inputMode="decimal"
                  className="w-32"
                  value={fxBuffer}
                  onChange={(e) => setFxBuffer(e.target.value)}
                  placeholder={String(fx.data.bufferPct)}
                />
                <Button
                  variant="secondary"
                  disabled={fxRate === '' || fxBuffer === ''}
                  loading={fxUpdateMutation.isPending}
                  onClick={() => fxUpdateMutation.mutate()}
                >
                  {t('fx.saveOverride')}
                </Button>
                <Button variant="ghost" loading={fxRefreshMutation.isPending} onClick={() => fxRefreshMutation.mutate()}>
                  <RefreshCw size={18} /> {t('fx.refreshBanxico')}
                </Button>
              </div>
              <p className="text-xs text-muted">{t('fx.hint')}</p>
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 4: rareza → categoría */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('rarityMap.title')}</h2>
        <p className="text-sm text-muted">{t('rarityMap.subtitle')}</p>
        <QueryState
          isLoading={rarityMap.isLoading}
          isError={rarityMap.isError}
          error={rarityMap.error}
          onRetry={() => rarityMap.refetch()}
        >
          {rarityMap.data && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <ul className="flex flex-col divide-y divide-border">
                {effectiveMap.map((entry, idx) => (
                  <li key={entry.rarity} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span className="text-sm font-medium" lang="en">{entry.rarity}</span>
                    <Select
                      label={t('rarityMap.category')}
                      className="w-48"
                      options={CATEGORIES.map((c) => ({ value: c, label: tcat(c) }))}
                      value={entry.category}
                      onChange={(e) => {
                        const next = effectiveMap.map((row, i) =>
                          i === idx ? { ...row, category: e.target.value as BuylistCategory } : row,
                        );
                        setDraftMap(next);
                      }}
                    />
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={!draftMap}
                  loading={rarityMutation.isPending}
                  onClick={() => draftMap && rarityMutation.mutate(draftMap)}
                >
                  {tc('save')}
                </Button>
                {draftMap && (
                  <Button variant="ghost" onClick={() => setDraftMap(null)}>
                    {tc('cancel')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 5: sync de catálogo */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('catalog.title')}</h2>
        <p className="text-sm text-muted">{t('catalog.subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={backfillMutation.isPending} onClick={() => backfillMutation.mutate()}>
            <DownloadCloud size={18} /> {t('catalog.backfill')}
          </Button>
          <Button variant="secondary" loading={syncAllMutation.isPending} onClick={() => syncAllMutation.mutate()}>
            <Layers size={18} /> {t('catalog.syncAll')}
          </Button>
        </div>
        {backfillMutation.isSuccess && (
          <Banner variant="success" role="status">
            {t('catalog.backfillDone', {
              count: backfillMutation.data.imported.length,
              remaining: backfillMutation.data.remaining,
            })}
          </Banner>
        )}
        {syncAllMutation.isSuccess && (
          <Banner variant="success" role="status">
            {t('catalog.syncAllDone', { count: syncAllMutation.data.setsQueued })}
          </Banner>
        )}
        {syncAllMutation.isError && (
          <Banner variant="warning" role="status">{t('catalog.syncAllUnavailable')}</Banner>
        )}
        <QueryState
          isLoading={remoteSets.isLoading}
          isError={remoteSets.isError}
          error={remoteSets.error}
          onRetry={() => remoteSets.refetch()}
        >
          {remoteSets.data && (
            <div className="rounded-lg border border-border bg-surface p-2">
              <DataTable columns={setColumns} rows={remoteSets.data} rowKey={(s) => s.id} />
            </div>
          )}
        </QueryState>
      </section>

      {/* Modal de override manual de precio */}
      <Modal
        open={!!overrideTarget}
        onClose={() => setOverrideTarget(null)}
        title={t('pending.overrideTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOverrideTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={overridePriceValue === ''}
              loading={overrideMutation.isPending}
              onClick={() => overrideTarget && overrideMutation.mutate(overrideTarget)}
            >
              {t('pending.saveOverride')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {overrideTarget && (
            <p className="text-sm text-muted">
              <span lang="en" className="font-medium text-text">{overrideTarget.cardName ?? overrideTarget.cardId}</span>
              {' · '}
              <span className="tabular">{overrideTarget.gradeKey}</span>
            </p>
          )}
          <Input
            label={t('pending.priceLabel')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={overridePriceValue}
            onChange={(e) => setOverridePriceValue(e.target.value)}
          />
          {overridePriceValue !== '' && (
            <p className="text-xs text-muted">
              = {formatMoneyCents(pesosToCents(overridePriceValue), locale)}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
