'use client';

import { useTranslations } from 'next-intl';
import type { Finish } from '@/types/contract';
import { cn } from '@/lib/cn';

/**
 * Distintivo visual de acabado (DESIGN_SYSTEM §16.6, adelanto P-14) — se define UNA vez y se usa
 * IGUAL en el binder M1, el cotizador (Stream C), bóvedas y storefront.
 *
 * Doble canal (regla §2.4): la BANDA de 3px es decorativa (`aria-hidden`); el significado lo porta
 * la ETIQUETA mono, presente SIEMPRE (nunca banda sin texto). La etiqueta NO se traduce por locale
 * (REVERSE/HOLO son términos del hobby); el nombre legible localizado va en `title`/`aria-label`.
 */

/** Clave i18n de la etiqueta corta (§16.10 `finish.{normal,reverse,holo,firstEdHolo}`). */
const MARK_KEY: Record<Finish, string> = {
  normal: 'normal',
  reverse_holo: 'reverse',
  holofoil: 'holo',
  first_edition_holofoil: 'firstEdHolo',
};

/**
 * Mapeo ESTRICTO finish→color de la banda (§16.6). FUENTE ÚNICA del color: la usan TODAS las
 * vistas que pintan la banda (binder M1, bóveda cliente, bóveda admin, cotizador, línea del
 * carrito de venta, TopBountiesShelf, VariantDrawer). El color depende SOLO del acabado de ESTA
 * teja — jamás de qué otras variantes tenga la carta ni del orden en que aparezcan.
 *
 * Spec del humano 2026-08 (PENDIENTE de ratificar por ux-ui en DESIGN_SYSTEM §16.6):
 *   reverse_holo → ROJO de marca (`--color-finish-reverse` = `--color-accent`)
 *   holofoil     → AZUL          (`--color-finish-holo`, token NUEVO: no había azul en la paleta)
 *   normal       → SIN banda (conserva el borde base de 1px)
 *   first_edition_holofoil → sin cambio (tinta): no es reverse ni holofoil, se deja como estaba.
 *
 * Consistencia (bug reportado): antes reverse_holo era un GRADIENTE 90° neutral-warm→bermellón
 * (color que varía a lo ancho de la banda según el tamaño de la teja) y holofoil compartía la
 * MISMA tinta oscura que first_edition_holofoil (dos foils indistinguibles). Al ver una carta con
 * holofoil Y reverse holo, las dos bandas leían como "muddy/oscuro" y el reverse "cambiaba de
 * color" a lo ancho → percepción de inconsistencia. Ahora cada finish tiene un color SÓLIDO y
 * estable.
 *
 * SB-D8: tokens vivos del sistema con fallback al hex de DESIGN_SYSTEM §16.6 (si el tema recalibra,
 * la banda acompaña sin drift) — nunca hex hardcodeado a secas.
 */
const FINISH_BAND_BACKGROUND: Partial<Record<Finish, string>> = {
  reverse_holo: 'var(--color-finish-reverse, var(--color-accent, #B31217))', // rojo
  holofoil: 'var(--color-finish-holo, #1F5C8F)', // azul (token nuevo)
  first_edition_holofoil: 'var(--color-ink, #1A1A18)', // sin cambio (tinta)
};

/**
 * Banda superior de 3px (§16.6): `normal` = SIN banda (conserva el borde base de 1px); el resto
 * pinta el color SÓLIDO de su acabado según `FINISH_BAND_BACKGROUND`. Decorativa (`aria-hidden`):
 * el significado lo porta la etiqueta mono del TileHeader (doble canal, §2.4).
 */
export function FinishBand({ finish, className }: { finish: Finish; className?: string }) {
  if (finish === 'normal') return null;
  const background = FINISH_BAND_BACKGROUND[finish] ?? 'var(--color-ink, #1A1A18)';
  return (
    <span
      aria-hidden
      data-testid="finish-band"
      data-finish={finish}
      className={cn('block h-[3px] w-full', className)}
      style={{ background }}
    />
  );
}

export interface FinishMarkProps {
  finish: Finish;
  /** Pinta también la banda de 3px arriba de la etiqueta (default true). */
  band?: boolean;
  className?: string;
}

/** Banda (opcional) + etiqueta mono SIEMPRE visible. */
export function FinishMark({ finish, band = true, className }: FinishMarkProps) {
  const t = useTranslations('finish');
  return (
    <span className={cn('inline-flex flex-col gap-0.5', className)}>
      {band && <FinishBand finish={finish} />}
      <span
        // Nombre legible localizado como canal accesible complementario.
        title={t(finish)}
        aria-label={t(finish)}
        className={cn(
          'font-mono text-[10px] uppercase tracking-[0.18em]',
          finish === 'normal' ? 'text-muted' : 'text-text',
        )}
      >
        {t(MARK_KEY[finish])}
      </span>
    </span>
  );
}
