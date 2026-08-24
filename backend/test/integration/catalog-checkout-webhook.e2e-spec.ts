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
import { computeCartBreakdown } from '../../src/common/money';
// v2.0 (P-48, §4.36.1): el precio de venta sale de la CURVA. El E2E lo calcula con la MISMA pura que
// el backend — si alguien mueve un dial del seed, este test se mueve con él y no miente.
import { DEFAULT_PRICING_CURVE, resolveSaleFromCurve } from '../../src/common/pricing-curve';

/** Precio de venta que la curva del seed produce para un mercado dado. */
const salePrice = (marketCents: number) => resolveSaleFromCurve(marketCents, DEFAULT_PRICING_CURVE).cents as number;

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;

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
      // BE-64 (patrón, regla de la casa): NUNCA buscar una fila concreta en un listado paginado de
      // BD compartida — las suites de guest checkout dejan piezas `E2E-GST-*` listadas del MISMO
      // charizard por corrida y al acumularse >50 la pieza del seed caía fuera de la página (falló
      // primero con `?pageSize=50` a secas y luego incluso acotando con `q=`: 51 listings del mismo
      // nombre). La pieza concreta se pide POR ID (`/catalog/listings/:id`, mismo ListingDTO) y el
      // listado se asierta por COMPORTAMIENTO (responde y contiene solo vendibles), no por volumen.
      const byId = await h.api('GET', `/catalog/listings/${itemId.listedCharizard}`);
      expect(byId.status).toBe(200);
      expect(byId.body.referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: E2E_CARDS.charizard.refNmCents });
      // v2.0: salePrice = redondeo↑(max(piso, mercado × markup(mercado))); el valor de mercado sigue
      // siendo la referencia. $1,000 × 1.15 = $1,150 (ya múltiplo de $25, el redondeo no lo mueve).
      expect(byId.body.salePriceCents).toBe(salePrice(E2E_CARDS.charizard.refNmCents));
      expect(byId.body.priceBasis).toBe('market'); // §N.7: SÍ se muestra «Valor de mercado» en la ficha
      expect(byId.body.sellable).toBe(true);

      // El listado de Compra responde y toda fila publicada es vendible con precio resuelto
      // (invariante «solo se lista lo que tiene precio»), sin depender de qué página cae cada pieza.
      // v1.38-grouped-listings (P-30): el listado es AGRUPADO (GroupedListingDTO) — toda fila es un GRUPO
      // VIVO (stockCount≥1) con precio resuelto (>0) y un representante para add-to-cart de 1.
      const list = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.charizard.name)}&pageSize=20`);
      expect(list.status).toBe(200);
      expect((list.body.data as any[]).length).toBeGreaterThan(0);
      for (const l of list.body.data as any[]) {
        expect(l.stockCount).toBeGreaterThanOrEqual(1);
        expect(l.salePriceCents).toBeGreaterThan(0);
        expect(typeof l.representativeInventoryItemId).toBe('string');
      }
    });

    it('override manual de listPrice se refleja como salePrice', async () => {
      const res = await h.api('GET', `/catalog/listings/${itemId.listedCommonOverride}`);
      expect(res.status).toBe(200);
      expect(res.body.salePriceCents).toBe(E2E_LIST_OVERRIDE_CENTS);
      expect(res.body.sellable).toBe(true);
    });

    it('una carta en "precio pendiente" NO es visible en Compra (v1.1: 404, el comprador nunca la ve)', async () => {
      // v1.1 (API_CONTRACT §catalog/listings): un item sin precio resoluble no aparece en
      // Compra → 404 (antes de v1.1 devolvía 200 con sellable=false). El estado "precio
      // pendiente" vive solo en adquisición/back-office; el comprador nunca lo ve.
      const res = await h.api('GET', `/catalog/listings/${itemId.listedPending}`);
      expect(res.status).toBe(404);
    });
  });

  describe('checkout — breakdown y precio pendiente', () => {
    it('quote calcula IVA 16% + fee gross-up sobre el salePrice', async () => {
      const res = await h.api('POST', '/checkout/quote', {
        token: customerToken,
        json: { inventoryItemIds: [itemId.listedCharizard] },
      });
      expect(res.status).toBe(200);
      const subtotal = salePrice(E2E_CARDS.charizard.refNmCents);
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
      // v1.21.3-quote-prune: `unavailableItems` SIEMPRE presente; `[]` cuando todo el carrito
      // resuelve (compatibilidad: la forma previa no cambia, solo se suma el `[]` aditivo).
      expect(res.body.unavailableItems).toEqual([]);
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

  describe('v1.21.3-quote-prune — resolución POR ÍTEM en POST /checkout/quote (customer)', () => {
    const QPR = Date.now().toString(36);
    let qprSeq = 0;

    /** Pieza propia de esta suite (clona la charizard listada; mismo cardId ⇒ mismo salePrice). */
    async function clonePiece(over: Record<string, unknown> = {}) {
      const tpl = await h.prisma.inventoryItem.findUnique({
        where: { folio: E2E_FOLIOS.listedCharizard },
      });
      return h.prisma.inventoryItem.create({
        data: {
          folio: `E2E-QPR-${QPR}-${(qprSeq += 1)}`,
          cardId: tpl!.cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          ownerType: 'platform',
          status: 'listed',
          acquisitionType: 'compra',
          acquisitionCostCents: 70000,
          locationId: tpl!.locationId,
          ...over,
        },
      });
    }

    it('1 vendida (cardName) + 1 id inexistente (null) + 2 vivas ⇒ 200 con 2 cotizadas y 2 podadas', async () => {
      const viva1 = await clonePiece();
      const viva2 = await clonePiece();
      const vendida = await clonePiece({ status: 'shipped' }); // existe pero ya salió de la venta
      const borrada = `no-existe-${QPR}`; // el id ya no resuelve (pieza borrada)

      const res = await h.api('POST', '/checkout/quote', {
        token: customerToken,
        json: { inventoryItemIds: [viva1.id, vendida.id, borrada, viva2.id] },
      });
      expect(res.status).toBe(200);
      expect((res.body.items as any[]).map((i) => i.inventoryItemId).sort()).toEqual(
        [viva1.id, viva2.id].sort(),
      );
      // El breakdown se calcula SOLO con las vivas.
      const unit = salePrice(E2E_CARDS.charizard.refNmCents);
      expect(res.body.breakdown).toEqual(computeCartBreakdown(unit * 2, IVA, FEE));
      expect(res.body.unavailableItems).toEqual([
        { inventoryItemId: vendida.id, cardName: E2E_CARDS.charizard.name },
        { inventoryItemId: borrada, cardName: null },
      ]);
    });

    it('carrito 100 % muerto ⇒ 200 con items: [], unavailableItems poblado y breakdown EN CEROS', async () => {
      const vendida = await clonePiece({ status: 'shipped' });
      const res = await h.api('POST', '/checkout/quote', {
        token: customerToken,
        json: { inventoryItemIds: [vendida.id, `no-existe-2-${QPR}`] },
      });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.unavailableItems).toHaveLength(2);
      // Misma forma, todo en cero (nunca pantalla de error; el front deshabilita "pagar").
      expect(res.body.breakdown).toEqual({
        subtotalCents: 0,
        ivaCents: 0,
        ivaRatePct: 16,
        processingFeeCents: 0,
        totalCents: 0,
        currency: 'MXN',
      });
    });

    it('ANTI-SOBRECORRECCIÓN: POST /checkout/session sigue ESTRICTO (409/404 globales, sin poda)', async () => {
      const viva = await clonePiece();
      const vendida = await clonePiece({ status: 'shipped' });

      const conMuerta = await h.api('POST', '/checkout/session', {
        token: customerToken,
        json: { inventoryItemIds: [viva.id, vendida.id] },
      });
      expect(conMuerta.status).toBe(409);
      expect(conMuerta.body.error.code).toBe('ITEM_UNAVAILABLE');

      const conBorrada = await h.api('POST', '/checkout/session', {
        token: customerToken,
        json: { inventoryItemIds: [viva.id, `no-existe-3-${QPR}`] },
      });
      expect(conBorrada.status).toBe(404);
      expect(conBorrada.body.error.code).toBe('NOT_FOUND');

      // Y el rechazo NO dejó nada reservado: la pieza viva sigue vendible.
      const inv = await h.prisma.inventoryItem.findUnique({ where: { id: viva.id } });
      expect(inv!.status).toBe('listed');
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
    // H1: el webhook debe CUADRAR monto/moneda con la orden o el guard NO liquida.
    let orderTotalCents: number;
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
      orderTotalCents = order!.totalCents;
      const inv = await h.prisma.inventoryItem.findUnique({ where: { id: itemId.listedCharizard } });
      expect(inv!.status).toBe('reserved');
      expect(inv!.ownershipStatus).toBe('pending');
      expect(inv!.ownerUserId).toBe(customerId);
    });

    it('el webhook FIRMADO liquida la orden y pasa la titularidad a settled', async () => {
      const res = await h.sendStripeWebhook({
        id: eventId,
        type: 'payment_intent.succeeded',
        // H1: como en Stripe real, el PI trae monto capturado y moneda; deben cuadrar con la orden.
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
