'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { createCheckoutSession, getCheckoutQuote } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { config } from '@/lib/config';
import { useCart } from '@/lib/cart';
import type { AppLocale } from '@/i18n/routing';
import type { CheckoutSessionResponse } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { trackBeginCheckout, trackPurchase } from '@/lib/measurement/ecommerce';
import { EmailNotVerifiedNotice } from '@/components/domain/EmailNotVerifiedNotice';
import { useSession } from '@/lib/session';
import { GuestCheckoutView } from './GuestCheckoutView';
import { UnavailableItemsNotice } from './UnavailableItemsNotice';
import { clearUnavailableNotice, pruneCandidates, pushUnavailableNotice } from './unavailable-notice';
import { clearAccessoryNotices } from './accessory-notice';
import { AccessoryCartNotices } from './AccessoryCartNotices';
import { SignedInAccessoriesBlock } from './SignedInAccessoriesBlock';
import { CheckoutRetryNotice, PaymentInProgressNotice, type CheckoutRetryOutcome } from './CheckoutRetryNotice';
import { PrivacySiteNote } from '@/components/legal/PrivacyNoticeLink';
import { CheckoutLines } from './CheckoutLines';
import { CheckoutPayBar } from './CheckoutPayBar';
import { useIsDesktop } from './use-is-desktop';

/**
 * 6e — Los renglones del carrito a la izquierda y el desglose a la derecha, en el
 * orden del contrato: subtotal, IVA, costo de procesamiento, total. Los tres avisos
 * legales van como notas al margen con regla —bermellón el que compromete (ventas
 * finales), fina los informativos— en vez de tres cajas de color apiladas.
 *
 * WS-F · F1 — El pago pasa de un stub a Stripe REAL: `pay()` crea la sesión de checkout
 * (`POST /checkout/session`) y abre el `StripePaymentModal` con el `clientSecret`. El pago se
 * asienta por webhook (`payment_intent.succeeded`), así que tras confirmar mostramos
 * "procesando" y limpiamos el carrito. Un `403 EMAIL_NOT_VERIFIED` muestra el banner de
 * verificación (reusa el patrón existente).
 *
 * v1.21-guest-checkout — esta vista es ahora el CONMUTADOR de las dos naturalezas del
 * checkout, en la MISMA ruta `/checkout` (criterio 46):
 *  - CON sesión: exactamente el flujo de abajo, sin un solo cambio de comportamiento
 *    (`/checkout/quote` → `/checkout/session` → Stripe, destino bóveda).
 *  - SIN sesión: `GuestCheckoutView` (formulario directo + línea T4 + upsell
 *    de bóveda + `/checkout/guest/*`). Un invitado NUNCA toca un endpoint `customer` ni ve
 *    `EmailNotVerifiedNotice` (contrato §4-G.0-3 / §4-G.8, DESIGN_SYSTEM §15.3.2).
 * Al crear cuenta/iniciar sesión desde el flujo de invitado, `useSession` reacciona y esta
 * misma vista conmuta al flujo con cuenta sin recargar la ruta: el carrito (localStorage)
 * se conserva y el desglose se re-cotiza.
 *
 * v1.68 (§4-R, «la reserva tiene DUEÑO») — el REINTENTO tras un intento caído (modal cerrado,
 * 3DS abandonado, pestaña recargada): `POST /checkout/session` ya no responde `ITEM_UNAVAILABLE`
 * contra la propia reserva. Cuatro desenlaces, y los cuatro se pintan:
 *  - `200 reused` ⇒ `CheckoutRetryNotice` («mismo pedido, mismo cobro») + cuenta atrás con el
 *    `reservedUntil` del servidor;
 *  - `201` con `supersededOrderIds` ⇒ aviso «tu intento anterior se canceló; solo se cobra este»;
 *  - `409 PAYMENT_IN_PROGRESS` ⇒ `PaymentInProgressNotice`: bloqueo explicado, enlace al pedido
 *    (`details.orderId`) y «Reintentar en un momento». El botón «Pagar» se apaga mientras tanto;
 *  - `409 ITEM_UNAVAILABLE` ⇒ **otro** cliente la tiene: la poda de abajo SE CONSERVA.
 *
 * v1.68.1 (§4-R.5) — el QUOTE conoce la reserva propia: `items[].reservedByYou` **no se poda nunca**
 * (es la pieza que la sesión reutiliza) y `ownReservation` se pinta ANTES de pagar: cuenta atrás con
 * su `reservedUntil`, o «tu reserva venció: al pagar se renovará» si `expired` (la sesión sustituye).
 */
export function CheckoutView() {
  const t = useTranslations('checkout');
  const tn = useTranslations('nav');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage();
  const cart = useCart();
  const { isAuthenticated, ready } = useSession();
  // true si la sesión nació del upsell de bóveda: el desglose se re-cotizó sin envío y hay
  // que anunciarlo (§15.4, estado "éxito" del panel).
  const [vaultUpsellDone, setVaultUpsellDone] = useState(false);
  // El invitado ya pagó: la confirmación (con su número de pedido y la oferta de cuenta)
  // debe sobrevivir tanto al vaciado del carrito como a que el reclamo cree la sesión.
  const [guestPaid, setGuestPaid] = useState(false);
  const [paid, setPaid] = useState(false);
  const [creating, setCreating] = useState(false);
  const [session, setSession] = useState<CheckoutSessionResponse | null>(null);
  /**
   * v1.68: el último desenlace de `POST /checkout/session`, SEPARADO de `session` (que es el
   * modal): al cerrar el modal la reserva sigue siendo del cliente y su cuenta atrás tiene que
   * seguir a la vista — es lo que le dice que al volver a pulsar «Pagar» recupera, no duplica.
   */
  const [outcome, setOutcome] = useState<CheckoutSessionResponse | null>(null);
  const [paymentInProgress, setPaymentInProgress] = useState<{ orderId?: string; orderNumber?: string } | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  /** L6: un doble toque en PAGAR crea UNA sesión (el estado `creating` llega tarde para el 2.º evento del tick). */
  const payInFlight = useRef(false);

  const query = useQuery({
    queryKey: ['checkout-quote', cart.ids],
    queryFn: () => getCheckoutQuote(cart.ids),
    // Solo con sesión: `/checkout/quote` es `customer` y un invitado cotiza por
    // `/checkout/guest/quote` (contrato §4-G.0-3). Así no se dispara un 401 inútil.
    enabled: cart.ids.length > 0 && ready && isAuthenticated,
  });

  // §MKT.H.4 `begin_checkout`: una vez por cotización distinta (con el modo `off`, `track` no hace nada).
  const beginCheckoutKey = useRef('');
  useEffect(() => {
    const d = query.data;
    if (!d) return;
    const key = `${d.items.map((i) => i.inventoryItemId).join(',')}:${d.breakdown.totalCents}`;
    if (key === beginCheckoutKey.current) return;
    beginCheckoutKey.current = key;
    trackBeginCheckout(d.breakdown, d.items);
  }, [query.data]);

  /**
   * v1.21.3-quote-prune: si el quote trae piezas muertas, se PODAN del localStorage
   * y se registra el aviso. Efecto idempotente (nunca en render): la poda cambia
   * `cart.ids` → la queryKey cambia → se re-cotiza SOLO con ids vivos y el nuevo
   * fetch trae `unavailableItems: []` → este efecto ya no hace nada (push dedupe +
   * prune no-op), así que no hay ciclo. El aviso vive en el store para sobrevivir
   * a esa re-cotización.
   */
  const unavailable = query.data?.unavailableItems;
  const quoteItems = query.data?.items;
  const { prune } = cart; // estable (useCallback sin deps)
  useEffect(() => {
    if (!unavailable || unavailable.length === 0) return;
    // v1.68.1 §4-R.5: una pieza `reservedByYou` NUNCA se poda, aunque un servidor la listara a la
    // vez como no disponible: podarla es perder la reserva que `session` iba a reutilizar.
    const dead = pruneCandidates(unavailable, quoteItems);
    if (dead.length === 0) return;
    pushUnavailableNotice(dead);
    prune(dead.map((u) => u.inventoryItemId));
  }, [unavailable, quoteItems, prune]);

  // v1.68.1: la reserva propia que el quote reporta, pintada antes de pagar (si aún no hay desenlace).
  const own = query.data?.ownReservation ?? null;
  const notice: CheckoutRetryOutcome | null =
    outcome ??
    (own
      ? { orderId: own.orderId, orderNumber: own.orderNumber, reservedUntil: own.reservedUntil, own: { expired: own.expired } }
      : null);

  // Al salir del checkout el aviso caduca: solo lo conserva la sesión de compra actual.
  useEffect(
    () => () => {
      clearUnavailableNotice();
      clearAccessoryNotices();
    },
    [],
  );

  // §AC (carrito v3): vacío ⇔ sin piezas, sin accesorios y sin paquete (un deck sin paquete no cuenta).
  if (cart.isEmpty && !paid && !guestPaid) {
    // Carrito vacío — incluido el caso "todo el carrito murió": EmptyState + aviso,
    // NUNCA la pantalla de error genérico ni un botón de reintentar (contrato §4).
    return (
      <div className="gutter py-14">
        <UnavailableItemsNotice className="mx-auto mb-10 max-w-[620px]" />
        <AccessoryCartNotices className="mx-auto mb-10 max-w-[620px]" />
        <EmptyState
          title={t('empty')}
          action={
            <Link
              href="/catalog"
              className="inline-flex min-h-[44px] items-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
            >
              {tn('catalog')}
            </Link>
          }
        />
      </div>
    );
  }

  // Sin sesión → checkout de invitado, en la misma ruta (criterio 45/46). Mientras la
  // sesión no está resuelta (`ready=false`, SSR y primer render) no se pinta ninguna de las
  // dos naturalezas, para no hacer parpadear el flujo equivocado.
  if (!ready && !guestPaid) {
    return (
      <div className="gutter py-14" aria-busy="true">
        <p className="font-mono text-sm text-muted">{tc('loading')}</p>
      </div>
    );
  }
  // `guestPaid` manda sobre la sesión: si el invitado crea cuenta desde el reclamo
  // post-compra, la confirmación NO se desmonta a media conversión (criterios 49/54).
  if (guestPaid || !isAuthenticated) {
    return (
      <GuestCheckoutView
        onPaid={() => setGuestPaid(true)}
        onAccountReady={({ fromVaultUpsell }) => setVaultUpsellDone(fromVaultUpsell)}
      />
    );
  }

  if (paid) {
    return (
      <div className="gutter max-w-2xl py-16">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('processingTitle')}</h1>
        <p className="rule-note mt-6 text-[15px] leading-[1.7] text-muted">{t('processingBody')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/orders"
            className="inline-flex min-h-[44px] items-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
          >
            {tn('orders')}
          </Link>
          <Link
            href="/vault"
            className="inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
          >
            {tn('vault')}
          </Link>
        </div>
      </div>
    );
  }

  async function pay() {
    if (payInFlight.current) return;
    payInFlight.current = true;
    setCreating(true);
    setPayError(null);
    setEmailNotVerified(false);
    setPaymentInProgress(null);
    try {
      const res = await createCheckoutSession(cart.ids);
      setOutcome(res);
      setSession(res);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'EMAIL_NOT_VERIFIED') {
        setEmailNotVerified(true);
      } else if (e instanceof ApiClientError && e.code === 'PAYMENT_IN_PROGRESS') {
        // §4-R.2: el PI del intento anterior ya no se puede cancelar ⇒ el servidor no crea
        // otro. `details: { orderId, orderNumber }` — se leen defensivos (sin cifra inventada).
        const d = e.details ?? {};
        setPaymentInProgress({
          orderId: typeof d.orderId === 'string' ? d.orderId : undefined,
          orderNumber: typeof d.orderNumber === 'string' ? d.orderNumber : undefined,
        });
      } else if (
        e instanceof ApiClientError &&
        (e.code === 'ITEM_UNAVAILABLE' || e.code === 'NOT_FOUND')
      ) {
        // v1.21.3-F2 — carrera "pieza vendida ENTRE el quote y el pago": la session
        // sigue estricta (anti double-sell, contrato §4), así que aquí se RE-COTIZA.
        // El quote nuevo trae la pieza en `unavailableItems` y la maquinaria existente
        // (efecto de poda + UnavailableItemsNotice) poda el carrito y avisa sola: el
        // banner ES el aviso, no se pinta además el mensaje genérico junto al botón
        // (evitaría un doble mensaje contradictorio). Respaldo: si la re-cotización
        // MISMA falla, sí se muestra el mensaje del error original.
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

  function onConfirmed(status?: 'succeeded' | 'processing') {
    const confirmed = session;
    // El pago quedó autorizado; el backend lo asienta por webhook. Limpiamos el carrito y
    // mostramos "procesando" (la titularidad pasa a settled cuando el webhook liquida).
    setSession(null);
    setOutcome(null);
    cart.clear();
    setPaid(true);
    // §MKT.H.4: `purchase` del navegador solo con `succeeded` sin redirección; mismo id que CAPI
    // (`p_<Order.id>`). Con el modo `off` no hace nada. El servidor lo manda siempre (§14.6).
    // ⛔ AL FINAL, después de todo el estado de dinero (TL R1): la medición nunca va delante del cobro.
    if (status === 'succeeded' && confirmed) trackPurchase(confirmed.orderId, confirmed.breakdown, query.data?.items);
  }

  const data = query.data;
  const payLabel = creating
    ? t('preparing')
    : data
      ? t('pay', { amount: formatMoneyCents(data.breakdown.totalCents, locale) })
      : t('payNoAmount');

  // Desenlaces (verificación de correo, error, reintento, pago en curso): `aside` en lg+, en flujo en <lg.
  const notices = (
    <>
      {/* Éxito del upsell de bóveda (§15.4): el desglose se re-cotizó sin envío. */}
      {vaultUpsellDone && (
        <div role="status" aria-live="polite" className="mt-6">
          <p className="font-mono text-[11px] uppercase tracking-label text-success">{t('vaultUpsell.created')}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">{t('vaultUpsell.shippingRemoved')}</p>
        </div>
      )}
      {emailNotVerified && (
        <div className="mt-6">
          <EmailNotVerifiedNotice />
        </div>
      )}
      {payError && (
        <p role="alert" className="mt-6 font-mono text-xs text-accent [overflow-wrap:anywhere]">
          {payError}
        </p>
      )}
      {/* v1.68: reuso / sustitución / cuenta atrás de la reserva (§4-R). */}
      <CheckoutRetryNotice outcome={notice} className="mt-6" />
      {paymentInProgress && (
        <PaymentInProgressNotice
          orderId={paymentInProgress.orderId}
          orderNumber={paymentInProgress.orderNumber}
          guest={false}
          retrying={creating}
          onRetry={pay}
          className="mt-6"
        />
      )}
    </>
  );

  return (
    <div style={isDesktop || !data ? undefined : { paddingBottom: 'calc(var(--sticky-bottom-h, 0px) + 16px)' }}>
      {/* Artboard «Carrito y pago»: título + promesa de bóveda bajo el hero. CHK-MOVIL.2.6: el subtítulo es TODO
          el anuncio de la bóveda con cuenta (el bloque de 3 beneficios se retiró). */}
      <div className="gutter pb-7 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        <p className="mt-3.5 max-w-[560px] text-[15px] leading-[1.7] text-muted">{t('subtitle')}</p>
      </div>

      {/* Aviso informativo de poda (v1.21.3), FUERA de QueryState: sobrevive al estado
          de carga de la re-cotización que la propia poda dispara. */}
      <UnavailableItemsNotice className="gutter mb-6 max-w-[680px]" />

      {/* §AC-UX.4 (AC-F7): carrito SOLO de accesorios con sesión ⇒ sin cotización ni botón de pago; queda el bloque. */}
      {cart.ids.length === 0 && (
        <div className="gutter max-w-[680px] pb-14">
          <SignedInAccessoriesBlock accessories={cart.accessories} onRemove={cart.removeAccessory} />
        </div>
      )}

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {data && (
          // CHK-MOVIL.1: pista `minmax(0,1fr)` en <lg; los 420 px del resumen solo desde `lg`.
          <div className="grid grid-cols-[minmax(0,1fr)] border-t border-border lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="gutter min-w-0 border-b border-border pb-14 pt-4 lg:border-b-0 lg:border-r">
              {/* CHK-MOVIL.2.6 (con cuenta, sin formulario): líneas → sugerencias → notas legales → barra. */}
              <CheckoutLines items={data.items} onRemove={(id) => cart.remove(id)} />

              {/* §AC-UX.4 (AC-F7): los accesorios del carrito local van APARTE, no suman y ⛔ nunca se mandan. */}
              <SignedInAccessoriesBlock accessories={cart.accessories} onRemove={cart.removeAccessory} />

              {!isDesktop && <div className="mt-6">{notices}</div>}

              {/* Los tres avisos del contrato, como notas al margen (criterio 48b). T8 junto a «ventas finales». */}
              <p className="rule-note mt-8 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                <span className="font-medium text-text">{t('finalSaleNotice')}</span>{' '}
                <Link href="/terminos" className="text-accent hover:text-text">
                  {t('viewTerms')}
                </Link>
                <br />
                <span className="font-mono text-[11px]">{t('refundPromise')}</span>
              </p>
              {/* LIVE-8 · sitio 4 (DESIGN_SYSTEM §80.2, criterio 505 ii). */}
              <PrivacySiteNote
                site="checkout"
                className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted"
              />
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('cfdiNotice')}
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('afterPayment')}
              </p>
              {config.useMocks && !isDesktop && (
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{t('stripeMock')}</p>
              )}
            </div>

            {isDesktop && (
              <aside className="gutter h-fit min-w-0 pb-14 pt-8 lg:sticky lg:top-[var(--app-header-h,0px)] lg:px-10">
                {/* Artboard: cabecera «Resumen» con regla fuerte de cierre. */}
                <h2 className="eyebrow border-b border-border-strong pb-4 text-text">{t('summary')}</h2>
                <div className="mt-5">
                  <AmountBreakdown breakdown={data.breakdown} variant="purchase" />
                </div>

                {/* ⛔ Sin segunda copia de `afterPayment` aquí (B-3b, gate de release s5): DESIGN_SYSTEM §15.3
                    fija TRES notas al margen («no se añade ni se quita ninguna») y PROJECT 48b exige los
                    mismos avisos que el checkout de invitado, que pinta una sola. */}
                {notices}

                {/* Compromiso final en rojo TCG HUNT, bloque de 54px (artboard). */}
                <Button
                  variant="accent"
                  loading={creating}
                  disabled={!!paymentInProgress}
                  onClick={pay}
                  className="mt-7 min-h-[54px] w-full tracking-eyebrow"
                >
                  {payLabel}
                </Button>
                {config.useMocks && (
                  <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{t('stripeMock')}</p>
                )}
              </aside>
            )}
          </div>
        )}
      </QueryState>

      {/* CHK-MOVIL.2.4 «Con sesión, la misma barra»: T3b (sin envío: la compra va a la bóveda, §4-G.12 punto 1). */}
      {data && !isDesktop && (
        <CheckoutPayBar
          summaryLine={t('bar.includesFee', { fee: formatMoneyCents(data.breakdown.processingFeeCents, locale) })}
          totalLabel={formatMoneyCents(data.breakdown.totalCents, locale)}
          payLabel={creating ? t('preparing') : t('payNoAmount')}
          loading={creating}
          disabled={!!paymentInProgress}
          onPay={pay}
          breakdown={<AmountBreakdown breakdown={data.breakdown} variant="purchase" />}
        />
      )}

      <StripePaymentModal
        open={!!session}
        onClose={() => setSession(null)}
        clientSecret={session?.stripe.clientSecret ?? null}
        returnUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/orders`}
        title={t('payTitle')}
        amountLabel={data ? formatMoneyCents(data.breakdown.totalCents, locale) : undefined}
        onConfirmed={onConfirmed}
      />
    </div>
  );
}
