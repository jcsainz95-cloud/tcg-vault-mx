'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, DownloadCloud, Layers, Zap } from 'lucide-react';
import type { RemoteSetDTO } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowMoreMenu, SyncProgress, isEndpointMissing } from './shared';
import type { CatalogSync } from './useCatalogSync';

/**
 * Secciones 6 / §19 — los TRES grupos de sync de catálogo: DATOS (rápido · solo TCGCSV, §19.2),
 * CATÁLOGO (cartas nuevas · pokemontcg.io, §19.3) y AVANZADO (colapsable, §19.1/§19.9), más la
 * tabla ÚNICA de sets (§19.1) con su jerarquía por-fila I→G→H y sus modales de confirmación
 * (re-sync forzado, refresh-variants-all). El estado y la serialización (`catalogBusy`/`batchBusy`,
 * keep-alive, invalidaciones) viven en `useCatalogSync` compartido con la Sección 1 de precios.
 */
export function CatalogSyncSection({ catalog }: { catalog: CatalogSync }) {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const getError = useErrorMessage();

  const {
    remoteSets,
    syncStatus,
    isSweeping,
    refreshVariantsStatus,
    batchRunning,
    batchBusy,
    catalogBusy,
    catalogSyncMutation,
    backfillMutation,
    syncAllMutation,
    syncAllForceMutation,
    fullSyncPhase,
    fullSyncMutation,
    refreshVariantsMutation,
    refreshVariantsAllMutation,
  } = catalog;

  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [refreshAllConfirmOpen, setRefreshAllConfirmOpen] = useState(false);

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
      // §19.4: jerarquía por-fila = I (primaria · Datos/TCGCSV) → G (secundaria · Catálogo) → H
      // (overflow AVANZADO en el menú «Más ▾»). I refresca variantes+precios solo-TCGCSV (reparación
      // segura, no depende de pokemontcg.io). G importa/re-sincroniza cartas (pokemontcg.io). H
      // encadena cartas + precios del set (pesado, roto sin pokemontcg.io) → escondido en el menú.
      // Se serializan entre sí (una operación por-set a la vez) y con el batch global (RV-ALL).
      render: (s) => {
        const rowFullSyncing = fullSyncMutation.isPending && fullSyncMutation.variables?.id === s.id;
        const rowSyncing = catalogSyncMutation.isPending && catalogSyncMutation.variables === s.id;
        const rowRefreshing =
          refreshVariantsMutation.isPending && refreshVariantsMutation.variables?.id === s.id;
        const otherPerSetPending =
          (catalogSyncMutation.isPending && !rowSyncing) ||
          (fullSyncMutation.isPending && !rowFullSyncing) ||
          (refreshVariantsMutation.isPending && !rowRefreshing) ||
          batchBusy;
        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* I — PRIMARIA (Datos · solo TCGCSV). Requiere el set YA importado (si no, el backend
                responde SET_NOT_IMPORTED) → deshabilitada con el motivo en title + aria-describedby. */}
            <Button
              size="sm"
              variant="secondary"
              loading={rowRefreshing}
              disabled={
                !s.imported ||
                otherPerSetPending ||
                catalogSyncMutation.isPending ||
                fullSyncMutation.isPending
              }
              aria-label={t('catalog.refreshVariantsAria', { name: s.name })}
              aria-describedby={!s.imported ? 'm2-reason-needs-import' : undefined}
              title={!s.imported ? t('catalog.refreshVariantsNeedsImport') : undefined}
              onClick={() => refreshVariantsMutation.mutate(s)}
            >
              <RefreshCw size={14} aria-hidden /> {t('catalog.refreshVariantsShort')}
            </Button>
            {/* G — SECUNDARIA (Catálogo · pokemontcg.io): importa/re-sincroniza cartas. */}
            <Button
              size="sm"
              variant="secondary"
              loading={rowSyncing}
              disabled={otherPerSetPending || refreshVariantsMutation.isPending || fullSyncMutation.isPending}
              onClick={() => catalogSyncMutation.mutate(s.id)}
            >
              {s.imported ? t('catalog.resync') : t('catalog.import')}
            </Button>
            {/* H — AVANZADA en overflow: «Sync completo» (cartas + precios del set). */}
            <RowMoreMenu
              triggerLabel={t('catalog.rowMoreAria', { name: s.name })}
              disabled={
                otherPerSetPending || catalogSyncMutation.isPending || refreshVariantsMutation.isPending
              }
            >
              {(closeMenu) => (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={t('catalog.fullSyncAria', { name: s.name })}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text hover:bg-border/40"
                  onClick={() => {
                    closeMenu();
                    fullSyncMutation.mutate(s);
                  }}
                >
                  <Zap size={14} aria-hidden /> {t('catalog.fullSyncMenuItem')}
                </button>
              )}
            </RowMoreMenu>
          </div>
        );
      },
    },
  ];

  return (
    <>
      {/* Motivos de deshabilitado (§19.9): descritos por aria-describedby, no solo por color/title. */}
      <span id="m2-reason-needs-import" className="sr-only">{t('catalog.refreshVariantsNeedsImport')}</span>
      <span id="m2-reason-busy" className="sr-only">{t('catalog.busyReason')}</span>

      {/* ═══ GRUPO 1 · DATOS (rápido · TCGCSV) — §19.2 ═══
          Máximo peso tras A: repuebla variantes/acabados + precios desde TCGCSV, FUNCIONAN SIEMPRE
          aunque pokemontcg.io esté caída. F es global; I es la acción PRIMARIA por-fila (en la tabla). */}
      <section
        role="group"
        aria-labelledby="m2-group-data"
        className="flex flex-col gap-3 border-t border-border pt-8"
      >
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{t('groups.data.eyebrow')}</p>
          <h2 id="m2-group-data" className="text-h2 font-semibold">{t('groups.data.title')}</h2>
          <p className="text-sm text-muted">{t('groups.data.subtitle')}</p>
        </div>
        {/* F global — «Refrescar variantes + precios (todo)», solo TCGCSV. Masivo → confirmación. El
            «(solo TCGCSV)» ya no va en el botón: lo dice el subtítulo del grupo (§19.2). */}
        <div>
          <Button
            variant="secondary"
            loading={batchBusy}
            disabled={catalogBusy && !batchBusy}
            aria-describedby={catalogBusy && !batchBusy ? 'm2-reason-busy' : undefined}
            title={catalogBusy && !batchBusy ? t('catalog.busyReason') : undefined}
            onClick={() => setRefreshAllConfirmOpen(true)}
          >
            <RefreshCw size={18} aria-hidden /> {t('catalog.refreshVariantsAllShort')}
          </Button>
        </div>
        {/* RV-ALL: banner "corriendo" + barra de progreso (poll del STATUS PROPIO) + resumen agregado. */}
        {batchBusy && (
          <Banner variant="info" role="status">{t('catalog.refreshVariantsAllRunning')}</Banner>
        )}
        {refreshVariantsStatus.data &&
          (refreshVariantsStatus.data.running || refreshVariantsStatus.data.total > 0) && (
            <SyncProgress
              running={refreshVariantsStatus.data.running}
              done={refreshVariantsStatus.data.done}
              total={refreshVariantsStatus.data.total}
              labels={{
                running: t('catalog.refreshVariantsAllSweepRunning', {
                  done: Math.min(refreshVariantsStatus.data.done, refreshVariantsStatus.data.total),
                  total: refreshVariantsStatus.data.total,
                }),
                runningHint: t('catalog.refreshVariantsAllSweepRunningHint'),
                done: t('catalog.refreshVariantsAllSweepDone', { total: refreshVariantsStatus.data.total }),
              }}
            />
          )}
        {!batchRunning &&
          refreshVariantsStatus.data?.summary &&
          (() => {
            const r = refreshVariantsStatus.data!.summary!;
            const partial = r.setsFailed > 0 || r.pending > 0;
            return (
              <Banner variant={partial ? 'warning' : 'success'} role="status">
                <span className="font-medium">
                  {partial
                    ? t('catalog.refreshVariantsAllPartial')
                    : t('catalog.refreshVariantsAllDone')}
                </span>{' '}
                {t('catalog.refreshVariantsAllSummary', {
                  setsOk: r.setsOk,
                  setsTotal: r.setsTotal,
                  products: r.cardProductsUpserted,
                  prices: r.pricesUpserted,
                })}
                {r.pending > 0 && ' ' + t('catalog.refreshVariantsAllPending', { pending: r.pending })}
                {r.failures.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    <p className="font-medium">
                      {t('catalog.refreshVariantsAllFailuresTitle', { count: r.setsFailed })}
                    </p>
                    <ul className="list-disc pl-5">
                      {r.failures.map((f) => {
                        const name = remoteSets.data?.find((s) => s.id === f.setId)?.name ?? f.setId;
                        return (
                          <li key={f.setId}>
                            <span lang="en" className="font-medium">{name}</span>{' '}
                            <span className="tabular text-muted">({f.setId})</span> —{' '}
                            {f.message || f.code}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Banner>
            );
          })()}
        {refreshVariantsAllMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {t('catalog.refreshVariantsAllError')} {getError(refreshVariantsAllMutation.error)}
          </Banner>
        )}

        {/* Tabla de sets ÚNICA (§19.1), anclada al grupo Datos: su acción por-fila PRIMARIA es I. */}
        <QueryState
          isLoading={remoteSets.isLoading}
          isError={remoteSets.isError}
          error={remoteSets.error}
          onRetry={() => remoteSets.refetch()}
        >
          {remoteSets.data &&
            (remoteSets.data.length > 0 ? (
              <div className="rounded-lg border border-border bg-surface p-2">
                <DataTable columns={setColumns} rows={remoteSets.data} rowKey={(s) => s.id} />
              </div>
            ) : (
              <EmptyState title={t('catalog.setsEmpty')} />
            ))}
        </QueryState>

        {/* Feedback de las acciones POR-FILA disparadas desde la tabla (visibles junto a ella): I
            (solo TCGCSV) y H (Sync completo, aunque su disparador viva en el menú «Más»). */}
        {refreshVariantsMutation.isPending && (
          <Banner variant="info" role="status">
            {t('catalog.refreshVariantsRunning', { name: refreshVariantsMutation.variables?.name ?? '' })}
          </Banner>
        )}
        {refreshVariantsMutation.isSuccess &&
          (() => {
            const r = refreshVariantsMutation.data;
            const name = refreshVariantsMutation.variables?.name ?? '';
            const partial = !r.tcgcsvReachable || r.pending > 0;
            const summary = t('catalog.refreshVariantsSummary', {
              cards: r.cardsProcessed,
              products: r.cardProductsUpserted,
              prices: r.pricesUpserted,
            });
            return (
              <Banner variant={partial ? 'warning' : 'success'} role="status">
                <span className="font-medium">
                  {partial
                    ? t('catalog.refreshVariantsPartial', { name })
                    : t('catalog.refreshVariantsDone', { name })}
                </span>{' '}
                {summary}
                {!r.tcgcsvReachable && ' ' + t('catalog.refreshVariantsUnreachable')}
                {r.pending > 0 && ' ' + t('catalog.refreshVariantsPending', { pending: r.pending })}
              </Banner>
            );
          })()}
        {refreshVariantsMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {t('catalog.refreshVariantsError', { name: refreshVariantsMutation.variables?.name ?? '' })}{' '}
            {getError(refreshVariantsMutation.error)}
          </Banner>
        )}
        {/* H (Sync completo): feedback HONESTO por fase (cartas → precios), junto a la tabla. */}
        {fullSyncMutation.isPending && (
          <Banner variant="info" role="status">
            {fullSyncPhase === 'prices'
              ? t('catalog.fullSyncPhasePrices', { name: fullSyncMutation.variables?.name ?? '' })
              : t('catalog.fullSyncPhaseCatalog', { name: fullSyncMutation.variables?.name ?? '' })}
          </Banner>
        )}
        {fullSyncMutation.isSuccess &&
          (fullSyncMutation.data.ingest.enqueued ? (
            <Banner variant="success" role="status">
              {t('catalog.fullSyncDone', { name: fullSyncMutation.variables?.name ?? '' })}
            </Banner>
          ) : (
            <Banner variant="warning" role="status">
              {t('catalog.fullSyncPricesAlreadyRunning', { name: fullSyncMutation.variables?.name ?? '' })}
            </Banner>
          ))}
        {fullSyncMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {fullSyncPhase === 'prices'
              ? t('catalog.fullSyncPricesError', { name: fullSyncMutation.variables?.name ?? '' })
              : t('catalog.fullSyncCatalogError', { name: fullSyncMutation.variables?.name ?? '' })}{' '}
            {getError(fullSyncMutation.error)}
          </Banner>
        )}
      </section>

      {/* ═══ GRUPO 2 · CATÁLOGO (cartas nuevas · usa fuente de catálogo) — §19.3 ═══
          Único camino para CREAR cartas nuevas (importa desde pokemontcg.io) → se de-enfatiza y se
          marca su dependencia externa con un banner persistente. D y C son globales; G es por-fila. */}
      <section
        role="group"
        aria-labelledby="m2-group-catalog"
        className="flex flex-col gap-3 border-t border-border pt-8"
      >
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{t('groups.catalog.eyebrow')}</p>
          <h2 id="m2-group-catalog" className="text-h2 font-semibold">{t('groups.catalog.title')}</h2>
          <p className="text-sm text-muted">{t('groups.catalog.subtitle')}</p>
        </div>
        {/* Aviso de dependencia PERSISTENTE (§19.3): no es un error, es contexto (role=status). */}
        <Banner variant="info" role="status">{t('groups.catalog.sourceWarning')}</Banner>
        <div className="flex flex-wrap gap-2">
          {/* D — Importar sets nuevos (pokemontcg.io, incremental, sin confirmación). */}
          <Button
            variant="secondary"
            loading={syncAllMutation.isPending}
            disabled={batchBusy}
            aria-describedby={batchBusy ? 'm2-reason-busy' : undefined}
            title={batchBusy ? t('catalog.busyReason') : undefined}
            onClick={() => syncAllMutation.mutate()}
          >
            <Layers size={18} aria-hidden /> {t('catalog.syncAll')}
          </Button>
          {/* C — Backfill (siguiente lote, incremental). */}
          <Button
            variant="secondary"
            loading={backfillMutation.isPending}
            disabled={batchBusy}
            aria-describedby={batchBusy ? 'm2-reason-busy' : undefined}
            title={batchBusy ? t('catalog.busyReason') : undefined}
            onClick={() => backfillMutation.mutate()}
          >
            <DownloadCloud size={18} aria-hidden /> {t('catalog.backfill')}
          </Button>
        </div>
        {/* Barra de progreso del barrido de catálogo (sync-all / force), poll cada 3 s. */}
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
        {/* G (Importar / Re-sincronizar por-fila): feedback. */}
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
        {/* D — feedback (barrido encolado / nada por importar). */}
        {syncAllMutation.isSuccess && !isSweeping && (
          <Banner variant="info" role="status">
            {syncAllMutation.data.setsQueued > 0
              ? t('catalog.syncAllQueued', { count: syncAllMutation.data.setsQueued })
              : t('catalog.syncAllNothing')}
          </Banner>
        )}
        {/* Degradación ante fuente caída (§19.3): 404/405 → warning que REENCAMINA a Datos. */}
        {syncAllMutation.isError &&
          (isEndpointMissing(syncAllMutation.error) ? (
            <Banner variant="warning" role="status">
              {t('catalog.syncAllUnavailable')} {t('groups.catalog.sourceDownReroute')}
            </Banner>
          ) : (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(syncAllMutation.error)}</Banner>
          ))}
        {/* C — feedback. */}
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
      </section>

      {/* ═══ GRUPO 3 · AVANZADO — §19.1/§19.9 ═══
          Colapsable NATIVO (<details>) plegado por defecto: operaciones pesadas y raras (E global;
          H vive en el menú «Más» por-fila). No invita a usarlas por default. */}
      <details className="group border-t border-border pt-8">
        <summary className="cursor-pointer text-h2 font-semibold marker:text-muted">
          {t('groups.advanced.summary')}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted">{t('groups.advanced.subtitle')}</p>
          {/* E — Re-sincronizar todo (forzar): pesada → confirmación obligatoria. */}
          <div>
            <Button
              variant="secondary"
              loading={syncAllForceMutation.isPending}
              disabled={batchBusy}
              aria-describedby={batchBusy ? 'm2-reason-busy' : undefined}
              title={batchBusy ? t('catalog.busyReason') : undefined}
              onClick={() => setForceConfirmOpen(true)}
            >
              <RefreshCw size={18} aria-hidden /> {t('catalog.syncAllForce')}
            </Button>
          </div>
          {syncAllForceMutation.isSuccess && !isSweeping && (
            <Banner variant="info" role="status">
              {syncAllForceMutation.data.setsQueued > 0
                ? t('catalog.syncAllQueued', { count: syncAllForceMutation.data.setsQueued })
                : t('catalog.syncAllNothing')}
            </Banner>
          )}
          {syncAllForceMutation.isError &&
            (isEndpointMissing(syncAllForceMutation.error) ? (
              <Banner variant="warning" role="status">
                {t('catalog.syncAllUnavailable')} {t('groups.catalog.sourceDownReroute')}
              </Banner>
            ) : (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(syncAllForceMutation.error)}</Banner>
            ))}
        </div>
      </details>

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

      {/* RV-ALL: confirmación del batch «Refrescar variantes + precios de TODO (solo TCGCSV)» (masivo) */}
      <Modal
        open={refreshAllConfirmOpen}
        onClose={() => setRefreshAllConfirmOpen(false)}
        title={t('catalog.refreshVariantsAllConfirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefreshAllConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={refreshVariantsAllMutation.isPending}
              onClick={() => {
                setRefreshAllConfirmOpen(false);
                refreshVariantsAllMutation.mutate();
              }}
            >
              {t('catalog.refreshVariantsAllConfirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('catalog.refreshVariantsAllConfirmBody')}</p>
      </Modal>
    </>
  );
}
