'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'accent' | 'link';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/*
 * Dirección 5a: el botón es un rectángulo de tinta o una regla, nunca una pastilla
 * con sombra. La etiqueta va en versalitas muy espaciadas; el rojo TCG HUNT
 * (--color-accent, §17.2) se reserva para el compromiso final (pagar, enviar
 * solicitud). Hover de accent/destructive: --hunt-red-hover (#8F0E12, 8.3:1).
 */
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'border border-text text-text hover:bg-text hover:text-primary-fg',
  ghost: 'text-text hover:text-accent',
  destructive: 'bg-accent text-accent-fg hover:bg-[color:var(--hunt-red-hover)]',
  accent: 'bg-accent text-accent-fg hover:bg-[color:var(--hunt-red-hover)]',
  link: 'text-accent border-b border-accent px-0 pb-1 hover:text-text hover:border-text',
};

const sizes: Record<Size, string> = {
  sm: 'min-h-[44px] px-4 text-[10px] tracking-label sm:min-h-0 sm:py-3',
  md: 'min-h-[44px] px-5 py-4 text-[11px] tracking-label',
  lg: 'min-h-[48px] px-8 py-5 text-xs tracking-[0.16em]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...props },
  ref,
) {
  const isLink = variant === 'link';
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        // Deshabilitado: el botón no desaparece, se queda como una regla apagada.
        'disabled:cursor-not-allowed disabled:border disabled:border-border-strong disabled:bg-transparent disabled:text-muted',
        isLink ? 'text-sm' : cn('uppercase leading-none', sizes[size]),
        variants[variant],
        className,
      )}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
