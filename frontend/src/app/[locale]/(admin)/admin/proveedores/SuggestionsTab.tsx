'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiErrorBanner } from '@/components/supplier/ApiErrorBanner';
import { CardLine } from '@/components/supplier/CardLine';
import { useRole } from '@/lib/role';
import { formatMoneyCents } from '@/lib/format';
import { centsToPesosInput, pesosToCents } from '@/lib/money-input';
import type { AppLocale } from '@/i18n/routing';
import type { BadgeTone } from '@/lib/status-map';
import {
  MAX_WEEKLY_BUDGET_CENTS,
  getSupplySettings,
  listSupplySuggestions,
  patchSupplySettings,
  type SuggestionStatus,
} from '@/lib/api/supply-suggestions';

const STATUSES: SuggestionStatus[] = ['draft', 'published', 'skipped'];
const TONE: Record<SuggestionStatus, BadgeTone> = { draft: 'warning', published: 'success', skipped: 'neutral' };

/** §PROV-F4: ajustes de auto-publicación + lista de sugeridas (solo lectura). Escribir ajustes: super_admin. */
export function SuggestionsTab() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsPanel />
      <SuggestionsList />
    </div>
  );
}

function SettingsPanel() {
  const t = useTranslations('admin.suppliers.suggest.settings');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const { isSuperAdmin } = useRole();
  const q = useQuery({ queryKey: ['admin', 'supply-settings'], queryFn: getSupplySettings });
  const s = q.data;
  const [budget, setBudget] = useState('');
  useEffect(() => {
    if (s) setBudget(centsToPesosInput(s.weeklyBudgetCents));
  }, [s]);
  const cents = pesosToCents(budget);
  const budgetOk = cents !== null && !Number.isNaN(cents) && cents >= 0 && cents <= MAX_WEEKLY_BUDGET_CENTS;
  const m = useMutation({
    mutationFn: (body: { autoPublish?: boolean; weeklyBudgetCents?: number }) => patchSupplySettings(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'supply-settings'] }),
  });
  return (
    <section aria-labelledby="sup-settings-h" className="flex flex-col gap-4">
      <h2 id="sup-settings-h" className="font-serif text-xl text-text">{t('title')}</h2>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} loading={<Skeleton className="h-40 w-full" />}>
        {s && (
          <div className="flex flex-col gap-5 border-l-2 border-accent pl-4">
            <label className="flex items-center gap-3 text-sm text-text">
              <input
                type="checkbox"
                role="switch"
                aria-checked={s.autoPublish}
                checked={s.autoPublish}
                disabled={!isSuperAdmin || m.isPending}
                onChange={(e) => m.mutate({ autoPublish: e.target.checked })}
                className="h-5 w-5 accent-[color:var(--color-accent)]"
              />
              {t('autoPublish')}
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{s.autoPublish ? t('on') : t('off')}</span>
            </label>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (budgetOk) m.mutate({ weeklyBudgetCents: cents as number });
              }}
            >
              <Input
                label={t('budget')}
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                disabled={!isSuperAdmin}
                hint={t('budgetHint')}
                error={budget !== '' && !budgetOk ? t('budgetBad') : undefined}
              />
              {isSuperAdmin && (
                <Button type="submit" disabled={!budgetOk || cents === s.weeklyBudgetCents || m.isPending}>{t('save')}</Button>
              )}
            </form>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat label={t('defaultPct')} value={`${s.defaultPctBps / 100} %`} />
              <Stat label={t('spent')} value={formatMoneyCents(s.weekSpentCents, locale)} />
              <Stat
                label={t('lastRun')}
                value={s.lastRunAt ? new Date(s.lastRunAt).toLocaleString(locale === 'es' ? 'es-MX' : 'en-US') : t('never')}
              />
            </dl>
            <div className="flex flex-col gap-1">
              <p className="text-sm text-text">
                {t('autoAccept')} <Badge tone="neutral">{t('off')}</Badge>
              </p>
              <p className="text-sm text-muted">{t('acceptStaysYours')}</p>
            </div>
            {!isSuperAdmin && <p className="text-sm text-muted">{t('readOnly')}</p>}
            {m.isError && <ApiErrorBanner error={m.error} />}
          </div>
        )}
      </QueryState>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-eyebrow text-muted">{label}</dt>
      <dd className="mt-1 font-serif text-xl text-text">{value}</dd>
    </div>
  );
}

function SuggestionsList() {
  const t = useTranslations('admin.suppliers.suggest.list');
  const ts = useTranslations('admin.suppliers.suggest.status');
  const tr = useTranslations('admin.suppliers.suggest.reason');
  const tk = useTranslations('admin.suppliers.suggest.skip');
  const locale = useLocale() as AppLocale;
  const [status, setStatus] = useState<SuggestionStatus | ''>('');
  const q = useQuery({
    queryKey: ['admin', 'supply-suggestions', status],
    queryFn: () => listSupplySuggestions({ status: status || undefined }),
  });
  return (
    <section aria-labelledby="sup-sug-h" className="flex flex-col gap-4">
      <h2 id="sup-sug-h" className="font-serif text-xl text-text">{t('title')}</h2>
      <p className="text-sm text-muted">{t('lead')}</p>
      <Select
        label={t('status')}
        value={status}
        onChange={(e) => setStatus(e.target.value as SuggestionStatus | '')}
        options={[{ value: '', label: t('all') }, ...STATUSES.map((v) => ({ value: v, label: ts(v) }))]}
      />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} loading={<Skeleton className="h-32 w-full" />}>
        {q.data && q.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {q.data?.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                <CardLine card={r.card}>
                  <p className="mt-1 text-xs text-muted">{r.reasons.map((x) => tr(x.kind)).join(' · ')}</p>
                </CardLine>
                <div className="flex flex-col items-end gap-1 text-sm">
                  <Badge tone={TONE[r.status]}>{ts(r.status)}</Badge>
                  <span className="text-text">{t('qty', { qty: r.suggestedQty })}</span>
                  <span className="text-muted">
                    {r.unitCents != null ? formatMoneyCents(r.unitCents, locale) : t('noPrice')}
                    {r.marketCents != null && ` · ${t('market')} ${formatMoneyCents(r.marketCents, locale)}`}
                  </span>
                  {r.skipReason && <span className="text-xs text-muted">{tk(r.skipReason)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}
