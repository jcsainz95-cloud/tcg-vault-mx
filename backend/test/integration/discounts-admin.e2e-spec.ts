/**
 * discounts-admin.e2e-spec.ts — 💰 CÓDIGOS DE DESCUENTO, fase 2 (API_CONTRACT §DSC.7 + v1.110.1) contra Postgres REAL, app Nest
 * completa por HTTP. Propiedad: backend. Escritas antes del código (sobre `37153aa4` las 21 rutas no existen ⇒ 404).
 *
 *  DCO-B12 (911) lote de 50: 50 textos distintos con prefijo y alfabeto sin 0/O/1/I, CSV de 50; uno usado ⇒ genérico y 49
 *          sirven; pausar el lote ⇒ los 50 pausados; reanudar ⇒ vuelven.
 *  DCO-B13 (912) con un uso apartado: kind/percentPct/minSubtotalCents/filtros ⇒ 409 LOCKED; endsAt y maxTotalUses ≥ inUse ⇒
 *          200; por debajo ⇒ 409 LIMIT_BELOW_USES; DELETE ⇒ 409 HAS_USES. Sin usos: se edita y se archiva (⇒ 404, genérico).
 *  DCO-B14 (913, 914) ronda sembrada (3 pagados, 1 apartado, 1 reembolsado) ⇒ conteos y `discountGivenCents` = Σ de Ventas
 *          (`GET /admin/orders/:id`), JSON y CSV, por código y por lote; los dos correos de confirmación con la línea.
 *  DCO-B15 (890) operador ⇒ 403 en las 21 rutas y cero filas; cada escritura del dueño deja `AuditLog` con antes → después.
 *  + `preview` con cero escrituras; alta con 409/422; filtros de la lista (400 fuera de dominio).
 *
 * Deterministas (N=1 dicho como tal). La tabla `DiscountCodeThrottle` se vacía antes de cada prueba (todas salen de la misma IP).
 */
import { E2EHarness, ApiResponse } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AccDb } from './helpers/accessories-b-db';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { displayPriceCentsOf } from '../../src/common/money';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { centsToPesosCell } from '../../src/modules/sales-analytics/sales-figures';

const RUN = `dsa${Date.now().toString(36)}`;
const TAG = RUN.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
const PFX = `B${TAG.slice(-5)}`.slice(0, 8);

type Body = Record<string, unknown>;

describe('💰 §DSC.7 — códigos de descuento, fase 2: rutas del dueño (Postgres real)', () => {
  let h: E2EHarness;
  let acc: AccDb;
  let prep: ShipPrepDb;
  let admin: string;
  let op: string;
  let seq = 0;
  const codeTexts: string[] = [];
  const batchIds: string[] = [];
  let mailbox: MailMessage[] = [];
  let mailSpy: jest.SpyInstance | undefined;

  const api = (method: string, path: string, opts: { token?: string; json?: unknown } = {}) =>
    h.api(method as 'GET', path, { token: opts.token ?? admin, ...(opts.json !== undefined ? { json: opts.json } : {}) });
  const newCode = () => {
    seq += 1;
    const c = `A${TAG}-${seq}`;
    codeTexts.push(c);
    return c;
  };
  const createCode = async (json: Body): Promise<ApiResponse> => {
    const r = await api('POST', '/admin/discount-codes', { json: { code: newCode(), ...json } });
    if (r.status !== 201) throw new Error(`createCode ${r.status} ${r.text}`);
    return r;
  };
  const piece = async (cents: number) => {
    let L = Math.floor(cents / 1.16) - 2;
    while (displayPriceCentsOf(L, 100, 16) < cents) L += 1;
    const it = await acc.mkItem({ productType: 'raw', listPriceCents: L });
    return { id: it.id, P: displayPriceCentsOf(L, 100, 16) };
  };
  const paid = async (code: string, email: string) => {
    const a = await piece(50000);
    const s = await acc.session({ inventoryItemIds: [a.id], discountCode: code }, { email });
    if (s.status !== 201) throw new Error(`session ${s.status} ${s.text}`);
    await acc.settle(s);
    return s;
  };
  const counts = async () => ({
    codes: await h.prisma.discountCode.count(),
    batches: await h.prisma.discountCodeBatch.count(),
    uses: await h.prisma.discountRedemption.count(),
    throttle: await h.prisma.discountCodeThrottle.count(),
    audit: await h.prisma.auditLog.count({ where: { entityType: { in: ['DiscountCode', 'DiscountCodeBatch'] } } }),
    allAudit: await h.prisma.auditLog.count(),
  });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    acc = new AccDb(h, RUN);
    await acc.init();
    prep = new ShipPrepDb(h, `${RUN}p`);
    await prep.init();
    admin = acc.adminToken;
    op = acc.opToken;
    const port = h.app.get<MailPort>(MAIL_PORT);
    mailSpy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      mailbox.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    mailSpy?.mockRestore();
    if (h) {
      const p = h.prisma;
      const ids = (await p.discountCode.findMany({ where: { OR: [{ code: { in: codeTexts } }, { batchId: { in: batchIds } }] }, select: { id: true } })).map((c) => c.id);
      await p.discountRedemption.deleteMany({ where: { codeId: { in: ids } } });
      await p.discountCode.deleteMany({ where: { id: { in: ids } } });
      await p.discountCodeBatch.deleteMany({ where: { id: { in: batchIds } } });
      await p.discountCodeThrottle.deleteMany({});
      const stray = await p.orderItem.findMany({ where: { inventoryItemId: { in: acc.items } }, select: { orderId: true } });
      for (const o of stray) if (!prep.orders.includes(o.orderId)) acc.orders.add(o.orderId);
      await p.inventoryItem.updateMany({ where: { id: { in: acc.items } }, data: { reservedByOrderId: null, ownerType: 'platform', ownerUserId: null, ownershipStatus: null } });
    }
    await prep?.cleanup();
    await acc?.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    await h.prisma.discountCodeThrottle.deleteMany({});
    h.stripe.cancelOutcome = 'canceled';
    mailbox = [];
  });

  // ================================================================ alta, lectura y filtros

  describe('alta y lista', () => {
    it('POST ⇒ 201 DiscountCodeDTO (texto normalizado, por cliente 1 por defecto, createdBy, usage.discountGivenCents 0); 409 TAKEN; 422 por campo', async () => {
      const text = newCode();
      const r = await api('POST', '/admin/discount-codes', { json: { code: ` ${text.toLowerCase()} `, kind: 'percent', percentPct: 10, maxDiscountCents: 3000 } });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        code: text,
        batchId: null,
        kind: 'percent',
        percentPct: 10,
        amountCents: null,
        maxDiscountCents: 3000,
        productScopes: [],
        destinations: [],
        endsAt: null,
        maxTotalUses: null,
        maxUsesPerCustomer: 1,
        status: 'active',
        state: 'live',
        locked: false,
        usage: { consumed: 0, reservedNow: 0, limit: null, discountGivenCents: 0 },
        createdBy: { name: 'E2E Admin' },
      });
      expect((await api('POST', '/admin/discount-codes', { json: { code: text, kind: 'free_shipping' } })).body.error.code).toBe('DISCOUNT_CODE_TAKEN');
      const bad = async (json: Body, field: string) => {
        const x = await api('POST', '/admin/discount-codes', { json: { code: newCode(), ...json } });
        expect({ status: x.status, code: x.body.error?.code, field: x.body.error?.details?.field }).toEqual({ status: 422, code: 'VALIDATION_ERROR', field });
      };
      await bad({ kind: 'percent' }, 'percentPct');
      await bad({ kind: 'fixed_amount', amountCents: 100, percentPct: 5 }, 'percentPct');
      await bad({ kind: 'free_shipping', destinations: ['vault'] }, 'destinations');
      await bad({ kind: 'percent', percentPct: 101 }, 'percentPct');
      await bad({ kind: 'percent', percentPct: 10, maxTotalUses: 0 }, 'maxTotalUses');
      await bad({ kind: 'percent', percentPct: 10, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' }, 'endsAt');
      await bad({ kind: 'percent', percentPct: 10, sorpresa: 1 }, 'sorpresa');
      const shortCode = await api('POST', '/admin/discount-codes', { json: { code: 'ab', kind: 'free_shipping' } });
      expect(shortCode.body.error.details.field).toBe('code');
      expect(await h.prisma.discountCode.count({ where: { code: { in: codeTexts.slice(1) } } })).toBe(0);
    });

    it('GET lista: sin batchId excluye lotes; ?q prefijo; ?status; ?state computado; fuera de dominio ⇒ 400 {field, allowed}', async () => {
      const live = await createCode({ kind: 'percent', percentPct: 5 });
      const sched = await createCode({ kind: 'percent', percentPct: 5, startsAt: '2099-01-01T00:00:00Z' });
      const paused = await createCode({ kind: 'percent', percentPct: 5 });
      await api('POST', `/admin/discount-codes/${paused.body.id}/pause`);
      const q = `A${TAG}`;
      const all = await api('GET', `/admin/discount-codes?q=${q.toLowerCase()}&pageSize=100`);
      expect(all.status).toBe(200);
      const ids = all.body.data.map((d: { id: string }) => d.id);
      expect(ids).toEqual(expect.arrayContaining([live.body.id, sched.body.id, paused.body.id]));
      expect(all.body.data.every((d: { batchId: string | null }) => d.batchId === null)).toBe(true);
      const byState = await api('GET', `/admin/discount-codes?q=${q}&state=scheduled`);
      expect(byState.body.data.map((d: { id: string }) => d.id)).toEqual([sched.body.id]);
      const byStatus = await api('GET', `/admin/discount-codes?q=${q}&status=paused`);
      expect(byStatus.body.data.map((d: { id: string; state: string }) => [d.id, d.state])).toEqual([[paused.body.id, 'paused']]);
      const bad = await api('GET', '/admin/discount-codes?status=banana');
      expect(bad.status).toBe(400);
      expect(bad.body.error.details).toMatchObject({ field: 'status', allowed: ['active', 'paused'] });
      expect((await api('GET', '/admin/discount-codes?state=paused')).status).toBe(400);
      expect((await api('GET', '/admin/discount-codes?pageSize=101')).status).toBe(400);
    });

    it('preview ⇒ discountOf/allocateDiscount del servidor, ⛔ cero escrituras', async () => {
      const before = await counts();
      const p = await api('POST', '/admin/discount-codes/preview', {
        json: { kind: 'percent', percentPct: 10, maxDiscountCents: 3000, sampleLines: [{ scope: 'raw', priceCents: 100000, quantity: 1 }] },
      });
      expect(p.status).toBe(200);
      expect(p.body).toEqual({ discountCents: 3000, nominalCents: 3000, capped: true });
      const e = await api('POST', '/admin/discount-codes/preview', {
        json: { kind: 'fixed_amount', amountCents: 1000, sampleLines: [{ scope: 'accessory', priceCents: 1000, quantity: 3 }] },
      });
      expect(e.body).toEqual({ discountCents: 999, nominalCents: 1000, capped: true });
      const n = await api('POST', '/admin/discount-codes/preview', { json: { kind: 'percent', percentPct: 10, sampleLines: [{ scope: 'raw', priceCents: 100000, quantity: 1 }] } });
      expect(n.body).toEqual({ discountCents: 10000, nominalCents: 10000, capped: false });
      expect((await api('POST', '/admin/discount-codes/preview', { json: { kind: 'percent', percentPct: 10, sampleLines: [] } })).status).toBe(422);
      expect(await counts()).toEqual(before);
    });
  });

  // ================================================================ DCO-B12

  describe('DCO-B12 (911) — lote de un solo uso', () => {
    it('50 textos distintos `PREFIJO-` + 10 del alfabeto, CSV de 50; uno usado ⇒ genérico y 49 sirven; pausar ⇒ 50; reanudar ⇒ aplican', async () => {
      const r = await api('POST', '/admin/discount-code-batches', { json: { prefix: PFX.toLowerCase(), quantity: 50, kind: 'percent', percentPct: 10 } });
      expect(r.status).toBe(201);
      const id = r.body.batch.id as string;
      batchIds.push(id);
      expect(r.body.codesCsvPath).toBe(`/admin/discount-code-batches/${id}/codes.csv`);
      expect(r.body.batch).toMatchObject({ prefix: PFX, quantity: 50, kind: 'percent', percentPct: 10, status: 'active', state: 'live', usedCodes: 0, reservedNow: 0, locked: false, createdBy: { name: 'E2E Admin' } });
      const rows = await h.prisma.discountCode.findMany({ where: { batchId: id } });
      expect(rows).toHaveLength(50);
      expect(new Set(rows.map((c) => c.code)).size).toBe(50);
      for (const c of rows) {
        expect(c.code).toMatch(new RegExp(`^${PFX}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$`));
        expect([c.maxTotalUses, c.maxUsesPerCustomer]).toEqual([1, 1]);
      }
      const csv = await h.api('GET', r.body.codesCsvPath, { token: admin });
      expect(csv.status).toBe(200);
      expect(csv.text.trim().split('\n')).toHaveLength(51);
      expect(csv.text.split('\n')[0]).toBe('"code","status","usedAt"');
      expect(await h.prisma.auditLog.count({ where: { action: 'discount.batch.codes_exported', entityId: id } })).toBe(1);
      // Sin batchId la lista los excluye; con él, los 50.
      expect((await api('GET', `/admin/discount-codes?batchId=${id}&pageSize=100`)).body.total).toBe(50);

      const [used, ...rest] = rows.map((c) => c.code);
      await paid(used, acc.email('b12a'));
      expect((await acc.quote({ inventoryItemIds: [(await piece(50000)).id], discountCode: used, email: acc.email('b12b') })).body.discount).toEqual({ outcome: 'invalid' });
      const item = await piece(50000);
      for (const c of rest) {
        const q = await acc.quote({ inventoryItemIds: [item.id], discountCode: c });
        expect({ c, outcome: q.body.discount?.outcome }).toEqual({ c, outcome: 'applied' });
      }
      const d = await api('GET', `/admin/discount-code-batches/${id}`);
      expect(d.body).toMatchObject({ usedCodes: 1, locked: true, state: 'live' });

      const p = await api('POST', `/admin/discount-code-batches/${id}/pause`);
      expect(p.status).toBe(200);
      expect(p.body.status).toBe('paused');
      expect(await h.prisma.discountCode.count({ where: { batchId: id, status: 'paused' } })).toBe(50);
      expect((await acc.quote({ inventoryItemIds: [item.id], discountCode: rest[0] })).body.discount).toEqual({ outcome: 'invalid' });
      expect((await api('POST', `/admin/discount-code-batches/${id}/resume`)).body.status).toBe('active');
      await h.prisma.discountCodeThrottle.deleteMany({});
      expect((await acc.quote({ inventoryItemIds: [item.id], discountCode: rest[0] })).body.discount.outcome).toBe('applied');
    });

    it('PATCH del lote: sin usos aplica a los N; con uno usado solo endsAt (409 LOCKED); límites de uso fijos ⇒ 409; 422 en el alta', async () => {
      const r = await api('POST', '/admin/discount-code-batches', { json: { prefix: `${PFX.slice(0, 6)}P`, quantity: 3, kind: 'percent', percentPct: 10 } });
      const id = r.body.batch.id as string;
      batchIds.push(id);
      const p1 = await api('PATCH', `/admin/discount-code-batches/${id}`, { json: { percentPct: 15 } });
      expect(p1.status).toBe(200);
      expect(await h.prisma.discountCode.count({ where: { batchId: id, percentPct: 15 } })).toBe(3);
      const fixed = await api('PATCH', `/admin/discount-code-batches/${id}`, { json: { maxTotalUses: 5 } });
      expect(fixed.status).toBe(409);
      expect(fixed.body.error).toMatchObject({ code: 'DISCOUNT_CODE_LOCKED', details: { lockedFields: ['maxTotalUses'] } });
      const first = await h.prisma.discountCode.findFirstOrThrow({ where: { batchId: id } });
      await paid(first.code, acc.email('b12p'));
      const locked = await api('PATCH', `/admin/discount-code-batches/${id}`, { json: { percentPct: 20 } });
      expect(locked.body.error).toMatchObject({ code: 'DISCOUNT_CODE_LOCKED', details: { lockedFields: ['percentPct'] } });
      const ends = await api('PATCH', `/admin/discount-code-batches/${id}`, { json: { endsAt: '2099-01-01T06:00:00Z' } });
      expect(ends.status).toBe(200);
      expect(ends.body.endsAt).toBe('2099-01-01T06:00:00.000Z');
      expect((await api('POST', '/admin/discount-code-batches', { json: { prefix: 'X', quantity: 3, kind: 'free_shipping' } })).body.error.details.field).toBe('prefix');
      expect((await api('POST', '/admin/discount-code-batches', { json: { prefix: 'XY', quantity: 501, kind: 'free_shipping' } })).body.error.details.field).toBe('quantity');
      expect((await api('POST', '/admin/discount-code-batches', { json: { prefix: 'XY', quantity: 2, kind: 'free_shipping', maxTotalUses: 2 } })).body.error.details.field).toBe('maxTotalUses');
    });
  });

  // ================================================================ DCO-B13

  describe('DCO-B13 (912) — bloqueo tras el primer uso', () => {
    it('con usos apartados: config ⇒ 409 LOCKED; endsAt y maxTotalUses ≥ inUse ⇒ 200; por debajo ⇒ 409 LIMIT_BELOW_USES; DELETE ⇒ 409 HAS_USES', async () => {
      const c = await createCode({ kind: 'percent', percentPct: 10, maxTotalUses: 5 });
      const id = c.body.id as string;
      for (const tag of ['b13a', 'b13b']) {
        const s = await acc.session({ inventoryItemIds: [(await piece(50000)).id], discountCode: c.body.code }, { email: acc.email(tag) });
        expect(s.status).toBe(201);
      }
      const g = await api('GET', `/admin/discount-codes/${id}`);
      expect(g.body).toMatchObject({ locked: true, usage: { consumed: 0, reservedNow: 2, limit: 5 } });
      const lockedOf = async (json: Body) => {
        const r = await api('PATCH', `/admin/discount-codes/${id}`, { json });
        return { status: r.status, code: r.body.error?.code, lockedFields: r.body.error?.details?.lockedFields };
      };
      expect(await lockedOf({ percentPct: 20 })).toEqual({ status: 409, code: 'DISCOUNT_CODE_LOCKED', lockedFields: ['percentPct'] });
      expect(await lockedOf({ kind: 'fixed_amount', amountCents: 100, percentPct: null })).toEqual({ status: 409, code: 'DISCOUNT_CODE_LOCKED', lockedFields: ['amountCents', 'kind', 'percentPct'] });
      expect(await lockedOf({ minSubtotalCents: 1000 })).toEqual({ status: 409, code: 'DISCOUNT_CODE_LOCKED', lockedFields: ['minSubtotalCents'] });
      expect(await lockedOf({ productScopes: ['raw'] })).toEqual({ status: 409, code: 'DISCOUNT_CODE_LOCKED', lockedFields: ['productScopes'] });
      expect(await lockedOf({ destinations: ['direct_ship'] })).toEqual({ status: 409, code: 'DISCOUNT_CODE_LOCKED', lockedFields: ['destinations'] });
      // Reenviar el mismo valor no es editar.
      expect((await api('PATCH', `/admin/discount-codes/${id}`, { json: { percentPct: 10 } })).status).toBe(200);
      const e = await api('PATCH', `/admin/discount-codes/${id}`, { json: { endsAt: '2099-01-01T06:00:00Z', maxTotalUses: 2 } });
      expect(e.status).toBe(200);
      expect(e.body).toMatchObject({ endsAt: '2099-01-01T06:00:00.000Z', maxTotalUses: 2, state: 'exhausted' });
      const below = await api('PATCH', `/admin/discount-codes/${id}`, { json: { maxTotalUses: 1 } });
      expect(below.status).toBe(409);
      expect(below.body.error).toMatchObject({ code: 'DISCOUNT_CODE_LIMIT_BELOW_USES', details: { inUse: 2 } });
      expect((await api('PATCH', `/admin/discount-codes/${id}`, { json: { code: 'OTRO-TEXTO' } })).body.error.details.field).toBe('code');
      const del = await api('DELETE', `/admin/discount-codes/${id}`);
      expect(del.status).toBe(409);
      expect(del.body.error.code).toBe('DISCOUNT_CODE_HAS_USES');
      expect((await h.prisma.discountCode.findUniqueOrThrow({ where: { id } })).archivedAt).toBeNull();
    });

    it('sin usos: PATCH libre; DELETE ⇒ 204, GET 404, el texto sigue ocupado (409 TAKEN) y el cliente ve el genérico', async () => {
      const c = await createCode({ kind: 'percent', percentPct: 10 });
      const id = c.body.id as string;
      const p = await api('PATCH', `/admin/discount-codes/${id}`, { json: { kind: 'fixed_amount', amountCents: 5000, percentPct: null, productScopes: ['raw', 'graded'] } });
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ kind: 'fixed_amount', amountCents: 5000, percentPct: null, productScopes: ['raw', 'graded'] });
      expect((await api('PATCH', `/admin/discount-codes/${id}`, { json: { amountCents: null } })).body.error.details.field).toBe('amountCents');
      expect((await api('DELETE', `/admin/discount-codes/${id}`)).status).toBe(204);
      expect((await api('GET', `/admin/discount-codes/${id}`)).status).toBe(404);
      expect((await api('POST', '/admin/discount-codes', { json: { code: c.body.code, kind: 'free_shipping' } })).body.error.code).toBe('DISCOUNT_CODE_TAKEN');
      expect((await acc.quote({ inventoryItemIds: [(await piece(50000)).id], discountCode: c.body.code })).body.discount).toEqual({ outcome: 'invalid' });
    });
  });

  // ================================================================ DCO-B14

  describe('DCO-B14 (913, 914) — reporte = Σ de Ventas; correos con la línea', () => {
    it('3 pagados (1 reembolsado), 1 apartado ⇒ conteos y discountGivenCents = Σ discount de GET /admin/orders/:id, JSON y CSV', async () => {
      const c = await createCode({ kind: 'percent', percentPct: 10, maxUsesPerCustomer: null });
      const id = c.body.id as string;
      const code = c.body.code as string;
      const paidOrders: ApiResponse[] = [];
      for (const tag of ['b14a', 'b14b', 'b14c']) paidOrders.push(await paid(code, acc.email(tag)));
      // Correo de confirmación del invitado (914): la línea «Descuento (CÓDIGO) −MX$X» desde las columnas de la orden.
      const conf = mailbox.filter((m) => m.subject.includes('Confirmación'));
      expect(conf.length).toBeGreaterThanOrEqual(3);
      const d0 = paidOrders[0].body.discount.discountCents as number;
      const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(d0 / 100);
      expect(conf.some((m) => m.text.includes(`Descuento (${code}): − ${money}`) && m.html.includes(`Descuento (${code})`))).toBe(true);
      const pending = await acc.session({ inventoryItemIds: [(await piece(50000)).id], discountCode: code }, { email: acc.email('b14d') });
      expect(pending.status).toBe(201);
      const refunded = paidOrders[2].body.orderId as string;
      expect((await acc.fullRefund(refunded)).status).toBeLessThan(300);
      // El reembolso lo confirma Stripe: la fila del libro pasa a `succeeded` (lo que el reporte suma).
      await h.prisma.paymentRefund.updateMany({ where: { orderId: refunded }, data: { status: 'succeeded' } });
      const refundRows = await h.prisma.paymentRefund.findMany({ where: { orderId: refunded, status: 'succeeded' } });
      expect(refundRows.length).toBeGreaterThan(0);

      // Ventas (M3), lectura del operador.
      let ventas = 0;
      for (const s of paidOrders) {
        const m3 = await acc.adminOrder(s.body.orderId, op);
        expect(m3.status).toBe(200);
        expect(m3.body.discount).toEqual({ code, kind: 'percent', discountCents: s.body.discount.discountCents, shippingWaivedCents: 0 });
        expect(m3.body.items[0].unitDiscountCents).toBe(s.body.discount.discountCents);
        ventas += m3.body.discount.discountCents;
      }
      const rep = await api('GET', `/admin/discount-codes/${id}/report`);
      expect(rep.status).toBe(200);
      expect(rep.body).toMatchObject({
        consumed: 3,
        reservedNow: 1,
        limit: null,
        paidOrders: 3,
        discountGivenCents: ventas,
        shippingWaivedOrdersCents: 0,
        shippingWaivedWithdrawalsCents: 0,
        withdrawals: 0,
        salesCollectedCents: paidOrders.reduce((s, x) => s + x.body.breakdown.totalCents, 0),
        refundedOrders: 1,
        refundedCents: refundRows.reduce((s, x) => s + x.amountCents, 0),
        lateConsumed: 0,
      });
      expect(rep.body.rows).toHaveLength(4);
      expect(rep.body.rows.filter((r: { status: string }) => r.status === 'reserved')).toHaveLength(1);
      expect((await api('GET', `/admin/discount-codes/${id}`)).body.usage).toEqual({ consumed: 3, reservedNow: 1, limit: null, discountGivenCents: ventas });
      const csv = await h.api('GET', `/admin/discount-codes/${id}/report.csv`, { token: admin });
      expect(csv.status).toBe(200);
      const total = csv.text.trim().split('\n').pop()!.split(',');
      expect(total[0]).toBe('"total"');
      expect(total[5]).toBe(centsToPesosCell(ventas));
      expect(total[7]).toBe(centsToPesosCell(rep.body.salesCollectedCents));
      expect(await h.prisma.auditLog.count({ where: { action: 'discount.code.report_exported', entityId: id } })).toBe(1);
      // Rango de días México: hoy ⇒ los 4; un día pasado ⇒ ninguno.
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
      expect((await api('GET', `/admin/discount-codes/${id}/report?from=${today}&to=${today}`)).body.rows).toHaveLength(4);
      expect((await api('GET', `/admin/discount-codes/${id}/report?from=2020-01-01&to=2020-01-02`)).body).toMatchObject({ consumed: 0, discountGivenCents: 0, rows: [] });
      expect((await api('GET', `/admin/discount-codes/${id}/report?from=ayer`)).status).toBe(400);
    });

    it('reporte por lote: usedCodes y la misma suma; AV-2 de la cuenta (bóveda) con la línea', async () => {
      const b = await api('POST', '/admin/discount-code-batches', { json: { prefix: `${PFX.slice(0, 6)}R`, quantity: 2, kind: 'percent', percentPct: 10 } });
      const id = b.body.batch.id as string;
      batchIds.push(id);
      const codes = await h.prisma.discountCode.findMany({ where: { batchId: id }, orderBy: { code: 'asc' } });
      const s = await paid(codes[0].code, acc.email('b14l'));
      const rep = await api('GET', `/admin/discount-code-batches/${id}/report`);
      expect(rep.body).toMatchObject({ consumed: 1, paidOrders: 1, limit: 2, discountGivenCents: s.body.discount.discountCents });
      expect(rep.body.usedCodes.map((u: { code: string }) => u.code)).toEqual([codes[0].code]);
      const csv = await h.api('GET', `/admin/discount-code-batches/${id}/report.csv`, { token: admin });
      expect(csv.text.trim().split('\n')).toHaveLength(3);
      // AV-2: cliente con cuenta, bóveda, con el otro código del lote.
      const u = await prep.mkUser('Cliente DSA', {});
      const token = await prep.loginCustomer(u.email as string);
      const a = await piece(50000);
      const vs = await h.api('POST', '/checkout/session', { token, json: { inventoryItemIds: [a.id], discountCode: codes[1].code } });
      expect(vs.status).toBe(201);
      prep.orders.push(vs.body.orderId);
      mailbox = [];
      await acc.settle(vs);
      const av2 = mailbox.find((m) => m.to === u.email);
      expect(av2).toBeDefined();
      const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(vs.body.discount.discountCents / 100);
      expect(av2!.text).toContain(`Descuento (${codes[1].code}): − ${money}`);
      // Sin código: el correo no lleva la línea (I-1).
      mailbox = [];
      const plain = await acc.session({ inventoryItemIds: [(await piece(50000)).id] }, { email: acc.email('b14p') });
      await acc.settle(plain);
      expect(mailbox.some((m) => m.text.includes('Descuento ('))).toBe(false);
    });
  });

  // ================================================================ DCO-B15

  describe('DCO-B15 (890) — solo super_admin; toda escritura a la bitácora con antes → después', () => {
    it('el operador recibe 403 en las 21 rutas y no cambia ni una fila', async () => {
      const c = await createCode({ kind: 'percent', percentPct: 10 });
      const b = await api('POST', '/admin/discount-code-batches', { json: { prefix: `${PFX.slice(0, 6)}F`, quantity: 1, kind: 'free_shipping' } });
      batchIds.push(b.body.batch.id);
      const cid = c.body.id as string;
      const bid = b.body.batch.id as string;
      const routes: [string, string, unknown?][] = [
        ['GET', '/admin/discount-codes'],
        ['POST', '/admin/discount-codes', { code: newCode(), kind: 'free_shipping' }],
        ['GET', `/admin/discount-codes/${cid}`],
        ['PATCH', `/admin/discount-codes/${cid}`, { percentPct: 50 }],
        ['POST', `/admin/discount-codes/${cid}/pause`],
        ['POST', `/admin/discount-codes/${cid}/resume`],
        ['DELETE', `/admin/discount-codes/${cid}`],
        ['POST', '/admin/discount-code-batches', { prefix: 'OPX', quantity: 2, kind: 'free_shipping' }],
        ['GET', '/admin/discount-code-batches'],
        ['GET', `/admin/discount-code-batches/${bid}`],
        ['PATCH', `/admin/discount-code-batches/${bid}`, { endsAt: '2099-01-01T00:00:00Z' }],
        ['POST', `/admin/discount-code-batches/${bid}/pause`],
        ['POST', `/admin/discount-code-batches/${bid}/resume`],
        ['GET', `/admin/discount-code-batches/${bid}/codes.csv`],
        ['GET', `/admin/discount-codes/${cid}/report`],
        ['GET', `/admin/discount-codes/${cid}/report.csv`],
        ['GET', `/admin/discount-code-batches/${bid}/report`],
        ['GET', `/admin/discount-code-batches/${bid}/report.csv`],
        ['POST', '/admin/discount-codes/preview', { kind: 'percent', percentPct: 10, sampleLines: [{ scope: 'raw', priceCents: 1000, quantity: 1 }] }],
        ['GET', `/admin/discount-codes/${cid}/audit`],
        ['GET', `/admin/discount-code-batches/${bid}/audit`],
      ];
      expect(routes).toHaveLength(21);
      const before = await counts();
      const snap = await h.prisma.discountCode.findMany({ where: { id: cid } });
      for (const [method, path, json] of routes) {
        const r = await api(method, path, { token: op, json });
        expect({ method, path, status: r.status, code: r.body?.error?.code }).toEqual({ method, path, status: 403, code: 'FORBIDDEN' });
      }
      expect(await counts()).toEqual(before);
      expect(await h.prisma.discountCode.findMany({ where: { id: cid } })).toEqual(snap);
      // Y el dueño SÍ las tiene montadas (⛔ un 403 de una ruta que no existe no prueba nada): las lecturas dan 200.
      for (const [method, path] of routes.filter(([m]) => m === 'GET')) {
        expect({ path, status: (await api(method, path)).status }).toEqual({ path, status: 200 });
      }
      // Un cliente tampoco.
      expect((await api('GET', '/admin/discount-codes', { token: acc.customerToken })).status).toBe(403);
    });

    it('cada escritura deja AuditLog; GET …/audit devuelve actor y changes antes → después', async () => {
      const c = await createCode({ kind: 'percent', percentPct: 10 });
      const id = c.body.id as string;
      await api('PATCH', `/admin/discount-codes/${id}`, { json: { percentPct: 25, endsAt: '2099-01-01T06:00:00Z' } });
      await api('POST', `/admin/discount-codes/${id}/pause`);
      await api('POST', `/admin/discount-codes/${id}/resume`);
      await api('DELETE', `/admin/discount-codes/${id}`);
      const a = await api('GET', `/admin/discount-codes/${id}/audit`);
      expect(a.status).toBe(200);
      expect(a.body.total).toBe(5);
      expect(a.body.data.map((x: { action: string }) => x.action)).toEqual(
        expect.arrayContaining(['discount.code.created', 'discount.code.updated', 'discount.code.paused', 'discount.code.resumed', 'discount.code.archived']),
      );
      const upd = a.body.data.find((x: { action: string }) => x.action === 'discount.code.updated');
      expect(upd.actor).toMatchObject({ name: 'E2E Admin' });
      expect(upd.changes).toEqual([
        { field: 'endsAt', before: null, after: '2099-01-01T06:00:00.000Z' },
        { field: 'percentPct', before: 10, after: 25 },
      ]);
      const created = a.body.data.find((x: { action: string }) => x.action === 'discount.code.created');
      expect(created.changes).toEqual(expect.arrayContaining([{ field: 'kind', before: null, after: 'percent' }]));
      const rows = await h.prisma.auditLog.findMany({ where: { entityType: 'DiscountCode', entityId: id } });
      expect(rows.every((r) => r.actorRole === 'super_admin')).toBe(true);

      const b = await api('POST', '/admin/discount-code-batches', { json: { prefix: `${PFX.slice(0, 6)}A`, quantity: 2, kind: 'percent', percentPct: 10 } });
      const bid = b.body.batch.id as string;
      batchIds.push(bid);
      await api('PATCH', `/admin/discount-code-batches/${bid}`, { json: { percentPct: 12 } });
      await api('POST', `/admin/discount-code-batches/${bid}/pause`);
      await api('POST', `/admin/discount-code-batches/${bid}/resume`);
      const ba = await api('GET', `/admin/discount-code-batches/${bid}/audit`);
      expect(ba.body.data.map((x: { action: string }) => x.action).sort()).toEqual(['discount.batch.created', 'discount.batch.paused', 'discount.batch.resumed', 'discount.batch.updated']);
      expect(ba.body.data.find((x: { action: string }) => x.action === 'discount.batch.updated').changes).toEqual([{ field: 'percentPct', before: 10, after: 12 }]);
      expect((await api('GET', '/admin/discount-codes/00000000-0000-0000-0000-000000000000/audit')).status).toBe(404);
    });
  });
});
