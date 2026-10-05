'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getDepartureBoard, markShipmentsDeparted } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { DepartedResultDTO } from '@/types/contract';
import { TAG } from './prep-shared';
import { openLabelPdf } from './capture/label-pdf';

/**
 * **«Salida de hoy»** — cuarta pestaña de «Pedidos por preparar» (`DESIGN_SYSTEM §43.9` · contrato
 * `§M4-SHIP.19.9`): un grupo por paquetería (preferida primero, orden del servidor), casilla por paquete y
 * «Ya los dejé en la sucursal» con confirmación (S9). ⛔ Sin precios, teléfonos ni dirección del cliente
 * (criterio 240: el DTO es lista blanca y la pantalla no pide más). La hoja impresa sale de este mismo DOM.
 */
export function DepartureBoard() {
  const t = useTranslations('admin.m4.departure');
  const tLabel = useTranslations('admin.m4.label');
  const tPrep = useTranslations('admin.m4.prep');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const board = useQuery({ queryKey: ['departure-board'], queryFn: () => getDepartureBoard() });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<DepartedResultDTO | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmOpen) backRef.current?.focus();
  }, [confirmOpen]);

  const groups = useMemo(() => board.data?.groups ?? [], [board.data]);
  const ids = [...checked];

  const departed = useMutation({
    mutationFn: () => markShipmentsDeparted(ids),
    onSuccess: (res) => {
      setConfirmOpen(false);
      setResult(res);
      const errs: Record<string, string> = {};
      for (const r of res.results) if (r.outcome === 'rejected') errs[r.shipmentId] = t('rejectedRow', { code: r.code ?? '—' });
      setRowErrors(errs);
      setChecked(new Set(res.results.filter((r) => r.outcome === 'rejected').map((r) => r.shipmentId)));
      void qc.invalidateQueries({ queryKey: ['departure-board'] });
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
    },
    onError: (e) => {
      setConfirmOpen(false);
      setNotice(getError(e));
    },
  });

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const counts = result
    ? {
        shipped: result.results.filter((r) => r.outcome === 'shipped').length,
        already: result.results.filter((r) => r.outcome === 'already_shipped').length,
        rejected: result.results.filter((r) => r.outcome === 'rejected').length,
      }
    : null;

  return (
    <section className="flex flex-col gap-4" data-testid="departure-board">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-h2 font-semibold print:hidden">{t('title')}</h2>
        <h2 className="hidden text-h2 font-semibold print:block">{t('printTitle', { date: formatDate(board.data?.date ?? new Date().toISOString(), locale) })}</h2>
        <Button size="sm" variant="ghost" className="print:hidden" onClick={() => window.print()}>
          {t('print')}
        </Button>
      </div>
      {counts && (
        <Banner variant="info" role="status">
          {[
            counts.shipped > 0 ? t('resultShipped', { n: counts.shipped }) : null,
            counts.already > 0 ? t('resultAlready', { n: counts.already }) : null,
            counts.rejected > 0 ? t('resultRejected', { n: counts.rejected }) : null,
          ]
            .filter(Boolean)
            .join(' · ')
            .concat('.')}
        </Banner>
      )}
      {notice && (
        <Banner variant="danger" role="alert">
          {notice}
        </Banner>
      )}
      <QueryState isLoading={board.isLoading} isError={board.isError} error={board.error} onRetry={() => board.refetch()}>
        {board.data && (
          <>
            {board.data.manualPending > 0 && (
              <p className="text-sm text-text print:hidden">
                {t('manualPending', { count: board.data.manualPending })}{' '}
                <Link href="/admin/m4?tab=envios" className="underline underline-offset-4 hover:text-accent">
                  {t('manualPendingLink')}
                </Link>
              </p>
            )}
            {groups.length === 0 ? (
              <EmptyState title={t('empty')} />
            ) : (
              groups.map((g) => {
                const groupIds = g.shipments.map((x) => x.shipmentId);
                const allChecked = groupIds.length > 0 && groupIds.every((x) => checked.has(x));
                return (
                  <div key={g.carrierName} className="flex flex-col gap-2 border-t border-border pt-3" data-testid={`departure-group-${g.carrierName}`}>
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <h3 className="text-lg font-semibold text-text">
                        {g.dropoff ? t('group', { carrier: g.carrierLabel, dropoff: g.dropoff.name }) : t('groupNoDropoff', { carrier: g.carrierLabel })}
                      </h3>
                      <span className="tabular text-sm text-text">{t('count', { count: g.shipments.length })}</span>
                      {g.isPreferred && <span className={cn(TAG, 'text-text')}>{t('preferred')}</span>}
                    </div>
                    {g.dropoff && <p className="text-sm text-muted">{g.dropoff.address}</p>}
                    <label className="flex items-center gap-2 text-sm text-text print:hidden">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            for (const x of groupIds) {
                              if (allChecked) next.delete(x);
                              else next.add(x);
                            }
                            return next;
                          })
                        }
                      />
                      {t('selectGroup', { carrier: g.carrierLabel })}
                    </label>
                    <ul className="flex flex-col gap-1">
                      {g.shipments.map((x) => {
                        // 🔒 v1.80.12.10 (S-GAS-1): el paquete lleva «Pedido ENV-…» impreso ⇒ la fila dice su folio
                        // (⛔ nunca el uuid si hay folio).
                        const folioRef = x.folio ? `${tPrep('shipmentRef')} ${x.folio}` : null;
                        const ref = x.orderNumber ?? folioRef ?? x.shipmentId;
                        return (
                          <li key={x.shipmentId} className="flex flex-wrap items-center gap-3 text-sm text-text" data-testid={`departure-row-${x.shipmentId}`}>
                            <input
                              type="checkbox"
                              className="print:hidden"
                              aria-label={t('select', { ref })}
                              checked={checked.has(x.shipmentId)}
                              onChange={() => toggle(x.shipmentId)}
                            />
                            <span aria-hidden className="hidden h-4 w-4 border border-text print:inline-block" />
                            <span className="tabular">
                              {t('row', { ref, recipient: x.recipientName, city: x.city, number: x.trackingNumber })}
                            </span>
                            {x.orderNumber && folioRef && (
                              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted" data-testid={`departure-folio-${x.shipmentId}`}>
                                {folioRef}
                              </span>
                            )}
                            {x.labelAvailable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="print:hidden"
                                onClick={() =>
                                  openLabelPdf(x.shipmentId, ref, 'print').catch((e) =>
                                    setRowErrors((r) => ({ ...r, [x.shipmentId]: asApiError(e)?.code === 'LABEL_NOT_AVAILABLE' ? tLabel('notAvailable') : getError(e) })),
                                  )
                                }
                              >
                                {tLabel('print')}
                              </Button>
                            )}
                            {rowErrors[x.shipmentId] && (
                              <span role="alert" className="text-sm text-accent">
                                {rowErrors[x.shipmentId]}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
            )}
          </>
        )}
      </QueryState>
      {checked.size > 0 && (
        <div className="sticky bottom-0 border-t border-border bg-bg py-3 print:hidden">
          <Button onClick={() => setConfirmOpen(true)}>{t('cta', { count: checked.size })}</Button>
        </div>
      )}
      <Modal
        open={confirmOpen}
        onClose={() => !departed.isPending && setConfirmOpen(false)}
        title={t('confirmTitle', { count: checked.size })}
        footer={
          <>
            <Button ref={backRef} variant="secondary" onClick={() => setConfirmOpen(false)} disabled={departed.isPending}>
              {tc('cancel')}
            </Button>
            <Button loading={departed.isPending} onClick={() => departed.mutate()}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('confirmBody')}</p>
      </Modal>
    </section>
  );
}
