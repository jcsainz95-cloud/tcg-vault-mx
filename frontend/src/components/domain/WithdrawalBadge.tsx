'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { ShipmentActiveStage } from '@/types/contract';

export interface WithdrawalBadgeProps {
  /** Etapa del envío activo del holding (HoldingDTO.shipmentState). */
  stage: ShipmentActiveStage;
  /** Id de la ShipmentRequest activa; si viene, el badge hace deep-link al rastreo. */
  activeShipmentId?: string | null;
  className?: string;
}

/**
 * Badge "EN RETIRO" para "Mi bóveda" (contrato §3 / v1.17-withdrawal-lifecycle). Se pinta cuando
 * `HoldingDTO.shipmentState !== null`: un chip `EN RETIRO` (acento, outline) + el label de la etapa
 * del contrato §5 (`shipmentStage.*`, texto cliente ES/EN). Cuando hay `activeShipmentId`, todo el
 * badge es un enlace al detalle del retiro (`/shipments/:id`) — el deep-link de la bóveda al rastreo.
 *
 * Sistema de diseño: reusa el primitivo `Badge` (texto mono en versalitas, sin caja de color; el
 * `outline` conserva la regla de 1px acento). El estado nunca se cifra solo en color: la etiqueta
 * "EN RETIRO" + la etapa son texto siempre visible.
 */
export function WithdrawalBadge({ stage, activeShipmentId, className }: WithdrawalBadgeProps) {
  const t = useTranslations();
  const stageLabel = t(`shipmentStage.${stage}`);
  const inner = (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <Badge tone="accent" shape="outline">
        {t('vault.inWithdrawal')}
      </Badge>
      <span className="font-mono text-[11px] leading-none text-muted">{stageLabel}</span>
    </span>
  );

  if (!activeShipmentId) return inner;
  return (
    <Link
      href={`/shipments/${activeShipmentId}`}
      className="inline-flex focus-visible:shadow-focus"
      aria-label={`${t('vault.inWithdrawal')} · ${stageLabel} · ${t('vault.trackWithdrawal')}`}
    >
      {inner}
    </Link>
  );
}
