'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { LanguageChip, StampChip } from '@/components/domain/VersionChip';
import type { VersionDTO } from '@/types/contract';

/**
 * §IDS-UX.3 (lista de inventario admin, `02-inventario-admin-v3`): las dos columnas internas de una pieza.
 *  - **Idioma**: inglés = «EN» (etiqueta mono gris, no insignia); español = insignia «Español».
 *  - **Sello** (la cabecera interna se queda): insignia de tipo + el detalle exacto del proveedor en texto muted
 *    (`stamp.label`, solo admin), o «—».
 * Sin `version` (servidor anterior a §IDS) ⇒ inglés sin liga.
 */
export function PieceVersion({ version, className }: { version?: VersionDTO | null; className?: string }) {
  const t = useTranslations('admin.m1.ids');
  const v = version ?? { key: 'en', language: 'en' as const, stamp: null };
  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-testid="piece-version">
      <span aria-label={t('column.language')} className="inline-flex items-center">
        {v.language === 'en' ? (
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted">EN</span>
        ) : (
          <LanguageChip language={v.language} />
        )}
      </span>
      <span aria-label={t('column.stamp')} className="inline-flex items-center gap-1">
        {v.stamp ? (
          <>
            <StampChip type={v.stamp.type} />
            {v.stamp.label && <span className="text-[12px] text-muted">{v.stamp.label}</span>}
          </>
        ) : (
          <span className="text-[12px] text-muted">—</span>
        )}
      </span>
    </span>
  );
}

export type LanguageFilter = 'all' | 'en' | 'es';
export type StampFilter = 'all' | 'true' | 'false';

/** Filtros de un toque `Idioma: Todos | Inglés | Español` y `Sello: Todos | Con sello | Sin sello` (§16.1, interno). */
export function PieceVersionFilters({
  language,
  stamped,
  onLanguage,
  onStamped,
}: {
  language: LanguageFilter;
  stamped: StampFilter;
  onLanguage: (v: LanguageFilter) => void;
  onStamped: (v: StampFilter) => void;
}) {
  const t = useTranslations('admin.m1.ids.filter');
  const tv = useTranslations('version');
  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-9 items-center border px-3 text-xs font-medium transition-colors',
      active ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
    );
  const langs: [LanguageFilter, string][] = [
    ['all', t('languageAll')],
    ['en', tv('language.en')],
    ['es', tv('language.es')],
  ];
  const stamps: [StampFilter, string][] = [
    ['all', t('stampAll')],
    ['true', t('stampYes')],
    ['false', t('stampNo')],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="piece-version-filters">
      <div role="group" aria-label={t('language')} className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{t('language')}</span>
        {langs.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={language === v} className={chip(language === v)} onClick={() => onLanguage(v)}>
            {label}
          </button>
        ))}
      </div>
      <div role="group" aria-label={t('stamp')} className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{t('stamp')}</span>
        {stamps.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={stamped === v} className={chip(stamped === v)} onClick={() => onStamped(v)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
