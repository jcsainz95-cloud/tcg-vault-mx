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
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => {
      if (g === 7_800_001) throw new Error('proveedor caído (prueba)');
      return (g >= 7_700_000 ? [{ productId: 9_000_000 + g, name: 'Nadie', number: '99/99' }] : []) as never;
    });
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

  it('m-1 + I-9: cada movimiento de dinero (venta/liquidación/reembolso/buylist/retiro…), estado, reserva y carta de 2 acabados se cuentan y NO cambian la pieza', async () => {
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

  it('I-14: pedido, envío y disputa excluyen CADA UNO por separado (pieza libre y sin reserva; solo ese vínculo real)', async () => {
    const buyer = await h.prisma.user.findFirstOrThrow({ where: { email: E2E_USERS.customer.email } });
    const card = await mkCard(await mkSet('real'), 4, ['holofoil']);
    const addr = { recipientName: 'C', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5500000000' };
    const money = { subtotalCents: 3000, processingFeeCents: 100, ivaCents: 0, totalCents: 3100, priceConvention: 'IVA_INCLUSIVE' as const, feeConvention: 'FEE_ON_TOP' as const };
    const mkOrder = (n: string) => h.prisma.order.create({ data: { userId: buyer.id, orderNumber: `CLG-${run}-${n}`, fulfillmentMode: 'vault', status: 'settled', settledAt: new Date(), paymentMethodLast4: '4242', ...money } });
    const order = await mkOrder('o');
    const withOrder = await mkItem(card);
    const oi = await h.prisma.orderItem.create({ data: { orderId: order.id, inventoryItemId: withOrder, cardSnapshot: { name: 'x' }, unitPriceCents: 1000 } });
    const withShipment = await mkItem(card);
    const sr = await h.prisma.shipmentRequest.create({ data: { userId: buyer.id, addressSnapshot: addr, status: 'enviado', shippingFeeCents: 0, priceConvention: 'IVA_INCLUSIVE', feeConvention: 'FEE_ON_TOP' } });
    await h.prisma.shipmentItem.create({ data: { shipmentRequestId: sr.id, inventoryItemId: withShipment } });
    const withDispute = await mkItem(card);
    const d = await h.prisma.dispute.create({ data: { userId: buyer.id, inventoryItemId: withDispute, status: 'abierta', description: 'x', deadlineAt: new Date(Date.now() + 86_400_000) } });
    try {
      for (const [id, reason] of [[withOrder, 'order'], [withShipment, 'shipment'], [withDispute, 'dispute']] as const) {
        const r = await correct([card]);
        expect(r.corrected).toBe(0);
        expect(await finishOf(id)).toBe('normal');
        expect(reasons(r)[reason]).toBeGreaterThanOrEqual(1);
      }
      const solo = await correct([card]);
      expect(reasons(solo)).toMatchObject({ order: 1, shipment: 1, dispute: 1 });
    } finally {
      await h.prisma.dispute.delete({ where: { id: d.id } });
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequestId: sr.id } });
      await h.prisma.shipmentRequest.delete({ where: { id: sr.id } });
      await h.prisma.orderItem.delete({ where: { id: oi.id } });
      await h.prisma.order.delete({ where: { id: order.id } });
    }
  });

  it('m-12/m-13: un set cuyo proveedor falla — 503 SIN consumir los 10 min; el fallo se registra, rota al final y tras 3 seguidos queda «pendiente con error» sin frenar el marcador', async () => {
    const sid = await mkSet('fail', undefined, '7800001');
    await mkCard(sid, 1, ['normal']);
    const call = () => h.api<{ code?: string }>('POST', '/admin/catalog/link-repair', { token: adminToken, json: { setId: sid } });
    expect((await call()).status).toBe(503);
    expect((await call()).status).toBe(503); // NO 429: el reclamo se devolvió
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.link_repair_claim', entityId: sid } })).toBe(0);
    const row = async () => {
      const u = (await h.api<{ unlinkedPrice: { sets: { setId: string; failedAttempts: number; pendingError: boolean; lastError: string | null }[] } }>('GET', '/admin/catalog/sync-status', { token: adminToken })).body.unlinkedPrice;
      return u.sets.find((x) => x.setId === sid)!;
    };
    expect(await row()).toMatchObject({ failedAttempts: 2, pendingError: false });
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.link_repair_deploy', 'catalog.link_repair_deploy_start'] } } });
    const first = await repair.run('deploy');
    expect(first.complete).toBe(false); // 3.er fallo aún no registrado: el set frena el marcador
    let r = first;
    for (let i = 0; i < 12 && !r.complete; i++) r = await repair.run('deploy');
    expect(r.complete).toBe(true);
    expect(await row()).toMatchObject({ pendingError: true, lastError: 'proveedor caído (prueba)' });
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.link_repair_deploy' } })).toBe(1);
  });
});
