'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { DATE_PRESETS, presetRange } from '@/lib/dateRange';

/**
 * Botones rápidos de rango (Esta semana / Último mes / Este trimestre / Este año).
 * Al hacer click setean `from`/`to` vía `onSelect`. Complementa el selector manual.
 * Usado por M7 (Finanzas) y M9 (Reportes) — mismos presets.
 */
export function DateRangePresets({
  onSelect,
}: {
  onSelect: (range: { from: string; to: string }) => void;
}) {
  const t = useTranslations('common.datePresets');
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('label')}>
      {DATE_PRESETS.map((p) => (
        <Button key={p} variant="ghost" size="sm" onClick={() => onSelect(presetRange(p))}>
          {t(p)}
        </Button>
      ))}
    </div>
  );
}
