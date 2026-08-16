'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'info' | 'success' | 'warning' | 'danger' | 'trust';

/*
 * Dirección 5a: los avisos dejan de ser cajas de color y pasan a ser notas al
 * margen con regla. La regla bermellón marca lo que compromete al usuario
 * (ventas finales, solo NM, titularidad pendiente); el resto lleva regla fina
 * neutra para no gritar. `role` sigue distinguiendo status de alert.
 */
const ruleFor: Record<Variant, string> = {
  info: 'border-l border-border-strong',
  success: 'border-l-2 border-success',
  warning: 'border-l-2 border-accent',
  danger: 'border-l-2 border-accent',
  trust: 'border-l-2 border-accent',
};

export interface BannerProps {
  variant?: Variant;
  title?: string;
  children: React.ReactNode;
  dismissible?: boolean;
  action?: React.ReactNode;
  className?: string;
  role?: 'status' | 'alert';
}

export function Banner({
  variant = 'info',
  title,
  children,
  dismissible,
  action,
  className,
  role = 'status',
}: BannerProps) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div
      role={role}
      className={cn('flex items-start gap-4 py-1 pl-4 text-sm leading-relaxed', ruleFor[variant], className)}
    >
      <div className="min-w-0 flex-1 text-muted">
        {title && <p className="font-medium text-text">{title}</p>}
        <div>{children}</div>
      </div>
      {action}
      {dismissible && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="ml-1 shrink-0 p-1 text-muted hover:text-text"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
