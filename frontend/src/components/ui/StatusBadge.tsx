'use client';

import { useTranslations } from 'next-intl';
import {
  Lock,
  LockOpen,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Info,
  Truck,
  Package,
} from 'lucide-react';
import { Badge } from './Badge';
import { getBadgeSpec, type StatusDomain, type BadgeSpec } from '@/lib/status-map';

const icons = {
  lock: Lock,
  unlock: LockOpen,
  clock: Clock,
  check: CheckCircle2,
  alert: AlertTriangle,
  info: Info,
  truck: Truck,
  package: Package,
} as const;

function renderIcon(name: BadgeSpec['icon']) {
  if (!name) return null;
  const Icon = icons[name];
  return <Icon size={13} aria-hidden />;
}

export interface StatusBadgeProps {
  domain: StatusDomain;
  value: string;
}

/**
 * Badge de estado de dominio: color + texto localizado + icono en críticos
 * (regla "estado = color + texto + icono", DESIGN_SYSTEM §2.4/§7.4).
 */
export function StatusBadge({ domain, value }: StatusBadgeProps) {
  const t = useTranslations();
  const spec = getBadgeSpec(domain, value);
  return (
    <Badge tone={spec.tone} shape={spec.shape} icon={renderIcon(spec.icon)}>
      {t(spec.i18nKey)}
    </Badge>
  );
}
