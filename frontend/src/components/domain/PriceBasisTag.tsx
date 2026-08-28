'use client';

import { useTranslations } from 'next-intl';
import type { PriceBasis } from '@/types/contract';
import { cn } from '@/lib/cn';

/**
 * Mapa canónico `priceBasis` → versalitas (DESIGN_SYSTEM §21.9a). Es la traducción ÚNICA del enum
 * del contrato: la usan la consola compacta del binder, el drill-down, el previsualizador del
 * editor de la curva y la cola de pendientes. **Sustituye al par `REGLA`/`FALLBACK`**, que ya no
 * existe (no hay reglas: hay una curva).
 *
 * Un solo rótulo por valor del enum — `PISO` también en el eje de COMPRA, donde la constante se
 * llama «mínimo»: el nombre visible espeja el contrato y la desambiguación va en el nombre
 * accesible. Dos rótulos para un mismo valor invitarían a inventar un sexto estado.
 */
const TINT: Record<PriceBasis, string> = {
  market: 'text-muted',
  floor: 'font-medium text-text',
  override: 'font-medium text-text',
  bounty: 'text-accent',
  pending: 'border border-accent px-1 text-accent',
};

/** Sufijo de la consola compacta (§16.3a/§21.9a). `market` no grita: el caso normal no lleva marca. */
export const BASIS_SUFFIX: Partial<Record<PriceBasis, string>> = {
  floor: '·P',
  override: '·M',
  bounty: '·B',
};

export function usePriceBasisLabel() {
  const t = useTranslations('status.priceBasis');
  return (basis: PriceBasis) => t(basis);
}

/**
 * Nombre accesible del sufijo: dice QUÉ significa la marca de dos caracteres, y desambigua el
 * eje (en compra la constante es el «mínimo de compra», no el piso de venta).
 */
export function useBasisSuffixTitle() {
  const t = useTranslations('status.priceBasisTitle');
  return (basis: PriceBasis, axis: 'buy' | 'sell'): string | undefined => {
    if (basis === 'floor') return axis === 'buy' ? t('floorBuy') : t('floorSell');
    if (basis === 'override') return t('override');
    if (basis === 'bounty') return t('bounty');
    return undefined;
  };
}

export function PriceBasisTag({
  basis,
  className,
}: {
  basis: PriceBasis;
  className?: string;
}) {
  const label = usePriceBasisLabel();
  return (
    <span
      className={cn(
        'font-mono text-[10px] uppercase tracking-[0.06em]',
        TINT[basis],
        className,
      )}
    >
      {label(basis)}
    </span>
  );
}
