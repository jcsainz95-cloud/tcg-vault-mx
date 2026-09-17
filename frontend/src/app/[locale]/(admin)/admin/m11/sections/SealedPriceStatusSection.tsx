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
import type { SealedPriceState, SealedPriceStatusRowDTO } from '@/types/contract';
import { useRole } from '@/lib/role';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { SealedSetMappingModal } from './SealedSetMappingModal';

/** Tono del badge por estado (solo en el desglose plegable): con precio = éxito, resto = atención. */
const STATE_TONE: Record<SealedPriceState, 'success' | 'warning' | 'accent'> = {
  priced: 'success',
  mapped_unpriced: 'warning',
  unmapped: 'accent',
};

/**
 * §diseño §2/§3 (capa 2) — «Precios de mercado de la colección». Un solo bloque primario:
 *
 *  1. **Un botón** «Actualizar precios de la colección» (`super_admin`, D-2). En un clic: si la
 *     fuente automática está apagada la enciende (con UNA confirmación de dinero en llano, §3.1),
 *     trae precios (`POST /admin/jobs/sealed-price-ingest`, awaited) y relee el estado.
 *  2. **La foto en llano** del estado tras traer precios (default aprobado 2026-09-17, opción A):
 *     «12 sets con precio · 1 sin precio». NO promete un delta de «cuántos cambiaron»: la respuesta
 *     del job no trae conteos (contrato §M11), así que se pinta el estado ACTUAL leído del §10.
 *  3. **La lista corta de sets sin precio** (solo los que quedaron sin precio) con «Arreglar este
 *     set» (`super_admin`), que abre el mapeo re-rotulado (`SealedSetMappingModal`).
 *  4. **El desglose completo por set** plegado en «Ver desglose por set» para quien audite.
 *
 * La foto y el desglose los ve `vault_operator+` (read-only); el botón y «Arreglar» son
 * `super_admin` (actos de dinero; el backend además 403ea). Lee estado PERSISTIDO (O-17 safe).
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
  const pricedCount = rows.filter((r) => r.state === 'priced').length;
  const unpricedCount = rows.length - pricedCount;
  const unpricedRows = rows.filter((r) => r.state !== 'priced');

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
                  {t('photo', { priced: pricedCount, unpriced: unpricedCount })}
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
                  {t('photo', { priced: pricedCount, unpriced: unpricedCount })}
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

              {/* Lista corta de sets sin precio (condicional): aparece SOLO si hay alguno. */}
              {unpricedRows.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-text">
                    {t('fixTitle', { count: unpricedRows.length })}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {unpricedRows.map((row) => (
                      <li
                        key={row.set.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="text-sm text-text">
                          <span lang="en" className="font-medium">{row.set.name}</span>
                          {row.reason && (
                            <span className="text-muted"> · {tReason(row.reason)}</span>
                          )}
                        </span>
                        {isSuperAdmin && (
                          <Button variant="secondary" size="sm" onClick={() => setMapping(row)}>
                            {t('fixCta')}
                          </Button>
                        )}
                      </li>
                    ))}
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
                      {rows.map((row) => (
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
                              {tStatus('breakdown', {
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
                            {isSuperAdmin && (
                              <Button variant="secondary" size="sm" onClick={() => setMapping(row)}>
                                {t('fixCta')}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
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
