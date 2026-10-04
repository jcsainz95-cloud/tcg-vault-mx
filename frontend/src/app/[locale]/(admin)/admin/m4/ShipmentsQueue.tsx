'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { getAdminShipments, updateAdminShipmentStatus } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useShipmentSteps } from '@/lib/pipelines';
import { formatDateTimeMx } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { useRole } from '@/lib/role';
import type { AdminShipmentDTO, ShipmentStatus, WithdrawalLineOriginRefundedDetails } from '@/types/contract';
import { LABEL, TAG } from './prep-shared';
import { LabelAlertBlock } from './LabelActions';
import { SkydropxLabelBlock } from './SkydropxLabelBlock';

/**
 * Campo string del `addressSnapshot` (contrato §M4 v1.67.1). Vacío/ausente ⇒ `undefined`.
 */
function snap(row: AdminShipmentDTO, key: string): string | undefined {
  const v = row.addressSnapshot?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Destinatario: `addressSnapshot.recipientName` (canónico, D-CTA-9); el suelto deprecado, después. */
export function recipientOf(row: AdminShipmentDTO): string | undefined {
  return snap(row, 'recipientName') ?? row.recipientName?.trim() ?? undefined;
}

function streetOf(row: AdminShipmentDTO): string | undefined {
  const parts = [snap(row, 'line1'), snap(row, 'line2'), snap(row, 'neighborhood')].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(', ') : undefined;
}

/** §32.4: lo desconocido es «—», nunca omitido en silencio. */
const DASH = '—';

const STATUS_FILTERS: ShipmentStatus[] = ['solicitado', 'picking', 'guia', 'enviado', 'entregado', 'cancelado'];

/**
 * Transiciones MANUALES ofrecidas como botón por estado. ⭐ v1.80 (§M4-SHIP.9, criterio 222): **sin
 * «Cancelar» en `picking` ni `guia`** — no se pinta apagado: no se pinta. `solicitado` (no pagado) sí se
 * cancela, con confirmación. `guia→enviado` y `enviado→entregado` piden confirmación (§37.6, S9).
 */
const MANUAL_TRANSITIONS: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = {
  solicitado: ['cancelado'],
  guia: ['enviado'],
  enviado: ['entregado'],
};

/**
 * **La cola de envíos** (pestaña «Envíos» de `DESIGN_SYSTEM §37.2/§37.6/§37.11a` · contrato §M4 +
 * §M4-SHIP.9/.10): quién es quién (número de pedido y COMPRADOR), búsqueda `?q=`, guía, enviado/entregado
 * con confirmación y el «Cancelar» que solo existe en `solicitado`.
 */
export function ShipmentsQueue({ onCaptureGuide }: { onCaptureGuide: (s: AdminShipmentDTO) => void }) {
  const t = useTranslations('admin.m4');
  const ts = useTranslations('shipments');
  const tStatus = useTranslations('status.shipment');
  const tc = useTranslations('common');
  const tm6 = useTranslations('admin.m6');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const steps = useShipmentSteps();
  // Hueco 7 (arreglos-operador, 2026-09-29): M6 es solo de `super_admin`; el operador que pulsaba «Ver ficha»
  // caía en «Acceso restringido». Al operador se le lleva al detalle que SÍ puede abrir: la bóveda del cliente.
  const { isSuperAdmin } = useRole();

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 400);
  const tooLong = search.trim().length > 200;
  const q = tooLong ? '' : debounced.trim();

  const shipments = useQuery({
    queryKey: ['admin-shipments', statusFilter, q],
    queryFn: () => getAdminShipments({ status: statusFilter || undefined, q: q || undefined }),
  });

  // --- Cambio de estado manual (contrato §M4 · PATCH /admin/shipments/:id/status) ---
  const [statusChanged, setStatusChanged] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ target: AdminShipmentDTO; to: ShipmentStatus } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, { text: string; links?: { href: string; label: string }[] }>>({});
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);

  const statusMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ShipmentStatus }) => updateAdminShipmentStatus(id, to),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
      void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
      setStatusChanged(vars.id);
      setConfirm(null);
    },
    onError: (e, vars) => {
      setConfirm(null);
      const err = e instanceof ApiClientError ? e : null;
      const label = (s: unknown) => (typeof s === 'string' && tStatus.has(s) ? tStatus(s) : String(s ?? DASH));
      let text: string;
      let links: { href: string; label: string }[] | undefined;
      if (err?.status === 409 && err.code === 'PAID_SHIPMENT_NOT_CANCELLABLE') text = t('statusActions.notCancellable', { status: label(err.details?.status) });
      else if (err?.status === 409 && err.code === 'CONFLICT' && err.details?.reason === 'nothing_to_ship') text = t('statusActions.nothingToShip');
      else if (err?.status === 409 && err.code === 'ORDER_NOT_SETTLED') text = t('tracking.orderNotSettled', { status: label(err.details?.orderStatus) });
      else if (err?.status === 409 && err.code === 'WITHDRAWAL_LINE_ORIGIN_REFUNDED') {
        const items = (err.details as Partial<WithdrawalLineOriginRefundedDetails> | undefined)?.items ?? [];
        text = t('tracking.originRefunded', {
          count: Math.max(1, items.length),
          items: items.map((i) => `${i.folio ?? i.inventoryItemId} · ${i.orderNumber ?? i.orderId ?? DASH}`).join('; '),
        });
        links = items.filter((i) => i.orderId).map((i) => ({ href: `/admin/m3/${i.orderId}`, label: `${t('viewOrder')} ${i.orderNumber ?? i.orderId}` }));
      } else if (err?.status === 409 && err.code === 'SHIPMENT_NOT_PREPARED') text = t('tracking.notPrepared');
      else text = getError(e);
      setRowErrors((r) => ({ ...r, [vars.id]: { text, links } }));
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
    },
  });

  function requestChange(s: AdminShipmentDTO, to: ShipmentStatus) {
    setStatusChanged(null);
    setRowErrors((r) => {
      const next = { ...r };
      delete next[s.id];
      return next;
    });
    setConfirm({ target: s, to });
  }

  const refOf = (s: AdminShipmentDTO) => s.orderNumber ?? s.id;
  const recipientLabel = (s: AdminShipmentDTO) => recipientOf(s) ?? t('statusActions.recipientUnknown');

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-h2 font-semibold">{t('queueTitle')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Input
              label={t('search.label')}
              type="search"
              value={search}
              hint={tooLong ? undefined : t('search.hint')}
              error={tooLong ? t('search.tooLong') : undefined}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            label={t('statusFilter')}
            className="w-48"
            placeholder={t('statusAll')}
            options={STATUS_FILTERS.map((s) => ({ value: s, label: tStatus(s) }))}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>
      </div>
      {statusChanged && (
        <Banner variant="success" role="status">
          {t('statusActions.changed', { id: statusChanged })}
        </Banner>
      )}
      <QueryState isLoading={shipments.isLoading} isError={shipments.isError} error={shipments.error} onRetry={() => shipments.refetch()}>
        {shipments.data && shipments.data.data.length === 0 ? (
          <EmptyState title={q ? t('search.empty', { q }) : t('queueEmpty')} />
        ) : (
          (shipments.data?.data ?? []).map((s: AdminShipmentDTO) => {
            const rowError = rowErrors[s.id];
            const isWithdrawal = s.kind === 'vault_withdrawal' || (!s.kind && !s.orderId);
            return (
              <div key={s.id} data-testid={`shipment-row-${s.id}`} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    {/* §37.11a: número de pedido ANTES del destinatario; retiro ⇒ «Retiro de bóveda» en serif. */}
                    <div className="flex flex-wrap items-center gap-2">
                      {s.orderNumber ? (
                        <span className="tabular text-lg font-semibold text-text">{s.orderNumber}</span>
                      ) : isWithdrawal ? (
                        <span className="font-serif text-lg text-text">{t('withdrawal')}</span>
                      ) : null}
                      {/* 🔒 §43.19.7: «Envío ENV-000045» en el hueco del uuid; sin folio (servidor anterior) ⇒ lo de hoy. */}
                      <span className="tabular text-sm font-medium text-muted" data-testid={`shipment-ref-${s.id}`}>
                        {s.folio ? `${t('prep.shipmentRef')} ${s.folio}` : s.id}
                      </span>
                      <StatusBadge domain="shipment" value={s.status} />
                      {s.items && <span className="text-xs text-muted">{t('itemCount', { count: s.items.length })}</span>}
                    </div>
                    {s.preparedAt && (
                      <p className="text-sm text-text">
                        <span className={cn(TAG, 'text-text')}>{t('preparedTag')}</span>{' '}
                        {t('preparedBy', { name: s.preparedBy?.name?.trim() || t('nameMissing'), date: formatDateTimeMx(s.preparedAt, locale) })}
                      </p>
                    )}
                    {(s.missingCount ?? 0) > 0 && <p className={cn(TAG, 'text-accent')}>{t('missingCount', { count: s.missingCount! })}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* §43.8b (FS-6): con guía Skydropx NO hay «Capturar guía» (el servidor la rechazaría, criterio 247). */}
                    {s.status !== 'cancelado' && s.status !== 'entregado' && s.status !== 'solicitado' && s.labelSource !== 'skydropx' && (
                      <Button size="sm" variant="secondary" onClick={() => onCaptureGuide(s)}>
                        {t('tracking.capture')}
                      </Button>
                    )}
                    {(MANUAL_TRANSITIONS[s.status] ?? []).map((to) =>
                      to === 'cancelado' ? (
                        <Button key={to} size="sm" variant="ghost" className="text-accent" onClick={() => requestChange(s, to)}>
                          {t('statusActions.cancelado')}
                        </Button>
                      ) : (
                        <Button
                          key={to}
                          size="sm"
                          loading={statusMutation.isPending && statusMutation.variables?.id === s.id && statusMutation.variables?.to === to}
                          onClick={() => requestChange(s, to)}
                        >
                          {t(`statusActions.${to}`)}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
                {/* §33.10d / D-CTA-6: a QUIÉN va el paquete y a DÓNDE (destinatario ≠ comprador). */}
                <div className="flex flex-col gap-1 text-sm text-muted" data-testid={`shipment-parties-${s.id}`}>
                  <p>
                    <span className="font-medium text-text">{t('recipient')}</span>{' '}
                    {recipientOf(s) ? <span className="text-text">{recipientOf(s)}</span> : <span className="font-mono text-xs uppercase text-accent">{t('recipientMissing')}</span>}
                    {' · '}
                    {snap(s, 'city') ?? DASH}, {snap(s, 'state') ?? DASH}
                    {' · '}
                    {t('postalCode')} <span className="tabular">{snap(s, 'postalCode') ?? DASH}</span>
                    {' · '}
                    {t('phone')} <span className="tabular">{snap(s, 'phone') ?? DASH}</span>
                  </p>
                  <p>
                    {/* Hueco 12 (2026-09-29): el rótulo era «Calle» y la calle capturada suele empezar
                        por «Calle …» ⇒ «Calle Calle Río Lerma». El rótulo pasa a «Dirección». */}
                    <span className="font-medium text-text">{t('street')}</span> <span className="text-text">{streetOf(s) ?? DASH}</span>
                  </p>
                  {/* §37.11a: EL COMPRADOR (nombre + correo; «Invitado» sin cuenta) y el enlace a la ficha por id
                      (⛔ nunca el `userId` crudo en pantalla). Ausente ⇒ «—», nunca omitido en silencio. */}
                  <p className="flex flex-wrap items-baseline gap-x-2" data-testid={`shipment-customer-${s.id}`}>
                    <span className="font-medium text-text">{t('customer')}</span>{' '}
                    {s.customer ? (
                      <span className="text-text">
                        {s.customer.fullName?.trim() || t('nameMissing')} · {s.customer.email}
                      </span>
                    ) : s.guestEmail ? (
                      <span className="text-text">
                        <span className={cn(TAG, 'text-muted')}>{t('guest')}</span> · {s.guestEmail}
                      </span>
                    ) : (
                      <span className="text-text">
                        {DASH} · {DASH}
                      </span>
                    )}
                    {(s.customer?.userId ?? s.userId) &&
                      (isSuperAdmin ? (
                        <Link href={{ pathname: '/admin/m6', query: { user: s.customer?.userId ?? s.userId } }} className="font-mono text-xs uppercase text-accent hover:text-text">
                          {tm6('view')}
                        </Link>
                      ) : (
                        <Link href={`/admin/vaults/${s.customer?.userId ?? s.userId}`} className="font-mono text-xs uppercase text-accent hover:text-text">
                          {t('viewCustomerVault')}
                        </Link>
                      ))}
                    {s.orderId && (
                      <Link href={`/admin/m3/${s.orderId}`} className="text-text underline underline-offset-4 hover:text-accent">
                        {t('viewOrder')}
                      </Link>
                    )}
                  </p>
                </div>
                {s.labelSource === 'skydropx' && s.label && <SkydropxLabelBlock shipment={s} />}
                {/* §43.8c (FS-21): las cuatro alertas de guía, donde lleguen; «Liberar» ⇔ `canRelease`. */}
                {s.labelAlert && (
                  <LabelAlertBlock
                    shipmentId={s.id}
                    alert={s.labelAlert}
                    trackingNumber={s.label?.trackingNumber ?? s.trackingNumber ?? null}
                    labelPending={s.labelPending ?? null}
                    recipient={
                      s.addressSnapshot
                        ? {
                            recipientName: s.addressSnapshot.recipientName ?? null,
                            line1: s.addressSnapshot.line1 ?? null,
                            neighborhood: s.addressSnapshot.neighborhood ?? null,
                            postalCode: s.addressSnapshot.postalCode ?? null,
                          }
                        : null
                    }
                  />
                )}
                {s.labelSource !== 'skydropx' && (s.carrier || s.trackingNumber) && (
                  <p className="text-sm text-muted">
                    <span className="font-medium text-text">{ts('carrier')}:</span> {s.carrier ?? DASH}
                    {' · '}
                    <span className="font-medium text-text">{ts('tracking')}:</span> <span className="tabular">{s.trackingNumber ?? DASH}</span>
                  </p>
                )}
                <PipelineStepper steps={steps} current={s.status} />
                {rowError && (
                  <div role="alert" className="flex flex-col items-start gap-1 text-sm text-text">
                    <p>{rowError.text}</p>
                    {rowError.links?.map((l) => (
                      <Link key={l.href} href={l.href} className="underline underline-offset-4 hover:text-accent">
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </QueryState>

      {/* §37.6 — confirmaciones (S9): enviado, entregado y cancelar un `solicitado`; foco inicial en «Cancelar». */}
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm?.to === 'enviado'
            ? t('statusActions.shippedTitle', { ref: refOf(confirm.target) })
            : confirm?.to === 'entregado'
              ? t('statusActions.deliveredTitle', { ref: refOf(confirm.target) })
              : confirm
                ? t('statusActions.cancelTitle', { ref: refOf(confirm.target) })
                : ''
        }
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={() => setConfirm(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant={confirm?.to === 'cancelado' ? 'destructive' : 'secondary'}
              loading={statusMutation.isPending}
              onClick={() => confirm && statusMutation.mutate({ id: confirm.target.id, to: confirm.to })}
            >
              {confirm?.to === 'enviado'
                ? t('statusActions.shippedConfirm')
                : confirm?.to === 'entregado'
                  ? t('statusActions.deliveredConfirm')
                  : t('statusActions.cancelConfirm')}
            </Button>
          </>
        }
      >
        {confirm && (
          <p className="text-sm text-text">
            {confirm.to === 'enviado'
              ? t('statusActions.shippedBody', { recipient: recipientLabel(confirm.target) })
              : confirm.to === 'entregado'
                ? t('statusActions.deliveredBody', { recipient: recipientLabel(confirm.target) })
                : t('statusActions.cancelBody')}
          </p>
        )}
      </Modal>
    </section>
  );
}
