/**
 * checkout-reservation-owner.e2e-spec.ts — v1.68 «LA RESERVA TIENE DUEÑO» (API_CONTRACT §4-R,
 * ARCHITECTURE §4.48.2/§4.48.9, P-59). Integración contra Postgres REAL, webhooks Stripe FIRMADOS y
 * el doble de Stripe del arnés (`TestStripeService`: PaymentIntents offline; sin claves `STRIPE_*`).
 *
 * Candados que fija (§4-R.7): R-1 (cliente D no recupera la reserva de C), R-2 (el webhook del PI
 * viejo NO libera la pieza de la orden nueva), R-3 (N=5 concurrentes del mismo cliente ⇒ UNA orden y
 * UN PI; 10 corridas, proporción), R-4 (cancelar ANTES de crear; `processing|succeeded` ⇒
 * `409 PAYMENT_IN_PROGRESS` con cero escritura), R-5 (el reuso no re-precia ni crea PI), R-6 (la
 * orden de BÓVEDA `pending` expira: barrido único), R-7 (el invitado recupera SOLO con
 * `retryOfCheckoutToken`; el correo solo no es identidad).
 */
import { E2EHarness } from './helpers/e2e-app';
import { OrderReservationSweepJobService } from '../../src/jobs/order-reservation-sweep.service';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);
const ADDRESS = {
  line1: 'Av. Reforma 100',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};

describe('E2E — v1.68 §4-R: la reserva tiene DUEÑO (reintento del mismo cliente, un cobro por pieza)', () => {
  let h: E2EHarness;
  let tokenC: string;
  let tokenD: string;
  let customerCId: string;
  let template: { cardId: string; locationId: string | null };
  let seq = 0;

  /** Pieza PROPIA de esta corrida (clona la charizard listada del seed; folio único). */
  async function piece(tag: string) {
    return h.prisma.inventoryItem.create({
      data: {
        folio: `E2E-RSV-${RUN}-${tag}-${(seq += 1)}`,
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

  const session = (token: string, ids: string[]) =>
    h.api('POST', '/checkout/session', { token, json: { inventoryItemIds: ids } });

  const guestSession = (ids: string[], email: string, retryOfCheckoutToken?: string) =>
    h.api('POST', '/checkout/guest/session', {
      json: {
        inventoryItemIds: ids,
        email,
        shippingAddress: ADDRESS,
        acceptedTerms: true,
        ...(retryOfCheckoutToken ? { retryOfCheckoutToken } : {}),
      },
    });

  const item = (id: string) => h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } });
  const order = (id: string) => h.prisma.order.findUniqueOrThrow({ where: { id } });
  const pendingOrdersOfCWith = (itemId: string) =>
    h.prisma.order.count({
      where: { userId: customerCId, status: 'pending', items: { some: { inventoryItemId: itemId } } },
    });
  const intentsOf = (orderId: string) =>
    h.stripe.createdIntents.filter((i) => i.metadata.orderId === orderId).length;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    tokenC = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    tokenD = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    customerCId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).id;
    template = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard } });
  });

  afterAll(async () => {
    // LIMPIEZA (medido): las piezas de BÓVEDA que esta suite deja `pending` para el cliente C
    // (ownerType=customer, ownershipStatus=pending) CUENTAN en su portafolio, y `vault-shipments`
    // asierta el total exacto del seed — 3 corridas dejaron 42 charizards de más (4 200 000 ¢). Se
    // devuelven a plataforma fuera de venta y sus órdenes quedan `failed`; el seed no las conoce.
    if (h) {
      const mine = await h.prisma.inventoryItem.findMany({
        where: { folio: { startsWith: `E2E-RSV-${RUN}-` } },
        select: { id: true },
      });
      const ids = mine.map((m) => m.id);
      await h.prisma.order.updateMany({
        where: { status: 'pending', items: { some: { inventoryItemId: { in: ids } } } },
        data: { status: 'failed' },
      });
      await h.prisma.inventoryItem.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'withdrawn',
          ownerType: 'platform',
          ownerUserId: null,
          ownershipStatus: null,
          reservedByOrderId: null,
          reservedUntil: null,
        },
      });
    }
    await h?.close();
  });

  afterEach(() => {
    h.stripe.cancelOutcome = 'canceled';
  });

  describe('cliente C con cuenta — la historia (1)→(5) de ARCHITECTURE §4.48.9', () => {
    let X: string;
    let Y: string;
    let O1: string;
    let PI1: string;
    let O2: string;
    let breakdownO1: Record<string, unknown>;

    it('(1) primera compra ⇒ 201, la reserva lleva DUEÑO (O1) y vencimiento (M-53); respuesta aditiva', async () => {
      X = (await piece('X')).id;
      const res = await session(tokenC, [X]);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ reused: false, supersededOrderIds: [] });
      expect(typeof res.body.orderNumber).toBe('string');
      expect(res.body.orderNumber).toMatch(/^TCG-\d{6}$/);
      expect(new Date(res.body.reservedUntil).getTime()).toBeGreaterThan(Date.now() + 55 * 60 * 1000);
      O1 = res.body.orderId;
      PI1 = res.body.stripe.paymentIntentId;
      breakdownO1 = res.body.breakdown;
      const x = await item(X);
      expect(x.status).toBe('reserved');
      expect(x.reservedByOrderId).toBe(O1);
      expect(x.reservedUntil).not.toBeNull();
      expect(x.ownerType).toBe('customer');
      expect(x.ownerUserId).toBe(customerCId);
    });

    it('(2) mismo cliente, mismo carrito ⇒ 200 reused: MISMA orden, MISMO PI, TTL renovado, cero PI nuevos (R-5: no re-precia)', async () => {
      const before = await item(X);
      // R-5: el precio de catálogo se mueve dentro del TTL; el PI cobra lo CONGELADO.
      await h.prisma.inventoryItem.update({ where: { id: X }, data: { listPriceCents: 999900 } });
      await new Promise((r) => setTimeout(r, 15));
      const res = await session(tokenC, [X]);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        orderId: O1,
        reused: true,
        supersededOrderIds: [],
        stripe: { paymentIntentId: PI1 },
        breakdown: breakdownO1,
      });
      expect(res.body.stripe.clientSecret).toBe(`${PI1}_secret_e2e`);
      const after = await item(X);
      expect(after.reservedByOrderId).toBe(O1);
      expect(after.reservedUntil!.getTime()).toBeGreaterThan(before.reservedUntil!.getTime());
      expect(await pendingOrdersOfCWith(X)).toBe(1);
      expect(intentsOf(O1)).toBe(1);
      expect((await order(O1)).totalCents).toBe(breakdownO1.totalCents);
    });

    it('(3) carrito DISTINTO [X,Y] ⇒ 201 O2 con supersededOrderIds:[O1]; O1 failed; PI1 cancelado ANTES de crear PI2 (R-4); X e Y de O2', async () => {
      Y = (await piece('Y')).id;
      const logStart = h.stripe.callLog.length;
      const res = await session(tokenC, [X, Y]);
      expect(res.status).toBe(201);
      expect(res.body.reused).toBe(false);
      expect(res.body.supersededOrderIds).toEqual([O1]);
      O2 = res.body.orderId;
      expect(O2).not.toBe(O1);
      const PI2 = res.body.stripe.paymentIntentId;
      expect(PI2).not.toBe(PI1);
      expect((await order(O1)).status).toBe('failed');
      expect((await order(O2)).status).toBe('pending');
      expect(h.stripe.canceledIntents).toContain(PI1);
      // R-4: el orden observado en el doble: la PRIMERA llamada a Stripe de la sustitución es
      // cancel(PI1) — ningún `create` (de PI2 ni de otro) antes de confirmar la cancelación.
      const log = h.stripe.callLog.slice(logStart);
      expect(log[0]).toBe(`cancel:${PI1}`);
      expect(log.indexOf(`cancel:${PI1}`)).toBeLessThan(log.indexOf(`create:${PI2}`));
      expect(log.filter((l) => l.startsWith('create:'))).toEqual([`create:${PI2}`]);
      for (const id of [X, Y]) {
        const it = await item(id);
        expect(it.status).toBe('reserved');
        expect(it.reservedByOrderId).toBe(O2);
      }
      expect(await pendingOrdersOfCWith(X)).toBe(1);
    });

    it('(4) R-2: el webhook payment_intent.canceled de PI1 llega tarde ⇒ X SIGUE reservada por O2', async () => {
      const wh = await h.sendStripeWebhook({
        type: 'payment_intent.canceled',
        data: { object: { id: PI1, object: 'payment_intent' } },
      });
      expect(wh.status).toBe(200);
      const x = await item(X);
      expect(x.status).toBe('reserved');
      expect(x.reservedByOrderId).toBe(O2);
      expect((await order(O2)).status).toBe('pending');
    });

    it('(4b) R-2 defensa en profundidad: aunque O1 volviera a `pending`, el webhook de PI1 NO suelta la pieza de O2 (el where lleva el dueño)', async () => {
      // El camino normal ya protege por `status !== 'pending'` (O1 quedó `failed` en la sustitución);
      // este caso fuerza el estado imposible para medir la GUARDA del `where` (regla 2 de §4-R.2), que
      // es lo que la mutación m2 quita. Sin ella, X volvería a `listed` aquí.
      await h.prisma.order.update({ where: { id: O1 }, data: { status: 'pending' } });
      const wh = await h.sendStripeWebhook({
        type: 'payment_intent.canceled',
        data: { object: { id: PI1, object: 'payment_intent' } },
      });
      expect(wh.status).toBe(200);
      const x = await item(X);
      expect(x.status).toBe('reserved');
      expect(x.reservedByOrderId).toBe(O2);
      expect((await order(O1)).status).toBe('failed');
    });

    it('(5) R-1: cliente D reintenta sobre la reserva de C ⇒ 409 ITEM_UNAVAILABLE 5/5, sin datos del otro cliente', async () => {
      let refused = 0;
      for (let i = 0; i < 5; i += 1) {
        const res = await session(tokenD, [X]);
        if (res.status === 409 && res.body.error.code === 'ITEM_UNAVAILABLE') refused += 1;
        expect(JSON.stringify(res.body)).not.toContain(customerCId);
        expect(JSON.stringify(res.body)).not.toContain(O2);
      }
      expect(refused).toBe(5);
      expect((await item(X)).reservedByOrderId).toBe(O2);
    });

    it('GET /orders y GET /orders/:id (§4-R.5): orderNumber siempre; reservedUntil SOLO en pending', async () => {
      const list = await h.api('GET', '/orders?pageSize=50', { token: tokenC });
      expect(list.status).toBe(200);
      const rows = list.body.data as { id: string; status: string; orderNumber: string | null; reservedUntil?: string }[];
      const o2 = rows.find((r) => r.id === O2)!;
      const o1 = rows.find((r) => r.id === O1)!;
      expect(o2.status).toBe('pending');
      expect(o2.orderNumber).toMatch(/^TCG-\d{6}$/);
      expect(typeof o2.reservedUntil).toBe('string');
      expect(o1.status).toBe('failed');
      expect(o1).not.toHaveProperty('reservedUntil');
      const detail = await h.api('GET', `/orders/${O2}`, { token: tokenC });
      expect(detail.status).toBe(200);
      expect(detail.body.orderNumber).toBe(o2.orderNumber);
      expect(detail.body.reservedUntil).toBe(o2.reservedUntil);
      const detailFailed = await h.api('GET', `/orders/${O1}`, { token: tokenC });
      expect(detailFailed.body).not.toHaveProperty('reservedUntil');
    });
  });

  describe('R-4 — el PI viejo NO se puede cancelar ⇒ 409 PAYMENT_IN_PROGRESS y CERO escritura', () => {
    it('Stripe responde succeeded al cancelar ⇒ 409 con {orderId, orderNumber}; O3 sigue pending, Z de O3, W listed, sin orden ni PI nuevos', async () => {
      const Z = (await piece('Z')).id;
      const W = (await piece('W')).id;
      const first = await session(tokenC, [Z]);
      expect(first.status).toBe(201);
      const O3 = first.body.orderId;
      const ordersBefore = await h.prisma.order.count({ where: { userId: customerCId } });
      const intentsBefore = h.stripe.createdIntents.length;

      h.stripe.cancelOutcome = 'throws-succeeded';
      const res = await session(tokenC, [Z, W]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_IN_PROGRESS');
      expect(res.body.error.details).toEqual({ orderId: O3, orderNumber: first.body.orderNumber });

      expect((await order(O3)).status).toBe('pending');
      expect((await item(Z)).reservedByOrderId).toBe(O3);
      expect((await item(W)).status).toBe('listed');
      expect(await h.prisma.order.count({ where: { userId: customerCId } })).toBe(ordersBefore);
      expect(h.stripe.createdIntents.length).toBe(intentsBefore);
    });
  });

  describe('R-3 — carrera: N=5 llamadas CONCURRENTES del mismo cliente, mismo carrito, 10 corridas', () => {
    it('cada corrida termina con UNA orden pending y UN PI (una 201 + cuatro 200 reused) — se reporta la proporción', async () => {
      const N = 5;
      const RUNS = 10;
      let ok = 0;
      const failures: string[] = [];
      for (let run = 1; run <= RUNS; run += 1) {
        const P = (await piece(`RACE${run}`)).id;
        const results = await Promise.all(Array.from({ length: N }, () => session(tokenC, [P])));
        const statuses = results.map((r) => r.status);
        const created = results.filter((r) => r.status === 201);
        const reused = results.filter((r) => r.status === 200);
        const orderIds = new Set(results.filter((r) => r.status < 300).map((r) => r.body.orderId));
        const piIds = new Set(results.filter((r) => r.status < 300).map((r) => r.body.stripe.paymentIntentId));
        const pending = await pendingOrdersOfCWith(P);
        const intents = orderIds.size === 1 ? intentsOf([...orderIds][0]) : -1;
        const good =
          created.length === 1 &&
          reused.length === N - 1 &&
          reused.every((r) => r.body.reused === true) &&
          orderIds.size === 1 &&
          piIds.size === 1 &&
          pending === 1 &&
          intents === 1;
        if (good) ok += 1;
        else failures.push(`run ${run}: statuses=${statuses.join(',')} orders=${orderIds.size} pis=${piIds.size} pending=${pending} intents=${intents}`);
      }
      // eslint-disable-next-line no-console
      console.log(`[R-3] carrera N=${N} × ${RUNS} corridas: ${ok}/${RUNS} con UNA orden y UN PI${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
      expect(failures).toEqual([]);
      expect(ok).toBe(RUNS);
    });
  });

  describe('R-8 (v1.68.1 §4-R.5) — el QUOTE conoce la reserva propia: quote → session ⇒ 200 reused, punta a punta', () => {
    const quote = (token: string, ids: string[]) =>
      h.api('POST', '/checkout/quote', { token, json: { inventoryItemIds: ids } });
    let Q: string;
    let Q2: string;
    let orderQ: string;
    let piQ: string;
    let frozenUnit: number;
    let frozenBreakdown: Record<string, unknown>;

    it('antes de reservar: quote sin reservedByYou y ownReservation: null (siempre presente)', async () => {
      Q = (await piece('Q')).id;
      const res = await quote(tokenC, [Q]);
      expect(res.status).toBe(200);
      expect(res.body.ownReservation).toBeNull();
      expect(res.body.items[0]).not.toHaveProperty('reservedByYou');
      frozenUnit = res.body.items[0].unitPriceCents;
    });

    it('tras session: la pieza reservada por MI orden es disponible (reservedByYou:true), ownReservation coversCart y precios CONGELADOS aunque suba el precio', async () => {
      const s = await session(tokenC, [Q]);
      expect(s.status).toBe(201);
      orderQ = s.body.orderId;
      piQ = s.body.stripe.paymentIntentId;
      frozenBreakdown = s.body.breakdown;
      await h.prisma.inventoryItem.update({ where: { id: Q }, data: { listPriceCents: frozenUnit + 50000 } });
      const res = await quote(tokenC, [Q]);
      expect(res.status).toBe(200);
      expect(res.body.unavailableItems).toEqual([]);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ inventoryItemId: Q, reservedByYou: true, unitPriceCents: frozenUnit });
      expect(res.body.ownReservation).toMatchObject({
        orderId: orderQ,
        orderNumber: s.body.orderNumber,
        expired: false,
        coversCart: true,
      });
      expect(new Date(res.body.ownReservation.reservedUntil).getTime()).toBeGreaterThan(Date.now());
      expect(res.body.breakdown).toEqual(frozenBreakdown);
    });

    it('carrito distinto [Q,Q2]: Q reservedByYou, Q2 no; ownReservation.coversCart:false y precios EN LECTURA', async () => {
      Q2 = (await piece('Q2')).id;
      const res = await quote(tokenC, [Q, Q2]);
      expect(res.status).toBe(200);
      const q = res.body.items.find((i: any) => i.inventoryItemId === Q);
      const q2 = res.body.items.find((i: any) => i.inventoryItemId === Q2);
      expect(q.reservedByYou).toBe(true);
      expect(q2).not.toHaveProperty('reservedByYou');
      expect(q.unitPriceCents).toBe(frozenUnit + 50000); // en lectura: el override manual nuevo
      expect(res.body.ownReservation).toMatchObject({ orderId: orderQ, coversCart: false, expired: false });
      expect(res.body.breakdown).not.toEqual(frozenBreakdown);
    });

    it('cliente D: la misma pieza sigue en unavailableItems y ownReservation: null (la reserva no es suya)', async () => {
      const res = await quote(tokenD, [Q]);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.unavailableItems.map((u: any) => u.inventoryItemId)).toEqual([Q]);
      expect(res.body.ownReservation).toBeNull();
    });

    it('punta a punta: «Pagar» desde el quote ⇒ session con el carrito completo ⇒ 200 reused, misma orden y PI', async () => {
      const q = await quote(tokenC, [Q]);
      const ids = q.body.items.map((i: any) => i.inventoryItemId);
      expect(ids).toEqual([Q]);
      const s = await session(tokenC, ids);
      expect(s.status).toBe(200);
      expect(s.body).toMatchObject({ reused: true, orderId: orderQ, stripe: { paymentIntentId: piQ } });
      await h.prisma.inventoryItem.update({ where: { id: Q }, data: { listPriceCents: null } });
    });

    it('invitado: con retryOfCheckoutToken+email ⇒ reservedByYou; sin token ⇒ podada; token sin email ⇒ 400', async () => {
      const G = (await piece('GQ')).id;
      const email = `gquote.${RUN}@example.com`;
      const s = await guestSession([G], email);
      expect(s.status).toBe(201);
      const gq = (body: Record<string, unknown>) => h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [G], ...body } });
      const withToken = await gq({ retryOfCheckoutToken: s.body.checkoutToken, email });
      expect(withToken.status).toBe(200);
      expect(withToken.body.items[0]).toMatchObject({ inventoryItemId: G, reservedByYou: true });
      expect(withToken.body.ownReservation).toMatchObject({ orderId: s.body.orderId, coversCart: true, expired: false });
      expect(withToken.body.breakdown).toEqual(s.body.breakdown);
      const noToken = await gq({});
      expect(noToken.status).toBe(200);
      expect(noToken.body.items).toEqual([]);
      expect(noToken.body.ownReservation).toBeNull();
      const otherEmail = await gq({ retryOfCheckoutToken: s.body.checkoutToken, email: `otro.${RUN}@example.com` });
      expect(otherEmail.body.items).toEqual([]);
      expect(otherEmail.body.ownReservation).toBeNull();
      const noEmail = await gq({ retryOfCheckoutToken: s.body.checkoutToken });
      expect(noEmail.status).toBe(400);
      expect(noEmail.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('R-9 (v1.68.1) — reserva propia VENCIDA y no barrida: sustituible siempre, nunca ajena, nunca reuso', () => {
    const expire = (orderId: string) =>
      h.prisma.inventoryItem.updateMany({
        where: { reservedByOrderId: orderId },
        data: { reservedUntil: new Date(Date.now() - 60_000) },
      });

    it('quote: sigue siendo propia (reservedByYou, ownReservation.expired:true) con precios en lectura; session ⇒ 201 supersededOrderIds, no 200 ni 409', async () => {
      const E = (await piece('EXP')).id;
      const first = await session(tokenC, [E]);
      expect(first.status).toBe(201);
      await expire(first.body.orderId);
      const q = await h.api('POST', '/checkout/quote', { token: tokenC, json: { inventoryItemIds: [E] } });
      expect(q.body.items[0]).toMatchObject({ inventoryItemId: E, reservedByYou: true });
      expect(q.body.ownReservation).toMatchObject({ orderId: first.body.orderId, expired: true, coversCart: true });
      const logStart = h.stripe.callLog.length;
      const s = await session(tokenC, [E]);
      expect(s.status).toBe(201);
      expect(s.body.supersededOrderIds).toEqual([first.body.orderId]);
      expect(s.body.orderId).not.toBe(first.body.orderId);
      expect(h.stripe.callLog.slice(logStart)[0]).toBe(`cancel:${first.body.stripe.paymentIntentId}`);
      expect((await order(first.body.orderId)).status).toBe('failed');
      expect((await item(E)).reservedByOrderId).toBe(s.body.orderId);
    });

    it('carrera sesión ↔ barrido sobre la propia vencida, 10 corridas: siempre 201, la pieza acaba en la orden nueva y la vieja failed — proporción', async () => {
      const RUNS = 10;
      let ok = 0;
      const failures: string[] = [];
      for (let run = 1; run <= RUNS; run += 1) {
        const P = (await piece(`EXPRACE${run}`)).id;
        const first = await session(tokenC, [P]);
        expect(first.status).toBe(201);
        await expire(first.body.orderId);
        const [s, sweep] = await Promise.all([
          session(tokenC, [P]),
          h.app.get(OrderReservationSweepJobService).run(),
        ]);
        const it = await item(P);
        const old = await order(first.body.orderId);
        const pending = await pendingOrdersOfCWith(P);
        const good =
          s.status === 201 &&
          it.status === 'reserved' &&
          it.reservedByOrderId === s.body.orderId &&
          s.body.orderId !== first.body.orderId &&
          old.status === 'failed' &&
          pending === 1 &&
          intentsOf(s.body.orderId) === 1;
        if (good) ok += 1;
        else
          failures.push(
            `run ${run}: status=${s.status} code=${s.body?.error?.code ?? '-'} superseded=${JSON.stringify(s.body?.supersededOrderIds)} sweep=${JSON.stringify(sweep)} item=${it.status}/${it.reservedByOrderId} old=${old.status} pending=${pending}`,
          );
      }
      // eslint-disable-next-line no-console
      console.log(`[R-9] carrera sesión↔barrido × ${RUNS}: ${ok}/${RUNS}${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
      expect(failures).toEqual([]);
      expect(ok).toBe(RUNS);
    });
  });

  describe('R-6 — barrido ÚNICO por reservedUntil (bóveda E invitado)', () => {
    it('una orden de BÓVEDA pending con reservedUntil vencido se barre: pieza listed/platform, orden failed, PI cancelado (D-SB-1 cerrada)', async () => {
      const V = (await piece('VAULT')).id;
      const res = await session(tokenC, [V]);
      expect(res.status).toBe(201);
      await h.prisma.inventoryItem.updateMany({
        where: { reservedByOrderId: res.body.orderId },
        data: { reservedUntil: new Date(Date.now() - 60_000) },
      });
      const out = await h.app.get(OrderReservationSweepJobService).run();
      expect(out.swept).toBeGreaterThanOrEqual(1);
      const v = await item(V);
      expect(v.status).toBe('listed');
      expect(v.ownerType).toBe('platform');
      expect(v.ownerUserId).toBeNull();
      expect(v.reservedByOrderId).toBeNull();
      expect(v.reservedUntil).toBeNull();
      expect((await order(res.body.orderId)).status).toBe('failed');
      expect(h.stripe.canceledIntents).toContain(res.body.stripe.paymentIntentId);
    });

    it('una orden de INVITADO pending con reservedUntil vencido se barre por el MISMO camino; una viva NO se toca', async () => {
      const G = (await piece('GSWEEP')).id;
      const alive = (await piece('GALIVE')).id;
      const stale = await guestSession([G], `sweep.${RUN}@example.com`);
      const live = await guestSession([alive], `alive.${RUN}@example.com`);
      expect(stale.status).toBe(201);
      expect(live.status).toBe(201);
      await h.prisma.inventoryItem.updateMany({
        where: { reservedByOrderId: stale.body.orderId },
        data: { reservedUntil: new Date(Date.now() - 60_000) },
      });
      await h.app.get(OrderReservationSweepJobService).run();
      expect((await item(G)).status).toBe('listed');
      expect((await order(stale.body.orderId)).status).toBe('failed');
      expect((await item(alive)).status).toBe('reserved');
      expect((await order(live.body.orderId)).status).toBe('pending');
    });

    it('B3 intacto: si el PI no se puede cancelar, la reserva vencida NO se libera (se pospone)', async () => {
      const B = (await piece('B3')).id;
      const res = await session(tokenC, [B]);
      await h.prisma.inventoryItem.updateMany({
        where: { reservedByOrderId: res.body.orderId },
        data: { reservedUntil: new Date(Date.now() - 60_000) },
      });
      h.stripe.cancelOutcome = 'throws-succeeded';
      const out = await h.app.get(OrderReservationSweepJobService).run();
      expect(out.skipped).toBeGreaterThanOrEqual(1);
      expect((await item(B)).reservedByOrderId).toBe(res.body.orderId);
      expect((await order(res.body.orderId)).status).toBe('pending');
    });
  });

  describe('R-7 — el invitado recupera SOLO con retryOfCheckoutToken (§4-R.3)', () => {
    const EMAIL = `retry.${RUN}@example.com`;
    let G1: string;
    let G2: string;
    let orderG: string;
    let piG: string;
    let tokenG: string;

    it('primera sesión ⇒ 201 con checkoutToken; la reserva es de la orden', async () => {
      G1 = (await piece('G1')).id;
      const res = await guestSession([G1], EMAIL);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ reused: false, supersededOrderIds: [] });
      orderG = res.body.orderId;
      piG = res.body.stripe.paymentIntentId;
      tokenG = res.body.checkoutToken;
      expect((await item(G1)).reservedByOrderId).toBe(orderG);
    });

    it('mismo correo SIN token ⇒ 409 ITEM_UNAVAILABLE (un correo solo no es identidad); con token de OTRO pedido, ídem', async () => {
      const noToken = await guestSession([G1], EMAIL);
      expect(noToken.status).toBe(409);
      expect(noToken.body.error.code).toBe('ITEM_UNAVAILABLE');
      const other = await guestSession([(await piece('OTHER')).id], `other.${RUN}@example.com`);
      expect(other.status).toBe(201);
      const wrongToken = await guestSession([G1], EMAIL, other.body.checkoutToken);
      expect(wrongToken.status).toBe(409);
      expect(wrongToken.body.error.code).toBe('ITEM_UNAVAILABLE');
      // Token válido pero correo DISTINTO ⇒ tampoco (la orden no es de ese correo).
      const wrongEmail = await guestSession([G1], `impostor.${RUN}@example.com`, tokenG);
      expect(wrongEmail.status).toBe(409);
      expect((await item(G1)).reservedByOrderId).toBe(orderG);
    });

    it('con SU token y el mismo carrito ⇒ 200 reused: misma orden, mismo PI, checkoutToken NUEVO (el viejo sigue valiendo)', async () => {
      const res = await guestSession([G1], EMAIL, tokenG);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        orderId: orderG,
        reused: true,
        supersededOrderIds: [],
        stripe: { paymentIntentId: piG },
      });
      expect(res.body.breakdown.shippingFeeCents).toBeGreaterThan(0);
      expect(res.body.checkoutToken).not.toBe(tokenG);
      const track = await h.api('POST', '/orders/guest/track', { json: { token: tokenG } });
      expect(track.status).toBe(200);
      expect(intentsOf(orderG)).toBe(1);
    });

    it('con SU token y carrito DISTINTO ⇒ 201 con supersededOrderIds:[vieja]; la vieja failed y su PI cancelado antes', async () => {
      G2 = (await piece('G2')).id;
      const logStart = h.stripe.callLog.length;
      const res = await guestSession([G1, G2], EMAIL, tokenG);
      expect(res.status).toBe(201);
      expect(res.body.supersededOrderIds).toEqual([orderG]);
      const log = h.stripe.callLog.slice(logStart);
      expect(log[0]).toBe(`cancel:${piG}`);
      expect(log.filter((l) => l.startsWith('create:'))).toEqual([`create:${res.body.stripe.paymentIntentId}`]);
      expect((await order(orderG)).status).toBe('failed');
      for (const id of [G1, G2]) expect((await item(id)).reservedByOrderId).toBe(res.body.orderId);
    });
  });
});
