import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { SupplySuggestService } from '../../src/modules/supply/supply-suggest.service';
import { SUPPLY_SYSTEM_USER_ID } from '../../src/modules/supply/supply-suggest.logic';

/**
 * §PROV-F4 contra Postgres real: sugeridas desde Meta Decks (máximo de copias, no suma), stock y solicitudes abiertas descontados,
 * tope 100 %, sin mercado ⇒ se salta y se reintenta, dedupe con manuales, presupuesto semanal, dos corridas simultáneas, idempotencia,
 * `autoPublish` apagado ⇒ solo borradores, endpoints y roles.
 */
const SET = 'e2e-f4-set';
const SLUG = 'e2e-f4';
const C = { A: 'e2e-f4-a', B: 'e2e-f4-b', N: 'e2e-f4-nomkt', CHEAP: 'e2e-f4-cheap', EN: 'e2e-f4-energy', J: 'e2e-f4-jump', U: 'e2e-f4-unmatched' };
const ALL = Object.values(C);

describe('E2E §PROV-F4 — sugeridas con auto-publicación', () => {
  let h: E2EHarness;
  let svc: SupplySuggestService;
  let admin: string;
  let operator: string;
  let customer: string;
  let prevPublished: string[] = [];
  const A = (m: string, p: string, token: string, json?: unknown, headers?: Record<string, string>) => h.api(m as any, p, { token, json, headers });
  let kseq = 0;
  const P = (id: string, body: unknown = {}, key: string | null = `k-${++kseq}-${Date.now()}`, token = admin) => A('POST', `/admin/supply-suggestions/${id}/publish`, token, body, key ? { 'idempotency-key': key } : undefined);
  const code = (r: { body: any }) => r.body?.error?.code;

  async function setMarket(cardId: string, cents: number | null, opts: { daysAgo?: number } = {}) {
    if (opts.daysAgo == null) await h.prisma.priceReference.deleteMany({ where: { cardId } });
    if (cents == null) return;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (opts.daysAgo ?? 0));
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: cents, capturedDate: d, isManualOverride: opts.daysAgo == null, refKind: 'market' },
    });
  }
  async function settings(patch: { autoPublish?: boolean; openBudgetCents?: number; defaultPctBps?: number }) {
    await h.prisma.supplySettings.update({ where: { id: 'singleton' }, data: patch });
  }
  async function reset() {
    await h.prisma.supplySuggestion.deleteMany({});
    await h.prisma.supplySettings.update({ where: { id: 'singleton' }, data: { lastSuggestRunAt: null } });
    await h.prisma.supplyPurchase.deleteMany({});
    await h.prisma.supplyOfferEvent.deleteMany({});
    await h.prisma.supplyOffer.deleteMany({});
    await h.prisma.supplyRequest.deleteMany({});
    await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: ALL } } });
  }
  const row = (cardId: string) => h.prisma.supplySuggestion.findFirst({ where: { cardId }, orderBy: { createdAt: 'desc' } });
  const reqs = (cardId: string) => h.prisma.supplyRequest.findMany({ where: { cardId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    svc = h.app.get(SupplySuggestService);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    prevPublished = (await h.prisma.metaDeck.findMany({ where: { published: true }, select: { id: true } })).map((d) => d.id);
    await h.prisma.metaDeck.updateMany({ where: { id: { in: prevPublished } }, data: { published: false } });
    await h.prisma.cardSet.create({ data: { id: SET, externalId: SET, name: 'E2E F4' } });
    const mk = (id: string, n: string, extra: Record<string, unknown> = {}) =>
      h.prisma.card.create({ data: { id, externalId: id, setId: SET, name: `F4 ${id}`, number: n, rarity: 'Rare', availableFinishes: ['normal'], supertype: 'Pokémon', ...extra } });
    await mk(C.A, '1'); await mk(C.B, '2'); await mk(C.N, '3'); await mk(C.CHEAP, '4'); await mk(C.J, '6'); await mk(C.U, '7');
    await mk(C.EN, '5', { supertype: 'Energy', name: 'Fire Energy', subtypes: ['Basic'] });
    // dos mazos publicados: A pide 2 y 3 (necesidad = 3, NO 5); B pide 4; sin-mercado, barata, energía básica y salto
    const mkDeck = async (slug: string, rank: number, lines: [string, number, 'matched' | 'unmatched_set'][]) => {
      const deck = await h.prisma.metaDeck.create({ data: { slug, name: slug, rank, published: true } });
      const list = await h.prisma.metaDeckList.create({ data: { deckId: deck.id, formatLabel: 'E2E', activeMarksSnapshot: {} } });
      await h.prisma.metaDeck.update({ where: { id: deck.id }, data: { currentListId: list.id } });
      for (const [cardId, qty, ms] of lines) {
        await h.prisma.metaDeckCard.create({ data: { listId: list.id, rawName: cardId, rawSetCode: 'F4', rawNumber: '1', quantity: qty, group: 'pokemon', matchStatus: ms, matchedCardId: ms === 'matched' ? cardId : null } });
      }
    };
    await mkDeck(`${SLUG}-1`, 6, [[C.A, 2, 'matched'], [C.B, 4, 'matched'], [C.N, 2, 'matched'], [C.CHEAP, 4, 'matched'], [C.EN, 12, 'matched'], [C.J, 2, 'matched'], [C.U, 3, 'unmatched_set']]);
    await mkDeck(`${SLUG}-2`, 7, [[C.A, 3, 'matched']]);
    await setMarket(C.A, 10000); // MX$100
    await setMarket(C.B, 20050); // MX$200.50
    await setMarket(C.N, null);
    await setMarket(C.CHEAP, 800); // < MX$10
    await setMarket(C.EN, 5000);
    await setMarket(C.J, null);
    await setMarket(C.J, 4000, { daysAgo: 1 }); // ayer 40 → hoy 100: salto > 30 % (capturas automáticas, no manuales)
    await setMarket(C.J, 10000, { daysAgo: 0 });
    await setMarket(C.U, 5000);
  });

  afterAll(async () => {
    const p = h?.prisma;
    if (p) {
      await reset();
      await p.metaDeckCard.deleteMany({ where: { list: { deck: { slug: { startsWith: SLUG } } } } });
      const decks = await p.metaDeck.findMany({ where: { slug: { startsWith: SLUG } } });
      for (const d of decks) await p.metaDeck.update({ where: { id: d.id }, data: { currentListId: null } });
      await p.metaDeckList.deleteMany({ where: { deckId: { in: decks.map((d) => d.id) } } });
      await p.metaDeck.deleteMany({ where: { id: { in: decks.map((d) => d.id) } } });
      await p.metaDeck.updateMany({ where: { id: { in: prevPublished } }, data: { published: true } });
      await p.priceReference.deleteMany({ where: { cardId: { in: ALL } } });
      await p.card.deleteMany({ where: { setId: SET } });
      await p.cardSet.deleteMany({ where: { id: SET } });
      await settings({ autoPublish: false, openBudgetCents: 500000, defaultPctBps: 7000 });
    }
    await h?.close();
  });

  beforeEach(async () => {
    await reset();
    // Fixture canónico de decks (los tests de §PROV-F4.2 cambian puestos y copias).
    await h.prisma.metaDeck.update({ where: { slug: `${SLUG}-1` }, data: { rank: 6 } });
    await h.prisma.metaDeck.update({ where: { slug: `${SLUG}-2` }, data: { rank: 7 } });
    await h.prisma.metaDeckCard.updateMany({ where: { matchedCardId: C.A, list: { deck: { slug: `${SLUG}-1` } } }, data: { quantity: 2 } });
    await h.prisma.metaDeckCard.updateMany({ where: { matchedCardId: C.A, list: { deck: { slug: `${SLUG}-2` } } }, data: { quantity: 3 } });
    await settings({ autoPublish: false, openBudgetCents: 500000, defaultPctBps: 7000 });
  });

  it('el interruptor nace APAGADO (sin la migración de datos de producción) y autoAccept también', async () => {
    const s = await A('GET', '/admin/supply-settings', admin);
    expect(s.status).toBe(200);
    expect(s.body.autoAccept).toBe(false);
    // el DEFAULT de la columna sigue en false: el encendido en producción es una decisión posterior a los gates, no de la migración
    const def = await h.prisma.$queryRaw<{ c: string }[]>`SELECT column_default AS c FROM information_schema.columns WHERE table_name = 'SupplySettings' AND column_name = 'autoPublish'`;
    expect(def[0].c).toBe('false');
    const bud = await h.prisma.$queryRaw<{ c: string }[]>`SELECT column_default AS c FROM information_schema.columns WHERE table_name = 'SupplySettings' AND column_name = 'openBudgetCents'`;
    expect(bud[0].c).toBe('500000'); // MX$5,000 por defecto (HECHOS 2026-11-20)
    expect(s.body).toEqual(expect.objectContaining({ openExposureCents: 0, lastRunAt: null }));
  });

  it('autoPublish APAGADO: solo borradores; necesidad = suma de decks de puesto > 5 (2+3 = 5, ×1); energía, barata, sin casar y sin mercado se tratan según regla', async () => {
    const r = await svc.run();
    expect(r.published).toBe(0);
    expect(await h.prisma.supplyRequest.count()).toBe(0);
    const a = await row(C.A);
    expect(a).toMatchObject({ status: 'draft', suggestedQty: 5, unitCents: 7000, marketCents: 10000, skipReason: null });
    expect(a?.reasons).toEqual([{ kind: 'metadeck', ref: `${SLUG}-1`, rank: 6, copies: 2, mult: 1 }, { kind: 'metadeck', ref: `${SLUG}-2`, rank: 7, copies: 3, mult: 1 }]);
    expect(await row(C.B)).toMatchObject({ status: 'draft', suggestedQty: 4, unitCents: 14000 }); // 70 % de 200.50 = 140.35 → 140
    expect(await row(C.N)).toMatchObject({ status: 'skipped', skipReason: 'no_market', unitCents: null });
    expect(await row(C.J)).toMatchObject({ status: 'skipped', skipReason: 'market_jump' }); // salto de mercado ⇒ cuarentena
    expect(await row(C.CHEAP)).toBeNull(); // < MX$10 no se sugiere
    expect(await row(C.EN)).toBeNull(); // energía básica excluida
    expect(await row(C.U)).toBeNull(); // sin casar: no hay carta que comprar
    const st = await A('GET', '/admin/supply-settings', admin);
    expect(st.body.lastRunAt).not.toBeNull();
  });

  it('idempotente: una segunda corrida no duplica filas', async () => {
    await svc.run();
    const n = await h.prisma.supplySuggestion.count();
    await svc.run();
    expect(await h.prisma.supplySuggestion.count()).toBe(n);
  });

  it('descuenta stock y solicitudes abiertas de otra carta/acabado antes de sugerir', async () => {
    await h.prisma.inventoryItem.create({ data: { folio: 'F4-S1', cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', ownerType: 'platform' } });
    await h.prisma.inventoryItem.create({ data: { folio: 'F4-S2', cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'listed', ownerType: 'platform' } });
    await svc.run();
    expect(await row(C.B)).toMatchObject({ status: 'draft', suggestedQty: 2 });
  });

  it('autoPublish ENCENDIDO: publica solicitudes source=suggested a 70 %, nunca sobre el mercado, createdById = sistema; segunda corrida no duplica', async () => {
    await settings({ autoPublish: true });
    const r = await svc.run();
    expect(r.published).toBe(2); // A y B (J en cuarentena, N sin mercado)
    const [ra] = await reqs(C.A);
    expect(ra).toMatchObject({ source: 'suggested', qtyWanted: 5, pctBps: 7000, fixedCents: null, status: 'open', createdById: SUPPLY_SYSTEM_USER_ID, minCondition: 'NM' });
    expect(await row(C.A)).toMatchObject({ status: 'published', requestId: ra.id });
    const adminView = await A('GET', `/admin/supply-requests/${ra.id}`, admin);
    expect(adminView.body.unitCents).toBe(7000);
    expect(adminView.body.unitCents).toBeLessThanOrEqual(adminView.body.marketCents);
    expect(adminView.body.aboveCap).toBe(false);
    await svc.run();
    expect(await reqs(C.A)).toHaveLength(1);
    expect(await reqs(C.B)).toHaveLength(1);
    expect(await reqs(C.N)).toHaveLength(0); // sin mercado: nada se publica
  });

  it('sin mercado se salta hoy y entra solo cuando aparece el mercado', async () => {
    await settings({ autoPublish: true });
    await svc.run();
    expect(await reqs(C.N)).toHaveLength(0);
    await setMarket(C.N, 30000);
    await svc.run();
    const [rn] = await reqs(C.N);
    expect(rn).toMatchObject({ qtyWanted: 2, source: 'suggested' });
    expect(await h.prisma.supplySuggestion.count({ where: { cardId: C.N, status: { in: ['draft', 'skipped'] } } })).toBe(0);
    await setMarket(C.N, null);
  });

  it('dedupe: una solicitud MANUAL abierta del mismo carta/acabado no se duplica ni se toca', async () => {
    await settings({ autoPublish: true });
    const m = await A('POST', '/admin/supply-requests', admin, { cardId: C.A, finish: 'normal', minCondition: 'NM', qty: 1 });
    expect(m.status).toBe(201);
    await svc.run();
    const rs = await reqs(C.A);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ source: 'manual', qtyWanted: 1 });
    expect(await row(C.A)).toMatchObject({ status: 'skipped', skipReason: 'covered' });
  });

  it('una sugerida publicada se SUBE si la necesidad crece (nunca baja) sin crear otra', async () => {
    await settings({ autoPublish: true });
    await svc.run();
    const [ra] = await reqs(C.A);
    expect(ra.qtyWanted).toBe(5);
    await h.prisma.metaDeckCard.updateMany({ where: { matchedCardId: C.A, quantity: 3 }, data: { quantity: 4 } });
    const r = await svc.run();
    expect(r.raised).toBe(1);
    const rs = await reqs(C.A);
    expect(rs).toHaveLength(1);
    expect(rs[0].qtyWanted).toBe(6);
    await h.prisma.metaDeckCard.updateMany({ where: { matchedCardId: C.A, quantity: 4 }, data: { quantity: 1 } });
    await svc.run();
    expect((await reqs(C.A))[0].qtyWanted).toBe(6); // no baja
  });

  it('presupuesto semanal: lo que excede queda en borrador/budget y la exposición nunca supera el tope', async () => {
    await settings({ autoPublish: true, openBudgetCents: 30000 }); // MX$300: prioridad por valor ⇒ B (4×140) se REDUCE a 2 (280) y A (210) no cabe
    const r = await svc.run();
    expect(r.published).toBe(1);
    expect((await reqs(C.B))[0].qtyWanted).toBe(2);
    const exposure = await svc.openExposure(new Date());
    expect(exposure).toBeLessThanOrEqual(30000);
    expect(await row(C.A)).toMatchObject({ status: 'draft', skipReason: 'budget' });
    const st = await A('GET', '/admin/supply-settings', admin);
    expect(st.body.openExposureCents).toBe(exposure);
    // sube el presupuesto ⇒ la siguiente corrida publica lo pendiente
    await settings({ openBudgetCents: 500000 });
    await svc.run();
    expect(await reqs(C.A)).toHaveLength(1);
    expect((await reqs(C.B))[0].qtyWanted).toBe(4); // la reducida sube sola al liberarse presupuesto
    expect(await svc.openExposure(new Date())).toBeLessThanOrEqual(500000);
  });

  it('presupuesto 0 ⇒ no publica nada (equivale a apagado)', async () => {
    await settings({ autoPublish: true, openBudgetCents: 0 });
    await svc.run();
    expect(await h.prisma.supplyRequest.count()).toBe(0);
    expect(await row(C.A)).toMatchObject({ status: 'draft', skipReason: 'budget' });
  });

  it('dos corridas SIMULTÁNEAS no duplican solicitudes ni filas (candado + único parcial)', async () => {
    await settings({ autoPublish: true });
    await Promise.all([svc.run(), svc.run(), svc.run()]);
    expect(await reqs(C.A)).toHaveLength(1);
    expect(await reqs(C.B)).toHaveLength(1);
    const live = await h.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT "cardId","finish" FROM "SupplySuggestion" WHERE status IN ('draft','skipped') GROUP BY 1,2 HAVING count(*)>1) x`;
    expect(Number(live[0].n)).toBe(0);
    expect(await svc.openExposure(new Date())).toBeLessThanOrEqual(500000);
  });

  it('la BD rechaza dos filas vivas de la misma (carta, acabado)', async () => {
    const mk = () => h.prisma.supplySuggestion.create({ data: { cardId: C.A, finish: 'normal', suggestedQty: 1, reasons: [], status: 'draft' } });
    await mk();
    await expect(mk()).rejects.toThrow();
  });

  it('tope 100 %: con defaultPctBps = 10000 el precio publicado es ≤ mercado (peso hacia abajo)', async () => {
    await settings({ autoPublish: true, defaultPctBps: 10000 });
    await svc.run();
    const v = await A('GET', `/admin/supply-requests/${(await reqs(C.B))[0].id}`, admin);
    expect(v.body.unitCents).toBe(20000); // 200.50 → 200
    expect(v.body.unitCents).toBeLessThanOrEqual(v.body.marketCents);
  });

  it('endpoints: listado con filtro de estado validado, roles, publicar a mano (201, 409 la segunda) y saltar (204)', async () => {
    await svc.run();
    const all = await A('GET', '/admin/supply-suggestions', admin);
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThan(0);
    expect(all.body.data[0]).toEqual(expect.objectContaining({ pctBps: 7000, reasons: expect.any(Array), finish: 'normal' }));
    expect((await A('GET', '/admin/supply-suggestions?status=draft', operator)).status).toBe(200);
    const bad = await A('GET', '/admin/supply-suggestions?status=bogus', admin);
    expect(bad.status).toBe(400);
    expect(code(bad)).toBe('VALIDATION_ERROR');
    expect((await A('GET', '/admin/supply-suggestions', customer)).status).toBe(403);
    const a = await row(C.A);
    expect((await A('POST', `/admin/supply-suggestions/${a!.id}/publish`, operator, {})).status).toBe(403);
    const over = await P(a!.id, { pctBps: 10001 });
    expect(over.status).toBe(400);
    const pub = await P(a!.id, { qty: 2 });
    expect(pub.status).toBe(201);
    expect(pub.body).toMatchObject({ source: 'suggested', qtyWanted: 2, unitCents: 7000 });
    const again = await P(a!.id, {});
    expect(again.status).toBe(409);
    expect(code(again)).toBe('ALREADY_PUBLISHED');
    const nomkt = await row(C.N);
    const noPrice = await P(nomkt!.id, {});
    expect(noPrice.status).toBe(409);
    expect(code(noPrice)).toBe('QUARANTINED');
    expect(noPrice.body.error.details).toEqual({ skipReason: 'no_market' });
    const b = await row(C.B);
    expect((await A('POST', `/admin/supply-suggestions/${b!.id}/skip`, admin)).status).toBe(204);
    expect((await row(C.B))?.status).toBe('skipped');
    // el descarte del operador se respeta en la corrida de esta semana
    await settings({ autoPublish: true });
    await svc.run();
    expect(await reqs(C.B)).toHaveLength(0);
    expect((await A('POST', '/admin/supply-suggestions/00000000-0000-0000-0000-000000000000/skip', admin)).status).toBe(404);
  });

  it('PATCH de ajustes: tope entero acotado a 1e9 (3e9 ⇒ 400, no 500), autoAccept NO editable (400) y GET siempre false', async () => {
    expect((await A('PATCH', '/admin/supply-settings', admin, { openBudgetCents: 3_000_000_000 })).status).toBe(400);
    expect((await A('PATCH', '/admin/supply-settings', admin, { openBudgetCents: 1_000_000_001 })).status).toBe(400);
    expect((await A('PATCH', '/admin/supply-settings', admin, { openBudgetCents: 1_000_000_000 })).status).toBe(200);
    for (const v of [true, false, null, 'x']) {
      const r = await A('PATCH', '/admin/supply-settings', admin, { autoAccept: v });
      expect(r.status).toBe(400);
      expect(code(r)).toBe('VALIDATION_ERROR');
    }
    await h.prisma.supplySettings.update({ where: { id: 'singleton' }, data: { autoAccept: true } });
    expect((await A('GET', '/admin/supply-settings', admin)).body.autoAccept).toBe(false); // el GET no refleja la columna
    await h.prisma.supplySettings.update({ where: { id: 'singleton' }, data: { autoAccept: false } });
  });

  it('PATCH de ajustes: presupuesto entero acotado y autoAccept sigue en false por defecto', async () => {
    const ok = await A('PATCH', '/admin/supply-settings', admin, { openBudgetCents: 123400 });
    expect(ok.status).toBe(200);
    expect(ok.body.openBudgetCents).toBe(123400);
    expect(ok.body.autoAccept).toBe(false);
    expect((await A('PATCH', '/admin/supply-settings', admin, { openBudgetCents: 1.5 })).status).toBe(400);
    expect((await A('PATCH', '/admin/supply-settings', admin, { openBudgetCents: -1 })).status).toBe(400);
    expect((await A('PATCH', '/admin/supply-settings', operator, { openBudgetCents: 1 })).status).toBe(403);
  });

  // ------------------------------------------------------------------ gate F4: hallazgos de qa y seguridad-lead
  async function agreement(cardId: string, qty: number, reqStatus: 'open' | 'closed', purchaseStatus: 'agreed' | 'collected' | 'verified' | 'paid' | 'cancelled') {
    const sup = await h.prisma.supplier.upsert({ where: { email: 'f4-sup@example.test' }, update: {}, create: { email: 'f4-sup@example.test', businessName: 'F4 Sup', status: 'active' } });
    const req = await h.prisma.supplyRequest.create({
      data: { cardId, finish: 'normal', qtyWanted: qty, qtyReserved: reqStatus === 'open' ? qty : 0, pctBps: 7000, status: reqStatus, source: 'manual', expiresAt: new Date(Date.now() + 86400_000), createdById: 'x' },
    });
    const offer = await h.prisma.supplyOffer.create({ data: { requestId: req.id, supplierId: sup.id, qty, condition: 'NM', unitCents: 7000, status: 'accepted', expiresAt: new Date(Date.now() + 86400_000) } });
    await h.prisma.supplyPurchase.create({ data: { offerId: offer.id, supplierId: sup.id, requestId: req.id, cardId, finish: 'normal', qty, agreedUnitCents: 7000, pickupDueAt: new Date(Date.now() + 86400_000), status: purchaseStatus } });
    return req;
  }

  it('BLOQUEANTE qa: acuerdos sin pagar de una solicitud CERRADA descuentan; pagado y cancelado no', async () => {
    await h.prisma.inventoryItem.create({ data: { folio: 'F4-D1', cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', ownerType: 'platform' } });
    await agreement(C.B, 1, 'closed', 'agreed');
    await svc.run();
    expect(await row(C.B)).toMatchObject({ status: 'draft', suggestedQty: 2 }); // 4 − stock 1 − acuerdo 1 (antes pedía 3)
    await reset();
    await h.prisma.inventoryItem.create({ data: { folio: 'F4-Dcollected', cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', ownerType: 'platform' } });
    await agreement(C.B, 1, 'closed', 'collected');
    await svc.run();
    expect(await row(C.B)).toMatchObject({ suggestedQty: 2 });
    // `verified` ya es stock: no se cuenta dos veces (necesidad 4, stock 1 = el verificado ⇒ pide 3)
    await reset();
    await h.prisma.inventoryItem.create({ data: { folio: 'F4-Dverified', cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', ownerType: 'platform' } });
    await agreement(C.B, 1, 'closed', 'verified');
    await svc.run();
    expect(await row(C.B)).toMatchObject({ suggestedQty: 3 });
    for (const st of ['paid', 'cancelled'] as const) {
      await reset();
      await agreement(C.B, 1, 'closed', st);
      await svc.run();
      expect(await row(C.B)).toMatchObject({ suggestedQty: 4 });
    }
  });

  const deckRank = (n: 1 | 2, rank: number) => h.prisma.metaDeck.update({ where: { slug: `${SLUG}-${n}` }, data: { rank } });
  const setLine = (cardId: string, slug: string, quantity: number) =>
    h.prisma.metaDeckCard.updateMany({ where: { matchedCardId: cardId, list: { deck: { slug } } }, data: { quantity } });

  it('PROV-F4.2: carta compartida 4×2 (puesto 2) + 2×1 (puesto 9) = 10; reasons por deck', async () => {
    await deckRank(1, 9); await deckRank(2, 2);
    await setLine(C.A, `${SLUG}-1`, 2); await setLine(C.A, `${SLUG}-2`, 4);
    await svc.run();
    const a = await row(C.A);
    expect(a).toMatchObject({ status: 'draft', suggestedQty: 10 });
    expect(a?.reasons).toEqual([{ kind: 'metadeck', ref: `${SLUG}-2`, rank: 2, copies: 4, mult: 2 }, { kind: 'metadeck', ref: `${SLUG}-1`, rank: 9, copies: 2, mult: 1 }]);
  });

  it('PROV-F4.2: cambio de puesto y ConfigSetting recalculan; la abierta no baja', async () => {
    await settings({ autoPublish: true });
    await svc.run();
    expect((await reqs(C.A))[0].qtyWanted).toBe(5); // 2×1 + 3×1
    await deckRank(2, 3); // sube al top 5 ⇒ 2 + 3×2 = 8
    await svc.run();
    expect((await reqs(C.A))[0].qtyWanted).toBe(8);
    await deckRank(2, 7); // baja ⇒ necesidad 5, la abierta NO se baja
    await svc.run();
    expect((await reqs(C.A))).toHaveLength(1);
    expect((await reqs(C.A))[0].qtyWanted).toBe(8);
    await h.prisma.supplySuggestion.deleteMany({}); await h.prisma.supplyRequest.deleteMany({});
    await settings({ autoPublish: false });
    try {
      await h.prisma.configSetting.createMany({ data: [{ key: 'supply.suggest.topRankMax', valueJson: 7 }, { key: 'supply.suggest.topMult', valueJson: 3 }] });
      await svc.run(); // deck-2 (rank 7) ahora es top ×3: 2×3 (rank 6) + 3×3 = 15
      expect(await row(C.A)).toMatchObject({ suggestedQty: 15 });
    } finally {
      await h.prisma.configSetting.deleteMany({ where: { key: { startsWith: 'supply.suggest.' } } });
    }
  });

  it('PROV-F4.2: al topar el cupo gana el menor puesto aunque valga menos; publish manual usa la misma necesidad viva', async () => {
    await deckRank(2, 1); // A: 2 + 3×2 = 8, deck que más pesa = puesto 1; B pesa en el puesto 6
    await settings({ autoPublish: true, openBudgetCents: 30000 });
    await svc.run();
    expect((await reqs(C.A))[0].qtyWanted).toBe(4); // floor(300/70)
    expect((await reqs(C.B))).toHaveLength(0);
    expect(await row(C.B)).toMatchObject({ status: 'draft', skipReason: 'budget' });
    // publish manual de otra carta con la necesidad nueva: A abierta 4 de 8 ⇒ viva 4 más
    await settings({ openBudgetCents: 500000 });
    for (let i = 0; i < 2; i++) await h.prisma.inventoryItem.create({ data: { folio: `F4-P${i}`, cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', ownerType: 'platform' } });
    const b = (await row(C.B))!;
    const ok = await P(b.id, {});
    expect(ok.status).toBe(201);
    expect((await reqs(C.B)).find((x) => x.source === 'suggested')?.qtyWanted).toBe(2); // B 4 − stock 2
  });

  it('publish manual recalcula la necesidad VIVA: stock 3 + acuerdo 1 con necesidad 4 ⇒ 409 ALREADY_COVERED; con 1 sola cubierta sube qty ≤ viva', async () => {
    await svc.run();
    const b = (await row(C.B))!;
    expect(b.suggestedQty).toBe(4);
    for (let i = 0; i < 3; i++) await h.prisma.inventoryItem.create({ data: { folio: `F4-L${i}`, cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', ownerType: 'platform' } });
    await agreement(C.B, 1, 'closed', 'agreed');
    const r = await P(b.id, {});
    expect(r.status).toBe(409);
    expect(code(r)).toBe('ALREADY_COVERED');
    expect((await reqs(C.B)).filter((x) => x.source === 'suggested')).toHaveLength(0);
    // viva 2 (stock 1 + 1 acuerdo): sin qty pide min(4, 2); qty 3 ⇒ 400
    await h.prisma.inventoryItem.deleteMany({ where: { cardId: C.B } });
    await h.prisma.inventoryItem.create({ data: { folio: 'F4-L9', cardId: C.B, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', acquisitionCostCents: 1000, status: 'in_stock', ownerType: 'platform' } });
    expect((await P(b.id, { qty: 3 })).status).toBe(400);
    const ok = await P(b.id, {});
    expect(ok.status).toBe(201);
    expect((await reqs(C.B)).find((x) => x.source === 'suggested')?.qtyWanted).toBe(2);
  });

  it('F4-4: 10 publish simultáneos de cartas distintas y repetidas no devuelven ningún 500', async () => {
    await svc.run();
    const ids = (await h.prisma.supplySuggestion.findMany({ where: { cardId: { in: [C.A, C.B] } } })).map((x) => x.id);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => P(ids[i % ids.length], {})));
    expect(rs.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(rs.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH de ajustes: clave fuera de lista blanca (weeklyBudgetCents) ⇒ 400 VALIDATION_ERROR', async () => {
    const r = await A('PATCH', '/admin/supply-settings', admin, { weeklyBudgetCents: 5 });
    expect(r.status).toBe(400);
    expect(code(r)).toBe('VALIDATION_ERROR');
    expect((await A('PATCH', '/admin/supply-settings', admin, { autoPublish: false, openBudgetCents: 500000 })).status).toBe(200);
  });

  it('acuerdo sin pagar de una solicitud ABIERTA no se cuenta dos veces (reservado + acuerdo)', async () => {
    await agreement(C.B, 1, 'open', 'agreed'); // qtyWanted 1, reservado 1 ⇒ pendiente 0 + acuerdo 1
    await svc.run();
    expect(await row(C.B)).toMatchObject({ suggestedQty: 3 });
  });

  it('cupo ABIERTO a la vez: una solicitud MANUAL grande cuenta y baja el cupo disponible del job', async () => {
    await settings({ autoPublish: true, openBudgetCents: 30000 });
    await h.prisma.supplyRequest.create({ data: { cardId: C.CHEAP, finish: 'normal', qtyWanted: 4, pctBps: 10000, fixedCents: 5000, source: 'manual', expiresAt: new Date(Date.now() + 86400_000), createdById: 'x' } }); // 4 × 50 = 200
    expect(await svc.openExposure(new Date())).toBe(20000);
    const r = await svc.run();
    expect(await svc.openExposure(new Date())).toBeLessThanOrEqual(30000);
    expect(r.published).toBe(1); // solo caben MX$100 más: A reducida a 1 (70) o B (1 × 140 no cabe)
    expect((await reqs(C.A))[0].qtyWanted).toBe(1);
    expect(await row(C.B)).toMatchObject({ status: 'draft', skipReason: 'budget' });
  });

  it('cupo abierto: la SUBIDA de una solicitud sugerida (delta) cuenta y no rebasa el tope; lo vencido o ya recibido sale', async () => {
    await settings({ autoPublish: true, openBudgetCents: 100000 });
    await svc.run();
    const before = await svc.openExposure(new Date());
    expect(before).toBeLessThanOrEqual(100000);
    await h.prisma.metaDeckCard.updateMany({ where: { matchedCardId: C.A, quantity: 3 }, data: { quantity: 4 } });
    await svc.run();
    expect(await svc.openExposure(new Date())).toBeLessThanOrEqual(100000);
    await h.prisma.metaDeckCard.updateMany({ where: { matchedCardId: C.A, quantity: 4 }, data: { quantity: 3 } });
    await h.prisma.supplyRequest.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } }); // vencen
    expect(await svc.openExposure(new Date())).toBe(0);
  });

  it('publish manual: Idempotency-Key obligatoria, misma key ⇒ misma respuesta sin segunda solicitud, otro cuerpo ⇒ 422', async () => {
    await svc.run();
    const a = (await row(C.A))!;
    const noKey = await P(a.id, {}, null);
    expect(noKey.status).toBe(400);
    expect(code(noKey)).toBe('VALIDATION_ERROR');
    const first = await P(a.id, { qty: 2 }, 'k-fixed-1');
    expect(first.status).toBe(201);
    const again = await P(a.id, { qty: 2 }, 'k-fixed-1');
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await reqs(C.A)).toHaveLength(1);
    const other = await P(a.id, { qty: 1 }, 'k-fixed-1');
    expect(other.status).toBe(422);
    expect(code(other)).toBe('IDEMPOTENCY_KEY_REUSED');
    const b = (await row(C.B))!;
    expect(code(await P(b.id, {}, 'k-fixed-1'))).toBe('IDEMPOTENCY_KEY_REUSED'); // misma key, otra sugerida
  });

  it('publish manual: 8 simultáneas con la MISMA key ⇒ 1 solicitud y la misma respuesta; con keys distintas ⇒ 1×201 y el resto 409', async () => {
    await svc.run();
    const a = (await row(C.A))!;
    const same = await Promise.all(Array.from({ length: 8 }, () => P(a.id, {}, 'k-par')));
    expect(same.every((r) => r.status === 201 && r.body.id === same[0].body.id)).toBe(true);
    expect(await reqs(C.A)).toHaveLength(1);
    const b = (await row(C.B))!;
    const diff = await Promise.all(Array.from({ length: 6 }, () => P(b.id, {})));
    expect(diff.filter((r) => r.status === 201)).toHaveLength(1);
    expect(diff.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await reqs(C.B)).toHaveLength(1);
  });

  it('publish manual: dedupe 409 ALREADY_COVERED con solicitud abierta (manual) de la carta, sin crear otra', async () => {
    await svc.run();
    const a = (await row(C.A))!;
    await A('POST', '/admin/supply-requests', admin, { cardId: C.A, finish: 'normal', minCondition: 'NM', qty: 1 });
    const r = await P(a.id, {});
    expect(r.status).toBe(409);
    expect(code(r)).toBe('ALREADY_COVERED');
    expect(await reqs(C.A)).toHaveLength(1);
  });

  it('publish manual: cuarentena 409 QUARANTINED (salto > 30 %) y qty > sugerida ⇒ 400', async () => {
    await svc.run();
    const j = (await row(C.J))!;
    const r = await P(j.id, {});
    expect(r.status).toBe(409);
    expect(code(r)).toBe('QUARANTINED');
    expect(r.body.error.details).toEqual({ skipReason: 'market_jump' });
    expect(await reqs(C.J)).toHaveLength(0);
    const a = (await row(C.A))!;
    expect((await P(a.id, { qty: a.suggestedQty + 1 })).status).toBe(400);
  });

  it('publish manual: cupo 409 BUDGET_EXCEEDED con {openCents, budgetCents}; funciona con autoPublish apagado', async () => {
    await svc.run(); // autoPublish apagado: borradores
    const b = (await row(C.B))!;
    await settings({ openBudgetCents: 10000 }); // 4 × 140 = 560 > 100
    const r = await P(b.id, {});
    expect(r.status).toBe(409);
    expect(code(r)).toBe('BUDGET_EXCEEDED');
    expect(r.body.error.details).toEqual({ openCents: 0, budgetCents: 10000 });
    expect(await reqs(C.B)).toHaveLength(0);
    await settings({ openBudgetCents: 500000 });
    expect((await P(b.id, {})).status).toBe(201);
  });

  it('publish manual vs job simultáneos con tope ajustado: la exposición abierta nunca supera el tope', async () => {
    await svc.run();
    await settings({ autoPublish: true, openBudgetCents: 30000 });
    const ids = (await h.prisma.supplySuggestion.findMany({ where: { cardId: { in: [C.A, C.B] } } })).map((x) => x.id);
    await Promise.all([svc.run(), ...ids.map((id) => P(id, {})), svc.run()]);
    // Invariante (no el orden de llegada): exposición ≤ tope y nunca más de 1 solicitud por carta.
    expect(await svc.openExposure(new Date())).toBeLessThanOrEqual(30000);
    expect((await reqs(C.A)).length).toBeLessThanOrEqual(1);
    expect((await reqs(C.B)).length).toBeLessThanOrEqual(1);
  });
});
