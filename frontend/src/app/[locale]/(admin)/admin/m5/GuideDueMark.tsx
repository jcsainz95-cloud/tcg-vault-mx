'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatDateTimeMx } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { AdminBuylistDTO } from '@/types/contract';

const TAG = 'font-mono text-[11px] uppercase tracking-[0.06em]';

type DueFields = Pick<AdminBuylistDTO, 'guideDueAt' | 'guideDueSoon' | 'guideDueInDays'>;

/**
 * 💰 rev BSD-1 — **la marca «se cierra sola»** (DESIGN_SYSTEM §BSD-UX.6c; contrato §BSD.5 + BSD-1.1 C-8).
 *
 * ⛔ **BX5 / BSD-F6 — la pantalla NO calcula ni decide.** Nada aquí lee un reloj:
 *  - la versalita y la nota existen ⇔ `guideDueSoon === true` (lo deriva el servidor con la MISMA regla del barrido);
 *  - la línea neutra existe ⇔ `guideDueAt` viene (es la fecha que usa el barrido, pintada tal cual);
 *  - «en N días» ⇔ `guideDueInDays` viene (C-8); con `null` no se pinta ni se calcula.
 * Mover el reloj del navegador no cambia nada: solo datos nuevos del servidor (UX-BSD-8).
 */
export function GuideDueTag({ req }: { req: DueFields }) {
  const t = useTranslations('admin.m5.guideDue');
  if (req.guideDueSoon !== true) return null;
  const days = typeof req.guideDueInDays === 'number' ? req.guideDueInDays : null;
  return (
    <span className={cn(TAG, 'text-accent')} data-testid="m5-guide-due-tag">
      {t('tag')}
      {days !== null && <> · {t('inDays', { n: days })}</>}
    </span>
  );
}

/** La línea (siempre que haya `guideDueAt`) y, con `guideDueSoon`, la nota de qué pasa al cerrarse. */
export function GuideDueBlock({ req }: { req: DueFields }) {
  const t = useTranslations('admin.m5.guideDue');
  const locale = useLocale() as AppLocale;
  if (!req.guideDueAt) return null;
  const soon = req.guideDueSoon === true;
  const when = formatDateTimeMx(req.guideDueAt, locale);
  // La frase porta, el color acompaña (§31.6f llevado a pantalla): la fecha va en bermellón solo con `guideDueSoon`.
  const [before, after] = t('line', { datetime: '\u0000' }).split('\u0000');
  return (
    <div className="flex flex-col gap-1" data-testid="m5-guide-due">
      <p className={cn('text-sm', soon ? 'text-text' : 'text-muted')} data-testid="m5-guide-due-line">
        {before}
        <span className={cn('tabular', soon && 'text-accent')}>{when}</span>
        {after}
      </p>
      {soon && (
        <p className="text-sm text-text" data-testid="m5-guide-due-note">
          {t('note')}
        </p>
      )}
    </div>
  );
}
