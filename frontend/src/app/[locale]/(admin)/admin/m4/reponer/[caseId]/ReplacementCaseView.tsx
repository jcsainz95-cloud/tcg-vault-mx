'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { getCaseRefundPreview, getLocations, getReplacementCase, refundCase, replaceCase, voidCase } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useRole } from '@/lib/role';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { formatDate, formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type {
  CaseRefundConfirmationRequiredDetails,
  CaseRefundPreviewDTO,
  CaseRefundPreviewStaleDetails,
  ReplacementCandidateDTO,
  ReplacementCaseDetailDTO,
  ReplacementNotEligibleDetails,
} from '@/types/contract';
import { ReplacementCaseCard } from '../../ReplacementCaseCard';
import { CASES_KEY } from '../../ReplacementCasesPanel';
import { LABEL, TAG, useZonedLabel } from '../../prep-shared';
import { pesosToCents } from '../../pesosToCents';

type Translator = ReturnType<typeof useTranslations>;
const DASH = '—';

/**
 * **El detalle de un caso «Por reponer»** (`DESIGN_SYSTEM §37.8c–§37.8e` · contrato `§M4-SHIP.15.4/.5/.10`).
 * La tarjeta entera + las candidatas con «Reponer con esta pieza» (con cajón si va a bóveda), «Apareció»
 * (solo `not_found`), y —**solo súper-admin**— 💰 «Reembolsar» (captura del monto con las dos referencias a la
 * vista y el reparto del servidor) y «Anular» (solo si el origen ya no está liquidado). Al operador los verbos de
 * súper-admin **no se pintan** (S6).
 */
export function ReplacementCaseView({ caseId }: { caseId: string }) {
  const t = useTranslations('admin.m4.replace');
  const tp = useTranslations('admin.m4.prep');
  const tv = useTranslations('admin.m4.prep.vault');
  const tc = useTranslations('common');
  const tInv = useTranslations('status.inventory');
  const tCase = useTranslations('status.replacementCase');
  const tOrder = useTranslations('status.order');
  const tRefund = useTranslations('status.paymentRefund');
  const tManual = useTranslations('admin.manualRefunds');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const zoned = useZonedLabel();
  const getMessage = useErrorMessage('operator');
  const qc = useQueryClient();

  const query = useQuery({ queryKey: [...CASES_KEY, 'detail', caseId], queryFn: () => getReplacementCase(caseId) });
  const kase = query.data ?? null;

  const [notice, setNotice] = useState<{ role: 'status' | 'alert'; lines: string[]; link?: { href: string; label: string } } | null>(null);
  const [actionError, setActionError] = useState<{ text: string; retry?: () => void } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<ReplacementCandidateDTO | null>(null);
  const [foundOpen, setFoundOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidNote, setVoidNote] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [chosenDrawer, setChosenDrawer] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: CASES_KEY });
    void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
    void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
  };

  // ---------- Cajón (solo destino `drawer`, tres ramas de §36.8) ----------
  const needsDrawer = kase?.status === 'open' && kase.destination === 'drawer';
  const drawerPool = kase?.customerDrawers ?? [];
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations, enabled: !!needsDrawer && drawerPool.length === 0 });
  const customerDrawers = (locations.data ?? []).filter((l) => l.zone === 'customer_custody' && l.isActive);
  const drawerId = drawerPool.length === 1 ? drawerPool[0].id : chosenDrawer;
  const drawerName = (() => {
    if (!kase) return '';
    if (drawerPool.length === 1) return zoned(drawerPool[0].zone, drawerPool[0].label);
    const d = drawerPool.find((x) => x.id === chosenDrawer) ?? customerDrawers.find((x) => x.id === chosenDrawer);
    return d ? zoned('customer_custody', d.label) : '';
  })();

  function commonError(e: unknown, retry: () => void): { text: string; retry?: () => void } {
    const err = asApiError(e);
    const status = (s: unknown) => (typeof s === 'string' && tCase.has(s) ? tCase(s) : typeof s === 'string' && tOrder.has(s) ? tOrder(s) : String(s ?? DASH));
    if (err?.status === 409 && err.code === 'CASE_NOT_OPEN') {
      refresh();
      return { text: t('error.notOpen', { status: status(err.details?.status), date: formatDate(typeof err.details?.resolvedAt === 'string' ? err.details.resolvedAt : undefined, locale) || DASH }) };
    }
    if (err?.status === 409 && err.code === 'CASE_ORIGIN_NOT_SETTLED') {
      refresh();
      return { text: t('error.originNotSettled', { status: status(err.details?.originStatus) }) };
    }
    if (err?.status === 409 && err.code === 'CONFLICT') {
      refresh();
      return { text: t('error.conflict') };
    }
    if (err?.status === 403) return { text: t('error.forbidden') };
    if (err?.status === 404) return { text: t('error.caseNotFound') };
    return { text: getMessage(e), retry };
  }

  // ---------- Reponer / apareció (§37.8c) ----------
  const replace = useMutation({
    mutationFn: (v: { inventoryItemId: string; locationId?: string }) => replaceCase(caseId, v),
    onMutate: () => setActionError(null),
    onSuccess: (res, v) => {
      setReplaceTarget(null);
      setFoundOpen(false);
      qc.setQueryData([...CASES_KEY, 'detail', caseId], (old: ReplacementCaseDetailDTO | undefined) => (old ? { ...old, ...res.case, candidates: [] } : old));
      const lines: string[] = [];
      if (res.outcome === 'already_resolved') lines.push(t('result.already'));
      else if (res.outcome === 'found') lines.push(t('result.found'));
      else {
        lines.push(
          t('result.replaced', {
            card: res.case.original.card.name,
            folio: res.case.replacement?.folio ?? v.inventoryItemId,
            destination: res.case.destination,
            ref: res.case.shipment?.id ?? DASH,
            drawer: drawerName || DASH,
          }),
        );
        if (res.preparation && res.preparation.status === 'prepared' && res.preparation.openReplacements === 0) lines.push(t('result.replacedCanShip'));
      }
      setNotice({ role: 'status', lines });
      refresh();
    },
    onError: (e, v) => {
      setReplaceTarget(null);
      setFoundOpen(false);
      const err = asApiError(e);
      if (err?.status === 422 && err.code === 'REPLACEMENT_NOT_ELIGIBLE') {
        const d = err.details as Partial<ReplacementNotEligibleDetails> | undefined;
        const fields = (d?.mismatch ?? []).map((f) => (t.has(`identityField.${f}`) ? t(`identityField.${f}`) : f)).join(', ');
        const text =
          d?.reason === 'identity_mismatch'
            ? t('error.identityMismatch', { fields: fields || DASH })
            : d?.reason === 'not_platform_available'
              ? t('error.notAvailable')
              : d?.reason === 'not_found'
                ? t('error.notFound')
                : d?.reason === 'same_piece_damaged'
                  ? t('error.samePieceDamaged')
                  : t('error.samePieceNotLost');
        setActionError({ text });
        refresh();
        return;
      }
      if (err?.status === 422 && err.code === 'LOCATION_NOT_AVAILABLE') {
        const reason = err.details?.reason;
        setActionError({ text: reason === 'location_required' ? t('error.locationRequired') : reason === 'not_customer_drawer' ? tv('error.notCustomerDrawer') : tv('error.drawerUnavailable') });
        if (reason !== 'location_required') setChosenDrawer('');
        refresh();
        return;
      }
      setActionError(commonError(e, () => replace.mutate(v)));
    },
  });

  // ---------- Anular (§37.8c, solo súper-admin) ----------
  const doVoid = useMutation({
    mutationFn: (note: string) => voidCase(caseId, { note }),
    onMutate: () => setActionError(null),
    onSuccess: (res) => {
      setVoidOpen(false);
      setVoidNote('');
      qc.setQueryData([...CASES_KEY, 'detail', caseId], (old: ReplacementCaseDetailDTO | undefined) => (old ? { ...old, ...res.case, candidates: [] } : old));
      const lines = [res.outcome === 'already_resolved' ? t('result.already') : t('result.voided')];
      if (res.shipment?.closed) lines.push(t('result.voidedClosed'));
      setNotice({ role: 'status', lines });
      refresh();
    },
    onError: (e, note) => {
      setVoidOpen(false);
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'CASE_NOT_VOIDABLE') {
        setActionError({ text: t('error.notVoidable') });
        return;
      }
      setActionError(commonError(e, () => doVoid.mutate(note)));
    },
  });

  const canVoid = isSuperAdmin && kase?.status === 'open' && (kase.origin === null || kase.origin.orderStatus !== 'settled');
  const canRefund = isSuperAdmin && kase?.status === 'open' && kase.refundContext?.available === true;
  const canFound = kase?.status === 'open' && kase.missingReason === 'not_found';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/m4?tab=reponer" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
          ← {t('backToList')}
        </Link>
      </div>
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      {notice && (
        <Banner key={notice.lines.join('|')} variant={notice.role === 'alert' ? 'warning' : 'info'} role={notice.role} dismissible>
          <div data-testid="case-notice" className="flex flex-col gap-1">
            {notice.lines.map((l) => (
              <p key={l} className="text-sm text-text">
                {l}
              </p>
            ))}
            {notice.link && (
              <Link href={notice.link.href} className="text-text underline underline-offset-4 hover:text-accent">
                {notice.link.label}
              </Link>
            )}
          </div>
        </Banner>
      )}

      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
        {kase && (
          <ReplacementCaseCard
            kase={kase}
            locale={locale}
            footer={
              kase.status === 'open' ? (
                <>
                  {canFound && (
                    <Button variant="secondary" className="sm:min-h-[44px]" onClick={() => setFoundOpen(true)}>
                      {t('action.found')}
                    </Button>
                  )}
                  {canRefund && (
                    <Button variant="secondary" className="sm:min-h-[44px]" data-testid="case-refund-cta" onClick={() => setRefundOpen(true)}>
                      {t('action.refund')}
                    </Button>
                  )}
                  {isSuperAdmin && kase.refundContext && !kase.refundContext.available && (
                    <p className="text-sm text-muted">{t(`refund.unavailable.${kase.refundContext.reason}`)}</p>
                  )}
                  {canVoid && (
                    <Button variant="ghost" className="text-accent sm:min-h-[44px]" data-testid="case-void-cta" onClick={() => setVoidOpen(true)}>
                      {t('action.void')}
                    </Button>
                  )}
                </>
              ) : undefined
            }
          >
            {/* §37.8e — un caso `refunded`: sus filas por tarjeta y por transferencia (solo súper-admin las ve). */}
            {kase.status === 'refunded' && (
              <div className="flex flex-col gap-1 text-sm text-text" data-testid="case-refund-rows">
                <span className={LABEL}>{t('captured.byCard')}</span>
                <p className="tabular">
                  {kase.refund ? `${formatMoneyCents(kase.refund.amountCents, locale)} · ${tRefund(kase.refund.status)}` : t('captured.none')}
                </p>
                {kase.manualRefunds !== null && (
                  <>
                    <span className={LABEL}>{t('captured.byTransfer')}</span>
                    {kase.manualRefunds.length === 0 ? (
                      <p>{t('captured.none')}</p>
                    ) : (
                      kase.manualRefunds.map((m) => (
                        <p key={m.id} className="tabular">
                          {formatMoneyCents(m.amountCents, locale)} ·{' '}
                          {m.status === 'pending' ? t('captured.pending') : m.status === 'paid' ? t('captured.paidBy', { name: m.paidBy?.name?.trim() || DASH, date: formatDateTimeMx(m.paidAt, locale) }) : t('captured.cancelled')}{' '}
                          <Link href={`/admin/manual-refunds/${m.id}`} className="underline underline-offset-4 hover:text-accent">
                            {t('captured.viewBucket')}
                          </Link>
                        </p>
                      ))
                    )}
                  </>
                )}
              </div>
            )}
            {actionError && (
              <div role="alert" className="flex flex-col items-start gap-2 border-t border-border pt-3 text-sm text-text">
                <p>{actionError.text}</p>
                {actionError.retry && (
                  <Button size="sm" variant="secondary" onClick={actionError.retry}>
                    {tc('retry')}
                  </Button>
                )}
              </div>
            )}
          </ReplacementCaseCard>
        )}

        {/* Candidatas (§37.8c): por ubicación y folio; con destino `drawer`, el selector de cajón encima. */}
        {kase && kase.status === 'open' && (
          <section className="mt-6 flex flex-col gap-4" aria-labelledby="case-candidates-title">
            <h2 id="case-candidates-title" className="text-h2 font-semibold">
              {t('candidatesTitle')}
            </h2>
            {needsDrawer && (
              <div data-testid="case-drawer" className="flex flex-col gap-2">
                {drawerPool.length === 1 ? (
                  <p className="text-sm text-text">{t('drawerOwn', { drawer: zoned(drawerPool[0].zone, drawerPool[0].label) })}</p>
                ) : drawerPool.length > 1 ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className={cn(LABEL, 'mb-1')}>{t('drawerLegend')}</legend>
                    {drawerPool.map((l) => (
                      <label key={l.id} className="flex min-h-[44px] items-center gap-3 text-sm text-text">
                        <input type="radio" name="case-drawer" value={l.id} checked={chosenDrawer === l.id} onChange={() => setChosenDrawer(l.id)} className="h-5 w-5 accent-text" />
                        <span className="tabular font-mono">{zoned(l.zone, l.label)}</span> — {tv('drawer.piecesThere', { count: l.customerPieceCount })}
                      </label>
                    ))}
                  </fieldset>
                ) : locations.isLoading ? (
                  <Skeleton className="h-10 w-64" />
                ) : customerDrawers.length === 0 ? (
                  <p className="text-sm text-text">{t('drawerNone')}</p>
                ) : (
                  <Select
                    label={t('drawerChoose')}
                    placeholder={tv('drawer.choosePlaceholder')}
                    className="max-w-sm"
                    value={chosenDrawer}
                    onChange={(e) => setChosenDrawer(e.target.value)}
                    options={customerDrawers.map((l) => ({ value: l.id, label: zoned(l.zone, l.label) }))}
                  />
                )}
              </div>
            )}
            {kase.candidates.length === 0 ? (
              <EmptyState title={t('candidatesEmpty.title')} body={t('candidatesEmpty.body')} />
            ) : (
              <ul className="flex flex-col gap-3">
                {kase.candidates.map((cand) => (
                  <li key={cand.inventoryItemId} data-testid={`candidate-${cand.inventoryItemId}`} className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex shrink-0 flex-col gap-0.5 sm:w-40">
                      <span className={LABEL}>{tp('location')}</span>
                      {cand.currentLocation.kind === 'assigned' ? (
                        <span className="tabular text-sm text-text">{cand.currentLocation.label}</span>
                      ) : (
                        <span className="text-sm text-accent">{tp('unassigned')}</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2 text-sm text-text">
                      <span className="tabular font-mono">{cand.folio}</span>
                      <span className={cn(TAG, 'text-muted')}>{tInv(cand.status)}</span>
                      <span className="tabular text-muted">
                        {t('candidate.listPrice')}: {cand.listPriceCents !== null ? formatMoneyCents(cand.listPriceCents, locale) : t('candidate.noPrice')}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="sm:min-h-[44px]"
                      disabled={needsDrawer && !drawerId}
                      onClick={() => setReplaceTarget(cand)}
                    >
                      {t('action.replace')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </QueryState>

      {/* Confirmaciones (S9). */}
      {kase && (
        <>
          <ConfirmDialog
            open={replaceTarget !== null}
            title={t('confirmReplace.title', { folio: replaceTarget?.folio ?? '' })}
            body={t('confirmReplace.body', { folio: replaceTarget?.folio ?? '', destination: kase.destination, drawer: drawerName || DASH })}
            confirmLabel={t('confirmReplace.confirm')}
            pending={replace.isPending}
            onCancel={() => setReplaceTarget(null)}
            onConfirm={() => replaceTarget && replace.mutate({ inventoryItemId: replaceTarget.inventoryItemId, ...(needsDrawer ? { locationId: drawerId } : {}) })}
            tc={tc}
          />
          <ConfirmDialog
            open={foundOpen}
            title={t('confirmFound.title')}
            body={t('confirmFound.body', { folio: kase.original.folio, destination: kase.destination })}
            confirmLabel={t('confirmFound.confirm')}
            pending={replace.isPending}
            onCancel={() => setFoundOpen(false)}
            onConfirm={() => replace.mutate({ inventoryItemId: kase.original.inventoryItemId, ...(needsDrawer ? { locationId: drawerId } : {}) })}
            tc={tc}
          />
          <Modal
            open={voidOpen}
            onClose={() => setVoidOpen(false)}
            title={t('confirmVoid.title')}
            footer={
              <>
                <Button variant="secondary" onClick={() => setVoidOpen(false)}>
                  {tc('cancel')}
                </Button>
                <Button variant="destructive" disabled={voidNote.trim().length < 3} loading={doVoid.isPending} onClick={() => doVoid.mutate(voidNote.trim())}>
                  {t('confirmVoid.confirm')}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text">
                {t('confirmVoid.body', { origin: kase.origin ? 'some' : 'none', status: kase.origin ? tOrder(kase.origin.orderStatus) : DASH })}
              </p>
              <Textarea label={t('confirmVoid.reason')} value={voidNote} maxLength={500} counter={{ max: 500 }} onChange={(e) => setVoidNote(e.target.value)} />
            </div>
          </Modal>
          {isSuperAdmin && kase.refundContext?.available && (
            <RefundCaptureDialog
              open={refundOpen}
              kase={kase}
              locale={locale}
              onClose={() => setRefundOpen(false)}
              onDone={(lines, link) => {
                setRefundOpen(false);
                setNotice({ role: 'status', lines, link });
                refresh();
              }}
              t={t}
              tc={tc}
              tManual={tManual}
            />
          )}
        </>
      )}
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
  tc,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  tc: Translator;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button variant="secondary" loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">{body}</p>
    </Modal>
  );
}

/**
 * §37.8d — **la única captura de dinero de la pantalla** (solo súper-admin). Orden del DOM = orden de lectura:
 * referencias → monto → motivo → previsualización del servidor → botón con la cifra. Más del doble de la
 * referencia ⇒ segundo diálogo que exige **volver a escribir el monto** (⛔ sin pegar); más de k× ⇒ bloqueado.
 * ⛔ Esta pantalla no reparte ni compara: `GET …/refund-preview` dice el reparto y los topes.
 */
function RefundCaptureDialog({
  open,
  kase,
  locale,
  onClose,
  onDone,
  t,
  tc,
  tManual,
}: {
  open: boolean;
  kase: ReplacementCaseDetailDTO;
  locale: AppLocale;
  onClose: () => void;
  onDone: (lines: string[], link?: { href: string; label: string }) => void;
  t: Translator;
  tc: Translator;
  tManual: Translator;
}) {
  const ctx = kase.refundContext && kase.refundContext.available ? kase.refundContext : null;
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<{ amount?: string; reason?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [retypeOpen, setRetypeOpen] = useState(false);
  const [retypeText, setRetypeText] = useState('');
  const [retypeNote, setRetypeNote] = useState<string | null>(null);
  const [staleSplit, setStaleSplit] = useState<CaseRefundPreviewStaleDetails | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const retypeRef = useRef<HTMLInputElement>(null);
  const getMessage = useErrorMessage('operator');

  const amountCents = pesosToCents(amountText);
  const validAmount = amountCents !== null && Number.isInteger(amountCents) && amountCents >= 1;
  const debouncedAmount = useDebouncedValue(validAmount ? amountCents : null, 400);

  const preview = useQuery({
    queryKey: [...CASES_KEY, 'refund-preview', kase.id, debouncedAmount],
    queryFn: () => getCaseRefundPreview(kase.id, debouncedAmount),
    enabled: open && debouncedAmount !== null,
    retry: false,
  });
  const p: CaseRefundPreviewDTO | null = preview.data && preview.data.amountCents === amountCents ? preview.data : null;

  useEffect(() => {
    if (open) {
      setAmountText('');
      setReason('');
      setFieldError({});
      setServerError(null);
      setStaleSplit(null);
      setRetypeOpen(false);
      setRetypeText('');
      setTimeout(() => amountRef.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => {
    if (retypeOpen) setTimeout(() => retypeRef.current?.focus(), 0);
  }, [retypeOpen]);

  const refund = useMutation({
    mutationFn: (confirmAboveReference: boolean) => {
      if (!p || amountCents === null) throw new Error('no preview');
      return refundCase(kase.id, {
        amountCents,
        reason: reason.trim(),
        expectedStripeCents: staleSplit?.stripeCents ?? p.stripeCents ?? 0,
        expectedManualCents: staleSplit?.manualCents ?? p.manualCents ?? 0,
        ...(confirmAboveReference ? { confirmAboveReference: true } : {}),
      });
    },
    onSuccess: (res) => {
      setRetypeOpen(false);
      if (res.outcome === 'already_resolved') {
        onDone([t('refund.already')]);
        return;
      }
      const stripeRows = res.refunds.filter((r) => r.kind === 'case_refund');
      const stripe = stripeRows.reduce((s, r) => s + r.amountCents, 0);
      const manual = res.manualRefunds.reduce((s, m) => s + m.amountCents, 0);
      const stripeState = stripeRows.length === 0 ? 'none' : stripeRows.some((r) => r.status === 'requested') ? 'requested' : 'submitted';
      const line = t('refund.result', {
        amount: formatMoneyCents(res.case.refundCapture?.amountCents ?? amountCents ?? 0, locale),
        stripe: stripe > 0 ? formatMoneyCents(stripe, locale) : '',
        stripeState,
        manual: manual > 0 ? 'some' : 'none',
        manualAmount: formatMoneyCents(manual, locale),
        closed: res.shipment?.closed ? 'yes' : 'no',
      });
      onDone([line], manual > 0 && res.manualRefunds[0] ? { href: `/admin/manual-refunds/${res.manualRefunds[0].id}`, label: t('refund.resultLink') } : undefined);
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 422 && err.code === 'CASE_REFUND_CONFIRMATION_REQUIRED') {
        const d = err.details as Partial<CaseRefundConfirmationRequiredDetails> | undefined;
        setRetypeNote(t('refund.retype.body', { amount: formatMoneyCents(amountCents ?? 0, locale), reference: formatMoneyCents(d?.referenceCents ?? p?.referenceCents ?? 0, locale) }));
        setRetypeText('');
        setRetypeOpen(true);
        return;
      }
      setRetypeOpen(false);
      if (err?.status === 422 && err.code === 'CASE_REFUND_ABOVE_LIMIT') {
        const limit = Number(err.details?.limitCents ?? p?.limitCents ?? 0);
        const reference = Number(err.details?.referenceCents ?? p?.referenceCents ?? 0);
        setServerError(blockedText(limit, reference));
        return;
      }
      if (err?.status === 409 && err.code === 'REFUND_PREVIEW_STALE') {
        const d = err.details as Partial<CaseRefundPreviewStaleDetails> | undefined;
        const next = { stripeCents: Number(d?.stripeCents ?? 0), manualCents: Number(d?.manualCents ?? 0) };
        setStaleSplit(next);
        setServerError(t('refund.error.previewStale', { stripe: formatMoneyCents(next.stripeCents, locale), manual: formatMoneyCents(next.manualCents, locale) }));
        void preview.refetch();
        return;
      }
      if (err?.status === 409 && err.code === 'CASE_REFUND_NOT_AVAILABLE') {
        setServerError(err.details?.reason === 'legacy_convention' ? t('refund.error.legacy') : t('refund.error.noOrigin'));
        return;
      }
      if (err?.status === 400 && err.code === 'VALIDATION_ERROR') {
        const field = err.details?.field;
        if (field === 'amountCents') setFieldError({ amount: t('refund.error.amount') });
        else if (field === 'reason') setFieldError({ reason: t('refund.error.reason') });
        else setServerError(getMessage(e));
        return;
      }
      if (err?.status === 409 && err.code === 'CASE_ORIGIN_NOT_SETTLED') {
        setServerError(t('error.originNotSettled', { status: String(err.details?.originStatus ?? DASH) }));
        return;
      }
      if (err?.status === 409 && err.code === 'CASE_NOT_OPEN') {
        setServerError(t('error.notOpen', { status: String(err.details?.status ?? DASH), date: DASH }));
        return;
      }
      setServerError(getMessage(e));
    },
  });

  function blockedText(limit: number, reference: number): string {
    const k = reference > 0 && Number.isInteger(limit / reference) ? String(limit / reference) : 'none';
    return t('refund.blocked', { limit: formatMoneyCents(limit, locale), k });
  }

  function submit() {
    const errors: { amount?: string; reason?: string } = {};
    if (!validAmount) errors.amount = t('refund.error.amount');
    if (reason.trim().length < 3 || reason.trim().length > 500) errors.reason = t('refund.error.reason');
    setFieldError(errors);
    if (errors.amount || errors.reason || !p) return;
    setServerError(null);
    if (p.confirmation === 'reinforced') {
      setRetypeNote(t('refund.retype.body', { amount: formatMoneyCents(amountCents!, locale), reference: formatMoneyCents(p.referenceCents, locale) }));
      setRetypeText('');
      setRetypeOpen(true);
      return;
    }
    refund.mutate(false);
  }

  if (!ctx) return null;
  const amountLabel = validAmount ? formatMoneyCents(amountCents!, locale) : formatMoneyCents(0, locale);
  const blocked = p?.confirmation === 'blocked';
  const retypeCents = pesosToCents(retypeText);
  const retypeMatches = retypeCents !== null && retypeCents === amountCents;
  const stripeShown = staleSplit?.stripeCents ?? p?.stripeCents ?? null;
  const manualShown = staleSplit?.manualCents ?? p?.manualCents ?? null;

  return (
    <>
      <Modal
        open={open && !retypeOpen}
        onClose={onClose}
        title={t('refund.title')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('refund.cancel')}
            </Button>
            <Button variant="secondary" disabled={!validAmount || !p || blocked || reason.trim().length < 3} loading={refund.isPending} onClick={submit} data-testid="case-refund-submit">
              {t('refund.confirm', { amount: amountLabel })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-sm text-text">
          <div className="flex flex-col gap-1" data-testid="case-refund-refs">
            <p className="tabular">
              {t('refund.paidRef', { amount: formatMoneyCents(ctx.paidReferenceCents, locale) })}{' '}
              <span className="text-muted">{t('refund.paidRefHint', { orderNumber: kase.origin?.orderNumber ?? kase.origin?.orderId ?? DASH })}</span>
            </p>
            {ctx.market ? (
              <p className="tabular">
                {t('refund.marketRef', { amount: formatMoneyCents(ctx.market.cents, locale) })} <span className="text-muted">{t('refund.marketRefDate', { date: ctx.market.capturedDate })}</span>
              </p>
            ) : (
              <p className="text-accent">{t('refund.marketNone')}</p>
            )}
          </div>
          <Input
            ref={amountRef}
            label={t('refund.amountLabel')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={amountText}
            hint={fieldError.amount ? undefined : t('refund.amountHint')}
            error={fieldError.amount}
            onChange={(e) => {
              setAmountText(e.target.value);
              setFieldError((f) => ({ ...f, amount: undefined }));
              setStaleSplit(null);
              setServerError(null);
            }}
            data-testid="case-refund-amount"
          />
          <Textarea
            label={t('refund.reasonLabel')}
            value={reason}
            maxLength={500}
            counter={{ max: 500 }}
            error={fieldError.reason}
            onChange={(e) => {
              setReason(e.target.value);
              setFieldError((f) => ({ ...f, reason: undefined }));
            }}
            data-testid="case-refund-reason"
          />
          <div role="status" aria-live="polite" data-testid="case-refund-preview" className="flex flex-col gap-1">
            {validAmount && preview.isFetching && !p && <p className="text-muted">{t('refund.previewLoading')}</p>}
            {p && stripeShown !== null && manualShown !== null && (
              <p className="tabular">
                {manualShown === 0
                  ? t('refund.previewAllCard', { stripe: formatMoneyCents(stripeShown, locale) })
                  : stripeShown === 0
                    ? t('refund.previewAllManual', { manual: formatMoneyCents(manualShown, locale) })
                    : t('refund.preview', { stripe: formatMoneyCents(stripeShown, locale), manual: formatMoneyCents(manualShown, locale) })}
              </p>
            )}
            {p?.closesShipment && <p>{t('refund.previewCloses', { amount: formatMoneyCents(p.shipmentFeeCents, locale) })}</p>}
            {p && manualShown !== null && manualShown > 0 && !p.customerHasClabe && <p>{t('refund.previewNoClabe')}</p>}
            {p?.confirmation === 'reinforced' && <p>{t('refund.reinforcedHint', { amount: formatMoneyCents(p.referenceCents, locale) })}</p>}
            {blocked && p && (
              <p className="text-accent" role="alert">
                {blockedText(p.limitCents, p.referenceCents)}
              </p>
            )}
            {preview.isError && <p className="text-accent">{getMessage(preview.error)}</p>}
          </div>
          {serverError && (
            <p role="alert" className="text-accent">
              {serverError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={open && retypeOpen}
        onClose={() => setRetypeOpen(false)}
        title={t('refund.retype.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRetypeOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="secondary" disabled={!retypeMatches} loading={refund.isPending} onClick={() => refund.mutate(true)} data-testid="case-refund-retype-submit">
              {t('refund.confirm', { amount: amountLabel })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-text">
          {retypeNote && <p>{retypeNote}</p>}
          <Input
            ref={retypeRef}
            label={t('refund.retype.label')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            autoComplete="off"
            value={retypeText}
            error={retypeText.trim() !== '' && !retypeMatches ? t('refund.retype.mismatch', { amount: amountLabel }) : undefined}
            onChange={(e) => setRetypeText(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              setRetypeText('');
              setServerError(t('refund.retype.noPaste'));
            }}
            data-testid="case-refund-retype"
          />
          {serverError && (
            <p role="alert" className="text-accent">
              {serverError}
            </p>
          )}
          <p className="text-muted">{tManual('hint')}</p>
        </div>
      </Modal>
    </>
  );
}
