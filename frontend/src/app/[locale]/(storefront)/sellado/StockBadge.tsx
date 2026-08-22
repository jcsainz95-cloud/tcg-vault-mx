'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Distintivo de stock del sellado (artboards 1a/2a): cantidades REALES del
 * endpoint de grupos — «N en stock» en verde, «Último» en rojo cuando queda
 * una sola pieza, «Agotado» en muted. Texto mono en versalitas: el color es
 * redundante, no portador (§2.4).
 */
export function StockBadge({ count, className }: { count: number; className?: string }) {
  const t = useTranslations('sealed');
  const label = count === 0 ? t('soldOut') : count === 1 ? t('lastOne') : t('inStock', { count });
  const tone = count === 0 ? 'text-muted' : count === 1 ? 'text-accent' : 'text-success';
  return (
    <p
      className={cn(
        'tabular font-mono text-[10px] uppercase leading-none tracking-[0.12em]',
        tone,
        className,
      )}
    >
      {label}
    </p>
  );
}
