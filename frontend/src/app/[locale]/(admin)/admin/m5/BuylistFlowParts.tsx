'use client';

/**
 * §BUYLIST-FLUJO F1 (diseño A, HECHOS 2026-11-22): las piezas de la ficha de M5 que muestran el dinero y el estado.
 * Regla de oro: el front MUESTRA lo que manda el servidor (`payout`, `offerNet`, `statusClock`, `agreedPriceCents`) y no
 * multiplica ni suma dinero. El único cálculo de pantalla es el % del chip de mercado (proporción, no monto).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getBuylistDecisionTable, paySpeiBuylist, revealBuylistClabe } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AdminBuylistDTO, AdminSellItemDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { CardPhotoLightbox } from './CardPhotoLightbox';

/** Botón «Copiar» con aviso breve «Copiado». El portapapeles puede fallar (permiso): entonces no afirma nada. */
export function CopyButton({ text, label, copiedLabel, testId }: { text: string; label: string; copiedLabel: string; testId?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      data-testid={testId}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 2000);
          },
          () => undefined,
        );
      }}
    >
      <span aria-live="polite">{done ? copiedLabel : label}</span>
    </Button>
  );
}

/** CLABE en bloques legibles (3-3-11-1). Solo formato de texto. */
function groupClabe(clabe: string): string {
  const d = clabe.replace(/\s+/g, '');
  return d.length === 18 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 17)} ${d.slice(17)}` : d;
}

/* ---------------------------------------------------------------------------------------------- F1a · modal SPEI */

export interface SpeiPayModalProps {
  /** `null` ⇒ cerrado. */
  req: AdminBuylistDTO | null;
  onClose: () => void;
  /** `paidNetCents` = el `payout.netCents` de la RESPUESTA (lo sellado), no el que se envió (qa M-4: replay idempotente). */
  onPaid: (requestId: string, paidNetCents: number | null) => void;
  /** El servidor dijo que el monto cambió: hay que recargar la solicitud. */
  onStale: () => void;
  getError: (e: unknown) => string;
}

export function SpeiPayModal({ req, onClose, onPaid, onStale, getError }: SpeiPayModalProps) {
  const t = useTranslations('admin.m5.flow.spei');
  const tc = useTranslations('common');
  const tf2 = useTranslations('admin.m5.flow.f2');
  const locale = useLocale() as AppLocale;
  const id = req?.id ?? null;
  const [reference, setReference] = useState('');
  const [clabe, setClabe] = useState<{ clabe: string; holder: string } | null>(null);
  const [clabeMissing, setClabeMissing] = useState(false);
  const [clabeError, setClabeError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  /** Neto nuevo que mandó el 409; manda sobre `payout` hasta que la recarga lo alcance. */
  const [changed, setChanged] = useState<{ previous: number; current: number } | null>(null);

  const reveal = useMutation({
    mutationFn: (rid: string) => revealBuylistClabe(rid),
    onSuccess: (d) => setClabe({ clabe: d.clabe, holder: d.holderName ?? '' }),
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'CLABE_MISSING') setClabeMissing(true);
      else setClabeError(getError(e));
    },
  });
  // Un reveal AUDITADO por apertura: la CLABE vive solo en estado local del modal (mutation, no cache).
  useEffect(() => {
    setReference('');
    setClabe(null);
    setClabeMissing(false);
    setClabeError(null);
    setPayError(null);
    setChanged(null);
    if (id) reveal.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una consulta por solicitud abierta
  }, [id]);

  const payout = req?.payout ?? null;
  // El neto del 409 manda hasta que la recarga de la solicitud trae el nuevo `payout`; lo mostrado = lo que se reenvía.
  const shownNet = changed && payout?.netCents === changed.previous ? changed.current : (payout?.netCents ?? null);

  const pay = useMutation({
    mutationFn: (vars: { rid: string; ref: string; net: number }) => paySpeiBuylist(vars.rid, vars.ref, vars.net),
    onSuccess: (d, vars) => onPaid(vars.rid, d?.payout?.netCents ?? null),
    onError: (e, vars) => {
      if (e instanceof ApiClientError && e.status === 409 && e.code === 'PAYOUT_CHANGED') {
        const current = Number(e.details?.currentNetCents);
        if (Number.isFinite(current)) {
          setChanged({ previous: vars.net, current });
          setPayError(null);
          onStale();
          return;
        }
      }
      // §BUYLIST-FLUJO F2c: una baja sin respuesta del vendedor bloquea el pago (nunca se paga un precio menor sin su «sí»).
      if (e instanceof ApiClientError && e.status === 409 && e.code === 'REVISION_PENDING') {
        setPayError(tf2('revisionPendingPay'));
        onStale();
        return;
      }
      setPayError(getError(e));
    },
  });

  // M-3: `expectedNetCents` viaja SIEMPRE como entero, nunca null.
  const canConfirm = !!req && shownNet != null && Number.isInteger(shownNet) && reference.trim() !== '' && !!clabe && !pay.isPending;

  return (
    <Modal
      open={!!req}
      onClose={onClose}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            variant="accent"
            disabled={!canConfirm}
            loading={pay.isPending}
            onClick={() => req && shownNet != null && pay.mutate({ rid: req.id, ref: reference.trim(), net: shownNet })}
          >
            {shownNet != null ? t('confirm', { amount: formatMoneyCents(shownNet, locale) }) : t('confirm', { amount: '—' })}
          </Button>
        </>
      }
    >
      {req && (
        <div className="flex flex-col gap-4" data-testid="spei-modal">
          <p className="text-sm text-muted">
            {t('subtitle', { id: req.id, seller: req.seller?.name ?? req.userId })}
          </p>
          {payout == null || shownNet == null ? (
            <Banner variant="danger" role="alert">
              {t('noPayout')}
            </Banner>
          ) : (
            <>
              <div className="bg-ink px-5 py-4 text-on-ink" data-testid="spei-deposit">
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-on-ink-muted">
                  {payout.isFinal ? t('deposits') : t('depositsEstimated')}
                </p>
                <p className="tabular font-serif text-[40px] leading-tight" data-testid="spei-net">
                  {formatMoneyCents(shownNet, locale)}
                </p>
              </div>
              {!payout.isFinal && <p className="text-xs text-muted">{t('provisional')}</p>}
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt>{t('gross')}</dt>
                  <dd className="tabular font-mono">{formatMoneyCents(payout.grossCents, locale)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{t('shipping')}</dt>
                  <dd className="tabular font-mono">− {formatMoneyCents(payout.shippingFeeCents, locale)}</dd>
                </div>
              </dl>
            </>
          )}
          {changed && (
            <div data-testid="spei-changed"><Banner variant="warning" role="alert">
              {t('changed', {
                previous: formatMoneyCents(changed.previous, locale),
                current: formatMoneyCents(changed.current, locale),
              })}
            </Banner></div>
          )}
          <div className="border border-border-strong bg-surface-2 p-4" data-testid="spei-clabe-block">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('clabeLabel')}</p>
            {clabeMissing ? (
              <div data-testid="spei-clabe-missing"><Banner variant="danger" role="alert">
                {t('clabeMissing')}
              </Banner></div>
            ) : clabeError ? (
              <Banner variant="danger" role="alert">
                {clabeError}
              </Banner>
            ) : clabe ? (
              <>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                  <span className="tabular font-mono text-xl tracking-[0.08em]" data-testid="spei-clabe">
                    {groupClabe(clabe.clabe)}
                  </span>
                  <CopyButton text={clabe.clabe} label={t('copy')} copiedLabel={t('copied')} testId="spei-copy-clabe" />
                </div>
                {clabe.holder && (
                  <p className="mt-2 text-sm text-muted">
                    {t('holder')}: <span className="font-medium text-text" data-testid="spei-holder">{clabe.holder}</span>
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">{t('loadingClabe')}</p>
            )}
          </div>
          <Input
            label={t('refLabel')}
            type="text"
            placeholder={t('refPlaceholder')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <p className="text-xs text-muted">{t('note')}</p>
          {payError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {payError}
            </Banner>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------------------------------- F1b · barra y fila de revisión */

/** Barra fija inferior de la ficha en revisión: Bruto − Envío = Se deposita (todo del servidor). */
export function PayoutBar({
  req,
  pendingDecisions,
  action,
}: {
  req: AdminBuylistDTO;
  pendingDecisions: number;
  action: React.ReactNode;
}) {
  const t = useTranslations('admin.m5.flow.bar');
  const locale = useLocale() as AppLocale;
  const p = req.payout;
  if (!p) return null;
  return (
    <div
      data-testid={`payout-bar-${req.id}`}
      className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t-2 border-accent bg-ink px-4 py-3 text-on-ink"
    >
      <div className="flex flex-col gap-1">
        {!p.isFinal && (
          <span className="w-fit border border-on-ink-muted px-2 py-0.5 text-xs" data-testid="payout-provisional">
            {pendingDecisions > 0 ? t('provisional', { count: pendingDecisions }) : t('provisionalAny')}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-on-ink-muted">{t('gross')}</p>
          <p className="tabular font-mono text-lg" data-testid="payout-gross">{formatMoneyCents(p.grossCents, locale)}</p>
        </div>
        <span aria-hidden="true">−</span>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-on-ink-muted">{t('shipping')}</p>
          <p className="tabular font-mono text-lg" data-testid="payout-shipping">{formatMoneyCents(p.shippingFeeCents, locale)}</p>
        </div>
        <span aria-hidden="true">=</span>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-on-ink-muted" data-testid="payout-net-label">
            {p.isFinal ? t('net') : t('netEstimated')}
          </p>
          <p className="tabular font-serif text-3xl leading-none" data-testid="payout-net">{formatMoneyCents(p.netCents, locale)}</p>
        </div>
      </div>
      <div>{action}</div>
    </div>
  );
}

/** Mercado de hoy por carta (de la mesa, que no tiene guarda de estado) para pintar el chip ±%. */
export function useMarketToday(requestId: string, enabled: boolean): Record<string, number | null> {
  const q = useQuery({
    queryKey: ['buylist-decision-table', requestId, 'market'],
    queryFn: () => getBuylistDecisionTable(requestId),
    enabled,
  });
  const out: Record<string, number | null> = {};
  for (const l of q.data?.lines ?? []) out[l.itemId] = l.marketMxnCents ?? null;
  return out;
}

/** Baja aceptada: el ofertado original en chico bajo el pactado. Solo campos del servidor; sin aritmética. */
export function OfferedOriginal({ item }: { item: AdminSellItemDTO }) {
  const t = useTranslations('admin.m5.flow.line');
  const locale = useLocale() as AppLocale;
  const { agreedPriceCents: agreed, offeredPriceCents: offered } = item;
  if (agreed == null || offered == null || agreed === offered) return null;
  return (
    <span className="tabular text-xs text-muted" data-testid={`offered-original-${item.id}`}>
      {t('offeredOriginal', { amount: formatMoneyCents(offered, locale) })}
    </span>
  );
}

/** Precio pactado (NO el cotizado) + mercado de hoy con chip ±%. */
export function ReviewLineFacts({ requestId, item }: { requestId: string; item: AdminSellItemDTO }) {
  const marketCents = useMarketToday(requestId, true)[item.id];
  const t = useTranslations('admin.m5.flow.line');
  const locale = useLocale() as AppLocale;
  const agreed = item.agreedPriceCents ?? item.offeredPriceCents ?? null;
  let chip: { text: string; label: string; tone: 'up' | 'down' | 'same' } | null = null;
  if (agreed != null && agreed > 0 && marketCents != null) {
    const pct = Math.round(((marketCents - agreed) / agreed) * 1000) / 10;
    const abs = Math.abs(pct).toFixed(1);
    chip =
      pct > 0
        ? { text: `▲ +${abs} %`, label: t('chipUp', { pct: abs }), tone: 'up' }
        : pct < 0
          ? { text: `▼ −${abs} %`, label: t('chipDown', { pct: abs }), tone: 'down' }
          : { text: '= 0 %', label: t('chipSame'), tone: 'same' };
  }
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-1" data-testid={`review-facts-${item.id}`}>
      {agreed != null && (
        <div className="flex flex-col">
          <span className="tabular font-serif text-2xl leading-none" data-testid={`agreed-${item.id}`}>
            {formatMoneyCents(agreed, locale)}
          </span>
          <span className="text-xs text-muted">
            {item.offeredPriceCents != null && item.offeredPriceCents !== agreed ? t('agreed') : `${t('agreed')} · ${t('agreedCaption')}`}
          </span>
          <OfferedOriginal item={item} />
        </div>
      )}
      <div className="flex flex-col">
        <span className="flex items-center gap-2">
          <span className="tabular font-mono text-sm" data-testid={`market-${item.id}`}>
            {marketCents != null ? formatMoneyCents(marketCents, locale) : t('marketUnknown')}
          </span>
          {chip && (
            <span
              aria-label={chip.label}
              data-testid={`market-chip-${item.id}`}
              className={cn(
                'border px-2 py-0.5 text-xs',
                chip.tone === 'up' && 'border-success text-success',
                chip.tone === 'down' && 'border-danger text-danger',
                chip.tone === 'same' && 'border-border-strong text-muted',
              )}
            >
              {chip.text}
            </span>
          )}
        </span>
        <span className="text-xs text-muted">{t('market')}</span>
      </div>
    </div>
  );
}

export function ReviewPhoto({ item }: { item: AdminSellItemDTO }) {
  return <CardPhotoLightbox card={item.card} width={56} height={78} />;
}

/* ------------------------------------------------------------------------------------------------ Comprobantes */

/** Comprobante de envío: guía + fecha de recepción. Solo con la solicitud ya recibida. */
export function ShipmentReceipt({ req, withoutGuide = false }: { req: AdminBuylistDTO; withoutGuide?: boolean }) {
  const t = useTranslations('admin.m5.flow.receipt');
  const copied = useCopiedLabel();
  const locale = useLocale() as AppLocale;
  const carrier = req.shipmentCarrier ?? req.inboundShipment?.carrier ?? null;
  const number = req.shipmentTrackingNumber ?? req.inboundShipment?.trackingNumber ?? null;
  const receivedAt = req.receivedAt ?? (req.status === 'recibida' ? req.statusClock?.since : null) ?? null;
  const guide = number ? `${carrier ?? ''} ${number}`.trim() : null;
  return (
    <section
      aria-label={t('shipTitle')}
      data-testid={`ship-receipt-${req.id}`}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-border-strong bg-surface-2 px-4 py-3"
    >
      {!withoutGuide && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('shipTitle')}</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="tabular font-mono text-sm">{guide ?? t('noGuide')}</span>
            {number && <CopyButton text={number} label={t('copyGuide')} copiedLabel={copied} />}
          </div>
        </div>
      )}
      {receivedAt && <p className="text-sm text-muted">{t('receivedOn', { date: formatDate(receivedAt, locale) })}</p>}
    </section>
  );
}

function useCopiedLabel(): string {
  return useTranslations('admin.m5.flow.spei')('copied');
}

/** Comprobante de pago SPEI (cerradas): referencia, fecha y monto neto (todo del servidor). */
export function PaymentReceipt({ req }: { req: AdminBuylistDTO }) {
  const t = useTranslations('admin.m5.flow.receipt');
  const copied = useCopiedLabel();
  const locale = useLocale() as AppLocale;
  if (req.status !== 'pagada') return null;
  return (
    <section
      aria-label={t('payTitle')}
      data-testid={`pay-receipt-${req.id}`}
      className="flex flex-wrap items-end gap-x-8 gap-y-2 border border-border-strong bg-surface-2 px-4 py-3"
    >
      <div className="w-full font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('payTitle')}</div>
      <div>
        <p className="text-xs text-muted">{t('reference')}</p>
        <p className="flex items-center gap-3">
          <span className="tabular font-mono text-sm" data-testid="receipt-reference">{req.speiReference ?? t('noReference')}</span>
          {req.speiReference && <CopyButton text={req.speiReference} label={t('copyReference')} copiedLabel={copied} />}
        </p>
      </div>
      {req.paidAt && (
        <div>
          <p className="text-xs text-muted">{t('paidOn')}</p>
          <p className="tabular font-mono text-sm" data-testid="receipt-date">{formatDate(req.paidAt, locale)}</p>
        </div>
      )}
      {req.payout && (
        <div>
          <p className="text-xs text-muted">{t('net')}</p>
          <p className="tabular font-serif text-xl" data-testid="receipt-net">{formatMoneyCents(req.payout.netCents, locale)}</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ F1c · cinta */

export function RequestRibbon({ req }: { req: AdminBuylistDTO }) {
  const t = useTranslations('admin.m5.flow.ribbon');
  const locale = useLocale() as AppLocale;
  const clock = req.statusClock;
  if (!clock) return null;
  const expires = req.offerNet?.expiresAt ?? clock.dueAt;
  const waiting = req.tracking
    ? t('inTransitDays', { count: req.tracking.daysInTransit })
    : t('inStateDays', { count: clock.waitingDays });
  return (
    <div
      role="group"
      aria-label={t('label')}
      data-testid={`ribbon-${req.id}`}
      className="grid grid-cols-1 border border-border-strong bg-surface-2 sm:grid-cols-2 lg:grid-cols-4 [&>div]:border-border [&>div]:p-3 lg:[&>div+div]:border-l"
    >
      <div className="border-l-4 !border-l-accent">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('offered')}</p>
        {req.offerNet ? (
          <>
            <p className="tabular font-serif text-2xl" data-testid="ribbon-net">{formatMoneyCents(req.offerNet.netCents, locale)}</p>
            <p className="tabular text-xs text-muted">
              {t('breakdown', {
                gross: formatMoneyCents(req.offerNet.grossCents, locale),
                shipping: formatMoneyCents(req.offerNet.shippingFeeCents, locale),
              })}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">—</p>
        )}
      </div>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('expires')}</p>
        <p className={cn('tabular text-sm font-medium', clock.overdue && 'text-accent')} data-testid="ribbon-expires">
          {expires ? formatDate(expires, locale) : t('expiresNone')}
        </p>
        {clock.overdue && <p className="text-xs text-accent">{t('overdue')}</p>}
      </div>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('tracking')}</p>
        {req.tracking?.number ? (
          <>
            <p className="tabular text-sm font-medium">{`${req.tracking.carrier ?? ''} ${req.tracking.number}`.trim()}</p>
            {req.tracking.url && (
              <a
                href={req.tracking.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="ribbon-tracking-link"
                className="text-xs underline underline-offset-4 hover:text-accent focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t('trackingLink')} →
              </a>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">{t('noTracking')}</p>
        )}
      </div>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{t('waiting')}</p>
        <p className="text-sm font-medium" data-testid="ribbon-waiting">{waiting}</p>
        {clock.dueAt && <p className="text-xs text-muted">{t('dueAt', { date: formatDate(clock.dueAt, locale) })}</p>}
      </div>
    </div>
  );
}
