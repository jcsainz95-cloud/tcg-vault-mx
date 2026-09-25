/**
 * vault-placement-birth.e2e-spec.ts — ⭐⭐ M-59 contra Postgres REAL y el webhook FIRMADO real.
 *
 * `API_CONTRACT §M4-VAULT.2 / .2-bis / .6 / .8` (pruebas 1, 2, 3, 10 y la mitad BD de la 15),
 * `ARCHITECTURE §4.21q` (`INV-VP-1`, `-3`, `-5`, `-6`). La mitad «forma» (qué sentencias, en qué
 * orden, con qué argumentos) vive en `test/payments.vault-placement-birth.spec.ts`; aquí se prueba
 * lo que un doble NO puede probar: el `ON CONFLICT`, la atomicidad y los CHECKs.
 *
 *  A. Liquidar una orden `vault` ⇒ EXACTAMENTE una `VaultPlacement pending` con
 *     `createdAt === Order.settledAt`, y una `VaultPlacementItem pending` por `OrderItem`.
 *  B. Reentrega SECUENCIAL (otro event.id, mismo PI) ⇒ sigue una, sin tocar nada.
 *  C. ⭐⭐ Dos entregas CONCURRENTES con el ENTRELAZADO FORZADO (candado de fila sobre `Order`,
 *     técnica de `helpers/row-lock-barrier.ts`): las dos llegan a la transacción de liquidación, la
 *     segunda espera a la primera y ejecuta su `INSERT` DESPUÉS del commit de la primera. N=10
 *     órdenes; se reporta la proporción. Con `create` a secas la segunda revienta con `P2002` ⇒ 500
 *     en TODAS las tiradas (el entrelazado no es suerte: se comprueba en `pg_stat_activity`).
 *  D. Atomicidad: un fallo DESPUÉS del `createMany` de la colocación (trigger de prueba sobre
 *     `VaultPlacementItem`) ⇒ ni orden `settled`, ni colocación, ni pieza movida.
 *  E. `direct_ship` ⇒ CERO colocaciones.
 *  F. Contracargo `vault` ⇒ `cancelled/chargeback`, sin actor; sobre una ya `placed` ⇒ intacta.
 *  G. CHECKs de M-59: un sello a medias es INEXPRESABLE (cada uno con su control positivo).
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';

const RUN = Date.now().toString(36);
const N_CARRERA = 10;

describe('M-59 · nacimiento de la colocación en bóveda (Postgres real)', () => {
  let h: E2EHarness;
  let userId: string;
  let template: { cardId: string; locationId: string };
  let seq = 0;
  const orderIds: string[] = [];
  const itemIds: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    const base = await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { folio: E2E_FOLIOS.listedCharizard },
      select: { cardId: true, locationId: true },
    });
    template = { cardId: base.cardId, locationId: base.locationId! };
    const passwordHash = (
      await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })
    ).passwordHash;
    const u = await h.prisma.user.create({
      data: { email: `vp59.${RUN}@e2e.local`, passwordHash, name: 'VP59 Cliente', role: 'customer', emailVerified: true },
    });
    userId = u.id;
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS vp59_fail_trg ON "VaultPlacementItem"`);
      await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS vp59_fail_fn()`);
      await h.prisma.vaultPlacementItem.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
      await h.prisma.vaultPlacement.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.shipmentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } }); // cascada a OrderItem
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await h.prisma.user.deleteMany({ where: { id: userId } });
      await h.close();
    }
  });

  /** Orden PENDIENTE con `n` piezas reservadas por ella, lista para que el webhook la liquide. */
  async function mkOrder(n: number, mode: 'vault' | 'direct_ship' = 'vault') {
    const k = (seq += 1);
    const totalCents = 10000 + k;
    const pi = `pi_vp59_${RUN}_${k}`;
    const order = await h.prisma.order.create({
      data: {
        userId: mode === 'vault' ? userId : null,
        guestEmail: mode === 'direct_ship' ? `vp59.${RUN}.${k}@example.com` : null,
        fulfillmentMode: mode,
        orderNumber: `VP59-${RUN}-${k}`,
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
          folio: `VP59-${RUN}-${k}-${i}`,
          cardId: template.cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          acquisitionType: 'compra',
          acquisitionCostCents: 1000,
          locationId: template.locationId,
          status: 'reserved',
          reservedByOrderId: order.id,
          ...(mode === 'vault'
            ? { ownerType: 'customer' as const, ownerUserId: userId, ownershipStatus: 'pending' as const }
            : { ownerType: 'platform' as const }),
        },
      });
      itemIds.push(it.id);
      items.push(it);
      await h.prisma.orderItem.create({
        data: { orderId: order.id, inventoryItemId: it.id, cardSnapshot: {}, unitPriceCents: 1 },
      });
    }
    return { order, items, pi, totalCents };
  }

  const pay = (o: { pi: string; totalCents: number }, eventId?: string) =>
    h.sendStripeWebhook({
      id: eventId ?? `evt_e2e_vp59_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.succeeded',
      data: {
        object: { id: o.pi, object: 'payment_intent', amount: o.totalCents, amount_received: o.totalCents, currency: 'mxn' },
      },
    });

  const placementsOf = (orderId: string) =>
    h.prisma.vaultPlacement.findMany({ where: { orderId }, include: { items: true } });

  describe('A/B — nace una, y sólo una', () => {
    it('⭐⭐ A: liquidar `vault` ⇒ UNA colocación pending (createdAt === settledAt) + UNA fila pending por carta', async () => {
      const o = await mkOrder(3);
      const res = await pay(o);
      expect(res.status).toBe(200);

      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id }, include: { items: true } });
      expect(order.status).toBe('settled');
      const vps = await placementsOf(o.order.id);
      expect(vps).toHaveLength(1);
      const vp = vps[0];
      expect(vp.status).toBe('pending');
      expect(vp.createdAt.toISOString()).toBe(order.settledAt!.toISOString());
      for (const k of ['preparedAt', 'preparedByUserId', 'placedAt', 'placedByUserId', 'locationId', 'cancelledAt', 'cancelledByUserId', 'cancelReason'] as const) {
        expect(vp[k]).toBeNull();
      }
      // INV-VP-5: exactamente una por OrderItem, con la copia de su pieza.
      expect(vp.items.map((i) => i.orderItemId).sort()).toEqual(order.items.map((i) => i.id).sort());
      for (const it of vp.items) {
        const oi = order.items.find((x) => x.id === it.orderItemId)!;
        expect(it.inventoryItemId).toBe(oi.inventoryItemId);
        expect(it.prepStatus).toBe('pending');
        expect(it.prepMarkedAt).toBeNull();
        expect(it.prepMarkedByUserId).toBeNull();
      }
      // ⛔ «pendiente de colocar» vive en la colocación, NO en la pieza: la pieza queda como siempre.
      const pieces = await h.prisma.inventoryItem.findMany({ where: { id: { in: o.items.map((i) => i.id) } } });
      for (const p of pieces) {
        expect(p).toMatchObject({ status: 'in_custody', ownershipStatus: 'settled', ownerUserId: userId, locationId: template.locationId });
      }
    });

    it('⭐ B: reentrega SECUENCIAL con OTRO event.id ⇒ sigue UNA colocación, mismas filas, 200', async () => {
      const o = await mkOrder(2);
      expect((await pay(o)).status).toBe(200);
      const before = await placementsOf(o.order.id);
      expect((await pay(o)).status).toBe(200);
      const after = await placementsOf(o.order.id);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0].items.map((i) => i.id).sort()).toEqual(before[0].items.map((i) => i.id).sort());
    });
  });

  describe('C — ⭐⭐ dos entregas CONCURRENTES, entrelazado FORZADO sobre la fila de Order', () => {
    it(`N=${N_CARRERA}: en TODAS las tiradas, dos 200 y exactamente UNA colocación con sus filas`, async () => {
      const resultados: string[] = [];
      // MEDICIÓN informativa (⛔ no es aserción — ver docs/BACKEND_NOTES.md §M-59): la SEGUNDA entrega
      // concurrente re-escribe `Order.settledAt` (conducta previa a M-59 del `order.update` del settle),
      // así que tras la carrera `createdAt` conserva el instante de la PRIMERA.
      let desfasadas = 0;
      for (let t = 0; t < N_CARRERA; t += 1) {
        const o = await mkOrder(2);
        const soltar = diferida();
        const tomado = diferida();
        // La prueba toma la fila de la orden: las dos entregas leen `pending` (lectura sin candado),
        // entran a su transacción y se BLOQUEAN en el `UPDATE "Order"`.
        const candado = h.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${o.order.id} FOR UPDATE`;
            tomado.abrir();
            await soltar.promesa;
          },
          { timeout: 30000 },
        );
        await tomado.promesa;
        const a = pay(o);
        const b = pay(o);
        await esperarBloqueoDeFila(h.prisma, 'Order', 2); // ⛔ no es un sleep: se COMPRUEBA
        soltar.abrir();
        await candado;
        const [ra, rb] = await Promise.all([a, b]);
        const vps = await placementsOf(o.order.id);
        const settledAt = (await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).settledAt;
        if (vps[0] && settledAt && vps[0].createdAt.getTime() !== settledAt.getTime()) desfasadas += 1;
        const ok = ra.status === 200 && rb.status === 200 && vps.length === 1 && vps[0].items.length === 2;
        resultados.push(ok ? 'ok' : `KO(${ra.status},${rb.status},vp=${vps.length},items=${vps[0]?.items.length})`);
      }
      const verdes = resultados.filter((r) => r === 'ok').length;
      // eslint-disable-next-line no-console
      console.log(
        `[M-59 C] entregas concurrentes forzadas: ${verdes}/${N_CARRERA} verdes · ${resultados.join(' ')} · ` +
          `createdAt≠settledAt tras la carrera: ${desfasadas}/${N_CARRERA}`,
      );
      expect(resultados).toEqual(Array(N_CARRERA).fill('ok'));
    });
  });

  describe('D — atomicidad: o las dos (liquidación + colocación) o ninguna', () => {
    it('⭐⭐ un fallo DESPUÉS de crear la colocación revierte TODO; al quitarlo, el reintento liquida con UNA', async () => {
      const o = await mkOrder(2);
      const victima = (await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: o.order.id } })).id;
      // Trigger de prueba: revienta al insertar la fila por carta de ESTA orden, o sea DESPUÉS de que
      // el `INSERT` de `VaultPlacement` ya se ejecutó dentro de la misma transacción.
      await h.prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION vp59_fail_fn() RETURNS trigger AS $$
        BEGIN
          IF NEW."orderItemId" = '${victima}' THEN RAISE EXCEPTION 'vp59: fallo forzado'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await h.prisma.$executeRawUnsafe(
        `CREATE TRIGGER vp59_fail_trg BEFORE INSERT ON "VaultPlacementItem" FOR EACH ROW EXECUTE FUNCTION vp59_fail_fn()`,
      );
      let res;
      try {
        res = await pay(o);
      } finally {
        await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS vp59_fail_trg ON "VaultPlacementItem"`);
        await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS vp59_fail_fn()`);
      }
      expect(res.status).toBeGreaterThanOrEqual(500); // Stripe reintentará
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('pending');
      expect(await placementsOf(o.order.id)).toHaveLength(0);
      const pieces = await h.prisma.inventoryItem.findMany({ where: { id: { in: o.items.map((i) => i.id) } } });
      for (const p of pieces) expect(p.status).toBe('reserved');
      expect(await h.prisma.inventoryMovement.count({ where: { itemId: { in: o.items.map((i) => i.id) } } })).toBe(0);

      // Control: sin el fallo, el reintento liquida y nace UNA colocación completa.
      expect((await pay(o)).status).toBe(200);
      const vps = await placementsOf(o.order.id);
      expect(vps).toHaveLength(1);
      expect(vps[0].items).toHaveLength(2);
    });
  });

  describe('E — `direct_ship` nunca tiene colocación', () => {
    it('⭐ liquidar un `direct_ship` ⇒ CERO VaultPlacement (y sí su envío de fulfillment)', async () => {
      const o = await mkOrder(2, 'direct_ship');
      expect((await pay(o)).status).toBe(200);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('settled');
      expect(await h.prisma.shipmentRequest.count({ where: { orderId: o.order.id } })).toBe(1); // control
      expect(await h.prisma.vaultPlacement.count({ where: { orderId: o.order.id } })).toBe(0);
      expect(await h.prisma.vaultPlacementItem.count({ where: { inventoryItemId: { in: o.items.map((i) => i.id) } } })).toBe(0);
    });
  });

  describe('F — §M4-VAULT.6 contracargo', () => {
    const dispute = (pi: string) =>
      h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: pi } } });

    it('⭐⭐ contracargo de una orden `vault` con colocación PENDIENTE ⇒ cancelled/chargeback, sin actor', async () => {
      const o = await mkOrder(2);
      expect((await pay(o)).status).toBe(200);
      expect((await dispute(o.pi)).status).toBe(200);
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(order.status).toBe('chargeback');
      const [vp] = await placementsOf(o.order.id);
      expect(vp.status).toBe('cancelled');
      expect(vp.cancelReason).toBe('chargeback');
      expect(vp.cancelledAt).toBeInstanceOf(Date);
      expect(vp.cancelledByUserId).toBeNull();
      // Las filas por carta sobreviven (la vista física las lee; no se borran).
      expect(vp.items).toHaveLength(2);
    });

    it('contracargo sobre una colocación ya `placed` ⇒ la deja intacta (count 0 no es error)', async () => {
      const o = await mkOrder(1);
      expect((await pay(o)).status).toBe(200);
      const [vp0] = await placementsOf(o.order.id);
      const now = new Date();
      await h.prisma.vaultPlacement.update({
        where: { id: vp0.id },
        data: { preparedAt: now, preparedByUserId: userId, status: 'placed', placedAt: now, placedByUserId: userId, locationId: template.locationId },
      });
      expect((await dispute(o.pi)).status).toBe(200);
      const [vp] = await placementsOf(o.order.id);
      expect(vp.status).toBe('placed');
      expect(vp.cancelReason).toBeNull();
    });
  });

  describe('G — CHECKs de M-59: un sello a medias es INEXPRESABLE en la BD', () => {
    let vpId: string;
    let vpiId: string;

    beforeAll(async () => {
      const o = await mkOrder(1);
      expect((await pay(o)).status).toBe(200);
      const [vp] = await placementsOf(o.order.id);
      vpId = vp.id;
      vpiId = vp.items[0].id;
    });

    /** Ejecuta un UPDATE crudo y devuelve el nombre del constraint violado (o 'OK'). */
    async function sql(stmt: string): Promise<string> {
      try {
        await h.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(stmt);
          throw new Error('__rollback__'); // cada caso deja la fila como estaba
        });
        return 'OK';
      } catch (e) {
        if ((e as Error).message === '__rollback__') return 'OK';
        const msg = e instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(e.meta) + e.message : (e as Error).message;
        const m = /"(VaultPlacement\w*_chk)"/.exec(msg) ?? /(VaultPlacement\w*_chk)/.exec(msg);
        return m ? m[1] : `OTRO: ${msg}`;
      }
    }
    const upd = (set: string) => `UPDATE "VaultPlacement" SET ${set} WHERE id = '${vpId}'`;
    const updItem = (set: string) => `UPDATE "VaultPlacementItem" SET ${set} WHERE id = '${vpiId}'`;
    const U = `'${randomUUID()}'`;

    it('⭐⭐ (INV-VP-6) placed con preparedAt NULL ⇒ falla por CHECK; el mismo UPDATE preparado pasa', async () => {
      expect(await sql(upd(`status='placed', "placedAt"=now(), "placedByUserId"=${U}, "locationId"='${template.locationId}'`))).toBe(
        'VaultPlacement_placed_requires_prepared_chk',
      );
      expect(
        await sql(upd(`status='placed', "placedAt"=now(), "placedByUserId"=${U}, "locationId"='${template.locationId}', "preparedAt"=now(), "preparedByUserId"=${U}`)),
      ).toBe('OK');
    });

    it('sello de preparación a medias ⇒ VaultPlacement_prepared_seal_chk', async () => {
      expect(await sql(upd(`"preparedAt"=now()`))).toBe('VaultPlacement_prepared_seal_chk');
      expect(await sql(upd(`"preparedByUserId"=${U}`))).toBe('VaultPlacement_prepared_seal_chk');
      expect(await sql(upd(`"preparedAt"=now(), "preparedByUserId"=${U}`))).toBe('OK');
    });

    it('pending con cualquier sello de colocación/cancelación ⇒ VaultPlacement_pending_seals_chk', async () => {
      for (const set of [`"placedAt"=now()`, `"placedByUserId"=${U}`, `"locationId"='${template.locationId}'`, `"cancelledAt"=now()`, `"cancelledByUserId"=${U}`, `"cancelReason"='chargeback'`]) {
        expect(await sql(upd(set))).toBe('VaultPlacement_pending_seals_chk');
      }
    });

    it('placed sin su sello entero, o con sello de cancelación ⇒ VaultPlacement_placed_seals_chk', async () => {
      const prep = `"preparedAt"=now(), "preparedByUserId"=${U}`;
      expect(await sql(upd(`status='placed', ${prep}, "placedAt"=now(), "placedByUserId"=${U}`))).toBe('VaultPlacement_placed_seals_chk');
      expect(
        await sql(upd(`status='placed', ${prep}, "placedAt"=now(), "placedByUserId"=${U}, "locationId"='${template.locationId}', "cancelledAt"=now()`)),
      ).toBe('VaultPlacement_placed_seals_chk');
    });

    it('cancelled sin cuándo/por qué, o con sello de colocación ⇒ VaultPlacement_cancelled_seals_chk; completo pasa (actor NULL = sistema)', async () => {
      expect(await sql(upd(`status='cancelled', "cancelledAt"=now()`))).toBe('VaultPlacement_cancelled_seals_chk');
      expect(await sql(upd(`status='cancelled', "cancelReason"='chargeback'`))).toBe('VaultPlacement_cancelled_seals_chk');
      expect(await sql(upd(`status='cancelled', "cancelledAt"=now(), "cancelReason"='nothing_to_place', "locationId"='${template.locationId}'`))).toBe(
        'VaultPlacement_cancelled_seals_chk',
      );
      expect(await sql(upd(`status='cancelled', "cancelledAt"=now(), "cancelReason"='chargeback'`))).toBe('OK');
    });

    it('marca por carta a medias ⇒ VaultPlacementItem_prep_mark_chk; completa pasa', async () => {
      expect(await sql(updItem(`"prepStatus"='picked'`))).toBe('VaultPlacementItem_prep_mark_chk');
      expect(await sql(updItem(`"prepStatus"='missing', "prepMarkedAt"=now()`))).toBe('VaultPlacementItem_prep_mark_chk');
      expect(await sql(updItem(`"prepMarkedAt"=now(), "prepMarkedByUserId"=${U}`))).toBe('VaultPlacementItem_prep_mark_chk');
      expect(await sql(updItem(`"prepStatus"='picked', "prepMarkedAt"=now(), "prepMarkedByUserId"=${U}`))).toBe('OK');
      expect(await sql(updItem(`"prepStatus"='missing', "prepMarkedAt"=now(), "prepMarkedByUserId"=${U}`))).toBe('OK');
    });

    it('`orderId` es único: una segunda colocación para la misma orden es imposible', async () => {
      const vp = await h.prisma.vaultPlacement.findUniqueOrThrow({ where: { id: vpId } });
      await expect(h.prisma.vaultPlacement.create({ data: { orderId: vp.orderId, createdAt: new Date() } })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });
});
