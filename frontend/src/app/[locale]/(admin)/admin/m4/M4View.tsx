'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { saveShipmentTracking } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { usePickingSummary, PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { AdminShipmentDTO, ShipPreparationOrderDTO, ShipmentTrackingRequest, WithdrawalLineOriginRefundedDetails } from '@/types/contract';
import { PreparationQueue } from './PreparationQueue';
import { ShipmentsQueue } from './ShipmentsQueue';
import { ReplacementCasesPanel } from './ReplacementCasesPanel';
import { M4_TABS, type M4Tab } from './tabs';

// `pesosToCents` vive en su propio módulo (función pura, sin React).
import { pesosToCents } from './pesosToCents';
export { pesosToCents };

/** Lo que el diálogo de guía necesita de cualquiera de las dos superficies que lo abren (§37.3a). */
interface TrackingTarget {
  id: string;
  ref: string;
  carrier: string | null;
  trackingNumber: string | null;
}

/**
 * **«Pedidos por preparar»** (`DESIGN_SYSTEM §37` · contrato `§M4-SHIP` v1.80.6). Tres pestañas de página
 * (`?tab=`): **Preparar** (la hoja de pie: envío + bóveda), **Por reponer** (los casos) y **Envíos** (la cola
 * administrativa). El badge de cada pestaña sale del contador derivado (`usePickingSummary`), sondeado
 * como fija el contrato. El diálogo de captura de guía es **uno** para las dos superficies que lo abren.
 *
 * Fusión release-s5: los arreglos del recorrido del operador (`arreglos-operador`, 2026-09-29) viven donde
 * vive ahora su superficie — hueco 7 («Ver ficha» del operador → su bóveda) y hueco 12 («Dirección») en
 * `ShipmentsQueue`; hueco 15 (confirmar enviado/entregado) lo cubre la confirmación de §37.6 (S9) de
 * `ShipmentsQueue`; hueco 1 («Ubicar», solo envío directo) en `ShipPreparationCard`.
 */
export function M4View({ initialTab = 'preparar' }: { initialTab?: M4Tab }) {
  const t = useTranslations('admin.m4');
  const tModules = useTranslations('admin.modules'); // §37.2a-2: h1 = rótulo del menú (candado P66-2)
  const ts = useTranslations('admin.m4.prep.ship');
  const tc = useTranslations('common');
  const tStatus = useTranslations('status.shipment');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();

  const [tab, setTab] = useState<M4Tab>(initialTab);
  const tabRefs = useRef<Record<M4Tab, HTMLButtonElement | null>>({ preparar: null, reponer: null, envios: null });
  const summary = usePickingSummary();

  const selectTab = useCallback((next: M4Tab) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === 'preparar') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: M4Tab) {
    const idx = M4_TABS.indexOf(current);
    let next: M4Tab | null = null;
    if (e.key === 'ArrowRight') next = M4_TABS[(idx + 1) % M4_TABS.length];
    else if (e.key === 'ArrowLeft') next = M4_TABS[(idx - 1 + M4_TABS.length) % M4_TABS.length];
    else if (e.key === 'Home') next = M4_TABS[0];
    else if (e.key === 'End') next = M4_TABS[M4_TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  }

  // --- Captura de guía (contrato §M4 · POST /admin/shipments/:id/tracking; un diálogo, dos puertas) ---
  const [trackingTarget, setTrackingTarget] = useState<TrackingTarget | null>(null);
  const [carrierValue, setCarrierValue] = useState('');
  const [trackingNumberValue, setTrackingNumberValue] = useState('');
  const [shippingCostValue, setShippingCostValue] = useState('');
  const [trackingSaved, setTrackingSaved] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<{ text: string; link?: { href: string; label: string } } | null>(null);

  const shippingCostCents = pesosToCents(shippingCostValue);
  const shippingCostInvalid = shippingCostValue.trim() !== '' && (shippingCostCents === null || shippingCostCents < 0);

  const trackingMutation = useMutation({
    mutationFn: (target: TrackingTarget) => {
      const body: ShipmentTrackingRequest = { carrier: carrierValue.trim(), trackingNumber: trackingNumberValue.trim() };
      if (shippingCostCents !== null) body.shippingCostCents = shippingCostCents;
      return saveShipmentTracking(target.id, body);
    },
    onSuccess: (_d, target) => {
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
      void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
      setTrackingSaved(target.ref);
      closeTracking();
    },
    onError: (e) => {
      // §37.6: cada 409 con su copy y su remedio; ⛔ ninguno cae a «Algo salió mal».
      const err = e instanceof ApiClientError ? e : null;
      const label = (s: unknown) => (typeof s === 'string' && tStatus.has(s) ? tStatus(s) : String(s ?? '—'));
      if (err?.status === 409 && err.code === 'SHIPMENT_NOT_PREPARED') {
        setTrackingError({ text: t('tracking.notPrepared'), link: { href: '/admin/m4', label: t('tracking.goToPrepare') } });
      } else if (err?.status === 409 && err.code === 'SHIPMENT_HAS_OPEN_REPLACEMENTS') {
        const ids = (err.details?.caseIds as unknown[] | undefined) ?? [];
        setTrackingError({ text: t('tracking.openReplacements', { count: Math.max(1, ids.length) }), link: { href: '/admin/m4?tab=reponer', label: t('tracking.goToReplace') } });
      } else if (err?.status === 409 && err.code === 'ORDER_NOT_SETTLED') {
        setTrackingError({ text: t('tracking.orderNotSettled', { status: label(err.details?.orderStatus) }) });
      } else if (err?.status === 409 && err.code === 'WITHDRAWAL_LINE_ORIGIN_REFUNDED') {
        const items = (err.details as Partial<WithdrawalLineOriginRefundedDetails> | undefined)?.items ?? [];
        setTrackingError({
          text: t('tracking.originRefunded', { count: Math.max(1, items.length), items: items.map((i) => `${i.folio ?? i.inventoryItemId} · ${i.orderNumber ?? i.orderId ?? '—'}`).join('; ') }),
          link: items[0]?.orderId ? { href: `/admin/m3/${items[0].orderId}`, label: `${t('viewOrder')} ${items[0].orderNumber ?? items[0].orderId}` } : undefined,
        });
      } else {
        setTrackingError({ text: getError(e) });
      }
    },
  });

  function openTracking(target: TrackingTarget) {
    setTrackingTarget(target);
    setCarrierValue(target.carrier ?? '');
    setTrackingNumberValue(target.trackingNumber ?? '');
    setShippingCostValue('');
    setTrackingSaved(null);
    setTrackingError(null);
    trackingMutation.reset();
  }
  function closeTracking() {
    setTrackingTarget(null);
    setCarrierValue('');
    setTrackingNumberValue('');
    setShippingCostValue('');
  }
  const openFromRow = (s: AdminShipmentDTO) => openTracking({ id: s.id, ref: s.orderNumber ?? s.id, carrier: s.carrier ?? null, trackingNumber: s.trackingNumber ?? null });
  const openFromCard = (o: ShipPreparationOrderDTO) => openTracking({ id: o.shipmentId, ref: o.orderNumber ?? o.shipmentId, carrier: null, trackingNumber: null });

  const canSubmitTracking = carrierValue.trim() !== '' && trackingNumberValue.trim() !== '' && !shippingCostInvalid;

  useEffect(() => {
    if (initialTab !== 'preparar') tabRefs.current[initialTab]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prepareCount = (summary.data?.ship ?? 0) + (summary.data?.vault ?? 0);
  const replaceCount = summary.data?.toReplace ?? 0;
  const overdue = summary.data?.toReplaceOverdue ?? 0;

  const tabLabel = (key: M4Tab) => {
    if (key === 'preparar') return summary.data ? t('tabs.withCount', { label: t('tabs.prepare'), count: prepareCount }) : t('tabs.prepare');
    if (key === 'reponer') return summary.data ? t('tabs.withCases', { label: t('tabs.replace'), count: replaceCount }) : t('tabs.replace');
    return t('tabs.shipments');
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{tModules('m4')}</h1>

      {/* §37.2 — pestañas de página (patrón APG tablist, flechas, `?tab=`); el conteo va DENTRO del nombre accesible. */}
      <div className="flex gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label={tModules('m4')}>
        {M4_TABS.map((key) => {
          const active = tab === key;
          const count = key === 'preparar' ? prepareCount : key === 'reponer' ? replaceCount : null;
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`m4-tab-${key}`}
              aria-selected={active}
              aria-controls={`m4-panel-${key}`}
              aria-label={tabLabel(key)}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(key)}
              onKeyDown={(e) => onTabKeyDown(e, key)}
              className={cn(
                '-mb-px inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-1 text-sm',
                active ? 'border-text text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              <span>{key === 'preparar' ? t('tabs.prepare') : key === 'reponer' ? t('tabs.replace') : t('tabs.shipments')}</span>
              {summary.data && count !== null && (
                <span
                  aria-hidden
                  data-testid={`m4-tab-badge-${key}`}
                  className={cn('tabular font-mono text-[11px]', key === 'reponer' && overdue > 0 ? 'text-accent' : 'text-muted')}
                >
                  {count}
                  {key === 'reponer' && overdue > 0 && <> {t('tabs.overdueSuffix', { count: overdue })}</>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {trackingSaved && (
        <Banner variant="success" role="status">
          {ts('guide.saved', { ref: trackingSaved })}
        </Banner>
      )}

      <div role="tabpanel" id={`m4-panel-${tab}`} aria-labelledby={`m4-tab-${tab}`}>
        {tab === 'preparar' && <PreparationQueue onCaptureGuide={openFromCard} />}
        {tab === 'reponer' && <ReplacementCasesPanel />}
        {tab === 'envios' && <ShipmentsQueue onCaptureGuide={openFromRow} />}
      </div>

      <Modal
        open={trackingTarget !== null}
        onClose={closeTracking}
        title={t('tracking.title')}
        footer={
          <>
            <Button variant="ghost" onClick={closeTracking}>
              {tc('cancel')}
            </Button>
            <Button disabled={!canSubmitTracking} loading={trackingMutation.isPending} onClick={() => trackingTarget && trackingMutation.mutate(trackingTarget)}>
              {t('tracking.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {trackingTarget && (
            <p className="text-sm text-muted">
              <span className="tabular font-medium text-text">{trackingTarget.ref}</span>
              {trackingTarget.ref !== trackingTarget.id && <> · {trackingTarget.id}</>}
            </p>
          )}
          <Input label={t('tracking.carrierLabel')} type="text" value={carrierValue} onChange={(e) => setCarrierValue(e.target.value)} />
          <Input label={t('tracking.numberLabel')} type="text" inputMode="numeric" value={trackingNumberValue} onChange={(e) => setTrackingNumberValue(e.target.value)} />
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
          {!shippingCostInvalid && shippingCostCents !== null && <p className="text-xs text-muted">= {formatMoneyCents(shippingCostCents, locale)}</p>}
          {trackingError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              <p>{trackingError.text}</p>
              {trackingError.link && (
                <Link href={trackingError.link.href} className="text-text underline underline-offset-4 hover:text-accent" onClick={closeTracking}>
                  {trackingError.link.label}
                </Link>
              )}
            </Banner>
          )}
        </div>
      </Modal>
    </div>
  );
}
