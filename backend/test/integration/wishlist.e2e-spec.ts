/**
 * wishlist.e2e-spec.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.4 / §WSH.6): las rutas del CLIENTE contra la app REAL y
 * Postgres real. Propiedad: backend. Arnés propio: `helpers/wishlist-db.ts`.
 *
 *  WSH-T1 (800, 801) · T2 (802) · T3 (803, carrera N=10 con proporción) · T4 (804) · T5 (805) · T7 (807) · T8 (808, la
 *  parte de la lista y del dial) · T12 (812) · T14 (814) · T29 (dial off) · T31 (preview) · T32 (ivaRatePct) · T33
 *  (`availableNow.fits`) · T34 (mail-actions con el dial off) · T37 (carta sin piezas).
 */
import { createWshWorld, WshCard, WshPerson, WshWorld } from './helpers/wishlist-db';

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

const post = (p: WshPerson | null, json: unknown) => w.h.api('POST', '/wishlist', { token: p?.token, json });
const list = (p: WshPerson) => w.h.api('GET', '/wishlist', { token: p.token });

describe('WSH-T1 — el servidor no se deja engañar (800, 801)', () => {
  it('maxPct ∉ {5,10,16} ⇒ 400; acabado ajeno ⇒ 422 FINISH_NOT_AVAILABLE; precio o condición en el cuerpo ⇒ 400; 0 filas', async () => {
    const a = await w.customer();
    const c = await w.card({ finishes: ['normal'] });
    for (const maxPct of [0, 7, 15, 20, '10', null]) {
      const r = await post(a, { cardId: c.id, finish: 'normal', maxPct });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(r.body.error.details.field).toBe('maxPct');
    }
    const fin = await post(a, { cardId: c.id, finish: 'reverse_holo', maxPct: 10 });
    expect(fin.status).toBe(422);
    expect(fin.body.error.code).toBe('FINISH_NOT_AVAILABLE');
    for (const [extra, value] of [['maxPriceCents', 120000], ['condition', 'NM']] as const) {
      const r = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10, [extra]: value });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(r.body.error.details.field).toBe(extra);
    }
    const nf = await post(a, { cardId: '00000000-0000-0000-0000-000000000000', finish: 'normal', maxPct: 10 });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    expect(await w.h.prisma.wishlistItem.count({ where: { userId: a.id } })).toBe(0);
  });

  it('PATCH con un % ajeno o un campo extra ⇒ 400 y el deseo intacto', async () => {
    const a = await w.customer();
    const c = await w.card();
    const ok = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect(ok.status).toBe(201);
    const bad = await w.h.api('PATCH', `/wishlist/${ok.body.id}`, { token: a.token, json: { maxPct: 12 } });
    expect(bad.status).toBe(400);
    const extra = await w.h.api('PATCH', `/wishlist/${ok.body.id}`, { token: a.token, json: { maxPct: 16, finish: 'reverse_holo' } });
    expect(extra.status).toBe(400);
    expect((await w.h.prisma.wishlistItem.findUniqueOrThrow({ where: { id: ok.body.id } })).maxPct).toBe(10);
  });
});

describe('WSH-T2 — sin sesión ⇒ 401 en las seis rutas con sesión (802)', () => {
  it('GET, preview, POST, PATCH, DELETE, PUT alerts', async () => {
    const c = await w.card();
    const calls = [
      w.h.api('GET', '/wishlist'),
      w.h.api('GET', `/wishlist/preview?cardId=${c.id}`),
      w.h.api('POST', '/wishlist', { json: { cardId: c.id, finish: 'normal', maxPct: 10 } }),
      w.h.api('PATCH', '/wishlist/x', { json: { maxPct: 10 } }),
      w.h.api('DELETE', '/wishlist/x'),
      w.h.api('PUT', '/wishlist/alerts', { json: { paused: true } }),
    ];
    for (const r of await Promise.all(calls)) expect(r.status).toBe(401);
  });
});

describe('WSH-T3 — tope por cuenta (803)', () => {
  let cards: WshCard[];
  beforeAll(async () => {
    cards = [];
    for (let i = 0; i < 23; i += 1) cards.push(await w.card({ finishes: ['normal'] }));
  });

  it('21.º ⇒ 422 WISHLIST_LIMIT_REACHED {limit:20,count:20}; borrar uno ⇒ cabe', async () => {
    const a = await w.customer();
    for (let i = 0; i < 20; i += 1) expect((await post(a, { cardId: cards[i].id, finish: 'normal', maxPct: 10 })).status).toBe(201);
    const r = await post(a, { cardId: cards[20].id, finish: 'normal', maxPct: 10 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('WISHLIST_LIMIT_REACHED');
    expect(r.body.error.details).toEqual({ limit: 20, count: 20 });
    const one = await w.h.prisma.wishlistItem.findFirstOrThrow({ where: { userId: a.id } });
    expect((await w.h.api('DELETE', `/wishlist/${one.id}`, { token: a.token })).status).toBe(204);
    expect((await post(a, { cardId: cards[20].id, finish: 'normal', maxPct: 10 })).status).toBe(201);
    const l = await list(a);
    expect(l.body.count).toBe(20);
    expect(l.body.limit).toBe(20);
  });

  it('bajar el dial no borra deseos; el tope sale del dial', async () => {
    const a = await w.customer();
    for (let i = 0; i < 3; i += 1) await post(a, { cardId: cards[i].id, finish: 'normal', maxPct: 5 });
    await w.setDial('wishlist_max_per_account', 2);
    const r = await post(a, { cardId: cards[3].id, finish: 'normal', maxPct: 5 });
    expect(r.status).toBe(422);
    expect(r.body.error.details).toEqual({ limit: 2, count: 3 });
    expect(await w.h.prisma.wishlistItem.count({ where: { userId: a.id } })).toBe(3);
  });

  it('carrera: dos POST simultáneos con 19 deseos ⇒ exactamente uno gana — N=10 rondas, proporción 10/10', async () => {
    const N = 10;
    let exactlyOne = 0;
    const outcomes: string[] = [];
    for (let round = 0; round < N; round += 1) {
      const a = await w.customer();
      await w.h.prisma.wishlistItem.createMany({
        data: cards.slice(0, 19).map((c) => ({ userId: a.id, cardId: c.id, finish: 'normal' as const, maxPct: 10 })),
      });
      const [r1, r2] = await Promise.all([
        post(a, { cardId: cards[19].id, finish: 'normal', maxPct: 10 }),
        post(a, { cardId: cards[20].id, finish: 'normal', maxPct: 10 }),
      ]);
      const st = [r1.status, r2.status].sort();
      outcomes.push(st.join('/'));
      const n = await w.h.prisma.wishlistItem.count({ where: { userId: a.id } });
      if (st[0] === 201 && st[1] === 422 && n === 20) exactlyOne += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`WSH-T3 carrera: ${exactlyOne}/${N} rondas con exactamente un ganador (${outcomes.join(', ')})`);
    expect(exactlyOne).toBe(N);
  });
});

describe('WSH-T4 — mismo acabado no se duplica; otro acabado sí (804)', () => {
  it('409 WISHLIST_DUPLICATE {wishlistItemId, maxPct}; otro acabado ⇒ 201', async () => {
    const a = await w.customer();
    const c = await w.card();
    const first = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect(first.status).toBe(201);
    const dup = await post(a, { cardId: c.id, finish: 'normal', maxPct: 16 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('WISHLIST_DUPLICATE');
    expect(dup.body.error.details).toEqual({ wishlistItemId: first.body.id, maxPct: 10 });
    expect((await post(a, { cardId: c.id, finish: 'reverse_holo', maxPct: 16 })).status).toBe(201);
  });

  it('carrera del doble alta del MISMO acabado ⇒ un 201 y un 409 (el único de BD, P2002)', async () => {
    const a = await w.customer();
    const c = await w.card();
    const [r1, r2] = await Promise.all([
      post(a, { cardId: c.id, finish: 'normal', maxPct: 10 }),
      post(a, { cardId: c.id, finish: 'normal', maxPct: 10 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
  });
});

describe('WSH-T5 — una cuenta no ve ni toca la lista de otra (805)', () => {
  it('B: GET no ve; PATCH/DELETE de un id de A ⇒ 404 NOT_FOUND y A intacta', async () => {
    const a = await w.customer();
    const b = await w.customer();
    const c = await w.card();
    const mine = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect((await list(b)).body.items).toEqual([]);
    const p = await w.h.api('PATCH', `/wishlist/${mine.body.id}`, { token: b.token, json: { maxPct: 16 } });
    expect(p.status).toBe(404);
    expect(p.body.error.code).toBe('NOT_FOUND');
    const d = await w.h.api('DELETE', `/wishlist/${mine.body.id}`, { token: b.token });
    expect(d.status).toBe(404);
    const row = await w.h.prisma.wishlistItem.findUniqueOrThrow({ where: { id: mine.body.id } });
    expect(row.maxPct).toBe(10);
  });

  it('GET: forma de la respuesta, orden createdAt desc, PATCH cambia el %', async () => {
    const a = await w.customer();
    const c1 = await w.card();
    const c2 = await w.card();
    await w.market(c1.id, 'normal', 100000);
    const r1 = await post(a, { cardId: c1.id, finish: 'normal', maxPct: 10 });
    await new Promise((r) => setTimeout(r, 15));
    await post(a, { cardId: c2.id, finish: 'normal', maxPct: 5 });
    const l = await list(a);
    expect(l.status).toBe(200);
    expect(Object.keys(l.body).sort()).toEqual(['alertsPaused', 'count', 'emailVerified', 'items', 'ivaMode', 'ivaRatePct', 'limit'].sort());
    expect(l.body.items.map((i: any) => i.card.id)).toEqual([c2.id, c1.id]);
    const it1 = l.body.items[1];
    expect(Object.keys(it1).sort()).toEqual(['availableNow', 'card', 'createdAt', 'finish', 'id', 'lastNotifiedAt', 'maxPct', 'maxToday'].sort());
    expect(it1.card).toEqual({ id: c1.id, name: c1.name, setName: w.setName, number: c1.number, imageSmallUrl: expect.any(String) });
    expect(it1.maxToday).toEqual({ status: 'priced', maxDisplayCents: 110000, approximate: true });
    const p = await w.h.api('PATCH', `/wishlist/${r1.body.id}`, { token: a.token, json: { maxPct: 16 } });
    expect(p.status).toBe(200);
    expect(p.body.maxPct).toBe(16);
    expect(p.body.maxToday).toEqual({ status: 'priced', maxDisplayCents: 116000, approximate: true });
  });
});

describe('WSH-T7 — sin mercado no hay máximo (807)', () => {
  it('variante pendiente ⇒ maxToday {status:"no_market"} sin clave de cifra', async () => {
    const a = await w.customer();
    const c = await w.card();
    const r = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect(r.status).toBe(201);
    expect(r.body.maxToday).toEqual({ status: 'no_market' });
    expect('maxDisplayCents' in r.body.maxToday).toBe(false);
    const l = await list(a);
    expect(l.body.items[0].maxToday).toEqual({ status: 'no_market' });
  });
});

describe('WSH-T8 — el IVA del máximo es un dial (808)', () => {
  it('with_iva ⇒ 110000; PUT a without_iva ⇒ 127600 en la lista; operador ⇒ 403 MONEY_OUT_FORBIDDEN; auditado', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect((await list(a)).body.items[0].maxToday.maxDisplayCents).toBe(110000);
    expect((await list(a)).body.ivaMode).toBe('with_iva');

    const denied = await w.h.api('PUT', '/admin/settings', { token: w.operatorToken, json: { wishlistMaxIvaMode: 'without_iva' } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
    const asCustomer = await w.h.api('PUT', '/admin/settings', { token: a.token, json: { wishlistMaxIvaMode: 'without_iva' } });
    expect(asCustomer.status).toBe(403);

    const since = new Date();
    const ok = await w.h.api('PUT', '/admin/settings', { token: w.adminToken, json: { wishlistMaxIvaMode: 'without_iva' } });
    expect(ok.status).toBe(200);
    const after = await list(a);
    expect(after.body.ivaMode).toBe('without_iva');
    expect(after.body.items[0].maxToday.maxDisplayCents).toBe(127600);
    const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'settings.update', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } });
    expect(log?.after).toEqual(expect.objectContaining({ wishlistMaxIvaMode: 'without_iva' }));

    const bad = await w.h.api('PUT', '/admin/settings', { token: w.adminToken, json: { wishlistMaxIvaMode: 'con_iva' } });
    expect(bad.status).toBe(422);
    const get = await w.h.api('GET', '/admin/settings', { token: w.adminToken });
    for (const k of ['wishlistEnabled', 'wishlistMaxPerAccount', 'wishlistMaxIvaMode', 'wishlistDailyMailCap', 'wishlistMailWindowMin', 'wishlistTargetMarginPct', 'wishlistMarginBasis', 'sealedRestockMaxPendingPerEmail'])
      expect(get.body).toHaveProperty(k);
  });
});

describe('WSH-T12 — deseo de algo que ya está a la venta (812)', () => {
  it('fila `suppressed` en la misma alta y 0 correos al correr el job', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    const pieceId = await w.piece(c.id, { listCents: 100000 });
    const r = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect(r.status).toBe(201);
    const n = await w.h.prisma.wishlistNotice.findUniqueOrThrow({ where: { userId_inventoryItemId: { userId: a.id, inventoryItemId: pieceId } } });
    expect(n.status).toBe('suppressed');
    expect(n.resolvedAt).not.toBeNull();
    w.clock.advance(24 * 3600_000);
    expect((await w.runNotify()).status).toBe(200);
    expect(w.mailsTo(a.email)).toHaveLength(0);
  });
});

describe('WSH-T14 / T34 — enlaces del correo sin sesión (814), también con el dial apagado', () => {
  async function mailedWorld() {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    const wish = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    await w.piece(c.id, { listCents: 90000 });
    w.clock.advance(3600_000);
    await w.runNotify(); // detecta
    w.clock.advance(3600_000);
    await w.runNotify(); // ventana vencida ⇒ envía
    const mails = w.mailsTo(a.email);
    expect(mails).toHaveLength(1);
    const links = [...mails[0].text.matchAll(/lista-de-deseos\/aviso\?a=(\w+)&id=([\w-]+)&t=([\w-]+)/g)].map((m) => ({ a: m[1], id: m[2], t: m[3] }));
    const remove = links.find((l) => l.a === 'remove')!;
    const pause = links.find((l) => l.a === 'pause')!;
    expect(remove.id).toBe(wish.body.id);
    return { a, wishId: wish.body.id as string, remove, pause };
  }

  it('T14: remove y pause con token válido, sin sesión; alterado o ajeno ⇒ 404 WISHLIST_LINK_INVALID; GET ⇒ 404/405', async () => {
    const { a, wishId, remove, pause } = await mailedWorld();
    const other = await mailedWorld();
    const act = (json: unknown) => w.h.api('POST', '/wishlist/mail-actions', { json });

    const altered = await act({ action: 'remove', id: remove.id, token: remove.t.slice(0, -2) + (remove.t.endsWith('AA') ? 'BB' : 'AA') });
    expect(altered.status).toBe(404);
    expect(altered.body.error.code).toBe('WISHLIST_LINK_INVALID');
    // id de OTRA cuenta con el token de la propia
    const foreign = await act({ action: 'remove', id: other.remove.id, token: remove.t });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('WISHLIST_LINK_INVALID');
    // acción cruzada: el token de `pause` no sirve para `remove`
    const crossed = await act({ action: 'remove', id: pause.id, token: pause.t });
    expect(crossed.status).toBe(404);
    expect(await w.h.prisma.wishlistItem.count({ where: { id: { in: [wishId, other.wishId] } } })).toBe(2);

    const bad = await act({ action: 'delete', id: remove.id, token: remove.t });
    expect(bad.status).toBe(400);

    const ok = await act({ action: 'remove', id: remove.id, token: remove.t });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ result: 'removed' });
    expect(await w.h.prisma.wishlistItem.count({ where: { id: wishId } })).toBe(0);
    expect((await act({ action: 'remove', id: remove.id, token: remove.t })).body).toEqual({ result: 'already_done' });

    const p = await act({ action: 'pause', id: pause.id, token: pause.t });
    expect(p.status).toBe(200);
    expect(p.body).toEqual({ result: 'paused' });
    expect((await w.h.prisma.user.findUniqueOrThrow({ where: { id: a.id } })).wishlistAlertsPausedAt).not.toBeNull();
    expect((await act({ action: 'pause', id: pause.id, token: pause.t })).body).toEqual({ result: 'already_done' });
    // la lista de la OTRA cuenta sigue intacta
    expect(await w.h.prisma.wishlistItem.count({ where: { id: other.wishId } })).toBe(1);

    const g = await w.h.api('GET', `/wishlist/mail-actions?action=remove&id=${remove.id}&t=${remove.t}`);
    expect([404, 405]).toContain(g.status);

    // reanudar desde «Mi cuenta»
    const resume = await w.h.api('PUT', '/wishlist/alerts', { token: a.token, json: { paused: false } });
    expect(resume.status).toBe(200);
    expect(resume.body).toEqual({ alertsPaused: false });
    expect((await list(a)).body.alertsPaused).toBe(false);
  });

  it('T34: con `wishlistEnabled = off`, remove y pause siguen funcionando; GET /wishlist ⇒ 404 FEATURE_DISABLED; 0 correos', async () => {
    const { a, wishId, remove, pause } = await mailedWorld();
    w.mail.reset();
    await w.setDial('wishlist_enabled', 'off');
    const g = await list(a);
    expect(g.status).toBe(404);
    expect(g.body.error.code).toBe('FEATURE_DISABLED');
    const r = await w.h.api('POST', '/wishlist/mail-actions', { json: { action: 'remove', id: remove.id, token: remove.t } });
    expect(r.status).toBe(200);
    expect(r.body.result).toBe('removed');
    expect(await w.h.prisma.wishlistItem.count({ where: { id: wishId } })).toBe(0);
    const p = await w.h.api('POST', '/wishlist/mail-actions', { json: { action: 'pause', id: pause.id, token: pause.t } });
    expect(p.status).toBe(200);
    expect(p.body.result).toBe('paused');
    expect(w.mail.sent).toHaveLength(0);
  });
});

describe('WSH-T29 — `wishlistEnabled = off` (seed)', () => {
  it('las seis rutas con sesión ⇒ 404 FEATURE_DISABLED; el job es no-op', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.setDial('wishlist_enabled', 'off');
    const rs = await Promise.all([
      list(a),
      w.h.api('GET', `/wishlist/preview?cardId=${c.id}`, { token: a.token }),
      post(a, { cardId: c.id, finish: 'normal', maxPct: 10 }),
      w.h.api('PATCH', '/wishlist/x', { token: a.token, json: { maxPct: 10 } }),
      w.h.api('DELETE', '/wishlist/x', { token: a.token }),
      w.h.api('PUT', '/wishlist/alerts', { token: a.token, json: { paused: true } }),
    ]);
    for (const r of rs) {
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('FEATURE_DISABLED');
    }
    const job = await w.runNotify();
    expect(job.status).toBe(200);
    expect(job.body).toEqual({ job: 'wishlist-notify', enqueued: false, reason: 'WISHLIST_DISABLED' });
    // la ficha lo dice
    const card = await w.h.api('GET', `/catalog/cards/${c.id}`);
    expect(card.body.wishlistEnabled).toBe(false);
  });
});

describe('WSH-T31 / T32 — preview y `ivaRatePct` (Q-WSH-UX-1/2)', () => {
  it('with_iva 105000/110000/116000; without_iva 121800/127600/134560; pendiente ⇒ no_market; = maxToday del deseo; 0 escrituras', async () => {
    const a = await w.customer();
    const c = await w.card({ finishes: ['normal', 'reverse_holo'] });
    await w.market(c.id, 'normal', 100000);
    const before = [await w.h.prisma.wishlistItem.count(), await w.h.prisma.wishlistNotice.count()];
    const r = await w.h.api('GET', `/wishlist/preview?cardId=${c.id}`, { token: a.token });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toEqual({
      cardId: c.id,
      ivaMode: 'with_iva',
      ivaRatePct: 16,
      finishes: [
        {
          finish: 'normal',
          maxToday: {
            status: 'priced',
            approximate: true,
            tiers: [
              { maxPct: 5, maxDisplayCents: 105000 },
              { maxPct: 10, maxDisplayCents: 110000 },
              { maxPct: 16, maxDisplayCents: 116000 },
            ],
          },
        },
        { finish: 'reverse_holo', maxToday: { status: 'no_market' } },
      ],
    });
    expect([await w.h.prisma.wishlistItem.count(), await w.h.prisma.wishlistNotice.count()]).toEqual(before);
    await w.setDial('wishlist_max_iva_mode', 'without_iva');
    const r2 = await w.h.api('GET', `/wishlist/preview?cardId=${c.id}`, { token: a.token });
    expect(r2.body.finishes[0].maxToday.tiers.map((t: any) => t.maxDisplayCents)).toEqual([121800, 127600, 134560]);
    const saved = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect(saved.body.maxToday.maxDisplayCents).toBe(r2.body.finishes[0].maxToday.tiers[1].maxDisplayCents);
  });

  it('errores: sin cardId ⇒ 400 {field:cardId}; carta inexistente ⇒ 404 NOT_FOUND', async () => {
    const a = await w.customer();
    const r = await w.h.api('GET', '/wishlist/preview', { token: a.token });
    expect(r.status).toBe(400);
    expect(r.body.error.details.field).toBe('cardId');
    const e = await w.h.api('GET', '/wishlist/preview?cardId=', { token: a.token });
    expect(e.status).toBe(400);
    const nf = await w.h.api('GET', '/wishlist/preview?cardId=00000000-0000-0000-0000-000000000000', { token: a.token });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
  });

  it('T32: `ivaRatePct` sigue al dial `iva_pct` en la lista y en el preview', async () => {
    const a = await w.customer();
    const c = await w.card();
    expect((await list(a)).body.ivaRatePct).toBe(16);
    await w.setDial('iva_pct', 8);
    expect((await list(a)).body.ivaRatePct).toBe(8);
    expect((await w.h.api('GET', `/wishlist/preview?cardId=${c.id}`, { token: a.token })).body.ivaRatePct).toBe(8);
  });
});

describe('WSH-T33 — `availableNow.fits` del servidor (Q-WSH-UX-3)', () => {
  it('P 133400 al 16 %: with_iva ⇒ false; without_iva ⇒ true; P = máximo exacto ⇒ true; pendiente ⇒ null; sin piezas ⇒ null', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await post(a, { cardId: c.id, finish: 'normal', maxPct: 16 });
    expect((await list(a)).body.items[0].availableNow).toBeNull();
    await w.piece(c.id, { listCents: 115000 }); // P = 133400
    const l1 = await list(a);
    expect(l1.body.items[0].availableNow).toEqual({ count: 1, fromDisplayCents: 133400, fits: false });
    await w.setDial('wishlist_max_iva_mode', 'without_iva');
    expect((await list(a)).body.items[0].availableNow.fits).toBe(true);
    await w.setDial('wishlist_max_iva_mode', 'with_iva');
    await w.piece(c.id, { listCents: 100000 }); // P = 116000 = máximo exacto al 16 %
    const l2 = await list(a);
    expect(l2.body.items[0].availableNow).toEqual({ count: 2, fromDisplayCents: 116000, fits: true });

    const c2 = await w.card();
    await post(a, { cardId: c2.id, finish: 'normal', maxPct: 16 });
    await w.piece(c2.id, { listCents: 50000 }); // sin mercado pero con precio manual ⇒ vendible
    const row = (await list(a)).body.items.find((i: any) => i.card.id === c2.id);
    expect(row.availableNow).toEqual({ count: 1, fromDisplayCents: 58000, fits: null });
  });
});

describe('WSH-T37 — una carta que no tenemos (Q-WSH-UX-4)', () => {
  it('GET /buylist/cards?q= la encuentra con availableFinishes; la ficha responde 200 con listings [] y wishlistEnabled', async () => {
    const c = await w.card({ finishes: ['normal', 'holofoil'] });
    const s = await w.h.api('GET', `/buylist/cards?q=${encodeURIComponent(c.name)}`);
    expect(s.status).toBe(200);
    const hit = s.body.data.find((x: any) => x.id === c.id);
    expect(hit.availableFinishes).toEqual(['normal', 'holofoil']);
    const f = await w.h.api('GET', `/catalog/cards/${c.id}`);
    expect(f.status).toBe(200);
    expect(f.body.listings).toEqual([]);
    expect(f.body.wishlistEnabled).toBe(true);
  });
});
