/**
 * wishlist-v1-87-2.e2e-spec.ts — errata v1.87.2⟨wishlist⟩ (API_CONTRACT §WSH.11; ARCHITECTURE §4.WSH (k)), contra la app
 * REAL y Postgres real. Propiedad: backend. Arnés: `helpers/wishlist-db.ts`.
 *
 *  WSH-T38 (801, punto 1) — un campo desconocido en CADA ruta con cuerpo ⇒ 400 VALIDATION_ERROR {field} y 0 escrituras.
 *                           (El candado de fuente vive en `test/wishlist.source-locks.spec.ts`.)
 *  WSH-T39 (WSH.7 (b), punto 2) — `OptionalSessionGuard`: sesión válida ⇒ correo de la cuenta; sin token, token malo,
 *                           caducado, de refresco, `tv` viejo o cuenta bloqueada ⇒ 202 como invitado (nunca 401); staff sin
 *                           correo ⇒ invitado; el tope de 5 cuenta sobre el correo RESUELTO.
 *  WSH-T40 (815, punto 3) — tipo de borrado de las siete FK de M-74 leído del CATÁLOGO (`pg_constraint`, filtrado por
 *                           `current_schema()`), y borrar una pieza con aviso `sent` funciona (el aviso cae; deseo y correo no).
 *  WSH-T41 (WSH.5, WSH.7 (a), punto 4) — el candado consultivo tomado desde OTRA conexión ⇒ `ALREADY_RUNNING` y 0 escrituras;
 *                           soltado ⇒ corre. Sin carrera: la prueba sostiene el candado mientras dispara el job.
 */
import { randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import { AuthService } from '../../src/modules/auth/auth.service';
import { createWshWorld, WshPerson, WshWorld } from './helpers/wishlist-db';
import { restockBody, RestockBody, subscribeRestock } from './helpers/restock-subscribe';

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
  w.mail.reset();
});

const post = (p: WshPerson | null, json: unknown) => w.h.api('POST', '/wishlist', { token: p?.token, json });

describe('WSH-T38 — cuerpo estricto en las cuatro rutas con cuerpo (801, v1.87.2 punto 1)', () => {
  it('POST /wishlist + maxPriceCents ⇒ 400 {field:maxPriceCents}; 0 filas', async () => {
    const a = await w.customer();
    const c = await w.card();
    const r = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10, maxPriceCents: 120000 });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.field).toBe('maxPriceCents');
    expect(await w.h.prisma.wishlistItem.count({ where: { userId: a.id } })).toBe(0);
  });

  it("PATCH /wishlist/:id {maxPct:10, condition:'LP'} ⇒ 400 {field:condition}; el maxPct guardado no cambia", async () => {
    const a = await w.customer();
    const c = await w.card();
    const ok = await post(a, { cardId: c.id, finish: 'normal', maxPct: 5 });
    expect(ok.status).toBe(201);
    const r = await w.h.api('PATCH', `/wishlist/${ok.body.id}`, { token: a.token, json: { maxPct: 10, condition: 'LP' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.field).toBe('condition');
    expect((await w.h.prisma.wishlistItem.findUniqueOrThrow({ where: { id: ok.body.id } })).maxPct).toBe(5);
  });

  it('PUT /wishlist/alerts {paused:true, userId} ⇒ 400 {field:userId}; wishlistAlertsPausedAt no cambia', async () => {
    const a = await w.customer();
    const other = await w.customer();
    const r = await w.h.api('PUT', '/wishlist/alerts', { token: a.token, json: { paused: true, userId: other.id } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.field).toBe('userId');
    for (const id of [a.id, other.id]) {
      expect((await w.h.prisma.user.findUniqueOrThrow({ where: { id } })).wishlistAlertsPausedAt).toBeNull();
    }
  });

  it('POST /wishlist/mail-actions con token VÁLIDO + userId ⇒ 400 {field:userId}; el deseo sigue', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    const wish = await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 });
    expect(wish.status).toBe(201);
    await w.piece(c.id, { listCents: 90000 });
    w.clock.advance(3600_000);
    await w.runNotify(); // detecta
    w.clock.advance(3600_000);
    await w.runNotify(); // ventana vencida ⇒ envía
    const mails = w.mailsTo(a.email);
    expect(mails).toHaveLength(1);
    const m = [...mails[0].text.matchAll(/lista-de-deseos\/aviso\?a=(\w+)&id=([\w-]+)&t=([\w-]+)/g)].find((x) => x[1] === 'remove')!;
    expect(m[2]).toBe(wish.body.id);
    const r = await w.h.api('POST', '/wishlist/mail-actions', { json: { action: 'remove', id: m[2], token: m[3], userId: a.id } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.field).toBe('userId');
    expect(await w.h.prisma.wishlistItem.count({ where: { id: wish.body.id } })).toBe(1);
    // control: el mismo token SIN el campo extra sí funciona (la prueba no pasa por un token roto)
    const ok = await w.h.api('POST', '/wishlist/mail-actions', { json: { action: 'remove', id: m[2], token: m[3] } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ result: 'removed' });
  });
});

describe('WSH-T39 — `OptionalSessionGuard` en el «avísame» de sellados (WSH.7 (b), v1.87.2 punto 2)', () => {
  let prodSeq = 0;
  async function product() {
    prodSeq += 1;
    const c = await w.card({ finishes: ['normal'] });
    const tcg = 600000000 + Math.floor(Math.random() * 99999999) + prodSeq;
    const pieceId = await w.piece(c.id, {
      productType: 'sealed',
      rawCondition: null,
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      tcgplayerProductId: tcg,
      sealedProductName: `Caja T39 ${w.run} ${prodSeq}`,
      status: 'in_custody',
      listCents: 200000,
    });
    return { cardId: c.id, tcg, pieceId };
  }
  // ⭐ v1.87.3 (B-1 de QA): el cuerpo de la PANTALLA `{ email, inventoryItemId }` por el helper único; las afirmaciones no
  // cambian (la identidad la deriva el servidor de la pieza: mismo `tcgplayerProductId`).
  const subscribe = (b: RestockBody, token?: string) => subscribeRestock(w.h, b, token);
  const body = (email: string, p: { pieceId: string }) => restockBody(email, p.pieceId);
  const otro = () => `otro-${w.run}-${randomBytes(3).toString('hex')}@e2e.local`;
  const rowsOf = (email: string) => w.h.prisma.sealedRestockSubscription.findMany({ where: { email } });

  beforeEach(async () => {
    await w.setDial('sealed_restock_alerts', 'on');
  });

  it('(a) sesión válida de cliente ⇒ fila con el correo de la CUENTA y su userId; dto.email no se guarda', async () => {
    const a = await w.customer();
    const p = await product();
    const victim = otro();
    const r = await subscribe(body(victim, p), a.token);
    expect(r.status).toBe(202);
    expect(await rowsOf(victim)).toHaveLength(0);
    const mine = await rowsOf(a.email);
    expect(mine.map((x) => [x.userId, x.tcgplayerProductId])).toEqual([[a.id, p.tcg]]);
  });

  it('(b) sin token ⇒ dto.email, userId nulo', async () => {
    const p = await product();
    const guest = otro();
    const r = await subscribe(body(guest, p));
    expect(r.status).toBe(202);
    expect((await rowsOf(guest)).map((x) => x.userId)).toEqual([null]);
  });

  it('(c) firma mala, caducado, de refresco, `tv` viejo, cuenta `blocked` ⇒ 202 (nunca 401), guardado como invitado', async () => {
    const jwt = w.h.app.get(JwtService);
    const access = process.env.JWT_ACCESS_SECRET as string;
    const cases: { name: string; make: () => Promise<{ token: string; owner: WshPerson }> }[] = [
      {
        name: 'firma mala',
        make: async () => {
          const a = await w.customer();
          const [h, b] = a.token.split('.');
          const forged = await jwt.signAsync({ sub: a.id, email: a.email, role: 'customer', tv: 0 }, { secret: `${access}-otra`, algorithm: 'HS256' });
          return { token: `${h}.${b}.${forged.split('.')[2]}`, owner: a };
        },
      },
      {
        name: 'caducado',
        make: async () => {
          const a = await w.customer();
          const u = await w.h.prisma.user.findUniqueOrThrow({ where: { id: a.id } });
          const exp = Math.floor(Date.now() / 1000) - 60;
          const token = await jwt.signAsync({ sub: a.id, email: a.email, role: 'customer', tv: u.tokenVersion, exp }, { secret: access, algorithm: 'HS256' });
          return { token, owner: a };
        },
      },
      {
        name: 'de refresco (`typ`)',
        make: async () => {
          const a = await w.customer();
          const u = await w.h.prisma.user.findUniqueOrThrow({ where: { id: a.id } });
          // Firmado con el secreto de ACCESO a propósito: solo `typ` lo distingue (si no, lo rechazaría la firma).
          const token = await jwt.signAsync({ sub: a.id, email: a.email, role: 'customer', tv: u.tokenVersion, typ: 'refresh' }, { secret: access, algorithm: 'HS256', expiresIn: '15m' });
          return { token, owner: a };
        },
      },
      {
        name: '`tv` viejo',
        make: async () => {
          const a = await w.customer();
          await w.h.prisma.user.update({ where: { id: a.id }, data: { tokenVersion: { increment: 1 } } });
          return { token: a.token, owner: a };
        },
      },
      {
        name: 'cuenta blocked',
        make: async () => {
          const a = await w.customer();
          await w.h.prisma.user.update({ where: { id: a.id }, data: { status: UserStatus.blocked } });
          return { token: a.token, owner: a };
        },
      },
    ];
    const seen: string[] = [];
    for (const c of cases) {
      const { token, owner } = await c.make();
      const p = await product();
      const guest = otro();
      const r = await subscribe(body(guest, p), token);
      seen.push(`${c.name}:${r.status}`);
      expect({ case: c.name, status: r.status }).toEqual({ case: c.name, status: 202 });
      expect({ case: c.name, rows: (await rowsOf(guest)).map((x) => x.userId) }).toEqual({ case: c.name, rows: [null] });
      expect({ case: c.name, owner: (await rowsOf(owner.email)).length }).toEqual({ case: c.name, owner: 0 });
    }
    expect(seen).toHaveLength(5);
  });

  it('(d) staff sin correo ⇒ invitado (dto.email, userId nulo)', async () => {
    const auth = w.h.app.get(AuthService);
    const staff = await w.h.prisma.user.create({
      data: { role: Role.vault_operator, name: `Staff T39 ${w.run}`, email: null, username: `staff-t39-${w.run}`, phone: '5512340000', locale: 'es' },
    });
    const { accessToken } = await auth.issueTokens(staff);
    const p = await product();
    const guest = otro();
    const r = await subscribe(body(guest, p), accessToken);
    expect(r.status).toBe(202);
    expect((await rowsOf(guest)).map((x) => x.userId)).toEqual([null]);
  });

  it('el tope de 5 pendientes cuenta sobre el correo RESUELTO (el de la cuenta), no sobre dto.email', async () => {
    const a = await w.customer();
    for (let i = 0; i < 5; i += 1) {
      const q = await product();
      expect((await subscribe(body(otro(), q), a.token)).status).toBe(202);
    }
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email: a.email, notifiedAt: null } })).toBe(5);
    const sixth = await product();
    const victim = otro();
    const r = await subscribe(body(victim, sixth), a.token);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ subscribed: true });
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email: a.email } })).toBe(5);
    expect(await rowsOf(victim)).toHaveLength(0);
  });
});

describe('WSH-T40 — FK de M-74 por catálogo y borrado de una pieza con aviso (815, v1.87.2 punto 3)', () => {
  it('confdeltype de las siete FK de las tablas nuevas (tabla EXACTA, solo el esquema actual)', async () => {
    const rows = await w.h.prisma.$queryRaw<{ fk: string; del: string }[]>`
      SELECT t.relname || '.' || a.attname AS fk, c.confdeltype::text AS del
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND n.nspname = current_schema()
        AND t.relname IN ('WishlistItem', 'WishlistNotice', 'WishlistMail')
      ORDER BY 1`;
    const got = Object.fromEntries(rows.map((r) => [r.fk, r.del]));
    expect(rows).toHaveLength(Object.keys(got).length); // ninguna FK compuesta ni repetida
    expect(got).toEqual({
      'WishlistItem.userId': 'c',
      'WishlistItem.cardId': 'r',
      'WishlistNotice.wishlistItemId': 'c',
      'WishlistNotice.userId': 'c',
      'WishlistNotice.inventoryItemId': 'c',
      'WishlistNotice.mailId': 'n',
      'WishlistMail.userId': 'c',
    });
  });

  it('pieza con un aviso `sent` con foto ⇒ DELETE FROM "InventoryItem" funciona; el aviso desaparece; deseo y correo intactos', async () => {
    const a = await w.customer();
    const c = await w.card();
    const pieceId = await w.piece(c.id, { listCents: 90000 });
    const wish = await w.h.prisma.wishlistItem.create({ data: { userId: a.id, cardId: c.id, finish: 'normal', maxPct: 10 } });
    const mail = await w.h.prisma.wishlistMail.create({ data: { userId: a.id, locale: 'es', itemCount: 1 } });
    const notice = await w.h.prisma.wishlistNotice.create({
      data: {
        wishlistItemId: wish.id,
        userId: a.id,
        inventoryItemId: pieceId,
        status: 'sent',
        mailId: mail.id,
        priceDisplayCents: 104400,
        marketCents: 100000,
        maxDisplayCents: 110000,
        fits: true,
        resolvedAt: new Date(),
      },
    });
    const deleted = await w.h.prisma.$executeRaw`DELETE FROM "InventoryItem" WHERE id = ${pieceId}`;
    expect(deleted).toBe(1);
    expect(await w.h.prisma.wishlistNotice.count({ where: { id: notice.id } })).toBe(0);
    expect(await w.h.prisma.wishlistItem.count({ where: { id: wish.id } })).toBe(1);
    expect(await w.h.prisma.wishlistMail.count({ where: { id: mail.id } })).toBe(1);
  });
});

describe('WSH-T41 — candado entre instancias, sin carrera (WSH.5, WSH.7 (a), v1.87.2 punto 4)', () => {
  /** Toma `pg_advisory_xact_lock(key)` en una transacción PROPIA (otra conexión del pool) y la sostiene hasta `release()`. */
  async function holdLock(key: number): Promise<() => Promise<void>> {
    let release!: () => void;
    let taken!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const isTaken = new Promise<void>((r) => (taken = r));
    const tx = w.h.prisma.$transaction(
      async (t) => {
        await t.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${Number(key)})`);
        taken();
        await gate;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    await Promise.race([isTaken, tx]);
    const [{ n }] = await w.h.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND classid = 0 AND objid = ${key}::bigint::oid AND objsubid = 1`;
    expect(n).toBeGreaterThanOrEqual(1); // el candado está de verdad tomado (la prueba no mide por suerte)
    return async () => {
      release();
      await tx; // commit ⇒ se suelta
    };
  }

  it('wishlist-notify (87740101): tomado ⇒ ALREADY_RUNNING y 0 filas nuevas; soltado ⇒ corre', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    expect((await post(a, { cardId: c.id, finish: 'normal', maxPct: 10 })).status).toBe(201);
    await w.piece(c.id, { listCents: 90000 });
    const before = { n: await w.h.prisma.wishlistNotice.count(), m: await w.h.prisma.wishlistMail.count() };

    const unlock = await holdLock(87740101);
    let held: { status: number; body: any };
    try {
      held = await w.runNotify();
    } finally {
      await unlock();
    }
    expect(held.status).toBe(200);
    expect(held.body).toEqual({ job: 'wishlist-notify', enqueued: false, reason: 'ALREADY_RUNNING' });
    expect({ n: await w.h.prisma.wishlistNotice.count(), m: await w.h.prisma.wishlistMail.count() }).toEqual(before);

    const free = await w.runNotify();
    expect(free.status).toBe(200);
    expect(free.body.enqueued).toBe(true);
    expect(free.body.detected).toBe(1);
    expect(await w.h.prisma.wishlistNotice.count({ where: { userId: a.id } })).toBe(1);
  });

  it('sealed-restock-notify (87740102): tomado ⇒ ALREADY_RUNNING y 0 armedAt/notifiedAt; soltado ⇒ arma', async () => {
    await w.setDial('sealed_restock_alerts', 'on');
    const c = await w.card({ finishes: ['normal'] });
    const tcg = 500000000 + Math.floor(Math.random() * 99999999);
    await w.piece(c.id, {
      productType: 'sealed',
      rawCondition: null,
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      tcgplayerProductId: tcg,
      sealedProductName: `Caja T41 ${w.run}`,
      status: 'in_custody', // agotado ⇒ la corrida ARMA la suscripción
      listCents: 200000,
    });
    const sub = await w.h.prisma.sealedRestockSubscription.create({
      data: { email: `t41-${w.run}@e2e.local`, cardId: c.id, tcgplayerProductId: tcg, sealedCondition: 'mint', sealedSubtype: 'box' },
    });
    const job = () => w.h.api('POST', '/admin/jobs/sealed-restock-notify', { token: w.adminToken, json: {} });

    const unlock = await holdLock(87740102);
    let held: { status: number; body: any };
    try {
      held = await job();
    } finally {
      await unlock();
    }
    expect(held.status).toBe(202);
    expect(held.body).toEqual({ job: 'sealed-restock-notify', enqueued: false, reason: 'ALREADY_RUNNING' });
    const mid = await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect([mid.armedAt, mid.notifiedAt]).toEqual([null, null]);

    w.clock.advance(MIN);
    const free = await job();
    expect(free.status).toBe(202);
    expect(free.body.enqueued).toBe(true);
    const after = await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.armedAt).not.toBeNull();
    expect(after.notifiedAt).toBeNull();
  });
});
