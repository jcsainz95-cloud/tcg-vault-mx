'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { cancelManualRefund, getManualRefund, markManualRefundPaid, reissueManualRefund, revealManualRefundClabe } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { ManualRefundConfirmationRequiredDetails, ManualRefundDTO, RevealManualRefundClabeResponse } from '@/types/contract';
import { MANUAL_REFUNDS_KEY } from '../ManualRefundsView';
import { manualRefundWhy } from '../why';

const DASH = '—';
const TAG = 'font-mono text-[11px] uppercase tracking-[0.06em]';
const LABEL = `${TAG} text-muted`;
const SPEI_REF_RE = /^[A-Za-z0-9]{1,30}$/;

/**
 * **Detalle de una transferencia** (`DESIGN_SYSTEM §37.9b` · contrato `§M4-SHIP.15.13` + `.17.3` + `.17.8`).
 * Paso 1 «Revelar CLABE» (auditado; la CLABE vive SOLO en el estado de esta vista, ⛔ nunca global, ⛔ nunca en
 * la URL ni en un `title`); paso 2 «Marcar pagada» **dentro** de la vista del reveal, con el `revealToken` que
 * ata la CLABE vista al pago, clave de rastreo y nota **opcionales** (D-11) y las casillas reforzadas que el
 * `422` pida. «Cancelar» y «Re-emitir» con nota. Al salir de la vista, la CLABE desaparece.
 */
export function ManualRefundDetailView({ id }: { id: string }) {
  return (
    <SuperAdminOnly>
      <ManualRefundDetail id={id} />
    </SuperAdminOnly>
  );
}

function ManualRefundDetail({ id }: { id: string }) {
  const t = useTranslations('admin.manualRefunds');
  const tStatus = useTranslations('status.manualRefund');
  const tOrder = useTranslations('status.order');
  const tc = useTranslations('common');
  const tsr = useTranslations('admin.m3.shippedReason');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const qc = useQueryClient();
  const getMessage = useErrorMessage('operator');

  const query = useQuery({ queryKey: [...MANUAL_REFUNDS_KEY, 'detail', id], queryFn: () => getManualRefund(id) });
  const m = query.data ?? null;

  const [reveal, setReveal] = useState<RevealManualRefundClabeResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ role: 'status' | 'alert'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speiRef, setSpeiRef] = useState('');
  const [note, setNote] = useState('');
  const [required, setRequired] = useState<ManualRefundConfirmationRequiredDetails['required']>([]);
  const [confirmClabe, setConfirmClabe] = useState(false);
  const [confirmOrigin, setConfirmOrigin] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [reissueOpen, setReissueOpen] = useState(false);
  const [reissueNote, setReissueNote] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (paidOpen || cancelOpen || reissueOpen) cancelRef.current?.focus();
  }, [paidOpen, cancelOpen, reissueOpen]);
  // S5: la CLABE desaparece al desmontar (salir de la vista).
  useEffect(() => () => setReveal(null), []);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: MANUAL_REFUNDS_KEY });
    void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const setData = (next: ManualRefundDTO) => qc.setQueryData([...MANUAL_REFUNDS_KEY, 'detail', id], next);

  const speiRefInvalid = speiRef.trim() !== '' && !SPEI_REF_RE.test(speiRef.trim());
  const originNotSettled = !!m?.origin && m.origin.orderStatus !== 'settled';
  const statusLabel = (s: unknown) => (typeof s === 'string' && tStatus.has(s) ? tStatus(s) : String(s ?? DASH));

  const doReveal = useMutation({
    mutationFn: () => revealManualRefundClabe(id),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setReveal(res);
      setCopied(false);
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 422 && err.code === 'CLABE_NOT_ON_FILE') setError(t('error.clabeNotOnFile'));
      else if (err?.status === 409 && err.code === 'MANUAL_REFUND_NOT_PENDING') {
        setError(t('error.notPending', { status: statusLabel(err.details?.status) }));
        refresh();
      } else if (err?.status === 404) setError(t('error.notFound'));
      else setError(getMessage(e));
    },
  });

  const doPaid = useMutation({
    mutationFn: () => {
      if (!reveal) throw new Error('reveal first');
      return markManualRefundPaid(id, {
        revealToken: reveal.revealToken,
        ...(speiRef.trim() ? { speiReference: speiRef.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(confirmClabe ? { confirmRecentClabeChange: true } : {}),
        ...(confirmOrigin ? { confirmOriginNotSettled: true } : {}),
      });
    },
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setPaidOpen(false);
      setReveal(null); // S5: tras marcar pagada, la CLABE ya no se ve.
      setData(res);
      const sameKey = speiRef.trim() !== '' && res.speiReference === speiRef.trim();
      setNotice({ role: 'status', text: m?.status === 'paid' ? t('paid.already', { sameKey: sameKey ? 'yes' : 'no' }) : t('paid.done', { date: formatDateTimeMx(res.paidAt, locale) }) });
      refresh();
    },
    onError: (e) => {
      setPaidOpen(false);
      const err = asApiError(e);
      if (err?.status === 422 && err.code === 'MANUAL_REFUND_CONFIRMATION_REQUIRED') {
        const d = err.details as Partial<ManualRefundConfirmationRequiredDetails> | undefined;
        setRequired(d?.required ?? []);
        setError(t('error.confirmMissing'));
        return;
      }
      if (err?.status === 409 && err.code === 'CLABE_CHANGED_SINCE_REVEAL') {
        const at = typeof err.details?.clabeUpdatedAt === 'string' ? err.details.clabeUpdatedAt : null;
        setReveal(null);
        setError(at ? t('error.clabeChanged', { date: formatDateTimeMx(at, locale) }) : t('error.clabeChangedUnknownDate'));
        refresh();
        return;
      }
      if (err?.status === 409 && err.code === 'MANUAL_REFUND_NOT_PENDING') {
        setError(t('error.notPending', { status: statusLabel(err.details?.status) }));
        refresh();
        return;
      }
      if (err?.status === 422 && err.code === 'CLABE_NOT_ON_FILE') {
        setError(t('error.clabeNotOnFile'));
        return;
      }
      if (err?.status === 400 && err.details?.field === 'speiReference') {
        setError(t('paid.referenceInvalid'));
        return;
      }
      setError(getMessage(e));
    },
  });

  const doCancel = useMutation({
    mutationFn: (n: string) => cancelManualRefund(id, { note: n }),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setCancelOpen(false);
      setReveal(null);
      setData(res);
      setNotice({ role: 'status', text: m?.status === 'cancelled' ? t('cancel.already') : t('cancel.done') });
      refresh();
    },
    onError: (e) => {
      setCancelOpen(false);
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'MANUAL_REFUND_NOT_PENDING') {
        setError(t('error.notPending', { status: statusLabel(err.details?.status) }));
        refresh();
      } else setError(getMessage(e));
    },
  });

  const doReissue = useMutation({
    mutationFn: (n: string) => reissueManualRefund(id, { note: n }),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setReissueOpen(false);
      refresh();
      router.push(`/admin/manual-refunds/${res.id}?reissued=${encodeURIComponent(id)}`);
    },
    onError: (e) => {
      setReissueOpen(false);
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'MANUAL_REFUND_NOT_CANCELLED') {
        const active = typeof err.details?.activeManualRefundId === 'string' ? err.details.activeManualRefundId : null;
        setError(t('reissue.error', { reason: active ? 'alive' : 'status', status: statusLabel(err.details?.status) }));
        refresh();
      } else setError(getMessage(e));
    },
  });

  async function copyClabe() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.clabe);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const beneficiary = m ? m.beneficiaryName?.trim() || m.customer.fullName?.trim() || t('noName') : '';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/refunds" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
          ← {t('backToList')}
        </Link>
      </div>
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
        {m && (
          <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2">
              <h1 className="text-h1 font-bold">{t('detailTitle', { id: m.id })}</h1>
              <p className="tabular font-serif text-2xl text-text">{formatMoneyCents(m.amountCents, locale)}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                <span className={cn(TAG, m.status === 'paid' ? 'text-success' : 'text-text')}>{tStatus(m.status)}</span>
                <span>{beneficiary}</span>
                <span className="text-muted">{m.customer.email}</span>
              </div>
              <p className="text-sm text-text" lang="en">
                {manualRefundWhy(m, t, tsr)}
                {m.case && (
                  <>
                    {' '}
                    <Link href={`/admin/m4/reponer/${m.case.id}`} className="underline underline-offset-4 hover:text-accent">
                      {t('viewCase')}
                    </Link>
                  </>
                )}
                {m.origin && (
                  <>
                    {' · '}
                    <Link href={`/admin/m3/${m.origin.orderId}`} className="tabular underline underline-offset-4 hover:text-accent">
                      {m.origin.orderNumber ?? m.origin.orderId}
                    </Link>{' '}
                    <span className="text-muted">({tOrder(m.origin.orderStatus)})</span>
                  </>
                )}
              </p>
              <p className="text-sm text-muted">{t('createdBy', { name: m.createdBy.name?.trim() || DASH, date: formatDateTimeMx(m.createdAt, locale) })}</p>
              {/* §60.4 c: en lugar de «caso», el bloque «Retiro entregado» (v1.82 §PNL.3). */}
              {m.source === 'withdrawal_delivered' && m.withdrawal && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-text" data-testid="mr-withdrawal-block">
                  <dt className="col-span-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{t('withdrawal.title')}</dt>
                  <dt className="text-muted">{t('withdrawal.folio')}</dt>
                  <dd>
                    <Link href="/admin/m4?tab=envios" className="tabular font-mono underline underline-offset-4 hover:text-accent">
                      {m.withdrawal.shipmentId}
                    </Link>
                  </dd>
                  <dt className="text-muted">{t('withdrawal.card')}</dt>
                  <dd lang="en">
                    {m.withdrawal.card.name} · <span className="tabular font-mono">{m.withdrawal.folio}</span>
                  </dd>
                  <dt className="text-muted">{t('withdrawal.reason')}</dt>
                  <dd>{tsr(m.withdrawal.reason)}</dd>
                  <dt className="text-muted">{t('withdrawal.note')}</dt>
                  <dd className="whitespace-pre-wrap">{m.withdrawal.note}</dd>
                  <dt className="text-muted">{t('withdrawal.deliveredAt')}</dt>
                  <dd className="tabular">{m.withdrawal.deliveredAt ? formatDateTimeMx(m.withdrawal.deliveredAt, locale) : DASH}</dd>
                </dl>
              )}
              {m.reissuedFromId && (
                <Link href={`/admin/manual-refunds/${m.reissuedFromId}`} className="text-sm text-text underline underline-offset-4 hover:text-accent">
                  {t('reissue.from', { id: m.reissuedFromId })}
                </Link>
              )}
            </header>

            {notice && (
              <Banner key={notice.text} variant="info" role={notice.role} dismissible>
                <p className="text-sm text-text" data-testid="mr-notice">
                  {notice.text}
                </p>
              </Banner>
            )}
            {originNotSettled && (
              <Banner variant="danger" role="alert">
                {t('originBanner', { status: m.origin!.orderStatus })}
              </Banner>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm text-text" data-testid="mr-components">
              <dt className={LABEL}>{t('components.merchandise')}</dt>
              <dd className="tabular">{formatMoneyCents(m.components.merchandiseCents, locale)}</dd>
              <dt className={LABEL}>{t('components.merchandiseIva')}</dt>
              <dd className="tabular">{formatMoneyCents(m.components.merchandiseIvaCents, locale)}</dd>
              <dt className={LABEL}>{t('components.fee')}</dt>
              <dd className="tabular">{formatMoneyCents(m.components.processingFeeCents, locale)}</dd>
              <dt className={LABEL}>{t('components.compensation')}</dt>
              <dd className="tabular">{formatMoneyCents(m.components.compensationCents, locale)}</dd>
            </dl>

            {/* Pagada / cancelada: lo que se ve después. */}
            {m.status === 'paid' && (
              <div className="flex flex-col gap-1 border-t border-border pt-4 text-sm text-text" data-testid="mr-paid">
                <p>{t('paidBy', { name: m.paidBy?.name?.trim() || DASH, date: formatDateTimeMx(m.paidAt, locale) })}</p>
                <p className="tabular">{m.speiReference ? t('trackingKey', { ref: m.speiReference }) : t('trackingKeyNone')}</p>
                {m.paidNote && <p className="text-muted">{m.paidNote}</p>}
                {m.paidToCurrentClabe === false && <p className="text-accent">{t('clabeChangedAfter')}</p>}
              </div>
            )}
            {m.status === 'cancelled' && (
              <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm text-text" data-testid="mr-cancelled">
                <p>{t('cancelledBy', { name: m.cancelledBy?.name?.trim() || DASH, date: formatDateTimeMx(m.cancelledAt, locale) })}</p>
                {m.cancelNote && <p className="text-muted">{m.cancelNote}</p>}
                {m.reissuedAsId ? (
                  <Link href={`/admin/manual-refunds/${m.reissuedAsId}`} className="self-start underline underline-offset-4 hover:text-accent">
                    {t('reissue.as', { id: m.reissuedAsId })}
                  </Link>
                ) : (
                  <Button variant="secondary" className="self-start" onClick={() => setReissueOpen(true)}>
                    {t('reissue.cta')}
                  </Button>
                )}
              </div>
            )}

            {/* Pendiente: paso 1 (revelar) y paso 2 (pagar, dentro del reveal). */}
            {m.status === 'pending' && (
              <div className="flex flex-col gap-4 border-t border-border pt-4">
                {!reveal ? (
                  <div className="flex flex-col items-start gap-1">
                    <Button variant="secondary" loading={doReveal.isPending} onClick={() => doReveal.mutate()} data-testid="mr-reveal">
                      {t('reveal.cta')}
                    </Button>
                    <p className="text-sm text-muted">{t('reveal.hint')}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4" data-testid="mr-reveal-view">
                    <div className="flex flex-col gap-1">
                      <output aria-label={t('reveal.aria')} className="font-mono text-lg tabular tracking-[0.18em] text-text" data-testid="mr-clabe">
                        {reveal.clabe}
                      </output>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button size="sm" variant="ghost" onClick={copyClabe}>
                          {t('reveal.copy')}
                        </Button>
                        <span role="status" className="text-sm text-text">
                          {copied ? t('reveal.copied') : ''}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => setReveal(null)}>
                          {t('reveal.hide')}
                        </Button>
                      </div>
                      <p className="text-sm text-text">
                        {reveal.beneficiaryName ? t('reveal.beneficiary', { name: reveal.beneficiaryName }) : t('reveal.beneficiaryNone', { name: m.customer.fullName?.trim() || t('noName') })}
                      </p>
                      <p className="text-sm text-muted">
                        {reveal.clabeUpdatedAt ? t('reveal.updatedAt', { date: formatDateTimeMx(reveal.clabeUpdatedAt, locale) }) : t('reveal.updatedUnknown')}
                      </p>
                    </div>
                    {reveal.clabeChangedRecently && (
                      <Banner variant="warning" role="alert">
                        {t('reveal.changedRecently')}
                      </Banner>
                    )}
                    <Input
                      label={t('paid.reference')}
                      type="text"
                      maxLength={30}
                      className="font-mono"
                      value={speiRef}
                      hint={speiRefInvalid ? undefined : t('paid.referenceHint')}
                      error={speiRefInvalid ? t('paid.referenceInvalid') : undefined}
                      onChange={(e) => setSpeiRef(e.target.value)}
                      data-testid="mr-spei-ref"
                    />
                    <Textarea label={t('paid.note')} value={note} maxLength={500} counter={{ max: 500 }} onChange={(e) => setNote(e.target.value)} />
                    {required.includes('recent_clabe_change') && (
                      <label className="flex items-start gap-3 text-sm text-text">
                        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-text" checked={confirmClabe} onChange={(e) => setConfirmClabe(e.target.checked)} data-testid="mr-confirm-clabe" />
                        {t('paid.confirmClabe')}
                      </label>
                    )}
                    {required.includes('origin_not_settled') && (
                      <label className="flex items-start gap-3 text-sm text-text">
                        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-text" checked={confirmOrigin} onChange={(e) => setConfirmOrigin(e.target.checked)} data-testid="mr-confirm-origin" />
                        {t('paid.confirmOrigin')}
                      </label>
                    )}
                    <Button variant="primary" className="self-start" disabled={speiRefInvalid} onClick={() => setPaidOpen(true)} data-testid="mr-paid-cta">
                      {t('paid.cta', { amount: formatMoneyCents(m.amountCents, locale) })}
                    </Button>
                  </div>
                )}
                <Button variant="ghost" className="self-start text-accent" onClick={() => setCancelOpen(true)}>
                  {t('cancel.cta')}
                </Button>
              </div>
            )}

            {error && (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text" data-testid="mr-error">
                <p>{error}</p>
                {!reveal && m.status === 'pending' && doPaid.isError && (
                  <Button size="sm" variant="secondary" onClick={() => doReveal.mutate()}>
                    {t('reveal.cta')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </QueryState>

      {/* §37.9b — confirmaciones (S9). */}
      {m && (
        <>
          <Modal
            open={paidOpen}
            onClose={() => setPaidOpen(false)}
            title={t('paid.title')}
            footer={
              <>
                <Button ref={cancelRef} variant="secondary" onClick={() => setPaidOpen(false)}>
                  {tc('cancel')}
                </Button>
                <Button variant="secondary" loading={doPaid.isPending} onClick={() => doPaid.mutate()} data-testid="mr-paid-confirm">
                  {t('paid.confirm')}
                </Button>
              </>
            }
          >
            <p className="text-sm text-text">{t('paid.body', { amount: formatMoneyCents(m.amountCents, locale) })}</p>
          </Modal>
          <Modal
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title={t('cancel.title')}
            footer={
              <>
                <Button ref={cancelRef} variant="secondary" onClick={() => setCancelOpen(false)}>
                  {tc('cancel')}
                </Button>
                <Button variant="destructive" disabled={cancelNote.trim().length < 3} loading={doCancel.isPending} onClick={() => doCancel.mutate(cancelNote.trim())}>
                  {t('cancel.confirm')}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text">{t('cancel.body')}</p>
              <Textarea label={t('cancel.reason')} value={cancelNote} maxLength={500} counter={{ max: 500 }} onChange={(e) => setCancelNote(e.target.value)} />
            </div>
          </Modal>
          <Modal
            open={reissueOpen}
            onClose={() => setReissueOpen(false)}
            title={t('reissue.title')}
            footer={
              <>
                <Button ref={cancelRef} variant="secondary" onClick={() => setReissueOpen(false)}>
                  {tc('cancel')}
                </Button>
                <Button variant="secondary" disabled={reissueNote.trim().length < 3} loading={doReissue.isPending} onClick={() => doReissue.mutate(reissueNote.trim())}>
                  {t('reissue.confirm')}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text">{t('reissue.body', { amount: formatMoneyCents(m.amountCents, locale) })}</p>
              <Textarea label={t('reissue.reason')} value={reissueNote} maxLength={500} counter={{ max: 500 }} onChange={(e) => setReissueNote(e.target.value)} />
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
