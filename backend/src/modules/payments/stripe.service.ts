import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * StripeService — Cliente Stripe (PaymentIntents, refunds) + verificación de firma
 * de webhooks. ARCHITECTURE §4.3. El cliente se crea perezosamente para que la app
 * arranque en tests/CI con claves dummy sin llamar a la red.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client?: Stripe;

  constructor(private readonly config: ConfigService) {}

  get stripe(): Stripe {
    if (!this.client) {
      this.client = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY') ?? 'sk_test_dummy', {
        apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
      });
    }
    return this.client;
  }

  async createPaymentIntent(params: {
    amountCents: number;
    metadata: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ id: string; clientSecret: string }> {
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
  }

  async refund(paymentIntentId: string, idempotencyKey?: string): Promise<string> {
    const refund = await this.stripe.refunds.create(
      { payment_intent: paymentIntentId },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    return refund.id;
  }

  /** Verifica la firma del webhook con STRIPE_WEBHOOK_SECRET. */
  constructEvent(payload: Buffer | string, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
