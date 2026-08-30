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

// v1.50.2 (BE-GE3): la carta trae `externalId`/`number` porque el ingest resuelve carta↔fila del
// proveedor **en memoria** (índice por set) en vez de una query por fila. El `select` real los pide.
const CARD = {
  id: 'c1',
  setId: 's1',
  externalId: 'sv8-104',
  number: '104',
  set: { id: 's1', externalId: 'sv8', name: 'Surging Sparks' },
};

/** Dos sets con una carta EN ALCANCE cada uno (para probar la escalada a escala de corrida). */
const DOS_SETS = [
  CARD,
  {
    id: 'c2',
    setId: 's2',
    externalId: 'sv9-001',
    number: '001',
    set: { id: 's2', externalId: 'sv9', name: 'Journey Together' },
  },
];
const DOS_CARTAS = [{ cardId: 'c1' }, { cardId: 'c2' }];
/** Respuesta del proveedor SIN novedades (cada test sobreescribe lo que le interesa). */
const RES_BASE = {
  rows: [] as unknown[],
  fetchedRaw: 1,
  drops: [],
  requestOk: true,
  dailyLimited: false,
  dailyRemaining: 100,
  escalate: null as unknown,
  sawGradedBlock: true,
  // v1.50.3-a (§4.38h.1-bis) — cartas por SHAPE servido. Es el insumo de la escalada «PPT sirve
  // mayoritariamente S2», que el orquestador juzga con la corrida entera delante.
  shapeCounts: { s1: 1, s2: 0 },
  forcedFormat: 'auto' as const,
};

function wireIngest(opts: {
  config?: Record<string, unknown>;
  published?: { cardId: string }[];
  /** Cartas que devuelve `card.findMany` (default: solo `CARD`). */
  cards?: unknown[];
  slabs?: Map<string, string[]>;
  providerRows?: unknown[];
  providerDrops?: { reason: string; externalId: string | null; count: number | null; sample: string }[];
  escalate?: unknown;
  sawGradedBlock?: boolean;
  shapeCounts?: { s1: number; s2: number };
  /** v1.50.3-c: qué le PEDIMOS mirar al proveedor. `auto` = autodetección (default). */
  forcedFormat?: 'auto' | 'sales_by_grade' | 'graded_prices';
}) {
  const store = new Map<string, unknown>(Object.entries(opts.config ?? {}));
  const prisma = {
    configSetting: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[]).filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) })),
      ),
    },
    inventoryItem: { findMany: jest.fn(async () => opts.published ?? [{ cardId: 'c1' }]) },
    card: { findMany: jest.fn(async () => opts.cards ?? [CARD]), findUnique: jest.fn(async () => ({ id: 'c1' })) },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as unknown as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'getPublishedSlabGradesBatch').mockResolvedValue(opts.slabs ?? new Map());
  const persist = jest.spyOn(pricing, 'persistGradedEstimateReference').mockResolvedValue(true);
  const fetchGraded = jest.fn(async () => ({
    rows: opts.providerRows ?? [],
    fetchedRaw: 1,
    drops: opts.providerDrops ?? [],
    requestOk: true,
    dailyLimited: false,
    dailyRemaining: 100,
    escalate: opts.escalate ?? null,
    // v1.50.2: el proveedor reporta si vio bloque PSA; el ORQUESTADOR decide con la corrida entera.
    sawGradedBlock: opts.sawGradedBlock ?? true,
    shapeCounts: opts.shapeCounts ?? { s1: 1, s2: 0 },
    // v1.50.3-c (§4.38h.1-bis): sin esto, `shapeCounts` no es interpretable — con el formato FORZADO
    // el conteo dice lo que pedimos, no lo que el proveedor sirve.
    forcedFormat: opts.forcedFormat ?? 'auto',
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

/**
 * v1.50.2 (techlead) — **la ambigüedad silenciosa se evalúa a escala de CORRIDA, no de set.**
 *
 * `no_graded_block_in_response` («el request pasó pero ninguna entrada trae bloque PSA») es ambiguo por
 * naturaleza: no distingue «este set no tiene ventas PSA» de «el proveedor ignoró `includeEbay`». Lo que
 * estaba mal calibrado era la CONSECUENCIA: paraba la corrida entera. **Un set sin ventas PSA es un
 * estado de datos normal**, así que un set inocente abortaba el run —con sus créditos ya gastados— y le
 * entregaba al arquitecto un veredicto que la evidencia no sostenía.
 *
 * La regla nueva: se escala **solo si NINGÚN set del run vio bloque PSA**. En cuanto uno lo ve, el shape
 * está confirmado por observación y los demás son un `skip` con traza.
 */
describe('§4.38h.4 — `no_graded_block_in_response`: escalada a escala de CORRIDA', () => {
  const SIN_BLOQUE = {
    reason: 'no_graded_block_in_response' as const,
    detail: 'El barrido del set sv8 devolvió 12 entradas … Muestra cruda: {...}',
  };

  it('NINGÚN set vio bloque PSA ⇒ SÍ escala (ahí la hipótesis «ignoró el parámetro» es indistinguible)', async () => {
    const { ingest, audit } = wireIngest({
      config: ON,
      providerRows: [ROW],
      escalate: SIN_BLOQUE,
      sawGradedBlock: false,
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toMatchObject({ reason: 'no_graded_block_in_response' });
    expect(res.skippedNoGradedBlock).toBe(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'graded_estimate.ingest.escalated' }),
    );
  });

  it('con AL MENOS UN set con bloque PSA ⇒ NO escala: el shape queda confirmado', async () => {
    // Dos sets: el primero trae bloque (y escribe), el segundo no. El segundo es un set sin ventas PSA.
    const { ingest, fetchGraded, audit } = wireIngest({ config: ON, cards: DOS_SETS, published: DOS_CARTAS });
    (fetchGraded as jest.Mock)
      .mockResolvedValueOnce({ ...RES_BASE, rows: [ROW], sawGradedBlock: true })
      .mockResolvedValueOnce({ ...RES_BASE, rows: [], sawGradedBlock: false, escalate: SIN_BLOQUE });

    const res = await ingest.ingestGradedEstimates(FX);

    expect(res.escalation).toBeNull();
    expect(res.sets).toBe(2); // ⚠️ el set inocente NO abortó la corrida
    expect(res.skippedNoGradedBlock).toBe(1);
    expect(res.written).toBe(1); // lo del primer set se escribió
    // …y el salto DEJA TRAZA: invisible no es aceptable, solo no es motivo de escalada.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'graded_estimate.ingest.skipped',
        after: expect.objectContaining({ reason: 'no_graded_block_in_response' }),
      }),
    );
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'graded_estimate.ingest.escalated' }),
    );
  });

  it('la escalada DURA (4xx del proveedor) sigue PARANDO en el acto, sin esperar al cierre', async () => {
    const { ingest, fetchGraded } = wireIngest({ config: ON, cards: DOS_SETS, published: DOS_CARTAS });
    (fetchGraded as jest.Mock).mockResolvedValue({
      ...RES_BASE,
      rows: [],
      sawGradedBlock: false,
      escalate: { reason: 'ebay_not_supported_with_set_sweep', detail: 'HTTP 400' },
    });
    const res = await ingest.ingestGradedEstimates(FX);
    // El proveedor RECHAZÓ el parámetro (lo dijo con un 4xx): seguir barriendo solo quema créditos.
    expect(res.escalation).toMatchObject({ reason: 'ebay_not_supported_with_set_sweep' });
    expect(res.sets).toBe(1);
  });
});

/**
 * §4.38h.1-bis (v1.50.3-a) — **la señal de shape S2 a escala de CORRIDA.**
 *
 * ### Qué protege este bloque
 * Dos cosas que el addendum separa a propósito:
 *
 * 1. **El contador va APARTE.** `SHAPE_NOT_PERSISTIBLE_S2` no se suma a `skippedSample` ni a
 *    `skippedEvidence`, porque «el proveedor cambió de shape» y «esta carta tiene pocas ventas» exigen
 *    **reacciones opuestas** —escalar vs. no hacer nada— y un contador único los vuelve indistinguibles
 *    **justo cuando hay que decidir**.
 * 2. **Si S2 DOMINA, se escala; no se parchea.** Lo que ese hallazgo significa no es un problema de
 *    código: significa que **la fase 2 no es viable con este proveedor**, y elegir entre degradar a
 *    manual de forma permanente, cambiar de proveedor o pagar el plan que exponga `salesByGrade` es
 *    decisión de **producto y de costo** (regla 9). Y no hay acantilado detrás: la degradación a manual
 *    ya está diseñada y funciona.
 */
describe('§4.38h.1-bis — shape S2: contador propio y escalada de corrida', () => {
  const dropS2 = (id: string) => ({
    externalId: id,
    reason: 'shape_not_persistible_s2',
    count: null,
    sample: `{"gradedPrices":{"psa10":60}}`,
  });
  const dropMuestra = {
    externalId: 'sv8-9',
    reason: 'sample_too_small',
    count: 1,
    sample: '{"psa10":{"count":1}}',
  };

  it('el contador de S2 es PROPIO: no contamina `skippedSample` ni `skippedEvidence`', async () => {
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1'), dropMuestra],
      shapeCounts: { s1: 5, s2: 1 }, // S1 sigue dominando ⇒ no escala
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.skippedShapeS2).toBe(1);
    expect(res.skippedSample).toBe(1); // el drop de muestra sigue en SU contador
    expect(res.skippedEvidence).toBe(0); // y NO se coló en el de evidencia
    expect(res.escalation).toBeNull(); // una carta suelta en S2 no sostiene el veredicto
  });

  it('cada carta en S2 deja TRAZA en `AuditLog` con su motivo (no se disuelve en un total)', async () => {
    const { ingest, audit } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      shapeCounts: { s1: 3, s2: 1 },
    });
    await ingest.ingestGradedEstimates(FX);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'graded_estimate.ingest.skipped',
        after: expect.objectContaining({ reason: 'shape_not_persistible_s2', providerCardId: 'sv8-1' }),
      }),
    );
  });

  it('si PPT sirve MAYORITARIAMENTE S2 ⇒ ESCALA al arquitecto (no se parchea ni se inventa un dial)', async () => {
    const { ingest, audit } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1'), dropS2('sv8-2'), dropS2('sv8-3')],
      // Vía (B): mayoría estricta SOBRE el suelo (6 observaciones ≥ min(5, 8 en alcance)) y con
      // `forcedFormat: auto`. Las dos condiciones que hacen que el veredicto hable del PROVEEDOR.
      published: Array.from({ length: 8 }, (_, i) => ({ cardId: `c${i + 1}` })),
      shapeCounts: { s1: 2, s2: 4 },
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toMatchObject({ reason: 'shape_not_persistible_s2_dominant' });
    expect(res.escalation!.detail).toContain('NO PERSISTIBLE');
    // v1.50.3-c: la PROCEDENCIA del veredicto viaja con el veredicto — sin abrir el log se ve que el
    // conteo es una observación (formato `auto`), por qué vía se disparó y contra qué suelo.
    expect(res.escalation!.detail).toContain('GRADED_FORMAT=auto');
    expect(res.escalation!.detail).toContain('regla B');
    expect(res.escalation!.detail).toContain('suelo de 5');
    expect(res.skippedShapeS2).toBe(3);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'graded_estimate.ingest.escalated',
        after: expect.objectContaining({ reason: 'shape_not_persistible_s2_dominant' }),
      }),
    );
  });

  it('S2 EXCLUSIVO (cero S1) también escala: es el caso más claro de «este proveedor no sirve»', async () => {
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      shapeCounts: { s1: 0, s2: 5 }, // cero S1, y con muestra suficiente para sostenerlo
    });
    expect((await ingest.ingestGradedEstimates(FX)).escalation).toMatchObject({
      reason: 'shape_not_persistible_s2_dominant',
    });
  });

  /**
   * v1.50.3-c — **REGLA (A) del arquitecto (§4.38h.1-ter): «cero S1» escala SIN suelo.**
   *
   * «Nunca hemos visto un S1» es **cualitativamente distinto** de «vemos una mezcla en la que S2 gana»:
   * sugiere que `ebay.salesByGrade` **no existe en este plan o en esta cuenta**, y ahí una sola
   * observación ya es informativa. El coste de escalar de más es **una conversación**; el de no escalar
   * es una feature muerta sin que nadie se entere.
   */
  it('REGLA A — UNA sola observación, cero S1, alcance grande ⇒ escala igual (el suelo NO aplica)', async () => {
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      // 40 cartas en alcance ⇒ el suelo de la vía (B) sería 5 y NO se alcanzaría con 1 observación.
      published: Array.from({ length: 40 }, (_, i) => ({ cardId: `c${i + 1}` })),
      shapeCounts: { s1: 0, s2: 1 },
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toMatchObject({ reason: 'shape_not_persistible_s2_dominant' });
    // El veredicto DICE por qué vía se disparó: (A) y (B) piden lecturas distintas del hallazgo.
    expect(res.escalation!.detail).toContain('regla A');
    expect(res.escalation!.detail).toContain('CERO observaciones S1');
  });

  it('REGLA A — el formato FORZADO la desactiva también: con `graded_prices` el «cero S1» lo ordenamos nosotros', async () => {
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      shapeCounts: { s1: 0, s2: 3 },
      forcedFormat: 'graded_prices',
    });
    expect((await ingest.ingestGradedEstimates(FX)).escalation).toBeNull();
  });

  // ───────────── v1.50.3-c (techlead): la escalada NO puede AUTOINDUCIR su veredicto ─────────────
  //
  // Mismo criterio que ya justificaba la mayoría estricta («una escalada tiene que poder sostener su
  // veredicto»), aplicado a las dos vías por las que el conteo deja de ser evidencia sobre el proveedor.

  it('REGLA B — una MEZCLA por debajo del suelo NO escala: `2 > 1` sobre 3 observaciones con 40 cartas en alcance', async () => {
    const { ingest, audit } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      published: Array.from({ length: 40 }, (_, i) => ({ cardId: `c${i + 1}` })),
      shapeCounts: { s1: 1, s2: 2 }, // hay S1 ⇒ la vía (A) no aplica; 3 < min(5, 40) = 5
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toBeNull();
    // La señal no se pierde: se sigue saltando, contando y auditando carta por carta.
    expect(res.skippedShapeS2).toBe(1);
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'graded_estimate.ingest.escalated' }),
    );
  });

  it('REGLA B — justo EN el suelo (5 observaciones, 40 en alcance) sí escala: el corte es `< suelo`, no `<= suelo`', async () => {
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      published: Array.from({ length: 40 }, (_, i) => ({ cardId: `c${i + 1}` })),
      shapeCounts: { s1: 2, s2: 3 },
    });
    expect((await ingest.ingestGradedEstimates(FX)).escalation).toMatchObject({
      reason: 'shape_not_persistible_s2_dominant',
    });
  });

  /**
   * v1.50.3-c — **el ajuste del arquitecto (§4.38h.1-ter / GU-A25): el suelo es `min(5, alcance)`.**
   *
   * El suelo ABSOLUTO de 5 que propuso backend tenía **el mismo bug que el `STALE` inalcanzable** que
   * este pase acababa de arreglar: el alcance del ingest es «solo cartas con inventario publicado», así
   * que **una tienda con 3 cartas nunca llegaría a 5** y la fase 2 moriría en silencio con su propio
   * aviso apagado. Éste es el caso que el suelo relativo rescata.
   */
  it('TIENDA CHICA — 3 cartas en alcance, las 3 con S2 mayoritario: escala porque el suelo es min(5, 3) = 3', async () => {
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      published: [{ cardId: 'c1' }, { cardId: 'c2' }, { cardId: 'c3' }],
      shapeCounts: { s1: 1, s2: 2 }, // hay S1 (no es la vía A) y 3 observaciones == el suelo relativo
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toMatchObject({ reason: 'shape_not_persistible_s2_dominant' });
    // El veredicto explica CONTRA QUÉ suelo se midió — auditable meses después, cuando el alcance ya
    // sea otro (por eso el suelo efectivo y `cardsInScope` van también a la bitácora).
    expect(res.escalation!.detail).toContain('suelo de 3');
    expect(res.escalation!.detail).toContain('3 carta(s) en alcance');
  });

  it('TIENDA CHICA — con el MISMO conteo pero 40 cartas en alcance, NO escala (el suelo vuelve a ser 5)', async () => {
    // El mismo `shapeCounts` da veredictos distintos según el TAMAÑO de la corrida, y eso es el punto:
    // 3 de 3 es «todo lo que vimos», 3 de 40 es una esquina del catálogo.
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      published: Array.from({ length: 40 }, (_, i) => ({ cardId: `c${i + 1}` })),
      shapeCounts: { s1: 1, s2: 2 },
    });
    expect((await ingest.ingestGradedEstimates(FX)).escalation).toBeNull();
  });

  it('FORMATO FORZADO: con GRADED_FORMAT=graded_prices NO escala — el conteo mide lo que PEDIMOS, no lo que el proveedor sirve', async () => {
    // El `forcedFormat` pone `useS1 = false` en el parser, así que TODA carta con bloque `gradedPrices`
    // se cuenta como S2 aunque traiga `ebay.salesByGrade` persistible: el 100% de S2 es un ECO del
    // override del operador. Y §4.38h.1-bis declara ese forzado explícitamente LEGAL.
    const { ingest, audit } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1'), dropS2('sv8-2')],
      shapeCounts: { s1: 0, s2: 20 }, // abrumador, y aun así NO es evidencia sobre el proveedor
      forcedFormat: 'graded_prices',
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toBeNull();
    expect(res.skippedShapeS2).toBe(2); // se siguen saltando como NO PERSISTIBLES: nada se escribió
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'graded_estimate.ingest.escalated' }),
    );
  });

  it('FORMATO FORZADO: basta que UN set de la corrida haya ido forzado para invalidar el conteo global', async () => {
    const { ingest } = wireIngest({
      config: ON,
      providerDrops: [dropS2('sv8-1')],
      shapeCounts: { s1: 1, s2: 9 },
      forcedFormat: 'sales_by_grade',
    });
    expect((await ingest.ingestGradedEstimates(FX)).escalation).toBeNull();
  });

  it('la escalada NO destruye nada: lo que SÍ se pudo escribir en la corrida se conserva', async () => {
    // No hay acantilado detrás de esta decisión: la degradación a manual ya existe y funciona. Se pierde
    // la AUTOMATIZACIÓN de la feature, no la feature — así que el job deja el veredicto y sigue.
    const { ingest, persist } = wireIngest({
      config: ON,
      providerRows: [ROW],
      providerDrops: [dropS2('sv8-1'), dropS2('sv8-2')],
      shapeCounts: { s1: 2, s2: 4 },
    });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.escalation).toMatchObject({ reason: 'shape_not_persistible_s2_dominant' });
    expect(res.written).toBe(1);
    expect(persist).toHaveBeenCalled();
  });

  it('la escalada DURA (4xx) tiene precedencia: no se pisa con el veredicto de shape', async () => {
    // Son dos diagnósticos distintos y el primero PARÓ el job; sobrescribirlo mandaría al arquitecto a
    // decidir sobre el proveedor cuando lo que hay delante es un rechazo de parámetros.
    const { ingest } = wireIngest({
      config: ON,
      escalate: { reason: 'ebay_not_supported_with_set_sweep', detail: 'HTTP 400' },
      shapeCounts: { s1: 0, s2: 5 },
    });
    expect((await ingest.ingestGradedEstimates(FX)).escalation).toMatchObject({
      reason: 'ebay_not_supported_with_set_sweep',
    });
  });
});
