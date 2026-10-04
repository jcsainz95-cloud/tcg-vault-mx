import { ApiClientError } from '@/lib/api-client';
import type { ShipmentAddressMissingField, ShipmentQuoteDTO, WithdrawalLineOriginRefundedDetails } from '@/types/contract';

/**
 * **Un copy por `error.code`** de la ventana «Capturar guía» (`DESIGN_SYSTEM §43.7`, SK5 y SK6).
 *
 * ⛔ Nunca se ramifica por el `status` solo (UX-SDX-12): el código y sus `details` (`missing`, `reason`,
 * `op`, `labelSource`, `required`…) eligen el texto y el remedio. El `status` solo distingue el caso que
 * el contrato define por status: **«la compra no sabemos si ocurrió»** (`5xx` o error de red en
 * `POST …/label`, §19.20.5), que no tiene texto propio aquí porque NO se decide por el error sino por la
 * RELECTURA del envío (`unknownOutcome`).
 *
 * Función pura (sin React): devuelve QUÉ se ve y QUÉ hace la ventana; la ventana lo aplica.
 */

export type SdxOp = 'quote' | 'label';

/** Lo que la ventana hace después de pintar el error. */
export type SdxErrorEffect =
  | { kind: 'none' }
  /** La compra quizá ocurrió: relee el envío y decide por `label`/`labelPending` (SK5). */
  | { kind: 'unknownOutcome'; edgeBlocked: boolean }
  /**
   * Quita el botón de compra (como `canPurchase=false`). `banner` ⇒ el texto va en un `Banner` (la negativa por tope,
   * §43.19.1) y el sitio del botón queda vacío; sin él, la frase ocupa el sitio del botón.
   */
  | { kind: 'blockPurchase'; banner?: boolean }
  /**
   * 💰 `409 purchase_in_flight` (§43.19.2): se queda en el paso 3 con el botón pintado y DESHABILITADO hasta que pasen
   * `seconds` (los da el servidor; ⛔ la pantalla no los calcula ni los alarga). ⛔ Al llegar a 0 no compra sola.
   */
  | { kind: 'waitRetry'; seconds: number; folio: string | null }
  /** 💰 `409 provider_id_taken`: relee ⇒ paso 4 (el reclamo se conserva) con el texto encima de «Verificando». */
  | { kind: 'toPendingConflict' }
  /** `409 stale_purchase_response`: relee y decide por el estado (mismo camino que SK5) con el texto como `info`. */
  | { kind: 'rereadDecide' }
  /** Vuelve al paso 2 con la cotización que trajo el error (`QUOTE_EXPIRED`, rechazo con `quote`). */
  | { kind: 'toOptions'; quote: ShipmentQuoteDTO | null; reread: boolean }
  /** `LABEL_PREVIEW_STALE`: el paso 3 se repinta con las cifras del servidor. */
  | { kind: 'repaintStale'; priceCents: number; marginCents: number }
  /** `LABEL_CONFIRMATION_REQUIRED`: pinta los avisos que pidió el servidor. */
  | { kind: 'repaintConfirm'; negativeMargin: boolean; branchDelivery: boolean }
  /** `SHIPMENT_ADDRESS_INCOMPLETE` sin teléfono: paso 1 en modo corregir con foco en el primer `missing`. */
  | { kind: 'toAddressEdit'; missing: ShipmentAddressMissingField[] }
  /** `409 CONFLICT` en la compra: relee y vuelve al paso 1. */
  | { kind: 'rereadToAddress' }
  /** `LABEL_IN_PROGRESS`: pasa al paso 4 (relee para saber en qué estado). */
  | { kind: 'toPending' }
  /** El envío ya no admite nada desde aquí: solo «Cerrar». */
  | { kind: 'fatal' };

export interface SdxErrorView {
  text: string;
  /** «Skydropx dice: “…”» (cita literal, ⛔ ni traducida ni reinterpretada). */
  providerSays?: string;
  /** Segunda frase para el súper-admin (escalón de seguro) con enlace a «Configuración › Envíos». */
  adminHint?: string;
  variant: 'danger' | 'warning' | 'info';
  /** «Volver a cotizar» como remedio. */
  requote: boolean;
  /** «Elegir otra opción» (paso 2). */
  chooseOther: boolean;
  /** «Capturar a mano» pasa a ser la acción principal. */
  manualPrimary: boolean;
  effect: SdxErrorEffect;
}

type T = (key: string, values?: Record<string, string | number>) => string;

interface Ctx {
  op: SdxOp;
  isSuperAdmin: boolean;
  money: (cents: number) => string;
  statusLabel: (s: unknown) => string;
}

const view = (text: string, over: Partial<SdxErrorView> = {}): SdxErrorView => ({
  text,
  variant: 'danger',
  requote: false,
  chooseOther: false,
  manualPrimary: false,
  effect: { kind: 'none' },
  ...over,
});

const MISSING_KEYS: Record<string, string> = {
  insurance_tier: 'insuranceTier',
  allow_spend: 'allowSpend',
  origin: 'origin',
  packages: 'packages',
  consignment_note: 'consignmentNote',
  env: 'env',
};

/** «la colonia, el destinatario y la calle» — une con «, » y la conjunción del idioma. */
export function joinMissing(t: T, missing: string[]): string {
  const parts = missing.map((m) => t(`error.missing.${m}`));
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} ${t('error.missing.and')} ${parts[parts.length - 1]}`;
}

/**
 * `{espera}` de `purchase_in_flight` (§43.19.2): `≤ 5` ⇒ «unos segundos»; `< 60` ⇒ «{n} segundos»; `≥ 60` ⇒
 * «{m}:{ss} minutos». Formato, no decisión: los segundos los da el servidor.
 */
export function waitText(t: T, seconds: number): string {
  if (seconds <= 5) return t('error.wait.fewSeconds');
  if (seconds < 60) return t('error.wait.seconds', { n: seconds });
  return t('error.wait.minutes', { m: Math.floor(seconds / 60), ss: String(seconds % 60).padStart(2, '0') });
}

/** El texto de `purchase_in_flight` con la espera que queda (con folio del otro envío si vino). */
export function purchaseInFlightText(t: T, seconds: number, folio: string | null): string {
  const wait = waitText(t, seconds);
  return folio ? t('error.purchaseInFlightFolio', { folio, wait }) : t('error.purchaseInFlight', { wait });
}

/** ¿Es la clase «no sabemos qué pasó»? Un `5xx` o algo que no es una respuesta del servidor (red). */
export function isUnknownOutcome(e: unknown): boolean {
  return !(e instanceof ApiClientError) || e.status >= 500;
}

export function sdxErrorView(e: unknown, t: T, ctx: Ctx): SdxErrorView {
  const err = e instanceof ApiClientError ? e : null;
  const d = (err?.details ?? {}) as Record<string, unknown>;
  const op: SdxOp = d.op === 'quote' || d.op === 'label' ? d.op : ctx.op;

  // SK5 — la compra que no sabemos si ocurrió se trata como ocurrida: se decide RELEYENDO, no aquí.
  if (ctx.op === 'label' && isUnknownOutcome(e)) {
    return view(t('inFlight.checking'), { variant: 'info', effect: { kind: 'unknownOutcome', edgeBlocked: d.reason === 'edge_blocked' } });
  }
  if (!err) return view('', { effect: { kind: 'none' } });

  switch (err.code) {
    case 'FEATURE_DISABLED':
      if (d.feature === 'label_purchase') return view(t('error.labelPurchaseDisabled'), { manualPrimary: true, effect: { kind: 'blockPurchase' } });
      return view(t('error.providerOff'), { manualPrimary: true, effect: { kind: 'blockPurchase' } });
    case 'FORBIDDEN':
      // §43.19.1 (`HECHOS.md:58`): el dial habla de súper-admins, ⛔ no del dueño.
      if (d.reason === 'label_purchase_super_admin_only') return view(t('error.superAdminOnly'), { manualPrimary: true, effect: { kind: 'blockPurchase' } });
      break;
    case 'LABEL_PURCHASE_LIMIT': {
      // 💰 §43.19.1 (TG-1/TG-2): la frase por `limit`, ⛔ SIN cifras (SK11); «Capturar a mano» primaria (SK12).
      const key = d.limit === 'reissue' ? 'buy.limit.reissue' : 'buy.limit.dailySpend';
      return view(`${t(key)} ${t('error.limitNothing')}`, { manualPrimary: true, effect: { kind: 'blockPurchase', banner: true } });
    }
    case 'SHIPPING_PROVIDER_NOT_CONFIGURED': {
      const missing = Array.isArray(d.missing) ? (d.missing as string[]) : [];
      const texts = missing.map((m) =>
        m === 'insurance_tier'
          ? t('error.insuranceTier', {
              insuredValue: ctx.money(Number(d.insuredValueCents ?? 0)),
              maxCoverage: ctx.money(Number(d.maxCoverageCents ?? 0)),
            })
          : MISSING_KEYS[m]
            ? t(`error.${MISSING_KEYS[m]}`)
            : '',
      );
      const adminHint = missing.includes('insurance_tier') && ctx.isSuperAdmin ? t('error.insuranceTierAdmin') : undefined;
      const block = missing.includes('allow_spend');
      return view(texts.filter(Boolean).join(' '), { adminHint, manualPrimary: true, effect: block ? { kind: 'blockPurchase' } : { kind: 'none' } });
    }
    case 'SHIPMENT_ADDRESS_INCOMPLETE': {
      const missing = (Array.isArray(d.missing) ? d.missing : []) as ShipmentAddressMissingField[];
      if (missing.includes('phone')) return view(t('error.phone'), { manualPrimary: true });
      return view(t('error.addressIncomplete', { missing: joinMissing(t, missing) }), { effect: { kind: 'toAddressEdit', missing } });
    }
    case 'SHIPPING_PROVIDER_REJECTED': {
      const providerSays = typeof d.providerMessage === 'string' && d.providerMessage ? t('error.providerSays', { message: d.providerMessage }) : undefined;
      if (op === 'label') {
        return view(t('error.rejectedLabel'), {
          providerSays,
          chooseOther: true,
          effect: { kind: 'toOptions', quote: (d.quote as ShipmentQuoteDTO | undefined) ?? null, reread: false },
        });
      }
      return view(t('error.rejectedQuote'), { providerSays });
    }
    case 'SHIPPING_INSUFFICIENT_BALANCE': {
      const required = ctx.money(Number(d.requiredCents ?? 0));
      return view(ctx.isSuperAdmin ? t('error.balanceOwner', { required }) : t('error.balanceOperator', { required }));
    }
    case 'SHIPPING_PROVIDER_BUSY':
    case 'SHIPPING_PROVIDER_ERROR':
      if (d.reason === 'edge_blocked') return view(t('error.edgeBlocked'), { manualPrimary: true });
      return view(t('error.providerDownQuote'), { requote: true });
    case 'QUOTE_EXPIRED': {
      const quote = (d.quote as ShipmentQuoteDTO | undefined) ?? null;
      if (d.reason === 'address_changed') {
        return view(t('error.quoteExpiredAddress'), { variant: 'warning', effect: { kind: 'toOptions', quote, reread: true } });
      }
      return view(t('error.quoteExpired'), { effect: { kind: 'toOptions', quote, reread: false } });
    }
    case 'LABEL_PREVIEW_STALE': {
      const priceCents = Number(d.priceCents);
      const marginCents = Number(d.marginCents);
      return view(t('error.previewStale', { price: ctx.money(priceCents), margin: ctx.money(marginCents) }), {
        effect: { kind: 'repaintStale', priceCents, marginCents },
      });
    }
    case 'LABEL_CONFIRMATION_REQUIRED': {
      const required = Array.isArray(d.required) ? (d.required as string[]) : [];
      const what = required
        .map((r) => (r === 'negative_margin' ? t('error.confirm.negativeMargin') : r === 'branch_delivery' ? t('error.confirm.branchDelivery') : ''))
        .filter(Boolean)
        .join(` ${t('error.missing.and')} `);
      return view(t('error.confirmationRequired', { what }), {
        effect: { kind: 'repaintConfirm', negativeMargin: required.includes('negative_margin'), branchDelivery: required.includes('branch_delivery') },
      });
    }
    case 'RATE_NOT_IN_QUOTE':
    case 'NOT_FOUND':
      if (op === 'label') return view(t('error.rateGone'), { requote: true });
      break;
    case 'SHIPMENT_ALREADY_LABELED':
      return view(d.labelSource === 'manual' ? t('error.alreadyLabeledManual') : t('error.alreadyLabeledSkydropx'), { effect: { kind: 'fatal' } });
    case 'LABEL_IN_PROGRESS':
      return view(t('error.labelInProgress'), { effect: { kind: 'toPending' } });
    case 'SHIPMENT_NOT_IN_PREPARATION':
      if (d.labelAutoCancelled === true) return view(t('error.autoCancelled', { status: ctx.statusLabel(d.status) }), { effect: { kind: 'fatal' } });
      return view(t('error.notInPreparation', { status: ctx.statusLabel(d.status) }), { effect: { kind: 'fatal' } });
    case 'SHIPMENT_NOT_PREPARED':
      return view(t('error.notPrepared'), { effect: { kind: 'fatal' } });
    case 'SHIPMENT_HAS_OPEN_REPLACEMENTS': {
      const ids = Array.isArray(d.caseIds) ? d.caseIds : [];
      return view(t('error.openReplacements', { count: Math.max(1, ids.length) }), { effect: { kind: 'fatal' } });
    }
    case 'ORDER_NOT_SETTLED':
      return view(t('error.orderNotSettled', { status: ctx.statusLabel(d.orderStatus) }), { effect: { kind: 'fatal' } });
    case 'WITHDRAWAL_LINE_ORIGIN_REFUNDED': {
      const items = (d as Partial<WithdrawalLineOriginRefundedDetails>).items ?? [];
      return view(
        t('error.originRefunded', {
          count: Math.max(1, items.length),
          items: items.map((i) => `${i.folio ?? i.inventoryItemId} · ${i.orderNumber ?? i.orderId ?? '—'}`).join('; '),
        }),
        { effect: { kind: 'fatal' } },
      );
    }
    case 'CONFLICT':
      if (op === 'label') {
        // 💰 §43.19.2: por `details.reason` PRIMERO; sin `reason` (o uno desconocido) cae al texto de hoy.
        switch (d.reason) {
          case 'rate_already_purchased':
            return view(t('error.rateAlreadyPurchased'), { chooseOther: true, effect: { kind: 'toOptions', quote: null, reread: false } });
          case 'provider_id_taken':
            return view(t('error.providerIdTaken'), { variant: 'warning', effect: { kind: 'toPendingConflict' } });
          case 'purchase_in_flight': {
            const seconds = Math.max(1, Math.ceil(Number(d.retryAfterSeconds ?? 1)) || 1);
            // ⛔ Nunca el `otherShipmentId` (uuid) en pantalla: solo `otherFolio`; `null` ⇒ el paréntesis se omite.
            const folio = typeof d.otherFolio === 'string' && d.otherFolio ? d.otherFolio : null;
            return view('', { variant: 'warning', effect: { kind: 'waitRetry', seconds, folio } });
          }
          case 'attempts_exhausted':
            return view(t('error.attemptsExhausted'), { manualPrimary: true, effect: { kind: 'blockPurchase' } });
          case 'stale_purchase_response':
            return view(t('error.stalePurchase'), { variant: 'info', effect: { kind: 'rereadDecide' } });
        }
        return view(t('error.conflict'), { variant: 'warning', effect: { kind: 'rereadToAddress' } });
      }
      break;
  }
  // Sin copy propio: la ventana cae al mensaje genérico del operador (lo pone quien llama).
  return view('', { effect: { kind: 'none' } });
}
