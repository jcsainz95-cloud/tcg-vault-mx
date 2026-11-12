import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT } from '../../src/modules/mail/mail.port';
import { SupplyExpiryService } from '../../src/modules/supply/supply-expiry.service';

/**
 * §PROV F1 contra Postgres real: invitación, login aislado, solicitudes, ofertas, tope duro 100 %, cero sobreventa,
 * recogida → verificación → pago manual → inventario, caducidades y AISLAMIENTO entre tiendas.
 */
const SET = 'e2e-supply-set';
const CA = 'e2e-sup-a'; // con mercado
const CB = 'e2e-sup-b'; // sin mercado
const MARKET = 10000; // MX$100

describe('E2E §PROV F1 — portal de proveedores', () => {
  let h: E2EHarness;
  const mails: { to: string; text: string }[] = [];
  let admin: string;
  let operator: string;
  let customer: string;
  let s1 = '';
  let s2 = '';
  let s1Id = '';
  let s2Id = '';

  const code = (r: { body: any }) => r.body?.error?.code;
  const A = (m: string, p: string, token: string, json?: unknown, headers?: Record<string, string>) =>
    h.api(m as any, p, { token, json, headers });
  const tokenFromMail = (to: string) => {
    const m = [...mails].reverse().find((x) => x.to === to)!;
    return decodeURIComponent(/token=([^\s&]+)/.exec(m.text)![1]);
  };
  async function setMarket(cardId: string, cents: number | null) {
    await h.prisma.priceReference.deleteMany({ where: { cardId } });
    if (cents == null) return;
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: cents, capturedDate: new Date(), isManualOverride: true, refKind: 'market' },
    });
  }
  async function invite(email: string, name: string) {
    const r = await A('POST', '/admin/suppliers/invite', admin, { businessName: name, email });
    expect([200, 201]).toContain(r.status);
    const acc = await h.api('POST', '/auth/supplier/accept-invite', { json: { token: tokenFromMail(email), password: 'Proveedor123!' } });
    expect(acc.status).toBe(200);
    return { token: (acc.body as any).accessToken as string, id: r.body.supplier.id as string };
  }
  const mkRequest = async (body: Record<string, unknown>) => {
    const r = await A('POST', '/admin/supply-requests', admin, { cardId: CA, finish: 'normal', minCondition: 'NM', qty: 3, ...body });
    expect(r.status).toBe(201);
    return r.body as any;
  };

  beforeAll(async () => {
    h = await E2EHarness.create((b) =>
      b.overrideProvider(MAIL_PORT).useValue({ send: async (m: any) => { mails.push({ to: m.to, text: m.text }); return {}; } }),
    );
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    await h.prisma.cardSet.create({ data: { id: SET, externalId: SET, name: 'E2E Supply' } });
    for (const [id, n] of [[CA, '1'], [CB, '2']]) {
      await h.prisma.card.create({ data: { id, externalId: id, setId: SET, name: `Supply ${n}`, number: n, rarity: 'Rare', availableFinishes: ['normal'] } });
    }
    await setMarket(CA, MARKET);
    await setMarket(CB, null);
  });

  afterAll(async () => {
    const cards = { in: [CA, CB] };
    const p = h?.prisma;
    if (p) {
      await p.inventoryItem.deleteMany({ where: { cardId: cards } });
      await p.supplyPurchaseUnit.deleteMany({});
      await p.supplyPurchase.deleteMany({});
      await p.supplyOfferEvent.deleteMany({});
      await p.supplyOffer.deleteMany({});
      await p.supplyRequest.deleteMany({});
      await p.supplierInvite.deleteMany({});
      const sups = await p.supplier.findMany({ select: { userId: true } });
      await p.supplier.deleteMany({});
      await p.user.deleteMany({ where: { id: { in: sups.map((s) => s.userId!).filter(Boolean) } } });
      await p.priceReference.deleteMany({ where: { cardId: cards } });
      await p.card.deleteMany({ where: { setId: SET } });
      await p.cardSet.deleteMany({ where: { id: SET } });
    }
    await h?.close();
  });

  it('invitación: solo el dueño; correo ajeno 409; registro abierto no existe; token de un uso', async () => {
    expect((await A('POST', '/admin/suppliers/invite', operator, { businessName: 'X', email: 'x@e2e.local' })).status).toBe(403);
    expect((await A('POST', '/admin/suppliers/invite', customer, { businessName: 'X', email: 'x@e2e.local' })).status).toBe(403);
    const taken = await A('POST', '/admin/suppliers/invite', admin, { businessName: 'X', email: E2E_USERS.customer.email });
    expect(taken.status).toBe(409);
    expect(code(taken)).toBe('EMAIL_TAKEN');
    const first = await A('POST', '/admin/suppliers/invite', admin, { businessName: 'Tienda Uno', email: 's1@e2e.local' });
    expect(first.status).toBe(201);
    expect(first.body.supplier.status).toBe('invited');
    const again = await A('POST', '/admin/suppliers/invite', admin, { businessName: 'Tienda Uno', email: 's1@e2e.local' });
    expect(again.status).toBe(200);
    // el token anterior quedó rotado
    const [oldTok, newTok] = [mails.filter((m) => m.to === 's1@e2e.local')[0], mails.filter((m) => m.to === 's1@e2e.local')[1]].map((m) => decodeURIComponent(/token=([^\s&]+)/.exec(m.text)![1]));
    expect(oldTok).not.toBe(newTok);
    const bad = await h.api('POST', '/auth/supplier/accept-invite', { json: { token: oldTok, password: 'Proveedor123!' } });
    expect(bad.status).toBe(400);
    expect(code(bad)).toBe('INVITE_INVALID');
    const weak = await h.api('POST', '/auth/supplier/accept-invite', { json: { token: newTok, password: '123' } });
    expect(weak.status).toBe(400);
    expect(code(weak)).toBe('WEAK_PASSWORD');
    const ok = await h.api('POST', '/auth/supplier/accept-invite', { json: { token: newTok, password: 'Proveedor123!' } });
    expect(ok.status).toBe(200);
    expect((ok.body as any).user.role).toBe('supplier');
    s1 = (ok.body as any).accessToken;
    s1Id = first.body.supplier.id;
    const reuse = await h.api('POST', '/auth/supplier/accept-invite', { json: { token: newTok, password: 'Proveedor123!' } });
    expect(code(reuse)).toBe('INVITE_INVALID');
    const lg = await h.api('POST', '/auth/login', { json: { email: 's1@e2e.local', password: 'Proveedor123!' } });
    expect(lg.status).toBe(200);
    expect((lg.body as any).user.supplierName).toBe('Tienda Uno');
    const s2r = await invite('s2@e2e.local', 'Tienda Dos');
    s2 = s2r.token;
    s2Id = s2r.id;
  });

  it('default-deny: el proveedor solo toca /supplier/*; los demás roles no tocan /supplier/*', async () => {
    for (const path of ['/users/me', '/orders', '/admin/supply-requests', '/admin/suppliers', '/buylist/requests', '/vault/holdings']) {
      const r = await A('GET', path, s1);
      expect(r.status).toBe(403);
      expect(code(r)).toBe('FORBIDDEN_ROLE');
    }
    expect((await A('POST', '/admin/supply-purchases/x/pay', s1, { method: 'cash' })).status).toBe(403);
    expect((await A('GET', '/supplier/me', s1)).status).toBe(200);
    for (const t of [customer, operator, admin]) expect((await A('GET', '/supplier/requests', t)).status).toBe(403);
    expect((await h.api('GET', '/supplier/requests')).status).toBe(401);
  });

  it('solicitudes: 70 % por defecto, tope duro 100 %, sin mercado exige precio fijo', async () => {
    const mc = await A('GET', `/admin/supply-requests/market-check?cardId=${CA}&finish=normal`, operator);
    expect(mc.body).toMatchObject({ marketCents: MARKET, hasMarket: true, capCents: MARKET, defaultPctBps: 7000, suggestedUnitCents: 7000 });
    const noMarket = await A('GET', `/admin/supply-requests/market-check?cardId=${CB}&finish=normal`, operator);
    expect(noMarket.body).toMatchObject({ marketCents: null, hasMarket: false });
    const r = await mkRequest({});
    expect(r).toMatchObject({ pctBps: 7000, unitCents: 7000, aboveCap: false, qtyOpen: 3 });
    const over = await A('POST', '/admin/supply-requests', admin, { cardId: CA, finish: 'normal', minCondition: 'NM', qty: 1, fixedUnitCents: MARKET + 100 });
    expect(over.status).toBe(422);
    expect(code(over)).toBe('ABOVE_MARKET_CAP');
    const over2 = await A('POST', '/admin/supply-requests', admin, { cardId: CA, finish: 'normal', minCondition: 'NM', qty: 1, pctBps: 10001 });
    expect(over2.status).toBe(400); // el DTO acota pctBps a 1..10000
    const edge = await A('POST', '/admin/supply-requests', admin, { cardId: CA, finish: 'normal', minCondition: 'NM', qty: 1, fixedUnitCents: MARKET });
    expect(edge.status).toBe(201);
    const nf = await A('POST', '/admin/supply-requests', admin, { cardId: CB, finish: 'normal', minCondition: 'NM', qty: 1 });
    expect(code(nf)).toBe('FIXED_PRICE_REQUIRED');
    const nfOk = await A('POST', '/admin/supply-requests', admin, { cardId: CB, finish: 'normal', minCondition: 'NM', qty: 1, fixedUnitCents: 5000 });
    expect(nfOk.status).toBe(201);
    const nfPct = await A('PATCH', `/admin/supply-requests/${nfOk.body.id}`, admin, { pctBps: 5000 });
    expect(code(nfPct)).toBe('NO_MARKET');
    expect((await A('POST', '/admin/supply-requests', operator, { cardId: CA, finish: 'normal', minCondition: 'NM', qty: 1 })).status).toBe(403);
  });

  it('el proveedor ve solo pesos: ni %, ni mercado, ni tope, ni otras tiendas', async () => {
    const list = await A('GET', '/supplier/requests', s1);
    expect(list.status).toBe(200);
    const txt = JSON.stringify(list.body);
    for (const leak of ['pctBps', 'marketCents', 'capCents', 'fixedPrice', 'aboveCap', 'createdById', 'offersCount']) expect(txt).not.toContain(leak);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.find((x: any) => x.unitCents === 7000)).toBeTruthy();
  });

  let reqId = '';
  let offer1 = '';
  let offer2 = '';
  it('ofertas: contraoferta aún no, condición mínima, cantidad, una viva por tienda, aislamiento entre tiendas', async () => {
    const reqs = (await A('GET', '/admin/supply-requests?status=open', operator)).body.data;
    reqId = reqs.find((x: any) => x.card.cardId === CA && x.pctBps === 7000).id;
    const counter = await A('POST', `/supplier/requests/${reqId}/offers`, s1, { qty: 1, condition: 'NM', unitCents: 6000 });
    expect(counter.status).toBe(422);
    expect(code(counter)).toBe('COUNTER_NOT_ENABLED');
    expect(code(await A('POST', `/supplier/requests/${reqId}/offers`, s1, { qty: 4, condition: 'NM' }))).toBe('QTY_EXCEEDS_OPEN');
    expect(code(await A('POST', `/supplier/requests/${reqId}/offers`, s1, { qty: 1, condition: 'LP' }))).toBe('CONDITION_BELOW_MIN');
    const o1 = await A('POST', `/supplier/requests/${reqId}/offers`, s1, { qty: 2, condition: 'NM' }, { 'idempotency-key': 'k1' });
    expect(o1.status).toBe(201);
    expect(o1.body).toMatchObject({ unitCents: 7000, totalCents: 14000, status: 'open' });
    offer1 = o1.body.id;
    const replay = await A('POST', `/supplier/requests/${reqId}/offers`, s1, { qty: 2, condition: 'NM' }, { 'idempotency-key': 'k1' });
    expect(replay.body.id).toBe(offer1);
    expect(code(await A('POST', `/supplier/requests/${reqId}/offers`, s1, { qty: 1, condition: 'NM' }))).toBe('ALREADY_OFFERED');
    const o2 = await A('POST', `/supplier/requests/${reqId}/offers`, s2, { qty: 2, condition: 'NM' });
    expect(o2.status).toBe(201);
    offer2 = o2.body.id;
    // aislamiento: S2 no ve ni toca la oferta de S1
    expect((await A('GET', `/supplier/offers/${offer1}`, s2)).status).toBe(404);
    expect((await A('POST', `/supplier/offers/${offer1}/respond`, s2, { action: 'withdraw' })).status).toBe(404);
    const mine = await A('GET', '/supplier/offers', s2);
    expect(mine.body.data.map((x: any) => x.id)).toEqual([offer2]);
    expect(JSON.stringify(mine.body)).not.toContain('Tienda Uno');
    // el dueño ve las dos, la mejor primero (mismo precio ⇒ la primera en llegar)
    const adminReq = await A('GET', `/admin/supply-requests/${reqId}`, operator);
    expect(adminReq.body.offers.map((o: any) => o.id)).toEqual([offer1, offer2]);
    expect(adminReq.body.offers[0].isBest).toBe(true);
    expect(adminReq.body.offers[0].pctOfMarketBps).toBe(7000);
  });

  let purchase1 = '';
  it('aceptar: cero sobreventa (la segunda ya no cabe) y el precio queda congelado en pesos', async () => {
    expect((await A('POST', `/admin/supply-offers/${offer1}/respond`, operator, { action: 'accept' })).status).toBe(403);
    const ok = await A('POST', `/admin/supply-offers/${offer1}/respond`, admin, { action: 'accept' });
    expect(ok.status).toBe(200);
    expect(ok.body.purchase).toMatchObject({ status: 'agreed', qty: 2, agreedUnitCents: 7000, totalCents: 14000 });
    purchase1 = ok.body.purchase.id;
    const dup = await A('POST', `/admin/supply-offers/${offer1}/respond`, admin, { action: 'accept' });
    expect(code(dup)).toBe('INVALID_STATE');
    const covered = await A('POST', `/admin/supply-offers/${offer2}/respond`, admin, { action: 'accept' });
    expect(covered.status).toBe(409);
    expect(code(covered)).toBe('COVERED');
    expect(covered.body.error.details.qtyOpen).toBe(1);
    // el mercado se mueve: lo acordado NO cambia
    await setMarket(CA, 5000);
    const p = await A('GET', '/supplier/purchases', s1);
    expect(p.body.data[0].agreedUnitCents).toBe(7000);
    await setMarket(CA, MARKET);
    // aislamiento: S2 no ve el acuerdo de S1
    expect((await A('GET', `/supplier/purchases/${purchase1}`, s2)).status).toBe(404);
    expect((await A('GET', '/supplier/purchases', s2)).body.data).toEqual([]);
  });

  it('TOPE DURO: si el mercado baja por debajo del precio de la solicitud, aceptar es 422 para el dueño', async () => {
    const r = await mkRequest({ qty: 1, fixedUnitCents: MARKET });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, s2, { qty: 1, condition: 'NM' });
    expect(o.status).toBe(201);
    await setMarket(CA, 9000);
    const adminView = await A('GET', `/admin/supply-requests/${r.id}`, operator);
    expect(adminView.body.aboveCap).toBe(true);
    // el proveedor ya no la ve ofertable
    expect((await A('GET', '/supplier/requests', s1)).body.data.find((x: any) => x.id === r.id)).toBeUndefined();
    const res = await A('POST', `/admin/supply-offers/${o.body.id}/respond`, admin, { action: 'accept' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('ABOVE_MARKET_CAP');
    expect(await h.prisma.supplyPurchase.count({ where: { offerId: o.body.id } })).toBe(0);
    await setMarket(CA, MARKET);
    const retry = await A('POST', `/admin/supply-offers/${o.body.id}/respond`, admin, { action: 'accept' });
    expect(retry.status).toBe(200);
    await setMarket(CA, MARKET);
  });

  let verified = '';
  it('recogida → verificación → pago manual → inventario (OK_NOT_NM, devuelta, idempotencia, MoneyOut)', async () => {
    const rc = await A('POST', `/admin/supply-purchases/${purchase1}/receive`, operator, { units: [{ n: 1, condition: 'NM' }, { n: 2, condition: 'LP' }] }, { 'idempotency-key': 'r1' });
    expect(rc.status).toBe(200);
    expect(rc.body.status).toBe('collected');
    expect(code(await A('POST', `/admin/supply-purchases/${purchase1}/receive`, operator, { units: [] }))).toBe('INVALID_STATE');
    expect((await A('POST', `/admin/supply-purchases/${purchase1}/receive`, operator, { units: [] }, { 'idempotency-key': 'r1' })).status).toBe(200);
    // pagar antes de verificar no se puede
    expect(code(await A('POST', `/admin/supply-purchases/${purchase1}/pay`, admin, { method: 'cash' }))).toBe('INVALID_STATE');
    const bad = await A('POST', `/admin/supply-purchases/${purchase1}/verify`, operator, { units: [{ n: 1, result: 'ok' }, { n: 2, result: 'ok' }] });
    expect(code(bad)).toBe('OK_NOT_NM');
    expect(code(await A('POST', `/admin/supply-purchases/${purchase1}/verify`, operator, { units: [{ n: 1, result: 'ok' }] }))).toBe('UNITS_MISMATCH');
    expect(await h.prisma.inventoryItem.count({ where: { supplyPurchaseId: purchase1 } })).toBe(0);
    const v = await A('POST', `/admin/supply-purchases/${purchase1}/verify`, operator, { units: [{ n: 1, result: 'ok' }, { n: 2, result: 'returned' }] }, { 'idempotency-key': 'v1' });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: 'verified', payableCents: 7000 });
    expect(v.body.inventoryItemIds).toHaveLength(1);
    verified = purchase1;
    const inv = await h.prisma.inventoryItem.findFirstOrThrow({ where: { supplyPurchaseId: purchase1 } });
    expect(inv).toMatchObject({ acquisitionCostCents: 7000, rawCondition: 'NM', productType: 'raw', acquisitionType: 'compra', cardId: CA });
    const rq = await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(rq).toMatchObject({ qtyReserved: 1, qtyReceived: 1, status: 'open' });
    // verify repetido con la misma llave no duplica inventario
    expect((await A('POST', `/admin/supply-purchases/${purchase1}/verify`, operator, { units: [] }, { 'idempotency-key': 'v1' })).status).toBe(200);
    expect(await h.prisma.inventoryItem.count({ where: { supplyPurchaseId: purchase1 } })).toBe(1);
    // pago: solo el dueño
    const op = await A('POST', `/admin/supply-purchases/${verified}/pay`, operator, { method: 'cash' });
    expect(op.status).toBe(403);
    const pay = await A('POST', `/admin/supply-purchases/${verified}/pay`, admin, { method: 'transfer', reference: 'SPEI-1' }, { 'idempotency-key': 'p1' });
    expect(pay.status).toBe(200);
    expect(pay.body).toMatchObject({ status: 'paid', method: 'transfer', reference: 'SPEI-1', payableCents: 7000 });
    expect((await A('POST', `/admin/supply-purchases/${verified}/pay`, admin, { method: 'transfer', reference: 'SPEI-1' })).status).toBe(200);
    expect(code(await A('POST', `/admin/supply-purchases/${verified}/pay`, admin, { method: 'transfer', reference: 'OTRA' }))).toBe('ALREADY_PAID_DIFFERENT');
    expect(code(await A('POST', `/admin/supply-purchases/${verified}/pay`, admin, { method: 'cash' }))).toBe('ALREADY_PAID_DIFFERENT');
    // el proveedor ve el pago, en pesos, sin ajustes internos
    const sp = await A('GET', `/supplier/purchases/${verified}`, s1);
    expect(sp.body).toMatchObject({ status: 'paid', payableCents: 7000 });
    expect(JSON.stringify(sp.body)).not.toContain('adjustBps');
    expect(JSON.stringify(sp.body)).not.toContain('inventoryItemIds');
  });

  it('ajuste de estado: baja el pago con floor(acordado × bps), nunca sube', async () => {
    const r = await mkRequest({ qty: 2 });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, s2, { qty: 2, condition: 'NM' });
    const acc = await A('POST', `/admin/supply-offers/${o.body.id}/respond`, admin, { action: 'accept' });
    const pid = acc.body.purchase.id;
    await A('POST', `/admin/supply-purchases/${pid}/receive`, operator, { units: [{ n: 1, condition: 'NM' }, { n: 2, condition: 'NM' }] });
    expect(code(await A('POST', `/admin/supply-purchases/${pid}/verify`, operator, { units: [{ n: 1, result: 'adjusted' }, { n: 2, result: 'ok' }] }))).toBe('ADJUST_REQUIRED');
    const v = await A('POST', `/admin/supply-purchases/${pid}/verify`, operator, { units: [{ n: 1, result: 'adjusted', adjustBps: 8333 }, { n: 2, result: 'ok' }] });
    expect(v.body.payableCents).toBe(Math.floor((7000 * 8333) / 10000) + 7000);
    expect(v.body.units.find((u: any) => u.n === 1).unitPayableCents).toBe(5833);
    // un ajuste nunca sube: 10000 ya no es un ajuste (400) y una segunda verificación no repite el pago (409)
    expect((await A('POST', `/admin/supply-purchases/${pid}/verify`, operator, { units: [{ n: 1, result: 'adjusted', adjustBps: 10000 }, { n: 2, result: 'ok' }] })).status).toBe(400);
    expect((await A('POST', `/admin/supply-purchases/${pid}/verify`, operator, { units: [{ n: 1, result: 'ok' }, { n: 2, result: 'ok' }] })).status).toBe(409);
  });

  it('caducidades por job: oferta 72 h, acuerdo sin recoger 7 d (libera cantidad) y solicitud 14 d; idempotente', async () => {
    const r = await mkRequest({ qty: 2 });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, s1, { qty: 2, condition: 'NM' });
    const o2 = await A('POST', `/supplier/requests/${r.id}/offers`, s2, { qty: 1, condition: 'NM' });
    expect(o.body.expiresAt && new Date(o.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(71 * 3600 * 1000);
    const acc = await A('POST', `/admin/supply-offers/${o.body.id}/respond`, admin, { action: 'accept' });
    const pid = acc.body.purchase.id;
    expect(Math.round((new Date(acc.body.purchase.pickupDueAt).getTime() - Date.now()) / 86400000)).toBe(7);
    expect((await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('filled');
    await h.prisma.supplyPurchase.update({ where: { id: pid }, data: { pickupDueAt: new Date(Date.now() - 1000) } });
    await h.prisma.supplyOffer.update({ where: { id: o2.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(code(await A('POST', `/admin/supply-purchases/${pid}/receive`, operator, { units: [] }))).toBe('PURCHASE_EXPIRED');
    expect(code(await A('POST', `/admin/supply-offers/${o2.body.id}/respond`, admin, { action: 'accept' }))).toBe('OFFER_EXPIRED');
    const job = h.app.get(SupplyExpiryService);
    const first = await job.run();
    expect(first.purchases).toBeGreaterThanOrEqual(1);
    expect(first.offers).toBeGreaterThanOrEqual(1);
    const rq = await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(rq).toMatchObject({ qtyReserved: 0, status: 'open' });
    expect((await h.prisma.supplyPurchase.findUniqueOrThrow({ where: { id: pid } })).status).toBe('cancelled');
    expect((await h.prisma.supplyOffer.findUniqueOrThrow({ where: { id: o2.body.id } })).status).toBe('expired');
    expect(await job.run()).toEqual({ requests: 0, offers: 0, purchases: 0 });
    await h.prisma.supplyRequest.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await job.run()).requests).toBe(1);
    expect((await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('expired');
    expect(code(await A('POST', `/supplier/requests/${r.id}/offers`, s1, { qty: 1, condition: 'NM' }))).toBe('REQUEST_EXPIRED');
  });

  it('concurrencia: dos aceptaciones simultáneas sobre la última pieza ⇒ exactamente una gana', async () => {
    const r = await mkRequest({ qty: 1 });
    const a = await A('POST', `/supplier/requests/${r.id}/offers`, s1, { qty: 1, condition: 'NM' });
    const b = await A('POST', `/supplier/requests/${r.id}/offers`, s2, { qty: 1, condition: 'NM' });
    const res = await Promise.all([
      A('POST', `/admin/supply-offers/${a.body.id}/respond`, admin, { action: 'accept' }),
      A('POST', `/admin/supply-offers/${b.body.id}/respond`, admin, { action: 'accept' }),
    ]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(await h.prisma.supplyPurchase.count({ where: { requestId: r.id } })).toBe(1);
    expect((await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: r.id } })).qtyReserved).toBe(1);
  });

  it('retirar oferta, cerrar solicitud y suspender: la sesión del proveedor muere', async () => {
    const r = await mkRequest({ qty: 2 });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, s1, { qty: 1, condition: 'NM' });
    expect((await A('POST', `/supplier/offers/${o.body.id}/respond`, s1, { action: 'counter', unitCents: 5000 })).status).toBe(422);
    expect((await A('POST', `/supplier/offers/${o.body.id}/respond`, s1, { action: 'withdraw' })).body.status).toBe('withdrawn');
    expect(code(await A('POST', `/supplier/offers/${o.body.id}/respond`, s1, { action: 'withdraw' }))).toBe('INVALID_STATE');
    const o2 = await A('POST', `/supplier/requests/${r.id}/offers`, s1, { qty: 1, condition: 'NM' });
    const closed = await A('PATCH', `/admin/supply-requests/${r.id}`, admin, { status: 'closed' });
    expect(closed.body.status).toBe('closed');
    expect((await A('GET', `/supplier/offers/${o2.body.id}`, s1)).body.status).toBe('expired');
    expect(code(await A('PATCH', `/admin/supply-requests/${r.id}`, admin, { qtyWanted: 5 }))).toBe('INVALID_STATE');
    const sus = await A('PATCH', `/admin/suppliers/${s1Id}`, admin, { status: 'suspended' });
    expect(sus.body.status).toBe('suspended');
    expect((await A('GET', '/supplier/me', s1)).status).toBe(401);
    const lg = await h.api('POST', '/auth/login', { json: { email: 's1@e2e.local', password: 'Proveedor123!' } });
    expect(lg.status).toBe(403);
    expect(code(lg)).toBe('SUPPLIER_SUSPENDED');
    expect((await A('GET', '/supplier/me', s2)).status).toBe(200);
    expect(s2Id).toBeTruthy();
  });

  it('interruptores: existen y arrancan APAGADOS; solo el dueño los ve', async () => {
    expect((await A('GET', '/admin/supply-settings', operator)).status).toBe(403);
    const st = await A('GET', '/admin/supply-settings', admin);
    expect(st.body).toEqual({ autoPublish: false, autoAccept: false, defaultPctBps: 7000, weeklyBudgetCents: 0 });
  });
});
