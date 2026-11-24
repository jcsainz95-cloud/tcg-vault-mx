'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { fmtBps } from '@/lib/reports/comparison';
import { Link } from '@/i18n/navigation';
import type { ComparisonBasis, MoneyDeltaDTO, SalesDeltaDTO } from '@/types/contract';
import { cn } from '@/lib/cn';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Variación contra el periodo anterior, tal cual la da el servidor: `delta` (Ventas, `pct` entero) o `money` (F2a, `deltaBps`);
 * `null` ⇒ «—», nunca 0 %. §2 (F2a): NUNCA un porcentaje sin su base — `basis: none` ⇒ «—» aunque llegue un número, y
 * `partial` ⇒ «vs lo que hay» (en vez de «vs periodo anterior»).
 */
export function Delta({ delta, money, basis }: { delta?: SalesDeltaDTO; money?: MoneyDeltaDTO; basis?: ComparisonBasis }) {
  const t = useTranslations('admin.reports.board.delta');
  const locale = useLocale() as AppLocale;
  if (!delta && !money) return null;
  const pct = money ? money.deltaBps : delta!.pct;
  if (basis === 'none' || pct == null) {
    const why = basis === 'none' ? t('noBase') : t('noPrevious');
    return (
      <span className="font-mono text-xs text-muted" title={why}>
        <span aria-hidden>—</span>
        <span className="sr-only">{why}</span>
      </span>
    );
  }
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'same';
  const text = money ? (fmtBps(Math.abs(money.deltaBps!), locale, false) as string) : t('pct', { pct: Math.abs(pct) });
  return (
    <span className="font-mono text-xs text-muted" data-testid="delta">
      <span aria-hidden>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝'} </span>
      <span className="sr-only">{t(dir)} </span>
      {text}
      <span className="ml-1">{basis === 'partial' ? t('vsPartial') : t('vsPrevious')}</span>
    </span>
  );
}

/** Una cifra-titular: rótulo, valor, variación y nota. Todo viene formateado del servidor; aquí no se calcula nada. */
export function Figure({
  label,
  value,
  delta,
  money,
  basis,
  note,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: SalesDeltaDTO;
  /** F2a: variación en el formato nuevo (`deltaBps`). */
  money?: MoneyDeltaDTO;
  basis?: ComparisonBasis;
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 px-5 py-5', className)}>
      <span className="eyebrow">{label}</span>
      <span className="tabular font-serif text-[24px] leading-tight text-text">{value}</span>
      <Delta delta={delta} money={money} basis={basis} />
      {note && <span className="text-xs leading-relaxed text-muted">{note}</span>}
    </div>
  );
}

/** Franja de un área de la junta: título que enlaza a su informe, la pregunta que responde y sus cifras. */
export function Franja({
  id,
  title,
  ask,
  href,
  seeFull,
  queries,
  children,
}: {
  id: string;
  title: string;
  ask: string;
  href: string;
  seeFull: string;
  queries?: { isLoading: boolean; isError: boolean; error?: unknown; refetch: () => unknown }[];
  children: React.ReactNode;
}) {
  const qs = queries ?? [];
  return (
    <section id={id} aria-labelledby={`franja-${id}`} data-testid={`franja-${id}`} className="scroll-mt-6 border border-border bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-5">
        <h2 id={`franja-${id}`} className="font-serif text-[22px] leading-tight">
          {title}
        </h2>
        <Link
          href={href}
          className="min-h-[24px] text-sm text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {seeFull} <span aria-hidden>→</span>
        </Link>
      </header>
      <p className="px-5 pb-4 pt-1 text-sm italic text-muted">{ask}</p>
      <div className="border-t border-border">
        <QueryState
          isLoading={qs.some((q) => q.isLoading)}
          isError={qs.some((q) => q.isError)}
          error={qs.find((q) => q.isError)?.error}
          onRetry={() => qs.forEach((q) => q.refetch())}
          loading={<Skeleton className="m-5 h-16" />}
        >
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">{children}</div>
        </QueryState>
      </div>
    </section>
  );
}
