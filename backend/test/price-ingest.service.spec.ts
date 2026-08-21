import { PriceIngestService } from '../src/modules/pricing/price-ingest.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { usdToMxnCents } from '../src/common/money';
import { cardNumberVariants } from '../src/modules/pricing/pricing.types';

/**
 * WS-A (v1.14-price-ingest, §4.15c/§4.15d) — PriceIngestService:
 *  - el dial `PRICE_PROVIDER` elige el provider;
 *  - upsert por ACABADO (una persistMarketReference por finish) con el FX del snapshot;
 *  - resolución de carta (externalId primario, (set,number) fallback), omite las no resueltas.
 * + PricingService.persistMarketReference generalizado (source + moneda USD/MXN).
 *
 * v1.22-variantes-orden (§4.22a) — `availableFinishes` DEJA de escribirse aquí: `price-ingest` NUNCA
 * hace `card.update({ availableFinishes })` (autoridad = catalog).
 *
 * v1.22-1 (§4.22g) — Señal C money-safe: en una corrida EXITOSA (`requestOk && rows>0`), por cada
 * carta vista con ≥1 fila válida se REEMPLAZA `Card.pricedFinishesSnapshot` con sus acabados de
 * `market>0 && finishAliasVerified`, y se LLAMA a `FinishReconciler.reconcile(cardIds)` (el ÚNICO
 * escritor de `availableFinishes`). Ante fallo/0 filas NO se toca ningún snapshot (stale money-safe).
 */

/**
 * `providerMock` — por defecto `requestOk: true` (corrida exitosa) y `finishAliasVerified: true` en
 * cada fila (el caso común: acabado de un alias VERIFICADO). Un test puede sobreescribir ambos.
 */
function providerMock(
  source: string,
  rows: Array<Record<string, unknown>>,
  opts: { skipped?: number; requestOk?: boolean } = {},
) {
  const { skipped = 0, requestOk = true } = opts;
  const withVerified = rows.map((r) => ({ finishAliasVerified: true, ...r }));
  return {
    source,
    fetchPricesForSet: jest.fn(async () => ({
      rows: withVerified,
      fetchedRaw: withVerified.length + skipped,
      skipped,
      requestOk,
    })),
  };
}

/** Mock del ÚNICO escritor de `availableFinishes` (FinishReconciler). */
function reconcilerMock() {
  return { reconcile: jest.fn(async () => 0) };
}

// WS-A fix-ppt: releaseDate MODERNO (≥2020) → scope `full` en el provider de paga, sin consultas de
// inventario/rareza (preserva las aserciones existentes; el scope parcial tiene sus propios tests).
const SET = { id: 'local-sv8', externalId: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08', pptSetId: '1234' };

function settingsMock(provider: string) {
  return { getString: jest.fn(async () => provider) };
}

/** WS-A fix-ppt: mock del resolvedor de `pptSetId` (devuelve el ya cacheado del set). */
function pptMapperMock() {
  return { resolveForSets: jest.fn(async (sets: Array<{ id: string; pptSetId?: string | null }>) =>
    new Map(sets.map((s) => [s.id, s.pptSetId ?? '1234'])),
  ) };
}

/** WS-A fix-ppt: mock de ConfigService (sin diales de scope/throttle configurados). */
function configMock() {
  return { get: jest.fn(() => undefined) };
}

describe('PriceIngestService.providerFor — el dial PRICE_PROVIDER elige el provider', () => {
  const ppt = providerMock('pokemonpricetracker', []);
  const tcg = providerMock('pokemontcg_io', []);

  function build(dial: string) {
    return new PriceIngestService(
      {} as PrismaService,
      settingsMock(dial) as any,
      {} as PricingService,
      ppt as any,
      tcg as any,
      reconcilerMock() as any,
      pptMapperMock() as any,
      configMock() as any,
    );
  }

  it('dial=pokemonpricetracker → provider de PAGA', async () => {
    expect((await build('pokemonpricetracker').providerFor()).source).toBe('pokemonpricetracker');
  });
  it('dial=pokemontcg_io → provider LEGACY', async () => {
    expect((await build('pokemontcg_io').providerFor()).source).toBe('pokemontcg_io');
  });
  it('dial desconocido → fallback money-safe a pokemontcg_io (legacy)', async () => {
    expect((await build('garbage').providerFor()).source).toBe('pokemontcg_io');
  });
});

describe('PriceIngestService.ingestSet — precios + Señal C (pricedFinishesSnapshot) + reconcile', () => {
  function prismaMock(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      cardSet: { findUnique: jest.fn(async () => SET) },
      card: {
        findUnique: jest.fn(async ({ where }: any) => (where.externalId === 'sv8-1' ? { id: 'db-1' } : null)),
        findFirst: jest.fn(async ({ where }: any) =>
          where.setId === 'local-sv8' && where.number === '5' ? { id: 'db-5' } : null,
        ),
        // §4.22a — lectura de SOLO LECTURA del catálogo de acabados (drift/`finishNotInCatalog`).
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
      ...overrides,
    } as any;
  }

  const fx = { rate: 18, bufferPct: 3 };

  /** Filtra los `card.update` que tocan `availableFinishes` (candado: price-ingest JAMÁS lo hace). */
  function availableFinishesUpdates(prisma: any): unknown[] {
    return prisma.card.update.mock.calls.filter(
      ([arg]: [{ data?: Record<string, unknown> }]) => arg?.data && 'availableFinishes' in arg.data,
    );
  }

  it('persiste una referencia por acabado; escribe pricedFinishesSnapshot y reconcilia (NO availableFinishes)', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 150, currency: 'USD' },
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'reverse_holo', marketCents: 200, currency: 'USD' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    const res = await svc.ingestSet('local-sv8', fx);

    expect(pricing.persistMarketReference).toHaveBeenCalledTimes(2);
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'normal', { marketCents: 150, currency: 'USD', source: 'pokemonpricetracker' }, fx,
    );
    // v1.22-1 (§4.22g): snapshot REEMPLAZADO con los acabados verificados con market>0.
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'db-1' },
      data: { pricedFinishesSnapshot: ['normal', 'reverse_holo'] },
    });
    // CANDADO único escritor: NINGÚN card.update tocó `availableFinishes`.
    expect(availableFinishesUpdates(prisma)).toHaveLength(0);
    // Se delegó al ÚNICO escritor con la carta tocada.
    expect(reconciler.reconcile).toHaveBeenCalledWith(['db-1']);
    expect(res).toMatchObject({ cardCount: 1, priced: 2, unresolved: 0 });
  });

  it('ANTI-INVENCIÓN/SEC-A1: alias SUPUESTO (foil→holofoil) persiste el PRECIO pero NO entra al snapshot', async () => {
    // El proveedor mapeó `foil` (SUPUESTO) → holofoil para el PRECIO, con finishAliasVerified=false.
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 300, currency: 'USD', finishAliasVerified: false },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    await svc.ingestSet('local-sv8', fx);

    // El PRECIO sí se persiste (dato inocuo: el quote valida el finish antes de leer precio).
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'holofoil', expect.objectContaining({ marketCents: 300 }), fx,
    );
    // Pero el snapshot NO incluye holofoil (alias no verificado) → queda VACÍO (nada inventado).
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'db-1' },
      data: { pricedFinishesSnapshot: [] },
    });
    expect(availableFinishesUpdates(prisma)).toHaveLength(0);
    expect(reconciler.reconcile).toHaveBeenCalledWith(['db-1']);
  });

  it('v1.27 P-13.2: filas FORZADAS (fetchPrintings, finish por etiqueta) ⇒ NO tocan el snapshot pero SÍ se reconcilia y el precio SÍ se persiste', async () => {
    // Corrida en modo por-impresión: TODAS las filas llevan forcedPrinting=true y alias NO verificado.
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 100, currency: 'USD', finishAliasVerified: false, forcedPrinting: true },
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'reverse_holo', marketCents: 200, currency: 'USD', finishAliasVerified: false, forcedPrinting: true },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    await svc.ingestSet('local-sv8', fx);

    // PRECIOS sí (es el prerequisito de datos de P-15: la reverse gana su PriceReference propia)…
    expect(pricing.persistMarketReference).toHaveBeenCalledTimes(2);
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'reverse_holo', expect.objectContaining({ marketCents: 200 }), fx,
    );
    // …pero el snapshot NO se toca (ni se reemplaza ni se limpia: la etiqueta no es evidencia).
    expect(prisma.card.update).not.toHaveBeenCalled();
    // El reconcile SÍ corre (idempotente; repara availableFinishes stale con la fórmula §4.25a).
    expect(reconciler.reconcile).toHaveBeenCalledWith(['db-1']);
    expect(availableFinishesUpdates(prisma)).toHaveLength(0);
  });

  it('v1.27 P-13.2: mezcla lista+forzada ⇒ el snapshot se computa SOLO con la evidencia del modo lista', async () => {
    const provider = providerMock('pokemonpricetracker', [
      // fila de modo LISTA (primaryPrinting, verificada) — SÍ es evidencia:
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 300, currency: 'USD' },
      // fila FORZADA — precio sí, evidencia no:
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 100, currency: 'USD', finishAliasVerified: false, forcedPrinting: true },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    await svc.ingestSet('local-sv8', fx);

    // El snapshot SOLO trae el acabado del modo lista (holofoil), jamás el `normal` de etiqueta.
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'db-1' },
      data: { pricedFinishesSnapshot: ['holofoil'] },
    });
    expect(reconciler.reconcile).toHaveBeenCalledWith(['db-1']);
  });

  it('MONEY-SAFE STALE: corrida que FALLA (requestOk=false) ⇒ NO se toca ningún snapshot ni se reconcilia', async () => {
    // El proveedor devolvió filas parciales pero la corrida no fue exitosa (fallo transitorio).
    const provider = providerMock(
      'pokemonpricetracker',
      [{ externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'reverse_holo', marketCents: 200, currency: 'USD' }],
      { requestOk: false },
    );
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    await svc.ingestSet('local-sv8', fx);

    // El precio se sigue persistiendo (tolerante), pero el snapshot NO se toca (no destruir evidencia).
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it('MONEY-SAFE STALE: corrida exitosa pero 0 filas ⇒ NO se toca ningún snapshot ni se reconcilia', async () => {
    const provider = providerMock('pokemonpricetracker', [], { requestOk: true });
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    await svc.ingestSet('local-sv8', fx);
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it('finishNotInCatalog: el proveedor reporta un acabado FUERA de Card.availableFinishes → se LOGUEA', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 300, currency: 'USD' },
    ]);
    // El catálogo SOLO conoce ['normal'] para db-1 → 'holofoil' es DRIFT.
    const prisma = prismaMock({
      card: {
        findUnique: jest.fn(async ({ where }: any) => (where.externalId === 'sv8-1' ? { id: 'db-1' } : null)),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => [{ id: 'db-1', externalId: 'sv8-1', availableFinishes: ['normal'] }]),
        update: jest.fn(async () => ({})),
      },
    });
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.ingestSet('local-sv8', fx);

    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'holofoil', expect.objectContaining({ marketCents: 300 }), fx,
    );
    // La divergencia queda LOGUEADA; el CATÁLOGO (availableFinishes) no se toca directamente.
    expect(availableFinishesUpdates(prisma)).toHaveLength(0);
    expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('finishNotInCatalog'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('resuelve por (set, number) cuando falta externalId (fallback §4.15d)', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: null, setExternalId: 'sv8', number: '5', finish: 'normal', marketCents: 100, currency: 'USD' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-5', 'normal', expect.objectContaining({ marketCents: 100 }), fx,
    );
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'db-5' },
      data: { pricedFinishesSnapshot: ['normal'] },
    });
    expect(reconciler.reconcile).toHaveBeenCalledWith(['db-5']);
    expect(availableFinishesUpdates(prisma)).toHaveLength(0);
  });

  it('fila que NO resuelve a carta local → se OMITE (no crea referencia ni snapshot huérfano)', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'ghost', setExternalId: 'sv8', number: null, finish: 'normal', marketCents: 100, currency: 'USD' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const reconciler = reconcilerMock();
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconciler as any, pptMapperMock() as any, configMock() as any);

    const res = await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
    expect(res.unresolved).toBe(1);
  });

  it('propaga la moneda MXN de la fila (el ingest no convierte MXN)', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 5000, currency: 'MXN' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);

    await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'holofoil', { marketCents: 5000, currency: 'MXN', source: 'pokemonpricetracker' }, fx,
    );
  });

  it('set inexistente → no revienta y no persiste nada', async () => {
    const provider = providerMock('pokemonpricetracker', []);
    const prisma = { cardSet: { findUnique: jest.fn(async () => null) }, card: {} } as any;
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);

    const res = await svc.ingestSet('missing', fx);
    expect(res.priced).toBe(0);
    expect(provider.fetchPricesForSet).not.toHaveBeenCalled();
  });
});

/**
 * Auditoría de precios (2026-08-17) — `hasRecentIngest` alimenta el catch-up al boot:
 * "reciente" = ≥1 PriceReference NO-manual con capturedDate ≥ ayer 00:00 UTC. Los overrides
 * manuales del admin NO cuentan como ingesta.
 */
describe('PriceIngestService.hasRecentIngest — señal del catch-up al boot', () => {
  function buildWithRef(row: unknown) {
    const prisma = { priceReference: { findFirst: jest.fn(async () => row) } } as any;
    const svc = new PriceIngestService(
      prisma,
      settingsMock('pokemontcg_io') as any,
      {} as PricingService,
      {} as any,
      {} as any,
      reconcilerMock() as any,
      pptMapperMock() as any,
      configMock() as any,
    );
    return { svc, prisma };
  }

  it('hay referencia no-manual reciente → true', async () => {
    const { svc } = buildWithRef({ id: 'ref-1' });
    await expect(svc.hasRecentIngest()).resolves.toBe(true);
  });

  it('sin referencias recientes → false, y el filtro excluye manuales y acota a ayer 00:00 UTC', async () => {
    const { svc, prisma } = buildWithRef(null);
    await expect(svc.hasRecentIngest()).resolves.toBe(false);

    const where = prisma.priceReference.findFirst.mock.calls[0][0].where;
    expect(where.isManualOverride).toBe(false);
    const since: Date = where.capturedDate.gte;
    const expected = new Date();
    expected.setUTCHours(0, 0, 0, 0);
    expected.setUTCDate(expected.getUTCDate() - 1);
    expect(since.toISOString()).toBe(expected.toISOString());
  });
});

/**
 * WS-A fix-ppt — SCOPE del PO en el provider de PAGA: resolución de `pptSetId`, sets viejos → partial
 * (solo inventario ∪ rares) o skip, y PARADA por cuota diaria.
 */
describe('PriceIngestService — scope PPT (pptSetId + 2020/inventario/rares + daily stop)', () => {
  const fx = { rate: 18, bufferPct: 3 };

  /** Provider de paga mock que devuelve filas fijas (+ dailyLimited opcional). */
  function pptProvider(rows: Array<Record<string, unknown>>, dailyLimited = false) {
    return {
      source: 'pokemonpricetracker',
      fetchPricesForSet: jest.fn(async () => ({
        rows: rows.map((r) => ({ finishAliasVerified: true, ...r })),
        fetchedRaw: rows.length,
        skipped: 0,
        requestOk: true,
        dailyLimited,
      })),
    };
  }

  const OLD_SET = { id: 'old-1', externalId: 'base1', name: 'Base Set', releaseDate: '1999/01/09', pptSetId: '99' };

  /** prisma mock con inventario + cartas (rarity) del set viejo, y resolución por (set, number). */
  function prismaForOldSet(opts: {
    invCardIds?: string[];
    cards?: Array<{ id: string; number: string; rarity: string | null }>;
  }) {
    const cards = opts.cards ?? [];
    return {
      cardSet: { findUnique: jest.fn(async () => OLD_SET), findMany: jest.fn(async () => [OLD_SET]) },
      inventoryItem: {
        findMany: jest.fn(async () => (opts.invCardIds ?? []).map((cardId) => ({ cardId }))),
      },
      card: {
        findMany: jest.fn(async ({ where }: any) => {
          // computeScope pide {setId} → devuelve id+rarity; el drift-read pide {id:{in}} → []
          if (where?.setId) return cards.map((c) => ({ id: c.id, rarity: c.rarity }));
          return [];
        }),
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async ({ where }: any) => {
          const c = cards.find((x) => x.number === where.number);
          return c ? { id: c.id } : null;
        }),
        update: jest.fn(async () => ({})),
      },
    } as any;
  }

  it('set VIEJO sin inventario ni rares → scope=skip: NO llama al provider', async () => {
    const provider = pptProvider([]);
    const prisma = prismaForOldSet({ invCardIds: [], cards: [{ id: 'c1', number: '1', rarity: 'Common' }] });
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, {} as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);

    const res = await svc.ingestSet('old-1', fx);
    expect(res.scope).toBe('skip');
    expect(provider.fetchPricesForSet).not.toHaveBeenCalled();
  });

  it('set VIEJO partial → SOLO persiste cartas permitidas (inventario ∪ rares), filtra el bulk', async () => {
    // Catálogo: c1 rara, c2 common (bulk), c3 common pero con inventario.
    const cards = [
      { id: 'c1', number: '1', rarity: 'Rare Holo' },
      { id: 'c2', number: '2', rarity: 'Common' },
      { id: 'c3', number: '3', rarity: 'Common' },
    ];
    const prisma = prismaForOldSet({ invCardIds: ['c3'], cards });
    // El provider (barrido del set) devuelve las 3; el ingest debe descartar c2 (bulk sin inventario).
    const provider = pptProvider([
      { externalId: null, setExternalId: '99', number: '1', finish: 'holofoil', marketCents: 500, currency: 'USD' },
      { externalId: null, setExternalId: '99', number: '2', finish: 'normal', marketCents: 50, currency: 'USD' },
      { externalId: null, setExternalId: '99', number: '3', finish: 'normal', marketCents: 80, currency: 'USD' },
    ]);
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);

    const res = await svc.ingestSet('old-1', fx);
    expect(res.scope).toBe('partial');
    // c1 (rara) y c3 (inventario) SÍ; c2 (bulk) NO.
    const pricedCards = (pricing.persistMarketReference.mock.calls as any[]).map((c) => c[0]).sort();
    expect(pricedCards).toEqual(['c1', 'c3']);
    expect(res.cardCount).toBe(2);
  });

  it('provider marca dailyLimited → el resultado propaga la señal de PARADA', async () => {
    const provider = pptProvider([], true);
    // Set moderno (full) para ir directo al provider sin scope DB.
    const prisma = {
      cardSet: { findUnique: jest.fn(async () => ({ ...OLD_SET, releaseDate: '2024/01/01' })) },
      card: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null), update: jest.fn(async () => ({})) },
    } as any;
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, { persistMarketReference: jest.fn() } as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);

    const res = await svc.ingestSet('old-1', fx);
    expect(res.dailyLimited).toBe(true);
  });

  it('ingestAll DETIENE el barrido al primer set con dailyLimited y reporta pendientes', async () => {
    const provider = pptProvider([], false);
    // 3 sets; el 1º agota la cuota → 2 quedan pendientes.
    const sets = [
      { id: 's1', externalId: 'a', name: 'A', releaseDate: '2024/01/01' },
      { id: 's2', externalId: 'b', name: 'B', releaseDate: '2024/01/01' },
      { id: 's3', externalId: 'c', name: 'C', releaseDate: '2024/01/01' },
    ];
    let call = 0;
    (provider.fetchPricesForSet as jest.Mock).mockImplementation(async () => ({
      rows: [], fetchedRaw: 0, skipped: 0, requestOk: true, dailyLimited: call++ === 0,
    }));
    const prisma = {
      cardSet: {
        findMany: jest.fn(async () => sets),
        findUnique: jest.fn(async ({ where }: any) => sets.find((s) => s.id === where.id)),
      },
      card: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null), update: jest.fn(async () => ({})) },
    } as any;
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, { persistMarketReference: jest.fn() } as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);

    const res = await svc.ingestAll(fx);
    expect(res.dailyLimited).toBe(true);
    expect(res.pending).toBe(2); // solo se procesó s1 antes de parar
    expect(provider.fetchPricesForSet).toHaveBeenCalledTimes(1);

    // N-11: el estado observable refleja la PARADA por límite diario.
    const st = svc.getSyncStatus();
    expect(st).toMatchObject({ running: false, total: 3, done: 1, pending: 2, dailyLimited: true, provider: 'pokemonpricetracker' });
    expect(st.finishedAt).not.toBeNull();
  });

  it('N-11: ingestAll publica progreso honesto (running→done/total, finishedAt, dailyRemaining)', async () => {
    const sets = [
      { id: 's1', externalId: 'a', name: 'A', releaseDate: '2024/01/01' },
      { id: 's2', externalId: 'b', name: 'B', releaseDate: '2024/01/01' },
    ];
    const provider = pptProvider([]);
    (provider.fetchPricesForSet as jest.Mock).mockImplementation(async () => ({
      rows: [], fetchedRaw: 0, skipped: 0, requestOk: true, dailyLimited: false, dailyRemaining: 17777,
    }));
    const prisma = {
      cardSet: { findMany: jest.fn(async () => sets), findUnique: jest.fn(async ({ where }: any) => sets.find((s) => s.id === where.id)) },
      card: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null), update: jest.fn(async () => ({})) },
    } as any;
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, { persistMarketReference: jest.fn() } as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);

    // Antes de arrancar: estado inicial (no corriendo).
    expect(svc.getSyncStatus().running).toBe(false);
    await svc.ingestAll(fx);
    const st = svc.getSyncStatus();
    expect(st).toMatchObject({ running: false, total: 2, done: 2, pending: 0, dailyLimited: false, dailyRemaining: 17777 });
    expect(st.startedAt).not.toBeNull();
    expect(st.finishedAt).not.toBeNull();
    expect(st.lastError).toBeNull();
  });
});

describe('PricingService.persistMarketReference — generalizado (source + moneda USD/MXN)', () => {
  function pricingSvc(existing: unknown) {
    const prisma: any = {
      priceReference: { findUnique: jest.fn(async () => existing), upsert: jest.fn(async () => ({})) },
    };
    const svc = new PricingService(prisma as PrismaService, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('USD → convierte con FX+colchón, guarda priceUsdCents + fxRate/fxBufferPct + source del provider', async () => {
    const { svc, prisma } = pricingSvc(null);
    await svc.persistMarketReference(
      'c1', 'holofoil', { marketCents: 1000, currency: 'USD', source: 'pokemonpricetracker' }, { rate: 18, bufferPct: 10 },
    );
    const arg = prisma.priceReference.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil',
      source: 'pokemonpricetracker',
      priceUsdCents: 1000,
      priceMxnCents: usdToMxnCents(1000, 18, 10), // 19800
      fxRate: 18, fxBufferPct: 10,
      isManualOverride: false,
    });
  });

  it('MXN → SIN conversión ni colchón; priceUsdCents/fx* = null', async () => {
    const { svc, prisma } = pricingSvc(null);
    await svc.persistMarketReference(
      'c1', 'normal', { marketCents: 5000, currency: 'MXN', source: 'pokemonpricetracker' }, { rate: 18, bufferPct: 10 },
    );
    const arg = prisma.priceReference.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      source: 'pokemonpricetracker',
      priceMxnCents: 5000, // sin ×FX
      priceUsdCents: null,
      fxRate: null,
      fxBufferPct: null,
    });
  });

  it('respeta el override manual del admin (fila de hoy isManualOverride=true → NO upsert)', async () => {
    const { svc, prisma } = pricingSvc({ isManualOverride: true, priceMxnCents: 999 });
    await svc.persistMarketReference(
      'c1', 'normal', { marketCents: 500, currency: 'USD', source: 'pokemonpricetracker' }, { rate: 18, bufferPct: 0 },
    );
    expect(prisma.priceReference.upsert).not.toHaveBeenCalled();
  });
});

/**
 * P-6 (2026-08-18) — el proveedor de paga publica `cardNumber`, que puede venir con el total del
 * set (`"104/159"`) o con ceros a la izquierda (`"004"`), mientras `Card.number` viene de
 * pokemontcg.io (`"104"`). El fallback `(set, number)` tolera esas formas SIN adivinar la carta.
 */
describe('cardNumberVariants — formas equivalentes del número de carta', () => {
  it('corta el total del set: "104/159" → incluye "104"', () => {
    expect(cardNumberVariants('104/159')).toContain('104');
  });

  it('tolera el relleno de ceros en ambos sentidos', () => {
    expect(cardNumberVariants('004')).toEqual(expect.arrayContaining(['4', '04']));
    expect(cardNumberVariants('4')).toEqual(expect.arrayContaining(['04', '004']));
  });

  it('NO toca los números alfanuméricos (TG01, SV107) ni devuelve el valor exacto', () => {
    expect(cardNumberVariants('TG01')).toEqual([]);
    expect(cardNumberVariants('104')).not.toContain('104');
    expect(cardNumberVariants('  ')).toEqual([]);
  });
});

describe('PriceIngestService.resolveCardId — fallback por número con formato distinto (P-6)', () => {
  const fx = { rate: 18, bufferPct: 3 };

  function build(cards: { findFirst: jest.Mock; findMany?: jest.Mock }) {
    // §4.22a añadió una consulta `card.findMany` (lectura del catálogo de acabados para
    // `finishNotInCatalog`), con forma `where.id.in`. Se enruta por forma del `where` para no
    // interferir con la de este describe, que es la del fallback por NÚMERO (`where.number.in`).
    const variantFindMany = cards.findMany ?? jest.fn(async () => []);
    const routedFindMany = jest.fn(async (args: any) => {
      if (args?.where?.id) return []; // catálogo de acabados: sin drift en estos tests
      return variantFindMany(args);
    });
    const prisma = {
      cardSet: { findUnique: jest.fn(async () => SET) },
      card: {
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        findFirst: cards.findFirst,
        findMany: routedFindMany,
      },
    } as any;
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const provider = providerMock('pokemonpricetracker', [
      { externalId: null, setExternalId: 'sv8', number: '104/159', finish: 'normal', marketCents: 100, currency: 'USD' },
    ]);
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any, reconcilerMock() as any, pptMapperMock() as any, configMock() as any);
    return { svc, prisma, pricing, variantFindMany };
  }

  it('"104/159" del proveedor resuelve a la carta "104" del set (coincidencia ÚNICA)', async () => {
    const findMany = jest.fn(async () => [{ id: 'db-104' }]);
    const { svc, prisma, pricing, variantFindMany } = build({ findFirst: jest.fn(async () => null), findMany });

    const res = await svc.ingestSet('local-sv8', fx);

    expect(prisma.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { setId: 'local-sv8', number: '104/159' } }),
    );
    const variantsWhere = (variantFindMany.mock.calls[0] as unknown[])[0] as { where: { number: { in: string[] } } };
    expect(variantsWhere.where.number.in).toContain('104');
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-104', 'normal', expect.objectContaining({ marketCents: 100 }), fx,
    );
    expect(res.unresolved).toBe(0);
  });

  it('el número EXACTO manda: si casa, NO se consultan variantes', async () => {
    const findMany = jest.fn(async () => []);
    const { svc, pricing, variantFindMany } = build({ findFirst: jest.fn(async () => ({ id: 'db-exact' })), findMany });

    await svc.ingestSet('local-sv8', fx);
    expect(variantFindMany).not.toHaveBeenCalled();
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-exact', 'normal', expect.objectContaining({ marketCents: 100 }), fx,
    );
  });

  it('variantes AMBIGUAS (2 cartas casan) → se OMITE la fila (no se adivina la carta)', async () => {
    const findMany = jest.fn(async () => [{ id: 'db-a' }, { id: 'db-b' }]);
    const { svc, pricing } = build({ findFirst: jest.fn(async () => null), findMany });

    const res = await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).not.toHaveBeenCalled();
    expect(res.unresolved).toBe(1);
  });
});
