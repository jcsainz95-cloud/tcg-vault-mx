/**
 * card-link-repair.e2e-spec.ts — 💰 §PRECIO-SIN-ENLACE (fase 1) contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *  - CA-1/CA-2: grupo REAL 24837 (30 productos): 30/30 con CardProduct y precio; Metagross 11 ⇒ Holofoil, USD 3.97.
 *  - CA-3: 2.ª corrida de `card-link-repair` = 0 filas escritas (CardProduct/PriceReference/Card sin cambio).
 *  - CA-4: ≥100 cartas ya enlazadas (3 sets + 5 dentro del set reparado): diff antes/después = 0.
 *  - CA-7: `GET /admin/catalog/sync-status` → `unlinkedPrice` (solo lectura local) baja a 0 para el set tras la corrida.
 *  - Auditoría `catalog.link_repair` + marcador de despliegue; corrección de piezas (opción A del dueño): libre ⇒ Holofoil con auditoría y costo intacto; reservada/con venta ⇒ NO cambia.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CardLinkRepairService } from '../../src/modules/catalog/card-link-repair.service';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { FxService } from '../../src/modules/pricing/fx.service';
import { parseTcgcsvCardName } from '../../src/modules/catalog/tcgcsv-card-name';
import fixture from '../fixtures/tcgcsv/group-24837-classic-collection.json';

jest.setTimeout(120_000);

describe('E2E — §PRECIO-SIN-ENLACE card-link-repair', () => {
  let h: E2EHarness;
  let adminToken: string;
  let repair: CardLinkRepairService;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  let setB: string | undefined;
  const otherSetIds: string[] = [];
  const cardIds: string[] = [];

  type Unlinked = { totalCards: number; sets: { setId: string; name: string; unlinked: number; total: number; collisions: number | null; omittedProducts: number | null; conflicts: number | null }[]; notLinkable: { totalCards: number; sets: { setId: string; name: string; unlinked: number; reason: string }[] } };
  const status = async () => (await h.api<{ unlinkedPrice: Unlinked }>('GET', '/admin/catalog/sync-status', { token: adminToken })).body.unlinkedPrice;

  async function snapshot(ids: string[]) {
    const cards = await h.prisma.card.findMany({ where: { id: { in: ids } }, select: { id: true, availableFinishes: true }, orderBy: { id: 'asc' } });
    const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: ids } }, orderBy: { tcgplayerProductId: 'asc' } });
    const prs = await h.prisma.priceReference.findMany({ where: { cardId: { in: ids } }, orderBy: { id: 'asc' } });
    return JSON.stringify({ cards, cps, prs });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    repair = h.app.get(CardLinkRepairService);
    // Sin red: el cliente TCGCSV y el FX se espían (mismas instancias que usa el resolver).
    const client = h.app.get(TcgcsvCatalogClient);
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => (g === 24837 ? fixture.products.map((p) => ({ productId: p.productId, name: p.name, number: p.number })) : []));
    jest.spyOn(client, 'getPrices').mockImplementation(async (g: number) => (g === 24837 ? (fixture.prices as never) : []));
    jest.spyOn(client, 'listGroups').mockResolvedValue([]);
    jest.spyOn(h.app.get(FxService), 'getCurrent').mockResolvedValue({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' } as never);

    setId = (await h.prisma.cardSet.create({ data: { externalId: `ccx-${run}`, name: `30th Celebration Classic Collection ${run}`, pptSetId: '24837' } })).id;
    for (const p of fixture.products) {
      const parsed = parseTcgcsvCardName(p.name, p.number);
      const name = (parsed.ok ? parsed.name : p.name).replace(/\s*\((Delta Species|Prime|Top|Bottom|Supporter)\)/i, '');
      const c = await h.prisma.card.create({
        data: { externalId: `ccx-${run}-${p.productId}`, setId, name, number: String(parseInt(p.number!.split('/')[0], 10)), availableFinishes: ['normal'] },
      });
      cardIds.push(c.id);
    }
    // Charizard #4 YA enlazada a SU producto (714372) con datos distintos a la fuente: la reparación NO debe tocarla.
    const chari = await h.prisma.card.findFirstOrThrow({ where: { setId, name: 'Charizard' } });
    const chariCp = await h.prisma.cardProduct.create({ data: { cardId: chari.id, tcgplayerProductId: 714372, kind: 'set_base', name: 'Charizard', finishes: ['normal'] } });
    await h.prisma.priceReference.create({
      data: { cardId: chari.id, cardProductId: chariCp.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', priceMxnCents: 4242, capturedDate: new Date(new Date().toISOString().slice(0, 10)), refKind: 'market' },
    });
    // Cartas YA enlazadas (CA-4): 3 sets × 34 + 5 dentro del set reparado (con productos ajenos al grupo).
    let pid = 800_000_000 + Math.floor(Math.random() * 90_000_000);
    const linked: { setId: string; n: number }[] = [
      ...[0, 1, 2].flatMap((k) => Array.from({ length: 34 }, (_, i) => ({ setId: `NEW${k}`, n: i }))),
      ...Array.from({ length: 5 }, (_, i) => ({ setId, n: 900 + i })),
    ];
    for (let k = 0; k < 3; k++) otherSetIds.push((await h.prisma.cardSet.create({ data: { externalId: `lnk${k}-${run}`, name: `Set ya enlazado ${k} ${run}` } })).id);
    for (const [i, l] of linked.entries()) {
      const sid = l.setId.startsWith('NEW') ? otherSetIds[Number(l.setId.slice(3))] : l.setId;
      const c = await h.prisma.card.create({ data: { externalId: `lnkc-${run}-${i}`, setId: sid, name: `Ya enlazada ${i}`, number: String(l.n), availableFinishes: ['normal', 'holofoil'] } });
      cardIds.push(c.id);
      pid += 1;
      const cp = await h.prisma.cardProduct.create({ data: { cardId: c.id, tcgplayerProductId: pid, kind: 'set_base', name: `Ya enlazada ${i}`, finishes: ['normal', 'holofoil'] } });
      await h.prisma.priceReference.create({
        data: { cardId: c.id, cardProductId: cp.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', priceMxnCents: 1000 + i, capturedDate: new Date(new Date().toISOString().slice(0, 10)), refKind: 'market' },
      });
    }
  });

  afterAll(async () => {
    if (h) {
      const allSets = [setId, ...otherSetIds, ...(setB ? [setB] : [])];
      // Hermético (I-10): se borra TODO lo que cuelga de los sets de esta suite (por set, no solo por los ids que se recuerdan).
      const inSets = (await h.prisma.card.findMany({ where: { setId: { in: allSets } }, select: { id: true } })).map((c) => c.id);
      cardIds.push(...inSets.filter((id) => !cardIds.includes(id)));
      await h.prisma.inventoryMovement.deleteMany({ where: { item: { cardId: { in: cardIds } } } });
      await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: allSets } } });
      await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.link_repair', 'catalog.link_repair_claim', 'catalog.link_repair_deploy', 'catalog.link_repair_deploy_start', 'inventory.finish_corrected'] } } });
      await h.close();
    }
  });

  it('CA-7 (línea base): sync-status trae unlinkedPrice con el set sin enlace (29/35), solo lectura local', async () => {
    const u = await status();
    const mine = u.sets.find((s) => s.setId === setId)!;
    expect(mine).toMatchObject({ unlinked: 29, total: 35, collisions: null, omittedProducts: null, conflicts: null });
    expect(u.totalCards).toBeGreaterThanOrEqual(30);
    expect(u.sets.map((s) => s.unlinked)).toEqual([...u.sets.map((s) => s.unlinked)].sort((a, b) => b - a));
    expect(JSON.stringify(u)).not.toMatch(/token|secret|password/i);
  });

  it('CA-1/CA-2/CA-4/CA-3: repara 29 + 1 ya enlazada = 30/30, Metagross 11 Holofoil con precio; 0 diferencias en 110 ya enlazadas (incl. Charizard del mismo grupo); 2.ª corrida = 0 cambios', async () => {
    const preLinked = (await h.prisma.card.findMany({ where: { id: { in: cardIds }, cardProducts: { some: {} } }, select: { id: true } })).map((c) => c.id);
    expect(preLinked.length).toBeGreaterThanOrEqual(100);
    const before = await snapshot(preLinked);
    // Pieza ya dada de alta como Normal sobre Metagross: SOLO se cuenta, no se migra.
    const meta = await h.prisma.card.findFirstOrThrow({ where: { setId, number: '11', name: 'Metagross' } });
    const shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    const mk = (n: number, extra: Record<string, unknown> = {}) =>
      h.prisma.inventoryItem.create({
        data: { folio: `CCX-${run}-00${n}`, cardId: meta.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 5000, firstListedAt: new Date(), locationId: shelf, ...extra },
      });
    const free = await mk(1); // libre ⇒ se corrige a Holofoil
    const reserved = await mk(2, { status: 'reserved' }); // reservada ⇒ solo se reporta
    const sold = await mk(3); // movimiento de venta ⇒ solo se reporta
    await h.prisma.inventoryMovement.create({ data: { itemId: sold.id, reason: 'sale', fromStatus: 'listed', toStatus: 'listed' } });

    const r = await repair.run('deploy');
    const mineRun = r.sets.find((s) => s.setId === setId)!;
    expect(mineRun).toMatchObject({ linked: 29, collisions: 0, conflicts: 0, omitted: [], notLinkable: null });
    expect(r.errors).toBe(0);
    expect(r.inventory).toEqual({ corrected: 1, excluded: 2, ambiguous: 0 });
    expect(mineRun.piecesExcluded.sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([{ reason: 'movement:sale', count: 1 }, { reason: 'status', count: 1 }]);
    const after = async (id: string) => h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { finish: true, status: true, acquisitionCostCents: true, acquisitionCostIvaCents: true } });
    expect(await after(free.id)).toMatchObject({ finish: 'holofoil', acquisitionCostCents: 5000, acquisitionCostIvaCents: 0 }); // costo intacto
    expect(await after(reserved.id)).toMatchObject({ finish: 'normal', status: 'reserved' }); // NO cambia
    expect(await after(sold.id)).toMatchObject({ finish: 'normal' }); // NO cambia
    const fa = await h.prisma.auditLog.findMany({ where: { action: 'inventory.finish_corrected', entityId: { in: [free.id, reserved.id, sold.id] } } });
    expect(fa).toHaveLength(1);
    expect(fa[0]).toMatchObject({ entityId: free.id, before: { finish: 'normal' }, after: { finish: 'holofoil', cardId: meta.id, reason: 'card-link-repair' } });

    const withCp = await h.prisma.card.count({ where: { setId, id: { in: cardIds }, cardProducts: { some: {} }, externalId: { startsWith: `ccx-${run}-` } } });
    expect(withCp).toBe(30);
    const prices = await h.prisma.priceReference.count({ where: { source: 'tcgcsv_singles', cardId: { in: cardIds }, card: { externalId: { startsWith: `ccx-${run}-` } } } });
    expect(prices).toBe(30);
    const m = await h.prisma.card.findUniqueOrThrow({ where: { id: meta.id }, include: { cardProducts: true, priceReferences: true } });
    expect(m.availableFinishes).toEqual(['holofoil']);
    expect(m.cardProducts.map((c) => c.tcgplayerProductId)).toEqual([716157]);
    expect(m.priceReferences[0]).toMatchObject({ finish: 'holofoil', priceUsdCents: 397, priceMxnCents: 7146 });
    // Genesect 11 colgó de SU producto, no del de Metagross.
    const gen = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: 716158 }, include: { card: true } });
    expect(gen.card.name).toBe('Genesect EX');

    // CA-4: ninguna de las ya enlazadas cambió (CardProduct, PriceReference, availableFinishes, updatedAt).
    expect(await snapshot(preLinked)).toBe(before);

    // Auditoría `catalog.link_repair` + marcador de despliegue.
    const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.link_repair', entityId: setId } });
    expect(audit.after).toMatchObject({ setId, linked: 29, collisions: 0, conflicts: 0, omitted: 0, trigger: 'deploy' });
    // Marcador: solo cuando TODO set reparable fue intentado (I-3); la BD compartida puede tener más de 20 pendientes ⇒ se rota.
    for (let i = 0; i < 6 && (await h.prisma.auditLog.count({ where: { action: 'catalog.link_repair_deploy' } })) === 0; i++) await repair.run('deploy');
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.link_repair_deploy' } })).toBe(1);

    // CA-3: 2.ª corrida = 0 filas escritas.
    const mine30 = [...cardIds];
    const snap1 = await snapshot(mine30);
    const r2 = await repair.run('manual');
    expect(r2.linked).toBe(0);
    expect(r2.inventory).toEqual({ corrected: 0, excluded: 0, ambiguous: 0 });
    expect(r2.linked).toBe(0);
    expect(await snapshot(mine30)).toBe(snap1);

    // CA-7: el set ya no aparece (unlinked = 0).
    const u = await status();
    expect(u.sets.find((s) => s.setId === setId)).toBeUndefined();
  });

  it('I-5 + I-4: POST /admin/catalog/link-repair {setId UUID local} — conflicto de dueño contado con motivo, 0 enlaces, no toca lo enlazado; 2.º intento = 429; 403/400/404', async () => {
    // Un set B con las MISMAS cartas: sus productos ya son de las cartas del set A ⇒ `product_owned_by_other`, nunca se mueven.
    setB = (await h.prisma.cardSet.create({ data: { externalId: `ccy-${run}`, name: `Copia ${run}`, pptSetId: '24837' } })).id;
    for (const p of fixture.products) {
      const parsed = parseTcgcsvCardName(p.name, p.number);
      const name = (parsed.ok ? parsed.name : p.name).replace(/\s*\((Delta Species|Prime|Top|Bottom|Supporter)\)/i, '');
      await h.prisma.card.create({ data: { externalId: `ccy-${run}-${p.productId}`, setId: setB, name, number: String(parseInt(p.number!.split('/')[0], 10)), availableFinishes: ['normal'] } });
    }
    const ownersBefore = await h.prisma.cardProduct.findMany({ where: { card: { setId } }, select: { tcgplayerProductId: true, cardId: true }, orderBy: { tcgplayerProductId: 'asc' } });
    const op = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const call = (token: string, body: unknown) => h.api<Record<string, unknown>>('POST', '/admin/catalog/link-repair', { token, json: body });
    expect((await call(op, { setId: setB })).status).toBe(403);
    expect((await call(adminToken, { setId: 'no-es-uuid' })).status).toBe(400);
    expect((await call(adminToken, { setId: randomUUID() })).status).toBe(404);
    const res = await call(adminToken, { setId: setB });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['collisions', 'conflicts', 'examples', 'linked', 'notLinkable', 'omitted', 'piecesCorrected', 'piecesExcluded', 'setId']);
    expect(res.body).toMatchObject({ setId: setB, linked: 0, notLinkable: null, piecesCorrected: 0 });
    expect(res.body.conflicts as number).toBeGreaterThanOrEqual(25);
    expect((res.body.examples as { reason: string }[])[0].reason).toBe('owner_conflict');
    expect((res.body.examples as unknown[]).length).toBeLessThanOrEqual(20);
    expect(await h.prisma.cardProduct.count({ where: { card: { setId: setB } } })).toBe(0);
    expect(await h.prisma.cardProduct.findMany({ where: { card: { setId } }, select: { tcgplayerProductId: true, cardId: true }, orderBy: { tcgplayerProductId: 'asc' } })).toEqual(ownersBefore);
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.link_repair', entityId: setB } })).toBe(1);
    // 1 corrida por set cada 10 min.
    const again = await call(adminToken, { setId: setB });
    expect(again.status).toBe(429);
    expect((again.body as { code?: string }).code ?? (again.body as { error?: { code?: string } }).error?.code).toBe('RATE_LIMITED');
    // `unlinkedPrice` trae el conflicto de la última corrida.
    expect((await status()).sets.find((x) => x.setId === setB)?.conflicts).toBeGreaterThanOrEqual(25);
  });
});
