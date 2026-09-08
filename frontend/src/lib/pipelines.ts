'use client';

import { useTranslations } from 'next-intl';
import type { Step } from '@/components/ui/PipelineStepper';

/** Pasos del pipeline de envío (contrato ShipmentStatus). */
export function useShipmentSteps(): Step[] {
  const t = useTranslations('status.shipment');
  return [
    { key: 'solicitado', label: t('solicitado') },
    { key: 'picking', label: t('picking') },
    { key: 'guia', label: t('guia') },
    { key: 'enviado', label: t('enviado') },
    { key: 'entregado', label: t('entregado') },
  ];
}

/**
 * Pasos del pipeline de envío con el TEXTO DE CLIENTE del contrato §5 (v1.17-withdrawal-lifecycle),
 * para la vista de RASTREO de retiros del cliente. Difiere de `useShipmentSteps` (labels operativos de
 * back-office `status.shipment.*`): aquí se usa la tabla normativa etapa→texto cliente (`shipmentStage.*`).
 */
export function useShipmentClientSteps(): Step[] {
  const t = useTranslations('shipmentStage');
  return [
    { key: 'solicitado', label: t('solicitado') },
    { key: 'picking', label: t('picking') },
    { key: 'guia', label: t('guia') },
    { key: 'enviado', label: t('enviado') },
    { key: 'entregado', label: t('entregado') },
  ];
}

/**
 * Pasos del pipeline de buylist (contrato `SellRequestStatus`, DESIGN_SYSTEM §23.2a).
 *
 * ⚠️ **Son OCHO desde v1.51 (M-46).** Eran cinco, y esa lista se escribió cuando el enum tenía
 * cinco pasos vivos: al crecer el enum, una solicitud `ofertada`/`aceptada`/`en_transito`
 * caía en `currentIdx === -1` y **el stepper no marcaba ningún paso como actual** — el estado
 * desaparecía de la pantalla sin que nada fallara. Es la misma clase de defecto que
 * `REQUEST_TERMINAL`: una lista de literales que hay que acordarse de ampliar.
 *
 * Los TERMINALES (`rechazada`, `abandonada`, `expirada`) **no son pasos** y no entran aquí:
 * son un CIERRE del recorrido (§23.2d). La representación de ese cierre —truncar el stepper y
 * colgar la versalita del motivo— es rediseño de `PipelineStepper` y está pendiente; hoy una
 * solicitud terminal simplemente no marca paso actual, que es el comportamiento previo.
 */
export function useBuylistSteps(): Step[] {
  const t = useTranslations('status.sellRequest');
  return [
    { key: 'cotizada', label: t('cotizada') },
    { key: 'ofertada', label: t('ofertada') },
    { key: 'aceptada', label: t('aceptada') },
    { key: 'en_transito', label: t('en_transito') },
    { key: 'recibida', label: t('recibida') },
    { key: 'verificacion', label: t('verificacion') },
    { key: 'aprobada', label: t('aprobada') },
    { key: 'pagada', label: t('pagada') },
  ];
}
