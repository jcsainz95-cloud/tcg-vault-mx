/**
 * guest-chargeback.e2e-spec.ts — Integración/E2E contra Postgres real + webhooks Stripe FIRMADOS.
 *
 * Regresión permanente del CONTRACARGO de un pedido `direct_ship` (T1 / T1-b, API_CONTRACT §4-G.6,
 * ARCHITECTURE §4.21c-bis y los casos i/v/vii/viii de §4.21h). Adopta los hallazgos de QA que la
 * suite del equipo no cubría:
 *  - la disputa **PERDIDA** (el otro camino por el que una pieza podía quedarse congelada para
 *    siempre: si `lost` limpiara el flag, el caso desaparecía de toda cola);
 *  - la **segunda** `charge.dispute.created` (la idempotencia del webhook es por `event.id`, así
 *    que no la filtra) y la **monotonía** de `chargebackNeedsManual`;
 *  - la **atomicidad** del desenlace humano (dos `reexpedir` concurrentes);
 *  - el caso v por las **tres puertas de compra**, no solo la de invitado.
 *
 * Vive aparte de `guest-checkout.e2e-spec.ts` (que narra el camino feliz de §J.1) porque este
 * fichero narra otra historia: qué pasa cuando el dinero se da la vuelta.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { ShipmentsService } from '../../src/modules/shipments/shipments.service';

const RUN = Date.now().toString(36);
const ADDRESS = {
  line1: 'Av. Reforma 100',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};

describe('E2E — Contracargo de un pedido con envío directo (T1/T1-b)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let customerToken: string;
  let seq = 0;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
  }, 60000);

  afterAll(async () => {
    await h?.close();
  });

  /** Pieza vendible propia de esta corrida (folio único: la suite comparte BD entre ejecuciones). */
  async function newItem(sfx: string) {
    const tpl = await h.prisma.inventoryItem.findUnique({
      where: { folio: E2E_FOLIOS.listedCharizard },
    });
    return h.prisma.inventoryItem.create({
      data: {
        folio: `E2E-CB-${RUN}-${sfx}-${(seq += 1)}`,
        cardId: tpl!.cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 70000,
        locationId: tpl!.locationId,
      },
    });
  }

  /** Pedido de invitado SIN pagar (orden `pending`, pieza `reserved`, sin envío). */
  async function pendingOrder(sfx: string) {
    const item = await newItem(sfx);
    const res = await h.api('POST', '/checkout/guest/session', {
      json: {
        inventoryItemIds: [item.id],
        email: `cb.${sfx}.${RUN}@example.com`,
        shippingAddress: ADDRESS,
        acceptedTerms: true,
      },
    });
    expect(res.status).toBe(201);
    return { orderId: res.body.orderId as string, itemId: item.id, piId: res.body.stripe.paymentIntentId as string };
  }

  /** Pedido de invitado LIQUIDADO (pieza `picking`, envío de fulfillment en `picking`). */
  async function paidOrder(sfx: string) {
    const o = await pendingOrder(sfx);
    const wh = await h.sendStripeWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: o.piId, object: 'payment_intent' } },
    });
    expect(wh.status).toBe(200);
    const shipment = await h.prisma.shipmentRequest.findFirst({ where: { orderId: o.orderId } });
    return { ...o, shipmentId: shipment!.id };
  }

  /** Cada disputa lleva su PROPIO `event.id`: el guard de idempotencia es por evento, no por cargo. */
  const dispute = (piId: string, n: number) =>
    h.sendStripeWebhook({
      id: `evt_cb_${RUN}_${n}_${Math.random().toString(36).slice(2)}`,
      type: 'charge.dispute.created',
      data: {
        object: { id: `dp_${RUN}_${n}`, object: 'dispute', payment_intent: piId, status: 'needs_response' },
      },
    });

  const closeDispute = (piId: string, status: 'won' | 'lost') =>
    h.sendStripeWebhook({
      id: `evt_close_${RUN}_${Math.random().toString(36).slice(2)}`,
      type: status === 'won' ? 'charge.dispute.funds_reinstated' : 'charge.dispute.closed',
      data: { object: { id: `dp_close_${RUN}`, object: 'dispute', payment_intent: piId, status } },
    });

  const orderOf = (id: string) => h.prisma.order.findUnique({ where: { id } });
  const itemOf = (id: string) => h.prisma.inventoryItem.findUnique({ where: { id } });

  describe('Disputa PERDIDA — la pieza no puede quedarse congelada para siempre', () => {
    it('`lost` NO limpia el flag: el caso sigue en la cola y el desenlace humano sigue disponible', async () => {
      const o = await paidOrder('lost');
      await dispute(o.piId, 1);
      expect((await orderOf(o.orderId))!.chargebackNeedsManual).toBe(true);

      await closeDispute(o.piId, 'lost');
      const order = await orderOf(o.orderId);
      const item = await itemOf(o.itemId);
      expect(order!.status).toBe('chargeback');
      expect(order!.disputeOutcome).toBe('lost');
      // Si `lost` limpiara el flag, la pieza quedaría congelada y FUERA de toda cola: nadie
      // sabría nunca que había que decidir dónde está la carta.
      expect(order!.chargebackNeedsManual).toBe(true);
      expect(item!.status).toBe('picking');

      // Sigue visible en la cola de M3…
      const cola = await h.api('GET', '/admin/orders?needsManual=true&pageSize=100', {
        token: adminToken,
      });
      expect((cola.body.data as any[]).some((x) => x.id === o.orderId)).toBe(true);

      // …y el desenlace humano funciona igual (perder la disputa no impide recuperar la carta).
      const fin = await h.api('POST', `/admin/orders/${o.orderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'recuperada', note: 'Perdimos la disputa pero la carta sigue en el estante A3.' },
      });
      expect(fin.status).toBe(200);
      expect((await itemOf(o.itemId))!.status).toBe('listed');
      expect((await orderOf(o.orderId))!.chargebackNeedsManual).toBe(false);
    }, 60000);
  });

  describe('T1-b — segunda disputa y monotonía del flag', () => {
    it('una SEGUNDA (y TERCERA) disputa no descongela la pieza ni baja el flag', async () => {
      const o = await paidOrder('dup');
      await dispute(o.piId, 1);
      expect((await h.prisma.shipmentRequest.findUnique({ where: { id: o.shipmentId } }))!.status).toBe(
        'cancelado',
      );

      // El envío ya está `cancelado` ⇒ cae en la rama que el bug T1-b usaba para re-listar.
      for (const n of [2, 3]) {
        expect((await dispute(o.piId, n)).status).toBe(200);
        const item = await itemOf(o.itemId);
        const order = await orderOf(o.orderId);
        expect(item!.status).toBe('picking'); // el bug la ponía en `listed`
        expect(item!.ownerType).toBe('platform');
        expect(order!.chargebackNeedsManual).toBe(true); // el bug lo borraba a `false`
      }
      // La consecuencia que importa: sigue sin ser comprable.
      const q = await h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [o.itemId] } });
      expect(q.status).toBe(409);
    }, 60000);

    it('MONOTONÍA: un webhook que computa `false` no puede bajar un flag ya puesto en `true`', async () => {
      const o = await paidOrder('mono');
      await dispute(o.piId, 1);
      expect((await orderOf(o.orderId))!.chargebackNeedsManual).toBe(true);

      // Estado en el que el cálculo del webhook da `false` (pieza fuera de reserved/picking/shipped).
      await h.prisma.inventoryItem.update({ where: { id: o.itemId }, data: { status: 'in_stock' } });
      await dispute(o.piId, 2);
      // Solo el desenlace HUMANO puede bajarlo.
      expect((await orderOf(o.orderId))!.chargebackNeedsManual).toBe(true);
    }, 60000);

    it('FILA 1 legítima: pieza `reserved` sin envío ⇒ SÍ se re-lista y cierra sin gestión humana', async () => {
      const o = await pendingOrder('fila1');
      expect((await itemOf(o.itemId))!.status).toBe('reserved');

      await dispute(o.piId, 1);
      const item = await itemOf(o.itemId);
      const order = await orderOf(o.orderId);
      const movement = await h.prisma.inventoryMovement.findFirst({
        where: { itemId: o.itemId, reason: 'chargeback_return' },
      });
      // Ceñir la guardia a `reserved` NO rompió el caso que la fila 1 sí autoriza.
      expect(item!.status).toBe('listed');
      expect(item!.ownerType).toBe('platform');
      expect(order!.chargebackNeedsManual).toBe(false);
      expect(movement).toBeTruthy();
    }, 60000);
  });

  describe('§4.21h caso i — congelar no registra movimiento de inventario', () => {
    it('la pieza congelada no deja ningún `chargeback_return` (no pasó nada físico todavía)', async () => {
      const o = await paidOrder('casoi');
      await dispute(o.piId, 1);
      expect((await itemOf(o.itemId))!.status).toBe('picking');
      const retorno = await h.prisma.inventoryMovement.count({
        where: { itemId: o.itemId, reason: 'chargeback_return' },
      });
      expect(retorno).toBe(0);
    }, 60000);
  });

  describe('§4.21h caso v — la pieza congelada no es comprable POR NINGUNA puerta', () => {
    it('rechaza las tres vías de compra y sale de la lista de picking', async () => {
      const o = await paidOrder('casov');
      await dispute(o.piId, 1);

      // (a) invitado
      const guestQuote = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [o.itemId] },
      });
      expect(guestQuote.status).toBe(409);
      expect(guestQuote.body.error.code).toBe('ITEM_UNAVAILABLE');

      // (b) y (c) comprador CON cuenta: quote y session. El guardarraíl es el `status` de la pieza
      // (`picking` ∉ {listed, in_stock}), así que protege a las dos rutas de fulfillment por igual.
      const custQuote = await h.api('POST', '/checkout/quote', {
        token: customerToken,
        json: { inventoryItemIds: [o.itemId] },
      });
      expect(custQuote.status).toBe(409);
      expect(custQuote.body.error.code).toBe('ITEM_UNAVAILABLE');

      const custSession = await h.api('POST', '/checkout/session', {
        token: customerToken,
        json: { inventoryItemIds: [o.itemId] },
      });
      expect(custSession.status).toBe(409);
      expect(custSession.body.error.code).toBe('ITEM_UNAVAILABLE');

      // (d) y el operador ya no la ve en la cola de picking.
      const picking = await h.api('GET', '/admin/shipments/picking-list', { token: adminToken });
      expect(picking.status).toBe(200);
      expect((picking.body.data as any[]).some((r) => r.inventoryItemId === o.itemId)).toBe(false);
    }, 60000);
  });

  describe('Desenlace humano — atomicidad y estados', () => {
    it('dos `reexpedir` concurrentes ⇒ UN solo envío nuevo y un 409', async () => {
      const o = await paidOrder('atom');
      await dispute(o.piId, 1);
      await closeDispute(o.piId, 'won');
      // Ganar NO re-expide solo: el caso sigue esperando confirmación humana.
      const won = await orderOf(o.orderId);
      expect(won!.status).toBe('settled');
      expect(won!.disputeOutcome).toBe('won');
      expect(won!.chargebackNeedsManual).toBe(true);

      const json = { outcome: 'reexpedir', note: 'Carta localizada en el estante A3; se re-expide.' };
      const [r1, r2] = await Promise.all([
        h.api('POST', `/admin/orders/${o.orderId}/chargeback-inventory`, { token: adminToken, json }),
        h.api('POST', `/admin/orders/${o.orderId}/chargeback-inventory`, { token: adminToken, json }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      // Invariante §4-G.10: a lo más UN envío activo por orden.
      const activos = await h.prisma.shipmentRequest.count({
        where: { orderId: o.orderId, status: 'picking' },
      });
      expect(activos).toBe(1);
    }, 60000);

    it('un desenlace RECHAZADO revierte el claim: la decisión humana sigue pendiente', async () => {
      const o = await paidOrder('revert');
      await dispute(o.piId, 1);

      // `reexpedir` con la orden todavía en `chargeback` ⇒ 409…
      const bad = await h.api('POST', `/admin/orders/${o.orderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'reexpedir', note: 'Intento inválido: la disputa no se ha ganado todavía.' },
      });
      expect(bad.status).toBe(409);
      expect((await orderOf(o.orderId))!.chargebackNeedsManual).toBe(true);

      // …tanto que un desenlace válido posterior sigue funcionando.
      const ok = await h.api('POST', `/admin/orders/${o.orderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'recuperada', note: 'Carta encontrada en el estante; vuelve a la venta.' },
      });
      expect(ok.status).toBe(200);
      expect((await itemOf(o.itemId))!.status).toBe('listed');
      expect((await orderOf(o.orderId))!.chargebackNeedsManual).toBe(false);
    }, 60000);

    it('`no_recuperada` cierra el caso sin mover inventario ni marcar merma', async () => {
      const o = await paidOrder('nores');
      await dispute(o.piId, 1);
      const before = await h.prisma.inventoryMovement.count({ where: { itemId: o.itemId } });

      const res = await h.api('POST', `/admin/orders/${o.orderId}/chargeback-inventory`, {
        token: adminToken,
        json: { outcome: 'no_recuperada', note: 'La carta no está en el estante ni en la mesa de empaque.' },
      });
      expect(res.status).toBe(200);
      expect((await itemOf(o.itemId))!.status).toBe('picking'); // se queda donde está
      // Sin merma de almacén: no se marca `lost`/`damaged` ni se registra movimiento.
      expect(await h.prisma.inventoryMovement.count({ where: { itemId: o.itemId } })).toBe(before);
      expect((await orderOf(o.orderId))!.chargebackNeedsManual).toBe(false);
    }, 60000);
  });

  describe('§M3 — la cola `?needsManual` que hace descubrible el desenlace', () => {
    it('acota la cola y NO altera el listado por defecto', async () => {
      const o = await paidOrder('filtro');
      await dispute(o.piId, 1);

      const def = await h.api('GET', '/admin/orders?pageSize=100', { token: adminToken });
      const yes = await h.api('GET', '/admin/orders?needsManual=true&pageSize=100', { token: adminToken });
      const no = await h.api('GET', '/admin/orders?needsManual=false&pageSize=100', { token: adminToken });
      const bogus = await h.api('GET', '/admin/orders?needsManual=xyz&pageSize=100', { token: adminToken });

      expect((yes.body.data as any[]).every((x) => x.chargebackNeedsManual === true)).toBe(true);
      expect((yes.body.data as any[]).some((x) => x.id === o.orderId)).toBe(true);
      expect((no.body.data as any[]).every((x) => x.chargebackNeedsManual === false)).toBe(true);
      // Partición exacta del listado, y un valor no reconocido lo deja intacto.
      expect(yes.body.total + no.body.total).toBe(def.body.total);
      expect(bogus.body.total).toBe(def.body.total);
    }, 60000);
  });

  describe('§4.21h caso viii — D4: el discriminador lanza en vez de asumir `direct_ship`', () => {
    it('un envío con `orderId` cuya orden es `vault` LANZA (combinación imposible = corrupción)', async () => {
      const customer = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
      const order = await h.prisma.order.create({
        data: {
          userId: customer!.id,
          orderNumber: `TCG-D4-${RUN}`,
          fulfillmentMode: 'vault',
          status: 'settled',
          subtotalCents: 1000,
          processingFeeCents: 0,
          ivaCents: 0,
          totalCents: 1000,
          ivaRatePct: 16,
        },
      });
      const shipment = await h.prisma.shipmentRequest.create({
        data: {
          userId: customer!.id,
          orderId: order.id,
          addressSnapshot: {},
          status: 'guia',
          shippingFeeCents: 0,
          ivaCents: 0,
          processingFeeCents: 0,
          totalCents: 0,
        },
      });

      // La transición terminal NO puede tratarlo como envío directo "por si acaso".
      const res = await h.api('PATCH', `/admin/shipments/${shipment.id}/status`, {
        token: adminToken,
        json: { to: 'enviado' },
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');

      // Y el helper lo dice con todas las letras (mensaje operable para el que depure).
      const svc = h.app.get(ShipmentsService) as unknown as {
        isDirectShipFulfillment: (s: unknown) => Promise<boolean>;
      };
      await expect(svc.isDirectShipFulfillment(shipment)).rejects.toThrow(
        /Unsupported fulfillmentMode/,
      );
    }, 60000);
  });
});
