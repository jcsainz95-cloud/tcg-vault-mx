/**
 * wishlist-notify.e2e-spec.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.5): el job `wishlist-notify` y las bajas al pagar,
 * contra la app REAL y Postgres real. Reloj del módulo MANUAL (`'WISHLIST_CLOCK'`), correo que CAPTURA.
 *
 *  WSH-T6 (806) · T9 (809) · T10 (810) · T11 (811, reloj inyectado) · T13 (813, e2e: sin verificar ⇒ skipped/unverified)
 *  · T15 (815) · T16 (816, bóveda y envío directo) · T23 (825) · T24 (823, e2e: el planificador del AppModule real).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createWshWorld, WshPerson, WshWorld } from './helpers/wishlist-db';
import { SchedulerService } from '../../src/jobs/scheduler.service';

let w: WshWorld;

beforeAll(async () => {
  w = await createWshWorld();
});
afterAll(async () => {
  await w?.close();
});
beforeEach(async () => {
  await w.resetDials();
  w.mail.reset();
});

const MIN = 60_000;
const want = async (p: WshPerson, cardId: string, maxPct: 5 | 10 | 16, finish = 'normal') => {
  const r = await w.h.api('POST', '/wishlist', { token: p.token, json: { cardId, finish, maxPct } });
  expect(r.status).toBe(201);
  return r.body.id as string;
};
/** Detecta y, pasada la ventana, despacha. */
const tick = async () => {
  const a = await w.runNotify();
  expect(a.status).toBe(200);
  w.clock.advance(31 * MIN);
  const b = await w.runNotify();
  expect(b.status).toBe(200);
  return b.body;
};

describe('WSH-T6 — el máximo sale del mercado del DÍA DEL AVISO (806)', () => {
  it('deseo al 10 %, mercado 1000 al guardar y 1200 al enviar ⇒ maxDisplayCents 132000 en la foto y en el correo', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 10);
    await w.market(c.id, 'normal', 120000);
    const pieceId = await w.piece(c.id, { listCents: 100000 });
    await tick();
    const n = await w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { userId_inventoryItemId: { userId: a.id, inventoryItemId: pieceId } } });
    expect(n.status).toBe('sent');
    expect(n.marketCents).toBe(120000);
    expect(n.maxDisplayCents).toBe(132000);
    expect(n.priceDisplayCents).toBe(116000);
    expect(n.fits).toBe(true);
    const m = w.mailsTo(a.email);
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain('$1,320.00');
  });
});

describe('WSH-T9 — el aviso sale cuando debe, a TODAS las cuentas (809)', () => {
  it('pieza NM del acabado por alta suelta, bulk-publish, buylist y liberación de reserva ⇒ aviso a todas; graded/otro acabado/promo/pendiente ⇒ ninguno', async () => {
    const fits = await w.customer();
    const notFits = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(fits, c.id, 16);
    await want(notFits, c.id, 5);

    // (1) alta suelta por HTTP (SU.8 la publica sola: hay mercado ⇒ precio de la curva)
    const alta = await w.h.api('POST', '/admin/inventory/items', {
      token: w.adminToken,
      json: { cardId: c.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 50000 },
    });
    expect(alta.status).toBe(201);
    const altaId = alta.body.id as string;
    expect((await w.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: altaId } })).status).toBe('listed');
    // (2) bulk-publish por HTTP de una pieza en `in_stock`
    const stockId = await w.piece(c.id, { status: 'in_stock', listCents: null });
    const bp = await w.h.api('POST', '/admin/inventory/items/bulk-publish', {
      token: w.adminToken,
      json: { batchKey: `wsh-${w.run}-bp`, items: [{ inventoryItemId: stockId }] },
    });
    expect(bp.status).toBe(200);
    expect((await w.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: stockId } })).status).toBe('listed');
    // (3) pieza que entra por buylist (estado escrito como lo deja `convertToInventory` + publicación)
    const buyId = await w.piece(c.id, { acquisitionType: 'buylist', listCents: null });
    // (4) liberación de reserva: `reserved` → `listed` (como `orders/reservation.ts`)
    const resId = await w.piece(c.id, { status: 'reserved', listCents: null });
    await w.h.prisma.inventoryItem.update({ where: { id: resId }, data: { status: 'listed' } });

    // Las que NO casan:
    const other = await w.customer();
    await w.h.prisma.wishlistItem.create({ data: { userId: other.id, cardId: c.id, finish: 'reverse_holo', maxPct: 16 } });
    const gradedId = await w.piece(c.id, { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '10', certNumber: `C-${w.run}` });
    const cp = await w.h.prisma.cardProduct.create({
      data: { cardId: c.id, tcgplayerProductId: 900000000 + Math.floor(Math.random() * 99999999), kind: 'promo', name: 'Promo' },
    });
    const promoId = await w.piece(c.id, { cardProductId: cp.tcgplayerProductId });
    const c2 = await w.card();
    await want(other, c2.id, 16);
    const pendingId = await w.piece(c2.id, { listCents: null }); // sin mercado y sin precio ⇒ no vendible

    await tick();

    const notices = await w.h.prisma.wishlistNotice.findMany({ where: { userId: { in: [fits.id, notFits.id, other.id] } } });
    const by = (uid: string) => notices.filter((n) => n.userId === uid).map((n) => n.inventoryItemId).sort();
    expect(by(fits.id)).toEqual([altaId, stockId, buyId, resId].sort());
    expect(by(notFits.id)).toEqual([altaId, stockId, buyId, resId].sort());
    expect(by(other.id)).toEqual([]);
    for (const id of [gradedId, promoId, pendingId]) expect(notices.some((n) => n.inventoryItemId === id)).toBe(false);
    // a todas, quepa o no: UN correo a cada una con la línea agrupada («4 disponibles»)
    expect(w.mailsTo(fits.email)).toHaveLength(1);
    expect(w.mailsTo(notFits.email)).toHaveLength(1);
    expect(w.mailsTo(notFits.email)[0].text).toContain('Está arriba de tu máximo.');
    expect(w.mailsTo(fits.email)[0].text).toContain('4 disponibles');
    expect(w.mailsTo(other.email)).toHaveLength(0);
  });
});

describe('WSH-T10 — una vez por pieza (810)', () => {
  it('reservar y liberar la misma pieza ⇒ 1 correo; una segunda pieza ⇒ segundo correo', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 10);
    const p1 = await w.piece(c.id, { listCents: 90000 });
    await tick();
    expect(w.mailsTo(a.email)).toHaveLength(1);
    await w.h.prisma.inventoryItem.update({ where: { id: p1 }, data: { status: 'reserved' } });
    await tick();
    await w.h.prisma.inventoryItem.update({ where: { id: p1 }, data: { status: 'listed' } });
    await tick();
    expect(w.mailsTo(a.email)).toHaveLength(1);
    await w.piece(c.id, { listCents: 91000 });
    await tick();
    expect(w.mailsTo(a.email)).toHaveLength(2);
  });

  it('una pieza detectada y luego reservada se queda `pending`; vendida ⇒ `skipped/unavailable`', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 10);
    const p1 = await w.piece(c.id, { listCents: 90000 });
    await w.runNotify(); // detecta
    await w.h.prisma.inventoryItem.update({ where: { id: p1 }, data: { status: 'reserved' } });
    w.clock.advance(31 * MIN);
    await w.runNotify();
    const n = await w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { userId_inventoryItemId: { userId: a.id, inventoryItemId: p1 } } });
    expect(n.status).toBe('pending');
    await w.h.prisma.inventoryItem.update({ where: { id: p1 }, data: { status: 'in_custody' } });
    await w.runNotify();
    const n2 = await w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { id: n.id } });
    expect(n2.status).toBe('skipped');
    expect(n2.skipReason).toBe('unavailable');
    expect(w.mailsTo(a.email)).toHaveLength(0);
  });
});

describe('WSH-T11 — agrupado y tope diario (811)', () => {
  it('5 piezas en la ventana ⇒ 1 correo con 5 líneas; 4.º correo del día no sale; al día siguiente solo lo que sigue a la venta', async () => {
    const a = await w.customer();
    const cards = [];
    for (let i = 0; i < 5; i += 1) {
      const c = await w.card();
      await w.market(c.id, 'normal', 100000);
      await want(a, c.id, 10);
      cards.push(c);
    }
    // Arranque del día en una hora propia (el tope es por día de México).
    w.clock.set(new Date(w.clock.now().getTime() + 3 * 24 * 3600_000));
    for (const c of cards) {
      await w.piece(c.id, { listCents: 90000 });
      await w.runNotify();
      w.clock.advance(4 * MIN); // las 5 caen dentro de la ventana de 30 min del primero
    }
    w.clock.advance(31 * MIN);
    await w.runNotify();
    let mails = w.mailsTo(a.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('Ya tenemos 5 cartas de tu lista');
    for (const c of cards) expect(mails[0].text).toContain(c.name);

    // dos correos más el mismo día (tope 3) …
    const extra = [];
    for (let i = 0; i < 3; i += 1) {
      const c = await w.card();
      await w.market(c.id, 'normal', 100000);
      await want(a, c.id, 10);
      extra.push(c);
    }
    for (const c of extra) {
      await w.piece(c.id, { listCents: 90000 });
      await tick();
    }
    mails = w.mailsTo(a.email);
    expect(mails).toHaveLength(3); // el 4.º no sale hoy
    const third = extra[2];
    const pending = await w.h.prisma.wishlistNotice.findMany({ where: { userId: a.id, status: 'pending' } });
    expect(pending).toHaveLength(1);
    // al día siguiente: se vendió entretanto ⇒ no sale
    const piece = await w.h.prisma.inventoryItem.findFirstOrThrow({ where: { cardId: third.id } });
    await w.h.prisma.inventoryItem.update({ where: { id: piece.id }, data: { status: 'in_custody' } });
    w.clock.advance(24 * 3600_000);
    await w.runNotify();
    expect(w.mailsTo(a.email)).toHaveLength(3);
    const after = await w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { id: pending[0].id } });
    expect(after.status).toBe('skipped');
    expect(after.skipReason).toBe('unavailable');
  });

  it('lo que pasó del tope sale al día siguiente si sigue a la venta', async () => {
    const a = await w.customer();
    await w.setDial('wishlist_daily_mail_cap', 1);
    w.clock.set(new Date(w.clock.now().getTime() + 5 * 24 * 3600_000));
    const cs = [];
    for (let i = 0; i < 2; i += 1) {
      const c = await w.card();
      await w.market(c.id, 'normal', 100000);
      await want(a, c.id, 10);
      cs.push(c);
    }
    await w.piece(cs[0].id, { listCents: 90000 });
    await tick();
    await w.piece(cs[1].id, { listCents: 90000 });
    await tick();
    expect(w.mailsTo(a.email)).toHaveLength(1);
    w.clock.advance(24 * 3600_000);
    await w.runNotify();
    const m = w.mailsTo(a.email);
    expect(m).toHaveLength(2);
    expect(m[1].text).toContain(cs[1].name);
  });
});

describe('WSH-T13 (e2e) — solo a correos verificados; pausa; cuenta inactiva (813, 814)', () => {
  it('sin verificar ⇒ skipped/unverified; pausada ⇒ skipped/paused; inactiva ⇒ skipped/inactive; sin recuperación', async () => {
    const unverified = await w.customer({ verified: false });
    const paused = await w.customer();
    const inactive = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    for (const p of [unverified, paused, inactive]) await want(p, c.id, 10);
    await w.h.api('PUT', '/wishlist/alerts', { token: paused.token, json: { paused: true } });
    await w.h.prisma.user.update({ where: { id: inactive.id }, data: { status: 'blocked' } });
    const pieceId = await w.piece(c.id, { listCents: 90000 });
    await tick();
    const st = async (uid: string) =>
      w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { userId_inventoryItemId: { userId: uid, inventoryItemId: pieceId } } });
    expect(await st(unverified.id)).toEqual(expect.objectContaining({ status: 'skipped', skipReason: 'unverified' }));
    expect(await st(paused.id)).toEqual(expect.objectContaining({ status: 'skipped', skipReason: 'paused' }));
    expect(await st(inactive.id)).toEqual(expect.objectContaining({ status: 'skipped', skipReason: 'inactive' }));
    // reanudar no recupera
    await w.h.api('PUT', '/wishlist/alerts', { token: paused.token, json: { paused: false } });
    await tick();
    expect(w.mail.sent).toHaveLength(0);
  });

  it('el idioma del correo es el de la cuenta (en)', async () => {
    const a = await w.customer({ locale: 'en' });
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 10);
    await w.piece(c.id, { listCents: 90000 });
    await tick();
    const m = w.mailsTo(a.email);
    expect(m).toHaveLength(1);
    expect(m[0].subject).toBe(`We found a card from your wishlist: ${c.name}`);
    const mail = await w.h.prisma.wishlistMail.findFirstOrThrow({ where: { userId: a.id } });
    expect(mail.locale).toBe('en');
    expect(mail.itemCount).toBe(1);
  });

  it('el proveedor falla ⇒ `failedAt` y ⛔ sin reintento', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 10);
    await w.piece(c.id, { listCents: 90000 });
    w.mail.failNext = 1;
    await tick();
    const mail = await w.h.prisma.wishlistMail.findFirstOrThrow({ where: { userId: a.id } });
    expect(mail.failedAt).not.toBeNull();
    await tick();
    expect(w.mailsTo(a.email)).toHaveLength(0);
    expect(await w.h.prisma.wishlistMail.count({ where: { userId: a.id } })).toBe(1);
  });
});

describe('WSH-T23 — el correo dice si cabe y la pieza sale a precio normal (825)', () => {
  it('cuentas al 5 % y al 16 %, P entre ambos máximos ⇒ fits false/true; P = displayPriceCents del ListingDTO público', async () => {
    const at5 = await w.customer();
    const at16 = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(at5, c.id, 5);
    await want(at16, c.id, 16);
    const pieceId = await w.piece(c.id, { listCents: 95000 }); // P = 110200
    const pub = await w.h.api('GET', `/catalog/listings/${pieceId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.displayPriceCents).toBe(110200);
    await tick();
    const n5 = await w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { userId_inventoryItemId: { userId: at5.id, inventoryItemId: pieceId } } });
    const n16 = await w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { userId_inventoryItemId: { userId: at16.id, inventoryItemId: pieceId } } });
    expect([n5.fits, n5.maxDisplayCents, n5.priceDisplayCents]).toEqual([false, 105000, pub.body.displayPriceCents]);
    expect([n16.fits, n16.maxDisplayCents, n16.priceDisplayCents]).toEqual([true, 116000, pub.body.displayPriceCents]);
    expect(w.mailsTo(at5.email)[0].text).toContain('Está arriba de tu máximo.');
    expect(w.mailsTo(at16.email)[0].text).toContain('Cabe en tu máximo.');
    // la pieza sigue a su precio normal para todos
    expect((await w.h.api('GET', `/catalog/listings/${pieceId}`, { token: at16.token })).body.displayPriceCents).toBe(110200);
  });
});

describe('WSH-T15 — nada se aparta (815)', () => {
  it('dos cuentas, una pieza: ambas `sent`; paga una; el deseo de la otra sigue; 0 escrituras en InventoryItem/Order desde wishlist/', async () => {
    const a = await w.customer();
    const b = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 10);
    const wishB = await want(b, c.id, 10);
    const pieceId = await w.piece(c.id, { listCents: 90000 });
    await tick();
    const ns = await w.h.prisma.wishlistNotice.findMany({ where: { inventoryItemId: pieceId } });
    expect(ns.map((n) => n.status).sort()).toEqual(['sent', 'sent']);
    expect((await w.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: pieceId } })).status).toBe('listed');
    // paga A (checkout real + webhook firmado)
    const s = await w.h.api('POST', '/checkout/session', { token: a.token, json: { inventoryItemIds: [pieceId] } });
    expect(s.status).toBe(201);
    const order = await w.h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
    const wh = await w.h.sendStripeWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: order.stripePaymentIntentId, object: 'payment_intent', amount: order.totalCents, amount_received: order.totalCents, currency: 'mxn' } },
    });
    expect(wh.status).toBe(200);
    expect(await w.h.prisma.wishlistItem.count({ where: { id: wishB } })).toBe(1);
    expect((await w.h.prisma.wishlistNotice.findFirstOrThrow({ where: { userId: b.id, inventoryItemId: pieceId } })).status).toBe('sent');

    // censo: el módulo `wishlist` no escribe InventoryItem, Order ni Stripe
    const dir = join(__dirname, '..', '..', 'src', 'modules', 'wishlist');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/\b(inventoryItem|order|orderItem|payment\w*)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
      expect(src).not.toMatch(/UPDATE\s+"(InventoryItem|Order)"|INSERT\s+INTO\s+"(InventoryItem|Order)"/i);
      expect(src).not.toMatch(/StripeService|from 'stripe'/);
    }
  });
});

describe('WSH-T16 — se quita sola al pagar, por las DOS liquidaciones (816)', () => {
  it('bóveda: el deseo de esa carta y acabado desaparece; el de otro acabado se queda', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    const wished = await want(a, c.id, 10);
    const otherFinish = await want(a, c.id, 10, 'reverse_holo');
    const pieceId = await w.piece(c.id, { listCents: 90000 });
    const s = await w.h.api('POST', '/checkout/session', { token: a.token, json: { inventoryItemIds: [pieceId] } });
    expect(s.status).toBe(201);
    const order = await w.h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
    const wh = await w.h.sendStripeWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: order.stripePaymentIntentId, object: 'payment_intent', amount: order.totalCents, amount_received: order.totalCents, currency: 'mxn' } },
    });
    expect(wh.status).toBe(200);
    expect((await w.h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('settled');
    expect(await w.h.prisma.wishlistItem.count({ where: { id: wished } })).toBe(0);
    expect(await w.h.prisma.wishlistItem.count({ where: { id: otherFinish } })).toBe(1);
  });

  it('envío directo: el deseo desaparece', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    const wished = await want(a, c.id, 10);
    const pi = `pi_wsh_${randomUUID().replace(/-/g, '')}`;
    const order = await w.h.prisma.order.create({
      data: {
        userId: a.id,
        fulfillmentMode: 'direct_ship',
        // un pedido de envío directo con cuenta (p. ej. reclamado antes de que llegara el webhook); el CHECK exige domicilio
        shippingAddressSnapshot: { street: 'Calle 1', postalCode: '01000' },
        status: 'pending',
        subtotalCents: 104400,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents: 104400,
        priceConvention: 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
      },
    });
    const pieceId = await w.piece(c.id, { status: 'reserved', reservedByOrderId: order.id, listCents: 90000 });
    await w.h.prisma.orderItem.create({
      data: { orderId: order.id, inventoryItemId: pieceId, cardSnapshot: {}, unitPriceCents: 104400, finish: 'normal' },
    });
    const wh = await w.h.sendStripeWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: pi, object: 'payment_intent', amount: 104400, amount_received: 104400, currency: 'mxn' } },
    });
    expect(wh.status).toBe(200);
    expect((await w.h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('settled');
    expect(await w.h.prisma.wishlistItem.count({ where: { id: wished } })).toBe(0);
  });
});

describe('WSH-T24 (e2e) — el planificador del AppModule real tiene y enruta los dos jobs (823)', () => {
  it('`process({name:"wishlist-notify"})` corre el job (deja `sent` lo pendiente) y `sealed-restock-notify` responde', async () => {
    const sched = w.h.app.get(SchedulerService);
    const fields = sched as unknown as Record<string, unknown>;
    expect(fields.wishlistNotify).toBeDefined();
    expect(fields.sealedRestockNotify).toBeDefined();
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 10);
    await w.piece(c.id, { listCents: 90000 });
    await sched.process({ name: 'wishlist-notify' });
    w.clock.advance(31 * MIN);
    const res = (await sched.process({ name: 'wishlist-notify' })) as any;
    expect(res.job).toBe('wishlist-notify');
    expect(w.mailsTo(a.email)).toHaveLength(1);
    const r2 = (await sched.process({ name: 'sealed-restock-notify' })) as any;
    expect(r2.job).toBe('sealed-restock-notify');
  });

  it('disparo manual: operador ⇒ 403; súper-admin ⇒ 200 auditado', async () => {
    const op = await w.h.api('POST', '/admin/jobs/wishlist-notify', { token: w.operatorToken, json: {} });
    expect(op.status).toBe(403);
    const since = new Date();
    const r = await w.runNotify();
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['detected', 'enqueued', 'job', 'sent', 'skipped', 'waiting'].sort());
    const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'jobs.wishlist_notify.run', createdAt: { gte: since } } });
    expect(log).toEqual(expect.objectContaining({ entityType: 'Job', entityId: 'wishlist-notify' }));
  });
});
