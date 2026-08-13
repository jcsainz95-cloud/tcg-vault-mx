'use client';

import { useState } from 'react';
import { Info, CheckCircle2, AlertTriangle, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'info' | 'success' | 'warning' | 'danger' | 'trust';

const styles: Record<Variant, string> = {
  info: 'bg-info-bg text-info border-info/40',
  success: 'bg-success-bg text-success border-success/40',
  warning: 'bg-warning-bg text-warning border-warning/40',
  danger: 'bg-danger-bg text-danger border-danger/40',
  trust: 'bg-info-bg text-info border-info/40',
};

const iconFor: Record<Variant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
  trust: ShieldCheck,
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
  const Icon = iconFor[variant];
  return (
    <div
      role={role}
      className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm', styles[variant], className)}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-text">{title}</p>}
        <div className="text-text/90">{children}</div>
      </div>
      {action}
      {dismissible && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="ml-1 shrink-0 rounded-sm p-1 hover:bg-black/5"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
