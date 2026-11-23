'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { SalesDeltaDTO } from '@/types/contract';
import { cn } from '@/lib/cn';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';

/** Variación contra el periodo anterior, tal cual la da el servidor (`pct` entero; `null` ⇒ «—», nunca 0 %). */
export function Delta({ delta }: { delta: SalesDeltaDTO | undefined }) {
  const t = useTranslations('admin.reports.board.delta');
  if (!delta) return null;
  if (delta.pct == null) {
    return (
      <span className="font-mono text-xs text-muted" title={t('noPrevious')}>
        <span aria-hidden>—</span>
        <span className="sr-only">{t('noPrevious')}</span>
      </span>
    );
  }
  const dir = delta.pct > 0 ? 'up' : delta.pct < 0 ? 'down' : 'same';
  return (
    <span className="font-mono text-xs text-muted" data-testid="delta">
      <span aria-hidden>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝'} </span>
      <span className="sr-only">{t(dir)} </span>
      {t('pct', { pct: Math.abs(delta.pct) })}
      <span className="ml-1">{t('vsPrevious')}</span>
    </span>
  );
}

/** Una cifra-titular: rótulo, valor, variación y nota. Todo viene formateado del servidor; aquí no se calcula nada. */
export function Figure({
  label,
  value,
  delta,
  note,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: SalesDeltaDTO;
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 px-5 py-5', className)}>
      <span className="eyebrow">{label}</span>
      <span className="tabular font-serif text-[24px] leading-tight text-text">{value}</span>
      <Delta delta={delta} />
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
    <section aria-labelledby={`franja-${id}`} data-testid={`franja-${id}`} className="border border-border bg-surface">
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
