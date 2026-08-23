'use client';

import { useTranslations } from 'next-intl';
import type { ProductType } from '@/types/contract';
import { cn } from '@/lib/cn';

/**
 * Etiqueta discreta de la RAREZA de una carta (P-44): Illustration Rare, Full Art, Special
 * Illustration Rare, Hyper Rare… Gemela del `FinishMark` — renglón mono muted, sin pastilla,
 * respeta la dirección del rediseño (el texto no compite con el arte). Vive en `components/domain`
 * (como `FinishMark`) para que la compartan la teja de catálogo, el cotizador y el binder Master Set.
 *
 * La rareza es una taxonomía ABIERTA de pokemontcg.io (términos del hobby en inglés): el VALOR
 * se pinta tal cual con `lang="en"` (no se traduce, igual que los nombres de carta); lo único i18n
 * es el prefijo accesible («Rareza: …» / «Rarity: …») que viaja en `aria-label`, no en pantalla.
 *
 * NO se pinta para SELLADO (H9: una caja/ETB no tiene rareza de carta) ni cuando la rareza viene
 * vacía/ausente (nunca inventamos un valor). El backend ya entrega `rarity` en `CardDTO`; esta
 * etiqueta solo lo MUESTRA.
 */
export function RarityLabel({
  rarity,
  productType,
  className,
}: {
  rarity?: string | null;
  productType?: ProductType;
  className?: string;
}) {
  const t = useTranslations('catalog');
  if (productType === 'sealed') return null;
  const value = rarity?.trim();
  if (!value) return null;
  return (
    <span
      lang="en"
      aria-label={t('rarityAria', { rarity: value })}
      className={cn(
        'inline-block font-mono text-[9px] uppercase leading-none tracking-[0.12em] text-muted sm:text-[10px]',
        className,
      )}
    >
      {value}
    </span>
  );
}
