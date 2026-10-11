'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import {
  getSealedPriceStatus,
  getSettings,
  updateSettings,
  triggerSealedPriceIngest,
} from '@/lib/api';
import type { SealedPriceStatusRowDTO } from '@/types/contract';
import { useRole } from '@/lib/role';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { SealedSetMappingModal } from './SealedSetMappingModal';

/**
 * Estado HONESTO de un set, medido sobre los conteos por-producto que el DTO ya trae
 * (`priced`/`productCount`), NO sobre el rollup del peor producto (`row.state`).
 *
 * El rollup pintaba de rojo «SIN PRECIO» un set con 22 de 23 productos preciados (defecto del
 * dueño, 2026-09-17). Aquí la alarma se reserva a los sets que de verdad NO traen precio:
 *  - `complete` → todos los productos con precio (verde, tranquilo).
 *  - `partial`  → la mayoría con precio pero le faltan algunos (verde/neutro + nota suave; NO rojo).
 *  - `none`     → 0 productos con precio: o no está conectado (`unmapped`) o la fuente no trajo nada.
 */
type SetCompletion = 'complete' | 'partial' | 'none';

function completionOf(row: SealedPriceStatusRowDTO): SetCompletion {
  if (row.productCount > 0 && row.priced >= row.productCount) return 'complete';
  if (row.priced > 0) return 'partial';
  return 'none';
}

/** Tono del badge según el estado HONESTO: con precio o casi = éxito; solo el 0/N alarma. */
function toneOf(row: SealedPriceStatusRowDTO): 'success' | 'warning' | 'accent' {
  const c = completionOf(row);
  if (c === 'complete' || c === 'partial') return 'success';
  return row.state === 'unmapped' ? 'accent' : 'warning';
}

/**
 * §diseño §2/§3 (capa 2) — «Precios de mercado de la colección». Un solo bloque primario:
 *
 *  1. **Un botón** «Actualizar precios de la colección» (`super_admin`, D-2). En un clic: si la
 *     fuente automática está apagada la enciende (con UNA confirmación de dinero en llano, §3.1),
 *     trae precios (`POST /admin/jobs/sealed-price-ingest`, awaited) y relee el estado.
 *  2. **La foto en llano** del estado, contando PRODUCTOS (no sets): «26 productos con precio · 6
 *     pendientes». NO promete un delta de «cuántos cambiaron»: la respuesta del job no trae conteos
 *     (contrato §M11), así que se pinta el estado ACTUAL leído del §10.
 *  3. **La lista corta de sets POR COMPLETAR** (los que no están 100% preciados) reusando los
 *     conteos por-producto del DTO: un set casi listo muestra «22 de 23 con precio» + nota suave y
 *     «Completar este set»; solo el 0/N muestra su motivo y «Arreglar este set» (`super_admin`),
 *     que abre el mapeo re-rotulado (`SealedSetMappingModal`).
 *  4. **El desglose completo por set** plegado en «Ver desglose por set» para quien audite, con el
 *     estado HONESTO (`completionOf`/`toneOf`), no el rollup del peor producto.
 *
 * La foto y el desglose los ve `vault_operator+` (read-only); el botón, «Completar» y «Arreglar»
 * son `super_admin` (actos de dinero; el backend además 403ea). Lee estado PERSISTIDO (O-17 safe).
 *
 * §honesto (defecto del dueño 2026-09-17): el rollup `row.state` es el PEOR producto y pintaba de
 * rojo «CONECTADO, SIN PRECIO» un set con 22/23 preciados. Aquí solo cambia la PRESENTACIÓN: se
 * reusan `priced`/`productCount` del DTO (motor y endpoints intactos) para clasificar por
 * completitud real y reservar la alarma a los sets que de verdad no traen ningún precio.
 */
export function SealedPriceStatusSection({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations('admin.m11.collection');
  const tReason = useTranslations('admin.m11.collection.reason');
  const tStatus = useTranslations('admin.m11.status');
  const tState = useTranslations('admin.m11.status.state');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const { isSuperAdmin } = useRole();

  const [mapping, setMapping] = useState<SealedPriceStatusRowDTO | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<'done' | 'inFlight' | null>(null);

  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const status = useQuery({
    queryKey: ['sealed-price-status'],
    queryFn: () => getSealedPriceStatus(),
  });

  const sourceOn = settings.data?.sealedPriceSource === 'tcgcsv';
  const rows = status.data?.data ?? [];
  // La foto cuenta PRODUCTOS, no sets (el DTO trae `priced`/`productCount` por set): un set con 22
  // de 23 aporta 22 al «con precio» y 1 al «pendiente», en vez de contar el set entero como fallido.
  const productsPriced = rows.reduce((sum, r) => sum + r.priced, 0);
  const productsPending = rows.reduce((sum, r) => sum + Math.max(0, r.productCount - r.priced), 0);
  // «Por completar» = todo lo que no está 100% preciado (partial + none), no «sin precio».
  const incompleteRows = rows.filter((r) => completionOf(r) !== 'complete');

  // El botón único (§3): enciende la fuente si hace falta, trae precios y relee. La respuesta (202)
  // NO trae conteos; la foto sale de releer el estado por set.
  const refresh = useMutation({
    mutationFn: async () => {
      if (!sourceOn) await updateSettings({ sealedPriceSource: 'tcgcsv' });
      return triggerSealedPriceIngest();
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      if (res.enqueued) {
        setResult('done');
        qc.invalidateQueries({ queryKey: ['sealed-price-status'] });
        onChanged?.();
      } else {
        // `enqueued:false` sin `reason` ⇒ ya hay una corrida en marcha (single-flight).
        setResult('inFlight');
      }
    },
  });

  function onRefreshClick() {
    setResult(null);
    if (sourceOn) refresh.mutate();
    else setConfirming(true);
  }

  return (
    <section className="flex flex-col gap-4" aria-label={t('title')}>
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold">{t('title')}</h2>
        <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-primary/40 bg-surface p-4">
        <QueryState
          isLoading={status.isLoading || settings.isLoading}
          isError={status.isError}
          error={status.error}
          onRetry={() => status.refetch()}
        >
          {status.data && (
            <>
              {/* La foto en llano del estado actual (siempre visible, también para el operario). */}
              {rows.length === 0 ? (
                <EmptyState title={tStatus('empty')} />
              ) : (
                <p className="text-sm text-text">
                  {t('photo', { priced: productsPriced, pending: productsPending })}
                </p>
              )}

              {/* El botón único — solo `super_admin` (acto de dinero, D-2). */}
              {isSuperAdmin && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    loading={refresh.isPending}
                    disabled={refresh.isPending}
                    onClick={onRefreshClick}
                  >
                    <RefreshCw size={16} /> {t('refreshCta')}
                  </Button>
                  {refresh.isPending && (
                    <span className="text-xs text-muted">{t('refreshing')}</span>
                  )}
                </div>
              )}

              {/* Resultado en llano tras pulsar. */}
              {result === 'done' && (
                <Banner variant="success" role="status" title={t('doneLabel')}>
                  {t('photo', { priced: productsPriced, pending: productsPending })}
                </Banner>
              )}
              {result === 'inFlight' && (
                <Banner variant="info" role="status">{t('inFlight')}</Banner>
              )}
              {refresh.isError && (
                <Banner
                  variant="danger"
                  role="alert"
                  title={tc('errorTitle')}
                  action={
                    <Button size="sm" variant="secondary" onClick={onRefreshClick}>
                      {t('errorRetry')}
                    </Button>
                  }
                >
                  {getError(refresh.error)}
                </Banner>
              )}

              {/* Lista corta de sets POR COMPLETAR (condicional): aparece SOLO si hay alguno. El
                  encuadre es «completar los que faltan», no «roto»: un set casi listo muestra
                  «X de Y con precio» + la nota suave; solo el 0/N muestra su motivo en llano. */}
              {incompleteRows.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-text">
                    {t('fixTitle', { count: incompleteRows.length })}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {incompleteRows.map((row) => {
                      const partial = completionOf(row) === 'partial';
                      return (
                        <li
                          key={row.set.id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span className="text-sm text-text">
                            <span lang="en" className="font-medium">{row.set.name}</span>
                            {partial ? (
                              <span className="text-muted">
                                {' · '}
                                {t('setProgress', { priced: row.priced, total: row.productCount })}
                                {' · '}
                                {t('missingNote', { count: row.productCount - row.priced })}
                              </span>
                            ) : (
                              row.reason && (
                                <span className="text-muted"> · {tReason(row.reason)}</span>
                              )
                            )}
                          </span>
                          {isSuperAdmin && (
                            <Button variant="secondary" size="sm" onClick={() => setMapping(row)}>
                              {partial ? t('completeCta') : t('fixCta')}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Desglose completo por set — plegado, para quien audite (§diseño §2.2/D-5). */}
              <details className="border-t border-border pt-4 text-sm">
                <summary className="cursor-pointer text-muted">{t('breakdownToggle')}</summary>
                {rows.length > 0 && (
                  <table className="mt-3 w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">{tStatus('colSet')}</th>
                        <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">{tStatus('colState')}</th>
                        <th scope="col" className="eyebrow px-3 py-2 text-right font-normal">{tStatus('colBreakdown')}</th>
                        <th scope="col" className="eyebrow px-3 py-2 text-left font-normal">{tStatus('colWhy')}</th>
                        <th scope="col" className="eyebrow px-3 py-2 text-right font-normal" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const comp = completionOf(row);
                        // Rótulo del estado, honesto: casi listo ⇒ «X de Y con precio» (no rojo).
                        const stateLabel =
                          comp === 'partial'
                            ? t('setProgress', { priced: row.priced, total: row.productCount })
                            : comp === 'complete'
                              ? tState('priced')
                              : row.state === 'unmapped'
                                ? tState('unmapped')
                                : tState('mapped_unpriced');
                        return (
                          <tr key={row.set.id} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-3 align-top text-sm text-text">
                              <span lang="en" className="font-medium">{row.set.name}</span>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <Badge tone={toneOf(row)} shape="outline">
                                {stateLabel}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 align-top text-right">
                              <span className="font-mono tabular-nums text-xs text-muted">
                                {tStatus('breakdown', {
                                  priced: row.priced,
                                  mapped: row.mappedUnpriced,
                                  unmapped: row.unmapped,
                                })}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-top text-sm text-muted">
                              {comp !== 'complete' && row.reason ? tReason(row.reason) : '—'}
                            </td>
                            <td className="px-3 py-3 align-top text-right">
                              {isSuperAdmin && comp !== 'complete' && (
                                <Button variant="secondary" size="sm" onClick={() => setMapping(row)}>
                                  {comp === 'partial' ? t('completeCta') : t('fixCta')}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </details>
            </>
          )}
        </QueryState>
      </div>

      {/* Confirmación de dinero en llano — solo la 1.ª vez, cuando la fuente hay que encenderla (§3.1). */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('confirm.title')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={refresh.isPending}
              onClick={() => {
                setConfirming(false);
                refresh.mutate();
              }}
            >
              {t('confirm.cta')}
            </Button>
          </>
        }
      >
        <p>{t('confirm.body')}</p>
      </Modal>

      {mapping && <SealedSetMappingModal row={mapping} onClose={() => setMapping(null)} />}
    </section>
  );
}
