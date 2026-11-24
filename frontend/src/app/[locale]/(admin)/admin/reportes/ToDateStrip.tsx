'use client';

import { useQueries } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPnlCalendar } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { CALENDAR_UNITS, type CalendarBucketDTO } from '@/types/reports-pnl';
import { fmtDay } from '../m9/salesFormat';
import { Delta, Franja } from './Figure';

/**
 * §REPORTES-CEO F2b (§3b) — Junta › franja «A la fecha»: mes, trimestre, semestre y año EN CURSO (ventas netas, ganancia bruta y
 * resultado antes de gastos fijos), cada uno contra el MISMO tramo del periodo anterior. No depende del selector de periodo.
 * Una llamada por unidad (`count=1`; solo se lee el último cubo, el que va en curso). ⛔ El navegador no calcula nada.
 */
export function ToDateStrip({ href, seeFull }: { href: string; seeFull: string }) {
  const t = useTranslations('admin.reports.board.areas.toDate');
  const tc = useTranslations('admin.reports.compare');
  const tu = useTranslations('admin.m7.consolidated.unit');
  const locale = useLocale() as AppLocale;
  const queries = useQueries({
    queries: CALENDAR_UNITS.map((unit) => ({ queryKey: ['board-to-date', unit], queryFn: () => getPnlCalendar({ unit, count: 1 }) })),
  });

  return (
    <Franja id="to-date" title={t('title')} ask={t('ask')} href={href} seeFull={seeFull} queries={queries}>
      {queries.map((q, i) => {
        const b: CalendarBucketDTO | undefined = q.data?.buckets.at(-1);
        if (!b) return null;
        const cmp = b.comparison;
        return (
          <div key={CALENDAR_UNITS[i]} className="flex flex-col gap-3 px-5 py-5" data-testid={`to-date-${b.kind}`} data-todate={b.toDate ? 'true' : 'false'}>
            <div className="flex flex-col gap-0.5">
              <span className="eyebrow">{b.toDate ? tc(`toDate.${b.kind}`) : tu(b.kind)}</span>
              <span className="text-xs text-muted">{t('days', { days: b.days })}</span>
              {cmp.previous.clamped && (
                <span className="text-xs text-muted" data-testid="to-date-clamped">
                  {tc('clamped', { day: Number(b.to.slice(8, 10)), last: fmtDay(cmp.previous.to, locale) })}
                </span>
              )}
            </div>
            <Row label={t('net')} value={formatMoneyCents(b.total.netSalesCents, locale)} delta={cmp.total.netSalesCents} basis={cmp.basis} />
            <Row label={t('gross')} value={formatMoneyCents(b.total.grossProfitCents, locale)} delta={cmp.total.grossProfitCents} basis={cmp.basis} />
            <Row label={t('result')} value={formatMoneyCents(b.total.contributionCents, locale)} delta={cmp.total.contributionCents} basis={cmp.basis} />
          </div>
        );
      })}
    </Franja>
  );
}

function Row({ label, value, delta, basis }: { label: string; value: string; delta: CalendarBucketDTO['comparison']['total'][keyof CalendarBucketDTO['comparison']['total']]; basis: CalendarBucketDTO['comparison']['basis'] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular font-serif text-[20px] leading-tight text-text" data-testid="to-date-value">
        {value}
      </span>
      <Delta money={delta} basis={basis} />
    </div>
  );
}
