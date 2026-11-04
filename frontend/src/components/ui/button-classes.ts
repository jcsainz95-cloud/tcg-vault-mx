import { cn } from '@/lib/cn';

/*
 * SIN directiva `'use client'` a propósito (techlead TL-CTA R2): esta función la llaman también los Server Components
 * para dar a un `<Link>` el aspecto de botón. Si este módulo fuese de cliente, en un Server Component la importación
 * sería una referencia de cliente y llamarla revienta al renderizar. Candado: `button-classes.test.tsx`.
 *
 * Dirección 5a: el botón es un rectángulo de tinta o una regla, nunca una pastilla con sombra. La etiqueta va en
 * versalitas muy espaciadas; el rojo TCG HUNT (--color-accent, §17.2) se reserva para el compromiso final (pagar,
 * enviar solicitud). Hover de accent/destructive: --hunt-red-hover (#8F0E12, 8.3:1).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'accent' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'border border-text text-text hover:bg-text hover:text-primary-fg',
  ghost: 'text-text hover:text-accent',
  destructive: 'bg-accent text-accent-fg hover:bg-[color:var(--hunt-red-hover)]',
  accent: 'bg-accent text-accent-fg hover:bg-[color:var(--hunt-red-hover)]',
  link: 'text-accent border-b border-accent px-0 pb-1 hover:text-text hover:border-text',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-[44px] px-4 text-[10px] tracking-label sm:min-h-0 sm:py-3',
  md: 'min-h-[44px] px-5 py-4 text-[11px] tracking-label',
  lg: 'min-h-[48px] px-8 py-5 text-xs tracking-[0.16em]',
};

/**
 * Las clases del botón, para un `<Link>` que navega pero se ve como botón (DESIGN_SYSTEM §CTA-UX.3: «Entrar» de
 * `/account-setup`, enlaces de `/reset-password`, la puerta de `#password` en «Mi cuenta»). Una sola fuente: `Button`
 * las usa igual, así que un enlace-botón no puede quedarse con otro radio ni otra etiqueta.
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 font-medium transition-colors',
    // Deshabilitado: el botón no desaparece, se queda como una regla apagada.
    'disabled:cursor-not-allowed disabled:border disabled:border-border-strong disabled:bg-transparent disabled:text-muted',
    variant === 'link' ? 'text-sm' : cn('uppercase leading-none', sizes[size]),
    variants[variant],
    className,
  );
}
