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
import { isVariantProductName, VARIANT_PRODUCT_SUFFIX_PG } from '../../src/common/variant-product';
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
    const baseId = (pid += 1000);
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

  it('paridad: el patrón de Postgres coincide con el de JS en los 1 081 nombres reales', async () => {
    const names = [...fixture.variant, ...fixture.notVariant];
    const rows = await h.prisma.$queryRaw<{ n: string; hit: boolean }[]>(Prisma.sql`
      SELECT n, (n ~* ${VARIANT_PRODUCT_SUFFIX_PG}) AS hit FROM unnest(${names}::text[]) AS t(n)`);
    const bad = rows.filter((r) => r.hit !== isVariantProductName(r.n)).map((r) => r.n);
    expect(bad).toEqual([]);
    expect(rows.filter((r) => r.hit).length).toBe(fixture.variant.length);
  });

  it('⭐ la lectura devuelve SIEMPRE la base (US$0.16) y no el patrón (US$8.22), con 20 juegos de uuid distintos (k/N)', async () => {
    let ok = 0;
    const N = 20;
    for (let i = 0; i < N; i++) {
      const c = await card(`perm${i}`, ['holofoil']);
      // el uuid de la Master Ball es el MÁS CHICO en unas y el más grande en otras
      const u = [randomUUID(), randomUUID(), randomUUID()].sort();
      const order = i % 2 === 0 ? [2, 1, 0] : [0, 1, 2];
      await product(c, c.baseId, c.name, { holofoil: 305 }, u[order[0]]);
      // la mitad de las veces los ids EXTERNOS de los patrones son MENORES que el de la base (la preferencia, no el orden de ids, debe ganar)
      const off = i % 4 < 2 ? 100_000 : -100_000;
      await product(c, c.baseId + off, `${c.name} (Poke Ball Pattern)`, { holofoil: 839 }, u[order[1]]);
      await product(c, c.baseId + 2 * off, `${c.name} (Master Ball Pattern)`, { holofoil: 15663 }, u[order[2]]);
      if ((await refOf(c.id, 'holofoil'))?.referenceMxnCents === 305) ok += 1;
    }
    expect(`${ok}/${N}`).toBe(`${N}/${N}`);
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

  it('ambigüedad real: dos productos del montón con precios muy distintos ⇒ sin precio automático y auditoría `product_ambiguous` (una vez)', async () => {
    const F = await card('F', ['holofoil'], `Foo ${run}`);
    await product(F, F.baseId + 10, 'Otro nombre uno', { holofoil: 1000 });
    await product(F, F.baseId + 11, 'Otro nombre dos', { holofoil: 5000 });
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
    expect((await refOf(G.id, 'holofoil'))?.referenceMxnCents).toBe(1000);
  });
});
