/**
 * guest-checkout.e2e-spec.ts — Integración/E2E contra Postgres real + webhook Stripe FIRMADO.
 *
 * Cubre el CAMINO FELIZ de PROJECT §J.1 de punta a punta y sus flujos negativos:
 *   comprar sin cuenta → pagar (webhook) → correo/enlace tokenizado → seguimiento →
 *   guía → enviado → entregado → reclamo del pedido con cuenta.
 * Y las tres puertas de seguridad: minimización del payload, neutralidad de errores y
 * aislamiento del envío de invitado frente a los endpoints `customer`.
 *
 * API_CONTRACT §4-G; ARCHITECTURE §4.21; PROJECT §J / criterios 45–56b.
 */
import { E2EHarness } from './helpers/e2e-app';
import { GuestOrderSweepJobService } from '../../src/jobs/guest-order-sweep.service';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { computeDirectShipBreakdown } from '../../src/common/money';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;
const SHIPPING = 17500;

/**
 * Correos ÚNICOS por corrida: la suite de integración comparte BD entre ejecuciones y un pedido de
 * invitado ya reclamado no se puede "des-reclamar" (ni su usuario borrar: la FK es RESTRICT).
 */
const RUN = Date.now().toString(36);
const GUEST_EMAIL = `invitado.e2e.${RUN}@example.com`;
const OTHER_GUEST_EMAIL = `otro.invitado.${RUN}@example.com`;
const ADDRESS = {
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};

/** Crea una pieza vendible propia de la corrida, clonando los datos de una del seed. */
async function createGuestItem(h: E2EHarness, template: { cardId: string; locationId: string | null }, folio: string) {
  return h.prisma.inventoryItem.create({
    data: {
      folio,
      cardId: template.cardId,
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'normal',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 70000,
      locationId: template.locationId,
    },
  });
}

describe('E2E — Guest checkout (comprar sin cuenta)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let itemId: string;
  let secondItemId: string;
  let unitPriceCents: number;

  // Estado del camino feliz, compartido entre pasos (el test es una historia).
  let orderId: string;
  let orderNumber: string;
  let checkoutToken: string;
  let paymentIntentId: string;
  let shipmentId: string;
  // Segundo pedido de invitado (mismo flujo, otro comprador): sirve para probar aislamiento
  // entre pedidos y la ROTACIÓN del enlace sin tocar el pedido del camino feliz.
  let otherOrderNumber: string;
  let otherToken: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    // Piezas PROPIAS de esta corrida (folio único). No se reusan las de `E2E_FOLIOS`: este flujo
    // deja `ShipmentItem` de un envío ENTREGADO sobre la pieza, y eso alteraría el resultado del
    // contracargo de otra suite (que consulta justo ese join para saber si la carta ya salió).
    const template = await h.prisma.inventoryItem.findUnique({
      where: { folio: E2E_FOLIOS.listedCharizard },
    });
    itemId = (await createGuestItem(h, template!, `E2E-GST-${RUN}-1`)).id;
    secondItemId = (await createGuestItem(h, template!, `E2E-GST-${RUN}-2`)).id;
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('§J.1 paso 1-4 — cotizar como invitado', () => {
    it('POST /checkout/guest/quote devuelve subtotal + envío + IVA + fee y las banderas de avisos', async () => {
      const res = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [itemId], shippingAddress: ADDRESS },
      });
      expect(res.status).toBe(200);
      expect(res.body.fulfillmentMode).toBe('direct_ship');
      unitPriceCents = res.body.items[0].unitPriceCents;
      expect(res.body.breakdown).toEqual(computeDirectShipBreakdown(unitPriceCents, SHIPPING, IVA, FEE));
      expect(res.body.breakdown.shippingFeeCents).toBe(SHIPPING);
      // Avisos como BANDERAS (el texto lo pinta el front con su i18n).
      expect(res.body.notices).toEqual({ finalSale: true, invoiceByEmail: true, termsRequired: true });
      // v1.21.3-quote-prune: `unavailableItems` SIEMPRE presente; `[]` cuando todo resuelve.
      expect(res.body.unavailableItems).toEqual([]);
    });

    it('v1.21.3-quote-prune: 1 vendida + 1 id inexistente + 2 vivas ⇒ 200 con 2 cotizadas y 2 podadas', async () => {
      const template = await h.prisma.inventoryItem.findUnique({
        where: { folio: E2E_FOLIOS.listedCharizard },
      });
      const viva = (await createGuestItem(h, template!, `E2E-GST-${RUN}-QPR1`)).id;
      const vendida = await createGuestItem(h, template!, `E2E-GST-${RUN}-QPR2`);
      await h.prisma.inventoryItem.update({ where: { id: vendida.id }, data: { status: 'shipped' } });
      const borrada = `no-existe-${RUN}`;

      const res = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [viva, vendida.id, borrada, itemId] },
      });
      expect(res.status).toBe(200);
      expect((res.body.items as any[]).map((i) => i.inventoryItemId).sort()).toEqual(
        [viva, itemId].sort(),
      );
      // Breakdown SOLO con las vivas (2 × unitPrice) — la poda no suma al total.
      expect(res.body.breakdown).toEqual(
        computeDirectShipBreakdown(unitPriceCents * 2, SHIPPING, IVA, FEE),
      );
      expect(res.body.unavailableItems).toEqual([
        { inventoryItemId: vendida.id, cardName: 'E2E Charizard' },
        { inventoryItemId: borrada, cardName: null },
      ]);
      expect(res.body.fulfillmentMode).toBe('direct_ship');
    });

    it('v1.21.3-quote-prune: carrito 100 % muerto ⇒ 200 con breakdown EN CEROS (incl. envío) y shape estable', async () => {
      const template = await h.prisma.inventoryItem.findUnique({
        where: { folio: E2E_FOLIOS.listedCharizard },
      });
      const vendida = await createGuestItem(h, template!, `E2E-GST-${RUN}-QPR3`);
      await h.prisma.inventoryItem.update({ where: { id: vendida.id }, data: { status: 'shipped' } });

      const res = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [vendida.id, `no-existe-2-${RUN}`] },
      });
      // Podar a vacío es 200, no 400: el tope GUEST_MAX_ITEMS se valida sobre el array del REQUEST.
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.unavailableItems).toHaveLength(2);
      expect(res.body.breakdown).toEqual({
        subtotalCents: 0,
        shippingFeeCents: 0, // no hay nada que enviar
        ivaCents: 0,
        ivaRatePct: IVA,
        processingFeeCents: 0,
        totalCents: 0,
        currency: 'MXN',
      });
      // `fulfillmentMode`/`notices` se conservan: nunca pantalla de error, solo carrito vacío + aviso.
      expect(res.body.fulfillmentMode).toBe('direct_ship');
      expect(res.body.notices).toEqual({ finalSale: true, invoiceByEmail: true, termsRequired: true });
    });

    it('el quote NO reserva inventario (sigue vendible)', async () => {
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item!.status).toBe('listed');
    });

    it('dirección fuera de México ⇒ 422 ADDRESS_NOT_MX (solo nacional)', async () => {
      const res = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [itemId], shippingAddress: { ...ADDRESS, country: 'US' } },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ADDRESS_NOT_MX');
    });

    it('elegir bóveda ⇒ 422 VAULT_REQUIRES_ACCOUNT con `upsell:true` (criterio 48: no es un error)', async () => {
      const res = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [itemId],
          email: GUEST_EMAIL,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
          fulfillmentMode: 'vault',
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VAULT_REQUIRES_ACCOUNT');
      expect(res.body.error.details).toMatchObject({ upsell: true });
    });

    it('correo con formato inválido bloquea el pago (criterio 47)', async () => {
      const res = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [itemId],
          email: 'no-es-correo',
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('un usuario CON sesión no puede usar la ruta de invitado ⇒ 409 ALREADY_AUTHENTICATED', async () => {
      const res = await h.api('POST', '/checkout/guest/quote', {
        token: adminToken,
        json: { inventoryItemIds: [itemId] },
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_AUTHENTICATED');
    });
  });

  describe('§J.1 paso 5-6 — pagar y confirmar', () => {
    it('POST /checkout/guest/session crea el pedido, reserva la pieza y devuelve UN PaymentIntent', async () => {
      const res = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [itemId],
          email: `  ${GUEST_EMAIL.toUpperCase()} `, // se normaliza server-side
          shippingAddress: ADDRESS,
          acceptedTerms: true,
          locale: 'es',
        },
      });
      expect(res.status).toBe(201);
      orderId = res.body.orderId;
      orderNumber = res.body.orderNumber;
      checkoutToken = res.body.checkoutToken;
      paymentIntentId = res.body.stripe.paymentIntentId;

      expect(orderNumber).toMatch(/^TCG-\d{6}$/);
      expect(checkoutToken).toHaveLength(43); // 32 bytes base64url
      // v1.21.1 (§4-G.7a): el token del checkout es de VIDA CORTA (120 min), no de 90 días.
      const ttlMin = (new Date(res.body.checkoutTokenExpiresAt).getTime() - Date.now()) / 60000;
      expect(ttlMin).toBeGreaterThan(110);
      expect(ttlMin).toBeLessThanOrEqual(120);
      expect(res.body.breakdown).toEqual(computeDirectShipBreakdown(unitPriceCents, SHIPPING, IVA, FEE));
      // UN solo PaymentIntent por el total (cartas + envío + IVA + fee).
      const intents = h.stripe.createdIntents.filter((i) => i.metadata.orderId === orderId);
      expect(intents).toHaveLength(1);
      expect(intents[0].amountCents).toBe(res.body.breakdown.totalCents);
    });

    it('la Order nace sin usuario, con correo normalizado, `direct_ship` y snapshot de dirección', async () => {
      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.userId).toBeNull();
      expect(order!.guestEmail).toBe(GUEST_EMAIL.toLowerCase());
      expect(order!.fulfillmentMode).toBe('direct_ship');
      expect(order!.shippingFeeCents).toBe(SHIPPING);
      expect(order!.claimedAt).toBeNull();
      expect(order!.shippingAddressSnapshot).toMatchObject({ city: 'Ciudad de México', country: 'MX' });
    });

    it('INVARIANTE: la pieza queda `reserved` pero SIGUE siendo de la plataforma (no hay bóveda)', async () => {
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item!.status).toBe('reserved');
      expect(item!.ownerType).toBe('platform');
      expect(item!.ownerUserId).toBeNull();
      expect(item!.ownershipStatus).toBeNull();
    });

    it('la pieza reservada ya no se puede volver a vender (anti double-sell)', async () => {
      // v1.21.3-quote-prune: el QUOTE ya no da 409 — responde 200 con la pieza PODADA (fuera de
      // `items`/`breakdown`, con su cardName para el aviso del front).
      const res = await h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [itemId] } });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.unavailableItems).toEqual([
        { inventoryItemId: itemId, cardName: 'E2E Charizard' },
      ]);
      // El gate DURO anti double-sell es SESSION, que sigue estricta: crear un pedido con la
      // pieza reservada DEBE fallar con 409 global.
      const session = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [itemId],
          email: `segundo.comprador.${RUN}@example.com`,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      expect(session.status).toBe(409);
      expect(session.body.error.code).toBe('ITEM_UNAVAILABLE');
    });

    it('en BD solo vive el SHA-256 del token (un dump no produce enlaces válidos)', async () => {
      const tokens = await h.prisma.orderAccessToken.findMany({ where: { orderId } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(tokens)).not.toContain(checkoutToken);
      expect(tokens[0].revokedAt).toBeNull();
    });

    it('webhook `payment_intent.succeeded`: la orden liquida y la pieza pasa a `picking` (NO a bóveda)', async () => {
      const res = await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: paymentIntentId, object: 'payment_intent' } },
      });
      expect(res.status).toBe(200);

      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe('settled');
      expect(order!.settledAt).not.toBeNull();

      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item!.status).toBe('picking');
      expect(item!.ownerType).toBe('platform');
      expect(item!.ownerUserId).toBeNull();
      expect(item!.ownershipStatus).toBeNull();
    });

    it('se crea el ShipmentRequest de fulfillment: userId=null, orderId, `picking` y montos en CERO', async () => {
      const shipment = await h.prisma.shipmentRequest.findFirst({ where: { orderId } });
      expect(shipment).not.toBeNull();
      shipmentId = shipment!.id;
      expect(shipment!.userId).toBeNull();
      expect(shipment!.status).toBe('picking');
      // El ingreso del envío vive en Order.shippingFeeCents: repetirlo aquí lo contaría dos veces.
      expect(shipment!.shippingFeeCents).toBe(0);
      expect(shipment!.totalCents).toBe(0);
      expect(shipment!.stripePaymentIntentId).toBeNull();
    });

    it('v1.21.1 §4-G.7a: el settle emite un 2º token de 90 días y NO rota el de checkout', async () => {
      const tokens = await h.prisma.orderAccessToken.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(tokens).toHaveLength(2);
      // Ninguno revocado: el settle es la excepción acotada a la rotación (mataría la
      // confirmación post-3DS que el navegador está usando).
      expect(tokens.every((t) => t.revokedAt === null)).toBe(true);
      // Dos vidas distintas, misma tabla, sin columna de tipo: solo cambia `expiresAt`.
      const ttlMin = (t: { expiresAt: Date; createdAt: Date }) =>
        (t.expiresAt.getTime() - t.createdAt.getTime()) / 60000;
      expect(ttlMin(tokens[0])).toBeCloseTo(120, 0); // checkout
      expect(ttlMin(tokens[1])).toBeCloseTo(90 * 24 * 60, 0); // seguimiento (correo)
      // El token de checkout SIGUE sirviendo para leer el pedido (esa es su razón de ser).
      const track = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      expect(track.status).toBe(200);
    });

    it('el webhook es idempotente (reintento de Stripe no duplica envío ni movimientos)', async () => {
      await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: paymentIntentId, object: 'payment_intent' } },
      });
      const shipments = await h.prisma.shipmentRequest.findMany({ where: { orderId } });
      expect(shipments).toHaveLength(1);
    });
  });

  describe('§J.1 paso 7-8 — seguimiento por enlace tokenizado', () => {
    it('POST /orders/guest/track devuelve el pedido con datos MÍNIMOS y cabeceras no-store/noindex', async () => {
      const res = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.body.orderNumber).toBe(orderNumber);
      expect(res.body.status).toBe('preparando');
      expect(res.body.emailMasked).toBe('i***@***.com');
      expect(res.body.shipping).toMatchObject({
        city: 'Ciudad de México',
        state: 'CDMX',
        postalCodeMasked: '***00',
        recipientNameMasked: 'Juan P.',
      });
      expect(res.body.claim).toEqual({ available: true });
    });

    it('I2: el bloque `payment` viaja con marca + últimos 4 (y nada más de la tarjeta)', async () => {
      const res = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      expect(res.body.payment).toEqual({ brand: 'visa', last4: '4242' });
      // Y quedó persistido al liquidar (§4-G.10), que es la ruta que nunca se había ejercido.
      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.paymentMethodBrand).toBe('visa');
      expect(order!.paymentMethodLast4).toBe('4242');
      // NUNCA el PAN ni nada más allá de la terminación.
      expect(JSON.stringify(res.body.payment)).not.toContain('4242424242424242');
    });

    it('el payload NO contiene ningún campo prohibido de la tabla cerrada (§4-G.3)', async () => {
      const res = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      const raw = JSON.stringify(res.body);
      // Ids internos y datos de otro nivel de confianza.
      for (const secret of [orderId, itemId, paymentIntentId, shipmentId, GUEST_EMAIL, ADDRESS.line1, ADDRESS.phone, '06600']) {
        expect(raw).not.toContain(secret);
      }
      for (const key of ['orderId', 'userId', 'inventoryItemId', 'folio', 'cardId', 'shipmentId', 'line1', 'phone', 'stripePaymentIntentId', 'clientSecret', 'shippingCostCents', 'billingSnapshot']) {
        expect(raw).not.toContain(`"${key}"`);
      }
    });

    it('token inventado ⇒ 404 INVALID_TOKEN neutro (no dice si el pedido existe)', async () => {
      const res = await h.api('POST', '/orders/guest/track', { json: { token: 'token-inventado-que-no-existe' } });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
      expect(JSON.stringify(res.body)).not.toContain(orderNumber);
    });

    it('el enlace de un pedido NO abre otro pedido (un token ⇒ un pedido)', async () => {
      const other = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [secondItemId],
          email: OTHER_GUEST_EMAIL,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      expect(other.status).toBe(201);
      otherOrderNumber = other.body.orderNumber;
      otherToken = other.body.checkoutToken;
      const res = await h.api('POST', '/orders/guest/track', { json: { token: otherToken } });
      expect(res.status).toBe(200);
      expect(res.body.orderNumber).toBe(other.body.orderNumber);
      expect(res.body.orderNumber).not.toBe(orderNumber);
    });

    it('el token NO es una credencial: no abre ningún endpoint `customer`', async () => {
      const res = await h.api('GET', '/orders', { token: checkoutToken });
      expect(res.status).toBe(401);
      const detail = await h.api('GET', `/orders/${orderId}`, { token: checkoutToken });
      expect(detail.status).toBe(401);
    });

    it('el reenvío responde SIEMPRE 202 con el mismo cuerpo (criterio 53)', async () => {
      // Par correcto de OTRO pedido vs. par inexistente: mismo status, mismo cuerpo.
      const real = await h.api('POST', '/orders/guest/resend-link', {
        json: { email: OTHER_GUEST_EMAIL, orderNumber: otherOrderNumber },
      });
      const fakeEmail = await h.api('POST', '/orders/guest/resend-link', {
        json: { email: 'nadie@example.com', orderNumber: otherOrderNumber },
      });
      const fakeAll = await h.api('POST', '/orders/guest/resend-link', {
        json: { email: 'nadie@example.com', orderNumber: 'TCG-999999' },
      });
      for (const res of [real, fakeEmail, fakeAll]) {
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ status: 'ACCEPTED' });
      }
    });

    it('el reenvío ROTA el enlace: el anterior deja de valer con 410 TOKEN_REVOKED (ROTATED)', async () => {
      const otherOrder = await h.prisma.order.findFirst({ where: { guestEmail: OTHER_GUEST_EMAIL } });
      // El trabajo del reenvío es post-respuesta (best-effort): se espera a que aparezca el token nuevo.
      for (let i = 0; i < 40; i++) {
        const count = await h.prisma.orderAccessToken.count({ where: { orderId: otherOrder!.id } });
        if (count > 1) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const res = await h.api('POST', '/orders/guest/track', { json: { token: otherToken } });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('TOKEN_REVOKED');
      expect(res.body.error.details).toMatchObject({ reason: 'ROTATED' });
      // v1.21.1 (§4-G.7a): el reenvío revoca TODOS los vivos (incluido el checkoutToken residual)
      // y deja exactamente UNA puerta abierta: la del último correo.
      const tokens = await h.prisma.orderAccessToken.findMany({ where: { orderId: otherOrder!.id } });
      expect(tokens.filter((t) => t.revokedAt === null)).toHaveLength(1);
      // Y `SUPPORT` ya no existe como motivo (v1.21.1): solo CLAIMED | ROTATED.
      expect(JSON.stringify(res.body)).not.toContain('SUPPORT');
    });

    it('v1.21.1 §4-G.4: un token EXPIRADO/REVOCADO sigue sirviendo como SELECTOR de reenvío', async () => {
      // `otherToken` quedó REVOCADO por la rotación del test anterior: leer con él da 410…
      const read = await h.api('POST', '/orders/guest/track', { json: { token: otherToken } });
      expect(read.status).toBe(410);
      // …y aun así el reenvío lo acepta para identificar el pedido (es la pantalla de "enlace
      // expirado", justo el momento en que se usa) y emite uno nuevo.
      const otherOrder = await h.prisma.order.findFirst({ where: { guestEmail: OTHER_GUEST_EMAIL } });
      const before = await h.prisma.orderAccessToken.count({ where: { orderId: otherOrder!.id } });
      const res = await h.api('POST', '/orders/guest/resend-link', { json: { token: otherToken } });
      expect(res.status).toBe(202);
      for (let i = 0; i < 40; i++) {
        const count = await h.prisma.orderAccessToken.count({ where: { orderId: otherOrder!.id } });
        if (count > before) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await h.prisma.orderAccessToken.count({ where: { orderId: otherOrder!.id } })).toBe(
        before + 1,
      );
    });

    it('`email` a solas ⇒ 400 (no sirve como oráculo de "este correo compró aquí")', async () => {
      const res = await h.api('POST', '/orders/guest/resend-link', { json: { email: GUEST_EMAIL } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('§J.1 paso 9 — el operador captura la guía y el pedido avanza', () => {
    it('el envío de invitado aparece en la cola de M4 marcado como `guest_direct_ship`', async () => {
      // BE-64 (QA): la suite comparte BD entre ejecuciones y este endpoint pagina de 20 en 20, así
      // que buscar "mi" envío sin paginar empieza a fallar solo cuando se acumulan envíos. Se
      // acota por `status` y se pide una página grande: el aserto depende del comportamiento, no
      // del volumen histórico de la base.
      const res = await h.api(
        'GET',
        '/admin/shipments?kind=guest_direct_ship&status=picking&pageSize=100',
        { token: adminToken },
      );
      expect(res.status).toBe(200);
      const row = (res.body.data as any[]).find((s) => s.id === shipmentId);
      expect(row).toMatchObject({
        kind: 'guest_direct_ship',
        orderNumber,
        guestEmail: GUEST_EMAIL,
        recipientName: ADDRESS.recipientName,
        userId: null,
      });
    });

    it('captura de guía ⇒ el invitado ve `guia` y el número de rastreo en su enlace (criterio 50)', async () => {
      const res = await h.api('POST', `/admin/shipments/${shipmentId}/tracking`, {
        token: adminToken,
        json: { carrier: 'Estafeta', trackingNumber: 'EST-E2E-0001', shippingCostCents: 14900 },
      });
      expect(res.status).toBe(201);
      const track = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      expect(track.body.status).toBe('guia');
      expect(track.body.shipping.carrier).toBe('Estafeta');
      expect(track.body.shipping.trackingNumber).toBe('EST-E2E-0001');
      // El COSTO interno del carrier nunca se expone al comprador.
      expect(JSON.stringify(track.body)).not.toContain('14900');
    });

    it('`enviado` mueve la pieza picking → shipped', async () => {
      const res = await h.api('PATCH', `/admin/shipments/${shipmentId}/status`, {
        token: adminToken,
        json: { to: 'enviado' },
      });
      expect(res.status).toBe(200);
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item!.status).toBe('shipped');
      const track = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      expect(track.body.status).toBe('enviado');
    });

    it('`entregado` mueve la pieza shipped → delivered (NUNCA `withdrawn`) y abre la ventana de disputa', async () => {
      const res = await h.api('PATCH', `/admin/shipments/${shipmentId}/status`, {
        token: adminToken,
        json: { to: 'entregado' },
      });
      expect(res.status).toBe(200);
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item!.status).toBe('delivered');
      expect(item!.ownerType).toBe('platform');

      const track = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      expect(track.body.status).toBe('entregado');
      expect(track.body.support.disputeWindowDays).toBe(7);
      expect(track.body.support.evidenceContact).toBe('soporte@tcgvaultmx.com');
      expect(new Date(track.body.support.disputeDeadlineAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('el historial de la pieza registra el ciclo del envío directo', async () => {
      const movements = await h.prisma.inventoryMovement.findMany({
        where: { itemId },
        orderBy: { createdAt: 'asc' },
      });
      const transitions = movements.map((m) => `${m.fromStatus}->${m.toStatus}`);
      expect(transitions).toEqual(
        expect.arrayContaining(['reserved->picking', 'picking->shipped', 'shipped->delivered']),
      );
      expect(movements.some((m) => m.toStatus === 'withdrawn')).toBe(false);
    });

    it('el envío de invitado NO aparece en `GET /shipments` de ningún cliente (riesgo #1 de M-25)', async () => {
      const customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
      const list = await h.api('GET', '/shipments', { token: customerToken });
      expect(list.status).toBe(200);
      expect((list.body.data as any[]).some((s) => s.id === shipmentId)).toBe(false);
      const detail = await h.api('GET', `/shipments/${shipmentId}`, { token: customerToken });
      expect(detail.status).toBe(404);
    });
  });

  describe('§J.1 paso 10 — reclamo del pedido con cuenta', () => {
    let userToken: string;

    beforeAll(async () => {
      const reg = await h.api('POST', '/auth/register', {
        json: { email: GUEST_EMAIL, password: 'Invitado123!', name: 'Juan Pérez' },
      });
      expect(reg.status).toBe(201);
      // El reclamo EXIGE correo verificado: se simula el clic del correo de verificación.
      await h.prisma.user.update({ where: { email: GUEST_EMAIL }, data: { emailVerified: true } });
      userToken = await h.login(GUEST_EMAIL, 'Invitado123!');
    });

    it('GET /orders/claimable lista el pedido de invitado del correo verificado', async () => {
      const res = await h.api('GET', '/orders/claimable', { token: userToken });
      expect(res.status).toBe(200);
      const row = (res.body.data as any[]).find((o) => o.orderId === orderId);
      expect(row).toMatchObject({ orderNumber, status: 'settled', itemCount: 1 });
    });

    it('POST /orders/claim vincula el pedido y aparece en el historial del usuario', async () => {
      const res = await h.api('POST', '/orders/claim', { token: userToken, json: { orderIds: [orderId] } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ claimed: [orderId], failed: [] });

      const list = await h.api('GET', '/orders', { token: userToken });
      expect((list.body.data as any[]).some((o) => o.id === orderId)).toBe(true);
      const detail = await h.api('GET', `/orders/${orderId}`, { token: userToken });
      expect(detail.status).toBe(200);
      expect(detail.body.isGuestOrder).toBe(true);
      expect(detail.body.claimedAt).toBeDefined();
    });

    it('el reclamo NO cambia destino, precio ni el estado del pedido (criterio 54)', async () => {
      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentMode).toBe('direct_ship');
      expect(order!.status).toBe('settled');
      expect(order!.guestEmail).toBe(GUEST_EMAIL.toLowerCase()); // el origen se conserva
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item!.ownerType).toBe('platform'); // NO se mueve a la bóveda del que reclama
    });

    it('reclamar REVOCA el enlace: el token viejo responde 410 TOKEN_REVOKED (reason CLAIMED)', async () => {
      const res = await h.api('POST', '/orders/guest/track', { json: { token: checkoutToken } });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('TOKEN_REVOKED');
      expect(res.body.error.details).toMatchObject({ reason: 'CLAIMED' });
    });

    it('un pedido ya reclamado no puede vincularse a una segunda cuenta (criterio 55)', async () => {
      const otherToken = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
      const res = await h.api('POST', '/orders/claim', { token: otherToken, json: { orderIds: [orderId] } });
      expect(res.status).toBe(200);
      expect(res.body.claimed).toEqual([]);
      expect(res.body.failed).toEqual([{ orderId, code: 'ORDER_ALREADY_CLAIMED' }]);
    });

    it('un pedido de invitado NO reclamado no es visible para ninguna cuenta', async () => {
      const otherOrder = await h.prisma.order.findFirst({ where: { guestEmail: OTHER_GUEST_EMAIL } });
      const res = await h.api('GET', `/orders/${otherOrder!.id}`, { token: userToken });
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('T9 — barrido de reservas de invitado sin pagar (job `guest-order-sweep`)', () => {
    it('libera la pieza, marca la orden `failed` y la carta vuelve a estar vendible', async () => {
      const template = await h.prisma.inventoryItem.findUnique({
        where: { folio: E2E_FOLIOS.listedCharizard },
      });
      const item = await createGuestItem(h, template!, `E2E-GST-${RUN}-3`);
      const session = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [item.id],
          email: `abandonado.${RUN}@example.com`,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      expect(session.status).toBe(201);
      expect((await h.prisma.inventoryItem.findUnique({ where: { id: item.id } }))!.status).toBe('reserved');

      // Se envejece la orden más allá de la ventana de reserva (60 min) sin pagarla.
      await h.prisma.order.update({
        where: { id: session.body.orderId },
        data: { createdAt: new Date(Date.now() - 90 * 60 * 1000) },
      });
      // El PI de prueba es un stub offline: cancelarlo no debe salir a la red.
      // B3: el barrido solo libera si el PI queda CANCELADO; el stub lo simula.
      jest.spyOn(h.stripe, 'cancelPaymentIntent').mockResolvedValue({ status: 'canceled' });

      const res = await h.app.get(GuestOrderSweepJobService).run();
      expect(res.swept).toBeGreaterThanOrEqual(1);

      const swept = await h.prisma.inventoryItem.findUnique({ where: { id: item.id } });
      expect(swept!.status).toBe('listed');
      expect(swept!.ownerType).toBe('platform');
      const order = await h.prisma.order.findUnique({ where: { id: session.body.orderId } });
      expect(order!.status).toBe('failed');
      expect(h.stripe.cancelPaymentIntent).toHaveBeenCalledWith(session.body.stripe.paymentIntentId);

      // Y la pieza se puede volver a vender (el inventario no quedó bloqueado). v1.21.3: un 200
      // ya no basta como prueba (el quote podado también da 200) — debe estar COTIZADA.
      const quote = await h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [item.id] } });
      expect(quote.status).toBe(200);
      expect((quote.body.items as any[]).map((i) => i.inventoryItemId)).toEqual([item.id]);
      expect(quote.body.unavailableItems).toEqual([]);
      jest.restoreAllMocks();
    });

    it('NO toca pedidos recientes ni pedidos con cuenta', async () => {
      const before = await h.prisma.order.findUnique({ where: { id: orderId } });
      await h.app.get(GuestOrderSweepJobService).run();
      const after = await h.prisma.order.findUnique({ where: { id: orderId } });
      // El pedido del camino feliz (ya liquidado) sigue intacto.
      expect(after!.status).toBe(before!.status);
      expect(after!.status).toBe('settled');
    });
  });

  /** Pedido de invitado ya envejecido más allá de la ventana de reserva (T9). */
  async function makeStaleGuestOrder(sfx: string) {
    const template = await h.prisma.inventoryItem.findUnique({
      where: { folio: E2E_FOLIOS.listedCharizard },
    });
    const item = await createGuestItem(h, template!, `E2E-GST-${RUN}-${sfx}`);
    const session = await h.api('POST', '/checkout/guest/session', {
      json: {
        inventoryItemIds: [item.id],
        email: `stale.${sfx}.${RUN}@example.com`,
        shippingAddress: ADDRESS,
        acceptedTerms: true,
      },
    });
    expect(session.status).toBe(201);
    await h.prisma.order.update({
      where: { id: session.body.orderId },
      data: { createdAt: new Date(Date.now() - 120 * 60 * 1000) },
    });
    return {
      orderId: session.body.orderId as string,
      itemId: item.id,
      piId: session.body.stripe.paymentIntentId as string,
    };
  }

  describe('B3 — carrera barrido↔settle (regresión del bloqueante de QA)', () => {
    it('ESCENARIO A: con el PI vivo, el barrido NO libera la pieza (no hay pedido pagado y comprable)', async () => {
      const template = await h.prisma.inventoryItem.findUnique({
        where: { folio: E2E_FOLIOS.listedCharizard },
      });
      const item = await createGuestItem(h, template!, `E2E-GST-${RUN}-B3`);
      const session = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [item.id],
          email: `race.${RUN}@example.com`,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      expect(session.status).toBe(201);
      await h.prisma.order.update({
        where: { id: session.body.orderId },
        data: { createdAt: new Date(Date.now() - 120 * 60 * 1000) },
      });

      // A1 (QA) — el PI ya se estaba pagando: el Stripe real LANZA al cancelarlo. El doble por
      // defecto siempre cancela, así que hay que guionizarlo o esta rama nunca se ejercita.
      h.stripe.cancelOutcome = 'throws-succeeded';
      expect(await h.app.get(GuestOrderSweepJobService).run()).toEqual({ swept: 0 });

      // La reserva sigue en pie: la pieza NO volvió a estar comprable. v1.21.3: el quote responde
      // 200 pero PODADA (fuera de `items`); el 409 duro vive en session.
      const afterSweep = await h.prisma.inventoryItem.findUnique({ where: { id: item.id } });
      expect(afterSweep!.status).toBe('reserved');
      const quote = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [item.id] },
      });
      expect(quote.status).toBe(200);
      expect(quote.body.items).toEqual([]);
      expect((quote.body.unavailableItems as any[]).map((u) => u.inventoryItemId)).toEqual([item.id]);
      h.stripe.cancelOutcome = 'canceled';

      // Y el webhook tardío liquida con la pieza donde debe estar: `picking`, no `listed`.
      const wh = await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: session.body.stripe.paymentIntentId, object: 'payment_intent' } },
      });
      expect(wh.status).toBe(200);
      const order = await h.prisma.order.findUnique({ where: { id: session.body.orderId } });
      const finalItem = await h.prisma.inventoryItem.findUnique({ where: { id: item.id } });
      const shipment = await h.prisma.shipmentRequest.findFirst({
        where: { orderId: session.body.orderId },
      });
      expect(order!.status).toBe('settled');
      expect(finalItem!.status).toBe('picking');
      expect(['listed', 'in_stock']).not.toContain(finalItem!.status);
      expect(shipment!.status).toBe('picking');
    });

    /** A3 (QA) — ambigüedad total: ni se pudo cancelar ni se pudo consultar el estado. */
    it('A3: si el estado del PI no se puede determinar, NO suelta la reserva (ante la duda, no)', async () => {
      const { itemId, orderId: staleId } = await makeStaleGuestOrder('A3');
      h.stripe.cancelOutcome = 'throws-unknown';
      expect(await h.app.get(GuestOrderSweepJobService).run()).toEqual({ swept: 0 });
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      const order = await h.prisma.order.findUnique({ where: { id: staleId } });
      expect(item!.status).toBe('reserved');
      expect(order!.status).toBe('pending'); // sigue barrible en la próxima pasada
      h.stripe.cancelOutcome = 'canceled';
    });

    it('el barrido tampoco suelta si el cancel responde un estado distinto de `canceled`', async () => {
      const { itemId } = await makeStaleGuestOrder('A2');
      h.stripe.cancelOutcome = 'requires_capture';
      expect(await h.app.get(GuestOrderSweepJobService).run()).toEqual({ swept: 0 });
      expect((await h.prisma.inventoryItem.findUnique({ where: { id: itemId } }))!.status).toBe(
        'reserved',
      );
      h.stripe.cancelOutcome = 'canceled';
    });

    it('si el PI YA estaba cancelado, sí libera (no deja reservas atrapadas para siempre)', async () => {
      const { itemId, orderId: staleId } = await makeStaleGuestOrder('A5');
      h.stripe.cancelOutcome = 'throws-canceled';
      expect((await h.app.get(GuestOrderSweepJobService).run()).swept).toBeGreaterThanOrEqual(1);
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      const order = await h.prisma.order.findUnique({ where: { id: staleId } });
      expect(item!.status).toBe('listed');
      expect(order!.status).toBe('failed');
      h.stripe.cancelOutcome = 'canceled';
    });

    /** C2 (QA) — la pieza ya está en manos de otro flujo: no se le quita a nadie. */
    it('C2: pieza comprometida con OTRO flujo al liquidar ⇒ no se le roba, se audita sin recuperar', async () => {
      const { itemId, orderId: staleId, piId } = await makeStaleGuestOrder('C2');
      await h.prisma.inventoryItem.update({
        where: { id: itemId },
        data: { status: 'in_custody', ownerType: 'platform' },
      });
      const wh = await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: piId, object: 'payment_intent' } },
      });
      expect(wh.status).toBe(200);
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item!.status).toBe('in_custody'); // intacta
      const audit = await h.prisma.auditLog.findFirst({
        where: { action: 'order.settle_inventory_anomaly', entityId: staleId },
      });
      expect(audit).toBeTruthy();
      expect(JSON.stringify(audit!.after)).toContain('"needsHumanReview":true');
    });

    it('ESCENARIO B: el barrido no toca un pedido ya liquidado (sigue `settled`, pieza en `picking`)', async () => {
      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe('settled');
      await h.app.get(GuestOrderSweepJobService).run();
      const after = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(after!.status).toBe('settled');
    });

    it('B3: si la pieza YA se liberó y el pago se confirma, el settle la RE-CONGELA y lo audita', async () => {
      const template = await h.prisma.inventoryItem.findUnique({
        where: { folio: E2E_FOLIOS.listedCharizard },
      });
      const item = await createGuestItem(h, template!, `E2E-GST-${RUN}-B3B`);
      const session = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [item.id],
          email: `race2.${RUN}@example.com`,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      // Se simula el daño ya consumado: la pieza suelta y comprable.
      await h.prisma.inventoryItem.update({ where: { id: item.id }, data: { status: 'listed' } });
      await h.prisma.order.update({ where: { id: session.body.orderId }, data: { status: 'failed' } });

      const wh = await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: session.body.stripe.paymentIntentId, object: 'payment_intent' } },
      });
      expect(wh.status).toBe(200);

      const after = await h.prisma.inventoryItem.findUnique({ where: { id: item.id } });
      expect(after!.status).toBe('picking'); // fuera de venta otra vez
      const anomalies = await h.prisma.auditLog.findMany({
        where: { action: 'order.settle_inventory_anomaly', entityId: session.body.orderId },
      });
      expect(anomalies).toHaveLength(1);
    });
  });

  describe('T1 — contracargo con envío vivo: congelar, no re-listar (§4.21h caso v)', () => {
    let cbOrderId: string;
    let cbItemId: string;
    let cbShipmentId: string;
    let cbPiId: string;

    beforeAll(async () => {
      const template = await h.prisma.inventoryItem.findUnique({
        where: { folio: E2E_FOLIOS.listedCharizard },
      });
      const item = await createGuestItem(h, template!, `E2E-GST-${RUN}-CB`);
      cbItemId = item.id;
      const session = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [cbItemId],
          email: `chargeback.${RUN}@example.com`,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      cbOrderId = session.body.orderId;
      cbPiId = session.body.stripe.paymentIntentId;
      await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: session.body.stripe.paymentIntentId, object: 'payment_intent' } },
      });
      const shipment = await h.prisma.shipmentRequest.findFirst({ where: { orderId: cbOrderId } });
      cbShipmentId = shipment!.id;
      // Contracargo con el envío VIVO (`picking`).
      await h.sendStripeWebhook({
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_e2e_cb',
            object: 'dispute',
            payment_intent: session.body.stripe.paymentIntentId,
          },
        },
      });
    });

    it('congela la pieza y cancela el envío (no la devuelve a la venta)', async () => {
      const item = await h.prisma.inventoryItem.findUnique({ where: { id: cbItemId } });
      const shipment = await h.prisma.shipmentRequest.findUnique({ where: { id: cbShipmentId } });
      const order = await h.prisma.order.findUnique({ where: { id: cbOrderId } });
      expect(item!.status).toBe('picking');
      expect(['listed', 'in_stock']).not.toContain(item!.status);
      expect(shipment!.status).toBe('cancelado');
      expect(order!.status).toBe('chargeback');
      expect(order!.chargebackNeedsManual).toBe(true);
    });

    it('REGRESIÓN DEL DOUBLE-SELL: la pieza no es comprable y sale de la cola de picking', async () => {
      // (a) el quote la PODA (v1.21.3, caso v ajustado): 200 con la pieza en `unavailableItems`
      // y FUERA de `items`/`breakdown` — la pieza sigue invendible, solo cambia el transporte…
      const quote = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [cbItemId] },
      });
      expect(quote.status).toBe(200);
      expect(quote.body.items).toEqual([]);
      expect((quote.body.unavailableItems as any[]).map((u) => u.inventoryItemId)).toEqual([cbItemId]);
      expect(quote.body.breakdown.totalCents).toBe(0);
      // …y el gate DURO anti double-sell (session) la sigue rechazando con 409 global.
      const session = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [cbItemId],
          email: `ladron.${RUN}@example.com`,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      expect(session.status).toBe(409);
      // (b) …y el operador ya no la ve en la lista de picking.
      const picking = await h.api('GET', '/admin/shipments/picking-list', { token: adminToken });
      expect(picking.status).toBe(200);
      expect((picking.body.data as any[]).some((r) => r.inventoryItemId === cbItemId)).toBe(false);
    });

    it('T1-b: una SEGUNDA disputa (otro event.id) NO descongela la pieza ni baja el flag', async () => {
      const before = await h.prisma.inventoryItem.findUnique({ where: { id: cbItemId } });
      expect(before!.status).toBe('picking');
      // Otro `event.id` ⇒ la idempotencia por evento NO lo filtra; el envío ya está `cancelado`.
      const wh = await h.sendStripeWebhook({
        id: 'evt_e2e_cb_2',
        type: 'charge.dispute.created',
        data: { object: { id: 'dp_e2e_cb_2', object: 'dispute', payment_intent: cbPiId } },
      });
      expect(wh.status).toBe(200);
      const after = await h.prisma.inventoryItem.findUnique({ where: { id: cbItemId } });
      const order = await h.prisma.order.findUnique({ where: { id: cbOrderId } });
      expect(after!.status).toBe('picking'); // sigue congelada
      expect(['listed', 'in_stock']).not.toContain(after!.status);
      expect(order!.chargebackNeedsManual).toBe(true); // la señal NO se borra
    });

    it('`reexpedir` con la orden aún en `chargeback` ⇒ 409 (no se re-expide lo que no se ganó)', async () => {
      const res = await h.api('POST', `/admin/orders/${cbOrderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'reexpedir', note: 'intento indebido' },
      });
      expect(res.status).toBe(409);
    });

    it('`note` ausente o corta ⇒ 400 VALIDATION_ERROR (es el registro de lo que vio el operador)', async () => {
      const res = await h.api('POST', `/admin/orders/${cbOrderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'recuperada' },
      });
      expect(res.status).toBe(400);
    });

    it('`recuperada` devuelve la pieza a la venta, audita y cierra la gestión manual', async () => {
      const res = await h.api('POST', `/admin/orders/${cbOrderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'recuperada', note: 'La carta sigue en el estante E2E-F01-S01' },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome: 'recuperada', chargebackNeedsManual: false });

      const item = await h.prisma.inventoryItem.findUnique({ where: { id: cbItemId } });
      expect(['listed', 'in_stock']).toContain(item!.status);
      expect(item!.ownerType).toBe('platform');
      const movement = await h.prisma.inventoryMovement.findFirst({
        where: { itemId: cbItemId, reason: 'chargeback_return' },
      });
      expect(movement).toBeTruthy();
      const order = await h.prisma.order.findUnique({ where: { id: cbOrderId } });
      expect(order!.chargebackNeedsManual).toBe(false);
      const audit = await h.prisma.auditLog.findMany({
        where: { action: 'order.chargeback_inventory', entityId: cbOrderId },
      });
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0].after)).toContain('estante');
    });

    it('IDEMPOTENCIA: repetir el desenlace ⇒ 409 y sin efectos nuevos', async () => {
      const movementsBefore = await h.prisma.inventoryMovement.count({ where: { itemId: cbItemId } });
      const res = await h.api('POST', `/admin/orders/${cbOrderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'recuperada', note: 'segundo intento' },
      });
      expect(res.status).toBe(409);
      expect(await h.prisma.inventoryMovement.count({ where: { itemId: cbItemId } })).toBe(
        movementsBefore,
      );
    });
  });

  describe('soporte y back-office', () => {
    it('POST /admin/orders/:id/tracking-link reenvía el enlace enmascarando el destino', async () => {
      const other = await h.prisma.order.findFirst({ where: { guestEmail: OTHER_GUEST_EMAIL } });
      const res = await h.api('POST', `/admin/orders/${other!.id}/tracking-link`, { token: adminToken });
      expect(res.status).toBe(200);
      expect(res.body.sentTo).toBe('o***@***.com');
      expect(res.body.orderNumber).toBe(other!.orderNumber);
      expect(JSON.stringify(res.body)).not.toContain(OTHER_GUEST_EMAIL);
      // NUNCA devuelve el token en claro.
      expect(res.body).not.toHaveProperty('token');
      expect(res.body).not.toHaveProperty('checkoutToken');
    });

    it('v1.21.1: el reenvío de SOPORTE deja AuditLog y el self-service NO (así el forense distingue)', async () => {
      const other = await h.prisma.order.findFirst({ where: { guestEmail: OTHER_GUEST_EMAIL } });
      // El contrato eliminó el `reason: SUPPORT` del cuerpo; la trazabilidad de QUIÉN rotó vive
      // aquí (§4-G.3 / ARCHITECTURE §4.21e-bis).
      const logs = await h.prisma.auditLog.findMany({
        where: { action: 'order.tracking_link.reissue', entityId: other!.id },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].actorUserId).toBeTruthy();
      expect(logs[0].entityType).toBe('Order');

      // El reenvío self-service (§4-G.4) NO escribe auditoría: es la asimetría que permite
      // distinguir una rotación de soporte de una del propio comprador.
      const selfService = await h.prisma.auditLog.findMany({
        where: { action: { contains: 'resend' } },
      });
      expect(selfService).toHaveLength(0);
    });

    it('el endpoint de soporte rechaza un pedido que no es de invitado', async () => {
      const vaultOrder = await h.prisma.order.findFirst({ where: { guestEmail: null } });
      if (vaultOrder) {
        const res = await h.api('POST', `/admin/orders/${vaultOrder.id}/tracking-link`, { token: adminToken });
        expect(res.status).toBe(422);
      }
    });

    it('M3 muestra el pedido de invitado con sus campos operativos', async () => {
      const res = await h.api('GET', '/admin/orders?guest=true', { token: adminToken });
      expect(res.status).toBe(200);
      const row = (res.body.data as any[]).find((o) => o.id === orderId);
      expect(row).toMatchObject({
        isGuestOrder: true,
        guestEmail: GUEST_EMAIL.toLowerCase(),
        orderNumber,
        fulfillmentMode: 'direct_ship',
        shippingFeeCents: SHIPPING,
      });
    });
  });
});
