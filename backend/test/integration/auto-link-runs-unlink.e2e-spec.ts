/**
 * auto-link-runs-unlink.e2e-spec.ts — 💰 §AUTO-ENLACE §9.6 contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *  (ii) grupo EQUIVOCADO ⇒ el set entero NO se publica (0 enlaces, 0 PriceReference, `price_sanity`, espera 7 días) · (iii) GET auto-link-runs ·
 *  (iv) POST unlink (solo lo del job; nunca overrides manuales, enlaces confirmados ni productos con piezas; cuarentena 30 días; 429; 409).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CatalogAutoLinkService } from '../../src/modules/catalog/catalog-auto-link.service';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { FxService } from '../../src/modules/pricing/fx.service';

jest.setTimeout(240_000);

describe('E2E — §AUTO-ENLACE §9.6 freno por set, auto-link-runs y unlink', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let job: CatalogAutoLinkService;
  const run = randomUUID().slice(0, 8);
  const base = 940_000 + (parseInt(run.slice(0, 4), 16) % 5_000) * 10;
  const GW = base + 1; // grupo «equivocado»: sus precios están muy por encima de lo que ya se conocía
  const GG = base + 2; // set sano
  const setIds: string[] = [];
  const cardIds: string[] = [];
  const productsOf = new Map<number, { productId: number; name: string; number: string }[]>();
  const names = ['Pikachu', 'Eevee', 'Snorlax', 'Mewtwo', 'Gengar', 'Ditto'];
  const groups = [GW, GG].map((g) => ({ groupId: g, name: `Grupo ${g} ${run}` }));
  const day = (n: number) => new Date(new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10));

  async function mkSet(tag: string, group: number, n: number): Promise<{ setId: string; cardIds: string[] }> {
    const s = await h.prisma.cardSet.create({ data: { externalId: `ru-${tag}-${run}`, name: `Grupo ${group} ${run}`, pptSetId: String(group), releaseDate: '2020/01/01' } });
    setIds.push(s.id);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = await h.prisma.card.create({ data: { externalId: `ru-${tag}-${run}-${i}`, setId: s.id, name: names[i], number: String(i + 1), availableFinishes: ['normal'] } });
      ids.push(c.id);
      cardIds.push(c.id);
    }
    productsOf.set(group, names.slice(0, n).map((name, i) => ({ productId: group * 100 + i + 1, name, number: String(i + 1) })));
    return { setId: s.id, cardIds: ids };
  }
  const prior = (cardId: string, mxn: number) =>
    h.prisma.priceReference.create({ data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgdex', priceUsdCents: null, priceMxnCents: mxn, capturedDate: day(3), refKind: 'market' } });
  const runs = (q = '', token = admin) => h.api<any>('GET', `/admin/catalog/auto-link-runs${q}`, { token });
  const unlink = (setId: string, token = admin) => h.api<any>('POST', `/admin/catalog/link-exceptions/${setId}/unlink`, { token });
  const code = (r: { body: any }) => r.body?.code ?? r.body?.error?.code;
  let W: { setId: string; cardIds: string[] };
  let G: { setId: string; cardIds: string[] };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    job = h.app.get(CatalogAutoLinkService);
    const client = h.app.get(TcgcsvCatalogClient);
    jest.spyOn(client, 'listGroups').mockImplementation(async () => groups as never);
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => (productsOf.get(g) ?? []) as never);
    jest.spyOn(client, 'getPrices').mockImplementation(async (g: number) => (productsOf.get(g) ?? []).map((p) => ({ productId: p.productId, subTypeName: 'Normal', marketPrice: 2 })) as never);
    jest.spyOn(h.app.get(FxService), 'getCurrent').mockResolvedValue({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' } as never);
    W = await mkSet('W', GW, 6);
    for (const c of W.cardIds) await prior(c, 100); // 6 variantes con referencia previa: candidato 3600 ⇒ ×36
    G = await mkSet('G', GG, 4);
    await prior(G.cardIds[0], 3000); // candidato 3600 ⇒ ×1.2: sano; previousPriceCents = 3000
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link_claim', 'catalog.auto_link_run', 'catalog.auto_link', 'catalog.auto_unlink', 'catalog.auto_unlink_claim'] } } });
  });

  afterAll(async () => {
    if (h) {
      const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } });
      await h.prisma.listingPrice.deleteMany({ where: { inventoryItem: { cardId: { in: cardIds } } } });
      await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { OR: [{ cardId: { in: cardIds } }, { cardProductId: { in: cps.map((c) => c.id) } }] } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      // El job recorre TODOS los sets sin ligar (también los sembrados): sus filas de intento (`link_repair`/`auto_link`) no deben sobrevivir a esta suite (otra suite mide el total de cartas sin ligar).
      await h.prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...cardIds, ...setIds] } }, { action: { in: ['catalog.auto_link_run', 'catalog.auto_link_claim', 'catalog.auto_link', 'catalog.link_repair', 'catalog.card_confirm_claim', 'catalog.auto_unlink', 'catalog.auto_unlink_claim'] } }] } });
      await h.close();
    }
  });

  it('§9.6 (ii) grupo EQUIVOCADO: 6/6 variantes con referencia previa saltan ×36 ⇒ el set NO se publica (0 enlaces, 0 PriceReference tcgcsv, 0 casos), reason price_sanity y espera 7 días; el set sano sí', async () => {
    const r = await job.run({ trigger: 'manual', maxSets: 50, onlySetIds: setIds });
    const w = r.sets.find((s) => s.setId === W.setId)!;
    expect(w).toMatchObject({ linked: 0, priced: 0, reason: 'price_sanity' });
    expect(await h.prisma.cardProduct.count({ where: { cardId: { in: W.cardIds } } })).toBe(0);
    expect(await h.prisma.priceReference.count({ where: { cardId: { in: W.cardIds }, source: 'tcgcsv_singles' } })).toBe(0); // 0 precios publicados
    expect(await h.prisma.priceReviewCase.count({ where: { cardId: { in: W.cardIds } } })).toBe(0);
    const au = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.auto_link', entityId: W.setId } });
    expect(au.after).toMatchObject({ reason: 'price_sanity', sanity: { checked: 6, held: 6 }, linked: 0, noProgress: true });
    const wait = Date.parse((au.after as { nextAttemptAt: string }).nextAttemptAt) - Date.now();
    expect(wait).toBeGreaterThan(6 * 86_400_000);
    expect(wait).toBeLessThanOrEqual(7 * 86_400_000);
    // espera 7 días: ni mañana ni pasado lo vuelve a elegir.
    expect((await job.pickSets(50, new Date(Date.now() + 2 * 86_400_000), setIds)).some((s) => s.setId === W.setId)).toBe(false);
    // y la lista de excepciones lo dice
    const ex = await h.api<any>('GET', '/admin/catalog/link-exceptions', { token: admin });
    expect(ex.body.sets.find((s: any) => s.setId === W.setId)).toMatchObject({ reason: 'price_sanity' });
    // set sano
    const g = r.sets.find((s) => s.setId === G.setId)!;
    expect(g).toMatchObject({ linked: 4, priced: 4, held: 0 });
    expect(await h.prisma.priceReference.count({ where: { cardId: { in: G.cardIds }, source: 'tcgcsv_singles' } })).toBe(4);
  });

  it('§9.6 (iii) GET auto-link-runs: solo super_admin; days validado; la corrida trae sus sets con grupo, vía, enlaces, precios, retenidas y ≤ 5 muestras (nuevo/previo)', async () => {
    expect((await runs('', operator)).status).toBe(403);
    expect((await runs('?days=0')).status).toBe(422);
    expect((await runs('?days=abc')).status).toBe(422);
    const r = await runs('?days=7');
    expect(r.status).toBe(200);
    const mine = r.body.runs.find((x: any) => x.sets.some((s: any) => s.setId === G.setId));
    expect(mine).toMatchObject({ setsTried: expect.any(Number), linked: expect.any(Number), priced: expect.any(Number), held: expect.any(Number) });
    expect(typeof mine.runId).toBe('string');
    expect(typeof mine.at).toBe('string');
    const sg = mine.sets.find((s: any) => s.setId === G.setId);
    expect(sg).toMatchObject({ name: `Grupo ${GG} ${run}`, groupId: GG, via: 'auto', linked: 4, priced: 4, held: 0, finishesAdded: 0 });
    expect(sg.sample.length).toBeLessThanOrEqual(5);
    expect(sg.sample.length).toBeGreaterThan(0);
    expect(sg.sample.find((x: any) => x.cardName === 'Pikachu')).toEqual({ cardName: 'Pikachu', number: '1', finish: 'normal', newPriceCents: 3600, previousPriceCents: 3000 });
    expect(sg.sample.find((x: any) => x.cardName === 'Eevee').previousPriceCents).toBeNull();
    const sw = mine.sets.find((s: any) => s.setId === W.setId);
    expect(sw).toMatchObject({ linked: 0, priced: 0 });
    expect(JSON.stringify(r.body)).not.toMatch(/token|secret|password/i);
  });

  it('§9.6 (iv) unlink: 409 si el job no corrió sobre el set; revierte SOLO lo del job (no override manual, no enlace confirmado a mano, no producto con pieza); cuarentena 30 días `reverted`; 429 al repetir; 403/404', async () => {
    expect((await unlink(G.setId, operator)).status).toBe(403);
    expect((await unlink(randomUUID())).status).toBe(404);
    const lone = await h.prisma.cardSet.create({ data: { externalId: `ru-L-${run}`, name: `Sin corrida ${run}` } });
    setIds.push(lone.id);
    const none = await unlink(lone.id);
    expect([none.status, code(none)]).toEqual([409, 'NOTHING_TO_UNLINK']);

    // Trampas: override manual de mercado sobre una carta del set; una carta «confirmada a mano»; un producto con una pieza.
    const [c0, c1, c2, c3] = G.cardIds;
    const cp1 = await h.prisma.cardProduct.findFirstOrThrow({ where: { cardId: c1 } });
    await h.prisma.priceReference.create({ data: { cardId: c1, cardProductId: cp1.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 7777, isManualOverride: true, capturedDate: day(0), refKind: 'market' } });
    await h.prisma.auditLog.create({ data: { actorUserId: null, action: 'catalog.card_link_confirmed', entityType: 'Card', entityId: c2, after: { cardId: c2 } } });
    const cp3 = await h.prisma.cardProduct.findFirstOrThrow({ where: { cardId: c3 } });
    const piece = await h.prisma.inventoryItem.create({
      data: { folio: `RU-${run}`.padEnd(12, '0'), cardId: c3, cardProductId: cp3.tcgplayerProductId, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 1000, firstListedAt: new Date() } as never,
    });
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: G.setId }, select: { cardGroupVia: true } })).toEqual({ cardGroupVia: 'auto' });

    const r = await unlink(G.setId);
    expect([r.status, JSON.stringify(r.body)]).toEqual([200, expect.anything()]);
    expect(r.body).toMatchObject({ setId: G.setId, unlinked: 1, pricesRemoved: 1 });
    expect(r.body.skipped).toEqual(expect.arrayContaining([{ reason: 'confirmed_by_owner', count: 1 }, { reason: 'product_with_pieces', count: 1 }, { reason: 'manual_or_other_source', count: 1 }]));
    expect(await h.prisma.cardProduct.count({ where: { cardId: c0 } })).toBe(0); // la del job: fuera
    expect(await h.prisma.priceReference.count({ where: { cardId: c0, source: 'tcgcsv_singles' } })).toBe(0);
    expect(await h.prisma.cardProduct.count({ where: { cardId: { in: [c1, c2, c3] } } })).toBe(3); // el resto: intacto
    expect((await h.prisma.priceReference.findFirstOrThrow({ where: { cardId: c1, isManualOverride: true } })).priceMxnCents).toBe(7777);
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: piece.id } })).status).toBe('listed'); // la pieza no se toca
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: G.setId }, select: { cardGroupId: true, cardGroupVia: true } })).toEqual({ cardGroupId: null, cardGroupVia: null });
    const au = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.auto_unlink', entityId: G.setId } });
    expect(au.actorUserId).not.toBeNull();
    expect(au.after).toMatchObject({ reason: 'reverted', unlinked: 1 });
    const q = Date.parse(r.body.quarantineUntil) - Date.now();
    expect(q).toBeGreaterThan(29 * 86_400_000);
    expect((await job.pickSets(50, new Date(Date.now() + 10 * 86_400_000), setIds)).some((s) => s.setId === G.setId)).toBe(false); // 30 días de cuarentena
    const ex = await h.api<any>('GET', '/admin/catalog/link-exceptions', { token: admin });
    expect(ex.body.sets.find((s: any) => s.setId === G.setId)).toMatchObject({ reason: 'reverted' });
    const again = await unlink(G.setId);
    expect([again.status, code(again)]).toEqual([429, 'RATE_LIMITED']);
  });
  it('§10.3 unlink sin enlaces del job (corrida con linked=0 / barrido) ⇒ 409 NOTHING_TO_UNLINK: sin cuarentena, sin auditoría de reversa, sin reclamo y el grupo no se toca; `aborted` de auto-link-runs es string|null', async () => {
    const idle = await h.prisma.cardSet.create({ data: { externalId: `ru-I-${run}`, name: `Sin enlaces del job ${run}`, cardGroupId: GG, cardGroupVia: 'auto' } });
    setIds.push(idle.id);
    const runId = randomUUID();
    await h.prisma.auditLog.create({ data: { actorUserId: null, action: 'catalog.auto_link', entityType: 'CardSet', entityId: idle.id, after: { setId: idle.id, runId, sweep: true, linked: 0, linkedCardIds: [], via: 'auto', groupId: GG } } });
    await h.prisma.auditLog.create({ data: { actorUserId: null, action: 'catalog.auto_link_run', entityType: 'CardSet', after: { runId, setsTried: 0, linked: 0, priced: 0, aborted: 'call_cap' } } });
    const r = await unlink(idle.id);
    expect([r.status, code(r)]).toEqual([409, 'NOTHING_TO_UNLINK']);
    expect(await h.prisma.auditLog.count({ where: { action: { in: ['catalog.auto_unlink', 'catalog.auto_unlink_claim'] }, entityId: idle.id } })).toBe(0);
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: idle.id }, select: { cardGroupVia: true } })).toEqual({ cardGroupVia: 'auto' });
    expect((await unlink(idle.id)).status).toBe(409); // repetible: no consume el cupo de 10 min
    const rr = await runs('?days=1');
    const mine = rr.body.runs.find((x: any) => x.runId === runId);
    expect(mine.aborted).toBe('call_cap');
    expect(rr.body.runs.every((x: any) => x.aborted === null || typeof x.aborted === 'string')).toBe(true);
    expect(rr.body.runs.some((x: any) => x.aborted === null)).toBe(true);
  });
});
