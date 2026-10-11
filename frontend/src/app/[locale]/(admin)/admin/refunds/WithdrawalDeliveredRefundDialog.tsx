'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  createWithdrawalDeliveredRefund,
  getAdminShipment,
  getAdminShipments,
  previewWithdrawalDeliveredRefund,
} from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useErrorMessage } from '@/components/ui/QueryState';
import { CardImage } from '@/components/ui/CardImage';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type {
  AdminShipmentDTO,
  CaseRefundConfirmationRequiredDetails,
  ManualRefundDTO,
  ShippedRefundReason,
} from '@/types/contract';
import { ShippedReasonFieldset } from '../m3/ShippedReasonFieldset';
import { pesosToCents } from '../m4/pesosToCents';

type Step = 'search' | 'card' | 'amount';
type ShipItem = NonNullable<AdminShipmentDTO['items']>[number];

/** Error con enlace (los `409 ITEM_REFUND_NOT_AVAILABLE` que dicen dónde se resuelve). */
interface ErrorWithLink {
  text: string;
  link?: { href: string; label: string };
}

/**
 * 💰 «Devolver una carta de un retiro entregado» (DESIGN_SYSTEM §60.4 b · contrato v1.82 §PNL.3, súper-admin). Un
 * `Modal` con tres pasos (cada uno reemplaza al anterior; «← Atrás» fantasma; al cambiar de paso el foco va al
 * encabezado del paso, §60.10):
 *
 * 1. Buscar el retiro (`GET /admin/shipments?q=`, ≈400 ms tras escribir, ⛔ sin botón «Buscar»). Un retiro que no
 *    está `entregado` se ve deshabilitado con su razón (⛔ no se esconde).
 * 2. Elegir la carta (`GET /admin/shipments/:id`). ⛔ Sin preselección; la que faltó al preparar va deshabilitada.
 * 3. Monto y motivo: el cuerpo de §37.8d — referencias → monto (⛔ VACÍO al abrir, `HECHOS.md:31` (b)) → motivo →
 *    nota → previsualización → botón. `reinforced` (o el `422 CASE_REFUND_CONFIRMATION_REQUIRED`) abre el segundo
 *    diálogo de re-escribir el monto, sin pegar, y reenvía con `confirmAboveReference: true` (WDR-UI-1 = FE-WDR-1).
 */
export function WithdrawalDeliveredRefundDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (m: ManualRefundDTO) => void;
}) {
  const t = useTranslations('admin.refundsPage.withdrawalDelivered');
  const tr = useTranslations('admin.m4.replace.refund');
  const tc = useTranslations('common');
  const tShip = useTranslations('status.shipment');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage('operator');

  const [step, setStep] = useState<Step>('search');
  const [q, setQ] = useState('');
  const [shipment, setShipment] = useState<AdminShipmentDTO | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState<ShippedRefundReason | null>(null);
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<{ amount?: string; note?: string }>({});
  const [serverError, setServerError] = useState<ErrorWithLink | null>(null);
  const [retypeOpen, setRetypeOpen] = useState(false);
  const [retypeText, setRetypeText] = useState('');
  const [retypeNote, setRetypeNote] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const retypeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep('search');
    setQ('');
    setShipment(null);
    setItemId(null);
    resetCapture();
    setTimeout(() => searchRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function resetCapture() {
    setAmountText('');
    setReason(null);
    setNote('');
    setFieldError({});
    setServerError(null);
    setRetypeOpen(false);
    setRetypeText('');
  }

  function goTo(next: Step) {
    setStep(next);
    setServerError(null);
    setTimeout(() => headingRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (retypeOpen) setTimeout(() => retypeRef.current?.focus(), 0);
  }, [retypeOpen]);

  // ---- Paso 1 · buscar ----
  const debouncedQ = useDebouncedValue(q.trim(), 400);
  const search = useQuery({
    queryKey: ['admin-shipments', 'withdrawal-delivered-search', debouncedQ],
    queryFn: () => getAdminShipments({ q: debouncedQ, pageSize: 20 }),
    enabled: open && step === 'search' && debouncedQ.length > 0,
    retry: false,
  });

  // ---- Paso 2 · la carta ----
  const detail = useQuery({
    queryKey: ['admin-shipment', shipment?.id],
    queryFn: () => getAdminShipment(shipment!.id),
    enabled: open && shipment !== null,
    retry: false,
  });
  const items = detail.data?.items ?? [];
  const item: ShipItem | null = items.find((i) => i.id === itemId) ?? null;

  // ---- Paso 3 · monto (previsualización ≈400 ms tras escribir) ----
  const amountCents = pesosToCents(amountText);
  const validAmount = amountCents !== null && Number.isInteger(amountCents) && amountCents >= 1;
  const debouncedAmount = useDebouncedValue(validAmount ? amountCents : null, 400);
  const refs = useQuery({
    queryKey: ['admin-manual-refunds', 'withdrawal-delivered-preview', itemId, null],
    queryFn: () => previewWithdrawalDeliveredRefund(itemId!, null),
    enabled: open && step === 'amount' && itemId !== null,
    retry: false,
  });
  const preview = useQuery({
    queryKey: ['admin-manual-refunds', 'withdrawal-delivered-preview', itemId, debouncedAmount],
    queryFn: () => previewWithdrawalDeliveredRefund(itemId!, debouncedAmount),
    enabled: open && step === 'amount' && itemId !== null && debouncedAmount !== null,
    retry: false,
  });
  const p = preview.data && preview.data.amountCents === amountCents ? preview.data : null;
  const r = refs.data ?? null;

  const create = useMutation({
    mutationFn: (confirmAboveReference: boolean) =>
      createWithdrawalDeliveredRefund({
        shipmentItemId: itemId!,
        reason: reason!,
        note: note.trim(),
        amountCents: amountCents!,
        ...(confirmAboveReference ? { confirmAboveReference: true } : {}),
      }),
    onSuccess: (res) => {
      setRetypeOpen(false);
      onDone(res.manualRefund);
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 422 && err.code === 'CASE_REFUND_CONFIRMATION_REQUIRED') {
        const d = err.details as Partial<CaseRefundConfirmationRequiredDetails> | undefined;
        openRetype(d?.referenceCents ?? p?.referenceCents ?? r?.referenceCents ?? 0);
        return;
      }
      setRetypeOpen(false);
      if (err?.status === 422 && err.code === 'CASE_REFUND_ABOVE_LIMIT') {
        const limit = Number(err.details?.limitCents ?? p?.limitCents ?? 0);
        const reference = Number(err.details?.referenceCents ?? p?.referenceCents ?? 0);
        setServerError({ text: blockedText(limit, reference) });
        return;
      }
      if (err?.status === 409 && err.code === 'ITEM_REFUND_NOT_AVAILABLE') {
        const why = err.details?.reason;
        if (why === 'not_shipped') {
          setServerError({ text: t('error.not_shipped'), link: { href: '/admin/m4?tab=reponer', label: t('error.toReplaceLink') } });
        } else if (why === 'already_refunded' && typeof err.details?.manualRefundId === 'string') {
          setServerError({
            text: t('error.already_refunded'),
            link: { href: `/admin/manual-refunds/${err.details.manualRefundId}`, label: t('error.viewTransfer') },
          });
        } else if (typeof why === 'string' && t.has(`error.${why}`)) {
          setServerError({ text: t(`error.${why}`) });
        } else setServerError({ text: getMessage(e) });
        return;
      }
      if (err?.status === 403 && err.code === 'MONEY_OUT_FORBIDDEN') {
        setServerError({ text: t('error.forbidden') });
        return;
      }
      if (err?.status === 400 && err.code === 'VALIDATION_ERROR') {
        const field = err.details?.field;
        if (field === 'amountCents') setFieldError({ amount: tr('error.amount') });
        else if (field === 'note') setFieldError({ note: t('error.note') });
        else if (field === 'reason') setServerError({ text: t('error.reason') });
        else setServerError({ text: getMessage(e) });
        return;
      }
      setServerError({ text: getMessage(e) });
    },
  });

  function blockedText(limit: number, reference: number): string {
    const k = reference > 0 && Number.isInteger(limit / reference) ? String(limit / reference) : 'none';
    return tr('blocked', { limit: formatMoneyCents(limit, locale), k });
  }

  function openRetype(referenceCents: number) {
    setRetypeNote(tr('retype.body', { amount: formatMoneyCents(amountCents ?? 0, locale), reference: formatMoneyCents(referenceCents, locale) }));
    setRetypeText('');
    setRetypeOpen(true);
  }

  function submit() {
    const errors: { amount?: string; note?: string } = {};
    if (!validAmount) errors.amount = tr('error.amount');
    if (note.trim().length < 3 || note.trim().length > 500) errors.note = t('error.note');
    setFieldError(errors);
    if (errors.amount || errors.note || reason === null || !p) return;
    setServerError(null);
    if (p.confirmation === 'reinforced') {
      openRetype(p.referenceCents);
      return;
    }
    create.mutate(false);
  }

  const amountLabel = formatMoneyCents(validAmount ? amountCents! : 0, locale);
  const blocked = p?.confirmation === 'blocked';
  const retypeCents = pesosToCents(retypeText);
  const retypeMatches = retypeCents !== null && retypeCents === amountCents;

  const headingCls = 'font-mono text-[11px] uppercase tracking-[0.06em] text-muted outline-none focus-visible:shadow-focus';
  const back = (to: Step) => (
    <Button variant="ghost" size="sm" onClick={() => goTo(to)}>
      ← {t('back')}
    </Button>
  );

  return (
    <>
      <Modal
        open={open && !retypeOpen}
        onClose={onClose}
        title={step === 'amount' && item?.card ? t('step3.title', { card: item.card.name }) : t('title')}
        footer={
          step === 'amount' ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                {tc('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={!validAmount || !p || blocked || reason === null || note.trim().length < 3}
                loading={create.isPending}
                onClick={submit}
                data-testid="wd-refund-submit"
              >
                {t('step3.confirm', { amount: amountLabel })}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              {tc('cancel')}
            </Button>
          )
        }
      >
        {step === 'search' && (
          <div className="flex flex-col gap-4 text-sm text-text">
            <h3 ref={headingRef} tabIndex={-1} className={headingCls}>
              {t('step1.heading')}
            </h3>
            <Input
              ref={searchRef}
              type="search"
              label={t('step1.label')}
              hint={t('step1.hint')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="wd-refund-search"
            />
            {search.isError && <p className="text-accent">{getMessage(search.error)}</p>}
            {search.data && search.data.data.length === 0 && <p className="text-muted">{t('step1.empty', { q: debouncedQ })}</p>}
            {search.data && search.data.data.length > 0 && (
              <ul className="flex flex-col divide-y divide-border border-y border-border" data-testid="wd-refund-results">
                {search.data.data.map((s) => {
                  const delivered = s.status === 'entregado';
                  const who = s.customer?.fullName?.trim() || s.guestEmail || s.addressSnapshot?.recipientName || '—';
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={!delivered}
                        onClick={() => {
                          setShipment(s);
                          setItemId(null);
                          goTo('card');
                        }}
                        className="flex min-h-[44px] w-full flex-wrap items-center gap-3 py-2 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        data-testid={`wd-refund-result-${s.id}`}
                      >
                        <span className="tabular font-mono">{s.id}</span>
                        <span>{who}</span>
                        <StatusBadge domain="shipment" value={s.status} />
                        {!delivered && <span className="basis-full text-muted">{t('step1.notDelivered', { status: tShip(s.status) })}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {step === 'card' && shipment && (
          <div className="flex flex-col gap-4 text-sm text-text">
            <div>{back('search')}</div>
            <h3 ref={headingRef} tabIndex={-1} className={headingCls}>
              {t('step2.heading', { folio: shipment.id })}
            </h3>
            {detail.isLoading && <p className="text-muted">{tc('loading')}</p>}
            {detail.isError && <p className="text-accent">{getMessage(detail.error)}</p>}
            {detail.data && (
              <fieldset className="flex flex-col gap-2">
                <legend className={headingCls}>{t('step2.legend')}</legend>
                {items.map((it) => {
                  const notShipped = it.prepStatus === 'missing';
                  return (
                    <label key={it.id ?? it.inventoryItemId} className="flex min-h-[44px] items-start gap-3">
                      <input
                        type="radio"
                        name="wd-refund-item"
                        className="mt-1 h-5 w-5 accent-text"
                        disabled={notShipped || !it.id}
                        checked={itemId === it.id}
                        onChange={() => setItemId(it.id ?? null)}
                      />
                      <span className="w-10 shrink-0">
                        <CardImage src={it.card?.imageSmallUrl ?? null} alt="" className="p-0.5" />
                      </span>
                      <span className="flex flex-col">
                        <span lang="en">{it.card?.name ?? '—'}</span>
                        <span className="font-mono text-[11px] text-muted" lang="en">
                          {[it.card?.setName, it.folio].filter(Boolean).join(' · ')}
                        </span>
                        {notShipped && <span className="text-muted">{t('step2.notShipped')}</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            <div>
              <Button
                variant="primary"
                size="sm"
                disabled={item === null}
                onClick={() => {
                  resetCapture();
                  goTo('amount');
                }}
                data-testid="wd-refund-next"
              >
                {t('step2.next')}
              </Button>
            </div>
          </div>
        )}

        {step === 'amount' && item && (
          <div className="flex flex-col gap-4 text-sm text-text">
            <div>{back('card')}</div>
            <h3 ref={headingRef} tabIndex={-1} className={headingCls}>
              {t('step3.heading')}
            </h3>
            <div className="flex flex-col gap-1" data-testid="wd-refund-refs">
              {r === null ? (
                <p className="text-muted">{tc('loading')}</p>
              ) : (
                <>
                  {r.paidReferenceCents === null ? (
                    <p className="text-accent">{t('step3.noOrigin')}</p>
                  ) : (
                    <p className="tabular">{tr('paidRef', { amount: formatMoneyCents(r.paidReferenceCents, locale) })}</p>
                  )}
                  {r.market ? (
                    <p className="tabular">
                      {tr('marketRef', { amount: formatMoneyCents(r.market.cents, locale) })}{' '}
                      <span className="text-muted">{tr('marketRefDate', { date: r.market.capturedDate })}</span>
                    </p>
                  ) : (
                    <p className="text-accent">{tr('marketNone')}</p>
                  )}
                </>
              )}
            </div>
            <Input
              label={tr('amountLabel')}
              type="text"
              inputMode="decimal"
              prefix="MX$"
              autoComplete="off"
              value={amountText}
              hint={fieldError.amount ? undefined : tr('amountHint')}
              error={fieldError.amount}
              onChange={(e) => {
                setAmountText(e.target.value);
                setFieldError((f) => ({ ...f, amount: undefined }));
                setServerError(null);
              }}
              data-testid="wd-refund-amount"
            />
            <ShippedReasonFieldset name="wd-refund-reason" legend={t('step3.legend')} value={reason} onChange={setReason} />
            <Textarea
              label={t('step3.noteLabel')}
              hint={t('step3.noteHint')}
              value={note}
              maxLength={500}
              counter={{ max: 500 }}
              error={fieldError.note}
              onChange={(e) => {
                setNote(e.target.value);
                setFieldError((f) => ({ ...f, note: undefined }));
              }}
              data-testid="wd-refund-note"
            />
            <div role="status" aria-live="polite" className="flex flex-col gap-1" data-testid="wd-refund-preview">
              {validAmount && preview.isFetching && !p && <p className="text-muted">{tr('previewLoading')}</p>}
              {p && <p>{t('step3.allTransfer')}</p>}
              {p?.confirmation === 'reinforced' && <p>{tr('reinforcedHint', { amount: formatMoneyCents(p.referenceCents, locale) })}</p>}
              {blocked && p && (
                <p className="text-accent" role="alert">
                  {blockedText(p.limitCents, p.referenceCents)}
                </p>
              )}
              {preview.isError && <p className="text-accent">{getMessage(preview.error)}</p>}
            </div>
            {serverError && (
              <p role="alert" className="text-accent" data-testid="wd-refund-error">
                {serverError.text}{' '}
                {serverError.link && (
                  <Link href={serverError.link.href} className="text-text underline underline-offset-4 hover:text-accent">
                    {serverError.link.label}
                  </Link>
                )}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={open && retypeOpen}
        onClose={() => setRetypeOpen(false)}
        title={tr('retype.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRetypeOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="primary" disabled={!retypeMatches} loading={create.isPending} onClick={() => create.mutate(true)} data-testid="wd-refund-retype-submit">
              {t('step3.confirm', { amount: amountLabel })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-text">
          {retypeNote && <p>{retypeNote}</p>}
          <Input
            ref={retypeRef}
            label={tr('retype.label')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            autoComplete="off"
            value={retypeText}
            error={retypeText.trim() !== '' && !retypeMatches ? tr('retype.mismatch', { amount: amountLabel }) : undefined}
            onChange={(e) => setRetypeText(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              setRetypeText('');
              setServerError({ text: tr('retype.noPaste') });
            }}
            data-testid="wd-refund-retype"
          />
          {serverError && (
            <p role="alert" className="text-accent">
              {serverError.text}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

