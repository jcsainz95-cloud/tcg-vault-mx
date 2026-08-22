'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { createGuestCheckoutSession, getGuestCheckoutQuote } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { config } from '@/lib/config';
import { useCart } from '@/lib/cart';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { GuestAddressInput, GuestCheckoutSessionResponse } from '@/types/contract';
import { CardImage } from '@/components/ui/CardImage';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { CheckoutIdentityGate, type IdentityMode } from './CheckoutIdentityGate';
import { GuestCheckoutForm, type Destination } from './GuestCheckoutForm';
import { GuestOrderConfirmation } from './GuestOrderConfirmation';
import { InlineAuthPanel } from './InlineAuthPanel';
import { UnavailableItemsNotice } from './UnavailableItemsNotice';
import { pushUnavailableNotice } from './unavailable-notice';
import {
  EMPTY_GUEST_ADDRESS,
  toAddressPayload,
  validateGuestForm,
  type GuestErrors,
  type GuestField,
  type GuestFormState,
} from './guest-validation';

export interface GuestCheckoutViewProps {
  /** El pago quedó autorizado: el padre debe mantener esta vista montada (confirmación). */
  onPaid: () => void;
  /**
   * El invitado creó cuenta / inició sesión desde el gate o desde el upsell. El padre
   * (`CheckoutView`) conmuta al flujo con cuenta SIN recargar la ruta: el carrito vive en
   * localStorage y el desglose se re-cotiza, no se reinicia (criterio 46/48).
   */
  onAccountReady: (options: { fromVaultUpsell: boolean }) => void;
}

/**
 * Checkout de INVITADO (PROJECT §J, criterios 45–48b · DESIGN_SYSTEM §15.2–§15.4).
 *
 * Estructura del estado (importante para el criterio 46): el formulario de invitado vive
 * AQUÍ, por encima del gate de identidad, no dentro del panel. Por eso ir a "iniciar
 * sesión" y volver a "invitado" no borra el correo ni la dirección ya capturados, y el
 * carrito —que vive en localStorage— nunca se toca al cambiar de vía.
 */
export function GuestCheckoutView({ onPaid, onAccountReady }: GuestCheckoutViewProps) {
  const t = useTranslations('checkout');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage();
  const cart = useCart();

  const [identity, setIdentity] = useState<IdentityMode>('none');
  const [form, setForm] = useState<GuestFormState>({
    email: '',
    emailConfirmed: false,
    acceptedTerms: false,
    address: EMPTY_GUEST_ADDRESS,
  });
  const [touched, setTouched] = useState<Partial<Record<GuestField, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [destination, setDestination] = useState<Destination>('ship');
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [session, setSession] = useState<GuestCheckoutSessionResponse | null>(null);
  const [paid, setPaid] = useState<GuestCheckoutSessionResponse | null>(null);

  const query = useQuery({
    queryKey: ['guest-checkout-quote', cart.ids],
    queryFn: () => getGuestCheckoutQuote(cart.ids),
    enabled: cart.ids.length > 0,
  });

  /**
   * v1.21.3-quote-prune (misma mecánica que CheckoutView): las piezas muertas del
   * quote se podan del localStorage en un efecto idempotente y el aviso queda en el
   * store, que sobrevive tanto a la re-cotización como al desmonte de esta vista
   * (si TODO murió, el padre pinta EmptyState + aviso). Sin ciclo: el segundo fetch
   * trae `unavailableItems: []` y el efecto es no-op.
   */
  const unavailable = query.data?.unavailableItems;
  const { prune } = cart; // estable (useCallback sin deps)
  useEffect(() => {
    if (!unavailable || unavailable.length === 0) return;
    pushUnavailableNotice(unavailable);
    prune(unavailable.map((u) => u.inventoryItemId));
  }, [unavailable, prune]);

  const errors: GuestErrors = useMemo(() => validateGuestForm(form), [form]);
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
    setSubmitAttempted(true);
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

    setCreating(true);
    try {
      const res = await createGuestCheckoutSession({
        inventoryItemIds: cart.ids,
        email: form.email.trim(),
        shippingAddress: toAddressPayload(form.address),
        locale,
        acceptedTerms: true,
        fulfillmentMode: 'direct_ship',
      });
      setSession(res);
    } catch (e) {
      // 422 VAULT_REQUIRES_ACCOUNT (details.upsell) NUNCA se pinta como error: es la
      // señal del upsell de bóveda (contrato §4-G.2, criterio 48).
      if (e instanceof ApiClientError && e.code === 'VAULT_REQUIRES_ACCOUNT') {
        setDestination('vault');
        setUpsellOpen(true);
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
      setCreating(false);
    }
  }

  function onConfirmed() {
    // El pago quedó autorizado; el backend lo asienta por webhook (payment_intent.succeeded)
    // y ahí manda el correo con el enlace de seguimiento (criterio 49).
    const created = session;
    setSession(null);
    onPaid();
    cart.clear();
    setPaid(created);
  }

  return (
    <div>
      <div className="gutter pb-7 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
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
              <CheckoutIdentityGate mode={identity} onSelect={setIdentity} panelId="identity-panel" />

              <div id="identity-panel">
                {(identity === 'login' || identity === 'register') && (
                  <div className="max-w-[420px] py-8">
                    <InlineAuthPanel
                      variant={identity === 'login' ? 'login' : 'register'}
                      defaultEmail={form.email}
                      defaultName={form.address.recipientName}
                      neutralEmailTaken={t('vaultUpsell.emailTakenNeutral')}
                      onSuccess={() => onAccountReady({ fromVaultUpsell: false })}
                    />
                  </div>
                )}
              </div>

              {/* Los renglones del carrito siempre visibles: el motivo de la compra no desaparece. */}
              {/* Líneas del carrito (artboard): miniatura grande, serif + mono y precio
                  tabular a la derecha; «Quitar» bajo la meta. */}
              <ul className="pt-2">
                {query.data.items.map((item) => (
                  <li
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
                  </li>
                ))}
              </ul>

              {identity === 'guest' && (
                <div className="pt-10">
                  <GuestCheckoutForm
                    state={form}
                    onChange={patchForm}
                    onAddressChange={patchAddress}
                    errors={errors}
                    touched={touched}
                    onBlurField={(field) => setTouched((s) => ({ ...s, [field]: true }))}
                    submitAttempted={submitAttempted}
                    destination={destination}
                    onDestinationChange={chooseDestination}
                    upsellOpen={upsellOpen}
                    shippingFeeLabel={shippingFeeLabel}
                    onDismissUpsell={() => {
                      setUpsellOpen(false);
                      setDestination('ship');
                    }}
                    onAccountReady={() => onAccountReady({ fromVaultUpsell: true })}
                  />
                </div>
              )}

              {/* Mismos avisos que el checkout con cuenta (criterio 48b): ninguno se quita. */}
              <p className="rule-note mt-10 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                <span className="font-medium text-text">{t('finalSaleNotice')}</span>{' '}
                <Link href="/terminos" className="text-accent hover:text-text">
                  {t('viewTerms')}
                </Link>
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('cfdiNotice')}
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('afterPaymentGuest')}
              </p>
            </div>

            <aside className="gutter h-fit pb-14 pt-8 lg:px-10">
              {/* Artboard: cabecera «Resumen» con regla fuerte de cierre. */}
              <h2 className="eyebrow border-b border-border-strong pb-4 text-text">{t('summary')}</h2>
              <div className="mt-5">
                <AmountBreakdown
                  breakdown={activeBreakdown ?? query.data.breakdown}
                  variant="purchase"
                />
              </div>

              {payError && (
                <p role="alert" className="mt-6 font-mono text-xs text-accent">
                  {payError}
                </p>
              )}

              {identity === 'guest' ? (
                <>
                  {/* N-9: destino JUSTO arriba de "Pagar" (además del detalle+upsell en el
                      formulario), para que el invitado confirme a dónde va su compra antes de
                      pagar. Comparte el mismo estado: elegir bóveda abre el upsell y explica el
                      bloqueo bajo el botón. */}
                  <div className="mt-7">
                    <h2 className="eyebrow">{t('destination.eyebrow')}</h2>
                    <div
                      className="mt-3 grid grid-cols-2 gap-2"
                      role="radiogroup"
                      aria-label={t('destination.eyebrow')}
                    >
                      {(['ship', 'vault'] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          role="radio"
                          aria-checked={destination === opt}
                          onClick={() => chooseDestination(opt)}
                          className={`min-h-[44px] border px-3 py-2 text-sm transition-colors ${
                            destination === opt
                              ? 'border-text bg-surface-2 text-text'
                              : 'border-border text-muted hover:text-text'
                          }`}
                        >
                          {t(`destination.${opt}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="accent"
                    loading={creating}
                    disabled={!!payBlockedReason}
                    aria-describedby={payBlockedReason ? 'pay-blocked-note' : undefined}
                    onClick={pay}
                    className="mt-5 min-h-[54px] w-full tracking-eyebrow"
                  >
                    {creating
                      ? t('preparing')
                      : t('pay', {
                          amount: formatMoneyCents(
                            (activeBreakdown ?? query.data.breakdown).totalCents,
                            locale,
                          ),
                        })}
                  </Button>
                  {/* Nunca un botón apagado y mudo: la condición se explica (§15.9). */}
                  {payBlockedReason && (
                    <p id="pay-blocked-note" className="mt-4 text-xs leading-relaxed text-muted">
                      {payBlockedReason}
                    </p>
                  )}
                </>
              ) : (
                // Sin vía elegida no hay botón de pago: el gate de arriba es el siguiente
                // paso y el desglose ya está a la vista (el motivo de la compra no desaparece).
                <p className="mt-7 text-sm leading-relaxed text-muted">{t('identity.guest.hint')}</p>
              )}

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
        amountLabel={
          activeBreakdown ? formatMoneyCents(activeBreakdown.totalCents, locale) : undefined
        }
        onConfirmed={onConfirmed}
      />
    </div>
  );
}
