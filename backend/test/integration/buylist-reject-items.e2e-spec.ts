/**
 * `buylist-reject-items.e2e-spec.ts` — **v1.82 · PNL-4: rechazar VARIAS cartas de una solicitud con UN
 * motivo y UN correo** — POR HTTP, CONTRA POSTGRES REAL. Propiedad: backend. Norma: `API_CONTRACT §PNL.4`;
 * pruebas `§PNL.8` BRJ-1…BRJ-9; correo 29 = DESIGN_SYSTEM §60.6.
 *
 * La solicitud nace por la PUERTA (`POST /buylist/requests`) y el ESTADO de cada caso (verificación, ciclo de
 * oferta, decisiones por línea) se siembra por `h.prisma` — la CONDUCTA va por HTTP (patrón de
 * `buylist-step-guard.e2e-spec.ts`).
 *
 * BRJ-8 va en dos formas: (a) los dos entrelazados que importan, FORZADOS con el candado de fila de Postgres
 * (`helpers/row-lock-barrier.ts`: el orden no lo decide la máquina), y (b) N ≥ 10 rondas simultáneas con la
 * proporción en el log (O-3).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';

const CLABE_A = '012345678901234567';
const OFFERED = [12000, 8000, 5000] as const;
const DAY = 24 * 3600 * 1000;

describe('E2E — v1.82 PNL-4 · `POST /admin/buylist/:id/reject-items`', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let adminToken: string;
  let charizardId: string;
  let addressId: string;
  let enviados: MailMessage[];
  let spy: jest.SpyInstance;

  /** Una solicitud real con TRES líneas (la 2.ª y 3.ª se clonan de la 1.ª: misma carta, misma forma). */
  async function solicitudDeTres(): Promise<{ srId: string; items: string[] }> {
    const created = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: [{ cardId: charizardId, productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE_A,
        addressId,
      },
    });
    expect(created.status).toBe(201);
    const srId = created.body.sellRequestId as string;
    const first = await h.prisma.sellRequestItem.findFirstOrThrow({ where: { sellRequestId: srId } });
    const { id: _id, ...clon } = first;
    const extra = [];
    for (let i = 0; i < 2; i++) extra.push((await h.prisma.sellRequestItem.create({ data: { ...clon } })).id);
    return { srId, items: [first.id, ...extra] };
  }

  /** Deja la solicitud en `verificacion` (recibida, con oferta enviada) y las tres líneas `buy` en revisión. */
  async function siembra(srId: string, items: string[], over: { status?: string; closedAt?: Date | null } = {}) {
    await h.prisma.sellRequest.update({
      where: { id: srId },
      data: {
        status: (over.status ?? 'verificacion') as never,
        closedAt: over.closedAt ?? null,
        receivedAt: new Date(),
        verifiedAt: new Date(),
        offerSentAt: new Date(),
        approvedTotalCents: null,
      },
    });
    for (const [i, id] of items.entries()) {
      await h.prisma.sellRequestItem.update({
        where: { id },
        data: {
          itemStatus: 'verificacion',
          offerDecision: 'buy',
          offeredPriceCents: OFFERED[i],
          approvedPriceCents: null,
          rejectedAt: null,
          rejectionReason: null,
          inventoryItemId: null,
        },
      });
    }
  }

  const rejectItems = (srId: string, json: unknown, token = operatorToken) =>
    h.api('POST', `/admin/buylist/${srId}/reject-items`, { token, json });
  const decide = (itemId: string, json: Record<string, unknown>, token = operatorToken) =>
    h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, { token, json });

  const correos29 = () => enviados.filter((m) => /no fue aceptada|no fueron aceptadas|not accepted/.test(m.subject));

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
    charizardId = card!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    const addr = await h.prisma.address.findFirst({
      where: { userId: u!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    addressId = addr!.id;
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (msg: MailMessage) => {
      enviados.push(msg);
      return { id: 'e2e-mail' };
    });
  });

  beforeEach(() => {
    enviados = [];
  });

  afterAll(async () => {
    spy?.mockRestore();
    await h?.close();
  });

  it('BRJ-1 ⭐ `verificacion`, 3 `buy`; rechazar 2 con motivo ⇒ 200; esas 2 `rechazada` con motivo y fecha; la 3.ª intacta; UN correo que nombra las 2 y el motivo; bitácora', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    // La 3.ª aprobada: el total aprobado tiene que quedar SOLO con ella.
    expect((await decide(items[2], { decision: 'approve' })).status).toBe(200);
    enviados = [];
    const antes = Date.now();
    const res = await rejectItems(srId, { itemIds: [items[0], items[1]], reason: '  llegaron con dobleces  ' });
    expect(res.status).toBe(200);
    expect(res.body.requestClosed).toBe(false);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([items[0], items[1]]);
    for (const i of res.body.items) {
      expect(i).toMatchObject({ itemStatus: 'rechazada', rejectionReason: 'llegaron con dobleces', approvedPriceCents: null });
    }
    const rows = await h.prisma.sellRequestItem.findMany({ where: { id: { in: items } } });
    const by = new Map(rows.map((r) => [r.id, r]));
    for (const id of [items[0], items[1]]) {
      expect(by.get(id)!.itemStatus).toBe('rechazada');
      expect(by.get(id)!.rejectionReason).toBe('llegaron con dobleces');
      expect(by.get(id)!.rejectedAt!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    }
    // Las dos llevan el MISMO `rejectedAt` (un lote, un ancla de plazos).
    expect(by.get(items[0])!.rejectedAt).toEqual(by.get(items[1])!.rejectedAt);
    expect(by.get(items[2])!).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: OFFERED[2], rejectedAt: null });
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('verificacion');
    expect(sr.approvedTotalCents).toBe(OFFERED[2]);
    // UN correo, al vendedor, que nombra las dos cartas (por línea), el motivo y los plazos con sus días.
    expect(enviados).toHaveLength(1);
    const [m] = enviados;
    expect(m.to).toBe(E2E_USERS.customer.email);
    expect(m.subject).toBe('2 cartas de tu solicitud de venta no fueron aceptadas');
    expect(m.text).toContain('Motivo: llegaron con dobleces');
    expect(m.text.match(/^- .+ · .+ · #.+ \(Acabado: .+\)$/gm)).toHaveLength(2);
    expect(m.text).toContain('tienes 7 días');
    expect(m.text).toContain('a los 30 días');
    expect(m.text).toContain('Las demás cartas de tu solicitud siguen en revisión');
    expect(m.text).not.toMatch(/MX\$/);
    const log = await h.prisma.auditLog.findFirst({
      where: { entityId: srId, action: 'buylist.items_rejected' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log!.after).toEqual({ itemIds: [items[0], items[1]], reason: 'llegaron con dobleces', requestClosed: false });
  });

  it('BRJ-2 rechazar las 3 ⇒ solicitud `rechazada` con `closedAt`; un correo que lo dice', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    const res = await rejectItems(srId, { itemIds: items, reason: 'todas dañadas' });
    expect(res.status).toBe(200);
    expect(res.body.requestClosed).toBe(true);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('rechazada');
    expect(sr.closedAt).toBeInstanceOf(Date);
    expect(sr.approvedTotalCents).toBeNull();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].subject).toBe('3 cartas de tu solicitud de venta no fueron aceptadas');
    expect(enviados[0].text).toContain('tu solicitud queda cerrada y no hay pago');
  });

  it('BRJ-3 solicitud `aceptada` ⇒ 409 INVALID_TRANSITION {from, allowedFrom:[verificacion]}; `pagada` ⇒ 409 CONFLICT; nada cambia, cero correos', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items, { status: 'aceptada' });
    const a = await rejectItems(srId, { itemIds: [items[0]], reason: 'dañada' });
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe('INVALID_TRANSITION');
    expect(a.body.error.details).toEqual({ from: 'aceptada', allowedFrom: ['verificacion'] });
    await siembra(srId, items, { status: 'pagada', closedAt: new Date() });
    const p = await rejectItems(srId, { itemIds: [items[0]], reason: 'dañada' });
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('CONFLICT');
    expect(p.body.error.details.status).toBe('pagada');
    // `closedAt` sellado con status vivo (§M5-T): también cerrada.
    await siembra(srId, items, { status: 'verificacion', closedAt: new Date() });
    const t = await rejectItems(srId, { itemIds: [items[0]], reason: 'dañada' });
    expect(t.status).toBe(409);
    expect(t.body.error.code).toBe('CONFLICT');
    expect((await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[0] } })).itemStatus).toBe('verificacion');
    expect(enviados).toHaveLength(0);
  });

  it('BRJ-4 ⭐ una de las ids es `skip` ⇒ 422 ITEM_NOT_OFFERED {itemIds:[esa]}; NINGUNA cambia (todo o nada), cero correos', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    await h.prisma.sellRequestItem.update({ where: { id: items[2] }, data: { offerDecision: 'skip', offeredPriceCents: null } });
    const res = await rejectItems(srId, { itemIds: items, reason: 'dañadas' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_NOT_OFFERED');
    expect(res.body.error.details).toEqual({ itemIds: [items[2]] });
    const rows = await h.prisma.sellRequestItem.findMany({ where: { id: { in: items } } });
    for (const r of rows) {
      expect(r.itemStatus).toBe('verificacion');
      expect(r.rejectedAt).toBeNull();
    }
    expect(enviados).toHaveLength(0);
  });

  it('BRJ-5 una ya `convertida_inventario` ⇒ 409 CONFLICT {itemIds:[esa]}; ninguna cambia', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    await h.prisma.sellRequestItem.update({ where: { id: items[1] }, data: { itemStatus: 'convertida_inventario' } });
    const res = await rejectItems(srId, { itemIds: items, reason: 'dañadas' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ itemIds: [items[1]] });
    const rows = await h.prisma.sellRequestItem.findMany({ where: { id: { in: [items[0], items[2]] } } });
    for (const r of rows) expect(r.itemStatus).toBe('verificacion');
    // Una ya `rechazada` también es 409 (re-rechazarla movería el ancla de sus plazos).
    await h.prisma.sellRequestItem.update({ where: { id: items[1] }, data: { itemStatus: 'verificacion' } });
    const r1 = await rejectItems(srId, { itemIds: [items[0]], reason: 'primera' });
    expect(r1.status).toBe(200);
    const ancla = (await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[0] } })).rejectedAt;
    const r2 = await rejectItems(srId, { itemIds: [items[0], items[1]], reason: 'segunda' });
    expect(r2.status).toBe(409);
    expect(r2.body.error.details).toEqual({ itemIds: [items[0]] });
    const tras = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[0] } });
    expect(tras.rejectedAt).toEqual(ancla);
    expect(tras.rejectionReason).toBe('primera');
  });

  it('BRJ-6 id de OTRA solicitud ⇒ 404; repetidos ⇒ 400 {field:itemIds, rule:duplicates}; motivo de 2 ⇒ 400 {field:reason}; forma', async () => {
    const a = await solicitudDeTres();
    const b = await solicitudDeTres();
    await siembra(a.srId, a.items);
    await siembra(b.srId, b.items);
    const ajena = await rejectItems(a.srId, { itemIds: [a.items[0], b.items[0]], reason: 'dañadas' });
    expect(ajena.status).toBe(404);
    const rep = await rejectItems(a.srId, { itemIds: [a.items[0], a.items[0]], reason: 'dañadas' });
    expect(rep.status).toBe(400);
    expect(rep.body.error.details).toMatchObject({ field: 'itemIds', rule: 'duplicates' });
    const corto = await rejectItems(a.srId, { itemIds: [a.items[0]], reason: '  ab  ' });
    expect(corto.status).toBe(400);
    expect(corto.body.error.details).toMatchObject({ field: 'reason' });
    const largo = await rejectItems(a.srId, { itemIds: [a.items[0]], reason: 'x'.repeat(501) });
    expect(largo.status).toBe(400);
    expect(largo.body.error.details).toMatchObject({ field: 'reason' });
    const vacio = await rejectItems(a.srId, { itemIds: [], reason: 'dañadas' });
    expect(vacio.status).toBe(400);
    expect(vacio.body.error.details).toMatchObject({ field: 'itemIds' });
    const inexistente = await rejectItems('00000000-0000-4000-8000-000000000000', { itemIds: [a.items[0]], reason: 'dañadas' });
    expect(inexistente.status).toBe(404);
    const rows = await h.prisma.sellRequestItem.findMany({ where: { id: { in: [...a.items, ...b.items] } } });
    for (const r of rows) expect(r.itemStatus).toBe('verificacion');
    expect(enviados).toHaveLength(0);
  });

  it('BRJ-7 `vault_operator` ⇒ 200 (no es dinero saliente); cliente ⇒ 403', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    expect((await rejectItems(srId, { itemIds: [items[0]], reason: 'dañada' }, customerToken)).status).toBe(403);
    expect((await rejectItems(srId, { itemIds: [items[0]], reason: 'dañada' }, operatorToken)).status).toBe(200);
    expect((await rejectItems(srId, { itemIds: [items[1]], reason: 'dañada' }, adminToken)).status).toBe(200);
  });

  it('BRJ-9 `PATCH …/decision {reject}` sigue igual: un correo POR CARTA (el 4), no el 29', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    expect((await decide(items[0], { decision: 'reject', reason: 'dañada' })).status).toBe(200);
    expect((await decide(items[1], { decision: 'reject', reason: 'dañada' })).status).toBe(200);
    expect(enviados).toHaveLength(2);
    for (const m of enviados) expect(m.subject).toBe('Una carta de tu solicitud de venta fue rechazada');
    expect(correos29()).toHaveLength(0);
  });

  // ==========================================================================================
  // BRJ-8 — `reject-items` y `PATCH …/decision approve` sobre la MISMA carta
  // ==========================================================================================
  describe('BRJ-8 🔁 carrera con la aprobación por carta: nunca aprobada y rechazada a la vez', () => {
    /** La carta queda en UNO de los dos desenlaces, entero, y el total aprobado cuadra con las cartas. */
    async function coherente(srId: string, itemId: string) {
      const it = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
      if (it.itemStatus === 'aprobada') {
        expect({ rejectedAt: it.rejectedAt, rejectionReason: it.rejectionReason }).toEqual({ rejectedAt: null, rejectionReason: null });
        expect(it.approvedPriceCents).toBe(OFFERED[0]);
      } else {
        expect(it.itemStatus).toBe('rechazada');
        expect(it.approvedPriceCents).toBeNull();
        expect(it.rejectedAt).toBeInstanceOf(Date);
        expect(it.rejectionReason).toBe('carrera');
      }
      const all = await h.prisma.sellRequestItem.findMany({ where: { sellRequestId: srId } });
      const suma = all
        .filter((r) => r.itemStatus !== 'rechazada' && r.approvedPriceCents != null)
        .reduce((a, r) => a + (r.approvedPriceCents ?? 0), 0);
      const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
      expect(sr.approvedTotalCents ?? 0).toBe(suma);
      return it.itemStatus;
    }

    /** Sostiene la fila de la carta `FOR UPDATE` hasta `soltar` — fuerza el orden en que llegan las dos. */
    function sostenerCarta(itemId: string) {
      const puesto = diferida();
      const soltar = diferida();
      const tx = h.prisma.$transaction(
        async (t) => {
          await t.$executeRawUnsafe(`SELECT id FROM "SellRequestItem" WHERE id = $1 FOR UPDATE`, itemId);
          puesto.abrir();
          await soltar.promesa;
        },
        { timeout: 30000, maxWait: 30000 },
      );
      return { puesto: puesto.promesa, soltar: soltar.abrir, tx };
    }

    it('(a) ⭐⭐ `reject-items` PRIMERO y la aprobación LEE la carta antes de que el rechazo confirme ⇒ el rechazo gana; la aprobación 409 CONFLICT (CONCURRENT_UPDATE); la carta NO queda aprobada con motivo de rechazo', async () => {
      const { srId, items } = await solicitudDeTres();
      await siembra(srId, items);
      const lock = sostenerCarta(items[0]);
      await lock.puesto;
      const pRej = rejectItems(srId, { itemIds: [items[0]], reason: 'carrera' });
      await esperarBloqueoDeFila(h.prisma, 'SellRequestItem', 1);
      const pApr = decide(items[0], { decision: 'approve' });
      await esperarBloqueoDeFila(h.prisma, 'SellRequestItem', 2);
      lock.soltar();
      await lock.tx;
      const [rej, apr] = await Promise.all([pRej, pApr]);
      expect(rej.status).toBe(200);
      expect(apr.status).toBe(409);
      expect(apr.body.error.code).toBe('CONFLICT');
      expect(apr.body.error.details).toMatchObject({ itemId: items[0], itemStatus: 'rechazada', reason: 'CONCURRENT_UPDATE' });
      expect(await coherente(srId, items[0])).toBe('rechazada');
    });

    it('(b) la aprobación PRIMERO y `reject-items` decide sobre la vista vieja ⇒ el lote reintenta sobre la carta ya aprobada y la rechaza entera; coherente', async () => {
      const { srId, items } = await solicitudDeTres();
      await siembra(srId, items);
      const lock = sostenerCarta(items[0]);
      await lock.puesto;
      const pApr = decide(items[0], { decision: 'approve' });
      await esperarBloqueoDeFila(h.prisma, 'SellRequestItem', 1);
      const pRej = rejectItems(srId, { itemIds: [items[0]], reason: 'carrera' });
      await esperarBloqueoDeFila(h.prisma, 'SellRequestItem', 2);
      lock.soltar();
      await lock.tx;
      const [apr, rej] = await Promise.all([pApr, pRej]);
      expect(apr.status).toBe(200);
      // El lote es Serializable: choca, reintenta, relee `aprobada` (rechazable) y la rechaza ⇒ 200; o, si el
      // reintento no cupiera, 409 sin escribir nada. Nunca un estado mixto.
      expect([200, 409]).toContain(rej.status);
      const fin = await coherente(srId, items[0]);
      expect(fin).toBe(rej.status === 200 ? 'rechazada' : 'aprobada');
    });

    it('(c) 🔁 N = 20 rondas simultáneas sin forzar el orden: cada ronda coherente; proporción al log', async () => {
      const { srId, items } = await solicitudDeTres();
      const N = 20;
      const tally: Record<string, number> = {};
      for (let r = 0; r < N; r++) {
        await siembra(srId, items);
        const [rej, apr] = await Promise.all([
          rejectItems(srId, { itemIds: [items[0]], reason: 'carrera' }),
          decide(items[0], { decision: 'approve' }),
        ]);
        expect([200, 409]).toContain(rej.status);
        expect([200, 409]).toContain(apr.status);
        expect(rej.status === 200 || apr.status === 200).toBe(true);
        const fin = await coherente(srId, items[0]);
        const k = `reject ${rej.status} · approve ${apr.status} ⇒ ${fin}`;
        tally[k] = (tally[k] ?? 0) + 1;
      }
      // eslint-disable-next-line no-console
      console.log(`BRJ-8 (c) N=${N}: ${JSON.stringify(tally)}`);
    });
  });

  it('si el envío del correo 29 falla, el rechazo NO se deshace (best-effort post-commit)', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    spy.mockImplementationOnce(async () => {
      throw new Error('proveedor caído');
    });
    const res = await rejectItems(srId, { itemIds: [items[0]], reason: 'dañada' });
    expect(res.status).toBe(200);
    expect((await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[0] } })).itemStatus).toBe('rechazada');
  });

  it('el correo 29: los días escritos = plazo real del servidor (ML-24 por HTTP)', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    expect((await rejectItems(srId, { itemIds: [items[0]], reason: 'dañada' })).status).toBe(200);
    const it = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[0] } });
    const { rejectDeadlines } = await import('../../src/modules/buylist/buylist-reject.constants');
    const d = rejectDeadlines(it.rejectedAt);
    const ret = Math.round((d.returnDeadlineAt!.getTime() - it.rejectedAt!.getTime()) / DAY);
    const aba = Math.round((d.abandonDeadlineAt!.getTime() - it.rejectedAt!.getTime()) / DAY);
    expect(correos29()).toHaveLength(1);
    expect(correos29()[0].text).toContain(`tienes ${ret} días`);
    expect(correos29()[0].text).toContain(`a los ${aba} días`);
  });
});
