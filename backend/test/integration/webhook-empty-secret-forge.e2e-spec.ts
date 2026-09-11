/**
 * webhook-empty-secret-forge.e2e-spec.ts — **El PoC del pentester, convertido en candado.**
 *
 * `P-WH-1` (ALTA, explotado LIVE-DB): con `STRIPE_WEBHOOK_SECRET` ausente, `constructEvent` caía a
 * `?? ''` y el SDK verificaba un HMAC de **clave vacía** — computable por cualquiera. El pentester
 * forjó un `payment_intent.succeeded`, la orden quedó `settled` y la carta pasó a `in_custody` /
 * `ownershipStatus='settled'` en la bóveda del comprador. **Sin cobro.**
 *
 * Este spec repite el ataque contra la app REAL por HTTP real y Postgres real:
 *  1. Checkout real ⇒ orden `pending` + pieza `reserved`.
 *  2. Se APAGA el secreto en el `ConfigService` vivo (el estado exacto del entorno explotado).
 *  3. Se manda el evento de dinero firmado con **clave vacía** ⇒ debe NO liquidar nada.
 *  4. Se restaura el secreto y se manda **el MISMO payload bien firmado** ⇒ SÍ liquida.
 *
 * El paso 4 es lo que hace honesto al paso 3: prueba que el evento forjado era, salvo por la firma,
 * un evento que liquida de verdad. Lo único que separa al atacante del dinero es la firma — y ahora
 * aguanta. Restaurar el `?? ''` pone el paso 3 en ROJO.
 */
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { E2EHarness, webhookSecret } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

/** Firma al estilo Stripe. Con `secret: ''` es exactamente la firma del PoC. */
const signWith = (payload: string, secret: string) =>
  new Stripe('sk_test_e2e_dummy', {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
  }).webhooks.generateTestHeaderString({ payload, secret });

describe('E2E — P-WH-1: el webhook forjado con clave vacía NO liquida nada', () => {
  let h: E2EHarness;
  let customerToken: string;
  let customerId: string;
  let itemId: string;
  let orderId: string;
  let paymentIntentId: string;
  let orderTotalCents: number;
  /** El MISMO payload se manda dos veces: mal firmado (ataque) y bien firmado (control). */
  let forgedPayload: string;
  const eventId = 'evt_e2e_pwh1_forge';

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const customer = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    customerId = customer!.id;
    const inv = await h.prisma.inventoryItem.findUnique({
      where: { folio: E2E_FOLIOS.listedCharizard },
    });
    itemId = inv!.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await h?.close();
  });

  it('1) checkout real: orden `pending` y pieza `reserved` (el botín del ataque)', async () => {
    const res = await h.api('POST', '/checkout/session', {
      token: customerToken,
      json: { inventoryItemIds: [itemId] },
      headers: { 'idempotency-key': 'pwh1-forge' },
    });
    expect(res.status).toBe(201);
    orderId = res.body.orderId;
    paymentIntentId = res.body.stripe.paymentIntentId;

    const order = await h.prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe('pending');
    orderTotalCents = order!.totalCents;

    const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(item!.status).toBe('reserved');
    expect(item!.ownershipStatus).toBe('pending');

    // El evento de dinero que CUADRA con la orden (el guard H1 de monto/moneda lo aprobaría: el
    // forjador escribe el payload, así que ese guard nunca fue la barrera).
    forgedPayload = JSON.stringify({
      id: eventId,
      object: 'event',
      api_version: '2024-06-20',
      created: Math.floor(Date.now() / 1000),
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          amount: orderTotalCents,
          amount_received: orderTotalCents,
          currency: 'mxn',
        },
      },
    });
  });

  it('2+3) ATAQUE — sin secreto en el entorno, el evento firmado con clave vacía NO se acepta ni toca la BD', async () => {
    // Estado exacto del entorno explotado: el secreto no está. Se apaga en el ConfigService VIVO
    // (StripeService lo lee en cada verificación), sin tocar el resto del arnés.
    const config = h.app.get(ConfigService);
    const original = config.get.bind(config);
    const spy = jest
      .spyOn(config, 'get')
      .mockImplementation((key: any, ...rest: any[]) =>
        key === 'STRIPE_WEBHOOK_SECRET' ? undefined : (original as any)(key, ...rest),
      );

    try {
      const res = await h.api('POST', '/webhooks/stripe', {
        rawBody: forgedPayload,
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signWith(forgedPayload, ''),
        },
      });

      // No hay 200. Y es 5xx (config rota nuestra ⇒ Stripe reintenta), no 400 (culpa del cliente).
      expect(res.status).not.toBe(200);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('INTERNAL');
      // No se le confirma al atacante el estado de nuestra configuración.
      expect(res.text).not.toMatch(/STRIPE_WEBHOOK_SECRET/);
    } finally {
      spy.mockRestore();
    }

    // Lo que de verdad se mide: la BD no se movió ni un milímetro.
    const order = await h.prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe('pending');
    expect(order!.settledAt).toBeNull();

    const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(item!.status).toBe('reserved'); // NO `in_custody`
    expect(item!.ownershipStatus).toBe('pending'); // NO `settled`

    expect(
      await h.prisma.inventoryMovement.count({ where: { itemId, reason: 'settle' } }),
    ).toBe(0);
    // Y el evento forjado no consumió la idempotencia (un evento real con ese id sigue procesable).
    expect(await h.prisma.processedStripeEvent.findUnique({ where: { id: eventId } })).toBeNull();
  });

  it('4) CONTROL — el MISMO payload, bien firmado, sí liquida: la firma es la única barrera y aguanta', async () => {
    const res = await h.api('POST', '/webhooks/stripe', {
      rawBody: forgedPayload,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signWith(forgedPayload, webhookSecret()),
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const order = await h.prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe('settled');

    const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(item!.status).toBe('in_custody');
    expect(item!.ownershipStatus).toBe('settled');
    expect(item!.ownerUserId).toBe(customerId);
  });
});
