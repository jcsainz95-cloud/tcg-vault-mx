'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Señal ÚNICA de «precio pendiente» del storefront (R2 del pase de refactors).
 * Color canónico: **accent** — §16.4 («texto mono rojo PENDIENTE en lugar de
 * cifra») confirmado por §20.13 («el ejemplar sin precio muestra el aviso mono
 * rojo de §16.4, nunca $0»). Una sola clave i18n: `price.pendingLabel` (ya era
 * la fuente en catálogo/ficha; `home.pricePending` queda retirada).
 *
 * `hint` añade «· Lo fijaremos pronto» (`price.pendingHint`) para la fila de
 * ejemplares de la ficha. Tamaño/margen se ajustan por `className` (base 10px);
 * la consolidación final con `components/ui/PriceTag.tsx` (zona compartida)
 * queda anotada en docs/TECH_DEBT.md.
 */
export function PendingPriceLabel({ hint = false, className }: { hint?: boolean; className?: string }) {
  const t = useTranslations('price');
  return (
    <span
      className={cn(
        'font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-accent',
        className,
      )}
    >
      {t('pendingLabel')}
      {hint && <> · {t('pendingHint')}</>}
    </span>
  );
}
