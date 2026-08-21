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
 * Banda superior de 3px (§16.6): `normal` = SIN banda (conserva el borde base de 1px);
 * `reverse_holo` = gradiente 90° neutral-warm→bermellón (la ÚNICA superficie con gradiente
 * permitida en el sistema — guiño foil); holos = sólida tinta. Decorativa (`aria-hidden`).
 */
export function FinishBand({ finish, className }: { finish: Finish; className?: string }) {
  if (finish === 'normal') return null;
  // SB-D8: tokens vivos del sistema con fallback a los hex de DESIGN_SYSTEM §16.6 (mismo
  // criterio que PortfolioTrendChart) — si el tema recalibra, la banda acompaña sin drift.
  const background =
    finish === 'reverse_holo'
      ? 'linear-gradient(90deg, var(--color-neutral-warm, #9A6C57) 0%, var(--color-accent, #B44B3A) 100%)'
      : 'var(--color-ink, #1A1A18)';
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
