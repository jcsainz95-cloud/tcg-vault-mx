'use client';

import { useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useTranslations } from 'next-intl';
import { config } from '@/lib/config';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * WS-F — Modal de pago con Stripe REUTILIZABLE (checkout de compra F1 y cobro de retiro F3).
 *
 * Recibe un `clientSecret` (del PaymentIntent que crea el backend en `/checkout/session` o
 * `/shipments`), monta `<Elements>` + `<PaymentElement>` y al confirmar llama a
 * `stripe.confirmPayment({ elements, confirmParams:{ return_url }, redirect:'if_required' })`.
 *
 * IMPORTANTE — el asentamiento es por WEBHOOK (`payment_intent.succeeded` en el backend): tras un
 * `confirmPayment` exitoso el pago NO es final. Este modal NO marca la orden/envío como liquidado;
 * solo notifica `onConfirmed()` para que el padre limpie estado y rutee a una vista de
 * "procesando / confirmado". La titularidad pasa a `settled` cuando el backend recibe el webhook.
 *
 * En modo mock (`config.useMocks`) NO carga Stripe real: simula el éxito con un botón, para que la
 * demo (sin backend/llaves) siga andando.
 */

// Singleton a nivel de módulo: loadStripe se llama UNA vez (recomendación de Stripe).
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(config.stripePublishableKey);
  return stripePromise;
}

export interface StripePaymentModalProps {
  open: boolean;
  onClose: () => void;
  /** clientSecret del PaymentIntent (backend). Null mientras se crea la sesión. */
  clientSecret: string | null;
  /** URL absoluta de retorno para métodos que redirigen (contrato: confirmParams.return_url). */
  returnUrl: string;
  title?: string;
  /** Etiqueta del monto a cobrar (ya formateada), se muestra en el CTA y encabezado. */
  amountLabel?: string;
  /**
   * Llamado tras un `confirmPayment` exitoso (o `processing`). El pago NO es final (webhook):
   * el padre debe limpiar estado (p. ej. cart.clear) y rutear a "procesando".
   */
  onConfirmed: () => void;
}

export function StripePaymentModal(props: StripePaymentModalProps) {
  const t = useTranslations('payment');
  const { open, onClose, clientSecret, title } = props;
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={title ?? t('title')}>
      {config.useMocks ? (
        <MockPaymentBody {...props} />
      ) : clientSecret ? (
        <Elements stripe={getStripe()} options={{ clientSecret }}>
          <RealPaymentForm {...props} />
        </Elements>
      ) : (
        <p className="text-sm text-muted">{t('preparing')}</p>
      )}
    </Modal>
  );
}

/**
 * Rama REAL: monta el PaymentElement y confirma con `redirect:'if_required'`. Maneja loading/error.
 * Éxito sin redirección → `onConfirmed()`; el asentamiento definitivo llega por webhook.
 */
function RealPaymentForm({ returnUrl, amountLabel, onConfirmed }: StripePaymentModalProps) {
  const t = useTranslations('payment');
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    });
    if (err) {
      // card_error / validation_error traen mensaje legible; el resto cae al genérico.
      setError(err.message ?? t('genericError'));
      setSubmitting(false);
      return;
    }
    // Sin redirección: succeeded o processing. En ambos casos el pago quedó autorizado; el
    // backend lo asienta por webhook. NO tratamos el pago como final aquí.
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onConfirmed();
      return;
    }
    // Estados que requieren más acción (requires_action que no redirigió, etc.).
    setError(t('genericError'));
    setSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement onReady={() => setReady(true)} />
      {error && (
        <p role="alert" className="font-mono text-xs text-accent">
          {error}
        </p>
      )}
      <Button
        variant="accent"
        onClick={handlePay}
        loading={submitting}
        disabled={!stripe || !elements || !ready}
        className="w-full"
      >
        {submitting ? t('processing') : amountLabel ? t('payAmount', { amount: amountLabel }) : t('pay')}
      </Button>
      <p className="rule-note-quiet font-mono text-[11px] leading-relaxed text-muted">{t('settleNotice')}</p>
    </div>
  );
}

/**
 * Rama MOCK: sin Stripe real. Un botón simula el éxito del PaymentIntent para que la demo
 * complete el flujo (crear orden/envío → "pagar" → rutear). Marcado claramente como simulado.
 */
function MockPaymentBody({ amountLabel, onConfirmed }: StripePaymentModalProps) {
  const t = useTranslations('payment');
  const [submitting, setSubmitting] = useState(false);

  async function handleMockPay() {
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 700));
    onConfirmed();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted">{t('mockBody')}</p>
      <Button variant="accent" onClick={handleMockPay} loading={submitting} className="w-full">
        {submitting
          ? t('processing')
          : amountLabel
            ? t('mockPayAmount', { amount: amountLabel })
            : t('mockPay')}
      </Button>
      <p className="rule-note-quiet font-mono text-[11px] leading-relaxed text-muted">{t('settleNotice')}</p>
    </div>
  );
}
