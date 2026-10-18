'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { asApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import {
  createMarketingAnnotation,
  deleteMarketingAnnotation,
  listMarketingAnnotations,
  updateMarketingAnnotation,
} from '@/lib/marketing-api';
import type { AppLocale } from '@/i18n/routing';
import type { MarketingAnnotationDTO, MarketingAnnotationInput, MarketingAnnotationKind } from '@/types/contract';
import { MktDialog } from './MktDialog';
import { annotationDate } from './mkt-format';
import { useReportForbidden } from './forbidden';

/**
 * Pantalla «Anotaciones» (`?pantalla=h`, `DESIGN_SYSTEM §MKT-UX.8`; contrato §MKT.E h1). Lista + alta/edición/borrado.
 * El filtro de datos personales es DEL SERVIDOR (`422`); aquí solo se valida lo obvio (obligatorios y largos) y el
 * aviso de privacidad se ve SIEMPRE, antes de escribir (MKT-7). Etiqueta y destino se pintan como texto (MKT-6).
 */

const KINDS: readonly MarketingAnnotationKind[] = ['promocion', 'despliegue', 'evento'];
const LABEL_MAX = 120;
const DEST_MAX = 200;

export function PiiNotice() {
  const t = useTranslations('admin.marketing.ann.pii');
  return (
    <Banner variant="warning" title={t('title')} className="bg-bg" role="status">
      <span data-testid="mkt-ann-pii">{t('body')}</span>
    </Banner>
  );
}

export function AnnotationsScreen({ period }: { period: { from: string; to: string } | null }) {
  const t = useTranslations('admin.marketing.ann');
  const tState = useTranslations('admin.marketing.state');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const reportForbidden = useReportForbidden();
  const [show, setShow] = useState<'period' | 'all'>('period');
  const [editing, setEditing] = useState<MarketingAnnotationDTO | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MarketingAnnotationDTO | null>(null);
  const [announce, setAnnounce] = useState('');
  const listHeading = useRef<HTMLHeadingElement>(null);

  const range = show === 'period' && period ? { from: period.from, to: period.to } : {};
  const list = useQuery({
    queryKey: ['mkt', 'annotations', show, range.from ?? null, range.to ?? null],
    queryFn: () => listMarketingAnnotations(range),
    enabled: show === 'all' || period !== null,
    retry: false,
  });
  useEffect(() => {
    if (list.error) reportForbidden(list.error);
  }, [list.error, reportForbidden]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['mkt', 'annotations'] });
    void qc.invalidateQueries({ queryKey: ['mkt', 'panel'] });
  }

  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 ref={listHeading} tabIndex={-1} className="font-serif text-2xl text-text outline-none">
            {t('title')}
          </h2>
          <p className="text-sm text-muted">{t('lede')}</p>
        </div>
        <Button onClick={() => setEditing('new')} data-testid="mkt-ann-new">
          {t('new')}
        </Button>
      </div>

      <PiiNotice />

      <div role="group" aria-label={t('show.group')} className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">{t('show.group')}</span>
        {(['period', 'all'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={show === k}
            onClick={() => setShow(k)}
            className={cn(
              'min-h-[44px] border px-4 font-mono text-[11px] uppercase tracking-[0.06em]',
              show === k ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
            )}
          >
            {t(`show.${k}`)}
          </button>
        ))}
      </div>

      <p role="status" className="sr-only" data-testid="mkt-ann-status">
        {announce}
      </p>

      {list.isPending && list.fetchStatus !== 'idle' ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span role="status" className="sr-only">
            {tState('loading')}
          </span>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button variant="secondary" size="sm" onClick={() => list.refetch()}>
              {tState('retry')}
            </Button>
          }
        >
          {tState('error')}
        </Banner>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3" data-testid="mkt-ann-empty">
          <p className="text-sm text-text">{show === 'all' ? t('emptyAll') : t('emptyPeriod')}</p>
          <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
            {t('new')}
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full border-collapse" data-testid="mkt-ann-table">
              <caption className="sr-only">{t('title')}</caption>
              <thead>
                <tr className="border-b border-border-strong">
                  {(['date', 'type', 'label', 'dest', 'actions'] as const).map((c) => (
                    <th key={c} scope="col" className="py-2 pr-4 text-left font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                      {t(`col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-border align-top" data-testid="mkt-ann-row">
                    <th scope="row" className="tabular py-2.5 pr-4 text-left text-sm font-normal tabular-nums text-text">
                      {annotationDate(a.date, locale)}
                    </th>
                    <td className="py-2.5 pr-4">
                      <Badge>{t(`kind.${a.kind}`)}</Badge>
                    </td>
                    <td className="break-words py-2.5 pr-4 text-sm text-text">{a.label}</td>
                    <td className="break-words py-2.5 pr-4 text-sm text-text">{a.kind === 'promocion' && a.destino ? a.destino : '—'}</td>
                    <td className="py-2.5">
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(a)}>
                          {t('edit')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(a)}>
                          {t('delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((a) => (
              <article key={a.id} className="flex flex-col gap-1 border-b border-border pb-3">
                <p className="tabular text-sm text-text">
                  {annotationDate(a.date, locale)} · <Badge>{t(`kind.${a.kind}`)}</Badge>
                </p>
                <p className="break-words text-sm text-text">{a.label}</p>
                {a.kind === 'promocion' && a.destino && <p className="break-words text-sm text-muted">{a.destino}</p>}
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(a)}>
                    {t('edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(a)}>
                    {t('delete')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {editing !== null && (
        <AnnotationDialog
          initial={editing === 'new' ? null : editing}
          defaultDate={period?.from ?? ''}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
            setAnnounce(t('saved'));
          }}
          onGone={() => {
            setEditing(null);
            refresh();
            setAnnounce(t('errGone'));
          }}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          annotation={deleting}
          onClose={() => setDeleting(null)}
          onDone={(gone) => {
            setDeleting(null);
            refresh();
            setAnnounce(gone ? t('errGone') : t('deleted'));
            requestAnimationFrame(() => listHeading.current?.focus());
          }}
        />
      )}
    </div>
  );
}

type FieldErr = { label?: string; destino?: string; date?: string; kind?: string };

export function AnnotationDialog({
  initial,
  defaultDate,
  onClose,
  onSaved,
  onGone,
}: {
  initial: MarketingAnnotationDTO | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (a: MarketingAnnotationDTO) => void;
  onGone: () => void;
}) {
  const t = useTranslations('admin.marketing.ann');
  const reportForbidden = useReportForbidden();
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [kind, setKind] = useState<MarketingAnnotationKind | ''>(initial?.kind ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [destino, setDestino] = useState(initial?.destino ?? '');
  const [errors, setErrors] = useState<FieldErr>({});
  const [banner, setBanner] = useState<'dest' | 'generic' | null>(null);
  const [focusField, setFocusField] = useState<keyof FieldErr | null>(null);
  const [counterLive, setCounterLive] = useState('');
  const refs = {
    date: useRef<HTMLInputElement>(null),
    kind: useRef<HTMLSelectElement>(null),
    label: useRef<HTMLInputElement>(null),
    destino: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    if (!focusField) return;
    refs[focusField].current?.focus();
    setFocusField(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField]);

  const save = useMutation({
    mutationFn: (input: MarketingAnnotationInput) =>
      initial ? updateMarketingAnnotation(initial.id, input) : createMarketingAnnotation(input),
    onSuccess: (a) => onSaved(a),
    onError: (e) => {
      if (reportForbidden(e)) return;
      const err = asApiError(e);
      if (err?.status === 404) return onGone();
      if (err?.status === 422) {
        const field = (err.details as { field?: unknown } | undefined)?.field;
        if (field === 'destino' && kind !== 'promocion') return setBanner('dest');
        const target: 'label' | 'destino' = field === 'destino' ? 'destino' : 'label';
        setErrors({ [target]: t('errPii') });
        setFocusField(target);
        return;
      }
      setBanner('generic');
    },
  });

  function onLabelChange(v: string) {
    const before = label.length;
    setLabel(v);
    const crossed = [100, LABEL_MAX].find((n) => (before < n && v.length >= n) || (before >= n && v.length < n));
    if (crossed !== undefined) setCounterLive(t('field.counter', { n: v.length, max: LABEL_MAX }));
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBanner(null);
    const next: FieldErr = {};
    if (!date) next.date = t('errRequired');
    if (!kind) next.kind = t('errRequired');
    if (!label.trim()) next.label = t('errRequired');
    setErrors(next);
    const firstBad = (['date', 'kind', 'label'] as const).find((k) => next[k]);
    if (firstBad) return setFocusField(firstBad);
    const input: MarketingAnnotationInput = { date, kind: kind as MarketingAnnotationKind, label: label.trim() };
    const dest = destino.trim();
    if (kind === 'promocion' && dest) input.destino = dest;
    else if (initial && initial.destino) input.destino = ''; // PATCH: `""` borra el destino (DTO `Length(0,200)`)
    save.mutate(input);
  }

  return (
    <MktDialog
      open
      onClose={onClose}
      title={initial ? t('editTitle') : t('new')}
      testId="mkt-ann-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            {t('cancel')}
          </Button>
          <Button onClick={() => submit()} loading={save.isPending} data-testid="mkt-ann-save">
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <PiiNotice />
        {banner && (
          <Banner
            variant="danger"
            role="alert"
            action={
              banner === 'generic' ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => submit()}>
                  {t('save')}
                </Button>
              ) : undefined
            }
          >
            {banner === 'dest' ? t('errDest') : t('errGeneric')}
          </Banner>
        )}
        <Input
          ref={refs.date}
          type="date"
          label={t('field.date')}
          value={date}
          required
          onChange={(e) => setDate(e.target.value)}
          error={errors.date}
        />
        <Select
          ref={refs.kind}
          label={t('field.kind')}
          value={kind}
          required
          placeholder="—"
          options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
          onChange={(e) => {
            const v = e.target.value as MarketingAnnotationKind | '';
            setKind(v);
            if (v !== 'promocion') setDestino(''); // UX-MKT-13: oculto ⇒ vacío, nunca enviado
          }}
          error={errors.kind}
        />
        <div className="flex flex-col gap-1">
          <Input
            ref={refs.label}
            label={t('field.label')}
            value={label}
            required
            maxLength={LABEL_MAX}
            autoComplete="off"
            onChange={(e) => onLabelChange(e.target.value)}
            hint={t('field.labelHelp')}
            error={errors.label}
          />
          <p className="tabular text-right font-mono text-xs text-muted" aria-hidden>
            {t('field.counter', { n: label.length, max: LABEL_MAX })}
          </p>
          <span className="sr-only" aria-live="polite">
            {counterLive}
          </span>
        </div>
        {kind === 'promocion' && (
          <Input
            ref={refs.destino}
            label={t('field.dest')}
            value={destino}
            maxLength={DEST_MAX}
            autoComplete="off"
            onChange={(e) => setDestino(e.target.value)}
            hint={t('field.destHelp')}
            error={errors.destino}
          />
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </MktDialog>
  );
}

function ConfirmDeleteDialog({
  annotation,
  onClose,
  onDone,
}: {
  annotation: MarketingAnnotationDTO;
  onClose: () => void;
  onDone: (gone: boolean) => void;
}) {
  const t = useTranslations('admin.marketing.ann');
  const locale = useLocale() as AppLocale;
  const reportForbidden = useReportForbidden();
  const [failed, setFailed] = useState(false);
  const del = useMutation({
    mutationFn: () => deleteMarketingAnnotation(annotation.id),
    onSuccess: () => onDone(false),
    onError: (e) => {
      if (reportForbidden(e)) return;
      if (asApiError(e)?.status === 404) return onDone(true);
      setFailed(true);
    },
  });
  return (
    <MktDialog
      open
      onClose={onClose}
      title={t('delTitle')}
      testId="mkt-ann-delete-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="destructive" loading={del.isPending} onClick={() => del.mutate()} data-testid="mkt-ann-delete-confirm">
            {del.isPending ? t('deleting') : t('delConfirm')}
          </Button>
        </>
      }
    >
      <p className="tabular text-sm text-text">{annotationDate(annotation.date, locale)}</p>
      <p className="break-words text-sm text-text">{annotation.label}</p>
      {failed && (
        <Banner variant="danger" role="alert" className="mt-3">
          {t('errGeneric')}
        </Banner>
      )}
    </MktDialog>
  );
}
