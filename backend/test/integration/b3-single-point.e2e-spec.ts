/**
 * b3-single-point.e2e-spec.ts — 💰 §AUTO-ENLACE §12 contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *
 * Regla única de retención B3 (`shouldRetainTcgcsvPrice`): un set cuyo grupo resuelve `via:'b3'` (sin confirmar) y 0 referencias TCGCSV previas
 * ⇒ 0 `PriceReference` TCGCSV, 0 `ListingPrice` con precio y `/catalog/listings/:id` sin precio, por CADA escritor:
 *   price-ingest (POST /admin/jobs/price-ingest {setId}, el cron/catch-up = SchedulerService.process), job `catalog-auto-link`, `link-repair`,
 *   confirmación por carta. Rojo medido: dp1 (grupo B3 sin confirmar, enlaces ya hechos) ⇒ 250 precios por `price-ingest`.
 * Además: tcgdex NO cuenta como referencia previa; lo ya publicado se respeta y se actualiza; `confirm {groupId}` libera.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CatalogAutoLinkService } from '../../src/modules/catalog/catalog-auto-link.service';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { FxService } from '../../src/modules/pricing/fx.service';
import { PriceIngestService } from '../../src/modules/pricing/price-ingest.service';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { CardProductResolverService } from '../../src/modules/catalog/card-product-resolver.service';
import { StampedIngestService } from '../../src/modules/pricing/stamped-ingest.service';
import { TcgcsvGroupsCache } from '../../src/modules/catalog/tcgcsv-groups-cache';
import { SchedulerService } from '../../src/jobs/scheduler.service';

jest.setTimeout(240_000);

describe('E2E — §12 retención B3 en TODO escritor de PriceReference TCGCSV', () => {
  let h: E2EHarness;
  let admin: string;
  const run = randomUUID().slice(0, 8);
  const word = (s: string) => s.replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]);
  const W = word(run);
  const base = 960_000 + (parseInt(run.slice(0, 4), 16) % 4_000) * 20;
  const setIds: string[] = [];
  const cardIds: string[] = [];
  const itemIds: string[] = [];
  const groups: { groupId: number; name: string; publishedOn: string }[] = [];
  const productsOf = new Map<number, { productId: number; name: string; number: string }[]>();
  const day = (n: number) => new Date(new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10));
  let gseq = 0;
  let seq = 0;

  type Fx = { setId: string; cardIds: string[]; itemIds: string[]; groupId: number };
  /** Set B3 («Zorua…» + serie EX ⇒ solo la regla B3 resuelve «EX Zorua…»; el grupo «… Frontiers» deja ambigua la escalera por nombre). */
  async function mkB3(tag: string, n: number, opts: { linked: boolean; remoteNames?: boolean }): Promise<Fx> {
    gseq += 1;
    const groupId = base + gseq * 2;
    const T = `${W}${word(String(gseq))}`;
    groups.push({ groupId, name: `EX Zorua${T}`, publishedOn: '2020-01-01' }, { groupId: groupId + 1, name: `EX Zorua${T} Frontiers`, publishedOn: '2021-06-01' });
    const s = await h.prisma.cardSet.create({ data: { externalId: `b3sp-${tag}-${run}`, name: `Zorua${T}`, series: 'EX', releaseDate: '2020/01/01' } });
    setIds.push(s.id);
    const names = ['Pikachu', 'Eevee', 'Snorlax', 'Mewtwo', 'Gengar'];
    const cids: string[] = [];
    const iids: string[] = [];
    const prods: { productId: number; name: string; number: string }[] = [];
    for (let i = 0; i < n; i++) {
      const c = await h.prisma.card.create({ data: { externalId: `b3sp-${tag}-${run}-${i}`, setId: s.id, name: names[i % 5] + (i >= 5 ? ` ${i}` : ''), number: String(i + 1), availableFinishes: ['normal'] } });
      cids.push(c.id);
      cardIds.push(c.id);
      const productId = groupId * 100 + i + 1;
      prods.push({ productId, name: opts.remoteNames ? `Remoto ${i + 1}` : c.name, number: opts.remoteNames ? `${i + 1}/102` : String(i + 1) });
      if (opts.linked) await h.prisma.cardProduct.create({ data: { cardId: c.id, tcgplayerProductId: productId, kind: 'set_base', name: c.name, finishes: ['normal'] } });
      seq += 1;
      const it = await h.prisma.inventoryItem.create({
        data: { folio: `B3-${run}-${seq}`, cardId: c.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 1000, firstListedAt: new Date() },
      });
      iids.push(it.id);
      itemIds.push(it.id);
    }
    productsOf.set(groupId, prods);
    return { setId: s.id, cardIds: cids, itemIds: iids, groupId };
  }
  const tcgcsvRefs = (ids: string[]) => h.prisma.priceReference.count({ where: { cardId: { in: ids }, source: 'tcgcsv_singles' } });
  const listingRows = (ids: string[]) => h.prisma.listingPrice.count({ where: { inventoryItemId: { in: ids }, unitPriceCents: { not: null } } });
  /** El invariante de dinero: ni referencias TCGCSV, ni `ListingPrice` con precio, ni precio en `/catalog/listings/:id`. */
  async function expectNoTcgcsvPrice(f: Fx): Promise<void> {
    expect(await tcgcsvRefs(f.cardIds)).toBe(0);
    await h.app.get(ListingPriceService).run('manual_price', f.itemIds).catch(() => undefined);
    await h.app.get(ListingPriceService).idle();
    expect(await listingRows(f.itemIds)).toBe(0);
    for (const id of f.itemIds) {
      const r = await h.api<{ displayPriceCents?: number | null }>('GET', `/catalog/listings/${id}`);
      expect(r.body.displayPriceCents ?? null).toBeNull();
    }
  }
  /** `own` ⇒ la referencia TCGCSV cuelga del producto set_base de la carta (la «previa» de §13.1); `cardProductId` explícito ⇒ de otro producto. */
  const priorRef = async (cardId: string, source: 'tcgcsv_singles' | 'tcgdex', mxn: number, cardProductId?: string) => {
    const own = source === 'tcgcsv_singles' && cardProductId === undefined ? (await h.prisma.cardProduct.findFirst({ where: { cardId, kind: 'set_base' }, select: { id: true } }))?.id : cardProductId;
    return h.prisma.priceReference.create({ data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source, cardProductId: source === 'tcgcsv_singles' ? own : undefined, priceUsdCents: null, priceMxnCents: mxn, capturedDate: day(3), refKind: 'market' } as never });
  };
  const ingestSet = (setId: string) => h.api<any>('POST', '/admin/jobs/price-ingest', { token: admin, json: { setId } });
  const confirmGroup = (setId: string, groupId: number) => h.api<any>('POST', `/admin/catalog/link-exceptions/${setId}/confirm`, { token: admin, json: { groupId } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    // En el PROTOTIPO: el provider de price-ingest y el job de catálogo pueden tener instancias distintas del cliente (sin esto el provider hablaría con la red real).
    const client = TcgcsvCatalogClient.prototype;
    jest.spyOn(client, 'listGroups').mockImplementation(async () => groups as never);
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => (productsOf.get(g) ?? []) as never);
    jest.spyOn(client, 'getPrices').mockImplementation(async (g: number) => (productsOf.get(g) ?? []).map((p) => ({ productId: p.productId, subTypeName: 'Normal', marketPrice: 2 })) as never);
    jest.spyOn(h.app.get(FxService), 'getCurrent').mockResolvedValue({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' } as never);
    // El barrido «completo» (cron) no debe salir a la red por estimados ni por sellos.
    jest.spyOn(h.app.get(PriceIngestService), 'ingestGradedEstimates').mockResolvedValue({} as never);
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link_claim', 'catalog.auto_link_run', 'catalog.auto_link', 'catalog.link_repair', 'catalog.group_confirm_claim', 'catalog.group_confirmed', 'catalog.card_confirm_claim'] } } });
  });

  afterAll(async () => {
    if (h) {
      const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } });
      await h.prisma.listingPrice.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { OR: [{ cardId: { in: cardIds } }, { cardProductId: { in: cps.map((c) => c.id) } }] } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      await h.prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...cardIds, ...setIds] } }, { action: { in: ['catalog.auto_link_run', 'catalog.auto_link_claim', 'catalog.auto_link', 'catalog.link_repair', 'catalog.group_confirm_claim', 'catalog.group_confirmed', 'catalog.card_confirm_claim'] } }] } });
      await h.close();
    }
  });

  it('price-ingest POST /admin/jobs/price-ingest {setId} (dp1: enlaces hechos, grupo B3 sin confirmar, 0 referencias TCGCSV) ⇒ 0 PriceReference TCGCSV, 0 ListingPrice, sin precio en /catalog/listings', async () => {
    const f = await mkB3('P', 5, { linked: true });
    const r = await ingestSet(f.setId);
    expect(r.status).toBe(202);
    await expectNoTcgcsvPrice(f);
  });

  it('price-ingest por CRON/catch-up (SchedulerService.process = lo que corre la cola) ⇒ el mismo invariante', async () => {
    const f = await mkB3('C', 5, { linked: true });
    await h.app.get(SchedulerService).process({ name: 'price-ingest' });
    await expectNoTcgcsvPrice(f);
  });

  it('job catalog-auto-link ⇒ enlaza, no precia (0 PriceReference TCGCSV, 0 ListingPrice, sin precio en /catalog/listings)', async () => {
    const f = await mkB3('J', 3, { linked: false });
    const r = await h.app.get(CatalogAutoLinkService).run({ retryDelayMs: 0, onlySetIds: [f.setId], maxSets: 5 });
    expect(r.sets.find((x) => x.setId === f.setId)).toMatchObject({ linked: 3, priced: 0, reason: 'b3_unverified' });
    expect(await h.prisma.cardProduct.count({ where: { cardId: { in: f.cardIds } } })).toBe(3);
    await expectNoTcgcsvPrice(f);
  });

  it('link-repair POST /admin/catalog/link-repair {setId} ⇒ enlaza, no precia', async () => {
    const f = await mkB3('R', 3, { linked: false });
    const r = await h.api<any>('POST', '/admin/catalog/link-repair', { token: admin, json: { setId: f.setId } });
    expect(r.status).toBe(200);
    expect(await h.prisma.cardProduct.count({ where: { cardId: { in: f.cardIds } } })).toBe(3);
    await expectNoTcgcsvPrice(f);
  });

  it('confirmación POR CARTA en un set B3 sin confirmar ⇒ el enlace se escribe, el precio no', async () => {
    const f = await mkB3('K', 2, { linked: false, remoteNames: true });
    const pid = productsOf.get(f.groupId)![0].productId;
    const r = await h.api<any>('POST', `/admin/catalog/link-exceptions/${f.setId}/cards/${f.cardIds[0]}/confirm`, { token: admin, json: { productId: pid } });
    expect(r.status).toBe(200);
    expect(await h.prisma.cardProduct.count({ where: { cardId: f.cardIds[0] } })).toBe(1);
    await expectNoTcgcsvPrice(f);
  });

  it('«referencia previa» = SOLO TCGCSV: la variante con referencia TCGCSV se actualiza (3000 → 3600); la que solo tiene tcgdex NO se publica; lo ya publicado no se borra', async () => {
    const f = await mkB3('M', 3, { linked: true });
    await priorRef(f.cardIds[0], 'tcgcsv_singles', 3000);
    await priorRef(f.cardIds[1], 'tcgdex', 3000);
    expect((await ingestSet(f.setId)).status).toBe(202);
    expect(await h.prisma.priceReference.count({ where: { cardId: f.cardIds[0], source: 'tcgcsv_singles', priceMxnCents: 3600 } })).toBe(1);
    expect(await h.prisma.priceReference.count({ where: { cardId: f.cardIds[0], source: 'tcgcsv_singles', priceMxnCents: 3000 } })).toBe(1); // la previa sigue
    expect(await tcgcsvRefs([f.cardIds[1], f.cardIds[2]])).toBe(0);
    expect(await h.prisma.priceReference.count({ where: { cardId: f.cardIds[1], source: 'tcgdex' } })).toBe(1); // tcgdex intacta
    const ex = await h.api<any>('GET', '/admin/catalog/link-exceptions', { token: admin });
    expect(ex.body.sets.find((x: any) => x.setId === f.setId)).toMatchObject({ reason: 'b3_unverified', b3Published: 1, b3Held: 2 });
  });

  it('§13.1 la referencia de OTRO producto de la misma carta (liga/promo) NO libera la fila del grupo B3: 0 PriceReference del producto base en 11/11 cartas de 3/3 sets; la del otro producto queda intacta', async () => {
    let held = 0;
    let cards = 0;
    let setsOk = 0;
    for (const [tag, n] of [['o1', 5], ['o2', 3], ['o3', 3]] as const) {
      const f = await mkB3(tag, n, { linked: true });
      for (const cid of f.cardIds) {
        const promo = await h.prisma.cardProduct.create({ data: { cardId: cid, tcgplayerProductId: base * 1000 + 500_000 + (seq += 1), kind: 'promo', name: 'otro producto', finishes: ['normal'] } });
        await priorRef(cid, 'tcgcsv_singles', 2500, promo.id);
      }
      const baseCps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: f.cardIds }, kind: 'set_base' }, select: { id: true, cardId: true } });
      expect((await ingestSet(f.setId)).status).toBe(202);
      const withRef = await h.prisma.priceReference.findMany({ where: { cardProductId: { in: baseCps.map((c) => c.id) } }, select: { cardId: true } });
      held += baseCps.length - new Set(withRef.map((r) => r.cardId)).size;
      cards += baseCps.length;
      if (withRef.length === 0) setsOk += 1;
      expect(await h.prisma.priceReference.count({ where: { cardId: { in: f.cardIds }, source: 'tcgcsv_singles', priceMxnCents: 2500 } })).toBe(n); // las de «otro producto» siguen
    }
    expect({ held, cards, setsOk }).toEqual({ held: 11, cards: 11, setsOk: 3 });
  });

  it('§13.3 resolver SIN onlyUnlinked (sync de set / refresh-variants) sobre set B3 sin confirmar ⇒ enlaza, 0 precios; HTTP refresh-variants igual', async () => {
    const f = await mkB3('s', 3, { linked: false });
    const set = await h.prisma.cardSet.findUniqueOrThrow({ where: { id: f.setId }, select: { externalId: true } });
    const r = await h.app.get(CardProductResolverService).resolveCardProductsForSet(f.setId); // lo que llaman catalog-sync.service.ts:728 y :1647
    expect(r).toMatchObject({ joined: 3, pricesWritten: 0, b3Retained: 3 });
    expect(await tcgcsvRefs(f.cardIds)).toBe(0);
    await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: f.cardIds } } });
    const http = await h.api<any>('POST', '/admin/catalog/refresh-variants', { token: admin, json: { setId: set.externalId } });
    expect(http.status).toBe(200);
    expect(await h.prisma.cardProduct.count({ where: { cardId: { in: f.cardIds } } })).toBe(3);
    await expectNoTcgcsvPrice(f);
  });

  it('§13.2 stamped-ingest (grupos 1539 y 22880) sobre cartas de un set B3 sin confirmar ⇒ ni cuelga liga ni precia (omitted b3_unverified); con grupo confirmado SÍ', async () => {
    const f = await mkB3('L', 3, { linked: true });
    await h.prisma.cardSet.update({ where: { id: f.setId }, data: { printedTotal: 102 } });
    const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: f.cardIds } }, include: { card: true } });
    for (const cp of cps) await h.prisma.cardProduct.update({ where: { id: cp.id }, data: { name: `${cp.card.name} - ${cp.card.number.padStart(3, '0')}/102` } });
    const stamped = f.cardIds.map((_, i) => ({ productId: base * 1000 + 700_000 + i, name: `${['Pikachu', 'Eevee', 'Snorlax'][i]} - ${String(i + 1).padStart(3, '0')}/102 (League Challenge)`, number: `${String(i + 1).padStart(3, '0')}/102` }));
    const prices = stamped.map((p) => ({ productId: p.productId, subTypeName: 'Normal', marketPrice: 3 }));
    const svc = h.app.get(StampedIngestService);
    const g = await svc.ingestGroup(1539, stamped, prices, await svc.buildCatalogIndex(), { rate: 18, bufferPct: 0 });
    expect(g.log).toMatchObject({ colgados: 0, conPrecio: 0, omitted: [{ reason: 'b3_unverified', count: 3 }] });
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: { in: stamped.map((p) => p.productId) } } })).toBe(0);
    expect(await tcgcsvRefs(f.cardIds)).toBe(0);
    // attach/refresh de un producto ya colgado por otra vía tampoco precia en el set dudoso
    expect(await svc.writePrices(f.cardIds[0], cps[0].id, prices.slice(0, 1) as never, { rate: 18, bufferPct: 0 })).toEqual([]);
    expect(await tcgcsvRefs(f.cardIds)).toBe(0);
    // confirmado el grupo ⇒ la siguiente corrida sí cuelga y precia
    expect((await confirmGroup(f.setId, f.groupId)).status).toBe(200);
    const g2 = await svc.ingestGroup(1539, stamped, prices, await svc.buildCatalogIndex(), { rate: 18, bufferPct: 0 });
    expect(g2.log).toMatchObject({ colgados: 3, conPrecio: 3 });
  });

  it('§13 (barato) candidato B3 con la caché de grupos FRÍA lee grupos frescos: puntaje > 0 y fecha de publicación (no 0 / null)', async () => {
    const f = await mkB3('Q', 3, { linked: false });
    await h.app.get(CatalogAutoLinkService).run({ retryDelayMs: 0, onlySetIds: [f.setId], maxSets: 5 }); // deja la fila `b3_unverified` en la bitácora
    (h.app.get(TcgcsvGroupsCache) as unknown as { groups: unknown }).groups = null; // caché fría
    const ex = await h.api<any>('GET', '/admin/catalog/link-exceptions', { token: admin });
    const set = ex.body.sets.find((x: any) => x.setId === f.setId);
    expect(set.reason).toBe('b3_unverified');
    expect(set.candidates[0]).toMatchObject({ groupId: f.groupId, publishedOn: '2020-01-01' });
    expect(set.candidates[0].score).toBeGreaterThan(0);
  });

  it('`confirm {groupId}` libera: el grupo pasa a `confirmed` y price-ingest ya publica todo', async () => {
    const f = await mkB3('F', 3, { linked: true });
    expect((await ingestSet(f.setId)).status).toBe(202);
    expect(await tcgcsvRefs(f.cardIds)).toBe(0);
    const c = await confirmGroup(f.setId, f.groupId);
    expect(c.status).toBe(200);
    expect((await ingestSet(f.setId)).status).toBe(202);
    expect(await tcgcsvRefs(f.cardIds)).toBe(3);
    const ex = await h.api<any>('GET', '/admin/catalog/link-exceptions', { token: admin });
    expect(ex.body.sets.some((x: any) => x.setId === f.setId)).toBe(false);
  });
});
