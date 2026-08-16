'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getShipments, getAdminInventory, saveShipmentTracking } from '@/lib/api';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { useShipmentSteps } from '@/lib/pipelines';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { InventoryItemDTO, ShipmentDTO, ShipmentTrackingRequest } from '@/types/contract';

/** Convierte pesos (texto) a centavos enteros. Vacío/invalid → null (no se envía). */
export function pesosToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function M4View() {
  const t = useTranslations('admin.m4');
  const ts = useTranslations('shipments');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage();
  const qc = useQueryClient();
  const steps = useShipmentSteps();
  const shipments = useQuery({ queryKey: ['shipments'], queryFn: getShipments });
  const inventory = useQuery({ queryKey: ['admin-inventory'], queryFn: getAdminInventory });

  // --- Captura de guía (contrato §M4 · POST /admin/shipments/:id/tracking) ---
  const [trackingTarget, setTrackingTarget] = useState<ShipmentDTO | null>(null);
  const [carrierValue, setCarrierValue] = useState('');
  const [trackingNumberValue, setTrackingNumberValue] = useState('');
  const [shippingCostValue, setShippingCostValue] = useState('');

  const shippingCostCents = pesosToCents(shippingCostValue);
  const shippingCostInvalid = shippingCostValue.trim() !== '' && (shippingCostCents === null || shippingCostCents < 0);

  const trackingMutation = useMutation({
    mutationFn: (target: ShipmentDTO) => {
      const body: ShipmentTrackingRequest = {
        carrier: carrierValue.trim(),
        trackingNumber: trackingNumberValue.trim(),
      };
      // shippingCostCents es opcional (v1.4-finance): solo se envía cuando el operador lo captura.
      if (shippingCostCents !== null) body.shippingCostCents = shippingCostCents;
      return saveShipmentTracking(target.id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipments'] });
      closeTracking();
    },
  });

  function openTracking(s: ShipmentDTO) {
    setTrackingTarget(s);
    setCarrierValue(s.carrier ?? '');
    setTrackingNumberValue(s.trackingNumber ?? '');
    setShippingCostValue('');
  }
  function closeTracking() {
    setTrackingTarget(null);
    setCarrierValue('');
    setTrackingNumberValue('');
    setShippingCostValue('');
  }

  const canSubmitTracking =
    carrierValue.trim() !== '' && trackingNumberValue.trim() !== '' && !shippingCostInvalid;

  const pickingColumns: Column<InventoryItemDTO>[] = [
    { key: 'location', header: 'Ubicación', render: (i) => <span className="tabular">{i.location?.label ?? '—'}</span> },
    { key: 'folio', header: 'Folio', render: (i) => <span className="tabular">{i.folio}</span> },
    { key: 'card', header: 'Carta', render: (i) => <span lang="en">{i.card.name}</span> },
    { key: 'status', header: 'Estado', render: (i) => <StatusBadge domain="inventory" value={i.status} /> },
  ];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{ts('myShipments')}</h2>
        <QueryState
          isLoading={shipments.isLoading}
          isError={shipments.isError}
          error={shipments.error}
          onRetry={() => shipments.refetch()}
        >
          {(shipments.data ?? []).map((s: ShipmentDTO) => (
            <div key={s.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="tabular text-sm font-medium">{s.id}</span>
                  <StatusBadge domain="shipment" value={s.status} />
                </div>
                {s.status !== 'cancelado' && (
                  <Button size="sm" variant="secondary" onClick={() => openTracking(s)}>
                    {t('tracking.capture')}
                  </Button>
                )}
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
          ))}
        </QueryState>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{t('pickingList')}</h2>
        <QueryState
          isLoading={inventory.isLoading}
          isError={inventory.isError}
          error={inventory.error}
          onRetry={() => inventory.refetch()}
        >
          {inventory.data && (
            <div className="rounded-lg border border-border bg-surface p-2">
              <DataTable
                columns={pickingColumns}
                rows={[...inventory.data].sort((a, b) =>
                  (a.location?.label ?? '').localeCompare(b.location?.label ?? ''),
                )}
                rowKey={(i) => i.id}
              />
            </div>
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
    </div>
  );
}
