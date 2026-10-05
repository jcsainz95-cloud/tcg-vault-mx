'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSpendAlertSummary, listSpendAlerts, markSpendAlertsSeen } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Link } from '@/i18n/navigation';
import { formatDateTimeMx, formatMoneyCents, formatTimeMx } from '@/lib/format';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import {
  SPEND_ALERT_CODE_BY_KIND,
  type SpendAlertDTO,
  type SpendAlertKind,
  type SpendAlertListFilters,
  type SpendAlertSeverity,
} from '@/types/contract';
import { alertText, alertTitle, titleOfCode } from './alert-text';
import { DAY_RE, FILTER_KINDS, type SpendAlertsUrlFilters } from './filters';
import { useIsOwner } from '../_owner/useIsOwner';

/**
 * «Avisos de gasto» (`DESIGN_SYSTEM §43.19.8` · contrato `§M4-SHIP.19.29.9` + §19.30): lo que el sistema detectó solo
 * sobre dinero que nos cuesta. Solo del súper-admin (GAS-1): el servidor responde `403 MONEY_OUT_FORBIDDEN` al operador
 * y aquí se dice con palabras.
 *
 * - Los filtros escriben la URL (`?kind=&severity=&subjectUserId=&from=&to=&unseen=true&muted=&page=`) con `replaceState`: al
 *   volver del detalle, la página se abre con los mismos filtros (UX-GAS-2).
 * - ⛔ GAS-3: ningún aviso se borra ni se «des-ve». «Marcar visto» deja quién y cuándo y la fila SE QUEDA.
 * - ⛔ GAS-4: las cifras (montos, resumen) se pintan tal cual del DTO; la pantalla no suma ni resta.
 */

function writeUrl(f: SpendAlertsUrlFilters) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const k of ['kind', 'severity', 'subjectUserId', 'from', 'to', 'unseen', 'muted', 'page']) url.searchParams.delete(k);
  if (f.kind) url.searchParams.set('kind', f.kind);
  if (f.severity) url.searchParams.set('severity', f.severity);
  if (f.subjectUserId) url.searchParams.set('subjectUserId', f.subjectUserId);
  if (f.from) url.searchParams.set('from', f.from);
  if (f.to) url.searchParams.set('to', f.to);
  if (f.unseen) url.searchParams.set('unseen', 'true');
  if (f.muted !== undefined) url.searchParams.set('muted', String(f.muted));
  if (f.page && f.page > 1) url.searchParams.set('page', String(f.page));
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/** Ayer, en `America/Mexico_City` (México no tiene horario de verano desde 2022). */
function yesterdayMx(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(now - 86_400_000));
}

export function useAlertTexts() {
  const t = useTranslations('admin.spendAlerts');
  const tOwner = useTranslations('admin.m10.ownerOnly');
  const locale = useLocale() as AppLocale;
  const ctx = useMemo(
    () => ({
      money: (c: number) => formatMoneyCents(c, locale),
      dateTime: (iso: string) => formatDateTimeMx(iso, locale),
      ownerSetting: (k: string) => (tOwner.has(`field.${k}`) ? tOwner(`field.${k}`) : tOwner('field.other')),
    }),
    [locale, tOwner],
  );
  return {
    title: (a: SpendAlertDTO) => alertTitle(t, a),
    text: (a: SpendAlertDTO) => alertText(t, a, ctx),
  };
}

/** Pedido ⇒ enlace al pedido; sin pedido ⇒ envíos filtrados por folio (S-GAS-2: una página que no actúa). */
export function AlertRef({ alert }: { alert: SpendAlertDTO }) {
  const t = useTranslations('admin.spendAlerts');
  if (alert.order?.orderNumber) {
    return (
      <Link href={`/admin/m3/${alert.order.id}`} className="tabular text-sm text-text underline underline-offset-4 hover:text-accent">
        {t('orderRef', { orderNumber: alert.order.orderNumber })}
      </Link>
    );
  }
  if (alert.shipment?.folio) {
    return (
      <Link
        href={`/admin/m4?tab=envios&folio=${encodeURIComponent(alert.shipment.folio)}`}
        className="tabular text-sm text-text underline underline-offset-4 hover:text-accent"
      >
        {t('shipmentRef', { folio: alert.shipment.folio })}
      </Link>
    );
  }
  return <span className="text-sm text-muted">{t('noRef')}</span>;
}

/**
 * El estado del correo (`mail.status`), en `text-xs text-muted`. Un aviso apagado (`muted`, §43.20.5) dice
 * «Apagado: sin correo» **en lugar de** la línea del correo (⛔ las dos a la vez no: «Va en el resumen» mentiría).
 */
export function MailStatus({ alert }: { alert: SpendAlertDTO }) {
  const t = useTranslations('admin.spendAlerts');
  const locale = useLocale() as AppLocale;
  if (alert.muted) return <span className="text-xs text-muted">{t('mutedTag')}</span>;
  const time = alert.mail.at ? formatDateTimeMx(alert.mail.at, locale) : '';
  return <span className="text-xs text-muted">{t(`mail.${alert.mail.status}`, { time })}</span>;
}

/**
 * §43.20.6 (`seen`, §19.30.2 (4)): un súper-admin que NO es el dueño no marca los avisos sobre sí mismo ni los AG-21 —
 * en su lugar «Lo marca el dueño». Solo para mostrar (OWN-2): el servidor decide y cuenta `skipped`. `isOwner`
 * desconocido ⇒ se pinta el botón (⛔ aquí no se falla cerrado: no hay dinero en marcar visto).
 */
export function useOwnerMarks() {
  const { isOwner, known, userId } = useIsOwner();
  return (a: Pick<SpendAlertDTO, 'code' | 'subject'>) =>
    known && !isOwner && (a.code === 'AG-21' || (!!userId && a.subject?.userId === userId));
}

export function SeverityTag({ severity, muted = false }: { severity: SpendAlertSeverity; muted?: boolean }) {
  const t = useTranslations('admin.spendAlerts');
  // ⛔ Sin color de fondo: la gravedad la dice la palabra (§43.19.16); «Inmediato» en bermellón, salvo apagado
  // (§43.20.5: no mandó correo ni cuenta en la tarjeta; el bermellón mentiría).
  return (
    <span className={cn('font-mono text-[11px] uppercase tracking-[0.06em]', severity === 'immediate' && !muted ? 'text-accent' : 'text-muted')}>
      {t(`severityTag.${severity}`)}
    </span>
  );
}

export function SpendAlertsView({ initial = {} }: { initial?: SpendAlertsUrlFilters }) {
  const t = useTranslations('admin.spendAlerts');
  const tm = useTranslations('admin.modules');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const texts = useAlertTexts();
  const ownerMarks = useOwnerMarks();
  const [filters, setFiltersState] = useState<SpendAlertsUrlFilters>(initial);
  const [subjectName, setSubjectName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);

  function setFilters(next: SpendAlertsUrlFilters) {
    const clean = { ...next, page: next.page && next.page > 1 ? next.page : undefined };
    setFiltersState(clean);
    setSelected(new Set());
    setResult(null);
    writeUrl(clean);
  }
  const patch = (p: Partial<SpendAlertsUrlFilters>) => setFilters({ ...filters, ...p, page: 'page' in p ? p.page : undefined });

  const query: SpendAlertListFilters = { ...filters, pageSize: 25 };
  const list = useQuery({ queryKey: ['spend-alerts', query], queryFn: () => listSpendAlerts(query), retry: false });
  const rows = list.data?.data ?? [];
  // `muted:false` («Sin los apagados») SÍ es un filtro.
  const hasFilters = Object.entries(filters).some(([k, v]) => k !== 'page' && v !== undefined && (k === 'muted' || v !== false));
  const forbidden = asApiError(list.error)?.code === 'MONEY_OUT_FORBIDDEN';

  const mark = useMutation({
    mutationFn: (ids: string[]) => markSpendAlertsSeen(ids),
    onSuccess: (res) => {
      // GAS-3: la lista se relee y la fila SE QUEDA con «Visto por…» (⛔ sin deshacer).
      const parts = [t('marked', { updated: res.updated })];
      if (res.skipped) parts.push(t('skipped', { skipped: res.skipped }));
      setResult(parts.join(' '));
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['spend-alerts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
    },
  });

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const page = filters.page ?? 1;
  const subjectLabel = subjectName ?? rows.find((r) => r.subject?.userId === filters.subjectUserId)?.subject?.name ?? t('filters.subjectUnknown');
  const pageIds = rows.map((r) => r.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const kindOptions = [
    { value: '', label: t('filters.kindAll') },
    // Los trece con disparador más AG-21 y AG-22 (OWN-3); AG-14…AG-20 sin disparador no se listan.
    ...FILTER_KINDS.map((k) => ({
      value: k,
      label: t('filters.kindOption', { code: SPEND_ALERT_CODE_BY_KIND[k], title: titleOfCode(t, SPEND_ALERT_CODE_BY_KIND[k]) }),
    })),
  ];

  const statusCell = (a: SpendAlertDTO, testIds = true) => (
    <div className="flex flex-col gap-1">
      {a.seen ? (
        <span className="text-sm text-muted" data-testid={testIds ? `spend-alert-seen-${a.id}` : undefined}>
          {t('seenBy', { name: a.seen.by.name?.trim() || t('personNone'), date: formatDateTimeMx(a.seen.at, locale) })}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text">{t('unseenTag')}</span>
          {ownerMarks(a) ? (
            <span className="text-sm text-muted">{t('ownerMarks')}</span>
          ) : (
            <Button size="sm" variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate([a.id])}>
              {t('markSeen')}
            </Button>
          )}
        </span>
      )}
      {a.resolvedAt && <span className="text-sm text-muted">{t('resolved', { date: formatDateTimeMx(a.resolvedAt, locale) })}</span>}
      <MailStatus alert={a} />
    </div>
  );

  const whoCell = (a: SpendAlertDTO) =>
    a.subject ? (
      <Button
        size="sm"
        variant="link"
        className="self-start"
        aria-label={t('filterBySubject', { name: a.subject.name?.trim() || t('personNone') })}
        onClick={() => {
          setSubjectName(a.subject?.name?.trim() || t('personNone'));
          patch({ subjectUserId: a.subject?.userId });
        }}
      >
        {a.subject.name?.trim() || t('personNone')}
      </Button>
    ) : (
      <span className="text-sm text-muted">{t('noSubject')}</span>
    );

  const whenCell = (a: SpendAlertDTO) => (
    <div className="flex flex-col">
      <span className="tabular text-sm text-text">{formatDateTimeMx(a.firstOccurredAt, locale)}</span>
      {a.occurrenceCount > 1 && <span className="text-xs text-muted">{t('occurrences', { n: a.occurrenceCount, time: formatTimeMx(a.lastOccurredAt, locale) })}</span>}
    </div>
  );

  const alertCell = (a: SpendAlertDTO) => (
    <div className="flex flex-col gap-0.5">
      <Link href={`/admin/spend-alerts/${a.id}`} className="text-sm font-semibold text-text underline-offset-4 hover:text-accent hover:underline">
        {texts.title(a)}
      </Link>
      <span className="text-sm text-text">{texts.text(a)}</span>
    </div>
  );

  const amountCell = (a: SpendAlertDTO) =>
    a.amountCents === null ? <span className="text-sm text-muted">{t('noAmount')}</span> : <span className="tabular text-sm text-text">{formatMoneyCents(a.amountCents, locale)}</span>;

  const checkbox = (a: SpendAlertDTO) => (
    <input
      type="checkbox"
      aria-label={t('col.select', { code: a.code })}
      checked={selected.has(a.id)}
      onChange={(e) =>
        setSelected((s) => {
          const n = new Set(s);
          if (e.target.checked) n.add(a.id);
          else n.delete(a.id);
          return n;
        })
      }
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl text-text">{tm('spendAlerts')}</h1>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </header>

      {forbidden ? (
        <Banner variant="warning" role="alert">
          {t('forbidden')}
        </Banner>
      ) : (
        <>
          <DaySummary />

          <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => e.preventDefault()}>
            <div className="min-w-[14rem]">
              <Select label={t('filters.kind')} options={kindOptions} value={filters.kind ?? ''} onChange={(e) => patch({ kind: (e.target.value || undefined) as SpendAlertKind | undefined })} />
            </div>
            <div className="min-w-[10rem]">
              <Select
                label={t('filters.severity')}
                options={[
                  { value: '', label: t('filters.severityAll') },
                  { value: 'immediate', label: t('filters.severityImmediate') },
                  { value: 'digest', label: t('filters.severityDigest') },
                ]}
                value={filters.severity ?? ''}
                onChange={(e) => patch({ severity: (e.target.value || undefined) as SpendAlertSeverity | undefined })}
              />
            </div>
            <Input label={t('filters.from')} type="date" value={filters.from ?? ''} onChange={(e) => patch({ from: e.target.value || undefined })} />
            <Input label={t('filters.to')} type="date" value={filters.to ?? ''} onChange={(e) => patch({ to: e.target.value || undefined })} />
            <div className="min-w-[11rem]">
              <Select
                label={t('filters.muted')}
                options={[
                  { value: '', label: t('filters.mutedAll') },
                  { value: 'true', label: t('filters.mutedOnly') },
                  { value: 'false', label: t('filters.mutedNone') },
                ]}
                value={filters.muted === undefined ? '' : String(filters.muted)}
                onChange={(e) => patch({ muted: e.target.value === '' ? undefined : e.target.value === 'true' })}
              />
            </div>
            <label className="flex items-center gap-2 pb-3 text-sm text-text">
              <input type="checkbox" checked={!!filters.unseen} onChange={(e) => patch({ unseen: e.target.checked || undefined })} />
              {t('filters.unseen')}
            </label>
            {filters.subjectUserId && (
              <span className="flex items-center gap-1 pb-3 text-sm text-text" data-testid="spend-alerts-subject-chip">
                {t('filters.subject', { name: subjectLabel })}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('filters.subjectRemove', { name: subjectLabel })}
                  onClick={() => {
                    setSubjectName(null);
                    patch({ subjectUserId: undefined });
                  }}
                >
                  ✕
                </Button>
              </span>
            )}
            {hasFilters && (
              <Button variant="link" className="pb-3" onClick={() => setFilters({})}>
                {t('filters.clear')}
              </Button>
            )}
          </form>

          {result && (
            <p role="status" className="text-sm text-text">
              {result}
            </p>
          )}

          <QueryState
            isLoading={list.isLoading}
            isError={list.isError}
            error={list.error}
            onRetry={() => list.refetch()}
            loading={
              <div className="flex flex-col gap-2" aria-busy="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            }
          >
            {list.data &&
              (rows.length === 0 ? (
                hasFilters ? (
                  <EmptyState
                    title={t('emptyFiltered')}
                    action={
                      <Button variant="secondary" onClick={() => setFilters({})}>
                        {t('filters.clear')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState title={t('empty')} />
                )
              ) : (
                <div className="flex flex-col gap-4">
                  {selected.size > 0 && (
                    <Button variant="secondary" className="self-start" loading={mark.isPending} onClick={() => mark.mutate([...selected])}>
                      {t('markSelected', { n: selected.size })}
                    </Button>
                  )}
                  {/* Desde `md`: tabla; en móvil, una tarjeta por aviso con el mismo orden. */}
                  <table className="hidden w-full border-collapse text-left md:table" data-testid="spend-alerts-table">
                    <thead>
                      <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                        <th className="py-2 pr-3">
                          <input
                            type="checkbox"
                            aria-label={t('col.selectPage')}
                            checked={allSelected}
                            onChange={(e) => setSelected(e.target.checked ? new Set(pageIds) : new Set())}
                          />
                        </th>
                        <th className="py-2 pr-3">{t('col.when')}</th>
                        <th className="py-2 pr-3">{t('col.severity')}</th>
                        <th className="py-2 pr-3">{t('col.alert')}</th>
                        <th className="py-2 pr-3">{t('col.who')}</th>
                        <th className="py-2 pr-3 text-right">{t('col.amount')}</th>
                        <th className="py-2 pr-3">{t('col.ref')}</th>
                        <th className="py-2">{t('col.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => (
                        <tr key={a.id} className="border-b border-border align-top" data-testid={`spend-alert-row-${a.id}`}>
                          <td className="py-3 pr-3">{checkbox(a)}</td>
                          <td className="py-3 pr-3">{whenCell(a)}</td>
                          <td className="py-3 pr-3">
                            <SeverityTag severity={a.severity} muted={!!a.muted} />
                          </td>
                          <td className="py-3 pr-3">{alertCell(a)}</td>
                          <td className="py-3 pr-3">{whoCell(a)}</td>
                          <td className="py-3 pr-3 text-right">{amountCell(a)}</td>
                          <td className="py-3 pr-3">
                            <AlertRef alert={a} />
                          </td>
                          <td className="py-3">{statusCell(a)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="flex flex-col gap-3 md:hidden">
                    {rows.map((a) => (
                      <li key={a.id} className="flex flex-col gap-2 border-b border-border pb-3">
                        <div className="flex items-center gap-3">
                          {checkbox(a)}
                          {whenCell(a)}
                          <SeverityTag severity={a.severity} muted={!!a.muted} />
                        </div>
                        {alertCell(a)}
                        {whoCell(a)}
                        {amountCell(a)}
                        <AlertRef alert={a} />
                        {statusCell(a, false)}
                      </li>
                    ))}
                  </ul>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-3">
                      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => patch({ page: page - 1 })}>
                        {t('prev')}
                      </Button>
                      <span className="tabular text-xs text-muted">{t('pageInfo', { page, totalPages, total: list.data.total })}</span>
                      <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => patch({ page: page + 1 })}>
                        {t('next')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
          </QueryState>
        </>
      )}
    </div>
  );
}

/** «Resumen de un día» (§43.19.8): plegado; lee `GET …/summary` del día elegido (por defecto ayer) y pinta TAL CUAL. */
function DaySummary() {
  const t = useTranslations('admin.spendAlerts');
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(yesterdayMx);
  const summary = useQuery({
    queryKey: ['spend-alerts-summary', day],
    queryFn: () => getSpendAlertSummary(day, day),
    enabled: open && DAY_RE.test(day),
    retry: false,
  });
  const money = (c: number) => formatMoneyCents(c, locale);
  const s = summary.data;
  return (
    <details className="border-y border-border py-3" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="spend-alerts-summary">
      <summary className="cursor-pointer font-serif text-lg text-text">{t('summary.title')}</summary>
      <div className="mt-3 flex flex-col gap-4">
        <div className="max-w-[12rem]">
          <Input label={t('summary.day')} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <p className="text-sm text-muted">{t('summary.note')}</p>
        {open && (
          <QueryState isLoading={summary.isLoading} isError={summary.isError} error={summary.error} onRetry={() => summary.refetch()}>
            {s && (
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-2">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{t('summary.byKind')}</h2>
                  {s.byKind.length === 0 ? (
                    <p className="text-sm text-text">{t('summary.byKindEmpty')}</p>
                  ) : (
                    <table className="w-full border-collapse text-sm text-text" data-testid="spend-summary-by-kind">
                      <thead>
                        <tr className="border-b border-border font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                          <th className="py-1 pr-3 text-left">{t('summary.colAlert')}</th>
                          <th className="py-1 pr-3 text-right">{t('summary.colImmediate')}</th>
                          <th className="py-1 pr-3 text-right">{t('summary.colDigest')}</th>
                          <th className="py-1 text-right">{t('summary.colAmount')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.byKind.map((r) => (
                          <tr key={r.code} className="border-b border-border">
                            <td className="py-1 pr-3">{t('filters.kindOption', { code: r.code, title: titleOfCode(t, r.code) })}</td>
                            <td className="tabular py-1 pr-3 text-right">{r.immediate}</td>
                            <td className="tabular py-1 pr-3 text-right">{r.digest}</td>
                            <td className="tabular py-1 text-right">{money(r.amountCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
                <section className="flex flex-col gap-1">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{t('summary.labelSpend')}</h2>
                  {s.labelSpendByPerson.length === 0 ? (
                    <p className="text-sm text-text">{t('summary.labelSpendEmpty')}</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5 text-sm text-text" data-testid="spend-summary-people">
                      {s.labelSpendByPerson.map((p) => (
                        <li key={p.userId}>{t('summary.labelSpendRow', { name: p.name?.trim() || t('personNone'), cents: money(p.cents), labels: p.labels })}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="flex flex-col gap-1">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{t('summary.costly')}</h2>
                  <p className="text-sm text-text" data-testid="spend-summary-costly">
                    {s.costlyChoices.count === 0
                      ? t('summary.costlyNone')
                      : t('summary.costlyRow', {
                          count: s.costlyChoices.count,
                          over: money(s.costlyChoices.overRecommendedCents),
                          byPerson: s.costlyChoices.byPerson.map((p) => `${p.name?.trim() || t('personNone')} ${p.count}`).join(', '),
                        })}
                  </p>
                </section>
              </div>
            )}
          </QueryState>
        )}
      </div>
    </details>
  );
}
