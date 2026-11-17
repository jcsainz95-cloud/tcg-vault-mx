/**
 * pattern-reclassify.e2e-spec.ts — §PRICE-PATTERN (docs/DECISIONES.md) contra Postgres REAL: versiones alternas «(… Pattern/Ball)» fuera del
 * precio base; desempate determinista; job `pattern-reclassify` idempotente, con auditoría y freno. Propiedad: backend.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { PatternReclassifyService } from '../../src/modules/pricing/pattern-reclassify.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { isVariantProductName, VARIANT_PRODUCT_PREFILTER_LIKE } from '../../src/common/variant-product';
import * as fixture from '../fixtures/tcgcsv-variant-names.json';
import { Prisma } from '@prisma/client';

jest.setTimeout(180_000);

describe('E2E — §PRICE-PATTERN', () => {
  let h: E2EHarness;
  let job: PatternReclassifyService;
  let pricing: PricingService;
  let lp: ListingPriceService;
  const run = randomUUID().slice(0, 8);
  const cardIds: string[] = [];
  let setId = '';
  let pid = 700_000_000 + Math.floor(Math.random() * 90_000_000);
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const key = (cardId: string, finish: string) => ({ cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish: finish as 'holofoil' });

  async function card(n: string, finishes: ('normal' | 'holofoil' | 'reverse_holo')[], name = `Noctowl ${run} ${n}`) {
    const baseId = (pid += 1_000_000);
    const c = await h.prisma.card.create({
      data: { externalId: `pp-${run}-${n}`, setId, name, number: n, rarity: 'Common', rarityCanonical: 'Common', availableFinishes: finishes, tcgplayerId: String(baseId) },
    });
    cardIds.push(c.id);
    return { id: c.id, baseId, name };
  }
  /** Un `CardProduct` + una PriceReference de mercado por acabado (MXN en centavos). */
  async function product(c: { id: string }, extId: number, name: string, prices: Partial<Record<'normal' | 'holofoil' | 'reverse_holo', number>>, uuid?: string, kind: 'set_base' | 'variant' = 'set_base') {
    const cp = await h.prisma.cardProduct.create({
      data: { ...(uuid ? { id: uuid } : {}), cardId: c.id, tcgplayerProductId: extId, kind, name, finishes: Object.keys(prices) as ('holofoil')[] },
    });
    for (const [finish, cents] of Object.entries(prices)) {
      await h.prisma.priceReference.create({
        data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: finish as 'holofoil', cardProductId: cp.id, source: 'tcgcsv_singles', priceMxnCents: cents!, priceUsdCents: null, capturedDate: today(), evidenceDate: today(), refKind: 'market' },
      });
    }
    return cp;
  }
  const refOf = async (cardId: string, finish: string) => (await pricing.getReferencesBatch([key(cardId, finish)])).get(`${cardId}|raw|raw:NM|${finish}`);

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    job = h.app.get(PatternReclassifyService);
    pricing = h.app.get(PricingService);
    lp = h.app.get(ListingPriceService);
    setId = (await h.prisma.cardSet.create({ data: { externalId: `pp-${run}`, name: `Set PP ${run}` } })).id;
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      const items = (await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } })).map((i) => i.id);
      await h.prisma.listingPrice.deleteMany({ where: { inventoryItemId: { in: items } } });
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: items } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
      await h.prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: cardIds } }, { entityId: { startsWith: 'pp-' } }, { action: 'pricing.pattern_reclassify_halted' }] } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  it('el pre-filtro ILIKE de Postgres es un SUPERCONJUNTO del clasificador (también con acentos): jamás se escapa una variante', async () => {
    const names = [...fixture.variant, ...fixture.notVariant, 'Noctowl (Poké Ball Pattern)', 'Noctowl (POKÉ BALL PATTERN)', 'X (Énergie Symbol Pattern)', 'Pikachu (Pokéball)'];
    const rows = await h.prisma.$queryRaw<{ n: string; hit: boolean }[]>(Prisma.sql`
      SELECT n, (n ILIKE ANY (${VARIANT_PRODUCT_PREFILTER_LIKE as string[]})) AS hit FROM unnest(${names}::text[]) AS t(n)`);
    const escaped = rows.filter((r) => isVariantProductName(r.n) && !r.hit).map((r) => r.n);
    expect(escaped).toEqual([]);
    expect(rows.filter((r) => isVariantProductName(r.n)).length).toBeGreaterThanOrEqual(fixture.variant.length);
  });

  it('⭐ en un combo con `variant` la lectura devuelve SIEMPRE la base (US$0.16), no el patrón (US$8.22) ni otro producto del montón, con 20 juegos de uuid (k/N)', async () => {
    let ok = 0;
    const N = 20;
    for (let i = 0; i < N; i++) {
      const c = await card(`perm${i}`, ['holofoil']);
      const u = [randomUUID(), randomUUID(), randomUUID(), randomUUID()].sort();
      const order = i % 2 === 0 ? [3, 2, 1, 0] : [0, 1, 2, 3];
      // la mitad de las veces los ids EXTERNOS de los demás productos son MENORES que el de la base (la preferencia, no el orden de ids, debe ganar)
      const off = i % 4 < 2 ? 100_000 : -100_000;
      await product(c, c.baseId, c.name, { holofoil: 305 }, u[order[0]]);
      await product(c, c.baseId + off, `${c.name} Deck Edition`, { holofoil: 839 }, u[order[1]]); // otro set_base «del montón» (más caro)
      await product(c, c.baseId + 2 * off, `${c.name} (Master Ball Pattern)`, { holofoil: 15663 }, u[order[2]], 'variant');
      await product(c, c.baseId + 3 * off, `${c.name} (Poke Ball Pattern)`, { holofoil: 600 }, u[order[3]], 'variant');
      if ((await refOf(c.id, 'holofoil'))?.referenceMxnCents === 305) ok += 1;
    }
    expect(`${ok}/${N}`).toBe(`${N}/${N}`);
  });

  it('⭐ NO-REGRESIÓN (gates qa B1 / PP-1): 120 cartas con base + «(Cosmos Holo)»/«(GYM)»/«(Secret)»/«(30th Celebration)» SIN variant ⇒ el MISMO ganador que antes (el uuid más chico), 0 pendientes nuevos', async () => {
    const suffixes = ['Cosmos Holo', 'GYM', 'Secret', '30th Celebration'];
    let same = 0;
    let pending = 0;
    const N = 120;
    for (let i = 0; i < N; i++) {
      const c = await card(`nr${i}`, ['holofoil']);
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const prices = [305 + i, (305 + i) * 3, (305 + i) * 9]; // difieren > 25 % a propósito: la ambigüedad NUEVA habría dejado estas cartas pendientes
      await product(c, c.baseId, c.name, { holofoil: prices[0] }, ids[0]);
      await product(c, c.baseId + 1, `${c.name} (${suffixes[i % 4]})`, { holofoil: prices[1] }, ids[1]);
      await product(c, c.baseId + 2, `${c.name} (${suffixes[(i + 1) % 4]})`, { holofoil: prices[2] }, ids[2]);
      const legacyWinner = prices[ids.indexOf([...ids].sort()[0])]; // el comportamiento ANTERIOR: gana el uuid lexicográficamente menor
      const got = (await refOf(c.id, 'holofoil'))?.referenceMxnCents;
      if (got === undefined) pending += 1;
      if (got === legacyWinner) same += 1;
    }
    expect([`${same}/${N}`, pending]).toEqual([`${N}/${N}`, 0]);
    // y el job no toca ninguna de ellas
    const r = await job.run();
    expect(r.ambiguous).toBe(0);
    expect(await h.prisma.cardProduct.count({ where: { card: { externalId: { startsWith: `pp-${run}-nr` } }, kind: 'variant' } })).toBe(0);
  });

  let A: Awaited<ReturnType<typeof card>>;
  let pieceA = '';
  it('job: reclasifica a variant, quita el acabado fantasma, recalcula lo ya publicado y lo AUDITA; segunda corrida = 0 cambios', async () => {
    A = await card('A', ['normal', 'holofoil', 'reverse_holo']);
    await product(A, A.baseId, A.name, { holofoil: 305, reverse_holo: 400 });
    await product(A, A.baseId + 1, `${A.name} (Poke Ball Pattern)`, { holofoil: 839 });
    await product(A, A.baseId + 2, `${A.name} (Master Ball Pattern)`, { holofoil: 15663, normal: 2000 }); // y un acabado «normal» que solo trae el patrón
    // pieza publicada con el precio INFLADO del defecto (MX$224) ya guardado en `ListingPrice`
    const item = await h.prisma.inventoryItem.create({
      data: { folio: `PP-${run}-A`, cardId: A.id, productType: 'raw', rawCondition: 'NM', finish: 'holofoil', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 1000 },
    });
    pieceA = item.id;
    const listingRun = await h.prisma.listingPriceRun.create({ data: { businessDate: today(), trigger: 'daily', status: 'ok', scopeItemCount: 1 } });
    await h.prisma.listingPrice.create({
      data: { inventoryItemId: item.id, variantKey: `${A.id}|raw|raw:NM|holofoil`, runId: listingRun.id, status: 'priced', unitPriceCents: 22400, listPriceCents: 18500, ivaRatePct: 16, ivaTransferPct: 100, computedAt: new Date() },
    });
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: A.id } })).availableFinishes).toEqual(expect.arrayContaining(['normal']));

    const r1 = await job.run();
    expect(r1).toMatchObject({ halted: false });
    expect(r1.reclassified).toBeGreaterThanOrEqual(2);
    const kinds = (await h.prisma.cardProduct.findMany({ where: { cardId: A.id }, orderBy: { tcgplayerProductId: 'asc' } })).map((p) => p.kind);
    expect(kinds).toEqual(['set_base', 'variant', 'variant']);
    // availableFinishes ya no incluye el acabado que solo traía el patrón
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: A.id } })).availableFinishes).toEqual(['reverse_holo', 'holofoil']); // orden canónico de acabados
    // el precio publicado se recalculó y la corrección quedó auditada
    const after = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: pieceA } });
    expect(after.unitPriceCents).not.toBeNull();
    expect(after.unitPriceCents!).toBeLessThan(5000);
    const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'pricing.pattern_correction', entityId: A.id } });
    expect(audit.after).toMatchObject({ cardId: A.id, finish: 'holofoil', fromCents: 22400, toCents: after.unitPriceCents, productId: A.baseId });
    expect(r1.corrections).toBeGreaterThanOrEqual(1);
    // las PriceReference del patrón se CONSERVAN (evidencia para la fase B)
    expect(await h.prisma.priceReference.count({ where: { cardId: A.id } })).toBe(5);
    expect((await refOf(A.id, 'holofoil'))?.referenceMxnCents).toBe(305);

    // idempotencia
    const audits = await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction', entityId: A.id } });
    const r2 = await job.run();
    expect([r2.candidates, r2.reclassified, r2.corrections, r2.halted]).toEqual([r1.candidates - r1.reclassified, 0, 0, false]);
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction', entityId: A.id } })).toBe(audits);
  });

  it('sin base con mercado en ese acabado ⇒ PRICE_PENDING: JAMÁS se usa el precio del patrón de respaldo', async () => {
    const B = await card('B', ['holofoil']);
    await product(B, B.baseId, B.name, {}); // base sin ninguna referencia
    await h.prisma.cardProduct.update({ where: { tcgplayerProductId: B.baseId }, data: { finishes: ['holofoil'] } });
    await product(B, B.baseId + 1, `${B.name} (Master Ball Pattern)`, { holofoil: 15663 });
    await job.run();
    expect((await refOf(B.id, 'holofoil'))).toBeUndefined(); // pendiente (la clave no tiene precio)
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: B.baseId + 1 } })).kind).toBe('variant');
  });

  it('precio a mano / override manual (tier manual) NO cambia con la reclasificación', async () => {
    const C = await card('C', ['holofoil']);
    await product(C, C.baseId, C.name, { holofoil: 305 });
    await product(C, C.baseId + 1, `${C.name} (Master Ball Pattern)`, { holofoil: 15663 });
    await h.prisma.priceReference.create({
      data: { cardId: C.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', source: 'manual', isManualOverride: true, priceMxnCents: 9_900, capturedDate: today(), refKind: 'market' },
    });
    const before = (await refOf(C.id, 'holofoil'))?.referenceMxnCents;
    await job.run();
    expect([before, (await refOf(C.id, 'holofoil'))?.referenceMxnCents]).toEqual([9_900, 9_900]);
  });

  it('FRENO: más combinaciones expuestas que el tope ⇒ no se aplica NADA, queda auditado y se avisa; con el tope normal se aplica', async () => {
    const D = await card('D', ['holofoil']);
    await product(D, D.baseId, D.name, { holofoil: 305 });
    const v = await product(D, D.baseId + 1, `${D.name} (Master Ball Pattern)`, { holofoil: 15663 });
    const r = await job.run({ brake: 0 });
    expect([r.halted, r.reclassified]).toEqual([true, 0]);
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: v.id } })).kind).toBe('set_base');
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_reclassify_halted' } })).toBe(1);
    await job.run({ brake: 0 }); // no repite el aviso en 24 h
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_reclassify_halted' } })).toBe(1);
    const ok = await job.run();
    expect([ok.halted, ok.reclassified]).toEqual([false, 1]);
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: v.id } })).kind).toBe('variant');
  });

  it('NO-REGRESIÓN: una carta sin producto variant mantiene su precio y el job no la toca', async () => {
    const E = await card('E', ['holofoil', 'reverse_holo']);
    await product(E, E.baseId, E.name, { holofoil: 1234, reverse_holo: 2222 });
    const before = [(await refOf(E.id, 'holofoil'))?.referenceMxnCents, (await refOf(E.id, 'reverse_holo'))?.referenceMxnCents];
    await job.run();
    expect([(await refOf(E.id, 'holofoil'))?.referenceMxnCents, (await refOf(E.id, 'reverse_holo'))?.referenceMxnCents]).toEqual(before);
    expect(before).toEqual([1234, 2222]);
  });

  it('ambigüedad real (SOLO con un variant colgado): dos productos del montón con precios muy distintos ⇒ sin precio automático y auditoría `product_ambiguous` (una vez)', async () => {
    const F = await card('F', ['holofoil'], `Foo ${run}`);
    await product(F, F.baseId + 10, 'Otro nombre uno', { holofoil: 1000 });
    await product(F, F.baseId + 11, 'Otro nombre dos', { holofoil: 5000 });
    // SIN variant: la lectura de siempre (hay precio) y el job no audita nada
    expect(await refOf(F.id, 'holofoil')).toBeDefined();
    await job.run();
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.product_ambiguous', entityId: `${F.id}|holofoil` } })).toBe(0);
    // CON un variant colgado en ese acabado: pendiente + auditoría una sola vez
    await product(F, F.baseId + 12, `Foo ${run} (Poke Ball)`, { holofoil: 7000 }, undefined, 'variant');
    expect(await refOf(F.id, 'holofoil')).toBeUndefined();
    const r = await job.run();
    expect(r.ambiguous).toBeGreaterThanOrEqual(1);
    const id = `${F.id}|holofoil`;
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.product_ambiguous', entityId: id } })).toBe(1);
    await job.run();
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.product_ambiguous', entityId: id } })).toBe(1);
    await h.prisma.auditLog.deleteMany({ where: { action: 'pricing.product_ambiguous', entityId: id } });
  });

  it('el desempate NO es ambiguo si uno es el ancla de la carta: gana el ancla aunque sea más barata', async () => {
    const G = await card('G', ['holofoil']);
    await product(G, G.baseId, G.name, { holofoil: 1000 });
    await product(G, G.baseId + 5, 'Otro nombre', { holofoil: 5000 });
    await product(G, G.baseId + 6, `${G.name} (Master Ball Pattern)`, { holofoil: 15663 }, undefined, 'variant');
    expect((await refOf(G.id, 'holofoil'))?.referenceMxnCents).toBe(1000);
  });

  it('PP-2 single-flight: tres corridas en paralelo ⇒ solo UNA trabaja (las otras salen `skipped`) y la auditoría queda 1× por carta', async () => {
    const P = await card('P', ['holofoil']);
    await product(P, P.baseId, P.name, { holofoil: 305 });
    await product(P, P.baseId + 1, `${P.name} (Master Ball Pattern)`, { holofoil: 15663 });
    const item = await h.prisma.inventoryItem.create({
      data: { folio: `PP-${run}-P`, cardId: P.id, productType: 'raw', rawCondition: 'NM', finish: 'holofoil', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 1000 },
    });
    const listingRun = await h.prisma.listingPriceRun.create({ data: { businessDate: today(), trigger: 'daily', status: 'ok', scopeItemCount: 1 } });
    await h.prisma.listingPrice.create({
      data: { inventoryItemId: item.id, variantKey: `${P.id}|raw|raw:NM|holofoil`, runId: listingRun.id, status: 'priced', unitPriceCents: 22400, listPriceCents: 18500, ivaRatePct: 16, ivaTransferPct: 100, computedAt: new Date() },
    });
    const rs = await Promise.all([job.run(), job.run(), job.run()]);
    expect(rs.filter((r) => r.skipped).length).toBeGreaterThanOrEqual(1);
    expect(rs.filter((r) => !r.skipped && r.reclassified > 0).length).toBe(1);
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction', entityId: P.id } })).toBe(1);
  });

  it('«Ball League» manda como promo: el job NO lo reclasifica a variant', async () => {
    const L = await card('L', ['holofoil']);
    await product(L, L.baseId, L.name, { holofoil: 305 });
    const lg = await product(L, L.baseId + 1, `${L.name} (Ultra Ball League)`, { holofoil: 500 }, undefined, 'set_base');
    await job.run();
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: lg.id } })).kind).toBe('set_base');
  });

  it('el job usa el MISMO clasificador (acentos): «(Poké Ball Pattern)» ⇒ variant; «(Pokéball)» pegado no', async () => {
    const X = await card('X', ['holofoil']);
    await product(X, X.baseId, X.name, { holofoil: 305 });
    const a = await product(X, X.baseId + 1, `${X.name} (Poké Ball Pattern)`, { holofoil: 900 });
    const b = await product(X, X.baseId + 2, `${X.name} (Pokéball)`, { holofoil: 905 });
    await job.run();
    expect([(await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: a.id } })).kind, (await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: b.id } })).kind]).toEqual(['variant', 'set_base']);
  });

  it('dial `pattern_correction_cap`: el freno lo lee del dial y el dueño lo sube para autorizar; `pattern_classify_enabled=off` revierte variant → set_base', async () => {
    const K = await card('K', ['holofoil', 'reverse_holo']);
    await product(K, K.baseId, K.name, { holofoil: 305, reverse_holo: 400 });
    const v = await product(K, K.baseId + 1, `${K.name} (Master Ball Pattern)`, { holofoil: 15663, reverse_holo: 20000 }); // 2 combinaciones expuestas
    const set = (key: string, valueJson: unknown) =>
      h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: valueJson as never, updatedBy: 'test' }, update: { valueJson: valueJson as never, updatedBy: 'test' } });
    try {
      await set('pattern_correction_cap', 1); // < 2 expuestas
      const halted = await job.run();
      expect([halted.halted, halted.combosExposed]).toEqual([true, 2]);
      expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: v.id } })).kind).toBe('set_base');
      await set('pattern_correction_cap', 100_000); // el dueño autoriza: la SIGUIENTE corrida lo aplica sola
      const applied = await job.run();
      expect([applied.halted, applied.reclassified >= 1]).toEqual([false, true]);
      expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: v.id } })).kind).toBe('variant');
      // reversa funcional
      await set('pattern_classify_enabled', 'off');
      const off = await job.run();
      expect(off.reclassified).toBeGreaterThanOrEqual(1);
      expect(await h.prisma.cardProduct.count({ where: { kind: 'variant', card: { externalId: { startsWith: `pp-${run}` } } } })).toBe(0);
      // y con el flag apagado el job NO vuelve a crear variantes
      expect((await job.run()).candidates).toBe(0);
    } finally {
      await h.prisma.configSetting.deleteMany({ where: { key: { in: ['pattern_correction_cap', 'pattern_classify_enabled'] } } });
    }
  });
});
