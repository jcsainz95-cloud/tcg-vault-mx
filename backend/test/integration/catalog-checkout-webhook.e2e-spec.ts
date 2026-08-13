/**
 * catalog-checkout-webhook.e2e-spec.ts — Integración/E2E contra Postgres real +
 * verificación de FIRMA de webhook Stripe REAL (offline, SDK).
 * Cubre:
 *  - Catálogo/pricing: referenceValue (mercado) vs salePriceCents (markup); carta en
 *    "precio pendiente" no comprable (sellable=false, 422 PRICE_PENDING).
 *  - Checkout: breakdown (IVA 16% + fee gross-up), reserva ATÓMICA anti doble-venta.
 *  - Webhook: payment_intent.succeeded → titularidad reserved→settled; idempotencia por
 *    event.id; firma inválida → 400; charge.dispute.created → reversión a inventario.
 * API_CONTRACT §2, §4, §9; ARCHITECTURE §3.3, §4.3, §5.1.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_FOLIOS, E2E_LIST_OVERRIDE_CENTS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { computeCartBreakdown, computeSalePriceCents } from '../../src/common/money';

const FEE = { stripePct: 0.036, stripeFixedCents: 300 };
const IVA = 16;
const MARKUP = 15;

describe('E2E — Catálogo, checkout y webhooks Stripe', () => {
  let h: E2EHarness;
  let customerToken: string;
  let customerId: string;
  const itemId: Record<string, string> = {};

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const customer = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    customerId = customer!.id;
    for (const [key, folio] of Object.entries(E2E_FOLIOS)) {
      const inv = await h.prisma.inventoryItem.findUnique({ where: { folio } });
      if (inv) itemId[key] = inv.id;
    }
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('catálogo y pricing', () => {
    it('lista listings y distingue referenceValue del salePrice (markup)', async () => {
      const res = await h.api('GET', '/catalog/cards?pageSize=50');
      expect(res.status).toBe(200);
      const listing = (res.body.data as any[]).find((l) => l.inventoryItemId === itemId.listedCharizard);
      expect(listing).toBeDefined();
      expect(listing.referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: E2E_CARDS.charizard.refNmCents });
      // salePrice = referencia × (1 + markup); el valor de mercado sigue siendo la referencia.
      expect(listing.salePriceCents).toBe(computeSalePriceCents(E2E_CARDS.charizard.refNmCents, MARKUP));
      expect(listing.sellable).toBe(true);
    });

    it('override manual de listPrice se refleja como salePrice', async () => {
      const res = await h.api('GET', `/catalog/listings/${itemId.listedCommonOverride}`);
      expect(res.status).toBe(200);
      expect(res.body.salePriceCents).toBe(E2E_LIST_OVERRIDE_CENTS);
      expect(res.body.sellable).toBe(true);
    });

    it('una carta en "precio pendiente" NO es comprable (sellable=false)', async () => {
      const res = await h.api('GET', `/catalog/listings/${itemId.listedPending}`);
      expect(res.status).toBe(200);
      expect(res.body.referenceValue.status).toBe('pending');
      expect(res.body.sellable).toBe(false);
    });
  });

  describe('checkout — breakdown y precio pendiente', () => {
    it('quote calcula IVA 16% + fee gross-up sobre el salePrice', async () => {
      const res = await h.api('POST', '/checkout/quote', {
        token: customerToken,
        json: { inventoryItemIds: [itemId.listedCharizard] },
      });
      expect(res.status).toBe(200);
      const subtotal = computeSalePriceCents(E2E_CARDS.charizard.refNmCents, MARKUP);
      const expected = computeCartBreakdown(subtotal, IVA, FEE);
      expect(res.body.breakdown).toMatchObject({
        subtotalCents: expected.subtotalCents,
        ivaCents: expected.ivaCents,
        ivaRatePct: 16,
        processingFeeCents: expected.processingFeeCents,
        totalCents: expected.totalCents,
        currency: 'MXN',
      });
      // Coherencia: total = subtotal + IVA + fee; el fee NO lleva IVA.
      expect(expected.totalCents).toBe(expected.subtotalCents + expected.ivaCents + expected.processingFeeCents);
    });

    it('comprar una carta en precio pendiente devuelve 422 PRICE_PENDING', async () => {
      const res = await h.api('POST', '/checkout/quote', {
        token: customerToken,
        json: { inventoryItemIds: [itemId.listedPending] },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRICE_PENDING');
    });
  });

  describe('reserva atómica anti doble-venta (pieza única)', () => {
    it('dos checkouts concurrentes del mismo item: solo uno gana', async () => {
      const body = { inventoryItemIds: [itemId.listedGraded] };
      const [a, b] = await Promise.all([
        h.api('POST', '/checkout/session', { token: customerToken, json: body, headers: { 'idempotency-key': 'k-a' } }),
        h.api('POST', '/checkout/session', { token: customerToken, json: body, headers: { 'idempotency-key': 'k-b' } }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = [a, b].find((r) => r.status === 409)!;
      expect(loser.body.error.code).toBe('ITEM_UNAVAILABLE');
      // La pieza quedó reservada (no vendible dos veces).
      const inv = await h.prisma.inventoryItem.findUnique({ where: { id: itemId.listedGraded } });
      expect(inv!.status).toBe('reserved');
    });
  });

  describe('webhook payment_intent.succeeded → titularidad settled', () => {
    let orderId: string;
    let paymentIntentId: string;
    const eventId = 'evt_e2e_succeeded_fixed';

    it('crea la sesión de checkout (reserva + Order pending + PaymentIntent)', async () => {
      const res = await h.api('POST', '/checkout/session', {
        token: customerToken,
        json: { inventoryItemIds: [itemId.listedCharizard] },
        headers: { 'idempotency-key': 'charizard-buy' },
      });
      expect(res.status).toBe(201);
      orderId = res.body.orderId;
      paymentIntentId = res.body.stripe.paymentIntentId;
      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe('pending');
      const inv = await h.prisma.inventoryItem.findUnique({ where: { id: itemId.listedCharizard } });
      expect(inv!.status).toBe('reserved');
      expect(inv!.ownershipStatus).toBe('pending');
      expect(inv!.ownerUserId).toBe(customerId);
    });

    it('el webhook FIRMADO liquida la orden y pasa la titularidad a settled', async () => {
      const res = await h.sendStripeWebhook({
        id: eventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: paymentIntentId, object: 'payment_intent' } },
      });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe('settled');
      expect(order!.settledAt).not.toBeNull();

      const inv = await h.prisma.inventoryItem.findUnique({ where: { id: itemId.listedCharizard } });
      expect(inv!.ownershipStatus).toBe('settled');
      expect(inv!.status).toBe('in_custody');
      expect(inv!.ownerUserId).toBe(customerId);
    });

    it('es IDEMPOTENTE: reentregar el mismo event.id no re-liquida (un solo movimiento settle)', async () => {
      const res = await h.sendStripeWebhook({
        id: eventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: paymentIntentId, object: 'payment_intent' } },
      });
      expect(res.status).toBe(200);
      const settleMovements = await h.prisma.inventoryMovement.count({
        where: { itemId: itemId.listedCharizard, reason: 'settle' },
      });
      expect(settleMovements).toBe(1);
    });

    it('firma inválida → 400 (no se procesa)', async () => {
      const res = await h.api('POST', '/webhooks/stripe', {
        rawBody: JSON.stringify({ id: 'evt_bad', type: 'payment_intent.succeeded', data: { object: { id: 'pi_x' } } }),
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      });
      expect(res.status).toBe(400);
    });

    it('charge.dispute.created (contracargo) revierte el item al inventario de la plataforma', async () => {
      const res = await h.sendStripeWebhook({
        type: 'charge.dispute.created',
        data: { object: { object: 'dispute', payment_intent: paymentIntentId } },
      });
      expect(res.status).toBe(200);

      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe('chargeback');

      const inv = await h.prisma.inventoryItem.findUnique({ where: { id: itemId.listedCharizard } });
      expect(inv!.ownerType).toBe('platform');
      expect(inv!.ownerUserId).toBeNull();
      expect(inv!.ownershipStatus).toBeNull();
      expect(inv!.status).toBe('listed');

      const revert = await h.prisma.inventoryMovement.findFirst({
        where: { itemId: itemId.listedCharizard, reason: 'chargeback_return' },
      });
      expect(revert).not.toBeNull();
    });
  });
});
