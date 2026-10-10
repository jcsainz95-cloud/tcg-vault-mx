import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BusinessException } from '../../common/business.exception';

/** 💰 v1.84 LIVE-5 — resultado de {@link StripeService.chargeState}. */
export type ChargeState = { mode: 'current'; disputed: boolean; amountRefundedCents: number } | { mode: 'other' };

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

  /**
   * I3 — techo de UNA petición HTTP a Stripe, en ms. Tiene que quedar **por debajo** del `timeout`
   * de `RESERVATION_TX_OPTIONS` (30 s): ver el bloque del constructor del cliente. Lo comprueba
   * `test/integration/stripe-in-tx-pool.e2e-spec.ts` como propiedad, no como comentario.
   */
  static readonly TIMEOUT_MS = 8_000;

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
        // ⭐⭐ I3 (techlead + QA, 2026-09-11) — **el proveedor NO decide cuánto dura nuestra
        // transacción.** `OrdersService.supersedeOwnOrder` cancela el PaymentIntent viejo DENTRO
        // del `$transaction` del checkout, que sostiene la conexión de Prisma y el
        // `pg_advisory_xact_lock` por cliente y tiene `timeout: 30_000`
        // (`orders/reservation.ts` · `RESERVATION_TX_OPTIONS`). Aquí NO había `timeout`, y el
        // default del SDK son **80 000 ms** (medido: `new Stripe(...).getApiField('timeout') ===
        // 80000`) — **2.6× el techo de la transacción**, y por intento: con `maxNetworkRetries: 2`
        // una cancelación patológica podía retener conexión y candado muchísimo más de lo que la
        // propia transacción tolera, mientras el resto de los checkouts espera un hueco del pool.
        //
        // `TIMEOUT_MS` = 8 s por intento. La ARITMÉTICA que importa, y va explícita porque es la
        // que hace que esto sea una cota y no un deseo: peor caso = 3 intentos (1 +
        // `maxNetworkRetries: 2`) × 8 s = **24 s < 30 s** del `timeout` de la transacción. O sea:
        // la transacción SIEMPRE gana al SDK, y un Stripe lento aborta la sustitución con rollback
        // (CERO escritura, el cliente reintenta) en vez de arrastrar al pool entero. No cambia
        // ningún flujo feliz: la latencia p99 de `cancel`/`create` está muy por debajo de 8 s.
        //
        // MEDIDO (2026-09-11, `stripe-in-tx-pool.e2e-spec.ts`, `connection_limit=5`,
        // `pool_timeout=10`): con N=6 sustituciones concurrentes de clientes distintos y 2 s de
        // latencia inyectada ⇒ 0/6 quinientos y 0/6 timeouts de pool (3/3 tiradas), pared ~4.15 s
        // (dos oleadas de 2 s: las conexiones SÍ se retienen toda la latencia). Con 12 s —por
        // encima del `pool_timeout`— ⇒ **1/6 `500` por `Timed out fetching a new connection`,
        // 3/3 tiradas**. El mecanismo es real; esto lo ACOTA.
        //
        // ⛔ Lo que esto NO hace: sacar la cancelación de la transacción. Eso es cambio de diseño
        // (§4.48.2 — «cancelar antes de crear» es lo que impide dos PI cobrando la misma pieza) y
        // le corresponde al arquitecto. Esto ACOTA el peor caso; no lo elimina.
        timeout: StripeService.TIMEOUT_MS,
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
   * reservas vencidas (`order-reservation-sweep`) y la SUSTITUCIÓN del reintento (§4-R.2) ANTES de liberar el inventario. NO es
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
   * v1.68 (§4-R.2 fila REUSO) — relee un PaymentIntent para devolver el MISMO `client_secret` al
   * cliente que reintenta (no se persiste). No crea nada. Un fallo se propaga tal cual: el caller
   * decide (la reserva queda intacta).
   */
  async retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<{ id: string; status: string; clientSecret: string }> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return { id: pi.id, status: pi.status, clientSecret: pi.client_secret ?? '' };
    } catch (e) {
      throw this.mapStripeError(e);
    }
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

  /**
   * ⭐⭐ v1.80 (§M4-SHIP.7) — el reembolso SIEMPRE lleva `amount` y la llave del LIBRO. ⛔ Ya no existe el
   * reembolso «sin monto» (H3): con reembolsos por carta ya hechos, pedir «todo» sin `amount` era pedirle a
   * Stripe el remanente sin que nuestro registro lo supiera. `metadata.paymentRefundId` es lo que permite
   * ENCONTRAR el reembolso en un reintento cuando la memoria de idempotencia de Stripe (24 h) ya caducó.
   * Devuelve el `status` de Stripe (`pending|succeeded|failed|canceled`) para que el libro lo refleje.
   */
  async createRefund(params: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; status: string }> {
    if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
      throw new Error(`createRefund: amountCents must be a positive integer (got ${params.amountCents})`);
    }
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: params.paymentIntentId,
        amount: params.amountCents,
        metadata: params.metadata,
      },
      { idempotencyKey: params.idempotencyKey },
    );
    return { id: refund.id, status: refund.status ?? 'pending' };
  }

  /**
   * 💰 v1.84 LIVE-5 · C2 (API_CONTRACT §14.5, ARCHITECTURE §4.63.4) — el estado del COBRO, leído fresco de Stripe
   * justo antes de una decisión de dinero por SPEI. No depende de ningún código de error de reembolso.
   *  - `{ mode: 'current', disputed, amountRefundedCents }` — el PI existe en el modo de la clave en uso;
   *    `disputed` = `latest_charge.disputed` (sin cargo ⇒ `false`, `0`).
   *  - `{ mode: 'other' }` — Stripe responde `resource_missing`: el PI vive solo en el OTRO modo (un pedido de prueba
   *    leído con clave live, o al revés) ⇒ no hay dinero real que devolver por este cobro.
   *  - lanza `503 PAYMENT_PROVIDER_UNAVAILABLE` ante cualquier otro fallo (red/5xx tras los reintentos del SDK, clave
   *    mala…): ante la duda no se decide dinero.
   * ⛔ El llamador la invoca FUERA de toda `$transaction` (lección I3: no alargar candados con un tercero; CS-6).
   */
  async chargeState(paymentIntentId: string): Promise<ChargeState> {
    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    } catch (e) {
      if (e instanceof Stripe.errors.StripeInvalidRequestError && e.code === 'resource_missing') return { mode: 'other' };
      this.logger.warn(`chargeState(${paymentIntentId}): Stripe no respondió (${(e as Error).message})`);
      throw BusinessException.retriable(
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Could not read the charge state from the payment provider; nothing was changed. Please retry.',
      );
    }
    const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    return { mode: 'current', disputed: charge?.disputed === true, amountRefundedCents: charge?.amount_refunded ?? 0 };
  }

  /** Tamaño de página de `refunds.list` (el máximo de Stripe). SEC-SHIP-M2: se pagina SIEMPRE. */
  static readonly REFUND_LIST_PAGE_SIZE = 100;

  /**
   * v1.80.3 (SEC-SHIP-M2) — los reembolsos de un PaymentIntent, PAGINADOS (`has_more`/`starting_after`)
   * hasta agotar la lista. ⛔ Nunca una sola página: con 25+ reembolsos sobre un PI el de la fila puede
   * estar en la página 2 y «no encontrarlo» significa crear OTRO (PS-50).
   */
  async listRefunds(paymentIntentId: string): Promise<{ id: string; status: string; metadata: Record<string, string> }[]> {
    const out: { id: string; status: string; metadata: Record<string, string> }[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const page = await this.stripe.refunds.list({
        payment_intent: paymentIntentId,
        limit: StripeService.REFUND_LIST_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const r of page.data) {
        out.push({ id: r.id, status: r.status ?? 'pending', metadata: (r.metadata ?? {}) as Record<string, string> });
      }
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    return out;
  }

  /**
   * v1.80 (§M4-SHIP.7 paso 4) — ¿el error de Stripe es DEFINITIVO (la fila pasa a `failed`) o TRANSITORIO
   * (la fila se queda `requested` y se reintenta)? `StripeInvalidRequestError` (monto mayor al disponible,
   * cargo en disputa, PI inexistente) es definitivo; red, `5xx`, `rate_limit`, timeouts son transitorios.
   * ⛔ NO MEDIDO en Stripe MX el `code` exacto de un reembolso sobre un cargo disputado (se anota en
   * BACKEND_NOTES cuando se pruebe en modo prueba).
   */
  static classifyRefundError(e: unknown): { definitive: boolean; code: string } {
    if (e instanceof Stripe.errors.StripeInvalidRequestError || e instanceof Stripe.errors.StripeCardError) {
      return { definitive: true, code: e.code ?? e.type ?? 'invalid_request' };
    }
    if (e instanceof Stripe.errors.StripeError) {
      return { definitive: false, code: e.code ?? e.type ?? 'stripe_error' };
    }
    return { definitive: false, code: 'network' };
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
