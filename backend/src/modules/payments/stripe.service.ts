import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BusinessException } from '../../common/business.exception';

/**
 * P-WH-1 (ALTA, pentest): el secreto de webhook NO está configurado (ausente, vacío o solo
 * espacios). Es un **defecto de configuración NUESTRO**, no una firma inválida del llamador:
 * el controller lo traduce a **5xx** (Stripe reintenta y el evento sobrevive), nunca a 400.
 *
 * Se distingue por CLASE y no por mensaje a propósito: el mensaje de `StripeSignatureVerification
 * Error` lo controla el SDK y confundir ambos casos es justo lo que dejaría un config roto
 * escondido entre el ruido de firmas inválidas.
 */
export class StripeWebhookSecretMissingError extends Error {
  constructor() {
    super(
      'STRIPE_WEBHOOK_SECRET no está configurado: la firma del webhook NO se puede verificar ' +
        '(fail-closed). Configúralo en este entorno; no hay degradación a clave vacía.',
    );
    this.name = 'StripeWebhookSecretMissingError';
  }
}

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
 *
 * ### P-WH-1 (pentest ALTA, explotado LIVE-DB) — la verificación de firma falla CERRADA
 *
 * `constructEvent` hacía `config.get('STRIPE_WEBHOOK_SECRET') ?? ''`. Con el secreto ausente eso
 * **no es una verificación**: es un HMAC de clave vacía que cualquiera puede computar. El pentester
 * forjó un `payment_intent.succeeded`, liquidó un pedido y movió una carta a la bóveda del
 * comprador **sin que entrara un peso**. El guard de monto/moneda no ayuda: el forjador escribe el
 * payload. Un candado que no se puede poner rojo.
 *
 * El arreglo mantiene DOS cosas que son distintas y que confundirlas rompe el arnés sin cerrar el
 * agujero:
 *  - **«No hay proveedor de pago»** (local/CI sin Stripe): permitido. La app arranca, el catálogo
 *    y todo lo que no cobra funcionan.
 *  - **«Acepto cualquier firma»**: prohibido SIEMPRE, en todos los entornos. Sin secreto no hay
 *    verificación posible ⇒ se lanza (`StripeWebhookSecretMissingError`) y el evento NO se procesa.
 *
 * Por eso el fail-fast de arranque ya **no** se condiciona a `NODE_ENV`, sino a si hay integración
 * Stripe (`STRIPE_SECRET_KEY` presente): con Stripe cableado, el secreto de webhook es obligatorio
 * en staging/dev/CI igual que en producción.
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

  /**
   * Valor de config NO vacío, o `null`. Trimea a propósito: `' '` es tan inservible como `''`
   * para un HMAC y `!config.get(k)` no lo veía (string con espacios es truthy).
   */
  private nonBlank(key: string): string | null {
    const raw = this.config.get<string>(key);
    const v = typeof raw === 'string' ? raw.trim() : '';
    return v.length > 0 ? v : null;
  }

  /**
   * ¿Hay integración Stripe cableada en este entorno? Se decide por `STRIPE_SECRET_KEY`, no por
   * `NODE_ENV`: es el hecho que importa (si se pueden cobrar pagos, hay webhooks que verificar).
   */
  private stripeConfigured(): boolean {
    return this.nonBlank('STRIPE_SECRET_KEY') !== null;
  }

  /**
   * P-WH-1: fail-fast de arranque **NO condicionado a `NODE_ENV`**.
   *
   * - En producción se exigen ambas claves (como antes, B6).
   * - En CUALQUIER entorno con Stripe cableado (`STRIPE_SECRET_KEY` presente) se exige además
   *   `STRIPE_WEBHOOK_SECRET` no vacío: staging/dev con Stripe real era forjable y ya no arranca.
   * - Sin Stripe cableado (arnés local/CI sin proveedor de pago) NO se exige nada y la app
   *   arranca: esa asimetría es deliberada. La protección de ese caso está en el punto de uso
   *   (`constructEvent` lanza), que es la que de verdad cierra el agujero.
   */
  onModuleInit(): void {
    const hasApiKey = this.stripeConfigured();
    const hasWebhookSecret = this.nonBlank('STRIPE_WEBHOOK_SECRET') !== null;
    if (!this.isProduction() && !hasApiKey) {
      this.logger.warn(
        'Stripe no está configurado en este entorno (sin STRIPE_SECRET_KEY). Los webhooks NO se ' +
          'podrán verificar y serán rechazados con 5xx (fail-closed, P-WH-1).',
      );
      return;
    }
    const missing: string[] = [];
    if (!hasApiKey) missing.push('STRIPE_SECRET_KEY');
    if (!hasWebhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
    if (missing.length > 0) {
      throw new Error(
        `Missing required Stripe env (no dummy fallback, no empty-secret fallback): ${missing.join(', ')}`,
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

  /**
   * v1.21-guest-checkout (T9): cancela un PaymentIntent aún no pagado. Lo usa el barrido de
   * reservas de pedidos de invitado (`guest-order-sweep`) ANTES de liberar el inventario. NO es
   * money-out (un PI cancelado nunca se capturó).
   *
   * **B3 (v1.21.2):** devuelve el `status` resultante en vez de `void`. El barrido lo NECESITA:
   * liberar la reserva de un PI que sigue vivo es lo que producía «pedido pagado con la carta de
   * vuelta a la venta». Un PI ya `succeeded` hace que Stripe LANCE — y eso es exactamente la señal
   * de "no sueltes esta reserva".
   */
  async cancelPaymentIntent(paymentIntentId: string): Promise<{ status: string }> {
    const pi = await this.stripe.paymentIntents.cancel(paymentIntentId);
    return { status: pi.status };
  }

  /**
   * B3 — estado actual de un PaymentIntent. Solo se usa para DESAMBIGUAR un fallo de cancelación:
   * «ya estaba cancelado» (seguro liberar la reserva) vs «ya se pagó / se está procesando» (JAMÁS
   * liberar). Devuelve `null` si no se puede consultar: ante la duda, el barrido no libera.
   */
  async getPaymentIntentStatus(paymentIntentId: string): Promise<string | null> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return pi.status;
    } catch (e) {
      this.logger.warn(
        `No se pudo consultar el estado del PaymentIntent ${paymentIntentId}: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * v1.21-guest-checkout (§4-G.10): marca + 4 últimos dígitos de la tarjeta con la que se pagó,
   * leídos del `charge` del PaymentIntent. Es el ÚNICO dato de tarjeta que se persiste (permitido
   * por PCI-DSS); jamás PAN, BIN ni titular. Best-effort: devuelve `null` si no se puede resolver
   * (no debe hacer fallar un webhook de pago ya liquidado).
   */
  async getCardDetails(paymentIntentId: string): Promise<{ brand: string; last4: string } | null> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge'],
      });
      const charge = pi.latest_charge as Stripe.Charge | null;
      const card = charge?.payment_method_details?.card;
      if (!card?.brand || !card?.last4) return null;
      return { brand: card.brand, last4: card.last4 };
    } catch (e) {
      this.logger.warn(`No se pudieron leer los datos de tarjeta de ${paymentIntentId}: ${(e as Error).message}`);
      return null;
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

  /**
   * Verifica la firma del webhook con `STRIPE_WEBHOOK_SECRET`. **Falla CERRADA** (P-WH-1).
   *
   * Sin secreto utilizable NO se llama al SDK: se lanza. El `?? ''` anterior sí llamaba al SDK, y
   * el SDK verifica felizmente un HMAC de clave vacía — un 200 indistinguible de una firma buena.
   * Aquí no hay entorno exento: ni dev, ni test, ni CI. Si un día hace falta un webhook en un
   * entorno sin Stripe, la respuesta es **poner un secreto** en ese entorno, no bajar el listón.
   */
  constructEvent(payload: Buffer | string, signature: string): Stripe.Event {
    const secret = this.nonBlank('STRIPE_WEBHOOK_SECRET');
    if (secret === null) {
      // Loguea el HECHO (config rota), no la petición: el llamador solo verá un 5xx genérico.
      this.logger.error(
        'Webhook de Stripe rechazado: STRIPE_WEBHOOK_SECRET ausente o vacío. La firma NO se ' +
          'verifica con clave vacía (P-WH-1). Configura el secreto en este entorno.',
      );
      throw new StripeWebhookSecretMissingError();
    }
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
