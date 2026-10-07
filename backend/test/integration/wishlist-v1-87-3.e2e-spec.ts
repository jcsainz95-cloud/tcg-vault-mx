/**
 * wishlist-v1-87-3.e2e-spec.ts — errata v1.87.3⟨wishlist⟩ (API_CONTRACT §WSH.12; WSH.7 (f), WSH.4 «Se quita sola»), contra la
 * app REAL y Postgres real. Propiedad: backend. Arnés: `helpers/wishlist-db.ts` + el helper único del «avísame»
 * (`helpers/restock-subscribe.ts`).
 *
 *  WSH-T42 (823, B-1 de QA) — «avísame» de sellados con EXACTAMENTE el cuerpo de la pantalla `{ email, inventoryItemId }`, el
 *            `inventoryItemId` leído por HTTP de `GET /catalog/sealed/:id` (`group.representativeItemId`):
 *            (1) producto mapeado y (2) no mapeado, de punta a punta (apuntarse con existencia no avisa; agotarse arma;
 *            volver + ventana ⇒ 1 correo con `/es/sellado/{id vendible}`); (3) «se vendió la última mientras miraba»;
 *            (4) cuerpo viejo ⇒ 400 {field}; (5) pieza inexistente o `raw` ⇒ 202 sin fila; (6) relleno de M-74 paso (8)
 *            (el SQL se lee del propio `migration.sql`).
 *  WSH-T43 (816, M-1 de QA) — pagar la promo / el exclusivo de deck / una pieza con `cardProductId` huérfano / una `graded`
 *            de la carta deseada NO quita el deseo; pagar la pieza de set (`cardProductId` nulo o `set_base`) sí. Por el camino
 *            real de liquidación (checkout + webhook, rama bóveda).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Finish } from '@prisma/client';
import { createWshWorld, WshPerson, WshWorld } from './helpers/wishlist-db';
import { postRestockExpectingRejection, restockBody, subscribeRestock } from './helpers/restock-subscribe';
import { sealedIdentityKey } from '../../src/modules/catalog/sealed-restock-notify.service';

let w: WshWorld;
const MIN = 60_000;

beforeAll(async () => {
  w = await createWshWorld();
});
afterAll(async () => {
  await w?.setDial('sealed_restock_alerts', 'off');
  await w?.close();
});
beforeEach(async () => {
  await w.resetDials();
  await w.setDial('sealed_restock_alerts', 'on');
  w.mail.reset();
});

// ─────────────────────────────────────────────── WSH-T42 ───────────────────────────────────────────────

let prodSeq = 0;
let tcgSeq = 0;
const uniqueTcg = () => {
  tcgSeq += 1;
  return 800000000 + Math.floor(Math.random() * 90000000) + tcgSeq;
};

/** Un producto sellado de una carta nueva: mapeado (`tcgplayerProductId`) o no. */
async function sealedProduct(mapped: boolean) {
  prodSeq += 1;
  const c = await w.card({ finishes: ['normal'] });
  const tcg = mapped ? uniqueTcg() : null;
  const name = `Caja T42 ${w.run} ${prodSeq}`;
  const mk = (status: 'listed' | 'in_custody' | 'shipped' = 'listed', listCents = 200000) =>
    w.piece(c.id, {
      productType: 'sealed',
      rawCondition: null,
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      tcgplayerProductId: tcg,
      sealedProductName: name,
      status,
      listCents,
    });
  return { cardId: c.id, tcg, mk, name };
}

const runJob = async () => {
  const r = await w.h.api('POST', '/admin/jobs/sealed-restock-notify', { token: w.adminToken, json: {} });
  expect(r.status).toBe(202);
  return r.body;
};
const soldOut = (cardId: string) =>
  w.h.prisma.inventoryItem.updateMany({ where: { cardId, status: 'listed' }, data: { status: 'in_custody' } });

/** Lo que hace la ficha: `GET /catalog/sealed/:id` y el `group.representativeItemId` que el formulario manda. */
async function representativeFromScreen(anyListedPieceId: string): Promise<string> {
  const r = await w.h.api('GET', `/catalog/sealed/${anyListedPieceId}`);
  expect(r.status).toBe(200);
  const rep = r.body.group.representativeItemId as string;
  expect(typeof rep).toBe('string');
  return rep;
}

async function keyOfPiece(id: string): Promise<string> {
  const p = await w.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } });
  return sealedIdentityKey(p);
}

describe('WSH-T42 — el «avísame» con el cuerpo de la pantalla avisa de verdad (823, v1.87.3 B-1)', () => {
  for (const mapped of [true, false]) {
    const label = mapped ? '(1) producto MAPEADO' : '(2) producto NO mapeado';
    it(`${label}: con existencia 0 correos; se agota ⇒ arma; vuelve + ventana ⇒ 1 correo al /es/sellado/{id vendible}`, async () => {
      const p = await sealedProduct(mapped);
      const first = await p.mk();
      const rep = await representativeFromScreen(first);
      const email = `t42-${mapped ? 'map' : 'nomap'}-${w.run}@e2e.local`;

      const r = await subscribeRestock(w.h, restockBody(email, rep));
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ subscribed: true });
      const rows = await w.h.prisma.sealedRestockSubscription.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      const sub = rows[0];
      // La invariante de B-1: la fila tiene LA MISMA clave que la pieza (y que el grupo de la ficha).
      expect(sealedIdentityKey(sub)).toBe(await keyOfPiece(rep));
      expect(sub.tcgplayerProductId).toBe(p.tcg);

      // Con existencia: el job (×2, con una hora de por medio) ni arma ni avisa.
      await runJob();
      w.clock.advance(60 * MIN);
      await runJob();
      expect(w.mailsTo(email)).toHaveLength(0);
      expect((await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } })).armedAt).toBeNull();

      // Se agota ⇒ arma.
      await soldOut(p.cardId);
      await runJob();
      expect((await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } })).armedAt).not.toBeNull();
      expect(w.mailsTo(email)).toHaveLength(0);

      // Vuelve ⇒ matchedAt, todavía 0 correos (ventana).
      const back = await p.mk();
      await runJob();
      expect((await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } })).matchedAt).not.toBeNull();
      expect(w.mailsTo(email)).toHaveLength(0);

      // Ventana vencida ⇒ 1 correo con el enlace a la pieza vendible.
      w.clock.advance(31 * MIN);
      await runJob();
      const m = w.mailsTo(email);
      expect(m).toHaveLength(1);
      expect(m[0].html).toContain(`/es/sellado/${back}`);
      expect((await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } })).notifiedAt).not.toBeNull();
    });
  }

  it('(3) «se vendió la última mientras miraba»: la pieza deja de estar `listed` ANTES del POST ⇒ 202, identidad correcta; vuelve ⇒ 1 correo', async () => {
    const p = await sealedProduct(true);
    const only = await p.mk();
    const rep = await representativeFromScreen(only);
    expect(rep).toBe(only);
    // Se vende mientras la persona mira la ficha: la pieza ya no está a la venta (ni es de plataforma).
    await w.h.prisma.inventoryItem.update({ where: { id: only }, data: { status: 'shipped' } });
    const email = `t42-sold-${w.run}@e2e.local`;
    const r = await subscribeRestock(w.h, restockBody(email, rep));
    expect(r.status).toBe(202);
    const rows = await w.h.prisma.sealedRestockSubscription.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    expect(sealedIdentityKey(rows[0])).toBe(await keyOfPiece(only));

    await runJob(); // agotado ⇒ arma
    expect((await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: rows[0].id } })).armedAt).not.toBeNull();
    const back = await p.mk();
    await runJob();
    w.clock.advance(31 * MIN);
    await runJob();
    const m = w.mailsTo(email);
    expect(m).toHaveLength(1);
    expect(m[0].html).toContain(`/es/sellado/${back}`);
  });

  it('(4) el cuerpo viejo ⇒ 400 VALIDATION_ERROR con el campo desconocido; 0 filas', async () => {
    const p = await sealedProduct(true);
    const piece = await p.mk();
    const cases: { json: Record<string, unknown>; field: string[] }[] = [
      // el de la pantalla vieja (`SealedDetailView`/`SealedRestockForm` hasta v1.87.2)
      { json: { email: `t42-old1-${w.run}@e2e.local`, cardId: p.cardId, sealedSubtype: 'box', sealedCondition: 'mint' }, field: ['cardId', 'sealedSubtype', 'sealedCondition'] },
      // el de las pruebas viejas, con la pieza al lado
      { json: { email: `t42-old2-${w.run}@e2e.local`, inventoryItemId: piece, tcgplayerProductId: p.tcg }, field: ['tcgplayerProductId'] },
    ];
    for (const c of cases) {
      const r = await postRestockExpectingRejection(w.h, c.json);
      expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(c.field).toContain(r.body.error.details.field);
      expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email: c.json.email as string } })).toBe(0);
    }
    // `inventoryItemId` ausente o no-uuid ⇒ 400 {field:'inventoryItemId'}
    for (const json of [{ email: `t42-noid-${w.run}@e2e.local` }, { email: `t42-noid-${w.run}@e2e.local`, inventoryItemId: 'no-es-uuid' }]) {
      const r = await postRestockExpectingRejection(w.h, json);
      expect({ status: r.status, field: r.body?.error?.details?.field }).toEqual({ status: 400, field: 'inventoryItemId' });
    }
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email: `t42-noid-${w.run}@e2e.local` } })).toBe(0);
  });

  it('(5) uuid inexistente y la id de una pieza `raw` ⇒ 202 {subscribed:true} neutro, 0 filas', async () => {
    const c = await w.card();
    const raw = await w.piece(c.id, { listCents: 90000 });
    for (const id of [randomUUID(), raw]) {
      const email = `t42-neutral-${w.run}-${id.slice(0, 8)}@e2e.local`;
      const r = await subscribeRestock(w.h, restockBody(email, id));
      expect({ status: r.status, body: r.body }).toEqual({ status: 202, body: { subscribed: true } });
      expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email } })).toBe(0);
    }
  });

  it('(6) relleno de M-74 paso (8): solo las `c:` pendientes de un producto inequívocamente mapeado; idempotente', async () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'migrations', '20261027120000_m74_wishlist', 'migration.sql'),
      'utf8',
    );
    const step8 = sql.split(/^-- \(8\)/m)[1];
    expect(step8).toBeDefined();
    const statement = step8
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n')
      .trim()
      .replace(/;\s*$/, '');
    expect(statement).toMatch(/^WITH cand AS/);

    const piece = (cardId: string, tcg: number | null, status: 'listed' | 'shipped' | 'in_custody' = 'in_custody') =>
      w.piece(cardId, { productType: 'sealed', rawCondition: null, sealedSubtype: 'box', sealedCondition: 'mint', tcgplayerProductId: tcg, status, listCents: 200000 });
    const legacy = (cardId: string, notifiedAt: Date | null = null) =>
      w.h.prisma.sealedRestockSubscription.create({
        data: { email: `t42-fill-${w.run}-${randomUUID().slice(0, 6)}@e2e.local`, cardId, sealedSubtype: 'box', tcgplayerProductId: null, sealedCondition: 'mint', notifiedAt },
      });

    // A: un solo producto mapeado (dos piezas, mismo id) ⇒ rellenada
    const a = await w.card();
    const tcgA = uniqueTcg();
    await piece(a.id, tcgA, 'listed');
    await piece(a.id, tcgA, 'shipped');
    const subA = await legacy(a.id);
    // B: dos productos mapeados distintos del mismo (carta, subtipo) ⇒ intacta
    const b = await w.card();
    await piece(b.id, uniqueTcg());
    await piece(b.id, uniqueTcg());
    const subB = await legacy(b.id);
    // C: un producto mapeado + una pieza NO mapeada del mismo (carta, subtipo) ⇒ intacta
    const c = await w.card();
    await piece(c.id, uniqueTcg());
    await piece(c.id, null);
    const subC = await legacy(c.id);
    // D: ya notificada ⇒ intacta
    const d = await w.card();
    await piece(d.id, uniqueTcg());
    const subD = await legacy(d.id, new Date());
    // E: sin piezas ⇒ intacta
    const e = await w.card();
    const subE = await legacy(e.id);

    await w.h.prisma.$executeRawUnsafe(statement);
    const after = async (id: string) => (await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id } })).tcgplayerProductId;
    expect({
      A: await after(subA.id),
      B: await after(subB.id),
      C: await after(subC.id),
      D: await after(subD.id),
      E: await after(subE.id),
    }).toEqual({ A: tcgA, B: null, C: null, D: null, E: null });
    // el relleno no arma
    expect((await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: subA.id } })).armedAt).toBeNull();

    // segunda corrida ⇒ 0 filas cambiadas
    expect(await w.h.prisma.$executeRawUnsafe(statement)).toBe(0);
  });
});

// ─────────────────────────────────────────────── WSH-T43 ───────────────────────────────────────────────

describe('WSH-T43 — pagar la promo / el exclusivo de deck / una graded NO quita el deseo; la de set sí (816, v1.87.3 M-1)', () => {
  const want = async (p: WshPerson, cardId: string, finish: Finish) => {
    const r = await w.h.api('POST', '/wishlist', { token: p.token, json: { cardId, finish, maxPct: 10 } });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  /** Paga UNA pieza por el camino real: `POST /checkout/session` (rama bóveda) + webhook `payment_intent.succeeded`. */
  const buy = async (p: WshPerson, pieceId: string) => {
    const s = await w.h.api('POST', '/checkout/session', { token: p.token, json: { inventoryItemIds: [pieceId] } });
    expect(s.status).toBe(201);
    const order = await w.h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
    const wh = await w.h.sendStripeWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: order.stripePaymentIntentId, object: 'payment_intent', amount: order.totalCents, amount_received: order.totalCents, currency: 'mxn' } },
    });
    expect(wh.status).toBe(200);
    expect((await w.h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('settled');
  };
  const cardProduct = async (cardId: string, kind: 'promo' | 'deck_exclusive' | 'set_base') => {
    const tcg = uniqueTcg();
    await w.h.prisma.cardProduct.create({ data: { cardId, tcgplayerProductId: tcg, kind, name: `T43 ${kind} ${tcg}`, finishes: ['holofoil'] } });
    return tcg;
  };

  type Case = { name: string; piece: (cardId: string) => Promise<string>; stays: boolean };
  const cases: Case[] = [
    { name: 'raw holofoil de la PROMO', piece: async (cardId) => w.piece(cardId, { finish: 'holofoil', cardProductId: await cardProduct(cardId, 'promo'), listCents: 90000 }), stays: true },
    { name: 'raw holofoil del EXCLUSIVO DE DECK', piece: async (cardId) => w.piece(cardId, { finish: 'holofoil', cardProductId: await cardProduct(cardId, 'deck_exclusive'), listCents: 90000 }), stays: true },
    { name: 'raw holofoil con `cardProductId` SIN fila de CardProduct', piece: (cardId) => w.piece(cardId, { finish: 'holofoil', cardProductId: uniqueTcg(), listCents: 90000 }), stays: true },
    { name: 'GRADED de la carta', piece: (cardId) => w.piece(cardId, { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '10', finish: 'holofoil', listCents: 90000 } as never), stays: true },
    { name: 'raw holofoil de SET (`cardProductId` nulo)', piece: (cardId) => w.piece(cardId, { finish: 'holofoil', cardProductId: null, listCents: 90000 }), stays: false },
    { name: 'raw holofoil de SET (`set_base`)', piece: async (cardId) => w.piece(cardId, { finish: 'holofoil', cardProductId: await cardProduct(cardId, 'set_base'), listCents: 90000 }), stays: false },
  ];

  for (const c of cases) {
    it(`${c.name} ⇒ el deseo (C, holofoil) ${c.stays ? 'SIGUE' : 'DESAPARECE'}`, async () => {
      const a = await w.customer();
      const card = await w.card({ finishes: ['normal', 'holofoil'] });
      await w.market(card.id, 'holofoil', 100000);
      const wished = await want(a, card.id, 'holofoil');
      const pieceId = await c.piece(card.id);
      await buy(a, pieceId);
      expect({ case: c.name, wish: await w.h.prisma.wishlistItem.count({ where: { id: wished } }) }).toEqual({ case: c.name, wish: c.stays ? 1 : 0 });
    });
  }
});
