import { cn } from '@/lib/cn';
import type { BadgeShape, BadgeTone } from '@/lib/status-map';

export interface BadgeProps {
  tone?: BadgeTone;
  shape?: BadgeShape;
  className?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

const softTone: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  accent: 'bg-accent/15 text-accent',
  primary: 'bg-primary/15 text-primary',
  neutral: 'bg-surface-2 text-muted',
};

const outlineTone: Record<BadgeTone, string> = {
  success: 'border border-success text-success',
  warning: 'border border-warning text-warning',
  danger: 'border border-danger text-danger',
  info: 'border border-info text-info',
  accent: 'border border-accent text-accent',
  primary: 'border border-primary text-primary',
  neutral: 'border border-border-strong text-muted',
};

export function Badge({ tone = 'neutral', shape = 'soft', className, children, icon }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        shape === 'soft' ? softTone[tone] : outlineTone[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
