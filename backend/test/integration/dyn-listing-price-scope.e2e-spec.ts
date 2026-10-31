/**
 * dyn-listing-price-scope.e2e-spec.ts — 💰 DYN-B22 (API_CONTRACT §DYN.5.2-.3, errata v1.113.3) contra Postgres REAL y la app
 * por HTTP: **qué recalcula cada disparador manual y qué alcance tiene una corrida.**
 *
 *  1. `POST /admin/pricing/override` recalcula SOLO las piezas de su variante (carta, tipo, grado y ACABADO: las variantes del
 *     fixture son la misma carta raw NM en cuatro acabados, porque `RawCondition` solo tiene `NM`).
 *  2. `POST /admin/pricing/review-queue/:id/resolve`: `accept` y `manual` recalculan solo su variante; `keep` no recalcula.
 *  3. Una pieza APARTADA con fila se recalcula y, al liberarse, exhibe el precio vigente; una apartada SIN fila no la gana.
 *  4. Una pieza VENDIDA pierde su fila.
 *  5. De dos corridas solapadas (dos instancias) gana la que EMPEZÓ después, aunque termine antes.
 *  6. `FOR KEY SHARE SKIP LOCKED`: una pieza bloqueada se salta, conserva su fila y la corrida la cuenta.
 *
 * Deterministas (N=1 por construcción): el orden de las corridas solapadas lo fija un cerrojo explícito, no el reloj.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { SaleDecisionService, SaleItem, isPricePending } from '../../src/modules/pricing/sale-decision.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SEALED_SALE_PRICE_INCLUDE } from '../../src/common/money';

describe('E2E — DYN-B22: alcance de los disparadores manuales y de la corrida (§DYN.5.2-.3)', () => {
  let h: E2EHarness;
  let admin: string;
  let lp: ListingPriceService;
  let decider: SaleDecisionService;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  let cardId: string;
  let seq = 0;
  const caseIds: string[] = [];
  const today = () => new Date(new Date().toISOString().slice(0, 10));

  async function item(data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `LPS-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        firstListedAt: new Date(),
        ...data,
      },
    });
  }
  const row = (id: string) => h.prisma.listingPrice.findUnique({ where: { inventoryItemId: id } });
  const runIdOf = async (id: string) => (await row(id))?.runId ?? null;
  const manualRuns = () => h.prisma.listingPriceRun.count({ where: { trigger: 'manual_price' } });
  async function live(id: string): Promise<number | 'pending'> {
    const it = (await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
      include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE },
    })) as SaleItem;
    try {
      return (await decider.decide(it, await h.app.get(SettingsService).getIvaDials())).unitPriceCents;
    } catch (e) {
      if (isPricePending(e)) return 'pending';
      throw e;
    }
  }
  type Fin = 'normal' | 'holofoil' | 'reverse_holo' | 'first_edition_holofoil';
  async function setMarket(finish: Fin, cents: number) {
    await h.prisma.priceReference.updateMany({ where: { cardId, finish, source: 'tcgcsv_singles' }, data: { priceMxnCents: cents } });
  }
  async function market(finish: Fin, cents: number) {
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish, source: 'tcgcsv_singles', priceMxnCents: cents, capturedDate: today(), refKind: 'market' },
    });
  }
  async function openCase(finish: Fin, proposed: number) {
    const c = await h.prisma.priceReviewCase.create({
      data: {
        cardId,
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish,
        axis: 'sell',
        proposedMxnCents: proposed,
        baselineMxnCents: 10_000,
        jumpFactorMilli: 5000,
        sourceCount: 1,
        familyCount: 1,
        consensus: false,
        quotesSnapshot: [{ source: 'tcgcsv_singles', family: 'tcgplayer', priceMxnCents: proposed, capturedDate: today().toISOString().slice(0, 10), stale: false }],
      },
    });
    caseIds.push(c.id);
    return c.id;
  }
  const resolve = (id: string, json: Record<string, unknown>) =>
    h.api<{ status: string }>('POST', `/admin/pricing/review-queue/${id}/resolve`, { token: admin, json });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    lp = h.app.get(ListingPriceService);
    decider = h.app.get(SaleDecisionService);
    const set = await h.prisma.cardSet.create({ data: { externalId: `lps-${run}`, name: `Set Alcance ${run}` } });
    setId = set.id;
    const card = await h.prisma.card.create({
      data: {
        externalId: `lps-${run}-1`,
        setId,
        name: `Carta Alcance ${run}`,
        number: '1',
        rarity: 'Common',
        rarityCanonical: 'Common',
        imageSmallUrl: 'https://images.pokemontcg.io/lps/1.png',
        availableFinishes: ['normal', 'holofoil', 'reverse_holo', 'first_edition_holofoil'],
      },
    });
    cardId = card.id;
    // Dos variantes de la MISMA carta, tipo y grado: `normal` y `holofoil` (mercado automático, sin override: la cola de
    // revisión las mueve).
    await market('normal', 40_000);
    await market('holofoil', 30_000);
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      await h.prisma.priceReviewCase.deleteMany({ where: { id: { in: caseIds } } });
      const items = await h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: `LPS-${run}-` } }, select: { id: true } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId } });
      await h.prisma.card.deleteMany({ where: { id: cardId } }).catch(() => undefined);
      await h.prisma.cardSet.deleteMany({ where: { id: setId } }).catch(() => undefined);
      await h.close();
    }
  });

  describe('1-2. disparadores manuales: solo su variante', () => {
    let NM: string;
    let LP: string;
    beforeAll(async () => {
      NM = (await item({ finish: 'normal' })).id;
      LP = (await item({ finish: 'holofoil' })).id;
      await lp.run('manual_price', [NM, LP]);
    });

    it('`POST /admin/pricing/override` (raw:NM `normal`) ⇒ `manual_price` sobre esa pieza, ⛔ la `holofoil` intacta', async () => {
      await lp.idle();
      const [nm0, lp0, m0] = [await runIdOf(NM), await runIdOf(LP), await manualRuns()];
      const res = await h.api('POST', '/admin/pricing/override', {
        token: admin,
        json: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 77_000 },
      });
      expect(res.status).toBe(200);
      await lp.idle();
      expect(await manualRuns()).toBe(m0 + 1);
      expect(await runIdOf(NM)).not.toBe(nm0);
      expect(await row(NM)).toMatchObject({ referenceMxnCents: 77_000, unitPriceCents: await live(NM) });
      expect(await runIdOf(LP)).toBe(lp0);
    });

    it('cola de revisión `accept` (`holofoil`) ⇒ recalcula esa pieza con la referencia aceptada, ⛔ la `normal` intacta', async () => {
      await lp.idle();
      const id = await openCase('holofoil', 33_000);
      const [nm0, lp0, m0] = [await runIdOf(NM), await runIdOf(LP), await manualRuns()];
      const res = await resolve(id, { action: 'accept' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accepted');
      await lp.idle();
      expect(await manualRuns()).toBe(m0 + 1);
      expect(await runIdOf(LP)).not.toBe(lp0);
      expect(await row(LP)).toMatchObject({ unitPriceCents: await live(LP) });
      expect(await runIdOf(NM)).toBe(nm0);
    });

    it('cola de revisión `keep` ⇒ ⛔ ninguna corrida y ninguna fila tocada', async () => {
      await lp.idle();
      const id = await openCase('normal', 99_000);
      const [nm0, lp0, m0] = [await runIdOf(NM), await runIdOf(LP), await manualRuns()];
      const res = await resolve(id, { action: 'keep' });
      expect(res.status).toBe(200);
      await lp.idle();
      expect(await manualRuns()).toBe(m0);
      expect([await runIdOf(NM), await runIdOf(LP)]).toEqual([nm0, lp0]);
    });

    it('cola de revisión `manual` (`holofoil`) ⇒ recalcula esa pieza con el precio a mano, ⛔ la `normal` intacta', async () => {
      await lp.idle();
      const id = await openCase('holofoil', 35_000);
      const [nm0, lp0, m0] = [await runIdOf(NM), await runIdOf(LP), await manualRuns()];
      const res = await resolve(id, { action: 'manual', manualPriceMxnCents: 61_000 });
      expect(res.status).toBe(200);
      await lp.idle();
      expect(await manualRuns()).toBe(m0 + 1);
      expect(await runIdOf(LP)).not.toBe(lp0);
      expect(await row(LP)).toMatchObject({ referenceMxnCents: 61_000, unitPriceCents: await live(LP) });
      expect(await runIdOf(NM)).toBe(nm0);
    });
  });

  describe('3-4. alcance de la corrida: apartadas y vendidas', () => {
    it('apartada CON fila ⇒ se recalcula; al liberarse exhibe el precio vigente. Apartada SIN fila ⇒ no la gana', async () => {
      // Variante propia (`reverse_holo`) para no depender de los overrides de arriba.
      await market('reverse_holo', 20_000);
      const R = (await item({ finish: 'reverse_holo' })).id;
      await lp.run('manual_price', [R]);
      const P1 = (await row(R))!.unitPriceCents!;
      await h.prisma.inventoryItem.update({ where: { id: R }, data: { status: 'reserved' } });
      await setMarket('reverse_holo', 26_000);
      const P2 = await live(R);
      expect(P2).not.toBe(P1);
      const res = await lp.run('manual_price', [R]);
      expect(res).toMatchObject({ status: 'ok', scopeItemCount: 1, pricedCount: 1 });
      expect(await row(R)).toMatchObject({ status: 'priced', unitPriceCents: P2, referenceMxnCents: 26_000 });
      // Se libera: vuelve a la venta con el precio VIGENTE (el de la fila recalculada), sin pasar por `missing_row`.
      await h.prisma.inventoryItem.update({ where: { id: R }, data: { status: 'listed' } });
      const missing0 = await h.prisma.listingPriceRun.count({ where: { trigger: 'missing_row' } });
      expect((await h.api<{ displayPriceCents: number }>('GET', `/catalog/listings/${R}`)).body.displayPriceCents).toBe(P2);
      await lp.idle();
      expect(await h.prisma.listingPriceRun.count({ where: { trigger: 'missing_row' } })).toBe(missing0);

      const S = (await item({ finish: 'reverse_holo', status: 'reserved' })).id;
      const r2 = await lp.run('manual_price', [S]);
      expect(r2.scopeItemCount).toBe(0);
      expect(await row(S)).toBeNull();
    });

    it('vendida (enviada) ⇒ su fila se borra', async () => {
      const V = (await item({ finish: 'reverse_holo' })).id;
      await lp.run('manual_price', [V]);
      expect(await row(V)).not.toBeNull();
      await h.prisma.inventoryItem.update({ where: { id: V }, data: { status: 'shipped' } });
      const r = await lp.run('manual_price', [V]);
      expect(r.scopeItemCount).toBe(0);
      expect(await row(V)).toBeNull();
    });
  });

  describe('5-6. single-flight', () => {
    it('dos corridas solapadas (dos instancias): gana la que EMPEZÓ después, aunque la otra termine más tarde', async () => {
      await market('first_edition_holofoil', 15_000);
      const X = (await item({ finish: 'first_edition_holofoil' })).id;
      // Instancia A con su propia cadena: lee el mercado (15 000) y se DETIENE antes de escribir.
      const deciderA = new SaleDecisionService(h.app.get(PricingService));
      let reached!: () => void;
      const atGate = new Promise<void>((r) => (reached = r));
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      const realLoad = deciderA.loadBatch.bind(deciderA);
      jest.spyOn(deciderA, 'loadBatch').mockImplementation(async (items) => {
        const b = await realLoad(items);
        reached();
        await gate;
        return b;
      });
      const lpA = new ListingPriceService(h.app.get(PrismaService), deciderA, h.app.get(SettingsService));
      const runA = lpA.run('manual_price', [X]);
      await atGate;
      // B empieza DESPUÉS (otro mercado) y termina primero.
      await new Promise((r) => setTimeout(r, 5));
      await setMarket('first_edition_holofoil', 18_000);
      const resB = await lp.run('manual_price', [X]);
      const PB = (await row(X))!.unitPriceCents!;
      expect(await row(X)).toMatchObject({ runId: resB.runId, referenceMxnCents: 18_000 });
      // A termina después con su foto vieja: ⛔ no pisa la de B.
      open();
      const resA = await runA;
      expect(resA.status).toBe('ok');
      expect(await row(X)).toMatchObject({ runId: resB.runId, unitPriceCents: PB, referenceMxnCents: 18_000 });
    });

    it('`SKIP LOCKED`: una pieza bloqueada se salta, conserva su fila y la corrida la cuenta', async () => {
      const Y = (await item({ finish: 'first_edition_holofoil' })).id;
      const first = await lp.run('manual_price', [Y]);
      expect(first.skippedCount).toBe(0);
      let res!: Awaited<ReturnType<ListingPriceService['run']>>;
      await h.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${Y} FOR UPDATE`;
          res = await lp.run('manual_price', [Y]);
        },
        { timeout: 60_000 },
      );
      expect(res).toMatchObject({ status: 'ok', scopeItemCount: 1, pricedCount: 0, skippedCount: 1 });
      expect(await runIdOf(Y)).toBe(first.runId);
    });
  });
});
