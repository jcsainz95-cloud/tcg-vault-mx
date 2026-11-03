'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { CardLanguage, StampType, VersionDTO } from '@/types/contract';

/**
 * §IDS-UX.1 — la insignia de versión. Dos clases, un componente:
 *  - **idioma** («Español» / EN «Spanish»): relleno tinta, texto papel;
 *  - **tipo** («De liga», «De torneo», «Prerelease», «Staff»; EN «Prize Pack», «League», «Championship»…): contorno
 *    1.5 px y texto `accent` #B31217.
 * Rectas (radio 0), **nunca mayúsculas ni mono** (candado 7b), `white-space: nowrap`, sin icono. Solo texto: el texto
 * visible ES el nombre accesible (nunca `aria-hidden`). ⛔ Nunca dentro del contenedor de la foto (candado 6).
 * Inglés sin liga: SIN insignia en superficies de cliente (`VersionChips` devuelve `null`).
 */
export type VersionChipSize = 'tile' | 'detail' | 'sheet';

const SIZE: Record<VersionChipSize, string> = {
  // Teja y carrito: 12 px semibold, alto 20, px 6.
  tile: 'h-5 px-1.5 text-[12px]',
  // Ficha: 13 px, alto 22.
  detail: 'h-[22px] px-1.5 text-[13px]',
  // Hoja de preparación: 13 px, alto 26.
  sheet: 'h-[26px] px-2 text-[13px]',
};

const BASE = 'inline-flex shrink-0 items-center whitespace-nowrap font-sans font-semibold normal-case leading-none tracking-normal';

export function LanguageChip({ language, size = 'tile', className }: { language: CardLanguage; size?: VersionChipSize; className?: string }) {
  const t = useTranslations('version');
  return (
    <span data-version-chip="language" className={cn(BASE, SIZE[size], 'bg-text text-primary-fg', className)}>
      {t(`language.${language}`)}
    </span>
  );
}

export function StampChip({
  type,
  size = 'tile',
  onInk = false,
  className,
}: {
  type: StampType;
  size?: VersionChipSize;
  /** Dentro de una burbuja elegida (fondo tinta): contorno y texto papel (rojo sobre tinta 2.5:1 no vale, IDS-UX.8). */
  onInk?: boolean;
  className?: string;
}) {
  const t = useTranslations('version');
  return (
    <span
      data-version-chip="stamp"
      className={cn(
        BASE,
        SIZE[size],
        'border-[1.5px] bg-transparent',
        onInk ? 'border-primary-fg text-primary-fg' : 'border-accent text-accent',
        className,
      )}
    >
      {t(`chip.${type}`)}
    </span>
  );
}

/**
 * La fila de insignias de una versión, en orden fijo idioma → tipo (IDS-UX.1). Español con liga = DOS insignias, nunca
 * una compuesta. `null` si no hay ninguna (inglés sin liga): quien la usa decide si reserva el alto.
 */
export function VersionChips({
  version,
  size = 'tile',
  className,
  testId = 'version-chips',
}: {
  version: Pick<VersionDTO, 'language' | 'stamp'> | null | undefined;
  size?: VersionChipSize;
  className?: string;
  testId?: string;
}) {
  if (!version) return null;
  const showLanguage = version.language !== 'en';
  const stamp = version.stamp;
  if (!showLanguage && !stamp) return null;
  return (
    <span data-testid={testId} className={cn('flex flex-wrap items-center gap-1', className)}>
      {showLanguage && <LanguageChip language={version.language} size={size} />}
      {stamp && <StampChip type={stamp.type} size={size} />}
    </span>
  );
}
