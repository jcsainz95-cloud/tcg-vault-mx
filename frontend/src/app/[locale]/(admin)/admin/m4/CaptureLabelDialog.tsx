'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  correctShipmentAddress,
  getAdminShipment,
  listShippingPackages,
  purchaseShipmentLabel,
  quoteShipment,
  saveShipmentTracking,
} from '@/lib/api';
import { ApiClientError, asApiError } from '@/lib/api-client';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoneyCents, formatTimeMx } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import {
  type AdminShipmentDTO,
  type LabelAlertDTO,
  type LabelPendingDTO,
  type LabelReleaseVia,
  type ShipmentLabelDTO,
  type ShipmentLabelRequest,
  type ShipmentLabelResponse,
  type ShipmentQuoteDTO,
  type ShipmentQuoteRequest,
  type ShipmentTrackingRequest,
  type WithdrawalLineOriginRefundedDetails,
} from '@/types/contract';
import { pesosToCents } from './pesosToCents';
import { TAG } from './prep-shared';
import {
  ADDRESS_FIELDS,
  AddressForm,
  AddressReadView,
  PhoneMissingBanner,
  correctionBody,
  draftOf,
  firstFieldOf,
  type AddressDraft,
  type AddressField,
  type AddressFormHandle,
} from './capture/AddressStep';
import { BuyView, OptionsView } from './capture/QuoteViews';
import { isUnknownOutcome, purchaseInFlightText, sdxErrorView, type SdxErrorView } from './capture/sdx-errors';
import { openLabelPdf } from './capture/label-pdf';

/** Lo que la ventana necesita de cualquiera de las dos superficies que la abren (§37.3a, SK1). */
export interface CaptureTarget {
  id: string;
  ref: string;
  carrier: string | null;
  trackingNumber: string | null;
  /** 🔒 §43.19.7: nuestro folio (`ENV-000045`); sustituye al uuid en la cabecera. Ausente ⇒ servidor anterior a `M-67`. */
  folio?: string | null;
  /** El número de pedido; `null` ⇔ retiro de bóveda (la cabecera dice «Retiro de bóveda · Envío ENV-…»). */
  orderNumber?: string | null;
}

/** Lo que la página anuncia al guardar (`M4View.tsx` Banner de éxito, FS-4). */
export type CaptureSaved = { kind: 'manual'; ref: string } | { kind: 'skydropx'; ref: string; carrier: string; number: string };

type Step = 1 | 2 | 3 | 4;
type Stage = 'labeled' | 'processing' | 'in_progress' | 'in_flight' | 'notCreated';
const PENDING: Stage[] = ['processing', 'in_progress', 'in_flight'];
/** §43.5: la ventana relee cada 5 s hasta 2 min. */
export const POLL_MS = 5_000;
export const POLL_MAX_MS = 120_000;
/**
 * 💰 §43.19.4 (PS-128 (a)): con una compra `in_flight` que trae `verifyingUntil`, pasados los 2 min se sigue releyendo
 * **cada 30 s** hasta `verifyingUntil + 60 s`. ⛔ El reloj de la pantalla solo decide CUÁNDO releer, nunca el resultado.
 */
export const POLL_SLOW_MS = 30_000;
export const VERIFY_GRACE_MS = 60_000;
/** §43.3a: a los 10 s sin respuesta cambia el TEXTO (no decide nada). */
export const QUOTE_SLOW_MS = 10_000;

interface ShownError extends SdxErrorView {
  /** Texto genérico cuando el código no tiene copy propio. */
  fallback?: string;
}

/**
 * **La ventana «Capturar guía»** (`DESIGN_SYSTEM §43` v4.15/v4.16 · contrato `§M4-SHIP.19.19.13` y
 * `§19.20`). Es **el mismo** diálogo de siempre (SK1): con `labelOptions.provider = 'off'` (o sin el campo,
 * que es un servidor anterior a la fase D) es el formulario manual de hoy, idéntico; con `'skydropx'`
 * son cuatro pasos — Dirección · Opciones · Comprar · Guía — y **«Capturar a mano»** sigue en el pie.
 *
 * 💰 Las reglas de dinero que viven aquí (y que prueban sus candados UX-SDX):
 *  - **SK2** la compra es UN clic con la cifra escrita; nada compra solo (ni al elegir, ni al re-cotizar).
 *  - **SK3** ninguna cifra se calcula: se pinta el DTO y se manda de vuelta lo que se vio (`expected*`).
 *  - **SK5** la compra que no sabemos si ocurrió se trata como ocurrida: `200 in_flight` o, ante `5xx`/red,
 *    se RELEE el envío y se decide por `label`/`labelPending`; si la relectura falla, «Compra sin
 *    confirmar» (falla cerrado). ⛔ Nunca se decide por el status.
 *  - **SK7** la dirección del envío se corrige con `PUT …/address` y la `version` que se leyó; lo que se
 *    cotiza es siempre lo guardado, y una corrección tira la cotización que hubiera en memoria.
 */
export function CaptureLabelDialog({
  target,
  onClose,
  onSaved,
}: {
  target: CaptureTarget | null;
  onClose: () => void;
  onSaved: (s: CaptureSaved) => void;
}) {
  const tm4 = useTranslations('admin.m4');
  const t = useTranslations('admin.m4.tracking.sdx');
  const tc = useTranslations('common');
  const tStatus = useTranslations('status.shipment');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const money = useCallback((c: number) => formatMoneyCents(c, locale), [locale]);
  const statusLabel = (s: unknown) => (typeof s === 'string' && tStatus.has(s) ? tStatus(s) : String(s ?? '—'));
  const errCtx = (op: 'quote' | 'label') => ({ op, isSuperAdmin, money, statusLabel });

  const id = target?.id ?? '';
  const stepRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<AddressFormHandle>(null);
  const formId = useId();
  const pickReasonId = useId();

  // --- El envío (fuente de verdad al abrir, §19.19.13 paso 0) ---
  const [shipment, setShipment] = useState<AdminShipmentDTO | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [manual, setManual] = useState(false);
  const manualRef = useRef(false);
  const [step, setStep] = useState<Step>(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<ShownError | null>(null);
  const [fatal, setFatal] = useState(false);

  // --- Paso 1 ---
  const [addrEdit, setAddrEdit] = useState(false);
  const [draft, setDraft] = useState<AddressDraft>(draftOf(null));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AddressField, string>>>({});
  const [addrBanner, setAddrBanner] = useState<{ text: string; variant: 'warning' | 'danger' } | null>(null);
  const [savingAddr, setSavingAddr] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<AddressField | null>(null);

  // --- Paso 2 ---
  const [quote, setQuote] = useState<ShipmentQuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [slow, setSlow] = useState(false);
  const quoteSeq = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showBranch, setShowBranch] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);

  // --- Paso 3 ---
  const [forceWarn, setForceWarn] = useState({ negative: false, branch: false });
  const [purchaseBlocked, setPurchaseBlocked] = useState<string | null>(null);
  const [buyHidden, setBuyHidden] = useState(false);
  const [buying, setBuying] = useState(false);
  const buyingRef = useRef(false);

  // --- Paso 4 ---
  const [stage, setStage] = useState<Stage | null>(null);
  const [label, setLabel] = useState<ShipmentLabelDTO | null>(null);
  const [pendingInfo, setPendingInfo] = useState<LabelPendingDTO | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** 💰 §43.19.3: `processing` con `providerError` (solo en la respuesta inmediata). */
  const [providerError, setProviderError] = useState<{ code: string | null; message: string | null } | null>(null);
  /** 💰 §43.19.2: `provider_id_taken` — su texto queda ENCIMA de la vista de espera mientras dure la ventana. */
  const [pendingConflict, setPendingConflict] = useState<string | null>(null);
  /** 💰 §43.19.4: la guía llegó por la relectura de una compra en vuelo (adoptada por folio) ⇒ `verify.found`. */
  const [found, setFound] = useState(false);
  /** §43.19.4: cómo se soltó el reclamo (el texto de «no se creó» lo decide `lastLabelRelease.via`). */
  const [releaseVia, setReleaseVia] = useState<LabelReleaseVia | null>(null);
  /** 💰 §43.19.2: la espera de `purchase_in_flight` — segundos que quedan (los dio el servidor) y el folio del otro envío. */
  const [wait, setWait] = useState<{ left: number; folio: string | null } | null>(null);
  const [waitLive, setWaitLive] = useState<string | null>(null);
  const waitId = useId();

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
    void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
    void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
    void qc.invalidateQueries({ queryKey: ['departure-board'] });
  }, [qc]);

  const sdxOn = shipment?.labelOptions?.provider === 'skydropx';
  const mode: 'loading' | 'manual' | 'sdx' = loadState === 'loading' ? 'loading' : loadState === 'error' || !sdxOn || manual ? 'manual' : 'sdx';

  const pendingRef = useRef<LabelPendingDTO | null>(null);
  pendingRef.current = pendingInfo;

  const enterPending = useCallback((s: AdminShipmentDTO, fallback: Stage) => {
    setPendingInfo(s.labelPending ?? null);
    setStage(s.labelPending ? (s.labelPending.state === 'in_flight' ? 'in_flight' : fallback === 'in_progress' ? 'in_progress' : 'processing') : fallback);
    setPollTimedOut(false);
    setStep(4);
  }, []);

  // Paso 0 — abrir: GET /admin/shipments/:id y decidir dónde empieza la ventana.
  useEffect(() => {
    if (!target) return;
    let alive = true;
    getAdminShipment(target.id)
      .then((s) => {
        if (!alive) return;
        setShipment(s);
        setDraft(draftOf(s.addressSnapshot));
        setLoadState('ready');
        if (s.labelOptions?.provider !== 'skydropx') return;
        if (s.labelSource === 'manual') {
          setManual(true);
          manualRef.current = true;
          return;
        }
        if (s.labelSource === 'skydropx') {
          setErr({ ...sdxErrorView(new ApiClientError(409, { code: 'SHIPMENT_ALREADY_LABELED', message: '', details: { labelSource: 'skydropx' } }), t, errCtx('quote')) });
          setFatal(true);
          return;
        }
        if (s.labelPending) {
          enterPending(s, s.labelPending.state === 'in_flight' ? 'in_flight' : 'processing');
          return;
        }
        // §43.2a + §19.22.2: `missing` (siempre presente desde v1.80.12.2) decide el modo del paso 1. Un servidor
        // anterior no lo trae: entonces la pantalla no deduce nada y decide el `422 SHIPMENT_ADDRESS_INCOMPLETE`.
        const missing = s.address?.missing ?? [];
        if (s.address && !s.address.complete && missing.length > 0 && !missing.includes('phone')) {
          setAddrEdit(true);
          setPendingFocus(firstFieldOf(missing));
        }
      })
      .catch(() => {
        if (alive) setLoadState('error');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  // Foco: al cambiar de paso, a la línea de paso (§43.1); al abrir el formulario, al campo pedido.
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    if (mode === 'sdx' && !pendingFocus) stepRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  useEffect(() => {
    if (pendingFocus && addrEdit && mode === 'sdx') {
      formRef.current?.focusField(pendingFocus);
      setPendingFocus(null);
    }
  }, [pendingFocus, addrEdit, mode]);

  const reread = useCallback(async (): Promise<AdminShipmentDTO> => {
    const s = await getAdminShipment(id);
    setShipment(s);
    return s;
  }, [id]);

  // --- Cotizar (paso 2) ---
  const runQuote = useCallback(
    (body: ShipmentQuoteRequest, packageLabel?: string) => {
      const mine = ++quoteSeq.current;
      setQuoting(true);
      setSlow(false);
      setErr(null);
      setSelected(null);
      setNotice(packageLabel ? t('options.quotingPackage', { label: packageLabel }) : t('quoting'));
      const slowTimer = setTimeout(() => {
        if (quoteSeq.current === mine) setSlow(true);
      }, QUOTE_SLOW_MS);
      quoteShipment(id, body)
        .then((q) => {
          if (quoteSeq.current !== mine || manualRef.current) return; // respuesta tardía: se descarta (§43.3a)
          setQuote(q);
          setSelected(q.recommendedRateId);
          setNotice(null);
        })
        .catch((e) => {
          if (quoteSeq.current !== mine || manualRef.current) return;
          setNotice(null);
          applyError(e, 'quote');
        })
        .finally(() => {
          clearTimeout(slowTimer);
          if (quoteSeq.current === mine) {
            setQuoting(false);
            setSlow(false);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  function goToOptions() {
    setErr(null);
    setStep(2);
    if (!quote && !quoting) runQuote({});
  }

  const packages = useQuery({
    queryKey: ['shipping-packages'],
    queryFn: listShippingPackages,
    enabled: mode === 'sdx' && step === 2,
    retry: false,
    staleTime: 60_000,
  });

  // --- Errores (§43.7): un copy por código; los efectos se aplican aquí ---
  async function applyError(e: unknown, op: 'quote' | 'label') {
    const v = sdxErrorView(e, t, errCtx(op));
    const shown: ShownError = v.text ? v : { ...v, fallback: getError(e) };
    const eff = v.effect;
    switch (eff.kind) {
      case 'unknownOutcome':
        return; // lo resuelve `decideAfterUnknown` (la relectura), no el texto del error
      case 'blockPurchase':
        if (eff.banner) {
          // 💰 §43.19.1: la negativa por tope va en un `Banner` y el botón DESAPARECE (⛔ 0 compras más sin cambiar de envío).
          setPurchaseBlocked('');
          break;
        }
        setPurchaseBlocked(v.text);
        // En el paso 3 la frase ocupa el sitio del botón (como `canPurchase=false`): sin repetirla en un banner.
        if (op === 'label') return;
        break;
      case 'waitRetry':
        // 💰 §43.19.2: se queda en el paso 3; el botón queda pintado y deshabilitado hasta que pase la espera.
        setWait({ left: eff.seconds, folio: eff.folio });
        setWaitLive(purchaseInFlightText(t, eff.seconds, eff.folio));
        return;
      case 'toPendingConflict':
        // 💰 §19.26.3 (b): el reclamo se conserva ⇒ paso 4, con este texto encima (⛔ sin compra ni «a mano», SK5).
        setPendingConflict(v.text);
        try {
          const s = await reread();
          enterPending(s, 'in_flight');
        } catch {
          enterPending(shipment ?? ({} as AdminShipmentDTO), 'in_flight');
        }
        return;
      case 'rereadDecide':
        // §43.19.2 (`stale_purchase_response`): relee y decide por el ESTADO, con el texto como `info`.
        setErr(shown);
        await decideAfterUnknown(false, true);
        return;
      case 'toOptions':
        if (!v.chooseOther) {
          if (eff.reread) {
            try {
              await reread();
            } catch {
              /* la relectura es para pintar el paso 1; si falla, el paso 1 relee al volver */
            }
          }
          if (eff.quote) {
            setQuote(eff.quote);
            setSelected(eff.quote.recommendedRateId);
          }
          setForceWarn({ negative: false, branch: false });
          setStep(2);
        }
        break;
      case 'repaintStale':
        setQuote((q) =>
          q
            ? { ...q, rates: q.rates.map((r) => (r.rateId === selected ? { ...r, priceCents: eff.priceCents, marginCents: eff.marginCents } : r)) }
            : q,
        );
        break;
      case 'repaintConfirm':
        setForceWarn({ negative: eff.negativeMargin, branch: eff.branchDelivery });
        break;
      case 'toAddressEdit':
        setStep(1);
        setAddrEdit(true);
        setPendingFocus(firstFieldOf(eff.missing));
        break;
      case 'rereadToAddress':
        try {
          const s = await reread();
          setDraft(draftOf(s.addressSnapshot));
        } catch {
          /* se queda con lo que había */
        }
        setQuote(null);
        setAddrEdit(false);
        setStep(1);
        break;
      case 'toPending':
        try {
          const s = await reread();
          enterPending(s, 'processing');
        } catch {
          enterPending(shipment ?? ({} as AdminShipmentDTO), 'in_flight');
        }
        break;
      case 'fatal':
        setFatal(true);
        break;
    }
    setErr(shown);
  }

  // --- Comprar (paso 3) — 💰 un clic, una petición ---
  function applyLabelResponse(res: ShipmentLabelResponse) {
    setShipment(res.shipment);
    invalidate();
    if (res.outcome === 'labeled') {
      showLabeled(res.label);
      return;
    }
    // 💰 §43.19.3: Skydropx creó el envío Y reportó un error ⇒ aviso encima de «Guía en proceso» (solo aquí).
    if (res.outcome === 'processing' && res.providerError) setProviderError(res.providerError);
    enterPending(res.shipment, res.outcome);
  }
  function showLabeled(l: ShipmentLabelDTO) {
    setLabel(l);
    setStage('labeled');
    setStep(4);
    setNotice(null);
    if (target && l.trackingNumber) onSaved({ kind: 'skydropx', ref: target.ref, carrier: l.chosen.carrierLabel, number: l.trackingNumber });
  }

  /** SK5 — tras un `5xx`/red de la compra: relee y decide por el ESTADO; si la relectura falla, falla cerrado. */
  async function decideAfterUnknown(edgeBlocked: boolean, keepErr = false) {
    setBuyHidden(true);
    setNotice(t('inFlight.checking'));
    let s: AdminShipmentDTO;
    try {
      s = await getAdminShipment(id);
    } catch {
      setNotice(null);
      setPendingInfo(null);
      setStage('in_flight');
      setPollTimedOut(false);
      setStep(4);
      return;
    }
    setShipment(s);
    setNotice(null);
    invalidate();
    if (s.label) return showLabeled(s.label);
    if (s.labelPending) return enterPending(s, s.labelPending.state === 'in_flight' ? 'in_flight' : 'processing');
    if (keepErr) {
      setBuyHidden(false);
      return;
    }
    if (edgeBlocked) {
      // «No sirve reintentar»: el botón no vuelve; su sitio lo ocupa la frase y «Capturar a mano» pasa a primaria.
      setPurchaseBlocked(t('error.edgeBlocked'));
      setBuyHidden(false);
      return;
    }
    setErr({ text: t('inFlight.nothingBought'), variant: 'info', requote: false, chooseOther: false, manualPrimary: false, effect: { kind: 'none' } });
    setBuyHidden(false);
  }

  async function buy() {
    const rate = quote?.rates.find((r) => r.rateId === selected);
    if (buyingRef.current || !quote || !rate) return;
    buyingRef.current = true;
    setBuying(true);
    setErr(null);
    setWait(null);
    setWaitLive(null);
    setNotice(t('buy.buying'));
    const body: ShipmentLabelRequest = {
      quoteId: quote.quoteId,
      rateId: rate.rateId,
      expectedPriceCents: rate.priceCents,
      expectedMarginCents: rate.marginCents,
    };
    // §43.4: se confirma SOLO lo que estaba pintado (UX-SDX-9).
    if (warnNegative) body.confirmNegativeMargin = true;
    if (warnBranch) body.confirmBranchDelivery = true;
    try {
      const res = await purchaseShipmentLabel(id, body);
      setNotice(null);
      applyLabelResponse(res);
    } catch (e) {
      setNotice(null);
      if (isUnknownOutcome(e)) {
        const d = (asApiError(e)?.details ?? {}) as Record<string, unknown>;
        await decideAfterUnknown(d.reason === 'edge_blocked');
      } else {
        await applyError(e, 'label');
      }
    } finally {
      buyingRef.current = false;
      setBuying(false);
    }
  }

  // --- Paso 4: relectura cada 5 s hasta 2 min (§43.5), contados desde que la ventana ENTRÓ en espera; con una compra
  // `in_flight` que trae `verifyingUntil`, luego cada 30 s hasta `verifyingUntil + 60 s` (§43.19.4, PS-128 (a)) ---
  const pollStart = useRef<number | null>(null);
  useEffect(() => {
    if (!stage || !PENDING.includes(stage)) {
      pollStart.current = null;
      return;
    }
    if (pollTimedOut) return;
    if (pollStart.current === null) pollStart.current = Date.now();
    const started = pollStart.current;
    let lastRead = started;
    let stopped = false;
    /** Hasta cuándo se relee: 2 min, o `verifyingUntil + 60 s` si la compra en vuelo lo trae (lo que sea más tarde). */
    const deadline = () => {
      const p = pendingRef.current;
      const until = p?.state === 'in_flight' && p.verifyingUntil ? Date.parse(p.verifyingUntil) + VERIFY_GRACE_MS : 0;
      return Math.max(started + POLL_MAX_MS, Number.isFinite(until) ? until : 0);
    };
    const tick = setInterval(async () => {
      if (stopped) return;
      const now = Date.now();
      if (now >= deadline()) {
        stopped = true;
        clearInterval(tick);
        setPollTimedOut(true);
        return;
      }
      // Pasados los 2 min, una lectura cada 30 s (el intervalo sigue de 5 s: solo se salta vueltas).
      if (now - started >= POLL_MAX_MS && now - lastRead < POLL_SLOW_MS) return;
      lastRead = now;
      try {
        const s = await getAdminShipment(id);
        if (stopped) return;
        setShipment(s);
        if (s.label) {
          stopped = true;
          clearInterval(tick);
          invalidate();
          // §43.19.4 «Encontrada»: la guía llegó por la relectura de una compra EN VUELO (adoptada por su folio).
          if (stage === 'in_flight') setFound(true);
          showLabeled(s.label);
        } else if (s.labelPending) {
          setPendingInfo(s.labelPending);
          if (s.labelPending.state === 'processing') setStage((cur) => (cur === 'in_flight' ? 'processing' : cur));
        } else {
          stopped = true;
          clearInterval(tick);
          invalidate();
          // §43.19.4: el texto de «no se creó» lo decide CÓMO se soltó (⛔ nunca el reloj de la pantalla).
          setReleaseVia(s.lastLabelRelease?.via ?? null);
          setStage('notCreated');
        }
      } catch {
        /* una relectura fallida no decide nada: se sigue esperando */
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, pollTimedOut, id]);

  // --- 💰 La espera de `purchase_in_flight` (§43.19.2): cuenta atrás VISUAL, una vez por segundo, fuera de la región
  // viva; al llegar a 0 el botón se habilita y se anuncia UNA vez. ⛔ No compra sola (SK2): hace falta el clic. ---
  const waiting = wait !== null && wait.left > 0;
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setWait((w) => (w ? { ...w, left: Math.max(0, w.left - 1) } : w)), 1_000);
    return () => clearInterval(tick);
  }, [waiting]);
  const waitDone = wait !== null && wait.left === 0;
  useEffect(() => {
    if (waitDone) setWaitLive(t('error.purchaseInFlightReady'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitDone]);

  // --- Guardar la dirección (paso 1, §43.2d) ---
  async function saveAddress() {
    if (!shipment || savingAddr) return;
    setSavingAddr(true);
    setFieldErrors({});
    setAddrBanner(null);
    setErr(null);
    setNotice(t('address.saving'));
    const version = shipment.address?.version ?? 0; // ⛔ nunca `version + 1`: la que se LEYÓ
    try {
      const res = await correctShipmentAddress(id, correctionBody(draft, version));
      setShipment(res.shipment);
      setDraft(draftOf(res.shipment.addressSnapshot));
      setAddrEdit(false);
      if (res.outcome === 'corrected') {
        // §19.20.1: la cotización vieja ya no es vigente ⇒ se TIRA; el paso 2 cotiza de nuevo (UX-SDX-20).
        quoteSeq.current++;
        setQuote(null);
        setSelected(null);
        invalidate();
      }
      setNotice(res.outcome === 'corrected' ? t('address.saved') : t('address.unchanged'));
      stepRef.current?.focus();
    } catch (e) {
      setNotice(null);
      const ae = asApiError(e);
      const d = (ae?.details ?? {}) as Record<string, unknown>;
      if (!ae || ae.status >= 500) {
        setAddrBanner({ text: t('address.serverDown'), variant: 'danger' });
      } else if (ae.code === 'CONFLICT' && d.reason === 'address_changed') {
        setAddrBanner({ text: t('address.conflict'), variant: 'warning' });
        setAddrEdit(false);
        try {
          const s = await reread();
          setDraft(draftOf(s.addressSnapshot));
        } catch {
          /* se queda en modo leer con lo anterior; el siguiente guardado volverá a chocar */
        }
      } else if (ae.code === 'SHIPMENT_NOT_IN_PREPARATION') {
        setAddrBanner({ text: t('address.notInPreparation', { status: statusLabel(d.status) }), variant: 'danger' });
        setFatal(true);
      } else if (ae.code === 'SHIPMENT_ALREADY_LABELED') {
        setAddrBanner({ text: t('address.alreadyLabeled'), variant: 'danger' });
        setFatal(true);
      } else if (ae.code === 'LABEL_IN_PROGRESS') {
        setAddrBanner({ text: t('address.labelInProgress'), variant: 'danger' });
        try {
          const s = await reread();
          enterPending(s, 'processing');
        } catch {
          enterPending(shipment, 'in_flight');
        }
      } else if (ae.code === 'VALIDATION_ERROR') {
        // v1.80.12.5 (§M4-SHIP.19.25.1): ⛔ sin `422` geográficos; `city`/`state` vacíos son un `400 {field}`.
        const field = (typeof d.field === 'string' ? d.field : 'other') as string;
        const key = { recipientName: 'recipient', line1: 'line1', postalCode: 'postalCode', references: 'references' }[field] ?? 'other';
        const target: AddressField = (ADDRESS_FIELDS as readonly string[]).includes(field) ? (field as AddressField) : 'recipientName';
        setFieldErrors({ [target]: t(`address.invalid.${key}`) });
        setPendingFocus(target);
      } else if (ae.status === 403) {
        setAddrBanner({ text: t('address.forbidden'), variant: 'danger' });
        setFatal(true);
      } else {
        setAddrBanner({ text: getError(e), variant: 'danger' });
      }
    } finally {
      setSavingAddr(false);
    }
  }

  // Parche funcional: el CP nuevo manda colonia, municipio y estado en el mismo pase (`useNeighborhoodMode`).
  function onPatch(patch: Partial<AddressDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  // --- «Capturar a mano» (§43.6): el formulario de hoy, sin cambios de campos ni de copy ---
  const [carrierValue, setCarrierValue] = useState(target?.carrier ?? '');
  const [trackingNumberValue, setTrackingNumberValue] = useState(target?.trackingNumber ?? '');
  const [shippingCostValue, setShippingCostValue] = useState('');
  const [manualError, setManualError] = useState<{ text: string; link?: { href: string; label: string } } | null>(null);
  const shippingCostCents = pesosToCents(shippingCostValue);
  const shippingCostInvalid = shippingCostValue.trim() !== '' && (shippingCostCents === null || shippingCostCents < 0);
  const canSubmitManual = carrierValue.trim() !== '' && trackingNumberValue.trim() !== '' && !shippingCostInvalid;

  const manualMutation = useMutation({
    mutationFn: () => {
      const body: ShipmentTrackingRequest = { carrier: carrierValue.trim(), trackingNumber: trackingNumberValue.trim() };
      if (shippingCostCents !== null) body.shippingCostCents = shippingCostCents;
      return saveShipmentTracking(id, body);
    },
    onSuccess: () => {
      invalidate();
      if (target) onSaved({ kind: 'manual', ref: target.ref });
      onClose();
    },
    onError: (e) => {
      // §37.6 + §43.6: cada 409 con su copy y su remedio; ⛔ ninguno cae a «Algo salió mal».
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'SHIPMENT_NOT_PREPARED') {
        setManualError({ text: tm4('tracking.notPrepared'), link: { href: '/admin/m4', label: tm4('tracking.goToPrepare') } });
      } else if (err?.status === 409 && err.code === 'SHIPMENT_HAS_OPEN_REPLACEMENTS') {
        const ids = (err.details?.caseIds as unknown[] | undefined) ?? [];
        setManualError({ text: tm4('tracking.openReplacements', { count: Math.max(1, ids.length) }), link: { href: '/admin/m4?tab=reponer', label: tm4('tracking.goToReplace') } });
      } else if (err?.status === 409 && err.code === 'ORDER_NOT_SETTLED') {
        setManualError({ text: tm4('tracking.orderNotSettled', { status: statusLabel(err.details?.orderStatus) }) });
      } else if (err?.status === 409 && err.code === 'WITHDRAWAL_LINE_ORIGIN_REFUNDED') {
        const items = (err.details as Partial<WithdrawalLineOriginRefundedDetails> | undefined)?.items ?? [];
        setManualError({
          text: tm4('tracking.originRefunded', { count: Math.max(1, items.length), items: items.map((i) => `${i.folio ?? i.inventoryItemId} · ${i.orderNumber ?? i.orderId ?? '—'}`).join('; ') }),
          link: items[0]?.orderId ? { href: `/admin/m3/${items[0].orderId}`, label: `${tm4('viewOrder')} ${items[0].orderNumber ?? items[0].orderId}` } : undefined,
        });
      } else if (err?.status === 409 && err.code === 'SHIPMENT_ALREADY_LABELED') {
        setManualError({ text: err.details?.labelSource === 'manual' ? t('error.alreadyLabeledManual') : t('error.alreadyLabeledSkydropx') });
      } else {
        setManualError({ text: getError(e) });
      }
    },
  });

  function toManual() {
    manualRef.current = true;
    setManual(true);
  }
  function backToSkydropx() {
    manualRef.current = false;
    setManual(false);
    if (step === 2 && !quote && !quoting) runQuote({});
  }

  // Esc, la X y el fondo NO cierran con una petición de dinero o de dirección en curso (§43.1, FS-3).
  const busy = buying || savingAddr || manualMutation.isPending;
  const guardedClose = () => {
    if (busy) return;
    onClose();
  };

  // ------------------------------ derivados ------------------------------
  const opts = shipment?.labelOptions;
  const missing = shipment?.address?.missing ?? [];
  const missingKnown = Array.isArray(shipment?.address?.missing); // defensa ante un servidor anterior a v1.80.12.2
  const phoneMissing = missing.includes('phone');
  // «Ver opciones» con `complete=false` solo si NO sabemos qué falta: el servidor lo dirá con su `422`.
  const canSeeOptions = !phoneMissing && (shipment?.address?.complete !== false || !missingKnown);
  const canCorrect = shipment?.status === 'picking' && !shipment?.labelSource && !shipment?.labelPending;
  const rate = quote?.rates.find((r) => r.rateId === selected) ?? null;
  const warnNegative = !!rate && (rate.marginCents < 0 || forceWarn.negative);
  const warnBranch = !!rate && (rate.deliveryKind === 'branch' || forceWarn.branch);
  // 💰 §43.19.1 (SK12): con `labelOptions.limit` no hay botón y «Capturar a mano» es la primaria.
  const canBuy = !!opts?.canPurchase && !opts?.limit && purchaseBlocked === null && !buyHidden && !fatal;
  const stepName = (['address', 'options', 'buy', 'label'] as const)[step - 1];

  // ------------------------------ pie ------------------------------
  const manualBtn = (primary = false, disabled = false) => (
    <Button key="manual" variant={primary ? 'primary' : 'ghost'} disabled={disabled} onClick={toManual}>
      {t('manual')}
    </Button>
  );
  const closeBtn = (
    <Button key="close" variant="primary" onClick={guardedClose}>
      {t('close')}
    </Button>
  );

  let footer: React.ReactNode = null;
  if (mode === 'manual') {
    footer = (
      <>
        <Button variant="ghost" onClick={guardedClose}>
          {tc('cancel')}
        </Button>
        <Button disabled={!canSubmitManual} loading={manualMutation.isPending} onClick={() => manualMutation.mutate()}>
          {tm4('tracking.save')}
        </Button>
      </>
    );
  } else if (mode === 'sdx') {
    if (fatal) footer = closeBtn;
    else if (step === 1) {
      footer = addrEdit ? (
        <>
          {manualBtn()}
          <Button variant="ghost" disabled={savingAddr} onClick={() => {
            setDraft(draftOf(shipment?.addressSnapshot));
            setFieldErrors({});
            setAddrEdit(false);
            stepRef.current?.focus();
          }}>
            {t('address.discard')}
          </Button>
          <Button loading={savingAddr} onClick={saveAddress}>
            {t('address.save')}
          </Button>
        </>
      ) : (
        <>
          {manualBtn(!canSeeOptions)}
          {canCorrect && (
            <Button variant="secondary" aria-expanded={false} aria-controls={formId} onClick={() => {
              setDraft(draftOf(shipment?.addressSnapshot));
              setAddrBanner(null);
              setAddrEdit(true);
              setPendingFocus(phoneMissing ? 'recipientName' : missing.length ? firstFieldOf(missing) : 'recipientName');
            }}>
              {t('address.edit')}
            </Button>
          )}
          {canSeeOptions && <Button onClick={goToOptions}>{t('address.cta')}</Button>}
        </>
      );
    } else if (step === 2) {
      const empty = quote && quote.rates.length === 0;
      footer = (
        <>
          {manualBtn(!!empty || !!err?.manualPrimary)}
          <Button variant="ghost" onClick={() => { setErr(null); setStep(1); }}>
            {t('back')}
          </Button>
          {(empty || err?.requote) && (
            <Button variant="secondary" onClick={() => runQuote({ force: true, packageCode: quote?.package.code })}>
              {t('options.requote')}
            </Button>
          )}
          {quote && !empty && (
            <Button disabled={!rate || quoting} aria-describedby={!rate ? pickReasonId : undefined} onClick={() => { setErr(null); setForceWarn({ negative: false, branch: false }); setStep(3); }}>
              {rate ? t('options.cta', { carrier: rate.carrierLabel }) : t('options.cta', { carrier: '…' })}
            </Button>
          )}
        </>
      );
    } else if (step === 3) {
      footer = (
        <>
          {!buyHidden && manualBtn(!canBuy, buying)}
          <Button variant="ghost" disabled={buying || buyHidden} onClick={() => { setErr(null); setWait(null); setWaitLive(null); setStep(2); }}>
            {t('back')}
          </Button>
          {err?.chooseOther && (
            <Button variant="secondary" onClick={() => {
              const eff = err.effect;
              if (eff.kind === 'toOptions' && eff.quote) {
                setQuote(eff.quote);
                setSelected(eff.quote.recommendedRateId);
              }
              setErr(null);
              setStep(2);
            }}>
              {t('error.chooseOther')}
            </Button>
          )}
          {err?.requote && (
            <Button variant="secondary" onClick={() => { setStep(2); runQuote({ force: true, packageCode: quote?.package.code }); }}>
              {t('options.requote')}
            </Button>
          )}
          {canBuy && rate && (
            <Button disabled={buying || waiting} loading={buying} aria-describedby={waiting ? waitId : undefined} onClick={buy}>
              {t('buy.cta', { amount: money(rate.priceCents) })}
            </Button>
          )}
        </>
      );
    } else if (step === 4) {
      if (stage === 'labeled') {
        footer = (
          <Button variant="primary" onClick={guardedClose}>
            {t('label.done')}
          </Button>
        );
      } else if (stage === 'notCreated') {
        // §43.19.4: «Cotizar de nuevo» PIDE cotización (sin `force`: el servidor reutiliza la vigente, SEC-SDX-8);
        // ⛔ 0 compras hasta el clic con la cifra del paso 3 (SK2, PS-128 (b)).
        footer = (
          <>
            {manualBtn()}
            <Button onClick={() => { setStage(null); setBuyHidden(false); setErr(null); setReleaseVia(null); setPendingConflict(null); setStep(2); runQuote({}); }}>
              {t('verify.requote')}
            </Button>
          </>
        );
      } else {
        footer = closeBtn; // ⛔ sin compra ni «a mano» con una compra pendiente (SK5)
      }
    }
  }

  // ------------------------------ cuerpo ------------------------------
  const errorBanner = err && (err.text || err.fallback) && (
    <Banner variant={err.variant} role="alert">
      <p>{err.text || err.fallback}</p>
      {err.providerSays && <p className="text-sm">{err.providerSays}</p>}
      {err.adminHint && (
        <Link href="/admin/m10" className="text-sm text-text underline underline-offset-4 hover:text-accent">
          {err.adminHint}
        </Link>
      )}
    </Banner>
  );

  let body: React.ReactNode = null;
  if (mode === 'loading') {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <p className="sr-only">{t('loading')}</p>
      </div>
    );
  } else if (mode === 'manual') {
    body = (
      <div className="flex flex-col gap-3">
        {loadState === 'error' && (
          <Banner variant="warning" role="status">
            {t('loadError')}
          </Banner>
        )}
        {sdxOn && (
          <div className="flex flex-col gap-1">
            <Button variant="link" className="self-start" onClick={backToSkydropx}>
              {t('backToSkydropx')}
            </Button>
            <p className="text-sm text-muted">{t('manualIntro')}</p>
          </div>
        )}
        <Input label={tm4('tracking.carrierLabel')} type="text" value={carrierValue} onChange={(e) => setCarrierValue(e.target.value)} />
        <Input label={tm4('tracking.numberLabel')} type="text" inputMode="numeric" value={trackingNumberValue} onChange={(e) => setTrackingNumberValue(e.target.value)} />
        <Input
          label={tm4('tracking.shippingCostLabel')}
          hint={tm4('tracking.shippingCostHint')}
          error={shippingCostInvalid ? tm4('tracking.shippingCostInvalid') : undefined}
          type="text"
          inputMode="decimal"
          prefix="MX$"
          min={0}
          value={shippingCostValue}
          onChange={(e) => setShippingCostValue(e.target.value)}
        />
        {!shippingCostInvalid && shippingCostCents !== null && <p className="text-xs text-muted">= {money(shippingCostCents)}</p>}
        {manualError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            <p>{manualError.text}</p>
            {manualError.link && (
              <Link href={manualError.link.href} className="text-text underline underline-offset-4 hover:text-accent" onClick={onClose}>
                {manualError.link.label}
              </Link>
            )}
          </Banner>
        )}
      </div>
    );
  } else if (shipment) {
    body = (
      <div className="flex flex-col gap-4">
        {step === 1 && (
          <>
            {addrBanner && (
              <Banner variant={addrBanner.variant} role="alert">
                {addrBanner.text}
              </Banner>
            )}
            {!addrEdit && phoneMissing && <PhoneMissingBanner />}
            {addrEdit ? (
              <AddressForm
                ref={formRef}
                formId={formId}
                saved={shipment.addressSnapshot ?? ({} as never)}
                draft={draft}
                onPatch={onPatch}
                fieldErrors={fieldErrors}
                neighborhoodMissing={missing.includes('neighborhood')}
              />
            ) : (
              <AddressReadView shipment={shipment} />
            )}
          </>
        )}
        {step === 2 &&
          (quoting && !quote ? (
            <div className="flex flex-col gap-3" data-testid="sdx-quoting">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
              <p className="text-sm text-muted">{slow ? t('quotingSlow') : t('quotingHint')}</p>
            </div>
          ) : quote ? (
            <OptionsView
              quote={quote}
              selected={selected}
              onSelect={setSelected}
              showBranch={showBranch}
              onToggleBranch={() => setShowBranch((v) => !v)}
              onRequote={() => runQuote({ force: true, packageCode: quote.package.code })}
              packages={packages.data ?? null}
              packagesError={packages.isError}
              packageOpen={packageOpen}
              onTogglePackage={() => setPackageOpen((v) => !v)}
              onPackage={(code) => {
                const p = packages.data?.find((x) => x.code === code);
                if (p && code !== quote.package.code) runQuote({ packageCode: code }, p.label);
              }}
              pickReasonId={pickReasonId}
              limit={opts?.limit ?? null}
            />
          ) : null)}
        {step === 3 && rate && quote && opts && (
          <BuyView
            rate={rate}
            coverageCents={quote.insurance.coverageCents}
            warnNegative={warnNegative}
            warnBranch={warnBranch}
            options={opts}
            blockedText={buyHidden ? '' : purchaseBlocked}
            isSuperAdmin={isSuperAdmin}
          />
        )}
        {step === 3 && wait && (
          // §43.19.2: la cuenta atrás va FUERA de la región viva (un lector de pantalla no oye 180 anuncios): aspecto de
          // `Banner` sin `role`; el anuncio (al empezar y al terminar) lo hace el `role="status"` de abajo, una vez.
          <div id={waitId} data-testid="sdx-purchase-in-flight" className="border-l-2 border-accent py-1 pl-4 text-sm leading-relaxed text-muted">
            {wait.left > 0 ? purchaseInFlightText(t, wait.left, wait.folio) : t('error.purchaseInFlightReady')}
          </div>
        )}
        {waitLive && (
          <p role="status" className="sr-only">
            {waitLive}
          </p>
        )}
        {step === 4 && stage === 'labeled' && label && (
          <LabelView
            label={label}
            shipmentId={id}
            refText={target?.ref ?? id}
            printError={printError}
            setPrintError={setPrintError}
            copied={copied}
            setCopied={setCopied}
            found={found}
          />
        )}
        {step === 4 && stage && stage !== 'labeled' && (
          <PendingView
            stage={stage}
            info={pendingInfo}
            alert={shipment.labelAlert ?? null}
            timedOut={pollTimedOut}
            providerError={stage === 'processing' ? providerError : null}
            conflict={pendingConflict}
            releaseVia={releaseVia}
          />
        )}
        {errorBanner}
      </div>
    );
  }

  return (
    <Modal open={target !== null} onClose={guardedClose} title={tm4('tracking.title')} footer={footer}>
      <div className="flex flex-col gap-3">
        {target &&
          (target.folio ? (
            // 🔒 §43.19.7: «{pedido} · Envío ENV-000045»; retiro ⇒ «Retiro de bóveda · Envío ENV-000045». ⛔ Sin uuid.
            <p className="text-sm text-muted" data-testid="sdx-dialog-ref">
              <span className={target.orderNumber ? 'tabular font-medium text-text' : 'font-medium text-text'}>
                {target.orderNumber ?? tm4('prep.withdrawal')}
              </span>{' '}
              · {tm4('prep.shipmentRef')} <span className="tabular">{target.folio}</span>
            </p>
          ) : (
            <p className="text-sm text-muted" data-testid="sdx-dialog-ref">
              <span className="tabular font-medium text-text">{target.ref}</span>
              {target.ref !== target.id && <> · {target.id}</>}
            </p>
          ))}
        {mode === 'sdx' && (
          <p ref={stepRef} tabIndex={-1} data-testid="sdx-step" className={`${TAG} text-muted outline-none focus-visible:shadow-focus`}>
            {t('step', { n: step, name: t(`stepName.${stepName}`) })}
          </p>
        )}
        {body}
        <div role="status" aria-live="polite" data-testid="sdx-live" className="text-sm text-text">
          {mode === 'sdx' ? notice : null}
        </div>
      </div>
    </Modal>
  );
}

/** Paso 4 · «Guía comprada» (§43.5, `outcome:'labeled'`). */
function LabelView({
  label,
  shipmentId,
  refText,
  printError,
  setPrintError,
  copied,
  setCopied,
  found,
}: {
  label: ShipmentLabelDTO;
  shipmentId: string;
  refText: string;
  printError: string | null;
  setPrintError: (s: string | null) => void;
  copied: boolean;
  setCopied: (b: boolean) => void;
  found: boolean;
}) {
  const tv = useTranslations('admin.m4.tracking.sdx.verify');
  const t = useTranslations('admin.m4.tracking.sdx.label');
  const tq = useTranslations('admin.m4.label');
  const locale = useLocale() as AppLocale;
  const pdf = (mode: 'print' | 'download') => {
    setPrintError(null);
    openLabelPdf(shipmentId, refText, mode).catch((e) => {
      setPrintError(asApiError(e)?.code === 'LABEL_NOT_AVAILABLE' ? tq('notAvailable') : t('printError'));
    });
  };
  return (
    <div className="flex flex-col gap-3" data-testid="sdx-labeled">
      <p className="font-serif text-xl text-text">{t('title')}</p>
      {found && (
        <p className="text-sm text-text" data-testid="sdx-verify-found">
          {tv('found')}
        </p>
      )}
      <p className="text-base text-text">
        {label.chosen.carrierLabel} · {label.serviceName}
      </p>
      {label.trackingNumber && (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="select-all font-mono text-[15px] text-text">{t('tracking', { number: label.trackingNumber })}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(label.trackingNumber ?? '').then(() => setCopied(true));
            }}
          >
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
      )}
      <p className="tabular text-sm text-text">{t('charged', { amount: formatMoneyCents(label.cost.grossCents, locale) })}</p>
      {label.labelAvailable ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => pdf('print')}>{t('print')}</Button>
          <Button variant="secondary" onClick={() => pdf('download')}>
            {t('download')}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text">{t('notReady')}</p>
      )}
      {printError && <p className="text-sm text-accent">{printError}</p>}
      {label.trackingUrl && (
        <a href={label.trackingUrl} target="_blank" rel="noopener noreferrer" className="self-start text-sm text-text underline underline-offset-4 hover:text-accent">
          {t('trackingLink')}
          <span className="sr-only"> {t('newTab')}</span>
        </a>
      )}
      <p className="text-sm text-muted">{t('emailSent')}</p>
    </div>
  );
}

/** «Pedido ENV-000045-01» con «Copiar folio» (§43.19.4): el texto EXACTO de la etiqueta y del panel de Skydropx. */
export function FolioLine({ reference, testId }: { reference: string; testId?: string }) {
  const t = useTranslations('admin.m4.tracking.sdx.verify');
  const [copied, setCopied] = useState(false);
  const text = `Pedido ${reference}`;
  return (
    <div className="flex flex-wrap items-baseline gap-3" data-testid={testId ?? 'sdx-folio'}>
      <span className="select-all font-mono text-[15px] text-text">{t('folio', { reference: text })}</span>
      <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  );
}

/** «Pedida por {name} · {carrier} · {service} · desde {hora}.» — cada nulo se omite con su separador. */
function WhoLine({ info }: { info: LabelPendingDTO }) {
  const t = useTranslations('admin.m4.tracking.sdx');
  const locale = useLocale() as AppLocale;
  const parts = [info.chosenBy ? t('inFlight.whoBy', { name: info.chosenBy.name?.trim() || t('address.unnamed') }) : null, info.carrierLabel, info.serviceName].filter(
    Boolean,
  ) as string[];
  return (
    <p className="text-sm text-text" data-testid="sdx-in-flight-who">
      {info.chosenBy && info.carrierLabel && info.serviceName
        ? t('inFlight.who', {
            name: info.chosenBy.name?.trim() || t('address.unnamed'),
            carrier: info.carrierLabel,
            service: info.serviceName,
            time: formatTimeMx(info.since, locale),
          })
        : `${[...parts, t('inFlight.whoSince', { time: formatTimeMx(info.since, locale) })].join(' · ')}.`}
    </p>
  );
}

/**
 * Paso 4 · «Verificando con Skydropx…» / «Compra sin confirmar» / «Guía en proceso» / «no se creó» (§43.5 + §43.19.3–.4).
 * 💰 La vista la decide lo que dice el SERVIDOR (`labelPending.state`, `labelAlert.kind`, `lastLabelRelease.via`);
 * ⛔ nunca se compara `verifyingUntil` con el reloj de la pantalla (SK3).
 */
function PendingView({
  stage,
  info,
  alert,
  timedOut,
  providerError,
  conflict,
  releaseVia,
}: {
  stage: Stage;
  info: LabelPendingDTO | null;
  alert: LabelAlertDTO | null;
  timedOut: boolean;
  providerError: { code: string | null; message: string | null } | null;
  conflict: string | null;
  releaseVia: LabelReleaseVia | null;
}) {
  const t = useTranslations('admin.m4.tracking.sdx');
  const locale = useLocale() as AppLocale;
  if (stage === 'notCreated') {
    const key =
      releaseVia === 'auto_verified'
        ? 'verify.notCharged'
        : releaseVia === 'auto_not_sent'
          ? 'verify.notSent'
          : releaseVia === 'manual_verified'
            ? 'verify.manualVerified'
            : releaseVia === 'manual'
              ? 'verify.manual'
              : 'inFlight.notCreated';
    return (
      <div className="flex flex-col gap-2" data-testid="sdx-not-created">
        <p className="text-sm text-text">{t(key)}</p>
      </div>
    );
  }
  if (stage === 'in_flight') {
    const reference = info?.providerReference ?? null;
    const conflictBanner = conflict && (
      <Banner variant="warning" role="status">
        {conflict}
      </Banner>
    );
    // «Incierto» (§43.19.4): el servidor ya dio la verificación por incierta (`label_unknown`), o nunca se pudo leer.
    if (!info || alert?.kind === 'label_unknown') {
      const reason = alert?.kind === 'label_unknown' && alert.reason ? t(`reason.${alert.reason}`) : t('reason.none');
      return (
        <div className="flex flex-col gap-3" data-testid="sdx-in-flight">
          <p className="font-serif text-xl text-text">{t('inFlight.title')}</p>
          {conflictBanner}
          <Banner variant="warning" role="status">
            {t('inFlight.body', { reason })}
          </Banner>
          {reference && <FolioLine reference={reference} />}
          {info && <WhoLine info={info} />}
          <p className="text-sm text-muted">{timedOut ? t('inFlight.timeout') : t('processing.checking')}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3" data-testid="sdx-verifying">
        <p className="font-serif text-xl text-text">{t('verify.title')}</p>
        {/* `provider_id_taken` SUSTITUYE el cuerpo: no se está comprobando nada útil, lo resuelve una persona. */}
        {conflictBanner ?? (
          <Banner variant="warning" role="status">
            {info.verifyingUntil ? t('verify.body', { time: formatTimeMx(info.verifyingUntil, locale) }) : t('verify.bodyNoTime')}
          </Banner>
        )}
        {reference && <FolioLine reference={reference} />}
        <WhoLine info={info} />
        <p className="text-sm text-muted">{timedOut ? t('verify.timeout') : t('processing.checking')}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="sdx-processing">
      <p className="font-serif text-xl text-text">{t('processing.title')}</p>
      {providerError && (
        <Banner variant="warning" role="status">
          <p>{t('processing.providerError')}</p>
          {/* `message` LITERAL entre comillas, ⛔ ni traducido ni reinterpretado; `code` no se pinta (es técnico). */}
          {providerError.message && <p>{t('error.providerSays', { message: providerError.message })}</p>}
        </Banner>
      )}
      <p className="text-sm text-text">{stage === 'in_progress' ? t('processing.inProgress') : t('processing.body')}</p>
      <p className="text-sm text-muted">{timedOut ? t('processing.timeout') : t('processing.checking')}</p>
    </div>
  );
}
