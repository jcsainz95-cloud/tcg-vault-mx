/**
 * auto-link-job.e2e-spec.ts — 💰 §AUTO-ENLACE fase 2 (`catalog-auto-link`) contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *  AE-3/AE-5: la tanda liga y precia sola; 2.ª corrida el mismo día = 0 escrituras; 2 corridas a la vez ⇒ una se salta (candado).
 *  AE-6: topes (sets, cartas, llamadas), disyuntor tras 3 llamadas fallidas seguidas, fallo de proveedor ⇒ 0 escrituras parciales de ese set.
 *  Prioridad (piezas a la venta primero), espera 1/3/7 días sin progreso, dial `auto_link_enabled` (nace `on`), contador de sync-status.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CatalogAutoLinkService } from '../../src/modules/catalog/catalog-auto-link.service';
import { AUTO_LINK_PRICE_LOCK_KEY, autoLinkLockHeld } from '../../src/modules/catalog/auto-link-lock';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { FxService } from '../../src/modules/pricing/fx.service';
import { parseTcgcsvCardName } from '../../src/modules/catalog/tcgcsv-card-name';
import fixture from '../fixtures/tcgcsv/group-24837-classic-collection.json';

jest.setTimeout(180_000);

describe('E2E — §AUTO-ENLACE fase 2 catalog-auto-link', () => {
  let h: E2EHarness;
  let adminToken: string;
  let job: CatalogAutoLinkService;
  let client: TcgcsvCatalogClient;
  const run = randomUUID().slice(0, 8);
  const setIds: string[] = [];
  const cardIds: string[] = [];
  let setA: string; // fixture 24837 (grupo por pptSetId), 29 sin ligar + Charizard ligada
  let setNoGroup: string; // sin grupo resoluble ⇒ sin progreso
  let groupsCalls = 0;
  const productCalls: number[] = [];
  const failing = new Set<number>();
  // grupos sintéticos 910001..910004: 3 productos «Carta N» con número N
  const synth = (g: number) => [1, 2, 3].map((n) => ({ productId: g * 10 + n, name: `Carta ${g}-${n}`, number: String(n) }));
  const synthPrices = (g: number) => synth(g).map((p) => ({ productId: p.productId, subTypeName: 'Normal', marketPrice: 1.5 }));

  // §AUTO-ENLACE fase 4 — WotC: dos ediciones por producto, cada una con SU precio (USD).
  const wotcProducts = [{ productId: 9100051, name: 'Alakazam', number: '001/002' }, { productId: 9100052, name: 'Abra', number: '002/002' }, { productId: 9100053, name: 'Kadabra', number: '003/003' }];
  const wotcPrices = [
    { productId: 9100051, subTypeName: '1st Edition', marketPrice: 40 }, { productId: 9100051, subTypeName: 'Unlimited', marketPrice: 4 },
    { productId: 9100052, subTypeName: '1st Edition Holofoil', marketPrice: 100 }, { productId: 9100052, subTypeName: 'Unlimited Holofoil', marketPrice: 10 },
    { productId: 9100053, subTypeName: '1st Edition', marketPrice: 25 }, // solo 1.ª edición
  ];

  async function mkSet(tag: string, pptSetId: string | null, n = 0): Promise<string> {
    const s = await h.prisma.cardSet.create({ data: { externalId: `al-${tag}-${run}`, name: `AL ${tag} ${run}`, pptSetId } });
    setIds.push(s.id);
    for (let i = 1; i <= n; i++) {
      const c = await h.prisma.card.create({ data: { externalId: `al-${tag}-${run}-${i}`, setId: s.id, name: `Carta ${pptSetId}-${i}`, number: String(i), availableFinishes: ['normal'] } });
      cardIds.push(c.id);
    }
    return s.id;
  }
  const claimsClear = async () => h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link_claim', 'catalog.auto_link', 'catalog.auto_link_run', 'catalog.link_repair'] } } });
  async function snapshot(ids: string[]) {
    const cards = await h.prisma.card.findMany({ where: { id: { in: ids } }, select: { id: true, availableFinishes: true }, orderBy: { id: 'asc' } });
    const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: ids } }, orderBy: { tcgplayerProductId: 'asc' } });
    const prs = await h.prisma.priceReference.findMany({ where: { cardId: { in: ids } }, orderBy: { id: 'asc' } });
    return JSON.stringify({ cards, cps, prs });
  }
  const opts = { retryDelayMs: 0 };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    job = h.app.get(CatalogAutoLinkService);
    client = h.app.get(TcgcsvCatalogClient);
    jest.spyOn(client, 'listGroups').mockImplementation(async () => {
      groupsCalls += 1;
      return [{ groupId: 24837, name: '30th Celebration Classic Collection' }, ...[910001, 910002, 910003, 910004].map((g) => ({ groupId: g, name: `Grupo ${g}` }))];
    });
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => {
      productCalls.push(g);
      if (failing.has(g)) throw new Error('boom 503');
      if (g === 910005) return wotcProducts;
      return g === 24837 ? fixture.products.map((p) => ({ productId: p.productId, name: p.name, number: p.number })) : g >= 910001 ? synth(g) : [];
    });
    jest.spyOn(client, 'getPrices').mockImplementation(async (g: number) => (g === 910005 ? (wotcPrices as never) : g === 24837 ? (fixture.prices as never) : g >= 910001 ? (synthPrices(g) as never) : []));
    jest.spyOn(h.app.get(FxService), 'getCurrent').mockResolvedValue({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' } as never);
    // Solo mis sets compiten: el resto de cartas sin ligar de la semilla se deja sin grupo (sin llamadas) — se cuentan en `remaining*`.
    setA = await mkSet('A', '24837');
    setNoGroup = await mkSet('N', null, 4);
    for (const p of fixture.products) {
      const parsed = parseTcgcsvCardName(p.name, p.number);
      const name = (parsed.ok ? parsed.name : p.name).replace(/\s*\((Delta Species|Prime|Top|Bottom|Supporter)\)/i, '');
      const c = await h.prisma.card.create({ data: { externalId: `al-A-${run}-${p.productId}`, setId: setA, name, number: String(parseInt(p.number!.split('/')[0], 10)), availableFinishes: ['normal'] } });
      cardIds.push(c.id);
    }
    const chari = await h.prisma.card.findFirstOrThrow({ where: { setId: setA, name: 'Charizard' } });
    await h.prisma.cardProduct.create({ data: { cardId: chari.id, tcgplayerProductId: 714372, kind: 'set_base', name: 'Charizard', finishes: ['normal'] } });
    await claimsClear();
  });

  afterAll(async () => {
    if (h) {
      const inSets = (await h.prisma.card.findMany({ where: { setId: { in: setIds } }, select: { id: true } })).map((c) => c.id);
      cardIds.push(...inSets.filter((id) => !cardIds.includes(id)));
      await h.prisma.inventoryMovement.deleteMany({ where: { item: { cardId: { in: cardIds } } } });
      await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      await h.prisma.configSetting.deleteMany({ where: { key: 'auto_link_enabled' } });
      await claimsClear();
      await h.prisma.auditLog.deleteMany({ where: { action: 'inventory.finish_corrected' } });
      await h.close();
    }
  });

  it('dial `auto_link_enabled` nace ENCENDIDO (default `on`); apagado ⇒ 0 escrituras y ni una llamada', async () => {
    const dial = await h.api<Record<string, unknown>>('GET', '/admin/settings', { token: adminToken });
    expect(JSON.stringify(dial.body)).toMatch(/auto_?[lL]ink_?[eE]nabled/);
    await h.prisma.configSetting.upsert({ where: { key: 'auto_link_enabled' }, create: { key: 'auto_link_enabled', valueJson: 'off' as never, updatedBy: 'test' }, update: { valueJson: 'off' as never, updatedBy: 'test' } });
    const before = await snapshot(cardIds);
    const calls = groupsCalls;
    const r = await job.run(opts);
    expect(r).toMatchObject({ ran: false, skipped: 'dial_off' });
    expect(groupsCalls).toBe(calls);
    expect(await snapshot(cardIds)).toBe(before);
    expect(await h.prisma.auditLog.count({ where: { action: { in: ['catalog.auto_link', 'catalog.auto_link_run'] } } })).toBe(0);
    await h.prisma.configSetting.deleteMany({ where: { key: 'auto_link_enabled' } });
  });

  it('prioridad: un set con pieza a la venta sobre carta sin ligar va primero aunque tenga menos cartas sin ligar', async () => {
    const shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    const c = await h.prisma.card.findFirstOrThrow({ where: { setId: setNoGroup } });
    const item = await h.prisma.inventoryItem.create({
      data: { folio: `AL-${run}-001`, cardId: c.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 5000, firstListedAt: new Date(), locationId: shelf },
    });
    const order = await job.pickSets(50);
    const ids = order.map((o) => o.setId);
    expect(ids.indexOf(setNoGroup)).toBeLessThan(ids.indexOf(setA)); // A tiene 29 sin ligar, N solo 4 (con pieza)
    expect(order.find((o) => o.setId === setNoGroup)!.pieces).toBe(1);
    await h.prisma.inventoryItem.delete({ where: { id: item.id } });
  });

  it('AE-3/AE-5/AE-6: la tanda liga y precia sola (actorUserId=null), ≤ topes, sin grupo ⇒ sin progreso con espera 1 día; 2.ª corrida = 0 escrituras', async () => {
    const before = productCalls.length;
    const r = await job.run(opts);
    expect(r.ran).toBe(true);
    const mine = r.sets.find((s) => s.setId === setA)!;
    expect(mine.linked).toBe(29);
    expect(mine.priced).toBeGreaterThan(0);
    expect(r.tcgcsvCalls).toBeLessThanOrEqual(40);
    expect(r.setsTried).toBeLessThanOrEqual(8);
    expect(r.remainingAfter).toBeLessThan(r.remainingBefore);
    expect(r.remainingBefore - r.remainingAfter).toBe(r.linked);
    expect(productCalls.length - before).toBeGreaterThanOrEqual(1);
    expect(await h.prisma.card.count({ where: { setId: setA, cardProducts: { none: {} } } })).toBe(0);
    expect(await h.prisma.priceReference.count({ where: { card: { setId: setA }, source: 'tcgcsv_singles' } })).toBeGreaterThan(0);
    const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.auto_link', entityId: setA } });
    expect(audit.actorUserId).toBeNull();
    expect(audit.after).toMatchObject({ setId: setA, groupId: 24837, linked: 29, collisions: 0 });
    const noGroup = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.auto_link', entityId: setNoGroup } });
    expect(noGroup.after).toMatchObject({ linked: 0, noProgress: true, reason: 'group_none' });
    const next = Date.parse((noGroup.after as { nextAttemptAt: string }).nextAttemptAt);
    expect(next - Date.now()).toBeGreaterThan(0);
    expect(next - Date.now()).toBeLessThanOrEqual(86_400_000);
    const run1 = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.auto_link_run' } });
    expect(run1.actorUserId).toBeNull();
    expect(run1.after).toMatchObject({ setsTried: r.setsTried, linked: r.linked, tcgcsvCalls: r.tcgcsvCalls });

    // 2.ª corrida el mismo día: 1 reclamo por set y día ⇒ 0 escrituras en estructura/precios.
    const snap = await snapshot(cardIds);
    const r2 = await job.run(opts);
    expect(r2.setsTried).toBe(0);
    expect(r2.linked).toBe(0);
    expect(await snapshot(cardIds)).toBe(snap);
  });

  it('espera sin progreso: 1 → 3 → 7 → 7 días (por racha de intentos sin progreso); con progreso la racha se reinicia', async () => {
    const mkAttempt = async (noProgress: boolean, tries: number, days: number, at: Date) =>
      h.prisma.auditLog.create({ data: { action: 'catalog.auto_link', entityType: 'CardSet', entityId: setNoGroup, createdAt: at, after: { noProgress, tries, nextAttemptAt: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + days)).toISOString() } } });
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link', 'catalog.auto_link_claim'] }, entityId: setNoGroup } });
    const t0 = new Date(Date.UTC(2026, 0, 10, 5));
    await mkAttempt(true, 1, 1, t0);
    const day = (n: number) => new Date(Date.UTC(2026, 0, 10 + n, 5));
    // En t0 + 12 h todavía espera; en t0 + 1 día (05:00) ya es elegible.
    expect((await job.pickSets(50, new Date(t0.getTime() + 12 * 3_600_000))).some((o) => o.setId === setNoGroup)).toBe(false);
    const again = (await job.pickSets(50, day(1))).find((o) => o.setId === setNoGroup);
    expect(again?.previousNoProgress).toBe(1); // la siguiente espera será de 3 días
    const { backoffDays } = await import('../../src/modules/catalog/catalog-auto-link.service');
    expect([0, 1, 2, 3, 9].map(backoffDays)).toEqual([1, 3, 7, 7, 7]);
    await mkAttempt(false, 0, 0, day(1)); // progreso ⇒ racha 0
    expect((await job.pickSets(50, day(2))).find((o) => o.setId === setNoGroup)?.previousNoProgress).toBe(0);
  });

  it('AE-6: tope de llamadas (listGroups cuenta; un set = 2) y tope de sets', async () => {
    await claimsClear();
    const s1 = await mkSet('B1', '910001', 3);
    const s2 = await mkSet('B2', '910002', 3);
    const s3 = await mkSet('B3', '910003', 3);
    // 1 (listGroups) + 2×k ≤ maxCalls=4 ⇒ solo 1 set completo (3 llamadas), el siguiente no cabe (queda 1 < 2).
    const r = await job.run({ ...opts, maxCalls: 4, maxSets: 8 });
    expect(r.tcgcsvCalls).toBeLessThanOrEqual(4);
    expect(r.aborted).toBe('call_cap');
    // Los sets sin grupo no gastan llamadas (cuentan como intento); de los míos, solo UNO se ligó antes de agotar el tope.
    expect([s1, s2, s3].filter((id) => r.sets.some((x) => x.setId === id && x.linked === 3))).toHaveLength(1);
    const r2 = await job.run({ ...opts, maxSets: 1 });
    expect(r2.setsTried).toBe(1);
    expect([s1, s2, s3].length).toBe(3);
  });

  it('AE-6: tope de cartas ligadas por tanda (el resto queda para mañana, sin perderse)', async () => {
    await claimsClear();
    const s = await mkSet('C1', '910004', 3);
    const r = await job.run({ ...opts, maxCards: 2 });
    const mine = r.sets.find((x) => x.setId === s);
    expect(r.linked).toBeLessThanOrEqual(2);
    if (mine) expect(mine.linked).toBeLessThanOrEqual(2);
    expect(await h.prisma.card.count({ where: { setId: s, cardProducts: { none: {} } } })).toBeGreaterThanOrEqual(1);
  });

  it('AE-6: disyuntor — 3 llamadas fallidas seguidas abortan la corrida; el set que falló no deja escrituras y NO se reintenta el mismo día', async () => {
    await claimsClear();
    const f1 = await mkSet('F1', '910001', 3);
    const f2 = await mkSet('F2', '910002', 3);
    const f3 = await mkSet('F3', '910003', 3);
    const f4 = await mkSet('F4', '910004', 3);
    for (const g of [910001, 910002, 910003, 910004]) failing.add(g);
    const fs = [f1, f2, f3, f4];
    const snap = await snapshot(cardIds);
    const r = await job.run({ ...opts });
    failing.clear();
    expect(r.aborted).toBe('circuit_open');
    const tried = r.sets.filter((s) => fs.includes(s.setId));
    expect(tried.length).toBeGreaterThanOrEqual(1);
    expect(tried.length).toBeLessThanOrEqual(3);
    expect(tried.every((s) => s.error && s.linked === 0)).toBe(true);
    expect(await snapshot(cardIds)).toBe(snap); // 0 escrituras parciales
    // Mismo día: los reclamos consumidos impiden reintentar (mañana sigue).
    const r2 = await job.run(opts);
    expect(r2.sets.filter((s) => tried.some((t) => t.setId === s.setId))).toHaveLength(0);
  });

  it('AE-5: candado compartido — con el candado tomado la corrida se salta (y lo deja anotado); price-ingest lo ve; el reintento de las 09:30 corre una vez', async () => {
    await claimsClear();
    let release!: () => void;
    const held = new Promise<void>((res) => (release = res));
    let locked!: () => void;
    const lockedP = new Promise<void>((res) => (locked = res));
    const holder = h.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUTO_LINK_PRICE_LOCK_KEY}::bigint)`;
      locked();
      await held;
    }, { timeout: 60_000 });
    await lockedP;
    try {
      expect(await autoLinkLockHeld(h.prisma)).toBe(true);
      const r = await job.run(opts);
      expect(r).toMatchObject({ ran: false, skipped: 'lock_taken' });
      expect(await h.prisma.auditLog.count({ where: { action: 'catalog.auto_link_run' } })).toBe(1);
    } finally {
      release();
      await holder;
    }
    expect(await autoLinkLockHeld(h.prisma)).toBe(false);
    const retry = await job.run({ ...opts, trigger: 'retry' });
    expect(retry.ran).toBe(true);
    // Una vez: si ya hubo una corrida completa hoy, el reintento no hace nada.
    expect(await job.run({ ...opts, trigger: 'retry' })).toMatchObject({ ran: false, skipped: 'nothing_to_retry' });
  });

  it('AE-5: 1 reclamo por (set, día UTC) — tres reclamos simultáneos del mismo set ⇒ solo uno pasa', async () => {
    await claimsClear();
    const claim = (job as unknown as { claim: (id: string) => Promise<boolean> }).claim.bind(job);
    const got = await Promise.all([claim(setNoGroup), claim(setNoGroup), claim(setNoGroup)]);
    expect(got.filter(Boolean)).toHaveLength(1);
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.auto_link_claim', entityId: setNoGroup } })).toBe(1);
  });

  it('fase 4 (Q1 = A): un set WotC se liga y precia con SUS DOS ediciones, cada una con su precio; las cartas ofrecen first_edition', async () => {
    await claimsClear();
    const sid = (await h.prisma.cardSet.create({ data: { externalId: `al-W-${run}`, name: `AL WotC ${run}`, pptSetId: '910005' } })).id;
    setIds.push(sid);
    const c1 = await h.prisma.card.create({ data: { externalId: `al-W-${run}-1`, setId: sid, name: 'Alakazam', number: '1', availableFinishes: ['normal'] } });
    const c2 = await h.prisma.card.create({ data: { externalId: `al-W-${run}-2`, setId: sid, name: 'Abra', number: '2', availableFinishes: ['holofoil'] } });
    const c3 = await h.prisma.card.create({ data: { externalId: `al-W-${run}-3`, setId: sid, name: 'Kadabra', number: '3', availableFinishes: ['normal'] } });
    cardIds.push(c1.id, c2.id, c3.id);
    // Una pieza «Normal» sobre una carta que TCGCSV solo ofrece como 1st Edition: la reparación NO la pasa a 1.ª edición sola (se decide en finish-review).
    const shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    const piece = await h.prisma.inventoryItem.create({
      data: { folio: `ALW-${run}-001`, cardId: c3.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 5000, firstListedAt: new Date(), locationId: shelf },
    });
    const r = await job.run({ ...opts, maxSets: 50, maxCalls: 200 });
    expect([r.sets.find((x) => x.setId === sid), r.aborted, r.setsTried]).toEqual([expect.objectContaining({ linked: 3 }), undefined, expect.anything()]);
    const cards = await h.prisma.card.findMany({ where: { id: { in: [c1.id, c2.id] } }, orderBy: { number: 'asc' }, select: { availableFinishes: true } });
    expect(cards.map((c) => c.availableFinishes)).toEqual([['normal', 'first_edition'], ['holofoil', 'first_edition_holofoil']]);
    const px = await h.prisma.priceReference.findMany({ where: { cardId: { in: [c1.id, c2.id, c3.id] }, source: 'tcgcsv_singles' }, select: { cardId: true, finish: true, priceUsdCents: true } });
    const by = (cid: string, f: string) => px.find((p) => p.cardId === cid && p.finish === f)?.priceUsdCents;
    expect([by(c1.id, 'normal'), by(c1.id, 'first_edition'), by(c2.id, 'holofoil'), by(c2.id, 'first_edition_holofoil')]).toEqual([400, 4000, 1000, 10000]);
    expect(px).toHaveLength(5); // + la 1.ª edición sola de Kadabra
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: piece.id } })).finish).toBe('normal'); // NO se cambió sola
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: c3.id }, select: { availableFinishes: true } })).availableFinishes).toEqual(['first_edition']);
    expect(await h.prisma.auditLog.count({ where: { action: 'inventory.finish_corrected', entityId: piece.id } })).toBe(0);
    await h.prisma.inventoryItem.delete({ where: { id: piece.id } });
  });

  it('contador: sync-status.summary (quedan X · ayer Y), solo lectura local', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    await h.prisma.auditLog.create({ data: { action: 'catalog.auto_link_run', entityType: 'CardSet', createdAt: yesterday, after: { linked: 7, priced: 5 } } });
    const res = await h.api<{ autoLink: Record<string, unknown>; summary?: unknown }>('GET', '/admin/catalog/sync-status', { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.autoLink).toMatchObject({ autoLinkEnabled: true, waitingDecision: 0 });
    expect(Number(res.body.autoLink.unlinkedCards)).toBeGreaterThanOrEqual(0);
    expect(Number(res.body.autoLink.repairedYesterday)).toBeGreaterThanOrEqual(7);
    expect(Number(res.body.autoLink.pricedYesterday)).toBeGreaterThanOrEqual(5);
    expect(typeof res.body.autoLink.nextRunAt).toBe('string');
    expect(new Date(res.body.autoLink.nextRunAt as string).getUTCHours()).toBe(5);
  });
});
