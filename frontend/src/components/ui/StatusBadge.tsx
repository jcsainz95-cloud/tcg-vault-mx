'use client';

import { useTranslations } from 'next-intl';
import { Badge } from './Badge';
import { getBadgeSpec, type StatusDomain } from '@/lib/status-map';

export interface StatusBadgeProps {
  domain: StatusDomain;
  value: string;
}

/**
 * Badge de estado de dominio: color + texto localizado.
 *
 * Dirección 5a: el icono desaparece. La regla de accesibilidad era no cifrar el
 * estado SOLO en el color (DESIGN_SYSTEM §2.4/§7.4); aquí el segundo canal es la
 * propia etiqueta en versalitas —LIQUIDADA, PENDIENTE, EN PROCESO—, que siempre
 * se pinta, así que el color sigue siendo redundante y no portador.
 */
export function StatusBadge({ domain, value }: StatusBadgeProps) {
  const t = useTranslations();
  const spec = getBadgeSpec(domain, value);
  return (
    <Badge tone={spec.tone} shape={spec.shape}>
      {t(spec.i18nKey)}
    </Badge>
  );
}
