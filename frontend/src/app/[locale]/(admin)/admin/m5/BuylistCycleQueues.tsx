'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  authorizeBuylistOffer,
  getLiveSellers,
  getPendingGuideCancellations,
  getPendingOfferAuthorizations,
  getPendingShipmentConfirmations,
  markBuylistGuideCancellationDone,
} from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import type { PendingShipmentConfirmationRowDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';

type QueueKey = 'pendingAuth' | 'pendingShipment' | 'pendingGuide' | 'liveSellers';
const QUEUE_ORDER: QueueKey[] = ['pendingAuth', 'pendingShipment', 'pendingGuide', 'liveSellers'];

/** Encabezado de columna de las colas. Mono en versalitas, como el resto del back-office. */
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="eyebrow whitespace-nowrap px-3 py-2 text-left font-normal">
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-3 align-top text-sm text-text', className)}>{children}</td>;
}

/**
 * **Cuánto lleva esperando una confirmación — y el caso que NO se puede recalcular.**
 *
 * ⚠️ `businessDaysWaiting: null` **no es cero**: es *«no se pudo calcular»* (el cálculo de días
 * hábiles **lanza** fuera de la cobertura del calendario, por doctrina — degradar a «no hay
 * festivos» adelantaría vencimientos). La fila **se degrada y la cola se pinta**; **prohibido que
 * una fila devuelva 500 en un listado**.
 *
 * Y **el `alert` del servidor se usa tal cual, jamás se deriva del número**: falla hacia `true`
 * porque *«llevo demasiado esperando»* y *«no sé cuánto llevo»* piden **la misma acción humana**,
 * y un `false` sacaría la fila del filtro de alertas — **la más rara sería la más escondida**.
 */
function WaitingCell({ row }: { row: PendingShipmentConfirmationRowDTO }) {
  const t = useTranslations('admin.m5.queues.pendingShipment');
  if (row.businessDaysUnavailable || row.businessDaysWaiting == null) {
    return <span className="text-xs text-text">{t('waitingUnknown')}</span>;
  }
  return (
    <span className="tabular text-sm text-text">
      {t('waitingValue', { count: row.businessDaysWaiting })}
    </span>
  );
}

/** Un día hábil o menos ⇒ la fecha se destaca. *Una cola cuyas filas se mueren sin avisar se trabaja a ciegas.* */
function caducityTone(caducityAt: string): 'today' | 'tomorrow' | null {
  const hours = (new Date(caducityAt).getTime() - Date.now()) / 3_600_000;
  if (!Number.isFinite(hours)) return null;
  if (hours <= 24) return 'today';
  if (hours <= 48) return 'tomorrow';
  return null;
}

export interface BuylistCycleQueuesProps {
  /** Solo el súper-admin puede autorizar una oferta por encima del tope (D24). */
  isSuperAdmin: boolean;
}

/**
 * **LAS CUATRO COLAS DEL CICLO** (contrato §M5 · DESIGN_SYSTEM §23.8).
 *
 * Son **vistas con acción propia**, distintas de las pestañas de etapa de M5 (que particionan
 * `SellRequestStatus`). Cada una contesta un pendiente **nuestro** que, si nadie mira, cuesta
 * dinero o cuesta una venta.
 */
export function BuylistCycleQueues({ isSuperAdmin }: BuylistCycleQueuesProps) {
  const t = useTranslations('admin.m5.queues');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  const getErrorMessage = useErrorMessage();
  const [tab, setTab] = useState<QueueKey>('pendingAuth');

  const auth = useQuery({
    queryKey: ['buylist-pending-auth'],
    queryFn: getPendingOfferAuthorizations,
    enabled: tab === 'pendingAuth',
  });
  const shipment = useQuery({
    queryKey: ['buylist-pending-shipment'],
    queryFn: getPendingShipmentConfirmations,
    enabled: tab === 'pendingShipment',
  });
  const guides = useQuery({
    queryKey: ['buylist-pending-guide'],
    queryFn: getPendingGuideCancellations,
    enabled: tab === 'pendingGuide',
  });
  const sellers = useQuery({
    queryKey: ['buylist-live-sellers'],
    queryFn: getLiveSellers,
    enabled: tab === 'liveSellers',
  });

  const [authorizing, setAuthorizing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelCost, setCancelCost] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const authorize = useMutation({
    mutationFn: (id: string) => authorizeBuylistOffer(id),
    onSuccess: () => {
      setAuthorizing(null);
      setFlash(t('pendingAuth.authorized'));
      void queryClient.invalidateQueries({ queryKey: ['buylist-pending-auth'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-buylist'] });
    },
  });

  const cancellationDone = useMutation({
    mutationFn: (id: string) => {
      const pesos = cancelCost.trim() === '' ? undefined : Number.parseFloat(cancelCost);
      return markBuylistGuideCancellationDone(id, {
        ...(cancelNote.trim() ? { note: cancelNote.trim() } : {}),
        ...(pesos != null && Number.isFinite(pesos) && pesos >= 0
          ? { guideActualCostCents: Math.round(pesos * 100) }
          : {}),
      });
    },
    onSuccess: () => {
      setCancelling(null);
      setCancelNote('');
      setCancelCost('');
      setFlash(t('pendingGuide.doneOk'));
      void queryClient.invalidateQueries({ queryKey: ['buylist-pending-guide'] });
    },
  });

  const authRow = auth.data?.data.find((r) => r.sellRequestId === authorizing);
  const guideRow = guides.data?.data.find((r) => r.sellRequestId === cancelling);

  return (
    <section className="gutter border-t border-border py-6" data-testid="cycle-queues">
      <h2 className="font-serif text-lg text-text">{t('title')}</h2>

      <div role="tablist" aria-label={t('title')} className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {QUEUE_ORDER.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'pb-1.5 text-xs font-medium uppercase tracking-[0.08em]',
              tab === key ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
            )}
          >
            {t(`${key}.tab`)}
          </button>
        ))}
      </div>

      {flash && (
        <div className="mt-4">
          <Banner variant="info" role="status" dismissible>
            {flash}
          </Banner>
        </div>
      )}

      {/* ---------------------------------------------------------------- Ofertas por autorizar */}
      {tab === 'pendingAuth' && (
        <QueryState
          isLoading={auth.isLoading}
          isError={auth.isError}
          error={auth.error}
          onRetry={() => auth.refetch()}
        >
          <div className="mt-4">
            <p className="text-xs leading-[1.6] text-muted">{t('pendingAuth.warning')}</p>
            {auth.data?.data.length === 0 ? (
              <EmptyState title={t('empty')} />
            ) : (
              <table className="mt-3 w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <Th>{t('seller')}</Th>
                    <Th>{t('pendingAuth.preparedBy')}</Th>
                    <Th>{t('pendingAuth.gross')}</Th>
                    <Th>{t('pendingAuth.excess')}</Th>
                    <Th>{t('pendingAuth.lines')}</Th>
                    <Th>{t('pendingAuth.diesOn')}</Th>
                    <Th>{tc('confirm')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {auth.data?.data.map((row) => {
                    const tone = caducityTone(row.caducityAt);
                    return (
                      <tr key={row.sellRequestId} className="border-b border-border last:border-b-0">
                        <Td>
                          <span className="flex flex-col">
                            <span>{row.seller.name}</span>
                            <span className="tabular font-mono text-[11px] text-muted">
                              {row.sellRequestId}
                            </span>
                          </span>
                        </Td>
                        <Td className="text-muted">{row.preparedBy}</Td>
                        <Td className="tabular font-mono">
                          {formatMoneyCents(row.offerGrossCents, locale)}
                        </Td>
                        <Td className="tabular font-mono">
                          {formatMoneyCents(row.excessCents, locale)}
                        </Td>
                        <Td className="tabular">
                          {row.buyLineCount}/{row.lineCount}
                        </Td>
                        <Td>
                          {/* La fecha de muerte, y a ≤1 día hábil con su versalita en accent. */}
                          <span className="flex flex-col">
                            <span className="tabular font-mono text-[13px]">
                              {formatDateTimeMx(row.caducityAt, locale)}
                            </span>
                            {tone && (
                              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                                {tone === 'today'
                                  ? t('pendingAuth.diesToday')
                                  : t('pendingAuth.diesTomorrow')}
                              </span>
                            )}
                          </span>
                        </Td>
                        <Td>
                          {isSuperAdmin ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setAuthorizing(row.sellRequestId)}
                            >
                              {t('pendingAuth.authorize')}
                            </Button>
                          ) : (
                            /* §15.9: no un botón apagado y mudo — se dice de quién es la acción. */
                            <span className="text-xs text-muted">
                              {t('pendingAuth.superAdminOnly')}
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </QueryState>
      )}

      {/* --------------------------------------------------------------- Por confirmar envío */}
      {tab === 'pendingShipment' && (
        <QueryState
          isLoading={shipment.isLoading}
          isError={shipment.isError}
          error={shipment.error}
          onRetry={() => shipment.refetch()}
        >
          <div className="mt-4">
            <p className="text-xs leading-[1.6] text-muted">{t('pendingShipment.alertNote')}</p>
            {shipment.data?.data.length === 0 ? (
              <EmptyState title={t('empty')} />
            ) : (
              <table className="mt-3 w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <Th>{t('seller')}</Th>
                    <Th>{t('pendingShipment.declaredAt')}</Th>
                    <Th>{t('pendingShipment.guide')}</Th>
                    <Th>{t('pendingShipment.waiting')}</Th>
                    <Th>{t('pendingShipment.deadline')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {shipment.data?.data.map((row) => (
                    <tr key={row.sellRequestId} className="border-b border-border last:border-b-0">
                      <Td>
                        <span className="flex flex-col">
                          <span className="flex items-center gap-2">
                            {row.seller.name}
                            {/* La alerta la manda el SERVIDOR. La UI no la deriva de los días. */}
                            {row.alert && (
                              <span
                                data-testid="shipment-alert"
                                className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent"
                              >
                                {t('pendingShipment.alert')}
                              </span>
                            )}
                          </span>
                          <span className="tabular font-mono text-[11px] text-muted">
                            {row.sellRequestId}
                          </span>
                        </span>
                      </Td>
                      <Td className="tabular font-mono text-[13px]">
                        {formatDateTimeMx(row.sellerShippedDeclaredAt, locale)}
                      </Td>
                      <Td className="tabular font-mono text-[13px]">
                        {row.trackingNumber ? (
                          `${row.carrier ?? ''} ${row.trackingNumber}`.trim()
                        ) : (
                          <span className="text-muted">{t('pendingShipment.noGuide')}</span>
                        )}
                      </Td>
                      <Td>
                        <WaitingCell row={row} />
                      </Td>
                      <Td className="tabular font-mono text-[13px]">
                        {row.shipDeadlineAt ? formatDateTimeMx(row.shipDeadlineAt, locale) : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </QueryState>
      )}

      {/* ----------------------------------------------------------------- Guías por cancelar */}
      {tab === 'pendingGuide' && (
        <QueryState
          isLoading={guides.isLoading}
          isError={guides.isError}
          error={guides.error}
          onRetry={() => guides.refetch()}
        >
          <div className="mt-4">
            <p className="text-xs leading-[1.6] text-muted">{t('pendingGuide.note')}</p>
            {guides.data?.data.length === 0 ? (
              /* Vacío POSITIVO: aquí «no hay nada» es una buena noticia, no una carencia. */
              <EmptyState title={t('pendingGuide.empty')} />
            ) : (
              <table className="mt-3 w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <Th>{t('seller')}</Th>
                    <Th>{t('pendingGuide.carrier')}</Th>
                    <Th>{t('pendingGuide.tracking')}</Th>
                    <Th>{t('pendingGuide.openedAt')}</Th>
                    <Th>{t('pendingGuide.why')}</Th>
                    <Th>{tc('confirm')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {guides.data?.data.map((row) => (
                    <tr key={row.sellRequestId} className="border-b border-border last:border-b-0">
                      <Td>
                        <span className="flex flex-col">
                          <span>{row.seller.name}</span>
                          <span className="tabular font-mono text-[11px] text-muted">
                            {row.sellRequestId}
                          </span>
                        </span>
                      </Td>
                      <Td>{row.carrier}</Td>
                      <Td className="tabular font-mono text-[13px]">{row.trackingNumber}</Td>
                      <Td className="tabular font-mono text-[13px]">
                        {formatDate(row.guideCancellationPendingAt, locale)}
                      </Td>
                      <Td>
                        {/* §23.1d: el desenlace se pinta por su MOTIVO, no solo por el estado. */}
                        <StatusBadge
                          domain="sellRequest"
                          value={row.closedStatus}
                          reason={row.expiredReason}
                        />
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setCancelling(row.sellRequestId)}
                        >
                          {t('pendingGuide.done')}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </QueryState>
      )}

      {/* ------------------------------------------------ Vendedores con solicitudes vivas (D12) */}
      {tab === 'liveSellers' && (
        <QueryState
          isLoading={sellers.isLoading}
          isError={sellers.isError}
          error={sellers.error}
          onRetry={() => sellers.refetch()}
        >
          <div className="mt-4">
            <p className="text-xs leading-[1.6] text-muted">{t('liveSellers.note')}</p>
            {sellers.data?.data.length === 0 ? (
              <EmptyState title={t('empty')} />
            ) : (
              <table className="mt-3 w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <Th>{t('seller')}</Th>
                    <Th>{t('liveSellers.phone')}</Th>
                    <Th>{t('liveSellers.liveCount')}</Th>
                    <Th>{t('liveSellers.oldest')}</Th>
                    <Th>{t('liveSellers.latestStatus')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.data?.data.map((row) => (
                    <tr key={row.seller.id} className="border-b border-border last:border-b-0">
                      <Td>
                        <span className="flex flex-col">
                          <span>{row.seller.name}</span>
                          <span className="text-[11px] text-muted">{row.seller.email}</span>
                        </span>
                      </Td>
                      {/* D12: el teléfono viaja EN LA FILA para poder llamar sin ir a buscar al
                          usuario. Mono seleccionable, y JAMÁS en superficie pública. */}
                      <Td className="tabular font-mono text-[13px]">
                        {row.seller.phone ?? (
                          <span className="text-muted">{t('liveSellers.noPhone')}</span>
                        )}
                      </Td>
                      <Td className="tabular">{row.liveCount}</Td>
                      <Td className="tabular font-mono text-[13px]">
                        {formatDate(row.oldestCreatedAt, locale)}
                      </Td>
                      <Td>
                        <StatusBadge domain="sellRequest" value={row.latestStatus} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </QueryState>
      )}

      {/* Confirmación de autorizar: autoriza LO GUARDADO, y se dice. */}
      <Modal
        open={authorizing !== null}
        onClose={() => setAuthorizing(null)}
        title={t('pendingAuth.authorizeTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAuthorizing(null)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={authorize.isPending}
              onClick={() => authorizing && authorize.mutate(authorizing)}
            >
              {t('pendingAuth.authorizeConfirm')}
            </Button>
          </>
        }
      >
        {authRow && (
          <p className="leading-[1.7]">
            {t('pendingAuth.authorizeBody', {
              gross: formatMoneyCents(authRow.offerGrossCents, locale),
              lines: authRow.buyLineCount,
            })}
          </p>
        )}
        {authorize.isError && (
          <div className="mt-3">
            <Banner variant="danger" role="alert">
              {getErrorMessage(authorize.error)}
            </Banner>
          </div>
        )}
      </Modal>

      {/* La ÚNICA salida de la cola de guías. Sin esto, esa cola no se vacía nunca. */}
      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t('pendingGuide.doneTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={cancellationDone.isPending}
              onClick={() => cancelling && cancellationDone.mutate(cancelling)}
            >
              {t('pendingGuide.doneConfirm')}
            </Button>
          </>
        }
      >
        {guideRow && (
          <p className="leading-[1.7]">
            {t('pendingGuide.doneBody', {
              tracking: guideRow.trackingNumber,
              carrier: guideRow.carrier,
            })}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-3">
          <Input
            label={t('pendingGuide.costLabel')}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={cancelCost}
            onChange={(e) => setCancelCost(e.target.value)}
          />
          <p className="text-xs leading-[1.6] text-muted">{t('pendingGuide.costHint')}</p>
          <Input
            label={t('pendingGuide.noteLabel')}
            value={cancelNote}
            maxLength={500}
            onChange={(e) => setCancelNote(e.target.value)}
          />
        </div>
        {cancellationDone.isError && (
          <div className="mt-3">
            <Banner variant="danger" role="alert">
              {getErrorMessage(cancellationDone.error)}
            </Banner>
          </div>
        )}
      </Modal>
    </section>
  );
}
