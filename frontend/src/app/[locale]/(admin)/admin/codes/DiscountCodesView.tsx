'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  downloadDiscountCodeBatchCsv,
  listDiscountCodeBatches,
  listDiscountCodes,
  setDiscountCodeBatchPaused,
  setDiscountCodePaused,
  type DiscountCodeListParams,
} from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { downloadTextFile } from '@/lib/download';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { DiscountCodeBatchDTO, DiscountCodeDTO, DiscountCodeState } from '@/types/contract';
import { describeDiscount, describeUsage, describeValidity } from './dsc-format';

/** Chips de §DSC-UX.5: Todos · Activos · Pausados · Vencidos · Agotados. `paused` va por `?status=` (E); el resto por `?state=` (L). */
export type CodesFilter = 'all' | 'live' | 'paused' | 'expired' | 'exhausted';
const FILTERS: readonly CodesFilter[] = ['all', 'live', 'paused', 'expired', 'exhausted'];

function paramsOf(f: CodesFilter): DiscountCodeListParams {
  if (f === 'all') return {};
  if (f === 'paused') return { status: 'paused' };
  return { state: f };
}

/** Estado en versalitas (portador del significado): Activo verde, Pausado `accent`, el resto `muted`. */
export function StateTag({ state }: { state: DiscountCodeState }) {
  const t = useTranslations('admin.discounts');
  return (
    <span
      data-testid="code-state"
      className={cn(
        'font-mono text-[11px] uppercase tracking-label',
        state === 'live' ? 'text-success' : state === 'paused' ? 'text-accent' : 'text-muted',
      )}
    >
      {t(`states.${state}`)}
    </span>
  );
}

/**
 * «Códigos de descuento» (DESIGN_SYSTEM §DSC-UX.5, contrato §DSC.7). Solo `super_admin`: la página va tras
 * `SuperAdminOnly` y el servidor responde `403` al operador. La lista no suma ni resta: «Descuento dado» y los usos
 * vienen del servidor (el reporte de cada código). Un lote = una fila plegable.
 */
export function DiscountCodesView() {
  const t = useTranslations('admin.discounts');
  const tm = useTranslations('admin.modules');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage('operator');
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<CodesFilter>('all');
  const [status, setStatus] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<DiscountCodeBatchDTO | null>(null);
  const [openBatch, setOpenBatch] = useState<string | null>(null);

  const codes = useQuery({ queryKey: ['admin-discount-codes', filter], queryFn: () => listDiscountCodes(paramsOf(filter)) });
  const batches = useQuery({ queryKey: ['admin-discount-batches'], queryFn: () => listDiscountCodeBatches() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-discount-codes'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-discount-batches'] });
  };

  const pauseCode = useMutation({
    mutationFn: ({ c, paused }: { c: DiscountCodeDTO; paused: boolean }) => setDiscountCodePaused(c.id, paused),
    onSuccess: (dto, { paused }) => {
      setActionError(null);
      setStatus(paused ? t('pausedNotice', { code: dto.code }) : t('resumedNotice', { code: dto.code }));
      invalidate();
    },
    onError: (e) => setActionError(getMessage(e)),
  });
  const pauseBatch = useMutation({
    mutationFn: ({ b, paused }: { b: DiscountCodeBatchDTO; paused: boolean }) => setDiscountCodeBatchPaused(b.id, paused),
    onSuccess: (dto, { paused }) => {
      setActionError(null);
      setConfirmBatch(null);
      setStatus(paused ? t('pausedNotice', { code: dto.prefix }) : t('resumedNotice', { code: dto.prefix }));
      invalidate();
    },
    onError: (e) => setActionError(getMessage(e)),
  });

  async function downloadCsv(b: DiscountCodeBatchDTO) {
    try {
      const res = await downloadDiscountCodeBatchCsv(b.id);
      downloadTextFile(res.filename ?? `lote-${b.prefix}.csv`, await res.blob.text());
    } catch (e) {
      setActionError(getMessage(e));
    }
  }

  // Los lotes se filtran por el `state` que manda el servidor (⛔ sin derivarlo aquí).
  const batchRows = (batches.data?.data ?? []).filter((b) =>
    filter === 'all' ? true : filter === 'paused' ? b.status === 'paused' : b.state === filter,
  );
  const codeRows = codes.data?.data ?? [];
  const nothing = codeRows.length === 0 && batchRows.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-text">{tm('discounts')}</h1>
          <p className="mt-2 text-sm text-muted">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/codes/new"
            className="inline-flex min-h-[44px] items-center bg-primary px-5 text-[11px] font-medium uppercase tracking-label text-primary-fg"
          >
            {t('newCode')}
          </Link>
          <Link
            href="/admin/codes/batch/new"
            className="inline-flex min-h-[44px] items-center border border-text px-5 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
          >
            {t('generateBatch')}
          </Link>
        </div>
      </div>

      <div role="group" aria-label={t('filters.label')} className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'min-h-[44px] border px-4 text-[11px] uppercase tracking-label',
              filter === f ? 'border-text bg-text text-primary-fg' : 'border-border text-text hover:border-text',
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>

      <p role="status" aria-live="polite" className="mt-4 text-sm text-text empty:hidden">
        {status}
      </p>
      {actionError && (
        <p role="alert" className="mt-4 font-mono text-xs text-accent">
          {actionError}
        </p>
      )}

      <div className="mt-6">
        <QueryState
          isLoading={codes.isLoading || batches.isLoading}
          isError={codes.isError || batches.isError}
          error={codes.error ?? batches.error}
          onRetry={() => {
            void codes.refetch();
            void batches.refetch();
          }}
        >
          {nothing ? (
            <EmptyState title={filter === 'all' ? t('empty') : t('emptyFiltered')} />
          ) : (
            <div className="border-t border-border">
              {/* Cabecera solo desde md; en < md cada fila es una tarjeta con código, estado, descuento y usos. */}
              <div className="hidden grid-cols-[1.2fr_1.3fr_1.1fr_0.8fr_1fr_0.9fr_auto] gap-4 border-b border-border py-3 font-mono text-[10px] uppercase tracking-label text-muted md:grid">
                <span>{t('columns.code')}</span>
                <span>{t('columns.discount')}</span>
                <span>{t('columns.validity')}</span>
                <span>{t('columns.state')}</span>
                <span>{t('columns.usage')}</span>
                <span className="text-right">{t('columns.given')}</span>
                <span className="text-right">{t('columns.actions')}</span>
              </div>
              <ul>
                {codeRows.map((c) => (
                  <li
                    key={c.id}
                    data-testid="code-list-row"
                    className="grid min-w-0 grid-cols-1 gap-2 border-b border-border py-4 md:grid-cols-[1.2fr_1.3fr_1.1fr_0.8fr_1fr_0.9fr_auto] md:items-center md:gap-4"
                  >
                    <span className="min-w-0 font-mono text-sm font-semibold text-text [overflow-wrap:anywhere]">{c.code}</span>
                    <span className="text-sm text-text">{describeDiscount(c, t, locale)}</span>
                    <span className="text-sm text-muted">{describeValidity(c, t, locale)}</span>
                    <StateTag state={c.state} />
                    <span className="tabular text-sm text-text">{describeUsage(c, t)}</span>
                    {/* «Descuento dado» = `usage.discountGivenCents` del servidor (v1.110.1), ⛔ sin sumar aquí. */}
                    <span data-testid="code-given" className="tabular text-sm text-text md:text-right">
                      <span className="text-muted md:hidden">{t('columns.given')}: </span>
                      {formatMoneyCents(c.usage.discountGivenCents, locale)}
                    </span>
                    <span className="flex flex-wrap gap-2 md:justify-end">
                      {c.state !== 'expired' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="min-h-[44px]"
                          loading={pauseCode.isPending && pauseCode.variables?.c.id === c.id}
                          onClick={() => pauseCode.mutate({ c, paused: c.status !== 'paused' })}
                        >
                          {c.status === 'paused' ? t('resume') : t('pause')}
                        </Button>
                      )}
                      <Link href={`/admin/codes/${c.id}`} className="inline-flex min-h-[44px] items-center px-2 text-sm underline underline-offset-4">
                        {t('edit')}
                      </Link>
                      <Link
                        href={`/admin/codes/${c.id}/report`}
                        className="inline-flex min-h-[44px] items-center px-2 text-sm underline underline-offset-4"
                      >
                        {t('viewReport')}
                      </Link>
                    </span>
                  </li>
                ))}
                {batchRows.map((b) => (
                  <BatchRow
                    key={b.id}
                    batch={b}
                    open={openBatch === b.id}
                    onToggle={() => setOpenBatch(openBatch === b.id ? null : b.id)}
                    onPause={() => setConfirmBatch(b)}
                    onResume={() => pauseBatch.mutate({ b, paused: false })}
                    onCsv={() => void downloadCsv(b)}
                    busy={pauseBatch.isPending && pauseBatch.variables?.b.id === b.id}
                  />
                ))}
              </ul>
            </div>
          )}
        </QueryState>
      </div>

      {/* D6: pausar un LOTE pide confirmación; reanudar nunca. */}
      <Modal
        open={!!confirmBatch}
        onClose={() => setConfirmBatch(null)}
        title={confirmBatch ? t('pauseBatchConfirm.title', { prefix: confirmBatch.prefix }) : ''}
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmBatch(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="accent"
              loading={pauseBatch.isPending}
              onClick={() => confirmBatch && pauseBatch.mutate({ b: confirmBatch, paused: true })}
            >
              {t('pauseBatch')}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-text">
          {confirmBatch ? t('pauseBatchConfirm.body', { n: confirmBatch.quantity - confirmBatch.usedCodes }) : ''}
        </p>
      </Modal>
    </div>
  );
}

function BatchRow({
  batch: b,
  open,
  onToggle,
  onPause,
  onResume,
  onCsv,
  busy,
}: {
  batch: DiscountCodeBatchDTO;
  open: boolean;
  onToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onCsv: () => void;
  busy: boolean;
}) {
  const t = useTranslations('admin.discounts');
  const locale = useLocale() as AppLocale;
  const codes = useQuery({
    queryKey: ['admin-discount-codes', 'batch', b.id],
    queryFn: () => listDiscountCodes({ batchId: b.id, pageSize: 100 }),
    enabled: open,
  });
  return (
    <li data-testid="batch-list-row" className="border-b border-border py-4">
      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[1.2fr_1.3fr_1.1fr_0.8fr_1fr_0.9fr_auto] md:items-center md:gap-4">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t('hideBatchCodes', { prefix: b.prefix }) : t('showBatchCodes', { prefix: b.prefix })}
          onClick={onToggle}
          className="flex min-h-[44px] min-w-0 items-center gap-2 text-left"
        >
          <span aria-hidden className="font-mono text-muted">
            {open ? '▾' : '▸'}
          </span>
          <span className="min-w-0 font-mono text-sm font-semibold text-text [overflow-wrap:anywhere]">{b.prefix}</span>
          <span className="text-xs text-muted">{t('batchRow', { n: b.quantity })}</span>
        </button>
        <span className="text-sm text-text">{t('describe.batch', { base: describeDiscount(b, t, locale) })}</span>
        <span className="text-sm text-muted">{describeValidity(b, t, locale)}</span>
        <StateTag state={b.state} />
        <span className="tabular text-sm text-text">{t('batchUsed', { used: b.usedCodes, n: b.quantity })}</span>
        {/* `DiscountCodeBatchDTO` no trae «Descuento dado» (está en su reporte): celda vacía, sin sumar los códigos aquí. */}
        <span aria-hidden className="hidden text-right text-sm text-muted md:block">
          —
        </span>
        <span className="flex flex-wrap gap-2 md:justify-end">
          {b.state !== 'expired' && (
            <Button variant="secondary" size="sm" className="min-h-[44px]" loading={busy} onClick={b.status === 'paused' ? onResume : onPause}>
              {b.status === 'paused' ? t('resumeBatch') : t('pauseBatch')}
            </Button>
          )}
          <button type="button" onClick={onCsv} className="inline-flex min-h-[44px] items-center px-2 text-sm underline underline-offset-4">
            {t('downloadCsv')}
          </button>
          <Link href={`/admin/codes/batch/${b.id}/report`} className="inline-flex min-h-[44px] items-center px-2 text-sm underline underline-offset-4">
            {t('viewReport')}
          </Link>
        </span>
      </div>
      {open && (
        <div className="mt-3 border-l-2 border-border pl-4">
          <QueryState isLoading={codes.isLoading} isError={codes.isError} error={codes.error} onRetry={() => codes.refetch()}>
            <ul className="grid gap-1">
              {(codes.data?.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-mono text-text">{c.code}</span>
                  <StateTag state={c.state} />
                  <span className="tabular text-muted">{describeUsage(c, t)}</span>
                </li>
              ))}
            </ul>
          </QueryState>
        </div>
      )}
    </li>
  );
}
