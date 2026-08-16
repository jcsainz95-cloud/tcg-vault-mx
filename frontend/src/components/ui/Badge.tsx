import { cn } from '@/lib/cn';
import type { BadgeShape, BadgeTone } from '@/lib/status-map';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  shape?: BadgeShape;
  className?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

/*
 * Dirección 5a: un estado es texto mono en versalitas del color de su tono
 * (LIQUIDADA en verde, PENDIENTE en bermellón). `soft` pierde la pastilla por
 * completo; `outline` conserva una regla de 1px para lo que debe frenar la
 * lectura, como PRECIO PENDIENTE.
 */
const toneColor: Record<BadgeTone, string> = {
  success: 'text-success',
  warning: 'text-accent',
  danger: 'text-accent',
  info: 'text-muted',
  accent: 'text-accent',
  primary: 'text-text',
  neutral: 'text-muted',
};

const outlineBorder: Record<BadgeTone, string> = {
  success: 'border-success',
  warning: 'border-accent',
  danger: 'border-accent',
  info: 'border-border-strong',
  accent: 'border-accent',
  primary: 'border-text',
  neutral: 'border-border-strong',
};

export function Badge({ tone = 'neutral', shape = 'soft', className, children, icon, ...rest }: BadgeProps) {
  const focusable = rest.tabIndex !== undefined && rest.tabIndex >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[11px] font-normal uppercase leading-none tracking-[0.06em]',
        toneColor[tone],
        shape === 'outline' && cn('border px-2 py-1.5', outlineBorder[tone]),
        focusable && 'cursor-help',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
