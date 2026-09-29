/**
 * settle-late.e2e-spec.ts — ⭐⭐ `SEC-SETTLE-LATE` contra Postgres REAL y el webhook FIRMADO real.
 *
 * `API_CONTRACT §M4-VAULT.2-bis.2` (v1.80), `ARCHITECTURE §4.21q (p)`. El settle liquida SOLO desde
 * `pending`/`failed` (`SETTLEABLE_ORDER_STATUSES`); un `payment_intent.succeeded` que llega con la orden
 * en `refunded`/`chargeback` ⇒ `200`, ⛔ cero escrituras, ⛔ cero avisos, marcador de idempotencia queda.
 *
 *  SL-1 ⭐⭐ `vault`: settled → contracargo → `succeeded` tardío ⇒ sigue `chargeback`, `settledAt` al ms.
 *  SL-2   `refunded` → `succeeded` tardío (las dos ramas) ⇒ sigue `refunded`, nada reescrito.
 *  SL-3   `direct_ship` (registrado e invitado) en `chargeback` ⇒ ningún envío nuevo ni reactivado.
 *  SL-4 ⭐⭐ La carrera que SOLO el CAS cierra: barrera de fila escribe `chargeback` sin confirmar, el
 *         webhook pasa el early-return (lee `pending` confirmado) y se le VE bloqueado en el `UPDATE`;
 *         al confirmar, el CAS re-evalúa y pierde. N=10 por rama, proporción, canario del arnés.
 *  SL-7   Regresión del desenlace: `dispute.closed(won)` ⇒ `settled` conservando `settledAt`; luego un
 *         `succeeded` tardío ⇒ no-op.
 *
 * «Cero escrituras» se mide con `xmin` de Postgres: CUALQUIER `UPDATE` de una fila —aunque reescriba
 * los mismos valores— le cambia el `xmin`. Así «la tarjeta no se reescribió» no depende de que el doble
 * de Stripe devuelva otra tarjeta. La mitad unidad (SL-5, SL-6) vive en `test/payments.settle-late.spec.ts`.
 * `AV-2` / confirmación de invitado / `logger.warn` se capturan espiando las instancias que usa el
 * `PaymentsService` vivo de la app (el arnés no trae bandeja propia).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { diferida } from './helpers/row-lock-barrier';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { OrdersService } from '../../src/modules/orders/orders.service';

const RUN = Date.now().toString(36);
const N_CARRERA = 10;

type Mode = 'vault' | 'direct_ship';
type Mk = ReturnType<typeof mkOrderFactory>;

function mkOrderFactory(h: E2EHarness, ctx: { userId: string; template: { cardId: string; locationId: string } }) {
  let seq = 0;
  const orderIds: string[] = [];
  const itemIds: string[] = [];
  async function mk(n: number, mode: Mode = 'vault', registered = true) {
    const k = (seq += 1);
    const totalCents = 20000 + k;
    const pi = `pi_sl80_${RUN}_${k}`;
    const order = await h.prisma.order.create({
      data: {
        userId: registered ? ctx.userId : null,
        guestEmail: registered ? null : `sl80.${RUN}.${k}@example.com`,
        fulfillmentMode: mode,
        orderNumber: `SL80-${RUN}-${k}`,
        status: 'pending',
        subtotalCents: totalCents,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents,
        priceConvention: 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
        shippingAddressSnapshot: mode === 'direct_ship' ? { line1: 'x' } : undefined,
      },
    });
    orderIds.push(order.id);
    const items = [];
    for (let i = 0; i < n; i += 1) {
      const it = await h.prisma.inventoryItem.create({
        data: {
          folio: `SL80-${RUN}-${k}-${i}`,
          cardId: ctx.template.cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          acquisitionType: 'compra',
          acquisitionCostCents: 1000,
          locationId: ctx.template.locationId,
          status: 'reserved',
          reservedByOrderId: order.id,
          ...(mode === 'vault'
            ? { ownerType: 'customer' as const, ownerUserId: ctx.userId, ownershipStatus: 'pending' as const }
            : { ownerType: 'platform' as const }),
        },
      });
      itemIds.push(it.id);
      items.push(it);
      await h.prisma.orderItem.create({
        data: { orderId: order.id, inventoryItemId: it.id, cardSnapshot: {}, unitPriceCents: 1 },
      });
    }
    return { order, items, pi, totalCents, mode, registered };
  }
  return { mk, orderIds, itemIds };
}

describe('SEC-SETTLE-LATE · el settle solo liquida desde pending/failed (Postgres real, webhook firmado)', () => {
  let h: E2EHarness;
  let userId: string;
  let fx: Mk;
  let payments: PaymentsService;
  let av2: jest.SpyInstance;
  let guestConf: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let cardDetails: jest.SpyInstance;

  beforeAll(async () => {
    h = await E2EHarness.create();
    const base = await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { folio: E2E_FOLIOS.listedCharizard },
      select: { cardId: true, locationId: true },
    });
    const passwordHash = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).passwordHash;
    const u = await h.prisma.user.create({
      data: { email: `sl80.${RUN}@e2e.local`, passwordHash, name: 'SL80 Cliente', role: 'customer', emailVerified: true },
    });
    userId = u.id;
    fx = mkOrderFactory(h, { userId, template: { cardId: base.cardId, locationId: base.locationId! } });

    // Las instancias que usa el PaymentsService VIVO de la app (no copias): lo que él llame, se cuenta.
    payments = h.app.get(PaymentsService);
    const p = payments as unknown as {
      mail: { send: (m: unknown) => Promise<unknown> };
      guestMail: { sendConfirmation: (o: unknown) => Promise<void> };
      logger: { warn: (m: string) => void };
    };
    av2 = jest.spyOn(p.mail, 'send').mockImplementation(async () => ({}));
    guestConf = jest.spyOn(p.guestMail, 'sendConfirmation').mockImplementation(async () => undefined);
    warn = jest.spyOn(p.logger, 'warn');
    cardDetails = jest.spyOn(h.stripe, 'getCardDetails');
  });

  afterAll(async () => {
    av2?.mockRestore();
    guestConf?.mockRestore();
    warn?.mockRestore();
    cardDetails?.mockRestore();
    if (h) {
      const { orderIds, itemIds } = fx;
      await h.prisma.vaultPlacementItem.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
      await h.prisma.vaultPlacement.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequest: { orderId: { in: orderIds } } } });
      await h.prisma.shipmentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await h.prisma.user.deleteMany({ where: { id: userId } });
      await h.close();
    }
  });

  const evt = () => `evt_e2e_sl80_${randomUUID().replace(/-/g, '')}`;
  const pay = (o: { pi: string; totalCents: number }, id = evt()) =>
    h.sendStripeWebhook({
      id,
      type: 'payment_intent.succeeded',
      data: {
        object: { id: o.pi, object: 'payment_intent', amount: o.totalCents, amount_received: o.totalCents, currency: 'mxn' },
      },
    });
  const dispute = (pi: string) =>
    h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: pi } } });
  const disputeClosed = (pi: string, status: 'won' | 'lost') =>
    h.sendStripeWebhook({ type: 'charge.dispute.closed', data: { object: { object: 'dispute', payment_intent: pi, status } } });
  const refundFull = (o: { pi: string; totalCents: number }) =>
    h.sendStripeWebhook({
      type: 'charge.refunded',
      data: { object: { object: 'charge', payment_intent: o.pi, amount: o.totalCents, amount_refunded: o.totalCents } },
    });

  /**
   * Foto de TODO lo que el settle podría escribir para una orden: fila de la orden (con `xmin`), piezas,
   * movimientos, colocación y filas, envíos y sus filas, auditoría. Dos fotos iguales ⇒ cero escrituras.
   */
  async function foto(o: { order: { id: string }; items: { id: string }[] }) {
    const ids = o.items.map((i) => i.id);
    const q = <T>(sql: string, ...args: unknown[]) => h.prisma.$queryRawUnsafe<T[]>(sql, ...args);
    return {
      order: await q(`SELECT xmin::text AS x, * FROM "Order" WHERE id = $1`, o.order.id),
      items: await q(`SELECT xmin::text AS x, * FROM "InventoryItem" WHERE id = ANY($1::text[]) ORDER BY id`, ids),
      movements: await q(`SELECT id FROM "InventoryMovement" WHERE "itemId" = ANY($1::text[]) ORDER BY id`, ids),
      placements: await q(`SELECT xmin::text AS x, * FROM "VaultPlacement" WHERE "orderId" = $1`, o.order.id),
      placementItems: await q(
        `SELECT vpi.xmin::text AS x, vpi.* FROM "VaultPlacementItem" vpi JOIN "OrderItem" oi ON oi.id = vpi."orderItemId"
          WHERE oi."orderId" = $1 ORDER BY vpi.id`,
        o.order.id,
      ),
      shipments: await q(`SELECT xmin::text AS x, * FROM "ShipmentRequest" WHERE "orderId" = $1 ORDER BY id`, o.order.id),
      audit: await q(`SELECT id FROM "AuditLog" WHERE "entityId" = $1 ORDER BY id`, o.order.id),
    };
  }

  const settleLateWarns = () => warn.mock.calls.filter(([m]) => String(m).startsWith('SEC-SETTLE-LATE')).length;
  const marcado = async (eventId: string) => (await h.prisma.processedStripeEvent.count({ where: { id: eventId } })) === 1;

  /**
   * Lanza el `succeeded` tardío y comprueba el «perdedor/tardío exacto» del contrato: `200`, foto
   * idéntica, cero `AV-2`, cero confirmación de invitado, cero `getCardDetails`, marcador queda.
   */
  async function tardioNoOp(o: Awaited<ReturnType<Mk['mk']>>, esperado: { status: string; warn: 0 | 1 }) {
    const antes = await foto(o);
    av2.mockClear();
    guestConf.mockClear();
    warn.mockClear();
    cardDetails.mockClear();
    const id = evt();
    const res = await pay(o, id);
    const despues = await foto(o);
    expect(res.status).toBe(200);
    expect((despues.order[0] as { status: string }).status).toBe(esperado.status);
    expect(despues).toEqual(antes);
    expect(av2).toHaveBeenCalledTimes(0);
    expect(guestConf).toHaveBeenCalledTimes(0);
    expect(cardDetails).toHaveBeenCalledTimes(0);
    expect(settleLateWarns()).toBe(esperado.warn);
    expect(await marcado(id)).toBe(true);
    return { antes, despues };
  }

  describe('⭐⭐ SL-1 — `vault`: contracargo y luego `succeeded` tardío', () => {
    it('200; sigue `chargeback`; `settledAt` idéntico al ms; cero movimientos; colocación `cancelled/chargeback` intacta; AV-2 0', async () => {
      const o = await fx.mk(2, 'vault');
      expect((await pay(o)).status).toBe(200);
      expect((await dispute(o.pi)).status).toBe(200);
      const ord0 = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(ord0.status).toBe('chargeback');
      expect(ord0.settledAt).toBeInstanceOf(Date);
      const vp0 = await h.prisma.vaultPlacement.findUniqueOrThrow({ where: { orderId: o.order.id } });
      expect([vp0.status, vp0.cancelReason]).toEqual(['cancelled', 'chargeback']);

      await tardioNoOp(o, { status: 'chargeback', warn: 1 });

      const ord1 = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(ord1.settledAt!.getTime()).toBe(ord0.settledAt!.getTime());
      const vp1 = await h.prisma.vaultPlacement.findUniqueOrThrow({ where: { orderId: o.order.id } });
      expect(vp1).toEqual(vp0);
    });
  });

  describe('SL-2 — `refunded` y luego `succeeded` tardío (las dos ramas)', () => {
    it.each<[string, Mode, boolean]>([
      ['vault', 'vault', true],
      ['direct_ship registrado', 'direct_ship', true],
      ['direct_ship invitado', 'direct_ship', false],
    ])('%s: 200; sigue `refunded`; `settledAt`/`refundedAt`/tarjeta sin reescribir; sin envío nuevo', async (_n, mode, registered) => {
      const o = await fx.mk(1, mode, registered);
      expect((await pay(o)).status).toBe(200);
      expect((await refundFull(o)).status).toBe(200);
      const ord0 = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(ord0.status).toBe('refunded');
      expect(ord0.refundedAt).toBeInstanceOf(Date);
      const envios0 = await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id } });

      await tardioNoOp(o, { status: 'refunded', warn: 1 });

      const ord1 = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(ord1.settledAt!.getTime()).toBe(ord0.settledAt!.getTime());
      expect(ord1.refundedAt!.getTime()).toBe(ord0.refundedAt!.getTime());
      expect([ord1.paymentMethodBrand, ord1.paymentMethodLast4]).toEqual([ord0.paymentMethodBrand, ord0.paymentMethodLast4]);
      expect(await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id } })).toBe(envios0);
    });
  });

  describe('SL-3 — `direct_ship` en `chargeback`: ningún envío creado ni reactivado', () => {
    it.each<[string, boolean, boolean]>([
      ['registrado, contracargo tras liquidar', true, true],
      ['invitado, contracargo tras liquidar', false, true],
      ['registrado, contracargo SIN liquidar (pending → chargeback)', true, false],
      ['invitado, contracargo SIN liquidar (pending → chargeback)', false, false],
    ])('%s ⇒ 200, orden intacta (tarjeta incluida), cero envío nuevo, confirmación 0, AV-2 0', async (_n, registered, liquidarAntes) => {
      const o = await fx.mk(1, 'direct_ship', registered);
      if (liquidarAntes) expect((await pay(o)).status).toBe(200);
      expect((await dispute(o.pi)).status).toBe(200);
      const envios0 = await h.prisma.shipmentRequest.findMany({ where: { orderId: o.order.id } });
      if (liquidarAntes) expect(envios0.map((s) => s.status)).toEqual(['cancelado']); // control: el contracargo lo canceló

      const { despues } = await tardioNoOp(o, { status: 'chargeback', warn: 1 });

      const activos = await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id, status: { not: 'cancelado' } } });
      expect(activos).toBe(0);
      expect(despues.shipments).toHaveLength(envios0.length);
      if (!liquidarAntes) {
        const ord = despues.order[0] as { settledAt: Date | null; paymentMethodLast4: string | null };
        expect(ord.settledAt).toBeNull();
        expect(ord.paymentMethodLast4).toBeNull();
      }
    });
  });

  /**
   * ⭐⭐ SL-4 — el entrelazado FORZADO. Devuelve `'ok'`, `'KO(...)'` o `'INVALIDA'` (canario: no se vio
   * al webhook esperando la fila ⇒ la tirada no mide el CAS y ⛔ no cuenta como verde).
   */
  async function carreraContracargo(mode: Mode, registered: boolean): Promise<string> {
    const o = await fx.mk(1, mode, registered);
    const antes = await foto(o);
    av2.mockClear();
    guestConf.mockClear();
    const soltar = diferida();
    const tomado = diferida();
    // (1) La barrera toma la fila y la escribe a `chargeback` SIN confirmar.
    const barrera = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${o.order.id} FOR UPDATE`;
        await tx.$executeRaw`UPDATE "Order" SET status = 'chargeback' WHERE id = ${o.order.id}`;
        tomado.abrir();
        await soltar.promesa;
      },
      { timeout: 30000 },
    );
    await tomado.promesa;
    // (2) El `succeeded`: su lectura previa ve `pending` confirmado ⇒ pasa el early-return.
    let terminado = false;
    const r = pay(o).finally(() => {
      terminado = true;
    });
    // Se ESPERA a verlo bloqueado en el UPDATE del CAS (⛔ no un sleep). Si no se ve, la tirada es inválida.
    const visto = await verBloqueadoEnOrder(() => terminado);
    // (3) La barrera confirma.
    soltar.abrir();
    await barrera;
    const res = await r;
    if (!visto) return 'INVALIDA';
    const despues = await foto(o);
    const ord = despues.order[0] as { status: string; settledAt: Date | null };
    const ok =
      res.status === 200 &&
      ord.status === 'chargeback' &&
      ord.settledAt === null &&
      despues.movements.length === antes.movements.length &&
      despues.placements.length === 0 &&
      despues.shipments.length === 0 &&
      av2.mock.calls.length === 0 &&
      guestConf.mock.calls.length === 0;
    return ok
      ? 'ok'
      : `KO(${res.status},${ord.status},settledAt=${ord.settledAt ? 'sí' : 'no'},mov=${despues.movements.length},` +
          `vp=${despues.placements.length},env=${despues.shipments.length},av2=${av2.mock.calls.length},conf=${guestConf.mock.calls.length})`;
  }

  /** Como `esperarBloqueoDeFila`, pero DEVUELVE si lo vio (el canario lo decide la prueba, no revienta). */
  async function verBloqueadoEnOrder(terminado: () => boolean): Promise<boolean> {
    const hasta = Date.now() + 10000;
    while (Date.now() < hasta) {
      const filas = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'
            AND query ILIKE '%UPDATE%"Order"%'`,
      );
      if (Number(filas[0].n) >= 1) return true;
      if (terminado()) return false; // el webhook ya respondió sin pasar por el UPDATE
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  }

  describe('⭐⭐ SL-4 — la carrera que SOLO el CAS cierra (barrera de fila, N por rama)', () => {
    it.each<[string, Mode, boolean]>([
      ['vault', 'vault', true],
      ['direct_ship registrado', 'direct_ship', true],
      ['direct_ship invitado', 'direct_ship', false],
    ])(`%s — N=${N_CARRERA}: en TODAS las tiradas VÁLIDAS 200, chargeback, settledAt nulo, cero efectos`, async (n, mode, registered) => {
      const resultados: string[] = [];
      for (let t = 0; t < N_CARRERA; t += 1) resultados.push(await carreraContracargo(mode, registered));
      const validas = resultados.filter((r) => r !== 'INVALIDA');
      const verdes = validas.filter((r) => r === 'ok').length;
      // eslint-disable-next-line no-console
      console.log(
        `[SL-4 ${n}] válidas ${validas.length}/${N_CARRERA} · verdes ${verdes}/${validas.length} · ` +
          `inválidas (canario: no se vio esperar la fila) ${N_CARRERA - validas.length} · ${resultados.join(' ')}`,
      );
      // Canario del arnés: toda tirada tiene que haber medido el CAS. Si no, el arnés no mide lo que dice.
      expect(validas).toHaveLength(N_CARRERA);
      expect(validas).toEqual(Array(N_CARRERA).fill('ok'));
    });
  });

  describe('SL-7 — regresión del desenlace: dispute.closed(won) y luego `succeeded` tardío', () => {
    it('won ⇒ `settled` con `settledAt` CONSERVADO; el tardío ⇒ no-op (sigue settled, sin warn)', async () => {
      const o = await fx.mk(1, 'vault');
      expect((await pay(o)).status).toBe(200);
      const settledAt0 = (await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).settledAt!;
      expect((await dispute(o.pi)).status).toBe(200);
      expect((await disputeClosed(o.pi, 'won')).status).toBe(200);
      const ord = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect([ord.status, ord.disputeOutcome]).toEqual(['settled', 'won']);
      expect(ord.settledAt!.getTime()).toBe(settledAt0.getTime());

      await tardioNoOp(o, { status: 'settled', warn: 0 });
      const ord2 = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(ord2.settledAt!.getTime()).toBe(settledAt0.getTime());
    });
  });

  /**
   * RESIDUAL declarado (§M4-VAULT.2-bis.2, ⛔ no bloquea) — MEDICIÓN, ⛔ no norma. Orden `pending` con
   * piezas `reserved` (vencidas) reembolsada DESDE EL PANEL de Stripe (llega `charge.refunded` sin haber
   * liquidado) ⇒ `refunded` con sus piezas `reserved`; el `succeeded` tardío ya no las mueve (v1.80). ¿Qué
   * hace el barrido de reservas (`OrdersService.sweepExpiredReservations`, §4-R.4)?
   * Lectura del predicado: selecciona piezas `reserved ∧ reservedByOrderId ≠ null ∧ reservedUntil < now`
   * SIN mirar el estado de la orden; por orden, B3 (cancelar el PI y exigir `canceled`) ANTES de soltar.
   * Un PI reembolsado está `succeeded` en Stripe ⇒ la cancelación lanza ⇒ `closed:false` ⇒ se SALTA.
   * Si este comportamiento cambia, esta prueba se pone roja a propósito: el residual cambió y hay que
   * re-decidir (BACKEND_NOTES «SEC-SETTLE-LATE — residual del barrido»).
   */
  describe('RESIDUAL — barrido de reservas sobre una orden `refunded` sin liquidar (medición)', () => {
    async function refundedSinLiquidar() {
      const o = await fx.mk(2, 'vault');
      await h.prisma.inventoryItem.updateMany({
        where: { id: { in: o.items.map((i) => i.id) } },
        data: { reservedUntil: new Date(Date.now() - 60 * 60 * 1000) },
      });
      expect((await refundFull(o)).status).toBe(200);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('refunded');
      await tardioNoOp(o, { status: 'refunded', warn: 1 });
      return o;
    }
    const piezas = (o: { items: { id: string }[] }) =>
      h.prisma.inventoryItem.findMany({
        where: { id: { in: o.items.map((i) => i.id) } },
        select: { status: true, reservedByOrderId: true },
      });

    afterEach(() => {
      h.stripe.cancelOutcome = 'canceled';
    });

    it('Stripe real (PI `succeeded` ⇒ cancelar lanza): el barrido NO suelta las piezas; pasada tras pasada', async () => {
      const o = await refundedSinLiquidar();
      h.stripe.cancelOutcome = 'throws-succeeded';
      const orders = h.app.get(OrdersService);
      for (let pasada = 0; pasada < 2; pasada += 1) {
        await orders.sweepExpiredReservations(new Date());
        expect((await piezas(o)).map((p) => [p.status, p.reservedByOrderId])).toEqual([
          ['reserved', o.order.id],
          ['reserved', o.order.id],
        ]);
      }
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('refunded');
    });

    it('contraste (doble que SÍ cancela, irreal para un PI reembolsado): el barrido las soltaría a `listed`', async () => {
      const o = await refundedSinLiquidar();
      h.stripe.cancelOutcome = 'canceled';
      await h.app.get(OrdersService).sweepExpiredReservations(new Date());
      expect((await piezas(o)).map((p) => [p.status, p.reservedByOrderId])).toEqual([
        ['listed', null],
        ['listed', null],
      ]);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('refunded');
    });
  });

  describe('38 (ii) — control positivo en ESTE fichero: `failed` + `succeeded` SÍ liquida', () => {
    it('failed ⇒ settled, settledAt escrito, AV-2 1, sin warn', async () => {
      const o = await fx.mk(1, 'vault');
      await h.prisma.order.update({ where: { id: o.order.id }, data: { status: 'failed' } });
      av2.mockClear();
      warn.mockClear();
      expect((await pay(o)).status).toBe(200);
      const ord = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(ord.status).toBe('settled');
      expect(ord.settledAt).toBeInstanceOf(Date);
      expect(av2).toHaveBeenCalledTimes(1);
      expect(settleLateWarns()).toBe(0);
    });
  });
});
