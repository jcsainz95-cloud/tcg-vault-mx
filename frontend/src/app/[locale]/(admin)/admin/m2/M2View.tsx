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
  getBuylistRarities,
  updateBuylistRules,
  getRemoteSets,
  syncCatalog,
  backfillCatalog,
  syncAllCatalog,
  getSyncStatus,
} from '@/lib/api';
import type {
  PendingPriceEntryDTO,
  RemoteSetDTO,
  BuylistRule,
  BuylistRuleMode,
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
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { ApiClientError } from '@/lib/api-client';

const RULE_MODES: BuylistRuleMode[] = ['fixed', 'pct'];

/** Convierte pesos (texto) a centavos enteros. */
function pesosToCents(value: string): number {
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * El endpoint `sync-all` puede no existir aún en el backend (contrato v1.3, condicional).
 * Un 404/405 se trata como "no disponible" (warning); cualquier otro error real (rate limit,
 * timeout, 5xx) se muestra como error con su código/mensaje.
 */
function isEndpointMissing(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 405);
}

/**
 * Barra de progreso del barrido de catálogo (sync-all). Mientras corre pinta done/total en
 * SETS y avisa —honestamente— que sigue en segundo plano; al terminar muestra el éxito.
 * `role="status"` + `aria-live` para que un lector de pantalla anuncie el avance.
 */
function SyncProgress({
  running,
  done,
  total,
  labels,
}: {
  running: boolean;
  done: number;
  total: number;
  labels: { running: string; runningHint: string; done: string };
}) {
  const pct = total > 0 ? Math.min(100, Math.round((Math.min(done, total) / total) * 100)) : 0;
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{running ? labels.running : labels.done}</span>
        {running && <span className="tabular text-muted">{pct}%</span>}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className={`h-full rounded-full transition-all ${running ? 'bg-accent' : 'bg-success'}`}
          style={{ width: `${running ? pct : 100}%` }}
        />
      </div>
      {running && <p className="text-xs text-muted">{labels.runningHint}</p>}
    </div>
  );
}

export function M2View() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

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
        // v1.8: la cola es POR ACABADO — sin `finish` el backend defaultea `normal` y el
        // pendiente real (p. ej. holofoil) quedaría abierto.
        finish: entry.finish,
        priceMxnCents: pesosToCents(overridePriceValue),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
      setOverrideTarget(null);
      setOverridePriceValue('');
    },
  });

  const pendingColumns: Column<PendingPriceEntryDTO>[] = [
    {
      key: 'card',
      header: t('pending.card'),
      render: (e) => (
        <span lang="en">
          {e.cardName ?? e.card?.name ?? e.cardId}
          {e.card?.number ? <span className="tabular text-muted"> #{e.card.number}</span> : null}
        </span>
      ),
    },
    { key: 'type', header: t('pending.type'), render: (e) => e.productType },
    { key: 'gradeKey', header: t('pending.gradeKey'), render: (e) => <span className="tabular">{e.gradeKey}</span> },
    {
      key: 'finish',
      header: t('pending.finish'),
      render: (e) => <FinishBadge finish={e.finish} productType={e.productType} />,
    },
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

  // --- Sección 4: precio de buylist por RAREZA (v1.3.1) ---
  const rarities = useQuery({ queryKey: ['buylist-rarities'], queryFn: getBuylistRarities });
  // Borrador de reglas explícitas editadas por el admin (por rareza) + fallback editado.
  const [ruleDraft, setRuleDraft] = useState<Record<string, BuylistRule>>({});
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null);
  const rulesMutation = useMutation({
    mutationFn: (payload: { rules: Record<string, BuylistRule>; fallbackPct: number }) =>
      updateBuylistRules(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buylist-rarities'] });
      setRuleDraft({});
      setFallbackDraft(null);
    },
  });

  const serverFallback = rarities.data?.fallbackPct ?? 40;
  const effectiveFallback = fallbackDraft ?? String(serverFallback);
  // Regla efectiva mostrada por fila: borrador > regla explícita del servidor > fallback.
  function effectiveRule(rarity: string, serverRule: BuylistRule, source: 'rule' | 'fallback'): BuylistRule {
    if (ruleDraft[rarity]) return ruleDraft[rarity];
    if (source === 'rule') return serverRule;
    return { mode: 'pct', value: Number(effectiveFallback) || 0 };
  }
  const rulesDirty =
    Object.keys(ruleDraft).length > 0 ||
    (fallbackDraft != null && fallbackDraft !== String(serverFallback));

  function saveRules() {
    if (!rarities.data) return;
    // Preserva las reglas explícitas del servidor y aplica el borrador encima. Las
    // rarezas dejadas en fallback (no editadas) NO se incluyen → siguen en fallback.
    const serverRules: Record<string, BuylistRule> = {};
    for (const row of rarities.data.rarities) if (row.source === 'rule') serverRules[row.rarity] = row.rule;
    rulesMutation.mutate({
      rules: { ...serverRules, ...ruleDraft },
      fallbackPct: Number(effectiveFallback) || 0,
    });
  }

  // --- Sección 5: sync de catálogo ---
  // Estado del barrido `sync-all` (GET /admin/catalog/sync-status). Se POLLEA cada 3 s
  // mientras `running` para saber en vivo cuántos sets faltan y CUÁNDO terminó (lo que
  // pedía el operador: "saber que acabó"). El endpoint puede no existir aún en backend
  // (404/405): en ese caso no se pinta la barra (retry:false + isError → nada). No llama
  // a pokemontcg.io, así que pollearlo no consume rate-limit.
  const syncStatus = useQuery({
    queryKey: ['catalog-sync-status'],
    queryFn: getSyncStatus,
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const isSweeping = syncStatus.data?.running ?? false;

  // Mientras hay un barrido en curso, refresca la tabla (cardCount/imported avanzan solos).
  const remoteSets = useQuery({
    queryKey: ['remote-sets'],
    queryFn: getRemoteSets,
    refetchInterval: isSweeping ? 5000 : false,
  });
  const catalogSyncMutation = useMutation({
    mutationFn: (setId?: string) => syncCatalog(setId ? { setId } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  const backfillMutation = useMutation({
    mutationFn: () => backfillCatalog({ batchSize: 10 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  // Tras lanzar un barrido (sync-all / force), arranca de inmediato el poll del estado
  // (invalida la query) y refresca la tabla; el barrido corre en segundo plano en backend.
  const onSweepLaunched = () => {
    qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
    qc.invalidateQueries({ queryKey: ['remote-sets'] });
  };
  // v1.3: sync-all puede no existir en backend; se usa condicionalmente y su fallo
  // no rompe la vista (se muestra aviso). Ver contrato §M2.
  const syncAllMutation = useMutation({
    mutationFn: () => syncAllCatalog(),
    onSuccess: onSweepLaunched,
  });
  // v1.6-finish: re-sync FORZADO (contrato §M2, `force=true`): reprocesa TODO el
  // catálogo (incluidos sets ya importados) para repoblar availableFinishes/precios
  // por acabado tras M-18. Es operación pesada → confirmación previa (modal).
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const syncAllForceMutation = useMutation({
    mutationFn: () => syncAllCatalog({ force: true }),
    onSuccess: onSweepLaunched,
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
    {
      key: 'cardCount',
      header: t('catalog.cardCount'),
      align: 'right',
      // Progreso por set: cartas importadas / total impreso del set. Si no hay printedTotal
      // (dato remoto ausente) se muestra solo el conteo. Da una noción de "cuánto trajo".
      render: (s) => (
        <span className="tabular">
          {s.cardCount}
          {s.printedTotal ? <span className="text-muted"> / {s.printedTotal}</span> : null}
        </span>
      ),
    },
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
        {syncMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(syncMutation.error)}</Banner>
        )}
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
              {(fxUpdateMutation.isSuccess || fxRefreshMutation.isSuccess) && (
                <Banner variant="success" role="status">{t('fx.saved')}</Banner>
              )}
              {fxUpdateMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(fxUpdateMutation.error)}</Banner>
              )}
              {fxRefreshMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(fxRefreshMutation.error)}</Banner>
              )}
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 4: precio de buylist por RAREZA (v1.3.1) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('buylistRules.title')}</h2>
        <p className="text-sm text-muted">{t('buylistRules.subtitle')}</p>
        <QueryState
          isLoading={rarities.isLoading}
          isError={rarities.isError}
          error={rarities.error}
          onRetry={() => rarities.refetch()}
        >
          {rarities.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              {/* Fallback % para rarezas sin regla explícita */}
              <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
                <Input
                  label={t('buylistRules.fallbackLabel')}
                  type="text"
                  inputMode="decimal"
                  suffix="%"
                  className="w-32"
                  value={effectiveFallback}
                  onChange={(e) => setFallbackDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                />
                <p className="text-xs text-muted">{t('buylistRules.fallbackHint')}</p>
              </div>

              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto_auto]">
                  <span>{t('buylistRules.rarity')}</span>
                  <span className="text-right">{t('buylistRules.cardCount')}</span>
                  <span>{t('buylistRules.mode')}</span>
                  <span>{t('buylistRules.value')}</span>
                  <span>{t('buylistRules.source')}</span>
                </li>
                {rarities.data.rarities.map((row) => {
                  const rule = effectiveRule(row.rarity, row.rule, row.source);
                  const edited = !!ruleDraft[row.rarity];
                  const effectiveSource: 'rule' | 'fallback' = edited ? 'rule' : row.source;
                  return (
                    <li
                      key={row.rarity}
                      className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto_auto]"
                    >
                      <span className="text-sm font-medium" lang="en">{row.rarity}</span>
                      <span className="tabular text-right text-sm text-muted">{row.cardCount}</span>
                      <Select
                        label={t('buylistRules.mode')}
                        aria-label={t('buylistRules.modeFor', { rarity: row.rarity })}
                        className="w-32"
                        options={RULE_MODES.map((m) => ({ value: m, label: t(`buylistRules.modeLabel.${m}`) }))}
                        value={rule.mode}
                        onChange={(e) => {
                          const mode = e.target.value as BuylistRuleMode;
                          setRuleDraft((prev) => ({ ...prev, [row.rarity]: { mode, value: rule.value } }));
                        }}
                      />
                      <Input
                        label={rule.mode === 'fixed' ? t('buylistRules.valueMxn') : t('buylistRules.valuePct')}
                        aria-label={t('buylistRules.valueFor', { rarity: row.rarity })}
                        type="text"
                        inputMode="decimal"
                        prefix={rule.mode === 'fixed' ? 'MX$' : undefined}
                        suffix={rule.mode === 'pct' ? '%' : undefined}
                        className="w-32"
                        value={rule.mode === 'fixed' ? String(rule.value / 100) : String(rule.value)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9.]/g, '');
                          const value = rule.mode === 'fixed' ? pesosToCents(raw) : Number(raw) || 0;
                          setRuleDraft((prev) => ({ ...prev, [row.rarity]: { mode: rule.mode, value } }));
                        }}
                      />
                      <Badge tone={effectiveSource === 'rule' ? 'info' : 'neutral'} shape="outline">
                        {t(`buylistRules.sourceLabel.${effectiveSource}`)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={!rulesDirty}
                  loading={rulesMutation.isPending}
                  onClick={saveRules}
                >
                  {tc('save')}
                </Button>
                {rulesDirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRuleDraft({});
                      setFallbackDraft(null);
                    }}
                  >
                    {tc('cancel')}
                  </Button>
                )}
              </div>
              {rulesMutation.isSuccess && (
                <Banner variant="success" role="status">{t('buylistRules.saved')}</Banner>
              )}
              {rulesMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(rulesMutation.error)}</Banner>
              )}
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 5: sync de catálogo */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('catalog.title')}</h2>
        <p className="text-sm text-muted">{t('catalog.subtitle')}</p>
        <p className="text-xs text-muted">{t('catalog.syncHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={backfillMutation.isPending} onClick={() => backfillMutation.mutate()}>
            <DownloadCloud size={18} /> {t('catalog.backfill')}
          </Button>
          <Button variant="secondary" loading={syncAllMutation.isPending} onClick={() => syncAllMutation.mutate()}>
            <Layers size={18} /> {t('catalog.syncAll')}
          </Button>
          <Button
            variant="secondary"
            loading={syncAllForceMutation.isPending}
            onClick={() => setForceConfirmOpen(true)}
          >
            <RefreshCw size={18} /> {t('catalog.syncAllForce')}
          </Button>
        </div>
        {/* Feedback del sync por set (Importar / Re-sincronizar) */}
        {catalogSyncMutation.isPending && (
          <Banner variant="info" role="status">{t('catalog.syncRunning')}</Banner>
        )}
        {catalogSyncMutation.isSuccess && (
          <Banner variant="success" role="status">
            {t('catalog.syncDone', {
              count: catalogSyncMutation.data.setsQueued,
              jobId: catalogSyncMutation.data.jobId,
            })}
          </Banner>
        )}
        {catalogSyncMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(catalogSyncMutation.error)}</Banner>
        )}
        {backfillMutation.isSuccess && (
          <Banner variant="success" role="status">
            {t('catalog.backfillDone', {
              count: backfillMutation.data.imported.length,
              remaining: backfillMutation.data.remaining,
            })}
          </Banner>
        )}
        {backfillMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(backfillMutation.error)}</Banner>
        )}
        {/* Barrido lanzado: NO decimos "listo" (corre en segundo plano). Si setsQueued=0 y
            no hay barrido corriendo, significa que ya estaba todo importado (o single-flight). */}
        {syncAllMutation.isSuccess && !isSweeping && (
          <Banner variant="info" role="status">
            {syncAllMutation.data.setsQueued > 0
              ? t('catalog.syncAllQueued', { count: syncAllMutation.data.setsQueued })
              : t('catalog.syncAllNothing')}
          </Banner>
        )}
        {syncAllMutation.isError &&
          (isEndpointMissing(syncAllMutation.error) ? (
            <Banner variant="warning" role="status">{t('catalog.syncAllUnavailable')}</Banner>
          ) : (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(syncAllMutation.error)}</Banner>
          ))}
        {syncAllForceMutation.isSuccess && !isSweeping && (
          <Banner variant="info" role="status">
            {syncAllForceMutation.data.setsQueued > 0
              ? t('catalog.syncAllQueued', { count: syncAllForceMutation.data.setsQueued })
              : t('catalog.syncAllNothing')}
          </Banner>
        )}
        {syncAllForceMutation.isError &&
          (isEndpointMissing(syncAllForceMutation.error) ? (
            <Banner variant="warning" role="status">{t('catalog.syncAllUnavailable')}</Banner>
          ) : (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(syncAllForceMutation.error)}</Banner>
          ))}

        {/* Estado del barrido en curso / recién terminado (GET /sync-status, poll cada 3 s). */}
        {syncStatus.data && (syncStatus.data.running || syncStatus.data.total > 0) && (
          <SyncProgress
            running={syncStatus.data.running}
            done={syncStatus.data.done}
            total={syncStatus.data.total}
            labels={{
              running: t('catalog.sweepRunning', {
                done: Math.min(syncStatus.data.done, syncStatus.data.total),
                total: syncStatus.data.total,
              }),
              runningHint: t('catalog.sweepRunningHint'),
              done: t('catalog.sweepDone', { total: syncStatus.data.total }),
            }}
          />
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
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span lang="en" className="font-medium text-text">
                {overrideTarget.cardName ?? overrideTarget.card?.name ?? overrideTarget.cardId}
              </span>
              <span className="tabular">{overrideTarget.gradeKey}</span>
              {/* El override fija el precio de ESTE acabado (v1.8: cola por acabado). */}
              <FinishBadge finish={overrideTarget.finish} productType={overrideTarget.productType} />
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
          {overrideMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(overrideMutation.error)}</Banner>
          )}
        </div>
      </Modal>

      {/* Confirmación del re-sync forzado (operación pesada, contrato §M2 force=true) */}
      <Modal
        open={forceConfirmOpen}
        onClose={() => setForceConfirmOpen(false)}
        title={t('catalog.syncAllForceConfirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForceConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={syncAllForceMutation.isPending}
              onClick={() => {
                setForceConfirmOpen(false);
                syncAllForceMutation.mutate();
              }}
            >
              {t('catalog.syncAllForceConfirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('catalog.syncAllForceConfirmBody')}</p>
      </Modal>
    </div>
  );
}
