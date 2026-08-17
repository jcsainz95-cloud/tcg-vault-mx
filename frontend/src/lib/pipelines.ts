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

/** Pasos del pipeline de buylist (contrato SellRequestStatus). */
export function useBuylistSteps(): Step[] {
  const t = useTranslations('status.sellRequest');
  return [
    { key: 'cotizada', label: t('cotizada') },
    { key: 'recibida', label: t('recibida') },
    { key: 'verificacion', label: t('verificacion') },
    { key: 'aprobada', label: t('aprobada') },
    { key: 'pagada', label: t('pagada') },
  ];
}
