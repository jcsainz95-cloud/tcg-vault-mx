'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { prepareShipment, retryRefund, setShipPrepItem, unprepareShipment } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { sortPreparationItems } from '@/lib/preparation-order';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type {
  MissingReason,
  MoneyOutLimitExceededDetails,
  PreparationItemStatus,
  PreparationOrderDTO,
  RefundNotAvailableDetails,
  ShipPreparationItemDTO,
  ShipPreparationOrderDTO,
  WithdrawalLineOriginRefundedDetails,
} from '@/types/contract';
import { AgeStamp, CardInfo, DASH, LABEL, TAG } from './prep-shared';
import type { QueueNotice } from './VaultPlacementCard';
import { LocateItemControl } from './LocateItemControl';
import { LabelAlertBlock, useSince } from './LabelActions';

/**
 * **La tarjeta de ENVÍO, interactiva** (`DESIGN_SYSTEM §37.3–§37.5` · contrato `§M4-SHIP.3/.5/.6`,
 * v1.80.6). Mismo esqueleto que la de bóveda (§36): el operador **palomea** cada carta —«La tengo» /
 * «No la encontré» / «Llegó dañada»—, da el pedido **por preparado** (paso 1) y **captura la guía**
 * (paso 2). Lo que la distingue: 💰 **en un directo, una carta faltante se reembolsa al preparar** con
 * la cifra que calculó el servidor (`refund.amountCents`, `preparation.refundPreviewCents`); en un
 * **retiro** abre un caso «Por reponer» y la guía espera.
 *
 * ⛔ **Ninguna cifra la calcula esta pantalla** (S1, criterio 220): se pinta `refundPreviewCents` tal
 * cual y se manda de vuelta como `expectedRefundCents`. Un `409 REFUND_PREVIEW_STALE` reabre el diálogo
 * con la cifra nueva (S2) — nunca se reintenta solo.
 * **Estado optimista: no** (§36.5): cada marca se pinta cuando el servidor responde.
 */

type Translator = ReturnType<typeof useTranslations>;

const QUEUE_KEY = ['admin-preparation-queue'] as const;

function patchShip(
  qc: QueryClient,
  shipmentId: string,
  patch: (o: ShipPreparationOrderDTO) => ShipPreparationOrderDTO,
) {
  qc.setQueriesData<PreparationOrderDTO[]>({ queryKey: QUEUE_KEY }, (old) =>
    old?.map((o) => (o.destination === 'ship' && o.shipmentId === shipmentId ? patch(o) : o)),
  );
}
function removeShip(qc: QueryClient, shipmentId: string) {
  qc.setQueriesData<PreparationOrderDTO[]>({ queryKey: QUEUE_KEY }, (old) =>
    old?.filter((o) => !(o.destination === 'ship' && o.shipmentId === shipmentId)),
  );
}

interface ShownError {
  text: string;
  offerUnprepare?: boolean;
  retry?: () => void;
  links?: { href: string; label: string }[];
  /**
   * ⭐ v1.80.7: los `details` NORMATIVOS del `403 MONEY_OUT_LIMIT_EXCEEDED` (`{capCents, usedCents,
   * requestedCents}`), tipados y retenidos. ⛔ NO se pintan: el copy de §37.4 va sin cifra hasta que ux-ui
   * lo fije (contrato §M4-SHIP.5 paso 6: «pintar cifras es opcional y el copy lo decide ux-ui»).
   */
  moneyOut?: MoneyOutLimitExceededDetails | null;
}

/**
 * Lee los tres `details` del `403 MONEY_OUT_LIMIT_EXCEEDED` (§0 v1.80.7, normativos: PS-4/PS-4b los aseveran
 * con igualdad exacta). `null` si el cuerpo no trae los tres enteros — la pantalla no inventa cifras.
 */
export function moneyOutLimitDetailsOf(details: Record<string, unknown> | undefined): MoneyOutLimitExceededDetails | null {
  if (!details) return null;
  const { capCents, usedCents, requestedCents } = details as Partial<MoneyOutLimitExceededDetails>;
  if (![capCents, usedCents, requestedCents].every((v) => typeof v === 'number' && Number.isInteger(v))) return null;
  return { capCents: capCents!, usedCents: usedCents!, requestedCents: requestedCents! };
}

/** Una línea `missing` que TODAVÍA no tiene fila ni caso: es lo que el preparado va a mover. */
function isNewMissing(i: ShipPreparationItemDTO): boolean {
  return (
    i.prepStatus === 'missing' &&
    i.availability.kind === 'available' &&
    (i.refund.kind === 'refundable' || i.refund.kind === 'to_replacement' || i.refund.kind === 'not_refundable')
  );
}

export function ShipPreparationCard({
  order,
  locale,
  onNotice,
  onCaptureGuide,
}: {
  order: ShipPreparationOrderDTO;
  locale: AppLocale;
  onNotice: (notice: QueueNotice) => void;
  /** Abre el diálogo de guía de `admin.m4.tracking.*` (uno solo, compartido con la cola de envíos). */
  onCaptureGuide: (order: ShipPreparationOrderDTO) => void;
}) {
  const t = useTranslations('admin.m4.prep');
  const tv = useTranslations('admin.m4.prep.vault');
  const ts = useTranslations('admin.m4.prep.ship');
  const tm4 = useTranslations('admin.m4');
  const tc = useTranslations('common');
  const tInv = useTranslations('status.inventory');
  const tRefund = useTranslations('status.paymentRefund');
  const tShip = useTranslations('status.shipment');
  const tCase = useTranslations('status.replacementCase');
  const getMessage = useErrorMessage('operator');
  const qc = useQueryClient();
  const uid = useId();

  const { shipmentId, preparation } = order;
  // ⭐ §19.20.2 (FS-19): compra pendiente ⇔ `labelPending ≠ null`; alerta de guía del servidor (⛔ sin umbral propio).
  const labelPending = order.labelPending ?? null;
  const labelAlert = order.labelAlert ?? null;
  const sinceOf = useSince();
  const isWithdrawal = order.kind === 'vault_withdrawal';
  const ref = order.orderNumber ?? shipmentId;
  const refId = `prep-ref-${shipmentId}`;
  const step: 'collect' | 'pack' = preparation.status === 'prepared' ? 'pack' : 'collect';
  const openReplacements = preparation.status === 'prepared' ? preparation.openReplacements : 0;
  const refundPreviewCents = preparation.status === 'in_progress' ? preparation.refundPreviewCents : 0;
  const newMissing = order.items.filter(isNewMissing);
  const missingNotRefundable = !isWithdrawal && newMissing.some((i) => i.refund.kind === 'not_refundable');
  const availableItems = order.items.filter((i) => i.availability.kind === 'available');
  const nothingShips = availableItems.length === 0 && order.items.length > 0;
  const allMissing = availableItems.length > 0 && availableItems.every((i) => i.prepStatus === 'missing');
  // Líneas bloqueadas cuyo cobro sigue vivo: el preparado las rechaza (`PREPARATION_HAS_BLOCKED_LINES`).
  // ⛔ No se decide aquí quién está `settled`: se apaga solo lo que el servidor ya rechazó una vez.

  const [busy, setBusy] = useState<{
    itemId: string;
    action: PreparationItemStatus;
  } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, ShownError>>({});
  const [footerError, setFooterError] = useState<ShownError | null>(null);
  const [cardNotice, setCardNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAmount, setConfirmAmount] = useState(0);
  const [unprepareOpen, setUnprepareOpen] = useState(false);
  const [retryBusy, setRetryBusy] = useState<string | null>(null);

  const refetchQueue = () => qc.invalidateQueries({ queryKey: QUEUE_KEY });

  const stepRef = useRef<HTMLParagraphElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current !== step) stepRef.current?.focus();
    prevStep.current = step;
  }, [step]);

  /** El envío salió de la preparación (guía, cancelado…): sale de la lista con su aviso (§37.3b). */
  function goneFromQueue(status: string, verb: 'prepare' | 'undo' | 'mark') {
    const label = status && tShip.has(status) ? tShip(status) : status || DASH;
    const text =
      verb === 'undo'
        ? ts('unprepare.notInPreparation', { status: label })
        : ts('error.notInPreparation', { status: label });
    removeShip(qc, shipmentId);
    onNotice({ role: 'alert', folio: ref, lines: [text] });
    void refetchQueue();
  }

  function commonError(e: unknown, verb: 'prepare' | 'undo' | 'mark', retry: () => void): ShownError | null {
    const err = asApiError(e);
    if (err?.status === 409 && err.code === 'SHIPMENT_NOT_IN_PREPARATION') {
      goneFromQueue(String(err.details?.status ?? ''), verb);
      return null;
    }
    if (err?.status === 409 && err.code === 'CONFLICT') {
      void refetchQueue();
      return { text: ts('error.conflict') };
    }
    if (err?.status === 404) {
      void refetchQueue();
      return { text: ts('error.notFound') };
    }
    return { text: getMessage(e), retry };
  }

  function originRefundedText(details: unknown, key: 'error.originRefunded' | 'tracking.originRefunded'): ShownError {
    const items = ((details as Partial<WithdrawalLineOriginRefundedDetails> | undefined)?.items ?? []).filter(Boolean);
    const named = items.map((i) => {
      const line = order.items.find(
        (x) => x.inventoryItemId === i.inventoryItemId || x.shipmentItemId === i.shipmentItemId,
      );
      return ts('error.originRefundedItem', {
        card: line?.card.name ?? i.folio ?? i.inventoryItemId,
        folio: i.folio ?? line?.folio ?? i.inventoryItemId,
        orderNumber: i.orderNumber ?? i.orderId ?? DASH,
      });
    });
    const text =
      key === 'error.originRefunded'
        ? ts('error.originRefunded', {
            count: Math.max(1, items.length),
            items: named.join('; '),
          })
        : tm4('tracking.originRefunded', {
            count: Math.max(1, items.length),
            items: named.join('; '),
          });
    const links = items
      .filter((i) => i.orderId)
      .map((i) => ({
        href: `/admin/m3/${i.orderId}`,
        label: ts('error.originRefundedLink', {
          orderNumber: i.orderNumber ?? i.orderId!,
        }),
      }));
    return { text, links };
  }

  // ---------- Palomear (§37.3b) ----------
  const mark = useMutation({
    mutationFn: (v: { itemId: string; status: PreparationItemStatus; missingReason?: MissingReason }) =>
      setShipPrepItem(shipmentId, v.itemId, v.status, v.missingReason),
    onMutate: (v) => {
      setBusy({ itemId: v.itemId, action: v.status });
      setRowErrors((r) => {
        const next = { ...r };
        delete next[v.itemId];
        return next;
      });
      setCardNotice(null);
    },
    onSuccess: (res) => {
      patchShip(qc, shipmentId, (o) => ({
        ...o,
        preparation: res.preparation,
        items: o.items.map((i) => (i.shipmentItemId === res.item.shipmentItemId ? res.item : i)),
      }));
    },
    onError: (e, v) => {
      const err = asApiError(e);
      let shown: ShownError | null;
      if (err?.status === 409 && err.code === 'PREP_ITEM_BLOCKED') {
        const pieceStatus = String(err.details?.pieceStatus ?? '');
        const why =
          pieceStatus && tInv.has(pieceStatus) ? ` ${ts('item.blockedBody', { status: tInv(pieceStatus) })}` : '';
        shown = { text: `${ts('error.itemBlocked')}${why}` };
        void refetchQueue();
      } else if (err?.status === 409 && err.code === 'PREPARATION_CLOSED') {
        shown = { text: ts('error.closed'), offerUnprepare: true };
        void refetchQueue();
      } else if (err?.status === 409 && err.code === 'PREP_ITEM_REFUNDED') {
        shown = { text: ts('item.refundedLocked', { status: DASH }) };
        void refetchQueue();
      } else if (err?.status === 409 && err.code === 'PREP_ITEM_IN_REPLACEMENT') {
        const status = String(err.details?.status ?? '');
        shown = {
          text: ts('item.caseLocked', {
            status: status && tCase.has(status) ? tCase(status) : status || DASH,
          }),
        };
        void refetchQueue();
      } else {
        shown = commonError(e, 'mark', () => mark.mutate(v));
      }
      if (shown) setRowErrors((r) => ({ ...r, [v.itemId]: shown }));
    },
    onSettled: () => setBusy(null),
  });

  // ---------- Pedido preparado (§37.4) ----------
  const prepare = useMutation({
    mutationFn: (expectedRefundCents: number) => prepareShipment(shipmentId, expectedRefundCents),
    onMutate: () => {
      setFooterError(null);
      setCardNotice(null);
    },
    onSuccess: (res) => {
      setConfirmOpen(false);
      setRowErrors({});
      if (res.outcome === 'already_prepared') {
        patchShip(qc, shipmentId, (o) => ({
          ...o,
          preparation: res.preparation,
        }));
        return;
      }
      const lines: string[] = [];
      let role: QueueNotice['role'] = 'status';
      if (res.outcome === 'closed_nothing_to_ship') {
        const amount = res.refunds.reduce((s, r) => s + r.amountCents, 0);
        lines.push(
          ts('result.closed', {
            folio: ref,
            amount: formatMoneyCents(amount, locale),
          }),
        );
        removeShip(qc, shipmentId);
      } else {
        if (res.cases.length > 0) {
          lines.push(ts('result.preparedCases', { ref, count: res.cases.length }));
        } else if (res.refunds.length > 0) {
          const amount = res.refunds.reduce((s, r) => s + r.amountCents, 0);
          const stripeState = res.refunds.some((r) => r.status === 'requested') ? 'requested' : 'submitted';
          lines.push(
            ts('result.preparedRefund', {
              folio: ref,
              amount: formatMoneyCents(amount, locale),
              stripeState,
              count: res.refunds.filter((r) => r.kind === 'item_missing').length,
            }),
          );
        } else {
          lines.push(ts('result.prepared', { folio: ref }));
        }
        const failed = res.refunds.filter((r) => r.status === 'failed');
        if (failed.length > 0) {
          role = 'alert';
          lines.push(
            ts('result.refundFailed', {
              amount: formatMoneyCents(
                failed.reduce((s, r) => s + r.amountCents, 0),
                locale,
              ),
            }),
          );
        }
        patchShip(qc, shipmentId, (o) => ({
          ...o,
          preparation: res.preparation,
        }));
      }
      // Un preparado SIN dinero ni casos no manda aviso a la cola: el paso cambia y recibe el foco (§36.12,
      // mismo trato que la tarjeta de bóveda); el aviso —que se lleva el foco— es para lo que mueve dinero o abre casos.
      const plainPrepared = res.outcome === 'prepared' && res.refunds.length === 0 && res.cases.length === 0;
      if (!plainPrepared) onNotice({ role, folio: ref, lines });
      void refetchQueue();
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'REFUND_PREVIEW_STALE') {
        // S2: se enseña la cifra nueva y se vuelve a pedir la confirmación; ⛔ nunca se reintenta solo.
        const refundCents = Number(err.details?.refundCents ?? 0);
        setConfirmAmount(refundCents);
        setConfirmOpen(true);
        setFooterError({
          text: ts('error.previewStale', {
            amount: formatMoneyCents(refundCents, locale),
          }),
        });
        void refetchQueue();
        return;
      }
      setConfirmOpen(false);
      if (err?.status === 409 && err.code === 'PREPARATION_INCOMPLETE') {
        setFooterError({
          text: ts('error.incomplete', {
            pendingCount: Number(err.details?.pendingCount ?? 0),
          }),
        });
        void refetchQueue();
        return;
      }
      if (err?.status === 403 && err.code === 'MONEY_OUT_LIMIT_EXCEEDED') {
        // §37.4: sin cifra (el tope es un dial). Los `details` viajan tipados por si ux-ui decide pintarlos.
        setFooterError({ text: ts('error.limitExceeded'), moneyOut: moneyOutLimitDetailsOf(err.details) });
        return;
      }
      if (err?.status === 409 && err.code === 'REFUND_NOT_AVAILABLE') {
        const lines = (err.details as Partial<RefundNotAvailableDetails> | undefined)?.lines ?? [];
        const reasons = Array.from(new Set(lines.map((l) => l.reason)))
          .map((r) => (ts.has(`item.notRefundable.${r}`) ? ts(`item.notRefundable.${r}`) : r))
          .join(' ');
        setFooterError({
          text: ts('error.refundNotAvailable', {
            count: Math.max(1, lines.length),
            reason: reasons || DASH,
          }),
        });
        return;
      }
      if (err?.status === 409 && err.code === 'PREPARATION_HAS_BLOCKED_LINES') {
        const lines = (err.details?.lines as unknown[] | undefined) ?? [];
        setFooterError({
          text: ts('error.blockedLines', { count: Math.max(1, lines.length) }),
        });
        return;
      }
      if (err?.status === 409 && err.code === 'ORDER_NOT_SETTLED') {
        const status = String(err.details?.orderStatus ?? '');
        removeShip(qc, shipmentId);
        onNotice({
          role: 'alert',
          folio: ref,
          lines: [ts('error.orderNotSettled', { status: status || DASH })],
        });
        void refetchQueue();
        return;
      }
      if (err?.status === 409 && err.code === 'WITHDRAWAL_LINE_ORIGIN_REFUNDED') {
        setFooterError(originRefundedText(err.details, 'error.originRefunded'));
        return;
      }
      const shown = commonError(e, 'prepare', () => prepare.mutate(confirmAmount));
      if (shown) setFooterError(shown);
    },
  });

  function onPrepareClick() {
    if (missingNotRefundable) return;
    const needsDialog = refundPreviewCents > 0 || (isWithdrawal && newMissing.length > 0);
    if (!needsDialog) {
      prepare.mutate(0);
      return;
    }
    setConfirmAmount(refundPreviewCents);
    setConfirmOpen(true);
  }

  // ---------- Deshacer preparado (§37.5) ----------
  const unprepare = useMutation({
    mutationFn: () => unprepareShipment(shipmentId),
    onMutate: () => {
      setFooterError(null);
      setCardNotice(null);
    },
    onSuccess: (res) => {
      setUnprepareOpen(false);
      setRowErrors({});
      patchShip(qc, shipmentId, (o) => ({
        ...o,
        preparation: res.preparation,
      }));
      setCardNotice(res.outcome === 'unprepared' ? ts('unprepare.done') : ts('unprepare.alreadyUndone'));
      const reclaimed = res.reclaimed?.reduce((n, r) => n + r.inventoryItemIds.length, 0) ?? 0;
      if (reclaimed > 0) {
        onNotice({
          role: 'status',
          folio: ref,
          lines: [ts('unprepare.done'), ts('result.reclaimed', { count: reclaimed })],
        });
      }
      void refetchQueue();
    },
    onError: (e) => {
      setUnprepareOpen(false);
      const shown = commonError(e, 'undo', () => unprepare.mutate());
      if (shown) setFooterError(shown);
    },
  });

  // ---------- Reintentar reembolso atorado (§37.4) ----------
  const retry = useMutation({
    mutationFn: (refundId: string) => retryRefund(refundId),
    onMutate: (refundId) => setRetryBusy(refundId),
    onSuccess: () => void refetchQueue(),
    onError: (e, refundId) => {
      const err = asApiError(e);
      const item = order.items.find((i) => i.refund.kind === 'refunded' && i.refund.refund.id === refundId);
      let text: string;
      if (err?.status === 409 && err.code === 'REFUND_NOT_RETRYABLE') {
        const status = String(err.details?.status ?? '');
        text = ts('retry.notRetryable', {
          status: status && tRefund.has(status) ? tRefund(status) : status || DASH,
        });
        void refetchQueue();
      } else if (err?.status === 409 && err.code === 'REFUND_ATTEMPT_IN_PROGRESS') text = ts('retry.inProgress');
      else if (err?.status === 403) text = ts('retry.forbidden');
      else text = getMessage(e);
      if (item) setRowErrors((r) => ({ ...r, [item.shipmentItemId]: { text } }));
      else setFooterError({ text });
    },
    onSettled: () => setRetryBusy(null),
  });

  const cardNameId = (itemId: string) => `${uid}-card-${itemId}`;
  const prepareReasonId = `${uid}-prepare-reason`;
  const guideReasonId = `${uid}-guide-reason`;
  const fullNameMissing = order.customer.fullName === null || order.customer.fullName.trim() === '';
  const fullName = order.customer.fullName?.trim() ?? '';
  const lastName = order.customer.lastName?.trim();
  const shipTo = order.shipTo;
  const openCaseIds = order.items
    .map((i) => (i.refund.kind === 'replacement' && i.refund.case.status === 'open' ? i.refund.case.id : null))
    .filter((x): x is string => x !== null);
  const replaceHref = openCaseIds.length === 1 ? `/admin/m4/reponer/${openCaseIds[0]}` : '/admin/m4?tab=reponer';

  return (
    <article
      data-testid={`prep-order-${shipmentId}`}
      data-kind={order.kind}
      aria-labelledby={refId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-1.5">
          <Badge tone="primary" shape="outline">
            {t('destination.ship')}
          </Badge>
          <div className="flex flex-wrap items-baseline gap-2">
            {order.orderNumber ? (
              <span id={refId} className="tabular text-lg font-semibold text-text">
                {order.orderNumber}
              </span>
            ) : (
              <span id={refId} className="font-serif text-lg text-text">
                {t('withdrawal')}
              </span>
            )}
            <span className={LABEL}>
              {t('shipmentRef')} <span className="tabular">{shipmentId}</span>
            </span>
            {order.orderId && (
              <Link
                href={`/admin/m3/${order.orderId}`}
                className="text-sm text-text underline underline-offset-4 hover:text-accent print:hidden"
              >
                {tm4('viewOrder')}
              </Link>
            )}
          </div>
        </div>
        <AgeStamp iso={order.requestedAt} locale={locale} t={t} />
      </header>

      {/* Plano 1 · quién (§35.6 / §35.6a): el COMPRADOR (v1.80), con el correo como segunda línea. */}
      <div data-testid={`prep-customer-${shipmentId}`} className="flex flex-col gap-0.5">
        {lastName ? (
          <p className="font-serif text-2xl leading-tight text-text">{lastName}</p>
        ) : (
          !fullNameMissing && <p className={cn(TAG, 'text-muted')}>{t('lastNameUnknown')}</p>
        )}
        {fullNameMissing ? (
          <div data-testid={`prep-fullname-missing-${shipmentId}`} className="flex flex-col gap-0.5">
            <p className={cn(TAG, 'text-accent')}>{t('nameMissing.tag')}</p>{' '}
            <p className="text-sm text-text">{t('nameMissing.body')}</p>
          </div>
        ) : (
          <p className="text-sm text-text">{fullName}</p>
        )}
        {order.customer.email && <p className="text-sm text-muted print:hidden">{order.customer.email}</p>}
      </div>

      {/* Plano 2 · a dónde (§35.5): la dirección se transcribe a mano ⇒ nunca en `muted`. */}
      <div data-testid={`prep-address-${shipmentId}`} className="flex flex-col gap-1 text-sm text-text">
        {shipTo.recipientName && (
          <p>
            <span className={LABEL}>{tm4('recipient')}</span> <span>{shipTo.recipientName}</span>
          </p>
        )}
        <p>
          {[shipTo.line1, shipTo.line2, shipTo.neighborhood]
            .map((p) => p?.trim())
            .filter((p): p is string => Boolean(p))
            .join(', ') || DASH}
        </p>
        <p>
          {shipTo.city}, {shipTo.state} · <span className={LABEL}>{tm4('postalCode')}</span>{' '}
          <span className="tabular">{shipTo.postalCode}</span> · {shipTo.country}
        </p>
        <p className="print:hidden">
          <span className={LABEL}>{tm4('phone')}</span> <span className="tabular">{shipTo.phone}</span>
        </p>
        {/* ⭐ §43.8a (FS-20): la dirección del ENVÍO se corrigió en «Capturar guía»; sin `print:hidden` (sirve en la hoja). */}
        {shipTo.addressCorrected && (
          <p data-testid={`prep-address-corrected-${shipmentId}`} className={cn(TAG, 'text-muted')}>
            {ts('addressCorrected')}
          </p>
        )}
      </div>

      {/* Plano 3 · paso actual y conteo (§37.3a / §37.3c). */}
      <div className="flex flex-col gap-1 border-t border-border pt-3 print:hidden">
        <p
          ref={stepRef}
          tabIndex={-1}
          data-testid={`ship-step-${shipmentId}`}
          className={cn(
            TAG,
            openReplacements > 0 || nothingShips ? 'text-accent' : 'text-muted',
            'outline-none focus-visible:shadow-focus',
          )}
        >
          {step === 'collect'
            ? nothingShips
              ? ts('step.nothingToShip')
              : ts('step.collect')
            : openReplacements > 0
              ? ts('step.waiting', { count: openReplacements })
              : ts('step.pack')}
        </p>
        <div role="status" aria-live="polite" data-testid={`ship-live-${shipmentId}`} className="flex flex-col gap-1">
          <p className="tabular text-sm text-text">
            {ts('count', {
              picked: preparation.picked,
              missing: preparation.missing,
              pending: preparation.pending,
            })}
            {preparation.blocked > 0 && <> {ts('countBlocked', { blocked: preparation.blocked })}</>}
          </p>
          {step === 'collect' && nothingShips && refundPreviewCents > 0 && (
            <p className="text-sm text-text">
              {ts('step.nothingToShipBody', {
                amount: formatMoneyCents(refundPreviewCents, locale),
              })}
            </p>
          )}
          {step === 'collect' && !isWithdrawal && refundPreviewCents > 0 && !nothingShips && (
            <p className="tabular text-sm text-text" data-testid={`ship-refund-preview-${shipmentId}`}>
              {ts('countRefund', {
                amount: formatMoneyCents(refundPreviewCents, locale),
              })}
            </p>
          )}
          {preparation.status === 'prepared' && (
            <p className="text-sm text-text">
              {preparation.preparedBy.name?.trim()
                ? ts('prepared.by', {
                    name: preparation.preparedBy.name.trim(),
                    date: formatDateTimeMx(preparation.preparedAt, locale),
                  })
                : ts('prepared.byNoName', {
                    date: formatDateTimeMx(preparation.preparedAt, locale),
                  })}
            </p>
          )}
          {cardNotice && <p className="text-sm text-text">{cardNotice}</p>}
        </div>
        {/* ⭐ §43.8a: la compra pendiente con su estado — «en proceso» (creada) ≠ «sin confirmar» (no sabemos). */}
        {labelPending && (
          <p data-testid={`ship-label-pending-${shipmentId}`} className={cn(TAG, 'text-muted')}>
            {labelPending.state === 'in_flight'
              ? labelPending.carrierLabel
                ? ts('guide.inFlight', { carrier: labelPending.carrierLabel, time: sinceOf(labelPending.since) })
                : ts('guide.inFlightNoCarrier', { time: sinceOf(labelPending.since) })
              : labelPending.carrierLabel
                ? ts('guide.processing', { carrier: labelPending.carrierLabel, time: sinceOf(labelPending.since) })
                : ts('guide.processingNoCarrier', { time: sinceOf(labelPending.since) })}
          </p>
        )}
        {/* ⭐ §43.8c: la alerta de guía, donde llegue y sin filtrar por estado. */}
        {labelAlert && (
          <LabelAlertBlock shipmentId={shipmentId} alert={labelAlert} refText={ref} trackingNumber={null} testId={`ship-label-alert-${shipmentId}`} />
        )}
      </div>

      {/* Plano 4 · las cartas por ubicación (§35.4), cada una con su marca y su línea de dinero. */}
      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <p className={LABEL}>{t('itemCount', { count: order.items.length })}</p>
        <ul className="flex flex-col gap-3">
          {sortPreparationItems(order.items).map((item) => (
            <ShipItemRow
              key={item.shipmentItemId}
              item={item}
              isWithdrawal={isWithdrawal}
              // ⛔⛔ «Ubicar» (hueco 1, arreglos-operador) SOLO en ENVÍO DIRECTO (`orderId !== null` ⇒ pieza de
              // la plataforma vendida). En un RETIRO DE BÓVEDA la carta es DEL CLIENTE (`in_custody`, cajón
              // `customer_custody`): moverla al estante rompe §M4-VAULT. `orderId` es el discriminador del
              // contrato (§M4-PREP: «null en un RETIRO DE BÓVEDA»); `kind` se exige además por redundancia.
              // Candado: M4View.operator-gaps.test.tsx.
              canLocate={!isWithdrawal && order.orderId !== null}
              editable={step === 'collect'}
              busy={busy?.itemId === item.shipmentItemId ? busy.action : null}
              retryBusy={retryBusy}
              error={rowErrors[item.shipmentItemId] ?? null}
              nameId={cardNameId(item.shipmentItemId)}
              locale={locale}
              onMark={(status, missingReason) =>
                mark.mutate({
                  itemId: item.shipmentItemId,
                  status,
                  missingReason,
                })
              }
              onUnprepare={() => setUnprepareOpen(true)}
              onRetry={(refundId) => retry.mutate(refundId)}
              t={t}
              tv={tv}
              ts={ts}
              tc={tc}
              tInv={tInv}
              tRefund={tRefund}
              tCase={tCase}
            />
          ))}
        </ul>
      </div>

      {/* Plano 5 · pie de acción: una acción principal por paso (V5). */}
      <div
        data-testid={`ship-footer-${shipmentId}`}
        className="flex flex-col gap-3 border-t border-border pt-3 print:hidden"
      >
        {step === 'collect' ? (
          <>
            {!isWithdrawal && allMissing && preparation.pending === 0 && (
              <p className="text-sm text-text">{ts('confirmRefund.bodyNothingShips')}</p>
            )}
            <Button
              variant="primary"
              className="self-start sm:min-h-[44px]"
              disabled={preparation.pending > 0 || missingNotRefundable}
              loading={prepare.isPending}
              aria-describedby={preparation.pending > 0 || missingNotRefundable ? prepareReasonId : undefined}
              onClick={onPrepareClick}
            >
              {prepare.isPending ? ts('prepare.saving') : ts('prepare.cta')}
            </Button>
            {preparation.pending > 0 ? (
              <p id={prepareReasonId} className="text-sm text-text">
                {ts('prepare.pending', { pending: preparation.pending })}
              </p>
            ) : missingNotRefundable ? (
              <p id={prepareReasonId} className="text-sm text-text">
                {ts('prepare.notRefundable')}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
            {/* §43.8a: «Deshacer preparado» NO se pinta con una compra de guía pendiente (otra carrera). */}
            {labelPending ? (
              <span />
            ) : (
              <Button
                variant="ghost"
                className="self-start sm:min-h-[44px]"
                disabled={unprepare.isPending}
                onClick={() => setUnprepareOpen(true)}
              >
                {ts('unprepare.cta')}
              </Button>
            )}
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <Button
                variant="primary"
                className="sm:min-h-[44px]"
                disabled={openReplacements > 0}
                aria-describedby={openReplacements > 0 ? guideReasonId : undefined}
                onClick={() => onCaptureGuide(order)}
              >
                {labelPending ? (labelPending.state === 'in_flight' ? ts('guide.viewInFlight') : ts('guide.viewProcessing')) : ts('guide.cta')}
              </Button>
              {openReplacements > 0 && (
                <p id={guideReasonId} className="text-sm text-text sm:text-right">
                  {ts('guide.waiting', { count: openReplacements })}{' '}
                  <Link href={replaceHref} className="underline underline-offset-4 hover:text-accent">
                    {tm4('tracking.goToReplace')}
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}
        {footerError && <ErrorLine error={footerError} tc={tc} />}
      </div>

      <PrepareDialog
        open={confirmOpen}
        isWithdrawal={isWithdrawal}
        amountCents={confirmAmount}
        lines={newMissing}
        nothingShips={!isWithdrawal ? allMissing || nothingShips : nothingShips}
        pending={prepare.isPending}
        locale={locale}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => prepare.mutate(confirmAmount)}
        ts={ts}
      />
      <UnprepareDialog
        open={unprepareOpen}
        pending={unprepare.isPending}
        onCancel={() => setUnprepareOpen(false)}
        onConfirm={() => unprepare.mutate()}
        ts={ts}
      />
    </article>
  );
}

function ErrorLine({ error, tc }: { error: ShownError; tc: Translator }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text">
      <p>{error.text}</p>
      {error.links?.map((l) => (
        <Link key={l.href} href={l.href} className="underline underline-offset-4 hover:text-accent">
          {l.label}
        </Link>
      ))}
      {error.retry && (
        <Button size="sm" variant="secondary" className="sm:min-h-[44px]" onClick={error.retry}>
          {tc('retry')}
        </Button>
      )}
    </div>
  );
}

function ShipItemRow({
  item,
  isWithdrawal,
  canLocate,
  editable,
  busy,
  retryBusy,
  error,
  nameId,
  locale,
  onMark,
  onUnprepare,
  onRetry,
  t,
  tv,
  ts,
  tc,
  tInv,
  tRefund,
  tCase,
}: {
  item: ShipPreparationItemDTO;
  isWithdrawal: boolean;
  canLocate: boolean;
  editable: boolean;
  busy: PreparationItemStatus | null;
  retryBusy: string | null;
  error: ShownError | null;
  nameId: string;
  locale: AppLocale;
  onMark: (status: PreparationItemStatus, missingReason?: MissingReason) => void;
  onUnprepare: () => void;
  onRetry: (refundId: string) => void;
  t: Translator;
  tv: Translator;
  ts: Translator;
  tc: Translator;
  tInv: Translator;
  tRefund: Translator;
  tCase: Translator;
}) {
  const blocked = item.availability.kind === 'blocked';
  // Una línea reembolsada o con caso es FIJA (§37.3b): sin «Deshacer».
  const locked = item.refund.kind === 'refunded' || item.refund.kind === 'replacement';
  const aria = (action: string) => tv('item.actionAria', { action, card: item.card.name, folio: item.folio });
  const anyBusy = busy !== null;
  const status = blocked ? 'blocked' : item.prepStatus;
  const located = item.currentLocation.kind === 'assigned';

  return (
    <li
      data-testid={`prep-item-${item.shipmentItemId}`}
      data-prep-status={status}
      className={cn(
        // PR-3 (§35.4): la columna de ubicación es el PRIMER hijo del renglón y ⛔ ninguna utilidad `order-*`
        // la mueve; el resto de la carta (estado, dinero, error) vive en la columna de contenido.
        'flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:gap-4',
        !blocked && item.prepStatus === 'picked' && 'border-l-2 border-l-text pl-3',
        !blocked && item.prepStatus === 'missing' && 'border-l-2 border-l-accent pl-3',
      )}
    >
      <div data-testid={`prep-location-${item.shipmentItemId}`} className="flex shrink-0 flex-col gap-0.5 sm:w-32">
        <span className={LABEL}>{t('location')}</span>
        {located ? (
          <span className="tabular text-sm text-text">
            {item.currentLocation.kind === 'assigned' ? item.currentLocation.label : ''}
          </span>
        ) : (
          <span className="text-sm text-accent">{t('unassigned')}</span>
        )}
        {/* Hueco 1 (2026-09-29): ubicar o corregir la ubicación de la carta VENDIDA desde aquí.
            Solo envío directo — en un retiro la carta es del cliente (ver `canLocate`). */}
        {canLocate && (
          <div className="mt-1 print:hidden">
            <LocateItemControl item={item} />
          </div>
        )}
      </div>

      {/* Controles: tres botones en pendiente (§37.3b); «Deshacer» salvo fila fija. En `< sm`, «La
            tengo» ocupa la primera fila y los otros dos comparten la segunda. */}
      {editable && !blocked && !locked && (
        <div
          role="group"
          aria-labelledby={nameId}
          className="order-last flex flex-wrap gap-2 sm:order-none sm:w-44 sm:shrink-0 sm:flex-col print:hidden"
        >
          {item.prepStatus === 'pending' ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="min-h-[44px] basis-full sm:min-h-[44px] sm:basis-auto"
                aria-label={aria(tv('item.pick'))}
                loading={busy === 'picked'}
                disabled={anyBusy && busy !== 'picked'}
                onClick={() => onMark('picked')}
              >
                {tv('item.pick')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-[44px] flex-1 sm:min-h-[44px] sm:flex-none"
                aria-label={aria(tv('item.miss'))}
                loading={busy === 'missing' && item.missingReason !== 'damaged'}
                disabled={anyBusy && busy !== 'missing'}
                onClick={() => onMark('missing', 'not_found')}
              >
                {tv('item.miss')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-[44px] flex-1 sm:min-h-[44px] sm:flex-none"
                aria-label={aria(ts('item.damaged'))}
                disabled={anyBusy}
                onClick={() => onMark('missing', 'damaged')}
              >
                {ts('item.damaged')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[44px] sm:min-h-[44px]"
              aria-label={aria(tv('item.undo'))}
              loading={busy === 'pending'}
              onClick={() => onMark('pending')}
            >
              {tv('item.undo')}
            </Button>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 gap-3">
          <CardInfo card={item.card} folio={item.folio} quantity={item.quantity} nameId={nameId} t={t} />
        </div>

        {/* Estado en palabras (§37.3b) y la línea de dinero (§37.3c). */}
        {blocked ? (
          <div className="flex flex-col gap-0.5">
            <p className={cn(TAG, 'text-muted')}>{ts('item.blocked')}</p>{' '}
            <p className="text-sm text-text">
              {ts('item.blockedBody', {
                status:
                  item.availability.kind === 'blocked' && tInv.has(item.availability.pieceStatus)
                    ? tInv(item.availability.pieceStatus)
                    : item.availability.kind === 'blocked'
                      ? item.availability.pieceStatus
                      : DASH,
              })}
            </p>
          </div>
        ) : item.prepStatus === 'picked' ? (
          <p className={cn(TAG, 'text-text')}>{tv('item.picked')}</p>
        ) : item.prepStatus === 'missing' ? (
          <div className="flex flex-col gap-0.5">
            <p className={cn(TAG, 'text-accent')}>
              {item.missingReason === 'damaged' ? ts('item.damagedTag') : tv('item.missing')}
            </p>{' '}
            {isWithdrawal && item.refund.kind === 'to_replacement' && (
              <p className="text-sm text-text">{ts('item.toReplacement')}</p>
            )}
          </div>
        ) : null}

        <RefundLine
          item={item}
          locale={locale}
          retryBusy={retryBusy}
          onRetry={onRetry}
          ts={ts}
          tRefund={tRefund}
          tCase={tCase}
        />

        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text">
            <p>{error.text}</p>
            {error.offerUnprepare && (
              <Button size="sm" variant="ghost" className="min-h-[44px] sm:min-h-[44px]" onClick={onUnprepare}>
                {ts('unprepare.cta')}
              </Button>
            )}
            {error.retry && (
              <Button size="sm" variant="secondary" className="min-h-[44px] sm:min-h-[44px]" onClick={error.retry}>
                {tc('retry')}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** La línea de dinero por carta (§37.3c) — texto del servidor; esta pantalla no produce cifras. */
function RefundLine({
  item,
  locale,
  retryBusy,
  onRetry,
  ts,
  tRefund,
  tCase,
}: {
  item: ShipPreparationItemDTO;
  locale: AppLocale;
  retryBusy: string | null;
  onRetry: (refundId: string) => void;
  ts: Translator;
  tRefund: Translator;
  tCase: Translator;
}) {
  const r = item.refund;
  if (r.kind === 'refundable') {
    if (item.prepStatus !== 'missing' || item.availability.kind === 'blocked') return null;
    return (
      <p className="text-sm text-text print:hidden" data-testid={`ship-refund-line-${item.shipmentItemId}`}>
        {ts('item.refundPreview', {
          amount: formatMoneyCents(r.amountCents, locale),
        })}
      </p>
    );
  }
  if (r.kind === 'not_refundable') {
    if (item.prepStatus !== 'missing') return null;
    return (
      <p className="text-sm text-text print:hidden" data-testid={`ship-refund-line-${item.shipmentItemId}`}>
        {ts(`item.notRefundable.${r.reason}`)}
      </p>
    );
  }
  if (r.kind === 'refunded') {
    const f = r.refund;
    const amount = formatMoneyCents(f.amountCents, locale);
    const name = f.requestedBy.name?.trim() || ts('item.noName');
    return (
      <div
        className="flex flex-col items-start gap-1 print:hidden"
        data-testid={`ship-refund-line-${item.shipmentItemId}`}
      >
        {f.status === 'requested' && (
          <>
            <p className="tabular text-sm text-text">
              {ts('item.refundRequested', {
                amount,
                name,
                date: formatDateTimeMx(f.requestedAt, locale),
              })}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[44px] sm:min-h-[44px]"
              loading={retryBusy === f.id}
              onClick={() => onRetry(f.id)}
            >
              {ts('retry.cta')}
            </Button>
          </>
        )}
        {(f.status === 'submitted' || f.status === 'succeeded') && (
          <p className="tabular text-sm text-text">
            {ts('item.refundDone', {
              amount,
              date: formatDateTimeMx(f.succeededAt ?? f.submittedAt ?? f.requestedAt, locale),
            })}
          </p>
        )}
        {f.status === 'failed' && <p className="tabular text-sm text-accent">{ts('item.refundFailed', { amount })}</p>}
        <p className="text-sm text-text">{ts('item.refundedLocked', { status: tRefund(f.status) })}</p>
      </div>
    );
  }
  if (r.kind === 'replacement') {
    const c = r.case;
    const statusText =
      c.status === 'replaced'
        ? ts('item.replacementStatus.replaced', {
            folio: c.replacement?.folio ?? DASH,
          })
        : ts(`item.replacementStatus.${c.status}`);
    return (
      <p className="text-sm text-text print:hidden" data-testid={`ship-refund-line-${item.shipmentItemId}`}>
        <Link href={`/admin/m4/reponer/${c.id}`} className="underline underline-offset-4 hover:text-accent">
          {ts('item.replacementLink')}
        </Link>{' '}
        {statusText}
        {' · '}
        {ts('item.caseLocked', { status: tCase(c.status) })}
      </p>
    );
  }
  return null;
}

/**
 * §37.4 — el diálogo de «Pedido preparado» con consecuencias: 💰 la cifra del servidor en el botón
 * (directo) o los casos que se abren (retiro). Botones neutros, foco inicial en «Cancelar».
 */
function PrepareDialog({
  open,
  isWithdrawal,
  amountCents,
  lines,
  nothingShips,
  pending,
  locale,
  onCancel,
  onConfirm,
  ts,
}: {
  open: boolean;
  isWithdrawal: boolean;
  amountCents: number;
  lines: ShipPreparationItemDTO[];
  nothingShips: boolean;
  pending: boolean;
  locale: AppLocale;
  onCancel: () => void;
  onConfirm: () => void;
  ts: Translator;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  const amount = formatMoneyCents(amountCents, locale);
  const casesMode = isWithdrawal && amountCents === 0;
  const title = casesMode ? ts('confirmCases.title', { count: lines.length }) : ts('confirmRefund.title', { amount });
  const reasonOf = (i: ShipPreparationItemDTO) => ts(`confirmRefund.reason.${i.missingReason ?? 'not_found'}`);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" className="sm:min-h-[44px]" onClick={onCancel}>
            {ts('confirmRefund.cancel')}
          </Button>
          <Button
            variant="secondary"
            className="sm:min-h-[44px]"
            loading={pending}
            onClick={onConfirm}
            data-testid="ship-prepare-confirm"
          >
            {casesMode ? ts('confirmCases.confirm') : ts('confirmRefund.confirm', { amount })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-text">
        {lines.length > 0 && (
          <ul className="flex flex-col gap-1">
            {lines.map((i) => (
              <li key={i.shipmentItemId} className="tabular" lang="en">
                {casesMode || i.refund.kind !== 'refundable'
                  ? ts('confirmCases.line', {
                      card: i.card.name,
                      folio: i.folio,
                      reason: reasonOf(i),
                    })
                  : ts('confirmRefund.line', {
                      card: i.card.name,
                      folio: i.folio,
                      reason: reasonOf(i),
                      amount: formatMoneyCents(i.refund.amountCents, locale),
                    })}
              </li>
            ))}
          </ul>
        )}
        {casesMode ? (
          <p>{ts('confirmCases.body')}</p>
        ) : (
          <>
            <p>{nothingShips ? ts('confirmRefund.bodyNothingShips') : ts('confirmRefund.body')}</p>
            <p className="text-muted">{ts('confirmRefund.signature')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function UnprepareDialog({
  open,
  pending,
  onCancel,
  onConfirm,
  ts,
}: {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  ts: Translator;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={ts('unprepare.title')}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" className="sm:min-h-[44px]" onClick={onCancel}>
            {ts('unprepare.cancel')}
          </Button>
          <Button variant="secondary" className="sm:min-h-[44px]" loading={pending} onClick={onConfirm}>
            {ts('unprepare.confirm')}
          </Button>
        </>
      }
    >
      <p>{ts('unprepare.body')}</p>
    </Modal>
  );
}
