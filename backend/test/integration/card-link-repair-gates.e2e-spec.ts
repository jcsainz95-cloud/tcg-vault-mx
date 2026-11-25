/**
 * card-link-repair-gates.e2e-spec.ts — §PRECIO-SIN-ENLACE tras gates (G3-1, m-1, I-3, m-3, I-9) contra Postgres REAL.
 * Propiedad: backend. Sin red: el cliente TCGCSV se espía. Cartas/sets propios (prefijo `clg-<run>`), limpiados al final.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CardLinkRepairService } from '../../src/modules/catalog/card-link-repair.service';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';

jest.setTimeout(120_000);

describe('E2E — §PRECIO-SIN-ENLACE tras gates', () => {
  let h: E2EHarness;
  let repair: CardLinkRepairService;
  let adminToken: string;
  const run = randomUUID().slice(0, 8);
  const setIds: string[] = [];
  const cardIds: string[] = [];
  const itemIds: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    repair = h.app.get(CardLinkRepairService);
    const client = h.app.get(TcgcsvCatalogClient);
    // Grupos 7 700 000+ (la prueba de rotación): UN producto que ninguna carta local casa (número 99) ⇒ el set es reparable,
    // se intenta y SIGUE pendiente (sin progreso), igual que un set real con colisiones.
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => (g >= 7_700_000 ? [{ productId: 9_000_000 + g, name: 'Nadie', number: '99/99' }] : []) as never);
    jest.spyOn(client, 'getPrices').mockImplementation(async (g: number) => (g >= 7_700_000 ? [{ productId: 9_000_000 + g, subTypeName: 'Normal', marketPrice: 1 }] : []) as never);
    jest.spyOn(client, 'listGroups').mockResolvedValue([]);
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      await h.prisma.auditLog.deleteMany({
        where: { action: { in: ['catalog.link_repair', 'catalog.link_repair_claim', 'catalog.link_repair_deploy', 'catalog.link_repair_deploy_start', 'inventory.finish_corrected'] } },
      });
      await h.close();
    }
  });

  async function mkSet(tag: string, externalId?: string, pptSetId?: string) {
    const s = await h.prisma.cardSet.create({ data: { externalId: externalId ?? `clg-${run}-${tag}`, name: `Gates ${tag} ${run}`, ...(pptSetId ? { pptSetId } : {}) } });
    setIds.push(s.id);
    return s.id;
  }
  async function mkCard(setId: string, n: number, finishes: ('normal' | 'holofoil' | 'reverse_holo')[]) {
    const c = await h.prisma.card.create({ data: { externalId: `clg-${run}-c-${randomUUID().slice(0, 6)}`, setId, name: `Carta ${n}`, number: String(n), availableFinishes: finishes } });
    cardIds.push(c.id);
    return c.id;
  }
  const shelf = async () => (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
  async function mkItem(cardId: string, over: Record<string, unknown> = {}) {
    const it = await h.prisma.inventoryItem.create({
      data: {
        folio: `CLG-${run}-${itemIds.length}`, cardId, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed',
        acquisitionType: 'compra', acquisitionCostCents: 5000, firstListedAt: new Date(), locationId: await shelf(), ...over,
      },
    });
    itemIds.push(it.id);
    return it.id;
  }
  const correct = (ids: string[]) =>
    (repair as unknown as { correctInventoryFinish(c: string[], t: string): Promise<{ corrected: number; excluded: { reason: string; count: number }[] }> }).correctInventoryFinish(ids, 'test');
  const finishOf = async (id: string) => (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { finish: true } })).finish;
  const reasons = (r: { excluded: { reason: string; count: number }[] }) => Object.fromEntries(r.excluded.map((e) => [e.reason, e.count]));

  it('G3-1: solo piezas de la PLATAFORMA cambian de acabado; la de un cliente en bóveda solo se cuenta (`customer_vault`) y no se toca', async () => {
    const card = await mkCard(await mkSet('own'), 1, ['holofoil']);
    const mine = await mkItem(card);
    const theirs = await mkItem(card, { ownerType: 'customer', ownerUserId: (await h.prisma.user.findFirstOrThrow({ where: { email: E2E_USERS.customer.email } })).id, ownershipStatus: 'pending', status: 'in_stock' });
    const r = await correct([card]);
    expect(r.corrected).toBe(1);
    expect(await finishOf(mine)).toBe('holofoil');
    expect(await finishOf(theirs)).toBe('normal');
    expect(reasons(r)).toEqual({ customer_vault: 1 });
    expect(await h.prisma.auditLog.count({ where: { action: 'inventory.finish_corrected', entityId: theirs } })).toBe(0);
  });

  it('m-1 + I-9: cada motivo de exclusión se cuenta y NO cambia la pieza (reembolso/buylist/venta/retiro, estado, reserva, pedido, envío, disputa, 2 acabados)', async () => {
    const card = await mkCard(await mkSet('excl'), 2, ['holofoil']);
    const two = await mkCard(await mkSet('two'), 3, ['holofoil', 'reverse_holo']);
    const expected: Record<string, string> = {};
    const withMove = async (reason: string) => {
      const id = await mkItem(card);
      await h.prisma.inventoryMovement.create({ data: { itemId: id, reason: reason as never, fromStatus: 'listed', toStatus: 'listed' } });
      return id;
    };
    const ids: string[] = [];
    for (const m of ['sale', 'settle', 'chargeback_return', 'replacement', 'withdrawal', 'refund_return', 'refund_release', 'buylist_convert']) {
      ids.push(await withMove(m));
      expected[`movement:${m}`] = '1';
    }
    ids.push(await mkItem(card, { status: 'reserved' })); // estado no corregible
    ids.push(await mkItem(card, { status: 'withdrawn' }));
    const order = await h.prisma.order.findFirstOrThrow({ select: { id: true } });
    ids.push(await mkItem(card, { reservedByOrderId: order.id })); // reservada por pedido
    const twoFin = await mkItem(two); // carta con 2 acabados ⇒ ambigua
    const r = await correct([card, two]);
    expect(r.corrected).toBe(0);
    for (const id of [...ids, twoFin]) expect(await finishOf(id)).toBe('normal');
    const got = reasons(r);
    for (const k of Object.keys(expected)) expect(got[k]).toBe(1);
    expect(got.status).toBe(2);
    expect(got.reserved).toBe(1);
    expect(got.ambiguous_finishes).toBe(1);
  });

  it('I-3/m-3: rotación — nunca más de 20 sets por corrida, ningún set se queda sin intento y el marcador solo sale al final', async () => {
    const mine: string[] = [];
    for (let i = 0; i < 25; i++) {
      const sid = await mkSet(`rot${i}`, undefined, String(7_700_000 + i));
      await mkCard(sid, 1, ['normal']);
      mine.push(sid);
    }
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.link_repair_deploy', 'catalog.link_repair_deploy_start'] } } });
    const first = await repair.run('deploy');
    expect(first.sets.length).toBeLessThanOrEqual(20);
    const attemptsOf = async (sid: string) => h.prisma.auditLog.count({ where: { action: 'catalog.link_repair', entityId: sid } });
    const afterFirst = (await Promise.all(mine.map(attemptsOf))).filter((n) => n > 0).length;
    expect(afterFirst).toBeLessThan(25); // con ≥ 25 sets mis pendientes no caben en una sola corrida
    if (first.complete) throw new Error('la 1.ª corrida no puede estar completa con >20 sets pendientes');
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.link_repair_deploy' } })).toBe(0);
    let r = first;
    for (let i = 0; i < 12 && !r.complete; i++) r = await repair.run('deploy');
    expect(r.complete).toBe(true);
    for (const sid of mine) expect(await attemptsOf(sid)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...(await Promise.all(mine.map(attemptsOf))))).toBeLessThanOrEqual(2); // los más viejos primero: nadie se repite antes de que todos corran
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.link_repair_deploy' } })).toBe(1);
  });

  it('m-3: sets `tcgcsv:` y sin grupo salen APARTE como «no ligables» con motivo y no cuentan como pendientes', async () => {
    const tcg = await mkSet('tcg', `tcgcsv:${900000 + Math.floor(Math.random() * 90000)}`);
    await mkCard(tcg, 1, ['normal']);
    const noGroup = await mkSet('nogroup');
    await mkCard(noGroup, 1, ['normal']);
    const first = await h.api<{ unlinkedPrice: { totalCards: number; sets: { setId: string }[]; notLinkable: { totalCards: number; sets: { setId: string; reason: string; unlinked: number; name: string }[] } } }>('GET', '/admin/catalog/sync-status', { token: adminToken });
    const u0 = first.body.unlinkedPrice;
    expect(u0.notLinkable.sets.find((s) => s.setId === tcg)).toMatchObject({ reason: 'tcgcsv_source', unlinked: 1 });
    expect(u0.sets.find((s) => s.setId === tcg)).toBeUndefined();
    // el set sin grupo se descubre al intentarlo (manual) y desde entonces sale como `no_group`
    const r = await h.api<{ notLinkable: string | null }>('POST', '/admin/catalog/link-repair', { token: adminToken, json: { setId: noGroup } });
    expect(r.status).toBe(200);
    expect(r.body.notLinkable).toBe('no_group');
    const u1 = (await h.api<{ unlinkedPrice: typeof u0 }>('GET', '/admin/catalog/sync-status', { token: adminToken })).body.unlinkedPrice;
    expect(u1.notLinkable.sets.find((s) => s.setId === noGroup)).toMatchObject({ reason: 'no_group' });
    expect(u1.sets.find((s) => s.setId === noGroup)).toBeUndefined();
    expect(u1.totalCards).toBe(u0.totalCards - 1);
    const tcgRun = await repair.run('manual');
    expect(tcgRun.sets.find((s) => s.setId === tcg)).toBeUndefined(); // los `tcgcsv:` nunca se recorren
  });
});
