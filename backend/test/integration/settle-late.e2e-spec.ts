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
  /** v1.80.8.3 (SL-9): una orden `vault` `pending` NUEVA del cliente sobre piezas que YA existen (re-compra). */
  async function mkOver(pieceIds: string[]) {
    const k = (seq += 1);
    const totalCents = 20000 + k;
    const pi = `pi_sl80_${RUN}_${k}`;
    const order = await h.prisma.order.create({
      data: {
        userId: ctx.userId,
        fulfillmentMode: 'vault',
        orderNumber: `SL80-${RUN}-${k}`,
        status: 'pending',
        subtotalCents: totalCents,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents,
        priceConvention: 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
      },
    });
    orderIds.push(order.id);
    for (const id of pieceIds) {
      await h.prisma.inventoryItem.update({
        where: { id },
        data: { status: 'reserved', reservedByOrderId: order.id, ownerType: 'customer', ownerUserId: ctx.userId, ownershipStatus: 'pending' },
      });
      await h.prisma.orderItem.create({ data: { orderId: order.id, inventoryItemId: id, cardSnapshot: {}, unitPriceCents: 1 } });
    }
    const items = await h.prisma.inventoryItem.findMany({ where: { id: { in: pieceIds } } });
    return { order, items, pi, totalCents, mode: 'vault' as Mode, registered: true };
  }
  return { mk, mkOver, orderIds, itemIds };
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
  const refundFull = (o: { pi: string; totalCents: number }, id = evt()) =>
    h.sendStripeWebhook({
      id,
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
   * ⛔ SUPERADO en v1.80.8.6 (§M4-SHIP.18.12, SRF-1/SRF-12): el residual se cerró; ver el bloque «SRF-1 (antes
   * RESIDUAL)» abajo. Texto original, conservado como historia:
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
  // =====================================================================================================
  // 🔒💰 v1.80.8.3 (§M4-SHIP.18.2 bloque v1.80.8.3, §M4-VAULT.2-bis.2 bloque v1.80.8.3) — `charge.refunded` TOTAL
  // lleva a `refunded` desde `pending`, `failed` y `settled` (`CHARGE_REFUNDED_SOURCE_STATUSES`). El hueco que cierra
  // (BACKEND_NOTES «Release s5» §11): en `5321b8c6` una `pending` reembolsada desde el panel se quedaba `pending` y el
  // `succeeded` tardío la LIQUIDABA — carta y dinero.
  // =====================================================================================================
  const failed = (pi: string, id = evt()) =>
    h.sendStripeWebhook({ id, type: 'payment_intent.payment_failed', data: { object: { id: pi, object: 'payment_intent' } } });
  const av3 = () =>
    av2.mock.calls.map(([m]) => m as { subject: string; text: string }).filter((m) => /Reembolso de tu pedido/.test(m.subject));
  const esVariantVault = (m: { text: string }) => /bóveda|vault/.test(m.text);
  const piezasSL = (o: { items: { id: string }[] }) =>
    h.prisma.inventoryItem.findMany({
      where: { id: { in: o.items.map((i) => i.id) } },
      select: { status: true, reservedByOrderId: true },
      orderBy: { id: 'asc' },
    });

  describe('🔒💰 SL-8 — `pending` + `charge.refunded` total + `succeeded` tardío (las dos ramas)', () => {
    it.each<[string, Mode, boolean, number]>([
      ['vault, 2 piezas', 'vault', true, 2],
      ['direct_ship invitado', 'direct_ship', false, 1],
    ])('%s ⇒ refunded, sellada, SIN needsManual, AV-3 sin variante vault; el tardío es no-op', async (_n, mode, registered, n) => {
      const o = await fx.mk(n, mode, registered);
      av2.mockClear();
      expect((await refundFull(o)).status).toBe(200);
      const ord = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(ord.status).toBe('refunded');
      expect(ord.refundedAt).toBeInstanceOf(Date);
      expect(ord.fullRefundClosedAt).toBeInstanceOf(Date);
      expect(ord.chargebackNeedsManual).toBe(false);
      expect(ord.settledAt).toBeNull();
      if (mode === 'vault') {
        // La bitácora del cierre solo la escribe la rama `vault` (§M4-SHIP.18.4); la rama directo no tiene envío que cerrar.
        const log = await h.prisma.auditLog.findMany({ where: { entityId: o.order.id, action: 'order.full_refund_closed' } });
        expect(log).toHaveLength(1);
        expect(log[0].after).toMatchObject({ statusAtClose: 'pending', returnedItemIds: [] });
      }
      const avisos = av3();
      expect(avisos).toHaveLength(1);
      expect(esVariantVault(avisos[0])).toBe(false);
      // 💰 v1.80.8.6 (§M4-SHIP.18.12 (3), SRF-1 — cierra SSL-R1): las piezas apartadas vuelven a la venta en la misma tx.
      expect((await piezasSL(o)).map((p) => [p.status, p.reservedByOrderId])).toEqual(o.items.map(() => ['listed', null]));

      await tardioNoOp(o, { status: 'refunded', warn: 1 });
      const fin = await foto(o);
      expect((fin.order[0] as { settledAt: Date | null }).settledAt).toBeNull();
      expect(fin.movements).toHaveLength(n); // un `refund_release` por pieza, y el tardío no añade nada
      expect(fin.placements).toHaveLength(0);
      expect(fin.shipments).toHaveLength(0);
    });

    it('control: `settled` + `charge.refunded` total en `vault` ⇒ AV-3 CON variante vault y needsManual (sin cambio)', async () => {
      const o = await fx.mk(1, 'vault');
      expect((await pay(o)).status).toBe(200);
      av2.mockClear();
      expect((await refundFull(o)).status).toBe(200);
      const ord = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect([ord.status, ord.chargebackNeedsManual]).toEqual(['refunded', true]);
      const log = await h.prisma.auditLog.findMany({ where: { entityId: o.order.id, action: 'order.full_refund_closed' } });
      expect(log[0].after).toMatchObject({ statusAtClose: 'settled' });
      const avisos = av3();
      expect(avisos).toHaveLength(1);
      expect(esVariantVault(avisos[0])).toBe(true);
    });
  });

  describe('🔒💰 SL-9 — `failed` + `charge.refunded` total + `succeeded` tardío (las dos ramas)', () => {
    it('direct_ship: las piezas liberadas a `listed` siguen `listed`; cero envío, cero movimientos', async () => {
      const o = await fx.mk(1, 'direct_ship');
      expect((await failed(o.pi)).status).toBe(200);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('failed');
      expect((await piezasSL(o)).map((p) => p.status)).toEqual(['listed']);
      expect((await refundFull(o)).status).toBe(200);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('refunded');
      await tardioNoOp(o, { status: 'refunded', warn: 1 });
      expect((await piezasSL(o)).map((p) => [p.status, p.reservedByOrderId])).toEqual([['listed', null]]);
      expect(await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id } })).toBe(0);
      expect(await h.prisma.inventoryMovement.count({ where: { itemId: o.items[0].id } })).toBe(0);
    });

    it('vault, re-compra: la pieza la compró después el MISMO cliente en O2 (`settled`) ⇒ el reembolso de O1 no la toca', async () => {
      const o1 = await fx.mk(1, 'vault');
      expect((await failed(o1.pi)).status).toBe(200);
      expect((await piezasSL(o1)).map((p) => p.status)).toEqual(['listed']);
      const o2 = await fx.mkOver([o1.items[0].id]);
      expect((await pay(o2)).status).toBe(200);
      const o2Antes = await foto(o2);
      expect((o2Antes.order[0] as { status: string }).status).toBe('settled');
      expect((o2Antes.items[0] as { status: string; ownerUserId: string }).status).toBe('in_custody');

      expect((await refundFull(o1)).status).toBe(200);
      const ord1 = await h.prisma.order.findUniqueOrThrow({ where: { id: o1.order.id } });
      expect([ord1.status, ord1.chargebackNeedsManual]).toEqual(['refunded', false]);
      const log = await h.prisma.auditLog.findMany({ where: { entityId: o1.order.id, action: 'order.full_refund_closed' } });
      expect(log[0].after).toMatchObject({ statusAtClose: 'failed', returnedItemIds: [] });
      expect((log[0].after as { untouched: { state: string }[] }).untouched.map((u) => u.state)).toEqual(['other_purchase']);
      await tardioNoOp(o1, { status: 'refunded', warn: 1 });
      // O2 y su pieza, INTACTAS (xmin incluido).
      expect(await foto(o2)).toEqual(o2Antes);
      expect(await h.prisma.inventoryMovement.count({ where: { itemId: o1.items[0].id, reason: 'refund_return' } })).toBe(0);
    });
  });

  /**
   * 🔒💰 SL-10 — carrera `failAndRelease` vs `charge.refunded` (barrera de fila en `Order`, patrón de SL-4). La barrera
   * hace de la tx del reembolso: toma la fila y la escribe a `refunded` SIN confirmar; el `payment_failed` lee `pending`
   * confirmado y se le VE bloqueado en su escritura; al confirmar, su CAS (`status:'pending'`) pierde. Canario: una
   * tirada sin espera observada ⇒ `INVALIDA` (⛔ no cuenta como verde).
   */
  async function carreraFallo(mode: Mode): Promise<string> {
    const o = await fx.mk(1, mode);
    const soltar = diferida();
    const tomado = diferida();
    const barrera = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${o.order.id} FOR UPDATE`;
        await tx.$executeRaw`UPDATE "Order" SET status = 'refunded', "refundedAt" = now() WHERE id = ${o.order.id}`;
        tomado.abrir();
        await soltar.promesa;
      },
      { timeout: 30000 },
    );
    await tomado.promesa;
    let terminado = false;
    const r = failed(o.pi).finally(() => {
      terminado = true;
    });
    const visto = await verBloqueadoEnOrder(() => terminado);
    soltar.abrir();
    await barrera;
    const res = await r;
    if (!visto) return 'INVALIDA';
    const tras = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
    const p1 = await piezasSL(o);
    const tardio = await pay(o);
    const fin = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
    const p2 = await h.prisma.inventoryItem.findMany({ where: { id: { in: o.items.map((i) => i.id) } }, select: { status: true, ownerType: true } });
    const envios = await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id } });
    const ok =
      res.status === 200 &&
      tras.status === 'refunded' &&
      p1.every((p) => p.status === 'reserved' && p.reservedByOrderId === o.order.id) &&
      tardio.status === 200 &&
      fin.status === 'refunded' &&
      fin.settledAt === null &&
      p2.every((p) => p.status === 'reserved') &&
      envios === 0;
    return ok ? 'ok' : `KO(${res.status},${tras.status}→${fin.status},piezas=${p1.map((p) => p.status).join('/')}→${p2.map((p) => p.status).join('/')},env=${envios})`;
  }

  /**
   * SL-10 (b) — `succeeded` vs `charge.refunded` sobre `pending`, entrelazado forzado: la barrera retiene `Order`
   * (sin escribir), se encolan los dos webhooks en el orden pedido y se suelta. Puede haber `40P01`/`503` (orden de
   * candados opuesto: el reembolso toma piezas → `Order`; el settle `Order` → piezas): se CUENTAN aparte y valen si la
   * REENTREGA del mismo evento deja un estado válido. Válido ⇔ (`refunded`, cero custodia) o (`refunded` tras `settled`,
   * con las cartas reclamadas `refund_return`). ⛔ Nunca `settled` con custodia del cliente y el cobro reembolsado.
   */
  async function carreraPagoReembolso(primero: 'pago' | 'reembolso'): Promise<{ r: string; reintentos: number }> {
    const o = await fx.mk(1, 'vault');
    const idPago = evt();
    const idReembolso = evt();
    const soltar = diferida();
    const tomado = diferida();
    const barrera = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${o.order.id} FOR UPDATE`;
        tomado.abrir();
        await soltar.promesa;
      },
      { timeout: 30000 },
    );
    await tomado.promesa;
    const lanzar = (quien: 'pago' | 'reembolso') => (quien === 'pago' ? pay(o, idPago) : refundFull(o, idReembolso));
    const segundo = primero === 'pago' ? 'reembolso' : 'pago';
    const esperaFila = async (n: number) => {
      const hasta = Date.now() + 10000;
      while (Date.now() < hasta) {
        const f = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active' AND query ILIKE '%"Order"%'`,
        );
        if (Number(f[0].n) >= n) return true;
        await new Promise((res) => setTimeout(res, 25));
      }
      return false;
    };
    const a = lanzar(primero);
    const vistoA = await esperaFila(1);
    const b = lanzar(segundo);
    const vistoB = await esperaFila(2);
    soltar.abrir();
    await barrera;
    const [ra, rb] = await Promise.all([a, b]);
    if (!vistoA || !vistoB) return { r: 'INVALIDA', reintentos: 0 };
    let reintentos = 0;
    // Reentrega (como Stripe) de lo que no respondió 2xx, con el MISMO event.id.
    const pend: ('pago' | 'reembolso')[] = [];
    if (ra.status >= 300) pend.push(primero);
    if (rb.status >= 300) pend.push(segundo);
    for (const quien of pend) {
      for (let k = 0; k < 3; k += 1) {
        reintentos += 1;
        if ((await lanzar(quien)).status < 300) break;
      }
    }
    const ord = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
    const p = await h.prisma.inventoryItem.findMany({ where: { id: { in: o.items.map((i) => i.id) } }, select: { status: true, ownerType: true, ownerUserId: true } });
    const custodia = p.filter((x) => x.ownerType === 'customer' && x.status === 'in_custody').length;
    const devueltas = await h.prisma.inventoryMovement.count({ where: { itemId: { in: o.items.map((i) => i.id) }, reason: 'refund_return' } });
    const sinLiquidar = ord.status === 'refunded' && ord.settledAt === null && custodia === 0;
    const liquidadaYReclamada = ord.status === 'refunded' && ord.settledAt !== null && custodia === 0 && devueltas === p.length;
    const tag = `${primero}1:${ra.status}/${rb.status}${reintentos ? `+r${reintentos}` : ''}`;
    return { r: sinLiquidar || liquidadaYReclamada ? `ok(${tag})` : `KO(${tag},${ord.status},settled=${ord.settledAt ? 'sí' : 'no'},custodia=${custodia},rr=${devueltas})`, reintentos };
  }

  describe('🔒💰 SL-10 — carreras sobre una orden `pending` (barrera de fila, N por caso)', () => {
    it.each<[string, Mode]>([
      ['vault', 'vault'],
      ['direct_ship', 'direct_ship'],
    ])(`failAndRelease vs charge.refunded, %s — N=${N_CARRERA}: en TODAS las tiradas válidas sigue refunded, nada liberado, el tardío no-op`, async (n, mode) => {
      const resultados: string[] = [];
      for (let t = 0; t < N_CARRERA; t += 1) resultados.push(await carreraFallo(mode));
      const validas = resultados.filter((r) => r !== 'INVALIDA');
      // eslint-disable-next-line no-console
      console.log(`[SL-10 fallo ${n}] válidas ${validas.length}/${N_CARRERA} · verdes ${validas.filter((r) => r === 'ok').length}/${validas.length} · ${resultados.join(' ')}`);
      expect(validas).toHaveLength(N_CARRERA);
      expect(validas).toEqual(Array(N_CARRERA).fill('ok'));
    });

    it.each<['pago' | 'reembolso']>([['reembolso'], ['pago']])(
      `succeeded vs charge.refunded, primero el %s — N=${N_CARRERA}: nunca settled con custodia; 40P01/503 aparte`,
      async (primero) => {
        const out: { r: string; reintentos: number }[] = [];
        for (let t = 0; t < N_CARRERA; t += 1) out.push(await carreraPagoReembolso(primero));
        const validas = out.filter((x) => x.r !== 'INVALIDA');
        const conReintento = validas.filter((x) => x.reintentos > 0).length;
        // eslint-disable-next-line no-console
        console.log(
          `[SL-10 pago/reembolso primero=${primero}] válidas ${validas.length}/${N_CARRERA} · verdes ${validas.filter((x) => x.r.startsWith('ok')).length}/${validas.length} · ` +
            `con 40P01/503 y reentrega ${conReintento} · ${out.map((x) => x.r).join(' ')}`,
        );
        expect(validas).toHaveLength(N_CARRERA);
        expect(validas.filter((x) => !x.r.startsWith('ok'))).toEqual([]);
      },
    );
  });

  /**
   * ~~RESIDUAL — barrido sobre una orden `refunded` sin liquidar~~ 💰 v1.80.8.6 (§M4-SHIP.18.12 (3)/(5), SRF-1/SRF-12):
   * el residual SE CERRÓ. Ya no hay piezas `reserved` que barrer tras un `charge.refunded` total sobre una orden sin
   * liquidar: se liberan en la misma tx con `refund_release`. Y el barrido, ante una que quedara (estado previo al
   * despliegue), la libera SIN cancelar el PI (SRF-12, `shipped-refund-reason.e2e-spec.ts`).
   */
  describe('SRF-1 (antes RESIDUAL) — `charge.refunded` total sobre `pending` vencida: el barrido ya no tiene nada que hacer', () => {
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

    it('Stripe real (PI `succeeded` ⇒ cancelar lanza): las piezas YA están `listed` (refund_release); el barrido no cancela el PI ni escribe', async () => {
      const o = await refundedSinLiquidar();
      h.stripe.cancelOutcome = 'throws-succeeded';
      const orders = h.app.get(OrdersService);
      const ids = o.items.map((i) => i.id);
      for (let pasada = 0; pasada < 2; pasada += 1) {
        await orders.sweepExpiredReservations(new Date());
        expect((await piezas(o)).map((p) => [p.status, p.reservedByOrderId])).toEqual([
          ['listed', null],
          ['listed', null],
        ]);
      }
      expect(await h.prisma.inventoryMovement.count({ where: { itemId: { in: ids }, reason: 'refund_release' } })).toBe(2);
      expect(h.stripe.callLog.filter((c) => c === `cancel:${o.pi}`)).toHaveLength(0);
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
