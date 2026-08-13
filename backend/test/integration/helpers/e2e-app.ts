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

/** Secreto del webhook usado para firmar/verificar en la suite. */
export function webhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET || 'whsec_e2e_test_secret';
}

/**
 * StripeService de prueba: PaymentIntent/refund OFFLINE deterministas; hereda la
 * verificación de firma REAL de `constructEvent`.
 */
@Injectable()
export class TestStripeService extends StripeService {
  public readonly createdIntents: { id: string; amountCents: number; metadata: Record<string, string> }[] = [];

  constructor(config: ConfigService) {
    super(config);
  }

  async createPaymentIntent(params: {
    amountCents: number;
    metadata: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ id: string; clientSecret: string }> {
    const id = `pi_e2e_${randomUUID().replace(/-/g, '')}`;
    this.createdIntents.push({ id, amountCents: params.amountCents, metadata: params.metadata });
    return { id, clientSecret: `${id}_secret_e2e` };
  }

  async refund(_paymentIntentId: string, _idempotencyKey?: string): Promise<string> {
    return `re_e2e_${randomUUID().replace(/-/g, '')}`;
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
