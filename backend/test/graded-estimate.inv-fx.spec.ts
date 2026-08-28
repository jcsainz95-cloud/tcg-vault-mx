import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PriceIngestService, FxSnapshot } from '../src/modules/pricing/price-ingest.service';
import { PokemonPriceTrackerBulkProvider } from '../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { PptSetMapper } from '../src/modules/pricing/ppt-set-mapper.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SettingKey } from '../src/modules/settings/settings.constants';

/**
 * v1.50.2 — **INV-FX** (ARCHITECTURE §4.38a, invariante NUMERADO **de dinero**) + el alcance y las
 * guardas del ingest de fase 2 (§4.38h).
 *
 * ### Por qué INV-FX es un invariante y no una nota al pie
 * La MISMA fila (`cardId` + `graded` + `gradeKey` + `finish='normal'`) se escribe por **dos rutas con
 * unidades distintas**:
 *  - **fase 1 (manual)** → `POST /admin/pricing/override` recibe **MXN directo**, sin FX;
 *  - **fase 2 (ingest)** → **PPT entrega USD** ⇒ hay que persistir `priceUsdCents` + `fxRate`.
 *
 * Dos rutas con unidades distintas hacia la misma fila **es el mecanismo exacto de un error de ~19×**.
 * Y la dirección importa: escribir el numeral USD en `priceMxnCents` deja el número ~19× **BAJO**, así
 * que **ninguna cota superior lo ve** — solo la cota inferior del gate de confianza lo cazaría aguas
 * abajo. Es mucho más barato prevenirlo en ORIGEN, y eso es lo que estas pruebas fijan.
 */

const FX: FxSnapshot = { rate: 19, bufferPct: 5 };

function wirePricing(existing: Record<string, unknown> | null = null) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const prisma = {
    priceReference: {
      findFirst: jest.fn(async () => existing),
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'pr-new', ...data };
      }),
      update: jest.fn(async ({ data }: any) => {
        updated.push(data);
        return { id: 'pr-1', ...data };
      }),
    },
  } as unknown as PrismaService;
  const pricing = new PricingService(
    prisma,
    {} as unknown as SettingsService,
    {} as unknown as FxService,
    {} as never,
    {} as never,
    {} as never,
  );
  return { pricing, prisma, created, updated };
}

describe('INV-FX (§4.38a) — el ingest escribe USD + fxRate, JAMÁS el numeral USD en `priceMxnCents`', () => {
  it('USD 60.00 ⇒ `priceUsdCents=6000`, `fxRate=19`, y `priceMxnCents` es la CONVERSIÓN (no 6000)', async () => {
    const { pricing, created } = wirePricing();
    const wrote = await pricing.persistGradedEstimateReference(
      'c1',
      '10',
      { amountCents: 6_000, currency: 'USD', source: 'pokemonpricetracker' },
      FX,
    );
    expect(wrote).toBe(true);
    expect(created[0]).toMatchObject({
      cardId: 'c1',
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      finish: 'normal', // §4.38a: el grado NO se cruza con el acabado, SIEMPRE `normal`
      source: 'pokemonpricetracker',
      priceUsdCents: 6_000,
      fxRate: 19,
      fxBufferPct: 5,
      isManualOverride: false,
    });
    // 6000 × 19 × 1.05 = 119 700. Lo que NO puede pasar es que `priceMxnCents` sea 6 000.
    expect(created[0].priceMxnCents).toBe(119_700);
    expect(created[0].priceMxnCents).not.toBe(6_000);
  });

  it('el error de 19×, medido: escribir el numeral USD dejaría la cifra ~19 veces POR DEBAJO', async () => {
    const { pricing, created } = wirePricing();
    await pricing.persistGradedEstimateReference(
      'c1',
      '10',
      { amountCents: 6_000, currency: 'USD', source: 'pokemonpricetracker' },
      FX,
    );
    const correcto = created[0].priceMxnCents as number;
    expect(correcto / 6_000).toBeGreaterThan(18); // ≈19.95 con el colchón
  });

  it('la vía MXN (manual) NO lleva FX: `priceUsdCents`/`fxRate` en `null` y el monto verbatim', async () => {
    const { pricing, created } = wirePricing();
    await pricing.persistGradedEstimateReference(
      'c1',
      '9',
      { amountCents: 500_000, currency: 'MXN', source: 'manual' },
      FX,
    );
    expect(created[0]).toMatchObject({
      priceMxnCents: 500_000,
      priceUsdCents: null,
      fxRate: null,
      fxBufferPct: null,
    });
  });

  it('respeta el override MANUAL del día (§O.6: el manual gana; el ingest no lo pisa)', async () => {
    const { pricing, prisma } = wirePricing({ id: 'pr-1', isManualOverride: true });
    const wrote = await pricing.persistGradedEstimateReference(
      'c1',
      '10',
      { amountCents: 6_000, currency: 'USD', source: 'pokemonpricetracker' },
      FX,
    );
    expect(wrote).toBe(false);
    expect((prisma as any).priceReference.update).not.toHaveBeenCalled();
    expect((prisma as any).priceReference.create).not.toHaveBeenCalled();
  });

  it('money-safe: un monto <= 0 NO es un estimado y no produce escritura', async () => {
    const { pricing, prisma } = wirePricing();
    for (const amountCents of [0, -1, 1.5]) {
      expect(
        await pricing.persistGradedEstimateReference(
          'c1',
          '10',
          { amountCents, currency: 'USD', source: 'pokemonpricetracker' },
          FX,
        ),
      ).toBe(false);
    }
    expect((prisma as any).priceReference.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------

const CARD = { id: 'c1', setId: 's1', set: { id: 's1', externalId: 'sv8', name: 'Surging Sparks' } };

function wireIngest(opts: {
  config?: Record<string, unknown>;
  published?: { cardId: string }[];
  slabs?: Map<string, string[]>;
  providerRows?: unknown[];
  escalate?: unknown;
}) {
  const store = new Map<string, unknown>(Object.entries(opts.config ?? {}));
  const prisma = {
    configSetting: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[]).filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) })),
      ),
    },
    inventoryItem: { findMany: jest.fn(async () => opts.published ?? [{ cardId: 'c1' }]) },
    card: { findMany: jest.fn(async () => [CARD]), findUnique: jest.fn(async () => ({ id: 'c1' })) },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as unknown as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'getPublishedSlabGradesBatch').mockResolvedValue(opts.slabs ?? new Map());
  const persist = jest.spyOn(pricing, 'persistGradedEstimateReference').mockResolvedValue(true);
  const fetchGraded = jest.fn(async () => ({
    rows: opts.providerRows ?? [],
    fetchedRaw: 1,
    drops: [],
    requestOk: true,
    dailyLimited: false,
    dailyRemaining: 100,
    escalate: opts.escalate ?? null,
  }));
  const pptBulk = { fetchGradedEstimatesForSet: fetchGraded } as unknown as PokemonPriceTrackerBulkProvider;
  const pptSetMapper = {
    resolveForSets: jest.fn(async () => new Map([['s1', 'sv8']])),
  } as unknown as PptSetMapper;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const ingest = new PriceIngestService(
    prisma, settings, pricing, pptBulk, {} as never, {} as never, pptSetMapper, {} as never, undefined, audit,
  );
  return { ingest, persist, fetchGraded, audit, prisma };
}

const ON = {
  [SettingKey.GRADED_ESTIMATE_INGEST_ENABLED]: 'on',
  [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on',
};
const ROW = {
  externalId: 'sv8-104',
  number: '104',
  gradeValue: '10',
  amountCents: 6_000,
  currency: 'USD' as const,
  count: 7,
  source: 'pokemonpricetracker' as const,
};

describe('§4.38h — el job del ingest: diales, alcance e INV-D', () => {
  it('con el dial `graded_estimate_ingest_enabled` en `off` (seed) NO se pide NADA (cero créditos)', async () => {
    const { ingest, fetchGraded } = wireIngest({ config: { [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on' } });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.enabled).toBe(false);
    expect(fetchGraded).not.toHaveBeenCalled();
  });

  it('los DOS diales son independientes: el ingest puede rodar con la EXHIBICIÓN apagada (§4.38d)', async () => {
    // Es la secuencia de encendido que pide §4.38h: rodar en observación antes de publicar.
    const { ingest, fetchGraded } = wireIngest({
      config: { [SettingKey.GRADED_ESTIMATE_INGEST_ENABLED]: 'on' }, // exhibición `off`
      providerRows: [ROW],
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.enabled).toBe(true);
    expect(fetchGraded).toHaveBeenCalled();
  });

  it('config del INGEST presente-pero-INVÁLIDA ⇒ NO escribe (no se adivina qué número es el precio)', async () => {
    const { ingest, fetchGraded } = wireIngest({
      config: { ...ON, [SettingKey.GRADED_ESTIMATE_SOURCE_STAT]: 'lo-que-sea' },
      providerRows: [ROW],
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.enabled).toBe(false);
    expect(fetchGraded).not.toHaveBeenCalled();
  });

  it('ALCANCE: solo cartas con inventario RAW PUBLICADO (acota los 2 créditos/carta de `includeEbay`)', async () => {
    const { ingest, prisma } = wireIngest({ config: ON, providerRows: [ROW] });
    await ingest.ingestGradedEstimates(FX);
    const where = (prisma as any).inventoryItem.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ ownerType: 'platform', status: 'listed', productType: 'raw' });
  });

  it('el tope DURO por corrida se aplica (un error de alcance no puede quemar la cuota del día)', async () => {
    const published = Array.from({ length: 500 }, (_, i) => ({ cardId: `c${i}` }));
    const { ingest } = wireIngest({
      config: { ...ON, [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 10 },
      published,
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.cardsInScope).toBe(10);
  });

  it('INV-D (§4.38l): con SLAB PUBLICADO de ese grado se SALTA la carta y queda `AuditLog`', async () => {
    const { ingest, persist, audit } = wireIngest({
      config: ON,
      providerRows: [ROW],
      slabs: new Map([['c1', ['10']]]),
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.skippedSlabPublished).toBe(1);
    expect(persist).not.toHaveBeenCalled(); // esa fila es DINERO de una pieza real, no un estimado
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'graded_estimate.ingest.skipped',
        after: expect.objectContaining({ reason: 'slab_published', gradeValue: '10' }),
      }),
    );
  });

  it('camino feliz: resuelve la carta y persiste con la MONEDA del proveedor (INV-FX de punta a punta)', async () => {
    const { ingest, persist } = wireIngest({ config: ON, providerRows: [ROW] });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.written).toBe(1);
    expect(persist).toHaveBeenCalledWith(
      'c1',
      '10',
      { amountCents: 6_000, currency: 'USD', source: 'pokemonpricetracker' },
      FX,
    );
  });

  /**
   * ⛔ Regla 9 en ejecución: el job **para** y lo deja escrito para el arquitecto. NO improvisa el modo
   * «una petición por carta», que multiplicaría el coste por el nº de cartas y obligaría a un ingest
   * curado por lista — decisión de arquitectura y de presupuesto, no de implementación.
   */
  it('ESCALADA: si el proveedor no admite `includeEbay` con el barrido, el job PARA y no escribe', async () => {
    const { ingest, persist } = wireIngest({
      config: ON,
      providerRows: [ROW],
      escalate: { reason: 'ebay_not_supported_with_set_sweep', detail: 'HTTP 400' },
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toMatchObject({ reason: 'ebay_not_supported_with_set_sweep' });
    expect(res.written).toBe(0);
    expect(persist).not.toHaveBeenCalled();
  });
});
