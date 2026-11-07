'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { LanguageChip, StampChip } from '@/components/domain/VersionChip';
import { PillToggleGroup } from '@/components/domain/VersionPills';
import type { FinishLabel, VersionDTO } from '@/types/contract';

/**
 * §IDS-UX.3 (lista de inventario admin, `02-inventario-admin-v3`): las dos columnas internas de una pieza.
 *  - **Idioma**: inglés = «EN» (etiqueta mono gris, no insignia); español = insignia «Español».
 *  - **Liga** (HECHOS 2026-11-04: en el admin también se dice «de liga», no «sello»): insignia de tipo + el detalle
 *    exacto del proveedor en texto muted (`stamp.label`, solo admin), o «—».
 * Sin `version` (servidor anterior a §IDS) ⇒ inglés sin liga.
 */
export function PieceVersion({ version, className, finishLabel }: { version?: VersionDTO | null; className?: string; finishLabel?: FinishLabel | null }) {
  const t = useTranslations('admin.m1.ids');
  const tv = useTranslations('version');
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
            {finishLabel && <span className="text-[12px] text-muted">({tv(`finishLabel.${finishLabel}`)})</span>}
          </>
        ) : (
          <span className="text-[12px] text-muted">—</span>
        )}
      </span>
    </span>
  );
}

export type LanguageFilter = 'all' | 'en' | 'es';
/** Valor del query param `stamped` de `GET /admin/inventory` (contrato §16.1): se queda tal cual; solo cambia el rótulo. */
export type StampFilter = 'all' | 'true' | 'false';

/**
 * Filtros de un toque `Idioma: Todos | Inglés | Español` y `Liga: Todas | De liga | Sin liga` (§16.1, interno).
 * Mismas burbujas de 44 px que la captura (`PillToggleGroup`, IDS-UX.2 / HECHOS 2026-11-02 «Admin (C)»): `radiogroup`
 * con rótulo mono, `role="radio"` + `aria-checked`, elegida en relleno tinta. ⛔ No se dibuja aquí ninguna burbuja
 * propia: el radio redondeado vive solo en `VersionPills.tsx` (candado 13).
 */
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
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3" data-testid="piece-version-filters">
      <PillToggleGroup<LanguageFilter>
        label={t('language')}
        testId="piece-filter-language"
        value={language}
        onChange={onLanguage}
        options={[
          { value: 'all', label: t('languageAll') },
          { value: 'en', label: tv('language.en') },
          { value: 'es', label: tv('language.es') },
        ]}
      />
      <PillToggleGroup<StampFilter>
        label={t('stamp')}
        testId="piece-filter-stamp"
        value={stamped}
        onChange={onStamped}
        options={[
          { value: 'all', label: t('stampAll') },
          { value: 'true', label: t('stampYes') },
          { value: 'false', label: t('stampNo') },
        ]}
      />
    </div>
  );
}
