'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { createGuestCheckoutSession, getGuestCheckoutQuote } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { config } from '@/lib/config';
import { useCart } from '@/lib/cart';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { GuestAddressInput, GuestCheckoutQuoteResponse, GuestCheckoutSessionResponse, UnavailableBundleDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { AccessoryCartLines } from './AccessoryCartLines';
import { AccessoryCartNotices } from './AccessoryCartNotices';
import { AccessorySuggestions } from './AccessorySuggestions';
import { BundleOffers } from './BundleOffers';
import { pushAccessoryNotices, type AccessoryNotice } from './accessory-notice';
import type { NeighborhoodMode } from '@/hooks/useNeighborhoodMode';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { trackBeginCheckout, trackPurchase } from '@/lib/measurement/ecommerce';
import { CheckoutLines } from './CheckoutLines';
import { CheckoutPayBar } from './CheckoutPayBar';
import { VaultUpsellPanel } from './VaultUpsellPanel';
import { useIsDesktop } from './use-is-desktop';
import { GuestCheckoutForm, type Destination } from './GuestCheckoutForm';
import { GuestOrderConfirmation } from './GuestOrderConfirmation';
import { InlineAuthPanel } from './InlineAuthPanel';
import { CodeRow } from '@/components/domain/CodeRow';
import { DISCOUNT_QUOTE_GC_MS, useDiscountCode } from '@/components/domain/useDiscountCode';
import { UnavailableItemsNotice } from './UnavailableItemsNotice';
import { pruneCandidates, pushUnavailableNotice } from './unavailable-notice';
import { CheckoutRetryNotice, PaymentInProgressNotice, type CheckoutRetryOutcome } from './CheckoutRetryNotice';
import { clearGuestRetryToken, readGuestRetry, readGuestRetryToken, saveGuestRetryToken, type GuestRetry } from './guest-retry-token';
import {
  EMPTY_GUEST_ADDRESS,
  toAddressPayload,
  validateGuestForm,
  type GuestErrors,
  type GuestField,
  type GuestFormState,
} from './guest-validation';
import { TrustStrip } from '../_shared/TrustStrip';

export interface GuestCheckoutViewProps {
  /** El pago quedó autorizado: el padre debe mantener esta vista montada (confirmación). */
  onPaid: () => void;
  /**
   * El invitado creó cuenta / inició sesión desde la línea T4 (CHK-MOVIL.2.1) o desde el upsell. El padre
   * (`CheckoutView`) conmuta al flujo con cuenta SIN recargar la ruta: el carrito vive en
   * localStorage y el desglose se re-cotiza, no se reinicia (criterio 46/48).
   */
  onAccountReady: (options: { fromVaultUpsell: boolean }) => void;
}

/**
 * Checkout de INVITADO (PROJECT §J, criterios 45–48b · DESIGN_SYSTEM §15.2–§15.4).
 *
 * Estructura del estado (importante para el criterio 46): el formulario de invitado vive
 * AQUÍ, por encima del panel de identidad (T4), no dentro de él. Por eso ir a "iniciar
 * sesión" y volver a "invitado" no borra el correo ni la dirección ya capturados, y el
 * carrito —que vive en localStorage— nunca se toca al cambiar de vía.
 *
 * v1.68 (§4-R.3) — el invitado recupera su reserva SOLO con `retryOfCheckoutToken`: el
 * `checkoutToken` que devolvió el intento anterior se guarda en **`sessionStorage`** (ámbito
 * pestaña, nunca `localStorage`) y viaja en el body del reintento. Con él: `200 reused` (mismo
 * pedido, mismo PI, token nuevo) o `201` con `supersededOrderIds`; `409 PAYMENT_IN_PROGRESS` bloquea
 * con explicación. Sin él (otra pestaña, token vencido) la reserva propia cuenta como ajena y la
 * respuesta es la de hoy (`ITEM_UNAVAILABLE` ⇒ poda), a propósito: un correo no es identidad.
 */
export function GuestCheckoutView({ onPaid, onAccountReady }: GuestCheckoutViewProps) {
  const t = useTranslations('checkout');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage();
  const cart = useCart();

  /**
   * CHK-MOVIL.2.1 (opción A): sin pantalla de tres vías. El invitado ve su formulario en el primer pintado y la
   * línea T4 abre `InlineAuthPanel` inline (`login`/`register`) sin tocar el formulario ni el carrito (criterio 46).
   */
  const [authPanel, setAuthPanel] = useState<'none' | 'login' | 'register'>('none');
  const isDesktop = useIsDesktop();
  /** L6: un doble toque en PAGAR crea UNA sesión. El estado `creating` llega tarde para el segundo evento del mismo tick. */
  const payInFlight = useRef(false);
  const vaultButtonRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<GuestFormState>({
    email: '',
    emailConfirmed: false,
    acceptedTerms: false,
    address: EMPTY_GUEST_ADDRESS,
  });
  const [touched, setTouched] = useState<Partial<Record<GuestField, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  /** Sube en cada clic en pagar: dispara el foco al resumen de errores (§91). */
  const [submitAttemptId, setSubmitAttemptId] = useState(0);
  const [destination, setDestination] = useState<Destination>('ship');
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [session, setSession] = useState<GuestCheckoutSessionResponse | null>(null);
  /** v1.68: último desenlace de la session, separado del modal (ver `CheckoutView`). */
  const [outcome, setOutcome] = useState<GuestCheckoutSessionResponse | null>(null);
  const [paymentInProgress, setPaymentInProgress] = useState(false);
  /** §AC-UX.5: error de pago por accesorios/paquete (Banner danger junto al botón). */
  const [accessoryPayError, setAccessoryPayError] = useState<string | null>(null);
  const tp = useTranslations('checkout.accessoryPayError');
  const tacc = useTranslations('checkout.accessories');
  const [paid, setPaid] = useState<GuestCheckoutSessionResponse | null>(null);
  /**
   * v1.80.12.5 (§M4-SHIP.19.25): ⛔ sin `422` geográficos. Lo único que la sesión puede devolver sobre la
   * colonia, el municipio o el estado es un `400 {field, max}` de longitud: va bajo su campo (§43.18m.7).
   */
  const [serverAddressError, setServerAddressError] = useState<{ field: 'neighborhood' | 'city' | 'state'; message: string } | null>(null);
  /** El modo de la colonia (§43.18m.1): decide el texto del error y si municipio y estado se exigen. */
  const [geoMode, setGeoMode] = useState<NeighborhoodMode>('pending');
  const ta = useTranslations('addresses');

  /**
   * v1.68.1 (§4-R.5): el quote reconoce la reserva PROPIA solo con `retryOfCheckoutToken` + `email`.
   * El sobre (token + correo con el que se emitió) vive en sessionStorage y no es reactivo: se lee
   * al montar y tras cada session. El correo del quote es el CONFIRMADO en el formulario (§15.3) y,
   * mientras no lo haya —pestaña recargada, formulario vacío—, el guardado con el token: sin él el
   * primer quote iría sin reclamo y podaría la reserva propia. Nunca token sin correo (⇒ 400).
   */
  const [retry, setRetry] = useState<GuestRetry | null>(null);
  useEffect(() => {
    setRetry(readGuestRetry());
  }, []);
  const confirmedEmail = form.emailConfirmed ? form.email.trim().toLowerCase() : '';
  const quoteEmail = confirmedEmail || retry?.email || '';
  const quoteRetry =
    retry && quoteEmail ? { retryOfCheckoutToken: retry.token, email: quoteEmail } : undefined;
  // 💰 §AC.4: accesorios y decks del carrito v3 viajan en la cotización (⛔ sin importes; el servidor los pone).
  const accessoryLines = useMemo(() => cart.accessories.map((a) => ({ accessoryId: a.id, quantity: a.qty })), [cart.accessories]);
  const quotePulls = useMemo(
    () => cart.deckPulls.map((p) => ({ pullToken: p.token, withEnergyBundle: p.withEnergyBundle })),
    [cart.deckPulls],
  );
  // 💰 §DSC.6: el código viaja en quote y sesión. La clave lleva el código: aplicar uno cotiza con
  // `fetchQuery` sobre ESTA misma clave, así que al confirmarlo la query principal ya tiene la respuesta.
  const queryClient = useQueryClient();
  const quoteKey = (code: string | null) =>
    ['guest-checkout-quote', cart.ids, accessoryLines, quotePulls, quoteRetry?.retryOfCheckoutToken ?? null, quoteRetry?.email ?? null, code] as const;
  const quoteFor = (code: string | null) => {
    const extras = accessoryLines.length || quotePulls.length ? { accessoryLines, deckPulls: quotePulls } : undefined;
    // I-1 / 915: sin código, la MISMA llamada de hoy (ni un argumento de más).
    return code
      ? getGuestCheckoutQuote(cart.ids, undefined, quoteRetry, extras, code)
      : getGuestCheckoutQuote(cart.ids, undefined, quoteRetry, extras);
  };
  const [codeForQuote, setCodeForQuote] = useState<string | null>(null);
  const query = useQuery({
    queryKey: quoteKey(codeForQuote),
    queryFn: () => quoteFor(codeForQuote),
    enabled: !cart.isEmpty,
    // Al aparecer el token (tras la primera session) la clave cambia: se conserva el quote anterior
    // mientras llega el nuevo para no desmontar formulario y botón en plena re-cotización.
    placeholderData: keepPreviousData,
  });
  const dsc = useDiscountCode({
    screen: 'direct_ship',
    evaluate: (code) => queryClient.fetchQuery({ queryKey: quoteKey(code), queryFn: () => quoteFor(code), gcTime: DISCOUNT_QUOTE_GC_MS }).then((r) => r.discount),
    current: query.isPlaceholderData ? undefined : query.data?.discount,
  });
  // El código confirmado entra en la clave (y con él en la sesión). Quitarlo vuelve a la cotización de hoy (I-1).
  useEffect(() => {
    setCodeForQuote(dsc.code);
  }, [dsc.code]);

  // §MKT.H.4 `begin_checkout`: una vez por cotización distinta (con el modo `off`, `track` no hace nada).
  const beginCheckoutKey = useRef('');
  useEffect(() => {
    const d = query.data;
    if (!d || query.isPlaceholderData) return;
    const key = `${d.items.map((i) => i.inventoryItemId).join(',')}:${d.breakdown.totalCents}`;
    if (key === beginCheckoutKey.current) return;
    beginCheckoutKey.current = key;
    trackBeginCheckout(d.breakdown, d.items);
  }, [query.data, query.isPlaceholderData]);

  /**
   * v1.21.3-quote-prune (misma mecánica que CheckoutView): las piezas muertas del
   * quote se podan del localStorage en un efecto idempotente y el aviso queda en el
   * store, que sobrevive tanto a la re-cotización como al desmonte de esta vista
   * (si TODO murió, el padre pinta EmptyState + aviso). Sin ciclo: el segundo fetch
   * trae `unavailableItems: []` y el efecto es no-op.
   */
  const unavailable = query.data?.unavailableItems;
  const quoteItems = query.data?.items;
  const { prune } = cart; // estable (useCallback sin deps)
  useEffect(() => {
    if (!unavailable || unavailable.length === 0) return;
    // v1.68.1 §4-R.5: `reservedByYou` nunca se poda (ver `CheckoutView`).
    const dead = pruneCandidates(unavailable, quoteItems);
    if (dead.length === 0) return;
    pushUnavailableNotice(dead);
    prune(dead.map((u) => u.inventoryItemId));
  }, [unavailable, quoteItems, prune]);

  /**
   * §AC-UX.5 / AC-F18 — el carrito SE CORRIGE SOLO con lo que dice el servidor, y el aviso lo cuenta. Efecto
   * idempotente (como la poda de piezas): tras corregir, la clave cambia, se re-cotiza y la respuesta nueva ya no
   * trae nada que corregir. Un `deckPull` sin paquete que se invalida se quita en silencio (no se perdió nada).
   */
  const quoteData = query.data;
  const { removeAccessory, setAccessoryQty, removeDeckPull, deckPulls: localPulls } = cart;
  const quoteIsPlaceholder = query.isPlaceholderData;
  useEffect(() => {
    // Una respuesta de una clave anterior (`keepPreviousData`) no describe el carrito de ahora: sus `index` no casan.
    if (!quoteData || quoteIsPlaceholder) return;
    const out: AccessoryNotice[] = [];
    for (const u of quoteData.unavailableAccessories ?? []) {
      if (u.reason === 'insufficient' && (u.availableQty ?? 0) > 0) {
        setAccessoryQty(u.accessoryId, u.availableQty!);
        out.push({ kind: 'insufficient', accessoryId: u.accessoryId, name: u.name, availableQty: u.availableQty! });
      } else {
        removeAccessory(u.accessoryId);
        out.push({ kind: 'removed', reason: u.reason === 'insufficient' ? 'sold_out' : u.reason, accessoryId: u.accessoryId, name: u.name });
      }
    }
    // v1.86.3 (§AC.19.4, AC-F21): cada `unavailableBundles[i].index` es la posición en los `deckPulls` que se
    // mandaron, y esos salen de `cart.deckPulls` en el mismo orden (`quotePulls`). ⛔ Sin emparejar por `deckSlug`
    // (un `invalid_token` no lo trae) ni por «el que la respuesta no nombra». El aviso lo decide el
    // `withEnergyBundle` de la respuesta: un `deckPull` sin paquete sale en silencio (no se perdió nada).
    const targets = new Map<string, { pull: (typeof localPulls)[number]; bad: UnavailableBundleDTO }>();
    for (const b of quoteData.unavailableBundles ?? []) {
      if (b.reason === 'duplicate') continue; // el carrito ya es único por deck; quitar por slug borraría el bueno
      const local = localPulls[b.index];
      if (!local || targets.has(local.slug)) continue;
      targets.set(local.slug, { pull: local, bad: b });
    }
    for (const { pull, bad: b } of targets.values()) {
      removeDeckPull(pull.slug);
      if (b.withEnergyBundle && b.reason !== 'duplicate') {
        out.push({ kind: 'bundle', reason: b.reason, slug: pull.slug, deckName: pull.deckName ?? null });
      }
    }
    pushAccessoryNotices(out);
    // `localPulls` se lee al llegar la respuesta; no debe re-disparar la corrección por sí solo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteData, quoteIsPlaceholder, removeAccessory, setAccessoryQty, removeDeckPull]);

  // §AC-UX.7: «El envío cambió a {amount}…» entre dos cotizaciones; se borra en la siguiente sin cambio.
  const prevShipping = useRef<number | undefined>(undefined);
  /** §DSC-UX.2: un cambio de envío causado por aplicar/quitar un código NO lleva aviso extra (se ve en el desglose y T9). */
  const prevShippingCode = useRef<string | null>(null);
  const [shippingChangedTo, setShippingChangedTo] = useState<number | null>(null);
  useEffect(() => {
    const fee = quoteData?.breakdown.shippingFeeCents;
    if (fee === undefined) return;
    const codeChanged = prevShippingCode.current !== codeForQuote;
    prevShippingCode.current = codeForQuote;
    if (codeChanged) setShippingChangedTo(null);
    else if (prevShipping.current !== undefined && prevShipping.current !== fee) setShippingChangedTo(fee);
    else if (prevShipping.current === fee) setShippingChangedTo(null);
    prevShipping.current = fee;
    // `codeForQuote` se lee junto con la respuesta; no debe re-disparar el efecto por sí solo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteData]);

  // §DSC-UX.2: al aplicar o quitar un código, TOTAL y PAGAR vuelven a la cotización hasta que exista una sesión nueva.
  const lastCode = useRef<string | null>(null);
  useEffect(() => {
    if (lastCode.current === dsc.code) return;
    lastCode.current = dsc.code;
    setOutcome(null);
  }, [dsc.code]);

  const own = query.data?.ownReservation ?? null;
  const notice: CheckoutRetryOutcome | null =
    outcome ??
    (own
      ? { orderId: own.orderId, orderNumber: own.orderNumber, reservedUntil: own.reservedUntil, own: { expired: own.expired } }
      : null);

  const errors: GuestErrors = useMemo(() => validateGuestForm(form, geoMode), [form, geoMode]);
  // `shippingFeeLabel` sale SIEMPRE del `breakdown` de envío directo (la tarifa REAL): alimenta
  // el hint del radio «envío {amount}» y el upsell «te ahorras {amount}» — es cuánto se ahorra
  // el invitado al NO enviar, NO un dato del desglose de bóveda (N-12).
  const shippingFeeCents = query.data?.breakdown.shippingFeeCents;
  const shippingFeeLabel =
    shippingFeeCents != null ? formatMoneyCents(shippingFeeCents, locale) : undefined;

  // v1.21.4-dual-breakdown (N-12): el resumen conmuta según el destino elegido, SIN refetch —
  // ambos desgloses vienen en la misma respuesta del quote. Bóveda ⇒ `vaultBreakdown` (sin
  // envío); envío directo ⇒ `breakdown`. El total del botón «Pagar» y el `amountLabel` del
  // modal usan ESTE desglose para no contradecir el resumen. (Fallback defensivo al `breakdown`
  // por si un productor/mock parcial omitiera `vaultBreakdown`; el contrato lo garantiza.)
  const activeBreakdown = query.data
    ? destination === 'vault'
      ? query.data.vaultBreakdown ?? query.data.breakdown
      : query.data.breakdown
    : undefined;

  // Pantalla de confirmación: se pinta desde el estado de la transacción recién
  // completada, nunca desde una URL con id adivinable (§15.5).
  if (paid) {
    return (
      <GuestOrderConfirmation
        orderNumber={paid.orderNumber}
        orderId={paid.orderId}
        email={form.email.trim()}
      />
    );
  }

  function patchForm(patch: Partial<GuestFormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }
  function patchAddress(patch: Partial<GuestAddressInput>) {
    setForm((f) => ({ ...f, address: { ...f.address, ...patch } }));
    // Tocar el CP retira el error del servidor sobre la dirección; tocar un campo, el suyo.
    if (patch.postalCode !== undefined && patch.postalCode !== form.address.postalCode) {
      setServerAddressError(null);
    } else {
      for (const f of ['neighborhood', 'city', 'state'] as const) {
        if (patch[f] !== undefined && patch[f] !== form.address[f]) {
          setServerAddressError((cur) => (cur?.field === f ? null : cur));
        }
      }
    }
  }

  function chooseDestination(next: Destination) {
    setDestination(next);
    // Criterio 48: elegir bóveda NO es un error — despliega el upsell in situ.
    setUpsellOpen(next === 'vault');
    setPayError(null);
  }

  /** Bloqueos de PAGO que son CONDICIONES (no errores de campo): §15.4 y §15.9. */
  const payBlockedReason: string | null = upsellOpen || destination === 'vault'
    ? t('guest.payBlocked.vault')
    : errors.emailConfirmed
      ? t('guest.payBlocked.email')
      : null;

  async function pay() {
    if (payInFlight.current) return;
    setSubmitAttempted(true);
    setSubmitAttemptId((n) => n + 1);
    setPayError(null);
    if (destination === 'vault') {
      setUpsellOpen(true);
      return;
    }
    // N-3: el botón ya no se queda mudo. Si faltan datos del formulario (p. ej. teléfono
    // inválido) los campos marcan su error arriba, PERO además avisamos junto al botón para
    // que no parezca que "no hace nada".
    if (Object.keys(errors).length > 0) {
      setPayError(t('guest.formIncomplete'));
      return;
    }

    payInFlight.current = true;
    setCreating(true);
    setPaymentInProgress(false);
    setAccessoryPayError(null);
    let sentBundlePulls: typeof cart.deckPulls = [];
    try {
      // §4-R.3: el token del intento anterior (si sigue vivo) es el reclamo de la reserva propia.
      const retryOfCheckoutToken = readGuestRetryToken() ?? undefined;
      // v1.86.3 (§AC.19.4): el `index` de un `422 ENERGY_BUNDLE_INVALID` es la posición en ESTA lista (solo los que
      // llevan paquete), no en el carrito: se guarda para traducirlo.
      sentBundlePulls = cart.deckPulls.filter((p) => p.withEnergyBundle);
      const sessionPulls = sentBundlePulls.map((p) => ({ pullToken: p.token, withEnergyBundle: true }));
      const res = await createGuestCheckoutSession({
        inventoryItemIds: cart.ids,
        email: form.email.trim(),
        shippingAddress: toAddressPayload(form.address),
        locale,
        acceptedTerms: true,
        fulfillmentMode: 'direct_ship',
        ...(retryOfCheckoutToken ? { retryOfCheckoutToken } : {}),
        // 💰 §AC.4: ⛔ sin importes. Con `withEnergyBundle:false` la sesión no valida nada: solo van los paquetes.
        ...(accessoryLines.length ? { accessoryLines } : {}),
        ...(sessionPulls.length ? { deckPulls: sessionPulls } : {}),
        // 💰 §DSC.6: el código confirmado; sin él la llave no viaja (I-1).
        ...(dsc.code ? { discountCode: dsc.code } : {}),
      });
      // El token recién emitido (también en el `200` de reuso) sustituye al anterior: es la
      // llave del reintento siguiente, con su propio vencimiento.
      const emailUsed = form.email.trim().toLowerCase();
      saveGuestRetryToken(res.checkoutToken, res.checkoutTokenExpiresAt, emailUsed);
      setRetry({ token: res.checkoutToken, email: emailUsed });
      setOutcome(res);
      setSession(res);
    } catch (e) {
      // 💰 §DSC.6 / C12: `422 DISCOUNT_CODE_*` o `429` ⇒ la sesión no creó nada y NO se cobró. El código se quita con
      // aviso, la clave cambia y la cotización nueva pinta el total sin código antes de volver a pulsar.
      if (dsc.handleSessionError(e)) {
        // nada más: el aviso vive en el renglón y la re-cotización es automática.
      } else if (e instanceof ApiClientError && e.code === 'VAULT_REQUIRES_ACCOUNT') {
        // 422 VAULT_REQUIRES_ACCOUNT (details.upsell) NUNCA se pinta como error: es la
        // señal del upsell de bóveda (contrato §4-G.2, criterio 48).
        setDestination('vault');
        setUpsellOpen(true);
      } else if (
        e instanceof ApiClientError &&
        e.code === 'VALIDATION_ERROR' &&
        (e.details?.field === 'neighborhood' || e.details?.field === 'city' || e.details?.field === 'state') &&
        (typeof e.details?.max === 'number' || typeof e.details?.max === 'string')
      ) {
        // §43.18m.7: la cota la da el servidor (⛔ la pantalla no la replica). Cero órdenes creadas.
        setServerAddressError({ field: e.details.field, message: ta('geo.tooLong', { max: String(e.details.max) }) });
        setPayError(getMessage(e));
      } else if (e instanceof ApiClientError && e.code === 'PAYMENT_IN_PROGRESS') {
        // §4-R.2/.3: el PI del intento anterior ya está en curso o cobrado ⇒ no se abre otro. El
        // invitado no tiene `/orders/:id`: el bloqueo explica y ofrece reintentar en un momento.
        setPaymentInProgress(true);
      } else if (
        e instanceof ApiClientError &&
        (e.code === 'ACCESSORY_UNAVAILABLE' || e.code === 'ACCESSORY_INSUFFICIENT_STOCK' || e.code === 'ENERGY_BUNDLE_INVALID')
      ) {
        // 💰 §AC.4 / §AC-UX.5: la sesión valida ANTES de crear nada ⇒ «No se cobró nada» es verdad. El carrito se
        // corrige y la clave nueva re-cotiza sola.
        setAccessoryPayError(accessoryPayErrorOf(e, sentBundlePulls));
      } else if (
        e instanceof ApiClientError &&
        (e.code === 'ITEM_UNAVAILABLE' || e.code === 'NOT_FOUND')
      ) {
        // v1.21.3-F2 — carrera "pieza vendida ENTRE el quote y el pago": la session
        // sigue estricta (anti double-sell, contrato §4-G.2), así que aquí se
        // RE-COTIZA. El quote nuevo trae la pieza en `unavailableItems` y la
        // maquinaria existente (efecto de poda + UnavailableItemsNotice) poda el
        // carrito y avisa sola: el banner ES el aviso, no se pinta además el mensaje
        // genérico junto al botón (evitaría un doble mensaje contradictorio).
        // Respaldo: si la re-cotización MISMA falla, sí se muestra el mensaje.
        const requote = await query.refetch();
        if (requote.error) setPayError(getMessage(e));
      } else {
        setPayError(getMessage(e));
      }
    } finally {
      payInFlight.current = false;
      setCreating(false);
    }
  }

  /**
   * §AC-UX.7 / AC-F8: con accesorios o paquetes, el panel de bóveda avisa qué NO va a la bóveda. `{n}` cuenta
   * unidades (+1 por paquete); `{amount}` es la suma de importes YA calculados por el servidor (⛔ sin precio propio).
   */
  function vaultNoticeFor(q: GuestCheckoutQuoteResponse) {
    if (!q.vaultExcludesAccessories) return undefined;
    const lines = q.accessoryLines ?? [];
    const bundles = q.energyBundles ?? [];
    const n = lines.reduce((acc, l) => acc + l.quantity, 0) + bundles.length;
    const amount = lines.reduce((acc, l) => acc + l.lineTotalCents, 0) + bundles.reduce((acc, b) => acc + b.priceCents, 0);
    return (
      <div className="mt-4 border-t border-border pt-4">
        <p className="eyebrow">{tacc('vaultEyebrow')}</p>
        <p className="mt-2 text-sm leading-relaxed text-text">{tacc('vaultNotice', { n, amount: formatMoneyCents(amount, locale) })}</p>
      </div>
    );
  }

  /** §AC-UX.5 «Errores al pagar»: corrige el carrito y devuelve el texto (⛔ sin cifras propias). */
  function accessoryPayErrorOf(e: ApiClientError, sentBundlePulls: typeof cart.deckPulls): string {
    const d = e.details ?? {};
    const accessoryId = typeof d.accessoryId === 'string' ? d.accessoryId : null;
    // v1.86.3 (§AC.19.4): `index` manda (con `invalid_token` el `deckSlug` es null); `deckSlug` es el respaldo de un
    // servidor anterior sin `index`.
    const byIndex = typeof d.index === 'number' ? sentBundlePulls[d.index] : undefined;
    const deckSlug = byIndex?.slug ?? (typeof d.deckSlug === 'string' ? d.deckSlug : null);
    const lines = query.data?.accessoryLines ?? [];
    const bundles = query.data?.energyBundles ?? [];
    const bundleError = (slug: string | null) => {
      const pull = slug ? cart.deckPulls.find((p) => p.slug === slug) : undefined;
      const deck = pull?.deckName ?? bundles.find((b) => b.deckSlug === slug)?.deckName ?? null;
      if (slug) cart.removeDeckPull(slug);
      return deck ? tp('bundle', { deck }) : tp('bundleNoName');
    };
    if (e.code === 'ENERGY_BUNDLE_INVALID') return bundleError(deckSlug);
    if (e.code === 'ACCESSORY_UNAVAILABLE') {
      if (accessoryId) cart.removeAccessory(accessoryId);
      return tp('unavailable');
    }
    // ACCESSORY_INSUFFICIENT_STOCK: ¿renglón suelto o componente de un paquete?
    const line = accessoryId ? lines.find((l) => l.accessoryId === accessoryId) : undefined;
    if (!line && accessoryId) {
      const owner = bundles.find((b) => b.energies.some((x) => x.accessoryId === accessoryId));
      if (owner) return bundleError(owner.deckSlug);
    }
    const n = typeof d.availableQty === 'number' ? d.availableQty : 0;
    const name = line?.name ?? null;
    if (n > 0) {
      if (accessoryId) cart.setAccessoryQty(accessoryId, n);
      return name ? tp('insufficient', { name, n }) : tp('insufficientNoName', { n });
    }
    if (accessoryId) cart.removeAccessory(accessoryId);
    return name ? tp('soldOut', { name }) : tp('soldOutNoName');
  }

  function onConfirmed(status?: 'succeeded' | 'processing') {
    // El pago quedó autorizado; el backend lo asienta por webhook (payment_intent.succeeded)
    // y ahí manda el correo con el enlace de seguimiento (criterio 49).
    const created = session;
    setSession(null);
    setOutcome(null);
    // Pedido pagado: ya no hay reserva que reintentar; el token de reintento se retira.
    clearGuestRetryToken();
    setRetry(null);
    onPaid();
    cart.clear();
    setPaid(created);
    // §MKT.H.4: `purchase` del navegador solo con `succeeded` sin redirección (id `p_<Order.id>`).
    // ⛔ AL FINAL, después de todo el estado de dinero (TL R1): la medición nunca va delante del cobro.
    if (status === 'succeeded' && created) trackPurchase(created.orderId, created.breakdown, query.data?.items);
  }

  const data = query.data;
  // 💰 F-SP-5 (AC-F9): el importe del botón es el de la SESIÓN; sin sesión, sin importe.
  const payLabel = creating
    ? t('preparing')
    : outcome
      ? t('pay', { amount: formatMoneyCents(outcome.breakdown.totalCents, locale) })
      : t('payNoAmount');
  const payDisabled = !!payBlockedReason || paymentInProgress;

  // §DSC-UX.2: el descuento solo se pinta con envío a domicilio (el desglose de bóveda es el de hoy).
  const shownDiscount = destination === 'ship' ? dsc.applied : null;
  // T3a (CHK-MOVIL.4): importes del quote, ⛔ nunca del front. Con envío 0, la variante «envío gratis».
  // C11 (§DSC-UX.2): con un descuento de mercancía, la línea 1 lo dice; con un código de envío gratis se queda T3a.
  // Forma CORTA «Con descuento −MX$X» (el respaldo que §DSC-UX.2 prevé): la larga midió 123 px de barra a 360 con un
  // código de 20 caracteres e importes de 5 cifras (DL3, `e2e/discount-codes.spec.ts`, 2026-10-25); el tope es 120.
  const barLine = activeBreakdown && shownDiscount && shownDiscount.kind !== 'free_shipping'
    ? t('discount.barShort', { amount: formatMoneyCents(shownDiscount.discountCents, locale) })
    : activeBreakdown
    ? activeBreakdown.shippingFeeCents === 0
      ? t('bar.includesShippingFree', { fee: formatMoneyCents(activeBreakdown.processingFeeCents, locale) })
      : t('bar.includesShipping', {
          shipping: formatMoneyCents(activeBreakdown.shippingFeeCents ?? 0, locale),
          fee: formatMoneyCents(activeBreakdown.processingFeeCents, locale),
        })
    : '';
  // T9: con CUALQUIER clase (dueño 2026-10-25, `HECHOS.md` «Envío gratis desde MX$4,000 para CUALQUIER pedido») y
  // solo si falta algo; el número es el del backend (ENV-F1). `null` no pinta T9 —caja grande (contrato v1.109.5,
  // `boxFeeApplies`) o un servidor que mande null (fuera de contrato)—: la falta nunca se calcula aquí.
  const remaining = data?.shippingRule?.kind != null ? data.shippingRule.freeShippingRemainingCents : null;

  const breakdownNode = data ? (
    <>
      <AmountBreakdown
        breakdown={activeBreakdown ?? data.breakdown}
        variant="purchase"
        productsSubtotal={(data.accessoryLines?.length ?? 0) + (data.energyBundles?.length ?? 0) > 0}
        // §AC-UX.7: ⛔ ni `label` ni `code` ni `review` de la caja: solo que el envío sale de su tamaño.
        shippingNote={data.shippingBox ? tacc('boxHint') : undefined}
        discount={shownDiscount}
      />
    </>
  ) : null;

  // Desenlaces de pago, accesorios y reintento: en el `aside` (lg+) o en flujo sobre las notas legales (<lg).
  const notices = (
    <>
      <div role="status" aria-live="polite" className="text-xs text-muted">
        {shippingChangedTo !== null && tacc('shippingChanged', { amount: formatMoneyCents(shippingChangedTo, locale) })}
      </div>
      {payError && (
        <p role="alert" className="mt-6 font-mono text-xs text-accent [overflow-wrap:anywhere]">
          {payError}
        </p>
      )}
      {accessoryPayError && (
        <Banner variant="danger" role="alert" className="mt-6">
          {accessoryPayError}
        </Banner>
      )}
      {/* v1.68: reuso / sustitución / cuenta atrás de la reserva (§4-R.3). */}
      <CheckoutRetryNotice outcome={notice} className="mt-6" />
      {paymentInProgress && <PaymentInProgressNotice guest retrying={creating} onRetry={pay} className="mt-6" />}
    </>
  );

  return (
    <div style={isDesktop ? undefined : { paddingBottom: 'calc(var(--sticky-bottom-h, 0px) + 16px)' }}>
      <div className="gutter pb-7 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        {/* MKT-CONV.4 (B2, criterio 945): franja de confianza bajo el título, sin scroll; nunca en la barra de PAGAR. */}
        <TrustStrip className="mt-1" />
      </div>

      {/* Aviso informativo de poda (v1.21.3), FUERA de QueryState: sobrevive al estado
          de carga de la re-cotización que la propia poda dispara. */}
      <UnavailableItemsNotice className="gutter mb-6 max-w-[680px]" />
      <AccessoryCartNotices className="gutter mb-6 max-w-[680px]" />

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {data && (
          // CHK-MOVIL.1: una pista `minmax(0,1fr)` en <lg (antes, la implícita `auto` crecía al mínimo del hijo
          // más ancho: 439 px a 390, medido); los 420 px del resumen solo desde `lg`. Hijos directos `min-w-0`.
          <div className="grid grid-cols-[minmax(0,1fr)] border-t border-border lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="gutter min-w-0 border-b border-border pb-14 pt-4 lg:border-b-0 lg:border-r">
              {/* Líneas (2 + «Ver {n} más») y lo ya añadido: el motivo de la compra no desaparece. */}
              <CheckoutLines items={data.items} onRemove={(id) => cart.remove(id)} />

              {/* 💰 §AC-UX.5: accesorios y paquetes después de cartas y sellado; cifras de la cotización. */}
              <AccessoryCartLines
                lines={data.accessoryLines ?? []}
                bundles={data.energyBundles ?? []}
                qtyOf={(id) => cart.accessories.find((a) => a.id === id)?.qty}
                onQty={(id, q) => cart.setAccessoryQty(id, q)}
                onRemove={(id) => cart.removeAccessory(id)}
                onRemoveBundle={(slug) => cart.setBundle(slug, false)}
              />

              {/* T4 (CHK-MOVIL.2.1): las otras dos vías del criterio 46, a un toque, inline y sin perder nada. */}
              <div className="mt-2 border-t border-border pt-1">
                <p className="text-sm leading-relaxed text-muted">
                  {t.rich('entryLine', {
                    login: (chunks) => (
                      <button
                        type="button"
                        aria-expanded={authPanel === 'login'}
                        aria-controls="identity-panel"
                        onClick={() => setAuthPanel(authPanel === 'login' ? 'none' : 'login')}
                        className="inline-flex min-h-[44px] items-center text-text underline underline-offset-4 hover:text-accent"
                      >
                        {chunks}
                      </button>
                    ),
                    register: (chunks) => (
                      <button
                        type="button"
                        aria-expanded={authPanel === 'register'}
                        aria-controls="identity-panel"
                        onClick={() => setAuthPanel(authPanel === 'register' ? 'none' : 'register')}
                        className="inline-flex min-h-[44px] items-center text-text underline underline-offset-4 hover:text-accent"
                      >
                        {chunks}
                      </button>
                    ),
                  })}
                </p>
                <div id="identity-panel">
                  {authPanel !== 'none' && (
                    <div className="max-w-[420px] pb-8 pt-4">
                      <InlineAuthPanel
                        variant={authPanel}
                        defaultEmail={form.email}
                        defaultName={form.address.recipientName}
                        neutralEmailTaken={t('vaultUpsell.emailTakenNeutral')}
                        onSuccess={() => onAccountReady({ fromVaultUpsell: false })}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* CHK-MOVIL.2.3 · fila de destino ANTES del primer campo: envío con su importe y, debajo, la bóveda
                  (REQUIERE CUENTA) — primer anuncio de la bóveda en el checkout. Sigue seleccionable (criterio 48):
                  nada de `disabled`, candado ni `Banner danger`; abre el `VaultUpsellPanel` (§15.4) sin cambios. */}
              <section aria-labelledby="guest-destination-group" className="mt-2 border-y border-border py-2.5">
                <h2 id="guest-destination-group" className="sr-only">
                  {t('destination.eyebrow')}
                </h2>
                <div className="flex min-h-8 items-baseline justify-between gap-3">
                  <span className={destination === 'ship' ? 'text-sm text-text' : 'text-sm text-muted'}>
                    {t('destination.ship')}
                  </span>
                  {shippingFeeLabel && (
                    <span className="tabular shrink-0 font-mono text-[11px] text-muted">
                      {t('destination.shipFeeHint', { amount: shippingFeeLabel })}
                    </span>
                  )}
                </div>
                {/* §AC-UX.7: sin cartas ni sellado no hay nada que guardar ⇒ sin opción de bóveda. */}
                {data.items.length > 0 && (
                  <button
                    ref={vaultButtonRef}
                    type="button"
                    aria-expanded={upsellOpen}
                    aria-controls="vault-upsell-panel"
                    onClick={() => chooseDestination(upsellOpen ? 'ship' : 'vault')}
                    className="flex min-h-[44px] w-full flex-wrap items-baseline gap-x-2 text-left text-sm text-text"
                  >
                    <span className="underline underline-offset-4">{t('destination.vault')}</span>
                    <span className="font-mono text-[11px] uppercase tracking-label text-muted">
                      {t('destination.vaultRequiresAccount')}
                    </span>
                  </button>
                )}
                <div id="vault-upsell-panel">
                  {upsellOpen && (
                    <VaultUpsellPanel
                      shippingFeeLabel={shippingFeeLabel}
                      defaultEmail={form.email}
                      defaultName={form.address.recipientName}
                      onDismiss={() => {
                        setUpsellOpen(false);
                        setDestination('ship');
                      }}
                      onAccountReady={() => onAccountReady({ fromVaultUpsell: true })}
                      onEscape={() => vaultButtonRef.current?.focus()}
                      notice={vaultNoticeFor(data)}
                    />
                  )}
                </div>
              </section>
              {/* T9 (§DSC-UX.2): el número es el del servidor, medido sobre la mercancía YA descontada; se anuncia. */}
              <div aria-live="polite">
                {destination === 'ship' && remaining != null && remaining > 0 && (
                  <p data-testid="free-shipping-remaining" className="mt-2 font-mono text-xs text-muted">
                    {t('freeShippingRemaining', { remaining: formatMoneyCents(remaining, locale) })}
                  </p>
                )}
              </div>

              {/* §DSC-UX.1 variante A (dueño 2026-10-25, `HECHOS.md` «Códigos de descuento: pantallas y P-DSC-3»):
                  bajo «Envío a mi domicilio» y T9, ANTES de los datos. Solo con envío: la bóveda pide cuenta. */}
              {destination === 'ship' && data.items.length + (data.accessoryLines?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <CodeRow {...dsc.rowProps} />
                </div>
              )}

              <div className="pt-8">
                <GuestCheckoutForm
                  state={form}
                  onChange={patchForm}
                  onAddressChange={patchAddress}
                  errors={errors}
                  touched={touched}
                  onBlurField={(field) => setTouched((s) => ({ ...s, [field]: true }))}
                  submitAttempted={submitAttempted}
                  submitAttemptId={submitAttemptId}
                  serverAddressError={serverAddressError}
                  onGeoModeChange={setGeoMode}
                />
              </div>

              {/* CHK-MOVIL.2.5: paquetes y sugerencias DESPUÉS del último campo y de la casilla de términos.
                  §AC-UX.8b y §AC-UX.6: solo con envío a domicilio; ⛔ nunca modales, nunca en el resumen. */}
              {destination === 'ship' && (
                <>
                  <BundleOffers offers={data.energyBundleOffers ?? []} onAdd={(slug) => cart.setBundle(slug, true)} />
                  <AccessorySuggestions
                    exclude={cart.accessories.map((a) => a.id)}
                    onAdd={(id) => cart.addAccessory(id, 1)}
                  />
                </>
              )}

              {/* <lg: los desenlaces de pago van en flujo, sobre las notas legales (CHK-MOVIL.2.4). */}
              {!isDesktop && <div className="mt-6">{notices}</div>}

              {/* Criterio 48b: el aviso de ventas finales con enlace a términos lo lleva la casilla de términos del
                  formulario (con T8 debajo); B4 (BRIEF_MKT §4) prohíbe repetirlo aquí — candado `final-sale-once.test.tsx`. */}
              <p className="rule-note-quiet mt-10 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('cfdiNotice')}
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('afterPaymentGuest')}
              </p>
              {config.useMocks && !isDesktop && (
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{t('stripeMock')}</p>
              )}
            </div>

            {isDesktop && (
              <aside className="gutter h-fit min-w-0 pb-14 pt-8 lg:sticky lg:top-[var(--app-header-h,0px)] lg:px-10">
                {/* Artboard: cabecera «Resumen» con regla fuerte de cierre. */}
                <h2 className="eyebrow border-b border-border-strong pb-4 text-text">{t('summary')}</h2>
                <div className="mt-5">{breakdownNode}</div>
                {notices}
                <Button
                  variant="accent"
                  loading={creating}
                  disabled={payDisabled}
                  aria-describedby={payBlockedReason ? 'pay-blocked-note' : undefined}
                  onClick={pay}
                  className="mt-7 min-h-[54px] w-full tracking-eyebrow"
                >
                  {payLabel}
                </Button>
                {/* Nunca un botón apagado y mudo: la condición se explica (§15.9). */}
                {payBlockedReason && (
                  <p id="pay-blocked-note" className="mt-4 text-xs leading-relaxed text-muted">
                    {payBlockedReason}
                  </p>
                )}
                {config.useMocks && (
                  <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{t('stripeMock')}</p>
                )}
              </aside>
            )}
          </div>
        )}
      </QueryState>

      {data && !isDesktop && (
        <CheckoutPayBar
          summaryLine={barLine}
          blockedReason={payBlockedReason}
          totalLabel={formatMoneyCents((outcome?.breakdown ?? activeBreakdown ?? data.breakdown).totalCents, locale)}
          payLabel={creating ? t('preparing') : t('payNoAmount')}
          loading={creating}
          disabled={payDisabled}
          onPay={pay}
          breakdown={breakdownNode}
        />
      )}

      <StripePaymentModal
        open={!!session}
        onClose={() => setSession(null)}
        clientSecret={session?.stripe.clientSecret ?? null}
        /*
         * El `return_url` de un 3DS con redirección lleva al SEGUIMIENTO PÚBLICO con el
         * `checkoutToken` que acaba de devolver el checkout (§4-G.2/§4-G.7a): tras el
         * redirect el navegador puede perder el estado y, sin sesión, es la única forma de
         * que el invitado siga viendo su pedido. La página mueve el token al body y lo
         * borra de la URL (`history.replaceState`).
         *
         * v1.21.1 — ese token dura **120 minutos**, no 90 días: es un puente para la
         * confirmación, NO el enlace duradero. El enlace de 90 días llega por correo al
         * liquidar, así que esta URL no se ofrece para guardar. Pasadas las 2 h cae en la
         * pantalla neutra, que ofrece el reenvío.
         */
        returnUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/pedido?token=${encodeURIComponent(
          session?.checkoutToken ?? '',
        )}`}
        title={t('payTitle')}
        // 💰 F-SP-5: el modal enseña el total de la SESIÓN (lo que Stripe cobra), ⛔ nunca el de la cotización.
        amountLabel={session ? formatMoneyCents(session.breakdown.totalCents, locale) : undefined}
        onConfirmed={onConfirmed}
      />
    </div>
  );
}
