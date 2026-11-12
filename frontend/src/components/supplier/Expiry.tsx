'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatAge, formatDateTimeMx } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';

/** Caducidad visible: fecha en CDMX + antigüedad relativa. Solo formatea lo que manda el servidor. */
export function Expiry({ iso, className }: { iso: string; className?: string }) {
  const t = useTranslations('supplier.expiry');
  const locale = useLocale() as AppLocale;
  const past = new Date(iso).getTime() <= Date.now();
  return (
    <p className={className ?? 'font-mono text-[11px] uppercase tracking-eyebrow text-muted'}>
      {past ? t('past', { date: formatDateTimeMx(iso, locale) }) : t('until', { date: formatDateTimeMx(iso, locale), rel: formatAge(iso, locale) })}
    </p>
  );
}
