'use client';

import { useEffect, useState } from 'react';
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
import { CardImage } from '@/components/ui/CardImage';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { EmailNotVerifiedNotice } from '@/components/domain/EmailNotVerifiedNotice';
import { useSession } from '@/lib/session';
import { GuestCheckoutView } from './GuestCheckoutView';
import { UnavailableItemsNotice } from './UnavailableItemsNotice';
import { clearUnavailableNotice, pushUnavailableNotice } from './unavailable-notice';

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
 *  - SIN sesión: `GuestCheckoutView` (gate de identidad + formulario de invitado + upsell
 *    de bóveda + `/checkout/guest/*`). Un invitado NUNCA toca un endpoint `customer` ni ve
 *    `EmailNotVerifiedNotice` (contrato §4-G.0-3 / §4-G.8, DESIGN_SYSTEM §15.2).
 * Al crear cuenta/iniciar sesión desde el flujo de invitado, `useSession` reacciona y esta
 * misma vista conmuta al flujo con cuenta sin recargar la ruta: el carrito (localStorage)
 * se conserva y el desglose se re-cotiza.
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
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['checkout-quote', cart.ids],
    queryFn: () => getCheckoutQuote(cart.ids),
    // Solo con sesión: `/checkout/quote` es `customer` y un invitado cotiza por
    // `/checkout/guest/quote` (contrato §4-G.0-3). Así no se dispara un 401 inútil.
    enabled: cart.ids.length > 0 && ready && isAuthenticated,
  });

  /**
   * v1.21.3-quote-prune: si el quote trae piezas muertas, se PODAN del localStorage
   * y se registra el aviso. Efecto idempotente (nunca en render): la poda cambia
   * `cart.ids` → la queryKey cambia → se re-cotiza SOLO con ids vivos y el nuevo
   * fetch trae `unavailableItems: []` → este efecto ya no hace nada (push dedupe +
   * prune no-op), así que no hay ciclo. El aviso vive en el store para sobrevivir
   * a esa re-cotización.
   */
  const unavailable = query.data?.unavailableItems;
  const { prune } = cart; // estable (useCallback sin deps)
  useEffect(() => {
    if (!unavailable || unavailable.length === 0) return;
    pushUnavailableNotice(unavailable);
    prune(unavailable.map((u) => u.inventoryItemId));
  }, [unavailable, prune]);

  // Al salir del checkout el aviso caduca: solo lo conserva la sesión de compra actual.
  useEffect(() => () => clearUnavailableNotice(), []);

  if (cart.ids.length === 0 && !paid && !guestPaid) {
    // Carrito vacío — incluido el caso "todo el carrito murió": EmptyState + aviso,
    // NUNCA la pantalla de error genérico ni un botón de reintentar (contrato §4).
    return (
      <div className="gutter py-14">
        <UnavailableItemsNotice className="mx-auto mb-10 max-w-[620px]" />
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
    setCreating(true);
    setPayError(null);
    setEmailNotVerified(false);
    try {
      const res = await createCheckoutSession(cart.ids);
      setSession(res);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'EMAIL_NOT_VERIFIED') {
        setEmailNotVerified(true);
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
      setCreating(false);
    }
  }

  function onConfirmed() {
    // El pago quedó autorizado; el backend lo asienta por webhook. Limpiamos el carrito y
    // mostramos "procesando" (la titularidad pasa a settled cuando el webhook liquida).
    setSession(null);
    cart.clear();
    setPaid(true);
  }

  return (
    <div>
      {/* Artboard «Carrito y pago»: título + promesa de bóveda bajo el hero. */}
      <div className="gutter pb-7 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        <p className="mt-3.5 max-w-[560px] text-[15px] leading-[1.7] text-muted">{t('subtitle')}</p>
      </div>

      {/* Aviso informativo de poda (v1.21.3), FUERA de QueryState: sobrevive al estado
          de carga de la re-cotización que la propia poda dispara. */}
      <UnavailableItemsNotice className="gutter mb-6 max-w-[680px]" />

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <div className="grid border-t border-border lg:grid-cols-[1fr_420px]">
            <div className="gutter border-b border-border pb-14 pt-4 lg:border-b-0 lg:border-r">
              {/* Líneas del carrito (artboard): miniatura grande, nombre en serif,
                  meta en mono, «Quitar» bajo la meta y el precio tabular a la derecha. */}
              {query.data.items.map((item) => (
                <div
                  key={item.inventoryItemId}
                  className="flex items-start gap-4 border-b border-border py-5 sm:gap-5"
                >
                  <div className="w-16 shrink-0 sm:w-[92px]">
                    <CardImage src={item.card.imageSmallUrl} alt={item.card.name} className="p-1" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-[17px] leading-tight text-text sm:text-[19px]" lang="en">
                      {item.card.name}
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted" lang="en">
                      {item.card.setName} · #{item.card.number}
                      {item.productType === 'raw' && item.rawCondition ? ` · ${item.rawCondition}` : ''}
                    </p>
                    <button
                      type="button"
                      aria-label={t('removeItem')}
                      onClick={() => cart.remove(item.inventoryItemId)}
                      className="mt-3.5 font-mono text-[11px] text-muted hover:text-accent"
                    >
                      {t('removeItem')}
                    </button>
                  </div>
                  <span className="tabular shrink-0 text-right text-[17px] font-medium text-text sm:text-[19px]">
                    {formatMoneyCents(item.unitPriceCents, locale)}
                  </span>
                </div>
              ))}

              {/* Artboard: recordatorio del valor de la bóveda ANTES de los avisos legales. */}
              <div className="mt-6 border-t border-border-strong pt-6">
                <p className="eyebrow">{t('vaultKeepEyebrow')}</p>
                <ul className="mt-4 max-w-[620px]">
                  <li className="border-t border-border py-3 text-sm leading-[1.7] text-text">
                    {t('vaultUpsell.benefit.oneShipmentPlain')}
                  </li>
                  <li className="border-t border-border py-3 text-sm leading-[1.7] text-text">
                    {t('vaultUpsell.benefit.portfolio')}
                  </li>
                  <li className="border-y border-border py-3 text-sm leading-[1.7] text-text">
                    {t('vaultUpsell.benefit.custody')}
                  </li>
                </ul>
              </div>

              {/* Los tres avisos del contrato, como notas al margen. */}
              <p className="rule-note mt-8 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                <span className="font-medium text-text">{t('finalSaleNotice')}</span>{' '}
                <Link href="/terminos" className="text-accent hover:text-text">
                  {t('viewTerms')}
                </Link>
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('cfdiNotice')}
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('afterPayment')}
              </p>
            </div>

            <aside className="gutter h-fit pb-14 pt-8 lg:px-10">
              {/* Artboard: cabecera «Resumen» con regla fuerte de cierre. */}
              <h2 className="eyebrow border-b border-border-strong pb-4 text-text">{t('summary')}</h2>
              <div className="mt-5">
                <AmountBreakdown breakdown={query.data.breakdown} variant="purchase" />
              </div>

              {/* Éxito del upsell de bóveda (§15.4): el desglose se re-cotizó sin envío. */}
              {vaultUpsellDone && (
                <div role="status" aria-live="polite" className="mt-6">
                  <p className="font-mono text-[11px] uppercase tracking-label text-success">
                    {t('vaultUpsell.created')}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{t('vaultUpsell.shippingRemoved')}</p>
                </div>
              )}

              {emailNotVerified && (
                <div className="mt-6">
                  <EmailNotVerifiedNotice />
                </div>
              )}
              {payError && (
                <p role="alert" className="mt-6 font-mono text-xs text-accent">
                  {payError}
                </p>
              )}

              {/* Compromiso final en rojo TCG HUNT, bloque de 54px (artboard). */}
              <Button
                variant="accent"
                loading={creating}
                onClick={pay}
                className="mt-7 min-h-[54px] w-full tracking-eyebrow"
              >
                {creating
                  ? t('preparing')
                  : t('pay', { amount: formatMoneyCents(query.data.breakdown.totalCents, locale) })}
              </Button>
              {config.useMocks && (
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{t('stripeMock')}</p>
              )}
            </aside>
          </div>
        )}
      </QueryState>

      <StripePaymentModal
        open={!!session}
        onClose={() => setSession(null)}
        clientSecret={session?.stripe.clientSecret ?? null}
        returnUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/orders`}
        title={t('payTitle')}
        amountLabel={
          query.data ? formatMoneyCents(query.data.breakdown.totalCents, locale) : undefined
        }
        onConfirmed={onConfirmed}
      />
    </div>
  );
}
