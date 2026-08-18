import * as http from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { GuestOrdersController } from '../src/modules/orders/guest-orders.controller';
import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { RejectAuthenticatedGuard } from '../src/modules/orders/guards/reject-authenticated.guard';
import { OrdersController } from '../src/modules/orders/orders.controller';

const ADDRESS = {
  line1: 'Av. Reforma 100',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez',
};

/** Cliente HTTP mínimo (sin dependencias nuevas), igual criterio que el harness E2E. */
function request(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (data) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(data));
    }
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method, headers },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: chunks ? JSON.parse(chunks) : undefined,
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Test de CONTRATO de los endpoints §4-G.1–§4-G.4: rutas, verbos, códigos de estado, forma de la
 * request (validación) y cabeceras obligatorias, contra la app Nest real (pipes + filtro globales)
 * con el servicio mockeado.
 */
describe('Contrato — endpoints públicos del guest checkout', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    quote: jest.fn(async () => ({ items: [], fulfillmentMode: 'direct_ship', breakdown: {}, notices: {} })),
    createSession: jest.fn(
      async (dto: Record<string, unknown>) =>
        ({ orderId: 'o1', orderNumber: 'TCG-000001', trackingToken: 'tok', echo: dto }) as unknown,
    ),
    track: jest.fn(async () => ({ orderNumber: 'TCG-000001' })),
    resendLink: jest.fn(() => ({ status: 'ACCEPTED' })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GuestOrdersController],
      providers: [
        { provide: GuestCheckoutService, useValue: service },
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
      ],
    })
      // El guard tiene su propia suite (reject-authenticated.guard.spec.ts); aquí se neutraliza
      // para probar la FORMA del contrato sin infraestructura de JWT/BD.
      .overrideGuard(RejectAuthenticatedGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api/v1`;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('POST /checkout/guest/quote → 200 con carrito válido', async () => {
    const res = await request(baseUrl, 'POST', '/checkout/guest/quote', { inventoryItemIds: ['i1'] });
    expect(res.status).toBe(200);
  });

  it('POST /checkout/guest/quote → 400 VALIDATION_ERROR con carrito vacío o >20 líneas', async () => {
    const empty = await request(baseUrl, 'POST', '/checkout/guest/quote', { inventoryItemIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    const tooMany = await request(baseUrl, 'POST', '/checkout/guest/quote', {
      inventoryItemIds: Array.from({ length: 21 }, (_, i) => `i${i}`),
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /checkout/guest/session → 201 con la forma completa del contrato', async () => {
    const res = await request(baseUrl, 'POST', '/checkout/guest/session', {
      inventoryItemIds: ['i1'],
      email: 'guest@example.com',
      shippingAddress: ADDRESS,
      acceptedTerms: true,
    });
    expect(res.status).toBe(201);
    expect(service.createSession).toHaveBeenCalled();
  });

  it('POST /checkout/guest/session → 400 sin correo, con correo inválido o sin acceptedTerms', async () => {
    const base = { inventoryItemIds: ['i1'], shippingAddress: ADDRESS, acceptedTerms: true };
    for (const body of [
      { ...base, email: undefined },
      { ...base, email: 'no-es-un-correo' },
      { ...base, email: 'a@b.com', acceptedTerms: false },
      { ...base, email: 'a@b.com', acceptedTerms: undefined },
      { ...base, email: 'a@b.com', shippingAddress: { ...ADDRESS, postalCode: '123' } },
      { ...base, email: 'a@b.com', shippingAddress: { ...ADDRESS, phone: '55' } },
      { ...base, email: 'a@b.com', shippingAddress: undefined },
    ]) {
      const res = await request(baseUrl, 'POST', '/checkout/guest/session', body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it('POST /checkout/guest/session acepta fulfillmentMode explícito (`vault` lo resuelve el servicio)', async () => {
    const res = await request(baseUrl, 'POST', '/checkout/guest/session', {
      inventoryItemIds: ['i1'],
      email: 'a@b.com',
      shippingAddress: ADDRESS,
      acceptedTerms: true,
      fulfillmentMode: 'vault',
    });
    // La validación de forma pasa; el 422 VAULT_REQUIRES_ACCOUNT es decisión de NEGOCIO.
    expect(res.status).toBe(201);
    expect((service.createSession.mock.calls[0] as unknown[])[0]).toMatchObject({
      fulfillmentMode: 'vault',
    });
  });

  it('POST /orders/guest/track → 200 con `no-store` y `noindex` (el enlace no se cachea ni se indexa)', async () => {
    const res = await request(baseUrl, 'POST', '/orders/guest/track', { token: 'abc' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('POST /orders/guest/track → 400 sin token', async () => {
    const res = await request(baseUrl, 'POST', '/orders/guest/track', {});
    expect(res.status).toBe(400);
  });

  it('POST /orders/guest/resend-link → 202 ACCEPTED', async () => {
    const res = await request(baseUrl, 'POST', '/orders/guest/resend-link', { token: 'abc' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'ACCEPTED' });
  });

  it('el token NUNCA viaja en la ruta (no existe GET /orders/guest/track/:token)', async () => {
    const res = await request(baseUrl, 'GET', '/orders/guest/track/algun-token');
    expect(res.status).toBe(404);
  });

  it('no hay endpoint público para listar/buscar pedidos (criterio 52)', async () => {
    for (const path of ['/orders/guest', '/orders/guest/search', '/orders/guest/by-email']) {
      const res = await request(baseUrl, 'GET', path);
      expect(res.status).toBe(404);
    }
  });
});

describe('Contrato — metadatos de seguridad de los endpoints de invitado', () => {
  const reflector = new Reflector();
  const limit = (fn: unknown) => Reflect.getMetadata('THROTTLER:LIMITdefault', fn as object);
  const ttl = (fn: unknown) => Reflect.getMetadata('THROTTLER:TTLdefault', fn as object);
  const proto = GuestOrdersController.prototype;

  it('los cuatro endpoints son @Public() (sin JWT)', () => {
    for (const h of [proto.quote, proto.session, proto.track, proto.resendLink]) {
      expect(reflector.get<boolean>(IS_PUBLIC_KEY, h)).toBe(true);
    }
  });

  it('los rate limits son EXACTAMENTE los tabulados en §4-G', () => {
    expect({ ttl: ttl(proto.quote), limit: limit(proto.quote) }).toEqual({ ttl: 60_000, limit: 30 });
    expect({ ttl: ttl(proto.session), limit: limit(proto.session) }).toEqual({ ttl: 3_600_000, limit: 5 });
    expect({ ttl: ttl(proto.track), limit: limit(proto.track) }).toEqual({ ttl: 60_000, limit: 20 });
    expect({ ttl: ttl(proto.resendLink), limit: limit(proto.resendLink) }).toEqual({
      ttl: 3_600_000,
      limit: 3,
    });
  });

  it('/checkout/guest/* rechaza sesiones válidas; /orders/guest/* no necesita ese guard', () => {
    const guardsOf = (h: unknown) => Reflect.getMetadata('__guards__', h as object) ?? [];
    expect(guardsOf(proto.quote)).toContain(RejectAuthenticatedGuard);
    expect(guardsOf(proto.session)).toContain(RejectAuthenticatedGuard);
    expect(guardsOf(proto.track)).not.toContain(RejectAuthenticatedGuard);
  });

  it('el reclamo exige correo verificado y está limitado por frecuencia', () => {
    const p = OrdersController.prototype;
    expect(Reflect.getMetadata('requireEmailVerified', p.claimable)).toBe(true);
    expect(Reflect.getMetadata('requireEmailVerified', p.claim)).toBe(true);
    expect({ ttl: ttl(p.claimable), limit: limit(p.claimable) }).toEqual({ ttl: 60_000, limit: 30 });
    expect({ ttl: ttl(p.claim), limit: limit(p.claim) }).toEqual({ ttl: 3_600_000, limit: 10 });
  });

  it('`GET /orders/claimable` se declara ANTES de `GET /orders/:orderId` (o Nest lo trataría como un id)', () => {
    const methods = Object.getOwnPropertyNames(OrdersController.prototype);
    expect(methods.indexOf('claimable')).toBeLessThan(methods.indexOf('get'));
  });
});
