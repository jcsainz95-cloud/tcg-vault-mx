/**
 * ficha-cliente.e2e-spec.ts — §FICHA-CLIENTE (docs/API_CONTRACT_FICHA_CLIENTE.md) contra la app REAL y Postgres REAL.
 * `GET /admin/users/:id/overview` · `?userId=` en `/admin/refunds` y `/admin/manual-refunds` · notas `CustomerNote`
 * (`/admin/users/:id/notes`): roles, IDOR, idempotencia, tope 200, auditoría sin texto, anonimización, no-fuga a rutas de cliente.
 */
import * as argon2 from 'argon2';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Math.random().toString(36).slice(2, 8);
const SECRET_TEXT = `TEXTO-SECRETO-${RUN}: llamar a la abuela`;

/** Todas las LLAVES de un JSON (recursivo). */
function jsonKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) jsonKeys(x, out);
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out.push(k);
      jsonKeys(x, out);
    }
  }
  return out;
}

describe('§FICHA-CLIENTE — overview, ?userId= y notas internas', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let operator2: string;
  let customerTok: string;
  let adminId: string;
  let operatorId: string;
  let operator2Id: string;
  let cust: string; // cliente con datos
  let other: string; // otro cliente
  let supplierId: string;
  const created: { users: string[] } = { users: [] };
  const mk = (slug: string, role: 'customer' | 'vault_operator' | 'supplier' = 'customer') =>
    h.prisma.user
      .create({
        data: {
          ...(role === 'vault_operator' ? { username: `ficha.${slug}.${RUN}` } : { email: `ficha-${slug}-${RUN}@e2e.local` }),
          name: `Ficha ${slug}`,
          role,
          emailVerified: true,
          passwordHash: undefined,
        },
        select: { id: true },
      })
      .then((u) => {
        created.users.push(u.id);
        return u.id;
      });

  const baseOrder = { subtotalCents: 8900, processingFeeCents: 300, ivaCents: 1228, priceConvention: 'IVA_INCLUSIVE' as const, feeConvention: 'FEE_ON_TOP' as const };
  const ov = (id: string, token = admin) => h.api('GET', `/admin/users/${id}/overview`, { token });
  const notes = (id: string, q = '', token = admin) => h.api('GET', `/admin/users/${id}/notes${q}`, { token });
  const post = (id: string, json: unknown, token = admin) => h.api('POST', `/admin/users/${id}/notes`, { token, json });

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customerTok = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    adminId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })).id;
    operatorId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } })).id;
    // Un segundo operador (para «editar nota de OTRO autor ⇒ 403»).
    const pw = 'Operador2-Ficha-123!';
    const op2 = await h.prisma.user.create({
      data: { email: `ficha-op2-${RUN}@e2e.local`, name: 'Ficha Op2', role: 'vault_operator', emailVerified: true, authProvider: 'local', passwordHash: await argon2.hash(pw), phone: '5511110099' },
      select: { id: true },
    });
    operator2Id = op2.id;
    created.users.push(operator2Id);
    operator2 = await h.login(`ficha-op2-${RUN}@e2e.local`, pw);
    cust = await mk('cust');
    other = await mk('other');
    supplierId = await h.prisma.user
      .create({ data: { email: `ficha-sup-${RUN}@e2e.local`, name: 'Ficha Proveedor', role: 'supplier', emailVerified: true }, select: { id: true } })
      .then((u) => {
        created.users.push(u.id);
        return u.id;
      });

    // --- datos del cliente `cust`
    const settled1 = await h.prisma.order.create({ data: { ...baseOrder, totalCents: 10000, userId: cust, fulfillmentMode: 'vault', status: 'settled', settledAt: new Date('2026-10-01T10:00:00Z'), orderNumber: `F${RUN}1` } });
    await h.prisma.order.create({ data: { ...baseOrder, totalCents: 5000, userId: cust, fulfillmentMode: 'vault', status: 'settled', settledAt: new Date('2026-11-01T10:00:00Z'), orderNumber: `F${RUN}2` } });
    await h.prisma.order.create({ data: { ...baseOrder, totalCents: 777, userId: cust, fulfillmentMode: 'vault', status: 'pending', orderNumber: `F${RUN}3` } });
    await h.prisma.order.create({ data: { ...baseOrder, totalCents: 999900, userId: other, fulfillmentMode: 'vault', status: 'settled', settledAt: new Date(), orderNumber: `F${RUN}9` } });
    const addr = { line1: 'Calle SECRETA 1', city: 'CDMX' };
    const ship = { addressSnapshot: addr, shippingFeeCents: 9900, priceConvention: 'IVA_EXCLUSIVE' as const, feeConvention: 'FEE_ON_TOP' as const };
    // retiro (sin orderId, con userId) abierto + envío directo (orderId) entregado, con guía de Skydropx
    await h.prisma.shipmentRequest.create({ data: { ...ship, userId: cust, status: 'picking' } });
    await h.prisma.shipmentRequest.create({
      data: {
        ...ship, orderId: settled1.id, status: 'entregado', totalCents: 12345, carrier: 'Estafeta', trackingNumber: 'TN-FICHA-1', trackingUrl: 'https://tracking.example/TN-FICHA-1',
        requestedAt: new Date('2026-10-02T10:00:00Z'), shippedAt: new Date('2026-10-03T10:00:00Z'), deliveredAt: new Date('2026-10-05T10:00:00Z'),
      },
    });
    await h.prisma.shipmentRequest.create({ data: { ...ship, userId: other, status: 'solicitado' } });
    // solicitudes de venta
    const sr = (status: string, quoted: number, approved: number | null) =>
      h.prisma.sellRequest.create({ data: { userId: cust, status: status as never, quotedTotalCents: quoted, approvedTotalCents: approved } });
    await sr('pagada', 9000, 8000);
    await sr('pagada', 2000, 1500);
    await sr('rechazada', 700, null);
    await sr('recibida', 3000, null); // abierta, de nuestro lado, sin aprobar ⇒ cuenta cotizado
    await sr('aprobada', 4000, 3500); // abierta, de nuestro lado, aprobada ⇒ cuenta aprobado
    await sr('ofertada', 500, null); // abierta, del lado del cliente
    await h.prisma.sellRequest.create({ data: { userId: other, status: 'pagada', quotedTotalCents: 777777, approvedTotalCents: 777777 } });
    // reembolsos: tarjeta (succeeded + requested), SPEI (paid + pending)
    const pr = (key: string, status: 'requested' | 'succeeded', amount: number, orderId: string) =>
      h.prisma.paymentRefund.create({
        data: { idempotencyKey: `ficha:${RUN}:${key}`, kind: 'order_remaining', orderId, amountCents: amount, merchandiseCents: amount, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, compensationCents: 0, status, requestedByUserId: adminId, requestedByRole: 'super_admin', ...(status === 'succeeded' ? { stripeRefundId: `re_ficha_${RUN}`, submittedAt: new Date(), succeededAt: new Date() } : {}) },
      });
    await pr('a', 'succeeded', 1000, settled1.id);
    await pr('b', 'requested', 200, settled1.id);
    const card = await h.prisma.card.findFirstOrThrow({ select: { id: true } });
    let pieceN = 0;
    // SPEI «retiro entregado»: exige una línea de retiro real (CHECK `withdrawal_delivered_chk`).
    const mr = async (key: string, status: 'pending' | 'paid', amount: number, customer: string) => {
      pieceN += 1;
      const piece = await h.prisma.inventoryItem.create({
        data: { folio: `FICM-${RUN}-${pieceN}`, cardId: card.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'shipped', ownerType: 'platform' },
      });
      const shipment = await h.prisma.shipmentRequest.create({ data: { ...ship, userId: customer, status: 'entregado', kind: 'outbound' } });
      const line = await h.prisma.shipmentItem.create({ data: { shipmentRequestId: shipment.id, inventoryItemId: piece.id } });
      return h.prisma.manualRefund.create({
        data: {
          idempotencyKey: `ficha-mr:${RUN}:${key}`, source: 'withdrawal_delivered', customerUserId: customer, status, amountCents: amount, merchandiseCents: amount,
          merchandiseIvaCents: 0, processingFeeCents: 0, compensationCents: 0, createdByUserId: adminId, shipmentItemId: line.id, deliveredReason: 'not_arrived', deliveredNote: 'ficha fixture',
          ...(status === 'paid' ? { paidAt: new Date(), paidByUserId: adminId } : {}),
        },
      });
    };
    await mr('a', 'paid', 300, cust);
    await mr('b', 'pending', 40, cust);
    await mr('c', 'pending', 55555, other);
    // disputa abierta no se siembra (requiere pieza); lista de deseos: 0
  });

  afterAll(async () => {
    const ids = created.users;
    await h.prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: ids } }, { actorUserId: { in: ids } }] } });
    await h.prisma.customerNote.deleteMany({ where: { userId: { in: ids } } });
    await h.prisma.manualRefund.deleteMany({ where: { customerUserId: { in: ids } } });
    await h.prisma.paymentRefund.deleteMany({ where: { idempotencyKey: { startsWith: `ficha:${RUN}:` } } });
    await h.prisma.shipmentRequest.deleteMany({ where: { OR: [{ userId: { in: ids } }, { order: { userId: { in: ids } } }] } });
    await h.prisma.inventoryItem.deleteMany({ where: { folio: { startsWith: `FICM-${RUN}-` } } });
    await h.prisma.sellRequest.deleteMany({ where: { userId: { in: ids } } });
    await h.prisma.inventoryItem.deleteMany({ where: { ownerUserId: { in: ids } } });
    await h.prisma.order.deleteMany({ where: { userId: { in: ids } } });
    await h.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await h.close();
  });

  // ============================================================ overview
  describe('GET /admin/users/:id/overview', () => {
    it('operador y súper-admin reciben el MISMO cuerpo (incluidos los totales de vida), no-store, centavos enteros', async () => {
      const a = await ov(cust, admin);
      const o = await ov(cust, operator);
      expect(a.status).toBe(200);
      expect(o.status).toBe(200);
      expect(a.headers['cache-control']).toBe('no-store');
      const strip = (b: Record<string, unknown>) => ({ ...b, generatedAt: 'x' });
      expect(strip(o.body)).toEqual(strip(a.body));
      for (const v of Object.values(a.body.summary.lifetime)) expect(Number.isInteger(v)).toBe(true);
    });

    it('sumas contra los datos sembrados (y nada del OTRO cliente)', async () => {
      const b = (await ov(cust)).body;
      expect(b.userId).toBe(cust);
      expect(b.summary.lifetime).toEqual({
        purchasesCount: 2,
        purchasesCents: 15000,
        refundedCents: 1000 + 300, // tarjeta succeeded + SPEI paid
        salesPaidCount: 2,
        salesPaidCents: 9500,
        salesInProgressCents: 3000 + 3500 + 500, // abiertas: cotizado si no hay aprobado, aprobado si lo hay
      });
      expect(b.summary.lastOrderAt).toBe('2026-11-01T10:00:00.000Z');
      expect(b.attention).toEqual({
        ordersPending: 1,
        shipmentsOpen: 1,
        sellRequestsOpen: 3,
        sellRequestsNeedingStore: 2,
        disputesOpen: 0,
        refundsOpen: 2, // requested + SPEI pending
      });
      expect(b.totals).toEqual({ orders: 3, sellRequests: 6, disputes: 0, ownedItems: 0 });
      expect(b.refunds.total).toBe(4);
      expect(b.shipments.total).toBe(4); // picking + directo entregado + 2 retiros entregados de los SPEI
      const direct = b.shipments.items.find((s: { mode: string }) => s.mode === 'direct_ship');
      expect(direct).toMatchObject({ status: 'entregado', orderNumber: `F${RUN}1`, totalCents: 12345, carrier: 'Estafeta', trackingNumber: 'TN-FICHA-1', trackingUrl: 'https://tracking.example/TN-FICHA-1' });
      expect(b.shipments.items.find((s: { status: string }) => s.status === 'picking')).toMatchObject({ mode: 'withdrawal' });
      expect(b.shipments.items.find((s: { status: string }) => s.status === 'picking')).toMatchObject({ status: 'picking', orderId: null, trackingUrl: null });
      expect(b.refunds.items.map((r: { channel: string }) => r.channel).sort()).toEqual(['card', 'card', 'spei', 'spei']);
      expect(b.wishlist).toEqual({ itemCount: 0, alertsPaused: false });
    });

    it('cliente sin nada ⇒ ceros y nulos (nunca 0 en el valor de bóveda)', async () => {
      const b = (await ov(other)).body;
      expect(b.vault).toEqual({ piecesCount: 0, valueCents: null, pricedCount: 0, asOf: null });
      const empty = await mk('empty');
      const e = (await ov(empty)).body;
      expect(e.summary.lifetime).toEqual({ purchasesCount: 0, purchasesCents: 0, refundedCents: 0, salesPaidCount: 0, salesPaidCents: 0, salesInProgressCents: 0 });
      expect(e.summary.lastOrderAt).toBeNull();
      expect(e.shipments).toEqual({ total: 0, items: [] });
      expect(e.refunds).toEqual({ total: 0, items: [] });
    });

    it('bóveda: el valor suma SOLO las piezas con precio y coincide con la referencia de `GET /:id`', async () => {
      const card = await h.prisma.card.findFirstOrThrow({ select: { id: true } });
      const owner = await mk('vault');
      for (let i = 0; i < 3; i += 1) {
        await h.prisma.inventoryItem.create({
          data: { folio: `FIC-${RUN}-${i}`, cardId: card.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_custody', ownerType: 'customer', ownerUserId: owner, ownershipStatus: 'settled' },
        });
      }
      const v = (await ov(owner)).body.vault;
      const detail = (await h.api('GET', `/admin/users/${owner}`, { token: admin })).body;
      const priced = detail.ownedItems.filter((i: { referenceValue: { status: string } }) => i.referenceValue.status === 'priced');
      expect(v.piecesCount).toBe(3);
      expect(v.pricedCount).toBe(priced.length);
      expect(v.valueCents).toBe(priced.length === 0 ? null : priced.reduce((n: number, i: { referenceValue: { referenceMxnCents: number } }) => n + i.referenceValue.referenceMxnCents, 0));
    });

    it('candado de claves: ni dirección, CLABE, RFC, Stripe, idempotencyKey, INE ni notas', async () => {
      await post(cust, { body: SECRET_TEXT });
      const text = JSON.stringify((await ov(cust)).body);
      const keys = jsonKeys(JSON.parse(text));
      const banned = /address|clabe|rfc|stripe|idempotency|ine(Front|Back)|snapshot|note|body|passwordHash|googleId|email|phone|legalName/i;
      expect(keys.filter((k) => banned.test(k))).toEqual([]);
      expect(text).not.toContain(SECRET_TEXT);
      expect(text).not.toContain('SECRETA');
    });

    it('IDOR/roles: cliente ⇒ 403, sin sesión ⇒ 401, inexistente ⇒ 404, proveedor ⇒ 404', async () => {
      expect((await ov(cust, customerTok)).status).toBe(403);
      expect((await h.api('GET', `/admin/users/${cust}/overview`)).status).toBe(401);
      expect((await ov('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await ov(supplierId)).status).toBe(404);
    });
  });

  // ============================================================ ?userId=
  describe('?userId= en /admin/refunds y /admin/manual-refunds', () => {
    it('/admin/refunds?userId= devuelve SOLO los reembolsos de ese cliente', async () => {
      const r = await h.api('GET', `/admin/refunds?userId=${cust}`, { token: admin });
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(2);
      expect(r.body.data.every((x: { customer: { userId?: string; id?: string } | null }) => x.customer !== null)).toBe(true);
      const none = await h.api('GET', `/admin/refunds?userId=${other}`, { token: admin });
      expect(none.body.total).toBe(0);
    });
    it('/admin/manual-refunds?userId= filtra por cliente (todos los estados vía ?status=)', async () => {
      const p = await h.api('GET', `/admin/manual-refunds?userId=${cust}`, { token: admin });
      expect(p.status).toBe(200);
      expect(p.body.total).toBe(1); // pending por defecto
      const o = await h.api('GET', `/admin/manual-refunds?userId=${other}`, { token: admin });
      expect(o.body.total).toBe(1);
      const paid = await h.api('GET', `/admin/manual-refunds?userId=${cust}&status=paid`, { token: admin });
      expect(paid.body.total).toBe(1);
    });
    it('userId que no es uuid ⇒ 400; vacío ≡ ausente; rol cliente ⇒ 403', async () => {
      expect((await h.api('GET', '/admin/refunds?userId=no-es-uuid', { token: admin })).status).toBe(400);
      expect((await h.api('GET', "/admin/manual-refunds?userId=1' OR '1'='1", { token: admin })).status).toBe(400);
      expect((await h.api('GET', '/admin/manual-refunds?userId=', { token: admin })).status).toBe(200);
      expect((await h.api('GET', `/admin/refunds?userId=${cust}`, { token: customerTok })).status).toBe(403);
    });
  });

  // ============================================================ notas
  describe('notas internas', () => {
    let target: string;
    beforeAll(async () => {
      target = await mk('notes');
    });

    it('crear (201), listar (fijadas primero, no-store), la nota NO trae clientRequestId/userId', async () => {
      const a = await post(target, { body: '  primera  ' }, operator);
      expect(a.status).toBe(201);
      expect(a.headers['cache-control']).toBe('no-store');
      expect(a.body).toMatchObject({ body: 'primera', pinned: false, authorId: operatorId, edited: false, canEdit: true });
      const b = await post(target, { body: 'segunda fijada', pinned: true });
      const list = await notes(target);
      expect(list.status).toBe(200);
      expect(list.body.items.map((n: { body: string }) => n.body)).toEqual(['segunda fijada', 'primera']);
      expect(list.body.nextCursor).toBeNull();
      expect(jsonKeys(list.body).filter((k) => /clientRequestId|userId|deletedAt/.test(k))).toEqual([]);
      expect(b.body.canEdit).toBe(true);
    });

    it('paginación por cursor', async () => {
      const t = await mk('pages');
      for (let i = 0; i < 3; i += 1) await post(t, { body: `n${i}` });
      const p1 = await notes(t, '?limit=2');
      expect(p1.body.items).toHaveLength(2);
      expect(p1.body.nextCursor).toBeTruthy();
      const p2 = await notes(t, `?limit=2&cursor=${p1.body.nextCursor}`);
      expect(p2.body.items).toHaveLength(1);
      expect(p2.body.nextCursor).toBeNull();
      expect((await notes(t, '?limit=51')).status).toBe(400);
      expect((await notes(t, '?cursor=x')).status).toBe(400);
    });

    it('1000 caracteres entran; 1001, vacío y no-texto ⇒ 400 (nunca se corta en silencio)', async () => {
      const t = await mk('len');
      expect((await post(t, { body: 'x'.repeat(1000) })).status).toBe(201);
      expect((await post(t, { body: 'x'.repeat(1001) })).status).toBe(400);
      expect((await post(t, { body: '    ' })).status).toBe(400);
      expect((await post(t, { body: 5 })).status).toBe(400);
      expect((await post(t, { body: 'ok', clientRequestId: 'no-uuid' })).status).toBe(400);
      expect((await post(t, {})).status).toBe(400);
    });

    it('clientRequestId repetido ⇒ 200 con la MISMA nota y una sola fila (también en paralelo)', async () => {
      const t = await mk('idem');
      const id = '11111111-1111-4111-8111-111111111111';
      const a = await post(t, { body: 'una vez', clientRequestId: id });
      const b = await post(t, { body: 'una vez', clientRequestId: id });
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect(b.body.id).toBe(a.body.id);
      const idP = '22222222-2222-4222-8222-222222222222';
      const par = await Promise.all([1, 2, 3, 4].map(() => post(t, { body: 'en paralelo', clientRequestId: idP })));
      expect(par.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
      expect(new Set(par.map((r) => r.body.id)).size).toBe(1);
      expect(await h.prisma.customerNote.count({ where: { userId: t } })).toBe(2);
      // la misma llave para OTRO cliente no se reutiliza
      expect((await post(other, { body: 'otro', clientRequestId: id })).status).toBe(409);
    });

    it('tope de 200 notas vivas ⇒ 409 NOTE_LIMIT; borrar libera un lugar', async () => {
      const t = await mk('limit');
      await h.prisma.customerNote.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ userId: t, authorId: adminId, body: `n${i}` })) });
      const over = await post(t, { body: 'la 201' });
      expect(over.status).toBe(409);
      expect(over.body.error.code).toBe('NOTE_LIMIT');
      const one = await h.prisma.customerNote.findFirstOrThrow({ where: { userId: t } });
      expect((await h.api('DELETE', `/admin/users/${t}/notes/${one.id}`, { token: admin })).status).toBe(204);
      expect((await post(t, { body: 'ahora sí' })).status).toBe(201);
    });

    it('editar/borrar: solo el autor o súper-admin; fijar: ambos roles', async () => {
      const t = await mk('perm');
      const mine = (await post(t, { body: 'de operador 1' }, operator)).body;
      const asOp2 = (await notes(t, '', operator2)).body.items[0];
      expect(asOp2.canEdit).toBe(false);
      // otro operador: texto y borrado ⇒ 403; fijar ⇒ 200
      expect((await h.api('PATCH', `/admin/users/${t}/notes/${mine.id}`, { token: operator2, json: { body: 'secuestrada' } })).status).toBe(403);
      expect((await h.api('DELETE', `/admin/users/${t}/notes/${mine.id}`, { token: operator2 })).status).toBe(403);
      const pin = await h.api('PATCH', `/admin/users/${t}/notes/${mine.id}`, { token: operator2, json: { pinned: true } });
      expect(pin.status).toBe(200);
      expect(pin.body).toMatchObject({ pinned: true, body: 'de operador 1', edited: false, canEdit: false });
      // el autor edita; el súper-admin también
      const ed = await h.api('PATCH', `/admin/users/${t}/notes/${mine.id}`, { token: operator, json: { body: 'editada por autor' } });
      expect(ed.body).toMatchObject({ body: 'editada por autor', edited: true });
      const ed2 = await h.api('PATCH', `/admin/users/${t}/notes/${mine.id}`, { token: admin, json: { body: 'editada por súper' } });
      expect(ed2.status).toBe(200);
      expect((await h.api('PATCH', `/admin/users/${t}/notes/${mine.id}`, { token: operator, json: {} })).status).toBe(400);
      // la del súper-admin: el operador NO la toca
      const sup = (await post(t, { body: 'de súper' }, admin)).body;
      expect((await h.api('PATCH', `/admin/users/${t}/notes/${sup.id}`, { token: operator, json: { body: 'x' } })).status).toBe(403);
      expect((await h.api('DELETE', `/admin/users/${t}/notes/${sup.id}`, { token: operator })).status).toBe(403);
      expect((await h.api('DELETE', `/admin/users/${t}/notes/${mine.id}`, { token: operator })).status).toBe(204);
      // borrada: ya no sale, y borrar/editar otra vez ⇒ 404
      expect((await notes(t)).body.items.map((n: { id: string }) => n.id)).toEqual([sup.id]);
      expect((await h.api('DELETE', `/admin/users/${t}/notes/${mine.id}`, { token: admin })).status).toBe(404);
      expect((await h.api('PATCH', `/admin/users/${t}/notes/${mine.id}`, { token: admin, json: { pinned: true } })).status).toBe(404);
      // fila lógica conservada
      expect((await h.prisma.customerNote.findUniqueOrThrow({ where: { id: mine.id } })).deletedAt).not.toBeNull();
    });

    it('IDOR: la nota de un cliente no se lee/edita/borra por la ruta de OTRO ⇒ 404; rol cliente ⇒ 403; sin sesión ⇒ 401; proveedor ⇒ 404', async () => {
      const t = await mk('idor');
      const n = (await post(t, { body: 'privada' })).body;
      expect((await notes(other)).body.items.map((x: { id: string }) => x.id)).not.toContain(n.id);
      expect((await h.api('PATCH', `/admin/users/${other}/notes/${n.id}`, { token: admin, json: { pinned: true } })).status).toBe(404);
      expect((await h.api('DELETE', `/admin/users/${other}/notes/${n.id}`, { token: admin })).status).toBe(404);
      for (const [m, path, json] of [
        ['GET', `/admin/users/${t}/notes`, undefined],
        ['POST', `/admin/users/${t}/notes`, { body: 'x' }],
        ['PATCH', `/admin/users/${t}/notes/${n.id}`, { pinned: true }],
        ['DELETE', `/admin/users/${t}/notes/${n.id}`, undefined],
      ] as const) {
        expect((await h.api(m, path, { token: customerTok, json })).status).toBe(403);
        expect((await h.api(m, path, { json })).status).toBe(401);
      }
      expect((await notes(supplierId)).status).toBe(404);
      expect((await post(supplierId, { body: 'x' })).status).toBe(404);
      expect((await notes('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await h.prisma.customerNote.findUniqueOrThrow({ where: { id: n.id } })).body).toBe('privada');
    });

    it('auditoría user.note.* con noteId/pinned/bodyLength y NUNCA el texto', async () => {
      const t = await mk('audit');
      const n = (await post(t, { body: SECRET_TEXT }, operator)).body;
      await h.api('PATCH', `/admin/users/${t}/notes/${n.id}`, { token: operator, json: { body: `${SECRET_TEXT} editado`, pinned: true } });
      await h.api('DELETE', `/admin/users/${t}/notes/${n.id}`, { token: operator });
      const rows = await h.prisma.auditLog.findMany({ where: { entityId: t, action: { startsWith: 'user.note.' } }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => r.action).sort()).toEqual(['user.note.create', 'user.note.delete', 'user.note.pin', 'user.note.update']);
      expect(rows.every((r) => r.entityType === 'User' && r.actorUserId === operatorId)).toBe(true);
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain('TEXTO-SECRETO');
      expect(dump).not.toContain('abuela');
      const create = rows.find((r) => r.action === 'user.note.create')!;
      expect(create.after).toEqual({ noteId: n.id, pinned: false, bodyLength: SECRET_TEXT.length });
      // y la bitácora que ve el equipo (`/audit`) tampoco lo trae
      const aud = await h.api('GET', `/admin/users/${t}/audit?scope=target`, { token: admin });
      expect(JSON.stringify(aud.body)).not.toContain('TEXTO-SECRETO');
    });

    it('fijar solo NO marca «editada» y el texto repetido no audita update', async () => {
      const t = await mk('pin');
      const n = (await post(t, { body: 'igual' })).body;
      const r = await h.api('PATCH', `/admin/users/${t}/notes/${n.id}`, { token: admin, json: { body: 'igual', pinned: true } });
      expect(r.body).toMatchObject({ pinned: true, edited: false });
      const acts = (await h.prisma.auditLog.findMany({ where: { entityId: t, action: { startsWith: 'user.note.' } } })).map((x) => x.action);
      expect(acts.sort()).toEqual(['user.note.create', 'user.note.pin']);
    });

    it('anonimizar la cuenta borra el TEXTO de sus notas (también las ya borradas) y la ficha no lo devuelve', async () => {
      const t = await mk('anon');
      // con un pedido ⇒ el borrado es «suave» (anonimiza) y no «duro»
      await h.prisma.order.create({ data: { ...baseOrder, totalCents: 100, userId: t, fulfillmentMode: 'vault', status: 'settled', settledAt: new Date() } });
      const a = (await post(t, { body: SECRET_TEXT })).body;
      const b = (await post(t, { body: `${SECRET_TEXT} 2` })).body;
      await h.api('DELETE', `/admin/users/${t}/notes/${b.id}`, { token: admin });
      const del = await h.api('DELETE', `/admin/users/${t}`, { token: admin });
      expect(del.status).toBe(200);
      expect(del.body.mode).toBe('soft');
      const rows = await h.prisma.customerNote.findMany({ where: { userId: t } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.body === '')).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('TEXTO-SECRETO');
      expect((await notes(t)).body.items.every((n: { body: string }) => n.body === '')).toBe(true);
      void a;
    });

    it('FUGA: el texto de una nota no aparece en GET /:id, overview, listas ni en NINGUNA ruta de cliente', async () => {
      const t = E2E_USERS.customer.email; // la cuenta con sesión de cliente
      const c = await h.prisma.user.findUniqueOrThrow({ where: { email: t }, select: { id: true } });
      const n = (await post(c.id, { body: SECRET_TEXT })).body;
      try {
        const sniff = [
          ['GET', '/users/me'],
          ['GET', '/users/me/addresses'],
          ['GET', '/users/me/kyc'],
          ['GET', '/orders'],
          ['GET', '/vault'],
          ['GET', '/buylist/requests'],
          ['GET', '/wishlist'],
        ] as const;
        for (const [m, path] of sniff) {
          const r = await h.api(m, path, { token: customerTok });
          expect(r.text).not.toContain('TEXTO-SECRETO');
          expect(r.text).not.toMatch(/customerNote|"notes"/i);
        }
        for (const path of [`/admin/users/${c.id}`, `/admin/users/${c.id}/overview`, `/admin/users/${c.id}/audit?scope=target`, '/admin/users?q=TEXTO-SECRETO']) {
          const r = await h.api('GET', path, { token: admin });
          expect(r.text).not.toContain('TEXTO-SECRETO');
        }
        // La búsqueda de M6 no indexa notas
        const s = await h.api('GET', `/admin/users?q=${encodeURIComponent('llamar a la abuela')}`, { token: admin });
        expect(s.body.data).toHaveLength(0);
      } finally {
        await h.api('DELETE', `/admin/users/${c.id}/notes/${n.id}`, { token: admin });
        await h.prisma.customerNote.deleteMany({ where: { userId: c.id } });
      }
    });
  });
});
