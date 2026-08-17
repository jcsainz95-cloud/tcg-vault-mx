'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  getAdminShipments,
  getAdminPickingList,
  saveShipmentTracking,
  updateAdminShipmentStatus,
} from '@/lib/api';
import { DataTable, type Column } from '@/components/ui/DataTable';
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
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type {
  AdminShipmentDTO,
  PickingListEntryDTO,
  ShipmentStatus,
  ShipmentTrackingRequest,
} from '@/types/contract';

/** Convierte pesos (texto) a centavos enteros. Vacío/invalid → null (no se envía). */
export function pesosToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const STATUS_FILTERS: ShipmentStatus[] = [
  'solicitado',
  'picking',
  'guia',
  'enviado',
  'entregado',
  'cancelado',
];

/**
 * Transiciones MANUALES ofrecidas como botón por estado (subconjunto de la tabla legal del backend,
 * `SHIPMENT_TRANSITIONS`). Se EXCLUYE `solicitado→picking` (lo dispara el WEBHOOK de pago) y
 * `picking→guia` (lo hace la captura de guía). Quedan `guia→enviado`, `enviado→entregado` y
 * `→cancelado` según la etapa. `entregado`/`cancelado` son terminales (sin acciones).
 */
const MANUAL_TRANSITIONS: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = {
  solicitado: ['cancelado'],
  picking: ['cancelado'],
  guia: ['enviado', 'cancelado'],
  enviado: ['entregado'],
};

export function M4View() {
  const t = useTranslations('admin.m4');
  const ts = useTranslations('shipments');
  const tStatus = useTranslations('status.shipment');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage();
  const qc = useQueryClient();
  const steps = useShipmentSteps();

  // Cola ADMIN de envíos de clientes (contrato §M4 · GET /admin/shipments?status=).
  const [statusFilter, setStatusFilter] = useState('');
  const shipments = useQuery({
    queryKey: ['admin-shipments', statusFilter],
    queryFn: () => getAdminShipments({ status: statusFilter || undefined }),
  });
  // Lista de picking real (contrato §M4 · GET /admin/shipments/picking-list).
  const picking = useQuery({ queryKey: ['admin-picking-list'], queryFn: () => getAdminPickingList() });

  // --- Captura de guía (contrato §M4 · POST /admin/shipments/:id/tracking) ---
  const [trackingTarget, setTrackingTarget] = useState<AdminShipmentDTO | null>(null);
  const [carrierValue, setCarrierValue] = useState('');
  const [trackingNumberValue, setTrackingNumberValue] = useState('');
  const [shippingCostValue, setShippingCostValue] = useState('');
  const [trackingSaved, setTrackingSaved] = useState<string | null>(null);

  const shippingCostCents = pesosToCents(shippingCostValue);
  const shippingCostInvalid = shippingCostValue.trim() !== '' && (shippingCostCents === null || shippingCostCents < 0);

  const trackingMutation = useMutation({
    mutationFn: (target: AdminShipmentDTO) => {
      const body: ShipmentTrackingRequest = {
        carrier: carrierValue.trim(),
        trackingNumber: trackingNumberValue.trim(),
      };
      // shippingCostCents es opcional (v1.4-finance): solo se envía cuando el operador lo captura.
      if (shippingCostCents !== null) body.shippingCostCents = shippingCostCents;
      return saveShipmentTracking(target.id, body);
    },
    onSuccess: (_d, target) => {
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      void qc.invalidateQueries({ queryKey: ['admin-picking-list'] });
      setTrackingSaved(target.id);
      closeTracking();
    },
  });

  // --- Cambio de estado manual (contrato §M4 · PATCH /admin/shipments/:id/status) ---
  const [statusChanged, setStatusChanged] = useState<string | null>(null);
  // `cancelado` es destructivo → confirma antes; las transiciones hacia adelante son directas.
  const [cancelTarget, setCancelTarget] = useState<AdminShipmentDTO | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ShipmentStatus }) =>
      updateAdminShipmentStatus(id, to),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      void qc.invalidateQueries({ queryKey: ['admin-picking-list'] });
      setStatusChanged(vars.id);
      setCancelTarget(null);
    },
  });

  function changeStatus(id: string, to: ShipmentStatus) {
    setStatusChanged(null);
    statusMutation.mutate({ id, to });
  }

  function openTracking(s: AdminShipmentDTO) {
    setTrackingTarget(s);
    setCarrierValue(s.carrier ?? '');
    setTrackingNumberValue(s.trackingNumber ?? '');
    setShippingCostValue('');
    setTrackingSaved(null);
    trackingMutation.reset();
  }
  function closeTracking() {
    setTrackingTarget(null);
    setCarrierValue('');
    setTrackingNumberValue('');
    setShippingCostValue('');
  }

  const canSubmitTracking =
    carrierValue.trim() !== '' && trackingNumberValue.trim() !== '' && !shippingCostInvalid;

  const pickingColumns: Column<PickingListEntryDTO>[] = [
    { key: 'location', header: t('picking.location'), render: (r) => <span className="tabular">{r.location}</span> },
    { key: 'folio', header: t('picking.folio'), render: (r) => <span className="tabular">{r.folio}</span> },
    { key: 'shipment', header: t('picking.shipment'), render: (r) => <span className="tabular">{r.shipmentId}</span> },
  ];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-h2 font-semibold">{t('queueTitle')}</h2>
          <Select
            label={t('statusFilter')}
            className="w-48"
            placeholder={t('statusAll')}
            options={STATUS_FILTERS.map((s) => ({ value: s, label: tStatus(s) }))}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>
        {trackingSaved && (
          <Banner variant="success" role="status">
            {t('tracking.saved', { id: trackingSaved })}
          </Banner>
        )}
        {statusChanged && (
          <Banner variant="success" role="status">
            {t('statusActions.changed', { id: statusChanged })}
          </Banner>
        )}
        {statusMutation.isError && !cancelTarget && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {getError(statusMutation.error)}
          </Banner>
        )}
        <QueryState
          isLoading={shipments.isLoading}
          isError={shipments.isError}
          error={shipments.error}
          onRetry={() => shipments.refetch()}
        >
          {shipments.data && shipments.data.data.length === 0 ? (
            <EmptyState title={t('queueEmpty')} />
          ) : (
            (shipments.data?.data ?? []).map((s) => (
              <div key={s.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-sm font-medium">{s.id}</span>
                    <StatusBadge domain="shipment" value={s.status} />
                    {s.userId && <span className="tabular text-xs text-muted">{s.userId}</span>}
                    {s.items && (
                      <span className="text-xs text-muted">
                        {t('itemCount', { count: s.items.length })}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.status !== 'cancelado' && s.status !== 'entregado' && (
                      <Button size="sm" variant="secondary" onClick={() => openTracking(s)}>
                        {t('tracking.capture')}
                      </Button>
                    )}
                    {(MANUAL_TRANSITIONS[s.status] ?? []).map((to) =>
                      to === 'cancelado' ? (
                        <Button
                          key={to}
                          size="sm"
                          variant="ghost"
                          className="text-accent"
                          onClick={() => setCancelTarget(s)}
                        >
                          {t('statusActions.cancelado')}
                        </Button>
                      ) : (
                        <Button
                          key={to}
                          size="sm"
                          loading={
                            statusMutation.isPending &&
                            statusMutation.variables?.id === s.id &&
                            statusMutation.variables?.to === to
                          }
                          onClick={() => changeStatus(s.id, to)}
                        >
                          {t(`statusActions.${to}`)}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
                {(s.carrier || s.trackingNumber) && (
                  <p className="text-sm text-muted">
                    <span className="font-medium text-text">{ts('carrier')}:</span> {s.carrier ?? '—'}
                    {' · '}
                    <span className="font-medium text-text">{ts('tracking')}:</span>{' '}
                    <span className="tabular">{s.trackingNumber ?? '—'}</span>
                  </p>
                )}
                <PipelineStepper steps={steps} current={s.status} />
              </div>
            ))
          )}
        </QueryState>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{t('pickingList')}</h2>
        <p className="text-sm text-muted">{t('pickingHint')}</p>
        <QueryState
          isLoading={picking.isLoading}
          isError={picking.isError}
          error={picking.error}
          onRetry={() => picking.refetch()}
        >
          {picking.data && picking.data.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface p-2">
              <DataTable columns={pickingColumns} rows={picking.data} rowKey={(r) => `${r.shipmentId}-${r.inventoryItemId}`} />
            </div>
          ) : (
            <EmptyState tone="positive" title={t('pickingEmpty')} />
          )}
        </QueryState>
      </section>

      <Modal
        open={trackingTarget !== null}
        onClose={closeTracking}
        title={t('tracking.title')}
        footer={
          <>
            <Button variant="ghost" onClick={closeTracking}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={!canSubmitTracking}
              loading={trackingMutation.isPending}
              onClick={() => trackingTarget && trackingMutation.mutate(trackingTarget)}
            >
              {t('tracking.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {trackingTarget && (
            <p className="text-sm text-muted">
              <span className="tabular font-medium text-text">{trackingTarget.id}</span>
            </p>
          )}
          <Input
            label={t('tracking.carrierLabel')}
            type="text"
            value={carrierValue}
            onChange={(e) => setCarrierValue(e.target.value)}
          />
          <Input
            label={t('tracking.numberLabel')}
            type="text"
            inputMode="numeric"
            value={trackingNumberValue}
            onChange={(e) => setTrackingNumberValue(e.target.value)}
          />
          <Input
            label={t('tracking.shippingCostLabel')}
            hint={t('tracking.shippingCostHint')}
            error={shippingCostInvalid ? t('tracking.shippingCostInvalid') : undefined}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            min={0}
            value={shippingCostValue}
            onChange={(e) => setShippingCostValue(e.target.value)}
          />
          {!shippingCostInvalid && shippingCostCents !== null && (
            <p className="text-xs text-muted">= {formatMoneyCents(shippingCostCents, locale)}</p>
          )}
          {trackingMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(trackingMutation.error)}
            </Banner>
          )}
        </div>
      </Modal>

      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={t('statusActions.cancelTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="accent"
              loading={statusMutation.isPending}
              onClick={() => cancelTarget && changeStatus(cancelTarget.id, 'cancelado')}
            >
              {t('statusActions.cancelConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {cancelTarget && (
            <p className="text-sm text-muted">
              {t('statusActions.cancelBody', { id: cancelTarget.id })}
            </p>
          )}
          {statusMutation.isError && cancelTarget && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {getError(statusMutation.error)}
            </Banner>
          )}
        </div>
      </Modal>
    </div>
  );
}
