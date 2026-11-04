'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button-classes';

/*
 * Las clases viven en `./button-classes` (sin `'use client'`): un Server Component que necesite el aspecto de botón
 * importa `buttonClassName` de ahí, nunca de este módulo de cliente (techlead TL-CTA R2).
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={buttonClassName({ variant, size, className })}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
