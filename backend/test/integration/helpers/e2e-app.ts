/**
 * e2e-app.ts — Arranque de la app REAL de Nest para integración/E2E, más utilidades
 * HTTP y de Stripe. Propiedad: backend.
 *
 * - Levanta el `AppModule` completo (mismos guards/pipes/filtro/raw-body que main.ts)
 *   escuchando en un puerto efímero; las suites lo golpean por HTTP real.
 * - Conecta contra Postgres REAL (PrismaService.$connect). Redis/MinIO se ejercitan
 *   en flujos dedicados (jobs / uploads) — ver *.e2e-spec.ts.
 * - Stripe: se sobreescribe SOLO la creación de PaymentIntent/refund (llamadas de red)
 *   por stubs deterministas OFFLINE. La verificación de FIRMA del webhook
 *   (`constructEvent`) se hereda REAL, y las firmas de prueba se generan con el SDK.
 *
 * Sin dependencias nuevas: el cliente HTTP usa el módulo `http` nativo (tipado por
 * @types/node), evitando añadir supertest.
 */
import * as http from 'http';
import { randomUUID } from 'crypto';
import { Injectable, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import Stripe from 'stripe';
import { AppModule } from '../../../src/app.module';
import { AllExceptionsFilter } from '../../../src/common/filters/all-exceptions.filter';
import { StripeService } from '../../../src/modules/payments/stripe.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * Secreto del webhook usado para firmar/verificar en la suite.
 *
 * S-88-4: aquí decía `|| 'whsec_e2e_test_secret'` — el literal público ganaba **exactamente
 * cuando faltaba el de verdad**, que es el patrón de `P-WH-1`, en el helper del que dependen los
 * tests de dinero. Ya no hay respaldo: `setup.ts` genera uno EFÍMERO por corrida, así que la
 * ausencia aquí solo puede significar que este helper se usó fuera de la suite de integración
 * (sin `setupFilesAfterEnv`) — y eso debe explotar, no firmar con una clave commiteada.
 */
export function webhookSecret(): string {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!secret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET no está definido: la suite NO firma webhooks con un literal de ' +
        'respaldo (S-88-4). Corre con `test/jest-integration.config.js` (su `setup.ts` genera uno ' +
        'efímero) o expórtalo tú.',
    );
  }
  return secret;
}

/**
 * StripeService de prueba: PaymentIntent/refund OFFLINE deterministas; hereda la
 * verificación de firma REAL de `constructEvent`.
 */
@Injectable()
export class TestStripeService extends StripeService {
  public readonly createdIntents: { id: string; amountCents: number; metadata: Record<string, string> }[] = [];
  /** PaymentIntents cancelados por el barrido (B3). */
  public readonly canceledIntents: string[] = [];
  /**
   * v1.68 (candado R-4) — BITÁCORA del ORDEN de llamadas a Stripe (`create:<pi>` / `cancel:<pi>`).
   * La sustitución del reintento (§4-R.2) debe CANCELAR el PI viejo antes de CREAR el nuevo; solo
   * el orden observado lo demuestra.
   */
  public readonly callLog: string[] = [];
  /**
   * Stripe REAL devuelve el MISMO PaymentIntent ante la misma `idempotencyKey` (24 h). El doble lo
   * modela: es la garantía H2 («pi-order-<id>» server-side ⇒ un reintento no crea dos PI»), y sin
   * ella el doble sería MENOS estricto que Stripe justo en la propiedad que se mide.
   */
  private readonly byIdempotencyKey = new Map<string, { id: string; clientSecret: string }>();

  constructor(config: ConfigService) {
    super(config);
  }

  async createPaymentIntent(params: {
    amountCents: number;
    metadata: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ id: string; clientSecret: string }> {
    if (params.idempotencyKey && this.byIdempotencyKey.has(params.idempotencyKey)) {
      const same = this.byIdempotencyKey.get(params.idempotencyKey)!;
      this.callLog.push(`replay:${same.id}`);
      return same;
    }
    const id = `pi_e2e_${randomUUID().replace(/-/g, '')}`;
    this.createdIntents.push({ id, amountCents: params.amountCents, metadata: params.metadata });
    this.callLog.push(`create:${id}`);
    const pi = { id, clientSecret: `${id}_secret_e2e` };
    if (params.idempotencyKey) this.byIdempotencyKey.set(params.idempotencyKey, pi);
    return pi;
  }

  /**
   * v1.68 (§4-R.2 REUSO) — el mismo PI, releído: `clientSecret` determinista a partir del id (igual
   * que lo emitió `createPaymentIntent`), estado según lo cancelado por el doble.
   */
  async retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<{ id: string; status: string; clientSecret: string }> {
    return {
      id: paymentIntentId,
      status: this.canceledIntents.includes(paymentIntentId) ? 'canceled' : 'requires_payment_method',
      clientSecret: `${paymentIntentId}_secret_e2e`,
    };
  }

  async refund(_paymentIntentId: string, _idempotencyKey?: string): Promise<string> {
    return `re_e2e_${randomUUID().replace(/-/g, '')}`;
  }

  /**
   * I2 (QA) — sin este override, `getCardDetails` salía a la RED real con la clave dummy, fallaba y
   * devolvía `null`: la ruta que persiste `paymentMethodBrand`/`paymentMethodLast4` (§4-G.10) y el
   * bloque `payment` del `GuestOrderTrackingDTO` (§4-G.3) **nunca corrían en verde**. Devuelve una
   * tarjeta determinista, como haría Stripe con el charge liquidado.
   */
  async getCardDetails(_paymentIntentId: string): Promise<{ brand: string; last4: string } | null> {
    return { brand: 'visa', last4: '4242' };
  }

  /**
   * B3 — el barrido solo libera si el PI queda CANCELADO. El doble por defecto cancela SIEMPRE, así
   * que por sí solo **nunca ejercita la rama peligrosa** (lo señaló QA). `cancelOutcome` permite
   * guionizar el comportamiento del Stripe REAL sin parchear la instancia a mano:
   *  - `'canceled'`            → cancela de verdad (camino feliz).
   *  - `'throws-succeeded'`   → LANZA como Stripe con un PI ya pagado, y el estado observable es
   *                              `succeeded` ⇒ la reserva NO se debe soltar.
   *  - `'throws-canceled'`    → LANZA pero el PI ya estaba cancelado ⇒ sí se puede soltar.
   *  - `'throws-unknown'`     → LANZA y el estado no se puede consultar ⇒ ante la duda, no soltar.
   *  - `'requires_capture'`   → responde un estado que NO es `canceled` ⇒ tampoco se suelta.
   */
  public cancelOutcome:
    | 'canceled'
    | 'throws-succeeded'
    | 'throws-canceled'
    | 'throws-unknown'
    | 'requires_capture' = 'canceled';

  /**
   * ⭐ **H-3 / I3 — RETARDO INYECTABLE de la cancelación (latencia de Stripe).**
   *
   * `supersedeOwnOrder` cancela el PaymentIntent **dentro** del `$transaction` que retiene la
   * conexión y el `pg_advisory_xact_lock` (`RESERVATION_TX_OPTIONS.timeout = 30_000`). El doble
   * por defecto responde en microsegundos, así que **por sí solo nunca ejercita la propiedad que
   * importa**: cuánto tiempo una sustitución mantiene ocupada una conexión del pool esperando a
   * un tercero. Con este dial se mide (ver `stripe-in-tx-pool.e2e-spec.ts`).
   */
  public cancelDelayMs = 0;

  async cancelPaymentIntent(paymentIntentId: string): Promise<{ status: string }> {
    if (this.cancelDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.cancelDelayMs));
    }
    this.callLog.push(`cancel:${paymentIntentId}`);
    switch (this.cancelOutcome) {
      case 'throws-succeeded':
        throw new Error(
          'You cannot cancel this PaymentIntent because it has a status of succeeded.',
        );
      case 'throws-canceled':
        throw new Error(
          'You cannot cancel this PaymentIntent because it has a status of canceled.',
        );
      case 'throws-unknown':
        throw new Error('network down');
      case 'requires_capture':
        return { status: 'requires_capture' };
      case 'canceled':
      default:
        this.canceledIntents.push(paymentIntentId);
        return { status: 'canceled' };
    }
  }

  async getPaymentIntentStatus(paymentIntentId: string): Promise<string | null> {
    switch (this.cancelOutcome) {
      case 'throws-succeeded':
        return 'succeeded';
      case 'throws-canceled':
        return 'canceled';
      case 'throws-unknown':
        return null;
      default:
        return this.canceledIntents.includes(paymentIntentId)
          ? 'canceled'
          : 'requires_payment_method';
    }
  }
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  text: string;
  headers: http.IncomingHttpHeaders;
}

export interface ApiOptions {
  token?: string;
  json?: unknown;
  /** Body crudo (para el webhook firmado). Tiene prioridad sobre `json`. */
  rawBody?: string;
  headers?: Record<string, string>;
}

export class E2EHarness {
  private constructor(
    public readonly app: INestApplication,
    public readonly baseUrl: string,
    public readonly prisma: PrismaService,
    public readonly stripe: TestStripeService,
  ) {}

  static async create(): Promise<E2EHarness> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeService)
      .useClass(TestStripeService)
      .compile();

    const app = moduleRef.createNestApplication();

    // Réplica EXACTA de la configuración de main.ts (raw body para el webhook incluido).
    app.setGlobalPrefix('api/v1');
    app.use(
      '/api/v1/webhooks/stripe',
      json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.use(json());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
    await app.listen(0);
    const server = app.getHttpServer();
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}/api/v1`;

    const prisma = app.get(PrismaService);
    const stripe = app.get(StripeService) as TestStripeService;
    return new E2EHarness(app, baseUrl, prisma, stripe);
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  /** Petición HTTP real contra la app (JSON por defecto; `rawBody` para el webhook). */
  api<T = any>(method: string, path: string, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const data = opts.rawBody ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined);
      const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
      if (opts.rawBody === undefined && opts.json !== undefined) headers['content-type'] = 'application/json';
      if (data !== undefined) headers['content-length'] = String(Buffer.byteLength(data));
      if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;

      const req = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () => {
            let body: unknown;
            try {
              body = chunks ? JSON.parse(chunks) : undefined;
            } catch {
              body = undefined;
            }
            resolve({ status: res.statusCode ?? 0, body: body as T, text: chunks, headers: res.headers });
          });
        },
      );
      req.on('error', reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
  }

  /** Login → accessToken. */
  async login(email: string, password: string): Promise<string> {
    const res = await this.api('POST', '/auth/login', { json: { email, password } });
    if (res.status !== 200) {
      throw new Error(`login failed for ${email}: ${res.status} ${res.text}`);
    }
    return (res.body as { accessToken: string }).accessToken;
  }

  /**
   * Construye y ENVÍA un evento de webhook Stripe FIRMADO al endpoint real.
   * La firma se genera con el SDK (offline) usando el mismo `STRIPE_WEBHOOK_SECRET`
   * que verifica el backend. Devuelve la respuesta HTTP del handler.
   */
  async sendStripeWebhook(event: {
    id?: string;
    type: string;
    data: { object: Record<string, unknown> };
  }): Promise<ApiResponse> {
    const payload = JSON.stringify({
      id: event.id ?? `evt_e2e_${randomUUID().replace(/-/g, '')}`,
      object: 'event',
      api_version: '2024-06-20',
      created: Math.floor(Date.now() / 1000),
      type: event.type,
      data: event.data,
    });
    const signer = new Stripe('sk_test_e2e_dummy', { apiVersion: '2024-06-20' as Stripe.LatestApiVersion });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: webhookSecret() });
    return this.api('POST', '/webhooks/stripe', {
      rawBody: payload,
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
    });
  }
}
