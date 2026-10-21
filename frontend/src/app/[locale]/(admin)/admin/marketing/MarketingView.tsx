'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { useRole } from '@/lib/role';
import { getMarketingPanel, getMarketingPeriods, type MarketingPeriodQuery } from '@/lib/marketing-api';
import type { AppLocale } from '@/i18n/routing';
import type { MarketingPeriodsResponse, MarketingPrivacy, MarketingScreen, MarketingScreenPayload } from '@/types/contract';
import { MarketingTable } from './MarketingTable';
import { AnnotationsScreen } from './AnnotationsScreen';
import { AnalystAccessPanel } from './AnalystAccessPanel';
import { DownloadBar } from './DownloadBar';
import { ForbiddenCtx, isForbidden, useReportForbidden } from './forbidden';
import { annotationDate, isoWeekOf, monthOptionLabel, shortDate, weekOptionLabel } from './mkt-format';
import { MKT_SCREENS, mktSearch, type MktPeriodKind, type MktUrlState, type MktView } from './url-state';

/**
 * `/admin/marketing` — Panel de Marketing (`DESIGN_SYSTEM §MKT-UX`; contrato §MKT.E/§MKT.G, v1.101).
 *
 * - Los periodos los da el servidor (`GET …/periods`): ⛔ el navegador no decide qué semana está cerrada (MKT-4) y
 *   ⛔ no hay rango libre (MKT-5). Un `week`/`month` de la URL que no esté en esa lista se ignora (UX-MKT-7).
 * - Cada pantalla monta su consulta SOLO cuando está activa; «Acceso» no pide nada mientras se ve otra.
 * - Mientras carga un periodo nuevo se ven el rótulo y las cifras VIEJOS, atenuados (AN-4, UX-MKT-9): el rótulo sale
 *   del payload (`period.from/to`), nunca de lo elegido.
 * - Un `403` de cualquier pieza sustituye TODO bajo el `h1` y apaga las consultas (UX-MKT-10).
 * - El `h1` es `admin.modules.marketing`, la misma cadena del menú (candado P66-2, `AdminPageTitles.test.tsx`).
 */

type Selected = { kind: MktPeriodKind; week: string | null; month: string | null };

/** Resuelve la elección contra la lista del servidor: lo que no está ahí cae al más reciente de su tipo. */
export function resolvePeriod(
  periods: MarketingPeriodsResponse,
  sel: Selected,
): { query: MarketingPeriodQuery; from: string; to: string; week: string | null; month: string | null } | null {
  if (sel.kind === 'month') {
    const m = periods.closedMonths.find((o) => o.month === sel.month) ?? periods.closedMonths[0];
    return m ? { query: { month: m.month }, from: m.from, to: m.to, week: null, month: m.month } : null;
  }
  const w = periods.closedWeeks.find((o) => isoWeekOf(o.weekStart) === sel.week) ?? periods.closedWeeks[0] ?? periods.lastClosedWeek;
  return w ? { query: { weekStart: w.weekStart }, from: w.from, to: w.to, week: isoWeekOf(w.weekStart), month: null } : null;
}

/**
 * QA M3 (2026-10-19): el recuadro ya se titula «Cobertura»; el servidor empieza su nota con «Cobertura: …». Se quita el
 * prefijo AL PINTAR (el literal del servidor no cambia: lo vigila `mock/marketing.parity.test.ts`).
 */
export function withoutCoveragePrefix(note: string): string {
  return note.replace(/^Cobertura:\s*/, '');
}

export function MarketingView({ initial }: { initial: MktUrlState }) {
  const tModules = useTranslations('admin.modules');
  const t = useTranslations('admin.marketing');
  const { isSuperAdmin } = useRole();
  const [forbidden, setForbidden] = useState(false);
  const report = useCallback((e: unknown) => {
    if (!isForbidden(e)) return false;
    setForbidden(true);
    return true;
  }, []);

  return (
    <ForbiddenCtx.Provider value={report}>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-h1 font-bold">{tModules('marketing')}</h1>
          {!forbidden && <p className="text-sm text-muted">{t('lede')}</p>}
        </header>
        {forbidden ? <ForbiddenState /> : <Panel initial={initial} isSuperAdmin={isSuperAdmin} />}
      </div>
    </ForbiddenCtx.Provider>
  );
}

export function ForbiddenState() {
  const t = useTranslations('admin.marketing.forbidden');
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <section className="flex flex-col items-start gap-3" data-testid="mkt-forbidden">
      <h2 ref={ref} tabIndex={-1} className="font-serif text-xl text-text outline-none">
        {t('title')}
      </h2>
      <p className="text-sm text-muted">{t('body')}</p>
      <Link href="/admin" className="text-sm text-text underline underline-offset-4 hover:text-accent">
        {t('back')}
      </Link>
    </section>
  );
}

function Panel({ initial, isSuperAdmin }: { initial: MktUrlState; isSuperAdmin: boolean }) {
  const t = useTranslations('admin.marketing');
  const locale = useLocale() as AppLocale;
  const report = useReportForbidden();
  const views: MktView[] = useMemo(() => (isSuperAdmin ? [...MKT_SCREENS, 'acceso'] : [...MKT_SCREENS]), [isSuperAdmin]);
  const [view, setView] = useState<MktView>(initial.view === 'acceso' && !isSuperAdmin ? 'a' : initial.view);
  const [sel, setSel] = useState<Selected>({ kind: initial.kind, week: initial.week, month: initial.month });
  const [periodError, setPeriodError] = useState(false);
  const tabRefs = useRef<Partial<Record<MktView, HTMLButtonElement | null>>>({});

  const periods = useQuery({ queryKey: ['mkt', 'periods'], queryFn: getMarketingPeriods, retry: false, staleTime: 60_000 });
  useEffect(() => {
    if (periods.error) report(periods.error);
  }, [periods.error, report]);

  const resolved = periods.data ? resolvePeriod(periods.data, sel) : null;
  const isScreen = view !== 'acceso' && view !== 'h';

  const panel = useQuery({
    queryKey: ['mkt', 'panel', view, resolved?.query.weekStart ?? null, resolved?.query.month ?? null],
    queryFn: () => getMarketingPanel(view as MarketingScreen, resolved!.query),
    enabled: isScreen && resolved !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
  useEffect(() => {
    if (!panel.error) return;
    if (report(panel.error)) return;
    if (asApiError(panel.error)?.status === 400) {
      setPeriodError(true);
      setSel((s) => ({ kind: s.kind, week: null, month: null }));
    }
  }, [panel.error, report]);

  // La URL recuerda lo que se ve (§MKT-UX.1). Solo con valores ya validados contra el servidor.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = mktSearch({ view, kind: sel.kind, week: resolved?.week ?? null, month: resolved?.month ?? null });
    const url = window.location.pathname + search + window.location.hash;
    if (url !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [view, sel.kind, resolved?.week, resolved?.month]);

  function selectView(next: MktView) {
    setView(next);
  }
  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: MktView) {
    const idx = views.indexOf(current);
    let next: MktView | null = null;
    if (e.key === 'ArrowRight') next = views[(idx + 1) % views.length];
    else if (e.key === 'ArrowLeft') next = views[(idx - 1 + views.length) % views.length];
    else if (e.key === 'Home') next = views[0];
    else if (e.key === 'End') next = views[views.length - 1];
    if (!next) return;
    e.preventDefault();
    selectView(next);
    tabRefs.current[next]?.focus();
  }
  const label = (v: MktView) => (v === 'acceso' ? t('tabs.access') : t(`tabs.${v}`));

  const data: MarketingScreenPayload | undefined = panel.data;
  // Ausente ⇒ `small_cells` (lo seguro, §MKT.G.5). El último régimen visto se recuerda EN MEMORIA para el aviso de las
  // descargas en la pantalla de anotaciones (que no pide el payload); ⛔ nunca en storage.
  const privacy: MarketingPrivacy = data?.privacy === 'exact' ? 'exact' : 'small_cells';
  const [lastPrivacy, setLastPrivacy] = useState<MarketingPrivacy | null>(null);
  useEffect(() => {
    if (data) setLastPrivacy(data.privacy === 'exact' ? 'exact' : 'small_cells');
  }, [data]);

  return (
    <>
      {/* Escritorio (≥ md): tablist APG con wrap (⛔ scroll oculto). Móvil: Select nativo «Pantalla». */}
      <div className="hidden flex-wrap items-end gap-x-5 border-b border-border md:flex" role="tablist" aria-label={t('tabs.label')} data-testid="mkt-tablist">
        {views.map((v) => {
          const active = v === view;
          return (
            <button
              key={v}
              ref={(el) => {
                tabRefs.current[v] = el;
              }}
              type="button"
              role="tab"
              id={`mkt-tab-${v}`}
              aria-selected={active}
              aria-controls="mkt-panel"
              tabIndex={active ? 0 : -1}
              onClick={() => selectView(v)}
              onKeyDown={(e) => onTabKeyDown(e, v)}
              className={cn(
                '-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-1 text-sm',
                v === 'acceso' && 'ml-auto border-l border-l-border pl-5',
                active ? 'border-b-text text-text' : 'border-b-transparent text-muted hover:text-text',
              )}
            >
              {label(v)}
            </button>
          );
        })}
      </div>
      <div className="md:hidden" data-testid="mkt-screen-select">
        <Select
          label={t('tabs.select')}
          value={view}
          options={views.map((v) => ({ value: v, label: label(v) }))}
          onChange={(e) => selectView(e.target.value as MktView)}
          className="min-h-[44px]"
        />
      </div>

      <div role="tabpanel" id="mkt-panel" aria-labelledby={`mkt-tab-${view}`} className="flex flex-col gap-6">
        {view === 'acceso' ? (
          <AnalystAccessPanel />
        ) : (
          <>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <PeriodPicker
                periods={periods.data}
                loading={periods.isPending}
                sel={sel}
                resolved={resolved}
                onChange={(next) => {
                  setPeriodError(false);
                  setSel(next);
                }}
                labelSource={isScreen ? data : undefined}
                updating={isScreen && panel.isPlaceholderData && panel.isFetching}
              />
              <DownloadBar
                screen={view as MarketingScreen}
                period={resolved?.query ?? null}
                kind={sel.kind}
                privacy={isScreen ? (data ? privacy : null) : lastPrivacy}
              />
            </div>
            {periodError && (
              <Banner variant="danger" role="alert">
                {t('period.invalid')}
              </Banner>
            )}
            {periods.isError && !isForbidden(periods.error) && (
              <Banner
                variant="danger"
                role="alert"
                action={
                  <Button variant="secondary" size="sm" onClick={() => periods.refetch()}>
                    {t('state.retry')}
                  </Button>
                }
              >
                {t('state.error')}
              </Banner>
            )}
            {view === 'h' ? (
              <AnnotationsScreen period={resolved ? { from: resolved.from, to: resolved.to } : null} />
            ) : (
              <ScreenBody
                screen={view}
                data={data}
                loading={!data && (periods.isPending || panel.isFetching)}
                error={panel.isError && !isForbidden(panel.error) && asApiError(panel.error)?.status !== 400}
                onRetry={() => panel.refetch()}
                updating={panel.isPlaceholderData && panel.isFetching}
                onManage={() => selectView('h')}
                locale={locale}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function PeriodPicker({
  periods,
  loading,
  sel,
  resolved,
  onChange,
  labelSource,
  updating,
}: {
  periods: MarketingPeriodsResponse | undefined;
  loading: boolean;
  sel: Selected;
  resolved: ReturnType<typeof resolvePeriod>;
  onChange: (s: Selected) => void;
  labelSource: MarketingScreenPayload | undefined;
  updating: boolean;
}) {
  const t = useTranslations('admin.marketing.period');
  const locale = useLocale() as AppLocale;
  const options = !periods
    ? []
    : sel.kind === 'week'
      ? periods.closedWeeks.map((w) => ({ value: isoWeekOf(w.weekStart), label: weekOptionLabel(w.from, w.to, locale) }))
      : periods.closedMonths.map((m) => ({ value: m.month, label: monthOptionLabel(m.month, locale) }));
  const value = sel.kind === 'week' ? (resolved?.week ?? '') : (resolved?.month ?? '');
  // AN-4: el rótulo sale del PAYLOAD pintado (cambia con las cifras); sin payload (pantalla h), de la opción elegida.
  const shown = labelSource?.period ?? (resolved ? { from: resolved.from, to: resolved.to } : null);
  const prev = labelSource?.previousPeriod;

  return (
    <div className="flex flex-col gap-3" data-testid="mkt-period">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div role="group" aria-label={t('group')} className="flex items-center gap-2">
          <span className="eyebrow">{t('label')}</span>
          {(['week', 'month'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={sel.kind === k}
              onClick={() => sel.kind !== k && onChange({ kind: k, week: null, month: null })}
              className={cn(
                'min-h-[44px] border px-4 font-mono text-[11px] uppercase tracking-[0.06em]',
                sel.kind === k ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
              )}
            >
              {t(k)}
            </button>
          ))}
        </div>
        <div className="min-w-[16rem]">
          {loading ? (
            <Skeleton className="h-11 w-full" />
          ) : (
            <Select
              label={t('label')}
              value={value}
              options={options}
              disabled={options.length === 0}
              onChange={(e) =>
                onChange(sel.kind === 'week' ? { kind: 'week', week: e.target.value, month: null } : { kind: 'month', week: null, month: e.target.value })
              }
              data-testid="mkt-period-select"
            />
          )}
        </div>
      </div>
      <div aria-live="polite" className={cn('text-sm text-muted', updating && 'opacity-60 motion-reduce:opacity-100')} data-testid="mkt-period-label">
        {shown && (
          <p>
            {t('range', { from: shortDate(shown.from, locale), to: shortDate(shown.to, locale) })}
            {prev && <> · {t('compare', { from: shortDate(prev.from, locale), to: shortDate(prev.to, locale) })}</>}
          </p>
        )}
      </div>
      {updating && (
        <p role="status" className="text-xs text-muted" data-testid="mkt-updating">
          {t('updating')}
        </p>
      )}
    </div>
  );
}

function ScreenBody({
  screen,
  data,
  loading,
  error,
  onRetry,
  updating,
  onManage,
  locale,
}: {
  screen: MarketingScreen;
  data: MarketingScreenPayload | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  updating: boolean;
  onManage: () => void;
  locale: AppLocale;
}) {
  const t = useTranslations('admin.marketing');
  if (error && !data) {
    return (
      <Banner
        variant="danger"
        role="alert"
        action={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('state.retry')}
          </Button>
        }
      >
        {t('state.error')}
      </Banner>
    );
  }
  if (loading || !data) {
    return (
      <div aria-busy="true" className="flex flex-col gap-6" data-testid="mkt-loading">
        <span role="status" className="sr-only">
          {t('state.loading')}
        </span>
        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
        {[0, 1].map((b) => (
          <div key={b} className="flex flex-col gap-2 border-t border-border pt-5">
            <Skeleton className="h-6 w-1/3 motion-reduce:animate-none" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full motion-reduce:animate-none" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  // Las cifras que se ven son las del payload pintado: con `keepPreviousData`, durante una recarga, `data` es el viejo.
  const shownScreen = data.screen;
  const measured = data.tables.filter((tb) => tb.measured);
  const allEmpty = measured.length > 0 && measured.every((tb) => tb.rows.length === 0);
  const showStrip = (shownScreen === 'a' || shownScreen === 'b' || shownScreen === 'c') && data.annotations.length > 0;
  const serverLang = locale === 'es' ? undefined : 'es';

  return (
    <div className={cn('flex flex-col gap-6', updating && 'opacity-60 motion-reduce:opacity-100')} data-testid={`mkt-screen-${shownScreen}`} data-period-from={data.period.from}>
      {error && (
        <Banner variant="danger" role="alert" action={<Button variant="secondary" size="sm" onClick={onRetry}>{t('state.retry')}</Button>}>
          {t('state.error')}
        </Banner>
      )}
      {data.notes && data.notes.length > 0 && (
        <Banner variant="info" title={t('coverage.title')}>
          <ul className="list-disc pl-4" data-testid="mkt-coverage" lang={serverLang}>
            {data.notes.map((n, i) => (
              <li key={i}>{withoutCoveragePrefix(n)}</li>
            ))}
          </ul>
        </Banner>
      )}
      {screen === 'e' && shownScreen === 'e' && <p className="text-sm text-text">{t('screen.e.pending')}</p>}
      {allEmpty && <p className="text-sm text-text" data-testid="mkt-screen-empty">{t('screen.empty')}</p>}
      {showStrip && (
        <details data-testid="mkt-ann-strip">
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-text">
            {t('notes.summary', {
              periodo: `${shortDate(data.period.from, locale)} – ${shortDate(data.period.to, locale)}`,
              n: data.annotations.length,
            })}{' '}
            <a
              href="?pantalla=h"
              onClick={(e) => {
                e.preventDefault();
                onManage();
              }}
              className="underline underline-offset-4 hover:text-accent"
            >
              {t('notes.manage')}
            </a>
          </summary>
          <ul className="flex flex-col gap-1 pl-4 text-sm text-text">
            {data.annotations.map((a, i) => (
              <li key={i} className="break-words">
                {annotationDate(a.date, locale)} · <span className="font-mono text-[11px] uppercase tracking-[0.06em]">{t(`ann.kind.${a.kind}`)}</span> ·{' '}
                {a.label}
                {a.kind === 'promocion' && a.destino ? ` → ${a.destino}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.tables.map((tb) => (
        <MarketingTable key={tb.id} table={tb} />
      ))}
      <details>
        <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-text">{t('help.title')}</summary>
        <ul className="flex flex-col gap-1 pl-4 text-sm text-text">
          <li>{t('help.zero')}</li>
          <li>{t('help.small')}</li>
          <li>{t('help.hidden')}</li>
          <li>{t('help.notMeasured')}</li>
          <li>{t('help.none')}</li>
        </ul>
        <p className="mt-2 text-xs text-muted">{t('help.rule')}</p>
      </details>
    </div>
  );
}
