import { PriceIngestService } from '../src/modules/pricing/price-ingest.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { usdToMxnCents } from '../src/common/money';

/**
 * v1.44 (P-47, ARCHITECTURE §4.35) — el barrido diario reprecia SINGLES por-acabado desde TCGCSV
 * `tcgcsv_singles` (PRIMARIO). Este spec cubre el camino DEDICADO `ingestSinglesForSet`:
 *  - upsert keyed por `cardProductId` con `source='tcgcsv_singles'` y el FX del snapshot;
 *  - SEPARACIÓN estructura↔precio: NO escribe `Card.availableFinishes`/`pricedFinishesSnapshot`, NO
 *    llama al `FinishReconciler` (la composición sigue gateada a import/`--force`, §4.27d);
 *  - money-safe: fila sin `cardProductId`/`cardId` o `marketCents≤0` ⇒ se OMITE.
 * + `persistMarketReference` con `cardProductId`: FX aplicado, source correcto, override manual respetado.
 */

const SET = { id: 'local-me05', externalId: 'me05', name: 'Pitch Black', releaseDate: '2025/03/01', pptSetId: '24688' };
const fx = { rate: 18, bufferPct: 3 };

function settingsMock(provider: string) {
  return { getString: jest.fn(async () => provider) };
}
function reconcilerMock() {
  return { reconcile: jest.fn(async () => 0) };
}
function pptMapperMock() {
  return { resolveForSets: jest.fn(async () => new Map()) };
}
function configMock() {
  return { get: jest.fn(() => undefined) };
}

/** Provider `tcgcsv_singles` mock: filas YA joineadas (cardId + cardProductId), como en producción. */
function singlesProvider(rows: Array<Record<string, unknown>>, opts: { skipped?: number; requestOk?: boolean } = {}) {
  const { skipped = 0, requestOk = true } = opts;
  return {
    source: 'tcgcsv_singles',
    fetchPricesForSet: jest.fn(async () => ({ rows, fetchedRaw: rows.length + skipped, skipped, requestOk })),
  };
}

function build(provider: any, prismaOver: Record<string, unknown> = {}) {
  const prisma = {
    cardSet: { findUnique: jest.fn(async () => SET) },
    card: { findMany: jest.fn(async () => []), update: jest.fn(async () => ({})) },
    ...prismaOver,
  } as unknown as PrismaService;
  const pricing = { persistMarketReference: jest.fn(async () => {}) };
  const reconciler = reconcilerMock();
  const svc = new PriceIngestService(
    prisma,
    settingsMock('tcgcsv_singles') as any,
    pricing as any,
    {} as any, // pptBulk (no usado)
    {} as any, // tcgIoBulk (no usado)
    reconciler as any,
    pptMapperMock() as any,
    configMock() as any,
    provider as any, // tcgcsvSinglesBulk
  );
  return { svc, prisma, pricing, reconciler };
}

describe('PriceIngestService — barrido de singles tcgcsv_singles (§4.35)', () => {
  it('providerFor con dial=tcgcsv_singles → el provider primario de singles', async () => {
    const { svc } = build(singlesProvider([]));
    expect((await svc.providerFor()).source).toBe('tcgcsv_singles');
  });

  it('MONEY-SAFE por-acabado: 3 acabados con markets distintos ⇒ 3 upserts keyed por cardProductId, source tcgcsv_singles, FX', async () => {
    const provider = singlesProvider([
      { cardId: 'card-A', cardProductId: 'cp-1', externalId: 'ext-A', finish: 'normal', marketCents: 100, currency: 'USD', finishAliasVerified: true },
      { cardId: 'card-A', cardProductId: 'cp-1', externalId: 'ext-A', finish: 'reverse_holo', marketCents: 250, currency: 'USD', finishAliasVerified: true },
      { cardId: 'card-A', cardProductId: 'cp-1', externalId: 'ext-A', finish: 'holofoil', marketCents: 375, currency: 'USD', finishAliasVerified: true },
    ]);
    const { svc, pricing } = build(provider);

    const res = await svc.ingestSet('local-me05', fx);

    expect(pricing.persistMarketReference).toHaveBeenCalledTimes(3);
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'card-A', 'reverse_holo', { marketCents: 250, currency: 'USD', source: 'tcgcsv_singles' }, fx, 'cp-1',
    );
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'card-A', 'holofoil', { marketCents: 375, currency: 'USD', source: 'tcgcsv_singles' }, fx, 'cp-1',
    );
    expect(res).toMatchObject({ provider: 'tcgcsv_singles', cardCount: 1, priced: 3, unresolved: 0 });
  });

  it('SEPARACIÓN estructura↔precio: NO escribe availableFinishes/snapshot ni reconcilia (§4.35a)', async () => {
    const provider = singlesProvider([
      { cardId: 'card-A', cardProductId: 'cp-1', externalId: 'ext-A', finish: 'normal', marketCents: 100, currency: 'USD', finishAliasVerified: true },
    ]);
    const { svc, prisma, reconciler } = build(provider);

    await svc.ingestSet('local-me05', fx);

    expect((prisma as any).card.update).not.toHaveBeenCalled();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it('productos DISTINTOS de la misma carta ⇒ upsert con SU cardProductId (no colisiona)', async () => {
    const provider = singlesProvider([
      { cardId: 'card-A', cardProductId: 'cp-base', externalId: 'ext-A', finish: 'holofoil', marketCents: 375, currency: 'USD', finishAliasVerified: true },
      { cardId: 'card-A', cardProductId: 'cp-deck', externalId: 'ext-A', finish: 'holofoil', marketCents: 110, currency: 'USD', finishAliasVerified: true },
    ]);
    const { svc, pricing } = build(provider);

    await svc.ingestSet('local-me05', fx);

    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'card-A', 'holofoil', expect.objectContaining({ marketCents: 375 }), fx, 'cp-base',
    );
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'card-A', 'holofoil', expect.objectContaining({ marketCents: 110 }), fx, 'cp-deck',
    );
  });

  it('money-safe: fila sin cardProductId o con marketCents≤0 ⇒ se OMITE (no upsert huérfano)', async () => {
    const provider = singlesProvider([
      { cardId: 'card-A', cardProductId: null, externalId: 'ext-A', finish: 'normal', marketCents: 100, currency: 'USD', finishAliasVerified: true },
      { cardId: 'card-A', cardProductId: 'cp-1', externalId: 'ext-A', finish: 'holofoil', marketCents: 0, currency: 'USD', finishAliasVerified: true },
    ]);
    const { svc, pricing } = build(provider);

    const res = await svc.ingestSet('local-me05', fx);
    expect(pricing.persistMarketReference).not.toHaveBeenCalled();
    expect(res.priced).toBe(0);
  });

  it('fetch FALLÓ (requestOk:false, 0 filas) ⇒ nada se persiste (precios previos STALE, money-safe)', async () => {
    const provider = singlesProvider([], { requestOk: false });
    const { svc, pricing, reconciler } = build(provider);

    const res = await svc.ingestSet('local-me05', fx);
    expect(pricing.persistMarketReference).not.toHaveBeenCalled();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
    expect(res.priced).toBe(0);
  });
});

/**
 * `persistMarketReference` con `cardProductId` (la vía del PRIMARIO singles): FX aplicado, source
 * correcto, y el override manual del admin NO se pisa (money-safe, §4.27f).
 */
describe('PricingService.persistMarketReference — singles keyed por cardProductId (§4.35)', () => {
  function pricingSvc(existing: unknown) {
    const prisma: any = {
      priceReference: {
        findFirst: jest.fn(async () => existing),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
    };
    const svc = new PricingService(prisma as PrismaService, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('USD → FX+colchón, source tcgcsv_singles, y cardProductId en la clave/creación', async () => {
    const { svc, prisma } = pricingSvc(null);
    await svc.persistMarketReference(
      'card-A', 'reverse_holo', { marketCents: 250, currency: 'USD', source: 'tcgcsv_singles' }, fx, 'cp-1',
    );
    // La lectura previa acota por cardProductId (clave M-31).
    expect(prisma.priceReference.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cardProductId: 'cp-1', finish: 'reverse_holo' }) }),
    );
    const arg = prisma.priceReference.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      cardId: 'card-A',
      finish: 'reverse_holo',
      source: 'tcgcsv_singles',
      cardProductId: 'cp-1',
      priceUsdCents: 250,
      priceMxnCents: usdToMxnCents(250, 18, 3),
      isManualOverride: false,
    });
  });

  it('override manual presente (misma carta/producto/día) ⇒ NO se pisa', async () => {
    const { svc, prisma } = pricingSvc({ id: 'ref-x', isManualOverride: true, priceMxnCents: 99999 });
    await svc.persistMarketReference(
      'card-A', 'holofoil', { marketCents: 500, currency: 'USD', source: 'tcgcsv_singles' }, fx, 'cp-1',
    );
    expect(prisma.priceReference.create).not.toHaveBeenCalled();
    expect(prisma.priceReference.update).not.toHaveBeenCalled();
  });
});
