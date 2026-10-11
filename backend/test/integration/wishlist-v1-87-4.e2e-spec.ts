/**
 * wishlist-v1-87-4.e2e-spec.ts — errata v1.87.4⟨wishlist⟩ (API_CONTRACT §WSH.13; WSH.7 (g); porqué ARCHITECTURE §4.WSH (m)),
 * contra la app REAL y Postgres real. Propiedad: backend. Arnés: `helpers/wishlist-db.ts` + el helper único del «avísame»
 * (`helpers/restock-subscribe.ts`, el cuerpo de la pantalla `{ email, inventoryItemId }`).
 *
 *  WSH-T44 (823) — el mapeo de las piezas cambia DESPUÉS de apuntarse (escritor medido:
 *            `PUT /admin/pricing/sealed/items/:itemId/mapping`, siempre por HTTP real con súper-admin) y el job
 *            `sealed-restock-notify` re-apunta las pendientes HUÉRFANAS a su destino ÚNICO (`run()` con el reloj inyectado):
 *            (1) mapear con `applyToSiblings`; (2) pieza por pieza; (3) desmapear; (4) re-mapear P1→P2; (5) y (5b) sin correo
 *            falso; (6) ambiguas intactas; (7) choque por correo; (8) notificadas intactas; (9) paridad con M-74 paso (8);
 *            (10) idempotencia y dial `off`. Candado de fuente: `modules/pricing/` no nombra la tabla.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SealedRestockSubscription } from '@prisma/client';
import { createWshWorld, WshWorld } from './helpers/wishlist-db';
import { restockBody, subscribeRestock } from './helpers/restock-subscribe';
import { sealedIdentityKey, SealedRestockNotifyService } from '../../src/modules/catalog/sealed-restock-notify.service';

let w: WshWorld;
const MIN = 60_000;
const GROUP = 3170; // `tcgplayerGroupId` obligatorio al mapear (§M2); su valor no importa aquí.

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

let tcgSeq = 0;
const uniqueTcg = () => {
  tcgSeq += 1;
  return 700000000 + Math.floor(Math.random() * 90000000) + tcgSeq;
};
let mailSeq = 0;
const email = (tag: string) => {
  mailSeq += 1;
  return `t44-${tag}-${mailSeq}-${w.run}@e2e.local`;
};

type Status = 'listed' | 'in_custody' | 'shipped';
/** Una pieza sellada `(cardId, box, mint)`, mapeada a `tcg` o no. */
const sealed = (cardId: string, tcg: number | null, status: Status = 'listed') =>
  w.piece(cardId, {
    productType: 'sealed',
    rawCondition: null,
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    tcgplayerProductId: tcg,
    tcgplayerGroupId: tcg == null ? null : GROUP,
    sealedProductName: `Caja T44 ${w.run}`,
    status,
    listCents: 200000,
  });
const newCard = () => w.card({ finishes: ['normal'] });
const setStatus = (ids: string[], status: Status) => w.h.prisma.inventoryItem.updateMany({ where: { id: { in: ids } }, data: { status } });

/** El escritor medido, por HTTP real con súper-admin (⛔ no por Prisma). */
async function putMapping(itemId: string, tcg: number | null, applyToSiblings = false) {
  const json = tcg == null ? { tcgplayerProductId: null } : { tcgplayerProductId: tcg, tcgplayerGroupId: GROUP, applyToSiblings };
  const r = await w.h.api('PUT', `/admin/pricing/sealed/items/${itemId}/mapping`, { token: w.adminToken, json });
  expect({ status: r.status, id: r.body?.inventoryItemId }).toEqual({ status: 200, id: itemId });
  return r.body as { siblingsUpdated: number };
}

/** `sealed-restock-notify.run()` con el reloj inyectado (`WISHLIST_CLOCK` = `w.clock`). */
const tick = () => w.h.app.get(SealedRestockNotifyService).run();

async function subscribe(mail: string, pieceId: string): Promise<SealedRestockSubscription> {
  const r = await subscribeRestock(w.h, restockBody(mail, pieceId));
  expect({ status: r.status, body: r.body }).toEqual({ status: 202, body: { subscribed: true } });
  const rows = await w.h.prisma.sealedRestockSubscription.findMany({ where: { email: mail }, orderBy: { createdAt: 'desc' } });
  expect(rows.length).toBeGreaterThan(0);
  return rows[0];
}
const row = (id: string) => w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id } });
const keyOfPiece = async (id: string) => sealedIdentityKey(await w.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } }));
const allRows = () => w.h.prisma.sealedRestockSubscription.findMany({ orderBy: { id: 'asc' } });

describe('WSH-T44 — el mapeo cambia después de apuntarse: el job re-apunta las huérfanas (823, v1.87.4 WSH.7 (g))', () => {
  it('(1) mapear con `applyToSiblings`: c: armada ⇒ fila P1 con la clave de la pieza; vuelve + ventana ⇒ 1 correo', async () => {
    const c = await newCard();
    const a = await sealed(c.id, null, 'listed');
    const b = await sealed(c.id, null, 'in_custody');
    const mail = email('siblings');
    const sub = await subscribe(mail, a);
    expect(sub.tcgplayerProductId).toBeNull();
    expect(sealedIdentityKey(sub)).toBe(await keyOfPiece(a));

    await setStatus([a], 'in_custody');
    await tick();
    expect((await row(sub.id)).armedAt).not.toBeNull();

    const P1 = uniqueTcg();
    expect((await putMapping(a, P1, true)).siblingsUpdated).toBe(1);
    await tick();
    const afterMap = await row(sub.id);

    await setStatus([a], 'listed'); // vuelve una pieza
    await tick();
    const afterBack = await row(sub.id);
    const mailsInWindow = w.mailsTo(mail).length;
    w.clock.advance(31 * MIN);
    await tick();
    const m = w.mailsTo(mail);

    // Se mide todo antes de afirmar: un rojo dice de una vez dónde se quedó (sin (g): fila `c:`, sin `matchedAt`, 0 correos).
    expect({
      tcg: afterMap.tcgplayerProductId,
      sameKeyAsPiece: sealedIdentityKey(afterMap) === (await keyOfPiece(b)) && sealedIdentityKey(afterMap) === (await keyOfPiece(a)),
      matched: afterBack.matchedAt != null,
      mailsInWindow,
      mails: m.length,
      link: m[0]?.html.includes(`/es/sellado/${a}`) ?? false,
    }).toEqual({ tcg: P1, sameKeyAsPiece: true, matched: true, mailsInWindow: 0, mails: 1, link: true });
  });

  it('(2) pieza por pieza: con una hermana aún sin mapear la fila queda INTACTA; al mapear la última ⇒ fila P1', async () => {
    const c = await newCard();
    const a = await sealed(c.id, null, 'listed');
    const b = await sealed(c.id, null, 'in_custody');
    const sub = await subscribe(email('one-by-one'), a);
    await setStatus([a], 'in_custody');
    await tick();
    const armed = await row(sub.id);
    expect(armed.armedAt).not.toBeNull();

    const P1 = uniqueTcg();
    await putMapping(a, P1); // sin hermanas
    await tick();
    expect(await row(sub.id)).toEqual(armed); // `c:`, mismo `armedAt`

    await putMapping(b, P1);
    await tick();
    expect((await row(sub.id)).tcgplayerProductId).toBe(P1);
  });

  it('(3) desmapear todas: fila p:P1 ⇒ c: (tcgplayerProductId nulo); agotarse y volver ⇒ 1 correo', async () => {
    const c = await newCard();
    const P1 = uniqueTcg();
    const a = await sealed(c.id, P1, 'listed');
    const b = await sealed(c.id, P1, 'in_custody');
    const mail = email('unmap');
    const sub = await subscribe(mail, a);
    expect(sub.tcgplayerProductId).toBe(P1);

    await putMapping(a, null);
    await putMapping(b, null);
    await tick();
    const afterUnmap = await row(sub.id);

    await setStatus([a], 'in_custody');
    await tick();
    const armed = (await row(sub.id)).armedAt != null;
    await setStatus([a], 'listed');
    await tick();
    w.clock.advance(31 * MIN);
    await tick();
    const m = w.mailsTo(mail);
    expect({ tcg: afterUnmap.tcgplayerProductId, key: sealedIdentityKey(afterUnmap), armed, mails: m.length, link: m[0]?.html.includes(`/es/sellado/${a}`) ?? false }).toEqual({
      tcg: null,
      key: await keyOfPiece(a),
      armed: true,
      mails: 1,
      link: true,
    });
  });

  it('(4) re-mapear P1 → P2 en todas ⇒ fila P2', async () => {
    const c = await newCard();
    const P1 = uniqueTcg();
    const P2 = uniqueTcg();
    const a = await sealed(c.id, P1, 'listed');
    const b = await sealed(c.id, P1, 'in_custody');
    const sub = await subscribe(email('remap'), a);
    await putMapping(a, P2);
    await putMapping(b, P2);
    await tick();
    const r = await row(sub.id);
    expect({ tcg: r.tcgplayerProductId, key: sealedIdentityKey(r) }).toEqual({ tcg: P2, key: await keyOfPiece(a) });
  });

  it('(5) sin correo falso, en existencia: mapear con hermanas ⇒ ticks hasta +60 min ⇒ armedAt nulo y 0 correos', async () => {
    const c = await newCard();
    const a = await sealed(c.id, null, 'listed');
    await sealed(c.id, null, 'in_custody');
    const mail = email('instock');
    const sub = await subscribe(mail, a);
    expect((await row(sub.id)).armedAt).toBeNull();
    await putMapping(a, uniqueTcg(), true);
    await tick();
    w.clock.advance(60 * MIN);
    await tick();
    const r = await row(sub.id);
    expect({ armedAt: r.armedAt, mails: w.mailsTo(mail).length }).toEqual({ armedAt: null, mails: 0 });
  });

  it('(5b) sin correo falso, grupo partido: c: armada por su pieza agotada; se mapea a P1 (a la venta) ⇒ armedAt nulo, 0 correos', async () => {
    const c = await newCard();
    const P1 = uniqueTcg();
    const u = await sealed(c.id, null, 'in_custody'); // sin mapear y agotada
    await sealed(c.id, P1, 'listed'); // ya mapeada, a la venta
    const mail = email('split');
    const sub = await subscribe(mail, u);
    await tick();
    expect((await row(sub.id)).armedAt).not.toBeNull(); // correcto: su clave `c:` está agotada

    await putMapping(u, P1);
    await tick();
    const afterMap = await row(sub.id);
    for (let i = 0; i < 4; i += 1) {
      w.clock.advance(15 * MIN);
      await tick();
    }
    expect({ tcg: afterMap.tcgplayerProductId, armedAt: afterMap.armedAt, matchedAt: afterMap.matchedAt, mails: w.mailsTo(mail).length }).toEqual({
      tcg: P1,
      armedAt: null,
      matchedAt: null,
      mails: 0,
    });
  });

  it('(6) ambiguas intactas: c: con P1 y P2; c: sin piezas; p:P1 con piezas NULL y P2 ⇒ byte a byte iguales', async () => {
    // (6a) huérfana `c:` cuyo (C, box) queda con piezas en P1 y P2.
    const c1 = await newCard();
    const P1 = uniqueTcg();
    const P2 = uniqueTcg();
    await sealed(c1.id, P1, 'in_custody');
    const u1 = await sealed(c1.id, null, 'in_custody');
    const s1 = await subscribe(email('amb-mix'), u1);
    // (6b) huérfana `c:` sin ninguna pieza (borradas).
    const c2 = await newCard();
    const u2 = await sealed(c2.id, null, 'in_custody');
    const s2 = await subscribe(email('amb-none'), u2);
    // (6c) huérfana `p:P1` con piezas NULL y P3 en su (C, box).
    const c3 = await newCard();
    const P3a = uniqueTcg();
    const P3b = uniqueTcg();
    const a3 = await sealed(c3.id, P3a, 'in_custody');
    await sealed(c3.id, P3b, 'in_custody');
    const s3 = await subscribe(email('amb-null'), a3);
    expect(s3.tcgplayerProductId).toBe(P3a);

    await tick(); // las tres se arman (agotadas): el estado que se congela
    const before = { a: await row(s1.id), b: await row(s2.id), c: await row(s3.id) };
    expect([before.a.armedAt, before.b.armedAt, before.c.armedAt].every((x) => x != null)).toBe(true);

    await putMapping(u1, P2);
    await w.h.prisma.inventoryItem.delete({ where: { id: u2 } });
    await putMapping(a3, null);
    w.clock.advance(5 * MIN);
    await tick();
    expect({ a: await row(s1.id), b: await row(s2.id), c: await row(s3.id) }).toEqual(before);
  });

  it('(7) choque por correo: la re-apuntada que duplica a una pendiente del mismo correo se borra; otra persona no cuenta', async () => {
    // (7a) Y = p:P1 pendiente y X = c:C:box pendiente del mismo correo; se mapea todo a P1.
    const c = await newCard();
    const P1 = uniqueTcg();
    const u = await sealed(c.id, null, 'in_custody');
    const m = await sealed(c.id, P1, 'in_custody');
    const mail = email('clash');
    const Y = await subscribe(mail, m);
    const X = await subscribe(mail, u);
    expect([sealedIdentityKey(Y), sealedIdentityKey(X)]).toEqual([await keyOfPiece(m), `c:${c.id}:box:mint`]);
    await tick(); // ambas armadas
    const yBefore = await row(Y.id);
    expect(yBefore.armedAt).not.toBeNull();

    await putMapping(u, P1);
    w.clock.advance(5 * MIN);
    await tick();
    const pendingK = (await w.h.prisma.sealedRestockSubscription.findMany({ where: { email: mail, notifiedAt: null } })).filter(
      (s) => sealedIdentityKey(s) === `p:${P1}:mint`,
    );
    expect({
      pendingWithK: pendingK.map((s) => ({ id: s.id, armedAt: s.armedAt })),
      xExists: (await w.h.prisma.sealedRestockSubscription.count({ where: { id: X.id } })) > 0,
    }).toEqual({ pendingWithK: [{ id: Y.id, armedAt: yBefore.armedAt }], xExists: false });

    // (7b) dos huérfanas p:P1 y p:P2 del mismo correo, mismo (C, box, mint), desmapeadas ⇒ queda la de menor (createdAt, id);
    // otra persona con la misma clave sigue.
    const c2 = await newCard();
    const Q1 = uniqueTcg();
    const Q2 = uniqueTcg();
    const q1 = await sealed(c2.id, Q1, 'in_custody');
    const q2 = await sealed(c2.id, Q2, 'in_custody');
    const mail2 = email('clash-self');
    const other = email('clash-other');
    const r1 = await subscribe(mail2, q1);
    const r2 = await subscribe(mail2, q2);
    const o = await subscribe(other, q1);
    const keep = [r1, r2].sort((p, q) => p.createdAt.getTime() - q.createdAt.getTime() || (p.id < q.id ? -1 : 1))[0];
    await putMapping(q1, null);
    await putMapping(q2, null);
    await tick();
    const left = await w.h.prisma.sealedRestockSubscription.findMany({ where: { email: mail2, notifiedAt: null } });
    const oRow = await w.h.prisma.sealedRestockSubscription.findUnique({ where: { id: o.id } });
    expect({
      left: left.map((s) => ({ id: s.id, key: sealedIdentityKey(s) })),
      other: oRow && sealedIdentityKey(oRow),
    }).toEqual({ left: [{ id: keep.id, key: `c:${c2.id}:box:mint` }], other: `c:${c2.id}:box:mint` });
  });

  it('(8) notificadas intactas: fila con `notifiedAt` y clave huérfana ⇒ byte a byte igual', async () => {
    const c = await newCard();
    const u = await sealed(c.id, null, 'listed');
    const mail = email('notified');
    const sub = await subscribe(mail, u);
    await setStatus([u], 'in_custody');
    await tick();
    await setStatus([u], 'listed');
    await tick();
    w.clock.advance(31 * MIN);
    await tick();
    expect(w.mailsTo(mail)).toHaveLength(1);
    const before = await row(sub.id);
    expect(before.notifiedAt).not.toBeNull();

    await putMapping(u, uniqueTcg(), true); // su clave `c:` queda huérfana con un único destino
    await tick();
    expect(await row(sub.id)).toEqual(before);
  });

  describe('(9) paridad con el paso (8) de M-74 (fixtures de T42 (6))', () => {
    const step8 = () => {
      const sql = readFileSync(join(__dirname, '..', '..', 'prisma', 'migrations', '20261027120000_m74_wishlist', 'migration.sql'), 'utf8');
      const body = sql.split(/^-- \(8\)[^\n]*\n/m)[1];
      expect(body).toBeDefined();
      const statement = body
        .split('\n')
        .filter((l) => !/^\s*--/.test(l))
        .join('\n')
        .trim()
        .replace(/;\s*$/, '');
      expect(statement).toMatch(/^WITH cand AS/);
      return statement;
    };
    const piece = (cardId: string, tcg: number | null, status: Status = 'in_custody') => sealed(cardId, tcg, status);
    // Filas heredadas (nacieron antes de v1.87.3, sin pieza de origen): por Prisma, como en T42 (6).
    const legacy = (cardId: string, notifiedAt: Date | null = null) =>
      w.h.prisma.sealedRestockSubscription.create({
        data: { email: `t44-fill-${w.run}-${randomUUID().slice(0, 6)}@e2e.local`, cardId, sealedSubtype: 'box', tcgplayerProductId: null, sealedCondition: 'mint', notifiedAt },
      });
    async function fixtures() {
      const a = await w.card();
      const tcgA = uniqueTcg();
      await piece(a.id, tcgA, 'listed');
      await piece(a.id, tcgA, 'shipped');
      const b = await w.card();
      await piece(b.id, uniqueTcg());
      await piece(b.id, uniqueTcg());
      const c = await w.card();
      await piece(c.id, uniqueTcg());
      await piece(c.id, null);
      const d = await w.card();
      await piece(d.id, uniqueTcg());
      const e = await w.card();
      return {
        tcgA,
        ids: {
          A: (await legacy(a.id)).id,
          B: (await legacy(b.id)).id,
          C: (await legacy(c.id)).id,
          D: (await legacy(d.id, new Date())).id,
          E: (await legacy(e.id)).id,
        },
      };
    }
    const tcgOf = async (ids: Record<string, string>) =>
      Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, (await row(id)).tcgplayerProductId])));

    it('un tick SIN el SQL del paso (8) deja en cada fila el mismo tcgplayerProductId que el paso (8)', async () => {
      const byTick = await fixtures();
      await tick();
      const tickResult = await tcgOf(byTick.ids);

      const bySql = await fixtures();
      await w.h.prisma.$executeRawUnsafe(step8());
      const sqlResult = await tcgOf(bySql.ids);

      expect({ tick: { ...tickResult, A: tickResult.A === byTick.tcgA }, sql: { ...sqlResult, A: sqlResult.A === bySql.tcgA } }).toEqual({
        tick: { A: true, B: null, C: null, D: null, E: null },
        sql: { A: true, B: null, C: null, D: null, E: null },
      });
    });

    it('sobre filas ya rellenadas por el paso (8), el tick no re-apunta ni desarma ninguna (0 filas escritas por (g))', async () => {
      const f = await fixtures();
      await w.h.prisma.$executeRawUnsafe(step8());
      const before = Object.fromEntries(await Promise.all(Object.entries(f.ids).map(async ([k, id]) => [k, await row(id)])));
      expect(before.A.tcgplayerProductId).toBe(f.tcgA);
      await tick();
      const after = Object.fromEntries(await Promise.all(Object.entries(f.ids).map(async ([k, id]) => [k, await row(id)])));
      // A (producto a la venta) y D (notificada): el tick no las toca en absoluto ⇒ byte a byte. B, C y E: el ARMADO
      // (que no es (g)) les pone `armedAt` porque su clave no está a la venta; todo lo demás, igual.
      const sansArm = (r: SealedRestockSubscription) => ({ ...r, armedAt: undefined });
      expect({
        A: after.A,
        D: after.D,
        B: sansArm(after.B),
        C: sansArm(after.C),
        E: sansArm(after.E),
      }).toEqual({ A: before.A, D: before.D, B: sansArm(before.B), C: sansArm(before.C), E: sansArm(before.E) });
    });
  });

  it('(10a) idempotencia: el segundo tick sin cambios de piezas escribe 0 filas (tabla entera, antes y después)', async () => {
    // Una fila re-apuntada en el primer tick…
    const c1 = await newCard();
    const u = await sealed(c1.id, null, 'in_custody');
    const s1 = await subscribe(email('idem-repoint'), u);
    await tick();
    await putMapping(u, uniqueTcg(), true);
    // …y una p: armada y emparejada (no huérfana, con destino único): (g) no debe tocarla nunca.
    const c2 = await newCard();
    const P = uniqueTcg();
    const p = await sealed(c2.id, P, 'listed');
    await sealed(c2.id, P, 'in_custody');
    const s2 = await subscribe(email('idem-matched'), p);
    await setStatus([p], 'in_custody');
    await tick(); // re-apunta s1; arma s2
    await setStatus([p], 'listed');
    await tick(); // empareja s2
    const mid = { s1: await row(s1.id), s2: await row(s2.id) };
    expect({ s1: mid.s1.tcgplayerProductId != null, s2armed: mid.s2.armedAt != null, s2matched: mid.s2.matchedAt != null }).toEqual({
      s1: true,
      s2armed: true,
      s2matched: true,
    });

    const before = await allRows();
    await tick();
    expect(await allRows()).toEqual(before);
  });

  it('(10b) dial `off`: tras el PUT y run() la fila sigue como estaba (el job no corre)', async () => {
    const c = await newCard();
    const u = await sealed(c.id, null, 'listed');
    await sealed(c.id, null, 'in_custody');
    const sub = await subscribe(email('dial-off'), u);
    const before = await row(sub.id);
    await w.setDial('sealed_restock_alerts', 'off');
    await putMapping(u, uniqueTcg(), true);
    expect(await tick()).toEqual({ job: 'sealed-restock-notify', enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' });
    expect(await row(sub.id)).toEqual(before);
  });

  it('candado de fuente: `backend/src/modules/pricing/` no nombra la tabla de suscripciones (0 apariciones)', () => {
    const root = join(__dirname, '..', '..', 'src', 'modules', 'pricing');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(5);
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((l, i) => ({ f: f.slice(root.length + 1), line: i + 1, l }))
        .filter(({ l }) => /sealedRestockSubscription|SealedRestockSubscription/.test(l)),
    );
    expect(hits.map(({ f, line }) => `${f}:${line}`)).toEqual([]);
  });
});
