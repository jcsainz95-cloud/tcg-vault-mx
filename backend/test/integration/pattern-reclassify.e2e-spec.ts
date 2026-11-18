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
import { CardProductResolverService } from '../../src/modules/catalog/card-product-resolver.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

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
      await h.prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: cardIds } }, { entityId: { startsWith: 'pp-' } }, { action: { in: ['pricing.pattern_reclassify_run', 'pricing.pattern_reclassify_paused'] } }] } });
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
    expect(r1).toMatchObject({ violations: 0 });
    expect(r1.reclassified).toBeGreaterThanOrEqual(2);
    const kinds = (await h.prisma.cardProduct.findMany({ where: { cardId: A.id }, orderBy: { tcgplayerProductId: 'asc' } })).map((p) => p.kind);
    expect(kinds).toEqual(['set_base', 'variant', 'variant']);
    // v2 (6.1): el Master Ball Pattern es el ÚNICO producto con precio en «normal» ⇒ ese acabado SE CONSERVA (y su precio); no hay acabado fantasma
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: A.id } })).availableFinishes).toEqual(expect.arrayContaining(['normal', 'reverse_holo', 'holofoil']));
    expect((await refOf(A.id, 'normal'))?.referenceMxnCents).toBe(2000);
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
    expect([r2.candidates, r2.reclassified, r2.corrections, r2.applied, r2.deferred]).toEqual([r1.candidates - r1.reclassified, 0, 0, 0, 0]);
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction', entityId: A.id } })).toBe(audits);
  });

  it('un patrón YA `variant` (creado por el import) cuyo precio llegó después: la corrida diaria mete su acabado a availableFinishes y la lectura lo conserva', async () => {
    const W = await card('W', ['normal']);
    await product(W, W.baseId, W.name, { normal: 100 });
    await product(W, W.baseId + 1, `${W.name} (Poke Ball Pattern)`, { holofoil: 4400 }, undefined, 'variant');
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: W.id } })).availableFinishes).toEqual(['normal']);
    await job.run();
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: W.id } })).availableFinishes).toEqual(expect.arrayContaining(['normal', 'holofoil']));
    expect((await refOf(W.id, 'holofoil'))?.referenceMxnCents).toBe(4400);
  });

  it('CA-1 Klink 061: base solo Normal/Reverse y el patrón es el ÚNICO holofoil ⇒ el Holofoil CONSERVA su precio (JAMÁS PRICE_PENDING) y entra a availableFinishes; 0 expuestos', async () => {
    const B = await card('B', ['normal', 'reverse_holo']);
    await product(B, B.baseId, B.name, { normal: 100, reverse_holo: 150 });
    const pat = await product(B, B.baseId + 1, `${B.name} (Master Ball Pattern)`, { holofoil: 7700 });
    const before = (await refOf(B.id, 'holofoil'))?.referenceMxnCents;
    expect(before).toBe(7700);
    const r = await job.run();
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: pat.id } })).kind).toBe('variant');
    expect((await refOf(B.id, 'holofoil'))?.referenceMxnCents).toBe(7700);
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: B.id } })).availableFinishes).toEqual(expect.arrayContaining(['normal', 'reverse_holo', 'holofoil']));
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction', entityId: B.id } })).toBe(0);
    expect(r.violations).toBe(0);
  });

  it("CA-2 Erika's Oddish 001 Ascended Heroes: reversos únicos «(Poke Ball)» y «(Energy Symbol Pattern)» ⇒ el Reverse Holofoil queda con el de MENOR precio (centavos), 0 expuestos", async () => {
    const O = await card('O', ['normal', 'reverse_holo'], `Erikas Oddish ${run}`);
    await product(O, O.baseId, O.name, { normal: 300 });
    await product(O, O.baseId + 1, `${O.name} (Poke Ball)`, { reverse_holo: 40 }, undefined, 'set_base');
    await product(O, O.baseId + 2, `${O.name} (Energy Symbol Pattern)`, { reverse_holo: 25 }, undefined, 'set_base');
    const r = await job.run();
    expect(r.violations).toBe(0);
    expect((await h.prisma.cardProduct.findMany({ where: { cardId: O.id, kind: 'variant' } })).length).toBe(2);
    expect((await refOf(O.id, 'reverse_holo'))?.referenceMxnCents).toBe(25);
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction', entityId: O.id } })).toBe(0);
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

  it('FRENO fijo + informe (6.2/6.3): con tope 2 y 3 expuestos aplica los 2 de MAYOR razón, difiere 1, audita `pricing.pattern_reclassify_run` con items y manda 1 correo; la corrida siguiente aplica el resto; la 3.ª = 0 cambios', async () => {
    const owner = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email }, select: { id: true, isOwner: true } });
    const prevOwners = await h.prisma.user.findMany({ where: { isOwner: true }, select: { id: true } });
    await h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = false WHERE "isOwner"`);
    await h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, owner.id);
    const port = h.app.get<MailPort>(MAIL_PORT);
    const bandeja: MailMessage[] = [];
    const spy = jest.spyOn(port, 'send').mockImplementation(async (m: MailMessage) => { bandeja.push(m); return {}; });
    try {
      const mk: { card: Awaited<ReturnType<typeof card>>; v: { id: string }; ratio: number }[] = [];
      for (const [n, vc] of [['D1', 3000], ['D2', 90000], ['D3', 12000]] as const) {
        const c = await card(n, ['holofoil']);
        await product(c, c.baseId, c.name, { holofoil: 1000 });
        mk.push({ card: c, v: await product(c, c.baseId + 1, `${c.name} (Master Ball Pattern)`, { holofoil: vc }), ratio: vc / 1000 });
      }
      await h.prisma.auditLog.deleteMany({ where: { action: { in: ['pricing.pattern_reclassify_run', 'pricing.pattern_reclassify_paused'] } } });
      const kind = async (i: number) => (await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: mk[i].v.id } })).kind;
      const r1 = await job.run({ max: 2 });
      expect([r1.combosExposed, r1.applied, r1.deferred]).toEqual([3, 2, 1]);
      expect([await kind(0), await kind(1), await kind(2)]).toEqual(['set_base', 'variant', 'variant']); // D1 (razón 3×) es la menor ⇒ se difiere
      const runs = await h.prisma.auditLog.findMany({ where: { action: 'pricing.pattern_reclassify_run' } });
      expect(runs).toHaveLength(1);
      const after = runs[0].after as { applied: number; deferred: number; exposed: number; truncated: boolean; items: Record<string, unknown>[] };
      expect([after.applied, after.deferred, after.exposed, after.truncated]).toEqual([2, 1, 3, false]);
      expect(Object.keys(after.items[0]).sort()).toEqual(['cardId', 'finish', 'fromCents', 'name', 'set', 'toCents']);
      expect(after.items.map((it) => it.cardId)).toEqual([mk[1].card.id, mk[2].card.id, mk[0].card.id]); // ordenado por razón
      expect(after.items[0]).toMatchObject({ fromCents: 90000, toCents: 1000, finish: 'holofoil' });
      expect(bandeja).toHaveLength(1);
      expect(bandeja[0].text).toContain('2 corregidas');
      // día siguiente: aplica lo diferido; luego idempotente
      const r2 = await job.run({ max: 2 });
      expect([r2.applied, r2.deferred, await kind(0)]).toEqual([1, 0, 'variant']);
      const r3 = await job.run({ max: 2 });
      expect([r3.applied, r3.deferred, r3.reclassified, r3.corrections]).toEqual([0, 0, 0, 0]);
      expect(bandeja).toHaveLength(2); // r3 sin cambios ⇒ sin correo
      expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_reclassify_run' } })).toBe(2);
      // CA-7: el audit-log lo filtra por acción y trae items
      const tok = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
      const res = await h.api<{ data: { action: string; after: { items: unknown[] } }[]; total: number }>('GET', '/admin/audit-log?action=pricing.pattern_reclassify_run', { token: tok });
      expect(res.status).toBe(200);
      expect(res.body.data.every((d) => d.action === 'pricing.pattern_reclassify_run')).toBe(true);
      expect(res.body.total).toBe(2);
      expect(res.body.data[1].after.items).toHaveLength(3);
    } finally {
      spy.mockRestore();
      await h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = false WHERE "isOwner"`);
      for (const o of prevOwners) await h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, o.id);
    }
  });

  it('AUTO-PAUSA (6.2): 3 corridas SEGUIDAS con diferidos CRECIENTES ⇒ `pattern_reclassify_paused` + alerta; la siguiente no hace nada; sin dial ni humano', async () => {
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['pricing.pattern_reclassify_run', 'pricing.pattern_reclassify_paused'] } } });
    let n = 0;
    const expose = async (k: number) => {
      for (let i = 0; i < k; i++) {
        const c = await card(`S${n++}`, ['holofoil']);
        await product(c, c.baseId, c.name, { holofoil: 1000 });
        await product(c, c.baseId + 1, `${c.name} (Master Ball Pattern)`, { holofoil: 20000 + n });
      }
    };
    await expose(3);
    const a = await job.run({ max: 1 }); // expuestos 3 ⇒ diferidos 2
    await expose(3);
    const b = await job.run({ max: 1 }); // 2 + 3 = 5 ⇒ diferidos 4
    expect([a.deferred, b.deferred]).toEqual([2, 4]);
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_reclassify_paused' } })).toBe(0);
    await expose(3);
    const c = await job.run({ max: 1 }); // 4 + 3 = 7 ⇒ diferidos 6 ⇒ 2,4,6 creciente ⇒ PAUSA
    expect(c.deferred).toBe(6);
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_reclassify_paused' } })).toBe(1);
    const d = await job.run({ max: 1 });
    expect([d.paused, d.reclassified, d.applied]).toEqual([true, 0, 0]);
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['pricing.pattern_reclassify_run', 'pricing.pattern_reclassify_paused'] } } });
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
    const b = await product(X, X.baseId + 2, `${X.name} (Pokéball)`, { holofoil: 300 });
    await job.run();
    expect([(await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: a.id } })).kind, (await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: b.id } })).kind]).toEqual(['variant', 'set_base']);
  });

  it('`pattern_classify_enabled=off` revierte variant → set_base y el job no vuelve a crear variantes; CA-8: `pattern_correction_cap` ya no existe (PUT ⇒ 422, ni se lee ni se lista)', async () => {
    const K = await card('K', ['holofoil', 'reverse_holo']);
    await product(K, K.baseId, K.name, { holofoil: 305, reverse_holo: 400 });
    const v = await product(K, K.baseId + 1, `${K.name} (Master Ball Pattern)`, { holofoil: 15663, reverse_holo: 20000 });
    const set = (key: string, valueJson: unknown) =>
      h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: valueJson as never, updatedBy: 'test' }, update: { valueJson: valueJson as never, updatedBy: 'test' } });
    try {
      const applied = await job.run();
      expect(applied.reclassified).toBeGreaterThanOrEqual(1);
      expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: v.id } })).kind).toBe('variant');
      await set('pattern_classify_enabled', 'off');
      const off = await job.run();
      expect(off.reclassified).toBeGreaterThanOrEqual(1);
      expect(await h.prisma.cardProduct.count({ where: { kind: 'variant', card: { externalId: { startsWith: `pp-${run}` } } } })).toBe(0);
      expect((await job.run()).candidates).toBe(0);
    } finally {
      await h.prisma.configSetting.deleteMany({ where: { key: { in: ['pattern_classify_enabled'] } } });
    }
    const tok = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const put = await h.api('PUT', '/admin/settings', { token: tok, json: { patternCorrectionCap: 5 } });
    expect(put.status).toBe(422);
    const get = await h.api<Record<string, unknown>>('GET', '/admin/settings', { token: tok });
    expect(get.status).toBe(200);
    expect(JSON.stringify(get.body)).not.toContain('atternCorrectionCap');
    expect(JSON.stringify(get.body)).not.toContain('pattern_correction_cap');
  });

  it('CA-5 PROPIEDAD (k/N): tras TODAS las corridas, cada combo carta×acabado de los fixtures con algún precio de mercado > 0 sigue con precio legible (salvo la ambigüedad sembrada a propósito)', async () => {
    await h.prisma.configSetting.deleteMany({ where: { key: 'pattern_classify_enabled' } });
    await job.run();
    const refs = await h.prisma.priceReference.findMany({ where: { cardId: { in: cardIds }, refKind: 'market', priceMxnCents: { gt: 0 }, productType: 'raw', gradeKey: 'raw:NM' }, select: { cardId: true, finish: true } });
    const combos = [...new Set(refs.map((r) => `${r.cardId}|${r.finish}`))];
    const ambiguousCard = (await h.prisma.card.findUnique({ where: { externalId: `pp-${run}-F` }, select: { id: true } }))?.id;
    let ok = 0;
    let n = 0;
    for (const k of combos) {
      const [cardId, finish] = k.split('|');
      if (cardId === ambiguousCard) continue;
      n += 1;
      if ((await refOf(cardId, finish)) != null) ok += 1;
    }
    expect(n).toBeGreaterThan(150);
    expect(`${ok}/${n}`).toBe(`${n}/${n}`);
  });

  it('refresh-variants (resolver) NO reclasifica hacia/desde variant: con el freno parado, 0 reclasificaciones, 0 auditorías y el precio publicado no cambia', async () => {
    const resolver = h.app.get(CardProductResolverService);
    const grp = 800_000 + Math.floor(Math.random() * 100_000);
    const set2 = await h.prisma.cardSet.create({ data: { externalId: `pp2-${run}`, name: `Set PP2 ${run}`, pptSetId: String(grp) } });
    const mk = async (n: string, tcg: number) => {
      const c = await h.prisma.card.create({
        data: { externalId: `pp2-${run}-${n}`, setId: set2.id, name: `Noctowl ${run} r${n}`, number: n, rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['holofoil'], tcgplayerId: String(tcg) },
      });
      cardIds.push(c.id);
      return c;
    };
    const A = await mk('901', (pid += 1_000_000)); // en BD está set_base y el nombre TCGCSV dice «Pattern» ⇒ el derivado diría variant
    const B = await mk('902', (pid += 1_000_000)); // en BD está variant y el nombre TCGCSV ya no dice «Pattern» ⇒ el derivado diría set_base
    const pA = await product(A, Number(A.tcgplayerId), `${A.name} (Master Ball Pattern)`, { holofoil: 15663 });
    const pB = await product(B, Number(B.tcgplayerId), `${B.name} (Master Ball Pattern)`, { holofoil: 15663 }, undefined, 'variant');
    const products = [
      { productId: Number(A.tcgplayerId), name: `${A.name} (Master Ball Pattern) - 901`, number: '901' },
      { productId: Number(B.tcgplayerId), name: `${B.name} - 902`, number: '902' },
    ];
    const prices = [
      { productId: Number(A.tcgplayerId), subTypeName: 'Holofoil', marketPrice: 90 },
      { productId: Number(B.tcgplayerId), subTypeName: 'Holofoil', marketPrice: 3 },
    ];
    const client = (resolver as unknown as { tcgcsv: { getProducts: unknown; getPrices: unknown } }).tcgcsv;
    const orig = { gp: client.getProducts, gpr: client.getPrices };
    client.getProducts = async () => products;
    client.getPrices = async () => prices;
    const auditsBefore = await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction' } });
    try {
      await resolver.resolveCardProductsForSet(set2.id); // «refrescar variantes» sin que el job haya corrido
    } finally {
      client.getProducts = orig.gp;
      client.getPrices = orig.gpr;
    }
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: pA.id } })).kind).toBe('set_base');
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: pB.id } })).kind).toBe('variant');
    expect(await h.prisma.auditLog.count({ where: { action: 'pricing.pattern_correction' } })).toBe(auditsBefore);
  });
});
