'use client';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Micropatrón «link editorial» del makeover 1a (DESIGN_SYSTEM §20.0) — R3:
 * - `accent`: acción secundaria de marca — 11px 500 uppercase tracking-label,
 *   tinta, subrayado rojo (`border-b accent` + pb 1.5); hover: el subrayado
 *   pasa a tinta.
 * - `muted`: link terciario sin subrayado («Ver todo el catálogo»); hover: tinta.
 *
 * Con `href` renderiza un `Link`; con `onClick` (sin href) un `<button>` real
 * (p. ej. abrir la guía de envío). `className` puede matizar por sitio
 * (márgenes, variantes responsivas) — twMerge resuelve los conflictos.
 */
export interface EditorialLinkProps {
  variant?: 'accent' | 'muted';
  href?: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

const BASE = 'text-[11px] font-medium uppercase tracking-label transition-colors';
const VARIANTS: Record<'accent' | 'muted', string> = {
  accent: 'border-b border-accent pb-1.5 text-text hover:border-text',
  muted: 'text-muted hover:text-text',
};

export function EditorialLink({ variant = 'accent', href, onClick, className, children }: EditorialLinkProps) {
  const classes = cn(BASE, VARIANTS[variant], className);
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
