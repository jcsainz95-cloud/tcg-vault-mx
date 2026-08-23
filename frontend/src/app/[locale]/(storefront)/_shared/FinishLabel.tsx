'use client';

import { useTranslations } from 'next-intl';
import type { Finish, ProductType } from '@/types/contract';
import { cn } from '@/lib/cn';

/**
 * Etiqueta discreta del ACABADO de una publicación de carta (P-40): Normal /
 * Reverse Holo / Holofoil, legible e i18n (claves `finish.*`, es/en).
 *
 * Sigue el lenguaje del rediseño (dirección 5a): renglón mono sobrio, NO una
 * pastilla con caja — el makeover sustituyó a propósito la fila de pastillas por
 * texto mono (ver ListingSpec). Se lee sin competir con el arte.
 *
 * El SELLADO no tiene acabado de carta (H9): para `productType === 'sealed'` NO
 * se pinta nada (devuelve null). Los grupos de catálogo/featured son raw|graded
 * por contrato, así que el guard es defensivo pero acepta el tipo ancho.
 */
export function FinishLabel({
  finish,
  productType,
  className,
}: {
  finish: Finish;
  productType: ProductType;
  className?: string;
}) {
  const t = useTranslations('finish');
  if (productType === 'sealed') return null;
  return (
    <span
      className={cn(
        'inline-block font-mono text-[9px] uppercase leading-none tracking-[0.12em] text-muted sm:text-[10px]',
        className,
      )}
    >
      {t(finish)}
    </span>
  );
}
