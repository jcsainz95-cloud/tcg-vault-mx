'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePickingSummary } from '@/hooks/usePickingSummary';
import { Banner } from '@/components/ui/Banner';
import { cn } from '@/lib/cn';
import type { AdminShipmentDTO, ShipPreparationOrderDTO } from '@/types/contract';
import { CaptureLabelDialog, type CaptureSaved, type CaptureTarget } from './CaptureLabelDialog';
import { PreparationQueue } from './PreparationQueue';
import { ShipmentsQueue } from './ShipmentsQueue';
import { ReplacementCasesPanel } from './ReplacementCasesPanel';
import { M4_TABS, type M4Tab } from './tabs';
import { DepartureBoard } from './DepartureBoard';

// `pesosToCents` vive en su propio módulo (función pura, sin React).
import { pesosToCents } from './pesosToCents';
export { pesosToCents };

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
export function M4View({
  initialTab = 'preparar',
  initialFolio = null,
  initialAlert = false,
}: {
  initialTab?: M4Tab;
  initialFolio?: string | null;
  initialAlert?: boolean;
}) {
  const t = useTranslations('admin.m4');
  const tModules = useTranslations('admin.modules'); // §37.2a-2: h1 = rótulo del menú (candado P66-2)
  const ts = useTranslations('admin.m4.prep.ship');
  const tSdx = useTranslations('admin.m4.tracking.sdx');

  const [tab, setTab] = useState<M4Tab>(initialTab);
  const tabRefs = useRef<Record<M4Tab, HTMLButtonElement | null>>({ preparar: null, reponer: null, envios: null, salida: null });
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

  // --- «Capturar guía» (contrato §M4 · POST …/tracking y §M4-SHIP.19.19.13): UNA ventana, dos puertas ---
  // La ventana vive en `CaptureLabelDialog` (FS-1); aquí solo se decide QUÉ envío abre y qué dice la página
  // al guardar. `openSeq` la monta limpia en cada apertura (nada de lo cotizado sobrevive a un cierre).
  const [trackingTarget, setTrackingTarget] = useState<CaptureTarget | null>(null);
  const [openSeq, setOpenSeq] = useState(0);
  const [saved, setSaved] = useState<CaptureSaved | null>(null);

  function openTracking(target: CaptureTarget) {
    setSaved(null);
    setOpenSeq((n) => n + 1);
    setTrackingTarget(target);
  }
  const closeTracking = () => setTrackingTarget(null);
  // 🔒 §43.19.7 (FS-32): el folio viaja a la cabecera de la ventana (⛔ sin uuid cuando lo hay).
  const openFromRow = (s: AdminShipmentDTO) =>
    openTracking({ id: s.id, ref: s.orderNumber ?? s.folio ?? s.id, carrier: s.carrier ?? null, trackingNumber: s.trackingNumber ?? null, folio: s.folio ?? null, orderNumber: s.orderNumber ?? null });
  const openFromCard = (o: ShipPreparationOrderDTO) =>
    openTracking({ id: o.shipmentId, ref: o.orderNumber ?? o.folio ?? o.shipmentId, carrier: null, trackingNumber: null, folio: o.folio ?? null, orderNumber: o.orderNumber });

  useEffect(() => {
    if (initialTab !== 'preparar') tabRefs.current[initialTab]?.focus();
    // §60.9 a: en el celular las pestañas desplazan en horizontal; la activa siempre a la vista al cargar.
    tabRefs.current[initialTab]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prepareCount = (summary.data?.ship ?? 0) + (summary.data?.vault ?? 0);
  const replaceCount = summary.data?.toReplace ?? 0;
  const overdue = summary.data?.toReplaceOverdue ?? 0;

  const tabLabel = (key: M4Tab) => {
    if (key === 'preparar') return summary.data ? t('tabs.withCount', { label: t('tabs.prepare'), count: prepareCount }) : t('tabs.prepare');
    if (key === 'reponer') return summary.data ? t('tabs.withCases', { label: t('tabs.replace'), count: replaceCount }) : t('tabs.replace');
    if (key === 'salida') return t('tabs.departure');
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
              <span>{key === 'preparar' ? t('tabs.prepare') : key === 'reponer' ? t('tabs.replace') : key === 'salida' ? t('tabs.departure') : t('tabs.shipments')}</span>
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

      {saved && (
        <Banner variant="success" role="status">
          {saved.kind === 'skydropx'
            ? tSdx('label.saved', { ref: saved.ref, carrier: saved.carrier, number: saved.number })
            : ts('guide.saved', { ref: saved.ref })}
        </Banner>
      )}

      <div role="tabpanel" id={`m4-panel-${tab}`} aria-labelledby={`m4-tab-${tab}`}>
        {tab === 'preparar' && <PreparationQueue onCaptureGuide={openFromCard} />}
        {tab === 'reponer' && <ReplacementCasesPanel />}
        {tab === 'envios' && <ShipmentsQueue onCaptureGuide={openFromRow} initialFolio={initialFolio} initialAlert={initialAlert} />}
        {tab === 'salida' && <DepartureBoard />}
      </div>

      <CaptureLabelDialog key={openSeq} target={trackingTarget} onClose={closeTracking} onSaved={setSaved} />
    </div>
  );
}
