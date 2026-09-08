'use client';

import { useTranslations } from 'next-intl';
import { Badge } from './Badge';
import { getBadgeSpec, type StatusDomain } from '@/lib/status-map';

export interface StatusBadgeProps {
  domain: StatusDomain;
  value: string;
  /**
   * Segundo campo que refina el mapeo (DESIGN_SYSTEM §23.1d). Hoy su único uso es
   * `domain="sellRequest"` + `value="expirada"`, donde el color y la versalita los decide
   * `expiredReason` y no el estado: `not_shipped` acusa al vendedor, `no_offer` nos acusa a
   * nosotros. Ausente/`null` ⇒ fallback neutro, que **nunca** es la versión acusatoria.
   */
  reason?: string | null;
}

/**
 * Badge de estado de dominio: color + texto localizado.
 *
 * Dirección 5a: el icono desaparece. La regla de accesibilidad era no cifrar el
 * estado SOLO en el color (DESIGN_SYSTEM §2.4/§7.4); aquí el segundo canal es la
 * propia etiqueta en versalitas —LIQUIDADA, PENDIENTE, EN PROCESO—, que siempre
 * se pinta, así que el color sigue siendo redundante y no portador.
 */
export function StatusBadge({ domain, value, reason }: StatusBadgeProps) {
  const t = useTranslations();
  const spec = getBadgeSpec(domain, value, reason);
  return (
    <Badge tone={spec.tone} shape={spec.shape}>
      {t(spec.i18nKey)}
    </Badge>
  );
}
