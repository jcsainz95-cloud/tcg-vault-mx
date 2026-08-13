import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BusinessException } from '../../common/business.exception';

/**
 * StripeService — Cliente Stripe (PaymentIntents, refunds) + verificación de firma
 * de webhooks. ARCHITECTURE §4.3.
 *
 * B1: `maxNetworkRetries: 2` para tolerar fallos transitorios de red; `StripeCardError`
 *     se mapea a un `BusinessException` legible (`CARD_DECLINED`).
 * B2: guardia de monto mínimo antes de crear el PaymentIntent (Stripe MX no procesa
 *     cargos por debajo de ~MX$10).
 * B6: en producción NO se cae al `sk_test_dummy`; si faltan claves reales, la app falla
 *     al arrancar (validado también en env.validation.ts). El cliente se crea
 *     perezosamente para que tests/CI arranquen con claves dummy sin llamar a la red.
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private client?: Stripe;

  /** B2: mínimo de cargo de Stripe MX (~MX$10.00). Guardia antes de crear el PI. */
  static readonly MIN_CHARGE_CENTS = 1000;

  constructor(private readonly config: ConfigService) {}

  private isProduction(): boolean {
    return (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';
  }

  /** B6: fail-fast en el arranque si faltan las claves de Stripe en producción. */
  onModuleInit(): void {
    if (!this.isProduction()) return;
    const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].filter(
      (k) => !this.config.get<string>(k),
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing required Stripe env in production (no dummy fallback): ${missing.join(', ')}`,
      );
    }
  }

  get stripe(): Stripe {
    if (!this.client) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY');
      if (!key) {
        // B6: nunca en producción (onModuleInit ya habría abortado). Solo dev/test/local.
        if (this.isProduction()) {
          throw new Error('STRIPE_SECRET_KEY is required in production (no dummy fallback)');
        }
        this.logger.warn('STRIPE_SECRET_KEY ausente; usando sk_test_dummy (solo no-producción).');
      }
      this.client = new Stripe(key ?? 'sk_test_dummy', {
        apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
        maxNetworkRetries: 2, // B1: reintentos de red para fallos transitorios.
      });
    }
    return this.client;
  }

  async createPaymentIntent(params: {
    amountCents: number;
    metadata: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ id: string; clientSecret: string }> {
    // B2: guardia de monto mínimo ANTES de llamar a Stripe.
    if (!Number.isInteger(params.amountCents) || params.amountCents < StripeService.MIN_CHARGE_CENTS) {
      throw BusinessException.validation(
        'AMOUNT_TOO_LOW',
        `Amount ${params.amountCents}c is below the Stripe minimum (${StripeService.MIN_CHARGE_CENTS}c)`,
        { minCents: StripeService.MIN_CHARGE_CENTS },
      );
    }
    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: params.amountCents,
          currency: 'mxn',
          metadata: params.metadata,
          automatic_payment_methods: { enabled: true },
        },
        params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
      );
      return { id: pi.id, clientSecret: pi.client_secret ?? '' };
    } catch (e) {
      throw this.mapStripeError(e);
    }
  }

  async refund(paymentIntentId: string, idempotencyKey?: string): Promise<string> {
    try {
      const refund = await this.stripe.refunds.create(
        { payment_intent: paymentIntentId },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
      return refund.id;
    } catch (e) {
      throw this.mapStripeError(e);
    }
  }

  /**
   * B1: mapea errores de Stripe a `BusinessException`. `StripeCardError` (tarjeta
   * rechazada) → `CARD_DECLINED` (422, mensaje legible + `declineCode`). El resto de
   * errores de Stripe se re-lanzan tal cual (los captura el llamador para compensar).
   */
  private mapStripeError(e: unknown): unknown {
    if (e instanceof Stripe.errors.StripeCardError) {
      return BusinessException.validation('CARD_DECLINED', e.message || 'Card was declined', {
        declineCode: e.decline_code ?? null,
      });
    }
    return e;
  }

  /** Verifica la firma del webhook con STRIPE_WEBHOOK_SECRET. */
  constructEvent(payload: Buffer | string, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
