'use client';

/**
 * §BUYLIST-FLUJO F2 (diseño A, HECHOS 2026-11-22) — las cuatro acciones por carta EN LA MISMA FILA de la revisión física:
 * Aprobar al pactado · Bajar precio · No aceptar · No llegó. Más: «Convertir todas» (diálogo con ubicación y lista) y la
 * recogida («Entregada»). Regla de oro: el front MUESTRA lo que manda el servidor (neto de la baja, texto de las causas
 * como vista previa) y no suma dinero. Anexo §3–§6 de `docs/API_CONTRACT_BUYLIST_FLUJO.md`.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ApiClientError } from '@/lib/api-client';
import {
  convertAllBuylist,
  decideBuylistItem,
  getLocations,
  markBuylistPickupDone,
  previewBuylistRevision,
  reviseBuylistItemPrice,
} from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import type {
  AdminBuylistDTO,
  AdminSellItemDTO,
  BuylistPickupDTO,
  BuylistRejectReasonCode,
  BuylistReviseReasonCode,
  SellItemDTO,
} from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

const DAY_MS = 86_400_000;
const NOTE_MIN = 3;
const NOTE_MAX = 500;

export type ReviewPanelKind = 'reduce' | 'reject' | 'not_received';
export interface ReviewPanelState {
  itemId: string;
  kind: ReviewPanelKind;
}

/** «12,500.50» / «12500» ⇒ centavos enteros; `null` si no es un monto válido. Solo convierte lo que TECLEÓ el operador. */
export function parsePesosToCents(raw: string): number | null {
  const clean = raw.replace(/[\s,$]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [int, dec = ''] = clean.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function daysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY_MS));
}

/* ------------------------------------------------------------------------------------------ Botones de la fila */

export function ReviewItemActions({
  item,
  panel,
  onPanel,
  onApprove,
  approving,
}: {
  item: AdminSellItemDTO;
  panel: ReviewPanelState | null;
  onPanel: (next: ReviewPanelState | null) => void;
  onApprove: () => void;
  approving: boolean;
}) {
  const t = useTranslations('admin.m5.flow.f2');
  const locale = useLocale() as AppLocale;
  const open = panel?.itemId === item.id ? panel.kind : null;
  const toggle = (kind: ReviewPanelKind) => onPanel(open === kind ? null : { itemId: item.id, kind });
  const rev = item.revision;

  if (rev?.state === 'pending') {
    const n = daysLeft(rev.expiresAt);
    return (
      <div className="flex flex-col items-start gap-1" data-testid={`f2-waiting-${item.id}`}>
        <span className="inline-flex border border-accent px-3 py-1 text-xs font-medium text-accent">
          {n == null ? t('waiting.noDate') : t('waiting.label', { count: n })}
        </span>
        {rev.proposedCents != null && rev.previousCents != null && (
          <span className="tabular text-xs text-muted">
            {t('waiting.proposed', {
              proposed: formatMoneyCents(rev.proposedCents, locale),
              previous: formatMoneyCents(rev.previousCents, locale),
            })}
          </span>
        )}
        {rev.netIfAcceptedCents != null && (
          <span className="tabular text-xs text-muted" data-testid={`f2-net-if-${item.id}`}>
            {t('waiting.netIf', { net: formatMoneyCents(rev.netIfAcceptedCents, locale) })}
          </span>
        )}
      </div>
    );
  }

  // Diseño A: una línea ya aprobada no repite las acciones; dice cómo se aprobó (al pactado o con la baja aceptada).
  if (item.itemStatus === 'aprobada') {
    return (
      <span
        className="inline-flex items-center gap-1 border border-success px-3 py-1 text-xs font-medium text-success"
        data-testid={`f2-approved-${item.id}`}
      >
        <span aria-hidden>✓</span> {rev?.state === 'accepted' ? t('status.approvedRevised') : t('status.approvedAgreed')}
      </span>
    );
  }

  const canRevise = item.offerDecision === 'buy';
  return (
    <>
      <Button size="sm" variant="primary" loading={approving} onClick={onApprove} data-testid={`f2-approve-${item.id}`}>
        {t('actions.approve')}
      </Button>
      {canRevise && (
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={open === 'reduce'}
          onClick={() => toggle('reduce')}
          data-testid={`f2-reduce-${item.id}`}
        >
          {t('actions.reduce')} ▾
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        aria-expanded={open === 'reject'}
        onClick={() => toggle('reject')}
        data-testid={`f2-reject-${item.id}`}
      >
        {t('actions.reject')} ▾
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open === 'not_received'}
        onClick={() => toggle('not_received')}
        data-testid={`f2-notreceived-${item.id}`}
      >
        {t('actions.notReceived')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------------------------------- Bajar precio */

export function RevisePricePanel({
  req,
  item,
  getError,
  onClose,
  onDone,
}: {
  req: AdminBuylistDTO;
  item: AdminSellItemDTO;
  getError: (e: unknown) => string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('admin.m5.flow.f2.revise');
  const locale = useLocale() as AppLocale;
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState<BuylistReviseReasonCode>('condition_mismatch');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = parsePesosToCents(amount);
  const debounced = useDebounced(cents, 300);
  const offered = item.offeredPriceCents ?? null;
  const lower = cents != null && cents > 0 && (offered == null || cents < offered);

  const preview = useQuery({
    queryKey: ['buylist-revise-preview', item.id, debounced],
    queryFn: () => previewBuylistRevision(item.id, debounced as number),
    enabled: debounced != null && debounced > 0 && (offered == null || debounced < offered),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const shown = lower && preview.data && preview.data.revisedPriceCents === cents ? preview.data.payout : null;
  const previewErr = preview.error ? mapReviseError(preview.error, t, offered, locale) : null;

  const send = useMutation({
    mutationFn: () =>
      reviseBuylistItemPrice(item.id, {
        revisedPriceCents: cents as number,
        reasonCode,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => onDone(t('sent', { card: item.card.name })),
    onError: (e) => setError(mapReviseError(e, t, offered, locale) ?? getError(e)),
  });

  const noteTrim = note.trim();
  const noteOk = reasonCode !== 'other' || (noteTrim.length >= NOTE_MIN && noteTrim.length <= NOTE_MAX);
  const reasons: { value: BuylistReviseReasonCode; label: string }[] = [
    { value: 'condition_mismatch', label: t('reasons.condition_mismatch') },
    { value: 'wrong_card', label: t('reasons.wrong_card') },
    { value: 'other', label: t('reasons.other') },
  ];

  return (
    <div className="flex flex-col gap-3 border-l-4 border-accent bg-accent/5 p-4" data-testid={`f2-panel-reduce-${item.id}`}>
      <div className="grid gap-4 md:grid-cols-[200px_260px_1fr_auto] md:items-start">
        <Input
          label={t('newPrice')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          error={amount !== '' && cents == null ? t('invalidAmount') : undefined}
          hint={offered != null ? t('agreedHint', { amount: formatMoneyCents(offered, locale) }) : undefined}
          data-testid={`f2-revise-amount-${item.id}`}
        />
        <Select
          label={t('why')}
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value as BuylistReviseReasonCode)}
          options={reasons}
          data-testid={`f2-revise-reason-${item.id}`}
        />
        <div aria-live="polite" data-testid={`f2-revise-net-${item.id}`}>
          <p className="eyebrow">{t('netLabel')}</p>
          {shown ? (
            <>
              <p className="tabular font-serif text-3xl leading-tight" data-testid={`f2-revise-net-value-${item.id}`}>
                {formatMoneyCents(shown.netCents, locale)}
              </p>
              <p className="text-xs text-muted">{t('netNote')}</p>
            </>
          ) : preview.isFetching ? (
            <p className="text-sm text-muted">{t('netLoading')}</p>
          ) : (
            <p className="text-sm text-muted">{previewErr ?? t('netNone')}</p>
          )}
        </div>
        <div className="flex gap-2 md:justify-end md:pt-6">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="accent"
            disabled={!lower || !noteOk}
            loading={send.isPending}
            onClick={() => send.mutate()}
            data-testid={`f2-revise-send-${item.id}`}
          >
            {t('send')}
          </Button>
        </div>
      </div>
      {reasonCode === 'other' && (
        <Textarea
          label={t('noteLabel')}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          error={note !== '' && !noteOk ? t('noteInvalid') : undefined}
        />
      )}
      <p className="text-xs text-muted">{t('hint', { id: req.id })}</p>
      {error && (
        <Banner variant="danger" role="alert">
          {error}
        </Banner>
      )}
    </div>
  );
}

function mapReviseError(
  e: unknown,
  t: (k: string, v?: Record<string, string>) => string,
  offered: number | null,
  locale: AppLocale,
): string | null {
  if (!(e instanceof ApiClientError)) return null;
  if (e.status === 400) return t('errors.invalid');
  if (e.status === 409 && e.code === 'REVISION_PENDING') return t('errors.pending');
  if (e.status === 409 && e.code === 'REVISION_ALREADY_RESOLVED') return t('errors.resolved');
  if (e.status === 422 && e.code === 'REVISION_NOT_LOWER') {
    return t('errors.notLower', { offered: offered != null ? formatMoneyCents(offered, locale) : '—' });
  }
  if (e.status === 422 && e.code === 'ITEM_NOT_OFFERED') return t('errors.notOffered');
  if (e.status === 422 && e.code === 'REQUEST_NOT_RECEIVED') return t('errors.notReceived');
  return null;
}

/* ------------------------------------------------------------------------------------------- No aceptar */

const REJECT_CAUSES: BuylistRejectReasonCode[] = ['not_received', 'condition_mismatch', 'wrong_card', 'other'];

export function RejectPanel({
  req,
  item,
  initialCause,
  getError,
  onClose,
  onDone,
  onFinal,
}: {
  req: AdminBuylistDTO;
  item: AdminSellItemDTO;
  initialCause: BuylistRejectReasonCode | null;
  getError: (e: unknown) => string;
  onClose: () => void;
  onDone: (message: string, cause: BuylistRejectReasonCode) => void;
  /** 409 ITEM_FINAL: lo resuelve el padre (recarga + aviso). */
  onFinal: (e: ApiClientError) => void;
}) {
  const t = useTranslations('admin.m5.flow.f2.rejectPanel');
  const [cause, setCause] = useState<BuylistRejectReasonCode | null>(initialCause);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const textOk = cause !== 'other' || (trimmed.length >= NOTE_MIN && trimmed.length <= NOTE_MAX);

  const send = useMutation({
    mutationFn: () =>
      decideBuylistItem(item.id, {
        decision: 'reject',
        reasonCode: cause as BuylistRejectReasonCode,
        ...(trimmed ? { reason: trimmed } : {}),
      }) as Promise<SellItemDTO>,
    onSuccess: () => onDone(t('done', { card: item.card.name }), cause as BuylistRejectReasonCode),
    onError: (e) => {
      if (e instanceof ApiClientError) {
        if (e.status === 409 && e.details?.reason === 'ITEM_FINAL') return onFinal(e);
        if (e.status === 400 && e.details?.field === 'reasonCode') return setError(t('errors.reasonCode'));
        if (e.status === 400) return setError(t('errors.reason'));
        if (e.status === 409 && e.code === 'REVISION_PENDING') return setError(t('errors.pending'));
        if (e.status === 422 && e.code === 'REQUEST_NOT_RECEIVED') return setError(t('errors.notReceived'));
      }
      setError(getError(e));
    },
  });

  const noPickup = cause === 'not_received';
  const preview = cause
    ? cause === 'other'
      ? trimmed
      : t(`preview.${cause}`, {
          folio: req.id,
          card: item.card.name,
          set: item.card.setName,
          number: item.card.number,
          declared: item.rawCondition ?? 'NM',
          note: trimmed ? ` (${trimmed})` : '',
        })
    : '';
  const group = 'f2-cause-' + item.id;

  return (
    <div className="flex flex-col gap-4 border-l-4 border-accent bg-accent/5 p-4 lg:flex-row" data-testid={`f2-panel-reject-${item.id}`}>
      <fieldset className="lg:w-[320px]">
        <legend className="eyebrow mb-2">{t('why')}</legend>
        <div className="flex flex-col border border-border-strong">
          {REJECT_CAUSES.map((c) => (
            <label
              key={c}
              className={cn(
                'flex min-h-[44px] cursor-pointer items-center gap-2 border-b border-border px-3 text-sm last:border-b-0 focus-within:shadow-focus',
                cause === c ? 'bg-text text-bg' : 'bg-surface',
              )}
            >
              <input
                type="radio"
                name={group}
                className="sr-only"
                checked={cause === c}
                onChange={() => {
                  setCause(c);
                  setError(null);
                }}
              />
              <span aria-hidden>{cause === c ? '●' : '○'}</span>
              {t(`causes.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-1 flex-col gap-3">
        {(cause === 'other' || cause === 'wrong_card') && (
          <Textarea
            label={cause === 'other' ? t('otherLabel') : t('wrongNoteLabel')}
            value={text}
            maxLength={NOTE_MAX}
            onChange={(e) => setText(e.target.value)}
            error={cause === 'other' && text !== '' && !textOk ? t('errors.reason') : undefined}
          />
        )}
        <div>
          <p className="eyebrow">{t('previewTitle')}</p>
          <p
            className="mt-2 min-h-[56px] border border-border-strong bg-surface p-3 text-sm leading-[1.6]"
            data-testid={`f2-reject-preview-${item.id}`}
          >
            {cause ? (
              <>
                {preview}
                {!noPickup && <> {t('pickupBlock')}</>}
              </>
            ) : (
              <span className="text-muted">{t('pickCause')}</span>
            )}
          </p>
          <p className="mt-1 text-xs text-muted">{t('previewNote')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted">{cause ? (noPickup ? t('noPickup') : t('withPickup')) : ''}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="accent"
              disabled={!cause || !textOk}
              loading={send.isPending}
              onClick={() => send.mutate()}
              data-testid={`f2-reject-send-${item.id}`}
            >
              {t('confirm', { card: item.card.name })}
            </Button>
          </div>
        </div>
        {error && (
          <Banner variant="danger" role="alert">
            {error}
          </Banner>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- Recogida */

export function PickupLine({
  itemId,
  cardName,
  pickup,
  onDone,
  onError,
}: {
  itemId: string;
  cardName: string;
  pickup: BuylistPickupDTO | null | undefined;
  onDone: (message: string) => void;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations('admin.m5.flow.f2.pickup');
  const locale = useLocale() as AppLocale;
  const mark = useMutation({
    mutationFn: () => markBuylistPickupDone(itemId),
    onSuccess: () => onDone(t('doneFeedback', { card: cardName })),
    onError,
  });
  // `pickup` es `null` en «No llegó» (nada que recoger) y en líneas que no están rechazadas: no se pinta.
  if (!pickup) return null;
  const state = pickup.doneAt ? 'done' : (pickup.method ?? 'none');
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid={`f2-pickup-${itemId}`}>
      <span className="font-medium text-text" data-testid={`f2-pickup-state-${itemId}`}>
        {state === 'done' ? t('done', { date: formatDate(pickup.doneAt as string, locale) }) : t(`state.${state}`)}
      </span>
      {!pickup.doneAt && (
        <Button size="sm" variant="secondary" loading={mark.isPending} onClick={() => mark.mutate()} data-testid={`f2-pickup-done-${itemId}`}>
          {t('markDone')}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ Convertir todas */

export function ConvertAllButton({
  req,
  onDone,
}: {
  req: AdminBuylistDTO;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('admin.m5.flow.f2.convertAll');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ converted: number; skipped: number; failed: number } | null>(null);
  const eligible = req.items.filter((it) => it.itemStatus === 'aprobada');
  const locations = useQuery({ queryKey: ['admin-locations', 'convert-all'], queryFn: getLocations, enabled: open });

  const run = useMutation({
    mutationFn: () => convertAllBuylist(req.id, locationId || undefined),
    onSuccess: (r) => {
      setError(null);
      const sum = { converted: r.converted.length, skipped: r.skipped.length, failed: r.failed.length };
      if (sum.failed === 0) {
        setOpen(false);
        setSummary(null);
        onDone(t('done', { count: sum.converted }));
      } else {
        // Éxito parcial: se queda abierto con el resumen; reintentar es seguro (ya convertidas ⇒ omitidas).
        setSummary(sum);
        onDone(t('partial', sum));
      }
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 422 && e.code === 'LOCATION_NOT_AVAILABLE') {
        setError(t('locationGone'));
        return;
      }
      setError(e instanceof ApiClientError ? e.message : t('error'));
    },
  });

  if (eligible.length === 0) return null;
  const options = [
    { value: '', label: t('noLocation') },
    ...(locations.data ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.label })),
  ];
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)} data-testid={`f2-convert-all-${req.id}`}>
        {t('cta', { count: eligible.length })}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="accent" loading={run.isPending} onClick={() => run.mutate()} data-testid="f2-convert-all-confirm">
              {t('confirm', { count: eligible.length })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t('intro', { id: req.id })}</p>
          <Select
            label={t('location')}
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setError(null);
            }}
            options={options}
            hint={t('locationHint')}
            data-testid="f2-convert-all-location"
          />
          <div>
            <p className="eyebrow">{t('listTitle')}</p>
            <ul className="mt-2 divide-y divide-border border border-border" data-testid="f2-convert-all-list">
              {eligible.map((it) => (
                <li key={it.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span lang="en" className="font-medium">
                      {it.card.name}
                    </span>{' '}
                    <span className="font-mono text-xs text-muted">
                      {it.card.setName} · {it.card.number}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {summary && (
            <Banner variant="warning" role="status">
              {t('partial', summary)} {t('retry')}
            </Banner>
          )}
          {error && (
            <Banner variant="danger" role="alert">
              {error}
            </Banner>
          )}
        </div>
      </Modal>
    </>
  );
}
