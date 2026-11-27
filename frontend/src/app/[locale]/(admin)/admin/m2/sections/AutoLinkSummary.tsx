'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { getLinkExceptions } from '@/lib/api/catalog-link-exceptions';

/**
 * §AUTO-ENLACE F2 — contador y estado del job diario `catalog-auto-link`. Lee `link-exceptions.summary`; si el
 * endpoint no responde (404 en fase 1) no pinta nada. Lectura tolerante: un campo ausente se omite, nunca se inventa.
 * El interruptor del dial `auto_link_enabled` NO está aquí: el contrato aún no expone endpoint para escribirlo.
 */
export function AutoLinkSummary() {
  const t = useTranslations('admin.m2.catalog.autoLink');
  const format = useFormatter();
  const q = useQuery({ queryKey: ['link-exceptions'], queryFn: getLinkExceptions, retry: false });
  const sm = q.data?.summary;
  if (!sm) return null;
  const at = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  const state = sm.autoLinkEnabled == null ? null : sm.autoLinkEnabled ? t('on') : t('off');
  return (
    <section aria-label={t('aria')} className="border border-border p-3 text-sm" data-testid="auto-link-summary">
      <p className="font-medium" data-testid="auto-link-counter">
        {t('counter', { remaining: sm.unlinkedCards })}
        {sm.repairedYesterday != null && ` · ${t('repaired', { n: sm.repairedYesterday })}`}
      </p>
      <p className="mt-1 text-xs text-muted" data-testid="auto-link-job">
        {state && <span className="font-medium text-ink">{t('state', { state })}</span>}
        {state && ' · '}
        {sm.lastRunAt ? t('last', { when: at(sm.lastRunAt) }) : t('neverRan')}
        {sm.autoLinkEnabled !== false && sm.nextRunAt && ` · ${t('next', { when: at(sm.nextRunAt) })}`}
        {sm.waitingDecision != null && sm.waitingDecision > 0 && ` · ${t('waiting', { n: sm.waitingDecision })}`}
      </p>
      {sm.autoLinkEnabled === false && <p className="mt-1 text-xs text-muted">{t('offHint')}</p>}
    </section>
  );
}
