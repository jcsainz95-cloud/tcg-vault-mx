'use client';

import { useEffect, useState } from 'react';
import { Paginator } from '@/app/[locale]/(storefront)/_shared/Paginator';
import { asApiError } from '@/lib/api-client';
import { useIdemKey } from '@/lib/api/use-idem-key';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  MAX_OPEN_BUDGET_CENTS,
  getSupplySettings,
  listSupplySuggestions,
  patchSupplySettings,
  publishSupplySuggestion,
  skipSupplySuggestion,
  type SuggestionStatus,
  type SupplySuggestion,
} from '@/lib/api/supply-suggestions';

const STATUSES: SuggestionStatus[] = ['draft', 'published', 'skipped'];
const TONE: Record<SuggestionStatus, BadgeTone> = { draft: 'warning', published: 'success', skipped: 'neutral' };

/**
 * §PROV-F4: ajustes (solo super_admin: el GET es admin, el operador no lo pide ni lo ve) + lista de sugeridas
 * (staff, solo lectura para el operador). Publicar/saltar: super_admin.
 */
export function SuggestionsTab() {
  const { isSuperAdmin } = useRole();
  return (
    <div className="flex flex-col gap-8">
      {isSuperAdmin && <SettingsPanel />}
      <SuggestionsList />
    </div>
  );
}

function SettingsPanel() {
  const t = useTranslations('admin.suppliers.suggest.settings');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const isSuperAdmin = true; // el panel solo se monta para super_admin
  const q = useQuery({ queryKey: ['admin', 'supply-settings'], queryFn: getSupplySettings });
  const s = q.data;
  const [budget, setBudget] = useState('');
  useEffect(() => {
    if (s) setBudget(centsToPesosInput(s.openBudgetCents));
  }, [s]);
  const cents = pesosToCents(budget);
  const budgetOk = cents !== null && !Number.isNaN(cents) && cents >= 0 && cents <= MAX_OPEN_BUDGET_CENTS;
  const m = useMutation({
    mutationFn: (body: { autoPublish?: boolean; openBudgetCents?: number }) => patchSupplySettings(body),
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
                if (budgetOk) m.mutate({ openBudgetCents: cents as number });
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
                <Button type="submit" disabled={!budgetOk || cents === s.openBudgetCents || m.isPending}>{t('save')}</Button>
              )}
            </form>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat label={t('defaultPct')} value={`${s.defaultPctBps / 100} %`} />
              <Stat
                label={t('open')}
                value={t('openNow', { open: formatMoneyCents(s.openExposureCents, locale), cap: formatMoneyCents(s.openBudgetCents, locale) })}
              />
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
  const { isSuperAdmin } = useRole();
  const [status, setStatus] = useState<SuggestionStatus | ''>('draft');
  const [page, setPage] = useState(1);
  const settings = useQuery({ queryKey: ['admin', 'supply-settings'], queryFn: getSupplySettings, enabled: isSuperAdmin });
  const q = useQuery({
    queryKey: ['admin', 'supply-suggestions', status, page],
    queryFn: () => listSupplySuggestions({ status: status || undefined, page }),
    placeholderData: keepPreviousData,
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / (q.data.pageSize || 20))) : 1;
  const leadKey = !isSuperAdmin ? 'leadReadOnly' : settings.data?.autoPublish ? 'leadAuto' : 'leadManual';
  return (
    <section aria-labelledby="sup-sug-h" className="flex flex-col gap-4">
      <h2 id="sup-sug-h" className="font-serif text-xl text-text">{t('title')}</h2>
      <p className="text-sm text-muted">{t(leadKey)}</p>
      <Select
        label={t('status')}
        value={status}
        onChange={(e) => {
          setStatus(e.target.value as SuggestionStatus | '');
          setPage(1);
        }}
        options={[{ value: '', label: t('all') }, ...STATUSES.map((v) => ({ value: v, label: ts(v) }))]}
      />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} loading={<Skeleton className="h-32 w-full" />}>
        {q.data && q.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <>
            <ul className="divide-y divide-border border-y border-border">
              {q.data?.data.map((r) => (
                <SuggestionRow key={r.id} r={r} canAct={isSuperAdmin} />
              ))}
            </ul>
            <div className="flex items-center justify-between gap-4">
              <p className="font-mono text-[11px] uppercase tracking-eyebrow text-muted">{t('total', { total: q.data?.total ?? 0 })}</p>
              <Paginator page={page} totalPages={totalPages} onPage={setPage} />
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}

function SuggestionRow({ r, canAct }: { r: SupplySuggestion; canAct: boolean }) {
  const t = useTranslations('admin.suppliers.suggest.list');
  const ts = useTranslations('admin.suppliers.suggest.status');
  const tr = useTranslations('admin.suppliers.suggest.reason');
  const tk = useTranslations('admin.suppliers.suggest.skip');
  const te = useTranslations('admin.suppliers.suggest.errors');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const key = useIdemKey();
  const done = () => void qc.invalidateQueries({ queryKey: ['admin', 'supply-suggestions'] });
  const pub = useMutation({
    mutationFn: () => publishSupplySuggestion(r.id, {}, key.get()),
    onSuccess: () => {
      key.renew();
      done();
      void qc.invalidateQueries({ queryKey: ['admin', 'supply-settings'] });
    },
    onError: (e) => {
      // 409 de negocio y 422: la operación terminó (o la key ya no sirve); el próximo clic es otro intento.
      const st = asApiError(e)?.status;
      if (st === 409 || st === 422) key.renew();
      if (st === 409) done();
    },
  });
  const skip = useMutation({ mutationFn: () => skipSupplySuggestion(r.id), onSuccess: done });
  const err = pub.error ?? skip.error;
  const code = asApiError(err)?.code;
  const published = r.status === 'published';
  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <CardLine card={r.card}>
          <p className="mt-1 text-xs text-muted">{r.reasons.map((x) => tr(x.kind)).join(' · ')}</p>
        </CardLine>
        <div className="flex flex-col items-end gap-1 text-sm">
          <Badge tone={TONE[r.status]}>{ts(r.status)}</Badge>
          <span className="text-text">{t('qty', { qty: r.suggestedQty })}</span>
          {published ? (
            r.requestId && <span className="font-mono text-xs text-muted">{t('asRequest', { id: r.requestId.slice(0, 8) })}</span>
          ) : (
            <span className="text-muted">
              {r.unitCents != null ? formatMoneyCents(r.unitCents, locale) : t('noPrice')}
              {r.marketCents != null && ` · ${t('market')} ${formatMoneyCents(r.marketCents, locale)}`}
            </span>
          )}
          {r.skipReason && <span className="text-xs text-muted">{tk(r.skipReason)}</span>}
        </div>
      </div>
      {canAct && r.status !== 'published' && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" disabled={pub.isPending || skip.isPending} onClick={() => pub.mutate()}>{t('publish')}</Button>
          {r.status === 'draft' && (
            <Button type="button" variant="ghost" disabled={pub.isPending || skip.isPending} onClick={() => skip.mutate()}>{t('skip')}</Button>
          )}
        </div>
      )}
      {err != null && (
        <p role="alert" className="text-right text-sm text-danger">
          {code && te.has(code) ? te(code) : tc('errorGeneric')}
        </p>
      )}
    </li>
  );
}
