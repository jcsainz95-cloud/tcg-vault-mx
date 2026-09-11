'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { formatRemaining, formatReservationTime, remainingMs } from './reservation-clock';
import { useRemainingMs } from './use-reservation-clock';

/**
 * Contrato v1.68 (§4-R) — lo que el cliente tiene que saber tras `POST /checkout[/guest]/session`:
 *
 *  - `200 reused: true` ⇒ «recuperamos tu reserva»: **mismo pedido y mismo cobro** (regla 1: un
 *    cobro por pieza; regla 5: no se re-precia). Sin esto, el cliente que cerró el modal y volvió a
 *    pulsar «Pagar» no sabe si le van a cobrar dos veces — y la respuesta correcta es «no».
 *  - `201` con `supersededOrderIds` ⇒ «tu intento anterior se canceló»: el aviso dice que solo se
 *    cobra este. ARCHITECTURE §4.48.8 lo llama «silencioso»; se pinta en una línea de estado,
 *    no en un alert: es información, no un error.
 *  - `reservedUntil` ⇒ cuenta atrás **honesta**: la hora del servidor, restada del reloj local.
 *    Ningún minuto sale de este componente.
 */
export interface CheckoutRetryOutcome {
  orderId: string;
  orderNumber?: string | null;
  reused?: boolean;
  reservedUntil?: string;
  supersededOrderIds?: string[];
  /**
   * v1.68.1 (§4-R.5): el desenlace viene del QUOTE (`ownReservation`), antes de pagar: «este carrito
   * ya está reservado a tu nombre» (viva) o «tu reserva venció: al pagar se renovará» (vencida sin
   * barrer ⇒ la sesión SUSTITUYE, nunca la trata como ajena).
   */
  own?: { expired: boolean };
}

export function CheckoutRetryNotice({ outcome, className }: { outcome: CheckoutRetryOutcome | null; className?: string }) {
  const t = useTranslations('checkout.retry');
  if (!outcome) return null;
  const superseded = outcome.supersededOrderIds?.length ?? 0;
  const showReused = outcome.reused === true;
  const showOwn = !!outcome.own;
  const showCountdown = !outcome.own?.expired && remainingMs(outcome.reservedUntil) !== null;
  if (!showReused && !showOwn && superseded === 0 && !showCountdown) return null;
  const folio = outcome.orderNumber ?? outcome.orderId;
  return (
    <div className={className} data-testid="checkout-retry-notice">
      {showReused && (
        <p role="status" className="text-sm leading-relaxed text-text">
          {t('reused', { orderNumber: folio })}
        </p>
      )}
      {showOwn && (
        <p
          role="status"
          className="text-sm leading-relaxed text-text"
          data-testid={outcome.own!.expired ? 'own-reservation-expired' : 'own-reservation-active'}
        >
          {outcome.own!.expired ? t('ownExpired', { orderNumber: folio }) : t('ownActive', { orderNumber: folio })}
        </p>
      )}
      {superseded > 0 && (
        <p role="status" className="mt-2 text-sm leading-relaxed text-text">
          {t('superseded', { count: superseded })}
        </p>
      )}
      {showCountdown && <ReservationCountdown reservedUntil={outcome.reservedUntil!} className="mt-2" />}
    </div>
  );
}

/**
 * Cuenta atrás de la reserva. La hora absoluta (`HH:MM`, CDMX) va en una región de estado que se
 * anuncia UNA vez; el contador que cambia cada segundo NO es región viva (un lector de pantalla
 * que lo anunciara sesenta veces por minuto sería inusable). Al llegar a cero dice que venció y
 * qué pasa al pagar — no se «prorroga» nada desde el cliente.
 */
export function ReservationCountdown({ reservedUntil, className }: { reservedUntil: string; className?: string }) {
  const t = useTranslations('checkout.retry');
  const locale = useLocale() as AppLocale;
  // El reloj es COMPARTIDO con «Reanudar pago» (`use-reservation-clock`): las dos superficies
  // cuentan el mismo tiempo y ninguna se queda congelada en el instante del render (SB-D7).
  const left = useRemainingMs(reservedUntil);

  if (left === null) return null;
  const time = formatReservationTime(reservedUntil, locale);
  if (left <= 0) {
    return (
      <p role="status" className={`font-mono text-[11px] leading-relaxed text-muted ${className ?? ''}`} data-testid="reservation-expired">
        {t('expired')}
      </p>
    );
  }
  return (
    <div className={className} data-testid="reservation-countdown">
      <p role="status" className="text-xs leading-relaxed text-muted">
        {t('reservedUntil', { time })}
      </p>
      <p className="tabular mt-1 font-mono text-[11px] text-muted" data-testid="reservation-remaining">
        {t('remaining', { remaining: formatRemaining(left) })}
      </p>
    </div>
  );
}

/**
 * `409 PAYMENT_IN_PROGRESS` (§4-R.2): el PI del intento anterior ya está `processing`/`succeeded`,
 * así que el servidor NO crea otro (cero escritura). Es un BLOQUEO con explicación, no un error
 * genérico: dice por qué («no se cobra dos veces»), lleva al pedido cuando hay cuenta
 * (`details.orderId`) y ofrece «Reintentar en un momento» — porque el estado de Stripe se resuelve
 * en segundos y el reintento es legítimo.
 */
export function PaymentInProgressNotice({
  orderId,
  orderNumber,
  guest,
  retrying,
  onRetry,
  className,
}: {
  orderId?: string;
  orderNumber?: string;
  guest: boolean;
  retrying: boolean;
  onRetry: () => void;
  className?: string;
}) {
  const t = useTranslations('checkout.retry');
  // ⚠️ El MENSAJE del `409` sale del catálogo de errores (`error.PAYMENT_IN_PROGRESS[_GUEST]`), no
  // de `checkout.retry`: §26 — el copy de un código del contrato vive en un solo sitio, por código,
  // y no en la pantalla que lo recibe (SB-D5/I3). Lo que sí es de esta pantalla son las AFORDANCIAS
  // (ver el pedido, reintentar), que no son copy de error sino salidas.
  const tError = useTranslations('error');
  return (
    <div role="alert" className={className} data-testid="payment-in-progress">
      <p className="text-sm leading-relaxed text-text">
        {guest ? tError('PAYMENT_IN_PROGRESS_GUEST') : tError('PAYMENT_IN_PROGRESS')}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!guest && orderId && (
          <Link href={`/orders/${orderId}`} className="font-mono text-[11px] uppercase tracking-label text-accent hover:text-text">
            {t('viewOrder', { orderNumber: orderNumber ?? orderId })}
          </Link>
        )}
        <Button size="sm" variant="secondary" loading={retrying} onClick={onRetry}>
          {t('retrySoon')}
        </Button>
      </div>
    </div>
  );
}
