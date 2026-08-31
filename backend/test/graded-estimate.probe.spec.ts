import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardSet } from '@prisma/client';
import { PokemonPriceTrackerBulkProvider } from '../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { PptApiClient } from '../src/modules/pricing/providers/ppt-api.client';
import { PriceIngestService, FxSnapshot } from '../src/modules/pricing/price-ingest.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PptSetMapper } from '../src/modules/pricing/ppt-set-mapper.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import {
  gradedPhase2Verdict,
  shapeCountIsInduced,
  GRADED_VERDICT_TAG,
  GradedRequestTally,
  GradedRunOutcome,
} from '../src/modules/pricing/graded-phase2-verdict';

/**
 * v1.50.3-g (§4.38h.1-quater) — **LA SONDA: preguntar sin escribir, y que el veredicto se lea.**
 *
 * ### El defecto que este archivo pone en rojo
 * El camino graded, sin `POKEMONPRICETRACKER_MARKET_FORMAT`, hacía `return empty` **antes** del bucle de
 * fetch y logueaba «modo SAMPLE-ONLY … fija el formato tras inspeccionar el log». No había log que
 * inspeccionar: **no se hacía ninguna petición y no se logueaba ninguna muestra**. El modo que la
 * doctrina P-6 pedía —observar el esquema antes de codificar contra él— sencillamente no existía, y con
 * él se quedaba bloqueada la única pregunta que falta para cerrar la fase 2: *¿qué formato entrega
 * PokemonPriceTracker con el plan del dueño?*
 *
 * El camino de precios RAW del mismo archivo ya lo hacía bien (pide la página, loguea `Ejemplo crudo:`
 * y **entonces** corta con `sample-only`). La corrección copia ese patrón. Las pruebas de aquí son, en
 * este orden: **(1) que se pregunta**, **(2) que se ve la respuesta**, **(3) que no se escribe nada**.
 * La (1) es la que vuelve a rojo si alguien revierte el arreglo.
 *
 * S2 (`gradedPrices.psaN`, escalar) **sigue NO PERSISTIBLE** (§4.38h.1-bis): la sonda lo DETECTA y lo
 * REPORTA. Aquí no hay escotilla nueva ni se relaja ninguna.
 */

const SET = { id: 'local-sv8', externalId: 'sv8', name: 'Surging Sparks' } as unknown as CardSet;
const HOY = new Date().toISOString().slice(0, 10); // evidencia FRESCA sea cual sea el día del CI

function cfg(over: Record<string, string | undefined> = {}): ConfigService {
  const env: Record<string, string | undefined> = {
    POKEMONPRICETRACKER_API_KEY: 'k',
    POKEMONPRICETRACKER_MARKET_FORMAT: 'usd_dollars',
    ...over,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

function provider(c: ConfigService): PokemonPriceTrackerBulkProvider {
  return new PokemonPriceTrackerBulkProvider(c, new PptApiClient(c));
}

/** `fetch` mockeado. `daily` = valor del header de cuota (para medir el COSTE de la corrida). */
function mockPages(pages: unknown[], daily: (number | null)[] = []) {
  let call = 0;
  const spy = jest.fn(async () => {
    const body = pages.shift() ?? { data: [], total: 0, count: 0, limit: 200, offset: 0, hasMore: false };
    const remaining = daily[call++] ?? null;
    return {
      ok: true,
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'x-ratelimit-daily-remaining' && remaining != null ? String(remaining) : null) },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

/** S1 impecable: en modo NORMAL esta misma entrada SÍ se persiste (lo comprueba un test más abajo). */
const S1_BUENO = { count: 7, medianPrice: 60, lastSaleDate: HOY };
const pageS1 = (over: Record<string, unknown> = {}) => ({
  data: [{ id: 'sv8-104', cardNumber: '104', ebay: { salesByGrade: { psa10: S1_BUENO } }, ...over }],
  total: 1,
  count: 1,
  hasMore: false,
});
const pageS2 = () => ({
  data: [{ id: 'sv8-104', cardNumber: '104', gradedPrices: { psa10: 60 } }],
  total: 1,
  count: 1,
  hasMore: false,
});

const call = (p: PokemonPriceTrackerBulkProvider) =>
  p.fetchGradedEstimatesForSet({
    set: SET,
    providerSetId: 'sv8',
    grades: ['10', '9'],
    minSampleCount: 3,
    sourceStat: 'median',
    freshnessDays: 30,
    today: HOY,
  });

/** Captura TODO lo que el código loguea, en el orden en que lo loguea. */
function capturarLogs(): string[] {
  const out: string[] = [];
  const push = (m: unknown) => {
    out.push(String(m));
  };
  for (const nivel of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, nivel).mockImplementation(push as never);
  }
  return out;
}

afterEach(() => jest.restoreAllMocks());

// =================================================================================================
describe('§4.38h.1-quater — la SONDA sin `MARKET_FORMAT`: SÍ pregunta, SÍ loguea, NO escribe', () => {
  /**
   * ⛑️ **EL TEST DE REGRESIÓN.** Con el `return empty` anterior al bucle de fetch, `spy` no se llamaba
   * NUNCA: este `expect` es el que se pone en rojo si alguien revierte el arreglo.
   */
  it('SIN formato de moneda ⇒ HAY petición al proveedor (antes: `return` antes del fetch, cero peticiones)', async () => {
    const spy = mockPages([pageS1()]);
    await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(spy).toHaveBeenCalledTimes(1);
    // Y la pide EXACTAMENTE como la pediría la corrida real: lo que se observa es lo que se ingestará.
    const url = String((spy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('setId=sv8');
    expect(url).toContain('includeEbay=true');
    expect(url).toContain('fetchAllInSet=true');
  });

  it('la MUESTRA CRUDA se loguea (era imposible: el `return` impedía generar el log que él mismo pedía)', async () => {
    const logs = capturarLogs();
    mockPages([pageS1()]);
    await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(logs.join('\n')).toContain('Ejemplo crudo');
    // El bloque de grados CRUDO, que es el dato con el que un humano confirma el esquema.
    expect(logs.join('\n')).toContain('salesByGrade');
    expect(logs.join('\n')).toContain('medianPrice');
  });

  it('CERO filas aunque la entrada sea un S1 impecable — y la prueba de que el fixture sí escribiría', async () => {
    // Sin este contraste, «0 filas» no probaría nada (podría ser un fixture malo).
    mockPages([pageS1()]);
    const conFormato = await call(provider(cfg()));
    expect(conFormato.rows).toHaveLength(1);
    expect(conFormato.probe).toBe(false);

    mockPages([pageS1()]);
    const sonda = await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(sonda.rows).toEqual([]);
    expect(sonda.probe).toBe(true);
    expect(sonda.requestOk).toBe(true); // preguntó; simplemente no escribe
  });

  it('reporta el SHAPE observado: S1 se cuenta como S1 y S2 como S2 (detecta y reporta, no persiste)', async () => {
    mockPages([pageS1()]);
    const s1 = await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(s1.shapeCounts).toEqual({ s1: 1, s2: 0 });
    expect(s1.sawGradedBlock).toBe(true);

    mockPages([pageS2()]);
    const s2 = await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(s2.shapeCounts).toEqual({ s1: 0, s2: 1 });
    expect(s2.rows).toEqual([]); // S2 NO PERSISTIBLE (§4.38h.1-bis): la sonda tampoco lo relaja
  });

  it('deja un reporte por set con marca fija (`PPT-GRADED-SONDA`) y el bloque PSA crudo', async () => {
    const logs = capturarLogs();
    mockPages([pageS1()]);
    await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    const reporte = logs.find((l) => l.includes('PPT-GRADED-SONDA'));
    expect(reporte).toBeDefined();
    expect(reporte).toContain('1 con S1');
    expect(reporte).toContain('ESCRITURAS: 0');
    expect(reporte).toContain('salesByGrade');
  });

  it('ACOTA EL GASTO: la sonda se queda con la PRIMERA página aunque el proveedor diga `hasMore`', async () => {
    const spy = mockPages([{ ...pageS1(), hasMore: true, total: 400, count: 200 }, pageS1()]);
    await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(spy).toHaveBeenCalledTimes(1); // la 2ª página sería la misma respuesta pagada dos veces
  });

  /**
   * 💸 **TL-GE1 — EL COSTE TIENE QUE SER ATRIBUIBLE.**
   *
   * Antes se medía como `dailyRemainingBefore − dailyRemaining` sobre el contador del **singleton**
   * `PptApiClient`, que pisa cualquier respuesta de PPT: el barrido de precios RAW corre en la MISMA
   * corrida y movía ese contador, así que la sonda se apuntaba créditos ajenos. Con el umbral de
   * `>= 0.5 crédito/carta` eso puede disparar una escalada de presupuesto FALSA, y la cifra es
   * precondición del primer `off → on` (§4.38r.3.1.1). Ahora se suma `metadata.apiCallsConsumed` de
   * las respuestas graded, que es lo único que habla de ESTAS llamadas.
   */
  it('MIDE el coste con lo que el proveedor cobró POR ESTAS LLAMADAS (`metadata.apiCallsConsumed`)', async () => {
    mockPages([{ ...pageS1(), metadata: { apiCallsConsumed: 2 } }]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(res.gradedApiCallsConsumed).toBe(2);
  });

  it('COSTE: el contador diario COMPARTIDO ya no puede contaminar la cifra (el bug de TL-GE1)', async () => {
    // El fixture reproduce el escenario real: el contador diario cae 400 (barrido RAW de la misma
    // corrida) mientras la llamada graded declara haber consumido 2. La resta habría reportado 400.
    const p = provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined }));
    mockPages([pageS1()], [1000]);
    await call(p); // fija el contador del singleton en 1000
    mockPages([{ ...pageS1(), metadata: { apiCallsConsumed: 2 } }], [600]);
    const res = await call(p);
    expect(res.gradedApiCallsConsumed).toBe(2);
  });

  it('COSTE: si el proveedor NO reporta `apiCallsConsumed`, se dice `null` — no se inventa un número', async () => {
    mockPages([pageS1()], [900]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(res.gradedApiCallsConsumed).toBeNull();
  });

  it('sin llamada (sin pptSetId) el coste es CERO y ATRIBUIBLE, no «desconocido»', async () => {
    const p = provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined }));
    const res = await p.fetchGradedEstimatesForSet({
      set: SET,
      providerSetId: null,
      grades: ['10'],
      minSampleCount: 3,
      sourceStat: 'median',
      freshnessDays: 30,
      today: HOY,
    });
    expect(res.gradedApiCallsConsumed).toBe(0);
  });

  it('la sonda clasifica por OBSERVACIÓN: `GRADED_FORMAT` forzado no puede inducir su conteo', async () => {
    // El override manda —intacto— en el camino que ESCRIBE. Pero la pregunta de la sonda es «¿qué
    // sirve el proveedor?», y un conteo filtrado por lo que le pedimos mirar no la contesta.
    mockPages([pageS1()]);
    const res = await call(
      provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined, POKEMONPRICETRACKER_GRADED_FORMAT: 'graded_prices' })),
    );
    expect(res.shapeCounts).toEqual({ s1: 1, s2: 0 });
    expect(res.rows).toEqual([]);
  });

  it('sin API key NO hay sonda (no se puede preguntar): cero peticiones y `probe:false`', async () => {
    const spy = mockPages([pageS1()]);
    const res = await call(
      provider(cfg({ POKEMONPRICETRACKER_API_KEY: undefined, POKEMONPRICETRACKER_MARKET_FORMAT: undefined })),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(res.probe).toBe(false); // no fue una sonda: fue un no-op. Decir otra cosa mentiría al veredicto
  });
});

// =================================================================================================
describe('§4.38h.1-quater — `POKEMONPRICETRACKER_GRADED_PROBE`: observar SIN apagar los precios raw', () => {
  it('con el formato FIJADO, la env de sonda manda: hay petición, hay muestra y CERO filas', async () => {
    const logs = capturarLogs();
    const spy = mockPages([pageS1()]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_PROBE: 'on' })));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.rows).toEqual([]);
    expect(res.probe).toBe(true);
    expect(logs.join('\n')).toContain('SONDA pedida por el operador');
  });

  it.each(['on', 'true', '1', 'yes'])('acepta `%s`; cualquier otro valor NO activa la sonda', async (v) => {
    mockPages([pageS1()]);
    expect((await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_PROBE: v })))).probe).toBe(true);
    mockPages([pageS1()]);
    expect((await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_PROBE: 'off' })))).probe).toBe(false);
  });

  it('sentido ÚNICO: la env solo QUITA capacidad de escribir, nunca la da (sin formato sigue sin escribir)', async () => {
    mockPages([pageS1()]);
    const res = await call(
      provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined, POKEMONPRICETRACKER_GRADED_PROBE: 'off' })),
    );
    expect(res.rows).toEqual([]);
    expect(res.probe).toBe(true); // el candado histórico (sin moneda no se escribe dinero) sigue mandando
  });
});

// =================================================================================================
// CERO ESCRITURAS EN `PriceReference`, comprobado donde de verdad se escribe: el job completo con el
// provider REAL, `fetch` mockeado y un `prisma` que delata cualquier `create`/`update`.
// =================================================================================================
const CARD = {
  id: 'c1',
  setId: 's1',
  externalId: 'sv8-104',
  number: '104',
  set: { id: 's1', externalId: 'sv8', name: 'Surging Sparks' },
};
const FX: FxSnapshot = { rate: 19, bufferPct: 5 };
/** v1.51 (M-46, §4.38r): EL dial del gancho — uno solo, exhibición Y obtención. */
const ON = { [SettingKey.GRADING_HOOK_ENABLED]: 'on' };

function wireJob(
  env: Record<string, string | undefined>,
  config: Record<string, unknown> = ON,
  /** Alcance del ingest: `[]` reproduce «ninguna carta con inventario RAW publicado» (R1, `no_scope`). */
  inventario: { cardId: string }[] = [{ cardId: 'c1' }],
  /** `null` reproduce el set SIN `pptSetId` mapeado (causa #5 del mapa; R1-ter). */
  pptSetId: string | null = 'sv8',
) {
  const store = new Map<string, unknown>(Object.entries(config));
  const create = jest.fn(async ({ data }: any) => ({ id: 'pr-new', ...data }));
  const update = jest.fn(async ({ data }: any) => ({ id: 'pr-1', ...data }));
  const prisma = {
    configSetting: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[]).filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) })),
      ),
    },
    inventoryItem: { findMany: jest.fn(async () => inventario) },
    card: { findMany: jest.fn(async () => [CARD]) },
    priceReference: { findFirst: jest.fn(async () => null), create, update },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as unknown as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'getPublishedSlabGradesBatch').mockResolvedValue(new Map());
  const c = cfg(env);
  const pptBulk = provider(c);
  const pptSetMapper = {
    resolveForSets: jest.fn(async () => new Map([['s1', pptSetId]])),
  } as unknown as PptSetMapper;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const ingest = new PriceIngestService(
    prisma, settings, pricing, pptBulk, {} as never, {} as never, pptSetMapper, {} as never, undefined, audit,
  );
  return { ingest, create, update };
}

describe('§4.38h.1-quater — la corrida en modo SONDA no toca `PriceReference`', () => {
  it('el MISMO fixture escribe con formato y NO escribe en sonda (el contraste hace la prueba honesta)', async () => {
    mockPages([pageS1()]);
    const normal = wireJob({});
    const conFormato = await normal.ingest.ingestGradedEstimates(FX);
    expect(conFormato.written).toBe(1);
    expect(normal.create).toHaveBeenCalledTimes(1);
    expect(conFormato.probe).toBe(false);

    mockPages([pageS1()]);
    const sondeo = wireJob({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined });
    const res = await sondeo.ingest.ingestGradedEstimates(FX);
    expect(res.probe).toBe(true);
    expect(res.written).toBe(0);
    expect(sondeo.create).not.toHaveBeenCalled();
    expect(sondeo.update).not.toHaveBeenCalled();
  });

  it('ni siquiera con S2 (el shape NO PERSISTIBLE) aparece una escritura', async () => {
    mockPages([pageS2()]);
    const { ingest, create, update } = wireJob({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined });
    await ingest.ingestGradedEstimates(FX);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('el VEREDICTO se lee sin bucear: un `grep VEREDICTO-PSA` trae la conclusión entera', async () => {
    const logs = capturarLogs();
    mockPages([pageS1()]);
    const { ingest } = wireJob({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined });
    const res = await ingest.ingestGradedEstimates(FX);

    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');
    expect(res.verdict).toBe('VIABLE');
    expect(bloque).toContain('VEREDICTO: VIABLE');
    expect(bloque).toContain('QUÉ LLEGÓ: 1 carta(s) en S1');
    expect(bloque).toContain('SONDA de SOLO LECTURA');
    expect(bloque).toContain('AHORA:'); // la acción siguiente, explícita
  });

  it('S2 dominante ⇒ el veredicto dice NO_VIABLE con todas las letras (y no escribe nada)', async () => {
    const logs = capturarLogs();
    mockPages([pageS2()]);
    const { ingest, create } = wireJob({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined });
    const res = await ingest.ingestGradedEstimates(FX);
    expect(res.verdict).toBe('NO_VIABLE');
    expect(logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n')).toContain('NO ES VIABLE CON ESTE PROVEEDOR');
    expect(create).not.toHaveBeenCalled();
  });

  it('con el dial en `off` el veredicto EXPLICA que no se preguntó nada (cero créditos, cero misterio)', async () => {
    const logs = capturarLogs();
    const spy = mockPages([pageS1()]);
    const { ingest } = wireJob({}, {});
    const res = await ingest.ingestGradedEstimates(FX);
    expect(spy).not.toHaveBeenCalled();
    expect(res.verdict).toBe('INDETERMINADO');
    expect(logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n')).toContain('grading_hook_enabled');
  });
});

// =================================================================================================
/**
 * v1.51-c (TL-GE6) — la entrada del veredicto es una UNIÓN DISCRIMINADA (`GradedRunOutcome`): o la
 * corrida PARÓ (y trae su motivo) o OBSERVÓ (y trae conteos, formato y el recuento de peticiones).
 * `observado()` arma el caso «se emitió petición en 1 set» que usan casi todos los tests de abajo.
 */
type Observado = Extract<GradedRunOutcome, { kind: 'observed' }>;
const PETICIONES_EMITIDAS: GradedRequestTally = { attempted: 1, missingApiKey: false, setsWithoutPptSetId: [] };
const observado = (over: Partial<Omit<Observado, 'kind'>> = {}): GradedRunOutcome => ({
  kind: 'observed',
  requestOk: true,
  requests: PETICIONES_EMITIDAS,
  shapeCounts: { s1: 0, s2: 0 },
  forcedFormat: 'auto',
  ...over,
});

describe('§4.38h.1-quater — el veredicto como función PURA (misma entrada, misma conclusión)', () => {
  const base = {
    probe: true,
    outcome: observado(),
    sets: 1,
    cardsInScope: 1,
    cardsReturned: 10,
    written: 0,
    dailyLimited: false,
    escalationReason: null as string | null,
    creditsSpent: null as number | null,
  };

  it('S1 observado ⇒ VIABLE («la fase 2 funciona»)', () => {
    const r = gradedPhase2Verdict({ ...base, outcome: observado({ shapeCounts: { s1: 4, s2: 0 } }) });
    expect(r.verdict).toBe('VIABLE');
    expect(r.headline).toContain('FUNCIONA');
  });

  it('mezcla S1 + S2 ⇒ VIABLE parcial: las S2 se saltan, no hay nada que arreglar', () => {
    expect(gradedPhase2Verdict({ ...base, outcome: observado({ shapeCounts: { s1: 2, s2: 9 } }) }).verdict).toBe(
      'VIABLE',
    );
  });

  it('SOLO S2 ⇒ NO_VIABLE, y la frase dice por qué (ni `count` ni fecha ⇒ ninguna config lo arregla)', () => {
    const r = gradedPhase2Verdict({ ...base, outcome: observado({ shapeCounts: { s1: 0, s2: 6 } }) });
    expect(r.verdict).toBe('NO_VIABLE');
    expect(r.nextStep).toContain('ESCALA AL ARQUITECTO');
  });

  it('SOLO S2 pero con `GRADED_FORMAT` forzado en un INGEST ⇒ INDETERMINADO (conteo inducido por nosotros)', () => {
    const r = gradedPhase2Verdict({
      ...base,
      probe: false,
      outcome: observado({ forcedFormat: 'graded_prices', shapeCounts: { s1: 0, s2: 6 } }),
    });
    expect(r.verdict).toBe('INDETERMINADO');
    expect(r.headline).toContain('no lo que sirve');
  });

  it('ninguna carta con bloque PSA ⇒ INDETERMINADO: no se puede distinguir «sin ventas» de «sin plan»', () => {
    const r = gradedPhase2Verdict({ ...base, cardsReturned: 30 });
    expect(r.verdict).toBe('INDETERMINADO');
    expect(r.headline).toContain('NINGUNA trae bloque PSA');
  });

  it('sin respuesta OK ⇒ INDETERMINADO: eso es plomería, no un veredicto sobre el proveedor', () => {
    const fallo = observado({ requestOk: false });
    expect(gradedPhase2Verdict({ ...base, outcome: fallo }).verdict).toBe('INDETERMINADO');
    expect(gradedPhase2Verdict({ ...base, outcome: fallo, dailyLimited: true }).headline).toContain('cuota diaria');
  });

  it('el rechazo del parámetro ⇒ NO_VIABLE con la decisión en manos del arquitecto (regla 9)', () => {
    const r = gradedPhase2Verdict({ ...base, escalationReason: 'ebay_not_supported_with_set_sweep' });
    expect(r.verdict).toBe('NO_VIABLE');
    expect(r.nextStep).toContain('regla 9');
  });

  /**
   * 💸 La duda ABIERTA que el dueño mandó dejar por escrito: la petición manda `fetchAllInSet=true` (el
   * SET entero) mientras el diseño afirma que el coste es «proporcional al inventario real». Si PPT
   * cobra por carta DEVUELTA, la premisa es falsa. El veredicto no opina: **mide y avisa**.
   */
  it('COSTE: si el gasto escala con las cartas DEVUELTAS, el bloque lo dice y manda escalarlo', () => {
    const caro = gradedPhase2Verdict({
      ...base,
      outcome: observado({ shapeCounts: { s1: 1, s2: 0 } }),
      cardsReturned: 200,
      creditsSpent: 400, // 400 créditos por 200 cartas = 2 por carta DEVUELTA
    });
    const texto = caro.lines.join('\n');
    expect(texto).toContain('COSTE MEDIDO: 400 crédito(s) por 200 carta(s) DEVUELTAS');
    expect(texto).toContain('NO se sostiene');
  });

  it('COSTE: 1 crédito por petición ⇒ se dice que el barrido por set NO escala con el tamaño del set', () => {
    const barato = gradedPhase2Verdict({
      ...base,
      outcome: observado({ shapeCounts: { s1: 1, s2: 0 } }),
      cardsReturned: 200,
      creditsSpent: 1,
    });
    expect(barato.lines.join('\n')).toContain('se cobra por PETICIÓN');
  });

  it('COSTE: sin cifra ATRIBUIBLE no se estima a ojo — se dice que no se pudo aislar (TL-GE1)', () => {
    const texto = gradedPhase2Verdict({ ...base, outcome: observado({ shapeCounts: { s1: 1, s2: 0 } }) }).lines.join(
      '\n',
    );
    expect(texto).toContain('NO SE PUDO AISLAR');
    // Y se explica POR QUÉ el contador diario no vale: es el dato que la versión anterior restaba.
    expect(texto).toContain('barrido de precios RAW');
    // Money-safe: sin cifra no puede colarse el umbral que dispara la escalada de PRESUPUESTO.
    expect(texto).not.toContain('COSTE MEDIDO');
    expect(texto).not.toContain('NO se sostiene');
  });

  it('todas las líneas llevan la marca: un solo `grep` devuelve el bloque completo', () => {
    const r = gradedPhase2Verdict({ ...base, outcome: observado({ shapeCounts: { s1: 1, s2: 0 } }) });
    expect(r.lines.every((l) => l.startsWith(`[${GRADED_VERDICT_TAG}]`))).toBe(true);
  });
});

// =================================================================================================
/**
 * **v1.51-b (R1) — EL VEREDICTO DEJA DE DAR DOS DIAGNÓSTICOS FALSOS.**
 *
 * ### Lo que estaba roto, y por qué era lo más urgente
 * `result.enabled = true` se asignaba **después** de las dos salidas tempranas del ingest, y el
 * veredicto usaba ese único booleano como «por qué no pasó nada». Consecuencias, las dos medibles:
 *
 *  **(a)** Dial `grading_hook_enabled` en **`on`** + config del ingest corrupta ⇒ el veredicto recibía
 *  `enabled: false` y publicaba *«el dial está en `off`»* + *«Enciende el dial»*. El operador mira el
 *  dial, lo ve encendido, y el ÚNICO artefacto que existe para decirle por qué el ingest escribe cero
 *  filas le miente sobre la causa — mientras la clave corrupta sigue ahí. Es una de las causas
 *  candidatas de las cero filas en producción, disfrazada por su propio detector.
 *
 *  **(b)** Sin inventario RAW en alcance ⇒ salía con `enabled: true, requestOk: false`, y el veredicto
 *  mandaba *«Revisa las líneas “PPT graded: EL REQUEST FALLÓ” del log»*: líneas **que no existen**,
 *  porque no hubo ninguna petición que pudiera fallar. Media hora de búsqueda de un log inexistente.
 *
 * La corrección: `stopReason` (`dial_off` / `ingest_config_invalid` / `no_scope`) evaluado al principio
 * de la cadena de precedencia, cada uno con SU titular y SU acción, y con la clave inválida NOMBRADA.
 */
describe('v1.51-b (R1) — cada parada dice SU causa: el veredicto ya no manda a arreglar lo que está bien', () => {
  const base = {
    probe: false,
    outcome: { kind: 'stopped', reason: 'dial_off' } as GradedRunOutcome,
    sets: 0,
    cardsInScope: 0,
    cardsReturned: 0,
    written: 0,
    dailyLimited: false,
    escalationReason: null as string | null,
    creditsSpent: 0 as number | null,
  };
  /** Las tres paradas, ya como `outcome` (la config inválida NOMBRA su clave por exigencia del tipo). */
  const parada = (reason: 'dial_off' | 'no_scope'): GradedRunOutcome => ({ kind: 'stopped', reason });
  const configInvalida = (...keys: [string, ...string[]]): GradedRunOutcome => ({
    kind: 'stopped',
    reason: 'ingest_config_invalid',
    invalidConfigKeys: keys,
  });

  it('`dial_off` ⇒ dice que el dial está en `off` y manda encenderlo (el ÚNICO caso donde eso aplica)', () => {
    const r = gradedPhase2Verdict({ ...base, outcome: parada('dial_off') });
    expect(r.verdict).toBe('INDETERMINADO');
    expect(r.headline).toContain('`off`');
    expect(r.nextStep).toContain('gradingHookEnabled');
  });

  it('⛑️ (a) `ingest_config_invalid` ⇒ dice que el dial está en `on` y NOMBRA la clave a corregir', () => {
    const r = gradedPhase2Verdict({
      ...base,
      outcome: configInvalida('graded_estimate_ingest_max_cards_per_run'),
    });
    // La aserción que pone en rojo el bug: el titular ya no puede acusar al dial.
    expect(r.headline).toContain('NO es el dial');
    expect(r.headline).toContain('`on`');
    expect(r.headline).toContain('graded_estimate_ingest_max_cards_per_run');
    // Y la acción tiene que ser la reparación REAL, no «enciende el dial».
    expect(r.nextStep).toContain('graded_estimate_ingest_max_cards_per_run');
    expect(r.nextStep).toContain('/admin/pricing/graded-estimates');
    expect(r.nextStep).not.toContain('gradingHookEnabled');
  });

  it('⛑️ (b) `no_scope` ⇒ habla de inventario publicado y NO manda a buscar un log que no existe', () => {
    const r = gradedPhase2Verdict({ ...base, outcome: parada('no_scope') });
    expect(r.headline).toContain('inventario RAW');
    expect(r.nextStep).toContain('status=listed');
    expect(r.nextStep + r.headline).not.toContain('EL REQUEST FALLÓ');
    expect(r.headline).not.toContain('`off`');
  });

  it('las tres paradas se distinguen entre sí (mismo síntoma, tres remedios distintos)', () => {
    const paradas: GradedRunOutcome[] = [parada('dial_off'), configInvalida('graded_estimate_source_stat'), parada('no_scope')];
    const titulares = paradas.map((outcome) => gradedPhase2Verdict({ ...base, outcome }).headline);
    expect(new Set(titulares).size).toBe(3);
    const acciones = paradas.map((outcome) => gradedPhase2Verdict({ ...base, outcome }).nextStep);
    expect(new Set(acciones).size).toBe(3);
  });

  it('con parada NO se finge un desglose de shapes ni un coste desconocido: 0 créditos, sin petición', () => {
    const texto = gradedPhase2Verdict({ ...base, outcome: parada('no_scope') }).lines.join('\n');
    expect(texto).toContain('no llegó a preguntarle al proveedor');
    expect(texto).toContain('COSTE: 0 créditos');
    expect(texto).not.toContain('NO SE PUDO AISLAR');
  });

  // ── El mismo defecto, comprobado en la CORRIDA REAL (provider real + fetch delator) ─────────────
  it('⛑️ (a) EN LA CORRIDA: dial `on` + `ingestMaxCardsPerRun` corrupto ⇒ el bloque NOMBRA la clave', async () => {
    const logs = capturarLogs();
    const spy = mockPages([pageS1()]);
    const { ingest, create } = wireJob({}, {
      ...ON,
      [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 2000, // legal ayer, inválido hoy
    });

    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(spy).not.toHaveBeenCalled(); // fail-closed intacto: cero créditos
    expect(create).not.toHaveBeenCalled();
    expect(res.verdict).toBe('INDETERMINADO');
    expect(bloque).toContain(SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN);
    // ⛑️ LA REGRESIÓN: antes, con el dial ENCENDIDO, aquí se leía «el dial está en off · enciende el dial».
    expect(bloque).toContain('NO es el dial');
    expect(bloque).not.toContain('Enciende el dial');
  });

  it('⛑️ (b) EN LA CORRIDA: sin inventario RAW publicado ⇒ el bloque no manda al log del proveedor', async () => {
    const logs = capturarLogs();
    const spy = mockPages([pageS1()]);
    const { ingest } = wireJob({}, ON, []); // alcance VACÍO

    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(spy).not.toHaveBeenCalled();
    expect(res.enabled).toBe(true); // el dial SÍ estaba encendido, y el veredicto ya no lo contradice
    expect(bloque).toContain('inventario RAW');
    expect(bloque).not.toContain('EL REQUEST FALLÓ');
    expect(bloque).not.toContain('está en `off`');
  });

  it('el dial en `off` sigue diciendo exactamente eso (la corrección no ensordece el caso legítimo)', async () => {
    const logs = capturarLogs();
    mockPages([pageS1()]);
    const { ingest } = wireJob({}, {});
    await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');
    expect(bloque).toContain('grading_hook_enabled');
    expect(bloque).toContain('Enciende el dial');
  });
});

// =================================================================================================
/**
 * **v1.51-b (TL-GE2/R2) — «conteo inducido» tenía DOS definiciones y podían contradecirse.**
 *
 * `graded-phase2-verdict.ts` eximía a la SONDA (correcto: clasifica con `detectGradedShape`, que ignora
 * `GRADED_FORMAT` a propósito, así que su conteo SÍ es evidencia sobre PPT). `price-ingest.service.ts`
 * no la eximía. Resultado: la misma corrida —sonda + `GRADED_FORMAT` fijado— podía emitir «S2
 * mayoritario pero NO se escala» y, tres líneas más abajo, «NO_VIABLE ⇒ ESCALA AL ARQUITECTO».
 * Dos conclusiones opuestas sobre la misma evidencia, una capaz de disparar una decisión de
 * arquitectura y presupuesto.
 */
describe('v1.51-b (TL-GE2/R2) — ingest y veredicto usan LA MISMA definición de «conteo inducido»', () => {
  it('la función es una sola y exime a la SONDA (y solo a ella)', () => {
    expect(shapeCountIsInduced({ probe: true, forcedFormat: 'graded_prices' })).toBe(false);
    expect(shapeCountIsInduced({ probe: false, forcedFormat: 'graded_prices' })).toBe(true);
    expect(shapeCountIsInduced({ probe: false, forcedFormat: 'auto' })).toBe(false);
    expect(shapeCountIsInduced({ probe: true, forcedFormat: 'auto' })).toBe(false);
  });

  it('⛑️ `probe=true` + `GRADED_FORMAT=graded_prices`: ingest y veredicto COINCIDEN (antes se contradecían)', async () => {
    const logs = capturarLogs();
    mockPages([pageS2()]);
    const { ingest, create } = wireJob({
      POKEMONPRICETRACKER_MARKET_FORMAT: undefined, // ⇒ SONDA
      POKEMONPRICETRACKER_GRADED_FORMAT: 'graded_prices', // ⇒ el override que inducía la divergencia
    });

    const res = await ingest.ingestGradedEstimates(FX);
    const texto = logs.join('\n');

    // Las dos superficies dicen lo MISMO: el conteo de la sonda es evidencia, así que se escala.
    expect(res.verdict).toBe('NO_VIABLE');
    expect(res.escalation?.reason).toBe('shape_not_persistible_s2_dominant');
    // ⛑️ v1.51-c (TL-GE2-bis) — LA AFIRMACIÓN FALSA. El `detail` que se le manda al ARQUITECTO para
    // decidir presupuesto decía «Evidencia: GRADED_FORMAT=auto (autodetección, sin override)» en la
    // rama que TL-GE2 acababa de abrir… donde `GRADED_FORMAT` vale `graded_prices`. El AuditLog sí
    // llevaba el valor verdadero, así que la contradicción vivía dentro del mismo pase. Este `expect`
    // es el que faltaba (por eso pasó): ahora la frase se DERIVA de «el conteo no está inducido».
    expect(res.escalation?.detail).not.toContain('GRADED_FORMAT=auto (autodetección, sin override)');
    expect(res.escalation?.detail).toContain('GRADED_FORMAT="graded_prices"');
    expect(res.escalation?.detail).toContain('NO está inducido');
    expect(res.escalation?.detail).toContain('SONDA');
    // ⛑️ La frase contradictoria ya no puede convivir con el veredicto NO_VIABLE del mismo bloque.
    expect(texto).not.toContain('pero NO se escala');
    expect(create).not.toHaveBeenCalled(); // la sonda sigue sin escribir, pase lo que pase
  });

  it('en un INGEST (no sonda) el override SÍ induce: ninguna de las dos superficies escala', async () => {
    // El contraste que hace honesta la prueba anterior: la exención es de la SONDA, no del override.
    const logs = capturarLogs();
    mockPages([pageS2()]);
    const { ingest } = wireJob({ POKEMONPRICETRACKER_GRADED_FORMAT: 'graded_prices' });

    const res = await ingest.ingestGradedEstimates(FX);

    expect(res.verdict).toBe('INDETERMINADO');
    expect(res.escalation).toBeNull();
    expect(logs.join('\n')).toContain('NO se escala');
  });
});

// =================================================================================================
/**
 * **v1.51-c (R1-ter) — «no respondió OK» ≠ «no se preguntó», y la diferencia es la línea de log.**
 *
 * R1 cerró dos instancias de este defecto (`ingest_config_invalid` y `no_scope`) y dejó viva la
 * TERCERA: la rama `!requestOk` seguía mandando a *«Revisa las líneas “PPT graded: EL REQUEST FALLÓ”»*
 * también cuando **no hubo NINGUNA petición**, que es lo que pasa en las causas #4 (sin
 * `POKEMONPRICETRACKER_API_KEY`) y #5 (**set sin `pptSetId`**) del mapa de causas. En las dos, el
 * provider hace `return empty` ANTES de llamar, así que esa línea **no existe en el log** — y «set sin
 * `pptSetId`» es justo la hipótesis principal de las cartas sin dato en producción, o sea el caso más
 * caro de equivocar.
 */
describe('v1.51-c (R1-ter) — sin petición, el veredicto NO manda a leer la línea del fallo', () => {
  const baseSinRespuesta = {
    probe: false,
    outcome: observado({ requestOk: false }),
    sets: 1,
    cardsInScope: 3,
    cardsReturned: 0,
    written: 0,
    dailyLimited: false,
    escalationReason: null as string | null,
    creditsSpent: 0 as number | null,
  };
  const sinPeticion = (over: Partial<GradedRequestTally>): GradedRunOutcome =>
    observado({ requestOk: false, requests: { attempted: 0, missingApiKey: false, setsWithoutPptSetId: [], ...over } });

  it('⛑️ sin API key ⇒ dice que NO HUBO PETICIÓN y manda a la línea que SÍ existe', () => {
    const r = gradedPhase2Verdict({ ...baseSinRespuesta, outcome: sinPeticion({ missingApiKey: true }) });
    expect(r.verdict).toBe('INDETERMINADO');
    expect(r.headline).toContain('NI UNA PETICIÓN');
    expect(r.headline).toContain('POKEMONPRICETRACKER_API_KEY');
    // LA REGRESIÓN: mandaba a buscar un log inexistente. Ahora nombra el que sí está.
    expect(r.nextStep).toContain('«PPT graded: falta POKEMONPRICETRACKER_API_KEY»');
    expect(r.nextStep).toContain('NO existe en esta corrida');
  });

  it('⛑️ set sin `pptSetId` ⇒ NOMBRA los sets y manda al log del mapper, no al del fallo', () => {
    const r = gradedPhase2Verdict({
      ...baseSinRespuesta,
      outcome: sinPeticion({ setsWithoutPptSetId: ['sv8', 'sv7'] }),
    });
    expect(r.verdict).toBe('INDETERMINADO');
    // Accionable directo: el operador no puede arreglar «algún set»; sí puede arreglar `sv8`.
    expect(r.headline).toContain('sv8, sv7');
    expect(r.headline).toContain('pptSetId');
    expect(r.nextStep).toContain('PptSetMapper');
    expect(r.nextStep).toContain('sv8, sv7');
  });

  it('los dos casos SIN petición se distinguen entre sí y del caso «se pidió y falló»', () => {
    const textos = [
      sinPeticion({ missingApiKey: true }),
      sinPeticion({ setsWithoutPptSetId: ['sv8'] }),
      observado({ requestOk: false }), // attempted: 1 ⇒ la petición SÍ salió
    ].map((outcome) => {
      const r = gradedPhase2Verdict({ ...baseSinRespuesta, outcome });
      return `${r.headline}\n${r.nextStep}`;
    });
    expect(new Set(textos).size).toBe(3);
    // Solo el tercero puede mandar a la línea del fallo, porque solo ahí existe.
    expect(textos[0]).not.toContain('Revisa las líneas «PPT graded: EL REQUEST FALLÓ»');
    expect(textos[1]).not.toContain('Revisa las líneas «PPT graded: EL REQUEST FALLÓ»');
    expect(textos[2]).toContain('Revisa las líneas «PPT graded: EL REQUEST FALLÓ»');
  });

  it('con peticiones emitidas Y sets sin mapear, se dicen las DOS causas (no se tapa una con otra)', () => {
    const r = gradedPhase2Verdict({
      ...baseSinRespuesta,
      outcome: observado({
        requestOk: false,
        requests: { attempted: 2, missingApiKey: false, setsWithoutPptSetId: ['sv8'] },
      }),
    });
    expect(r.nextStep).toContain('EL REQUEST FALLÓ');
    expect(r.nextStep).toContain('NI SE PIDIERON');
    expect(r.nextStep).toContain('sv8');
  });

  it('los sets NO PEDIDOS salen en el bloque AUNQUE el veredicto sea VIABLE (el caso de producción)', () => {
    // Escribe estimados de un set y, a la vez, NUNCA pidió los otros: «funciona» y «faltan cartas»
    // son ciertas al mismo tiempo, y sin esta línea había que deducirlo del log del mapper.
    const r = gradedPhase2Verdict({
      ...baseSinRespuesta,
      cardsReturned: 10,
      written: 4,
      outcome: observado({
        shapeCounts: { s1: 6, s2: 0 },
        requests: { attempted: 1, missingApiKey: false, setsWithoutPptSetId: ['sv7', 'sv6'] },
      }),
    });
    expect(r.verdict).toBe('VIABLE');
    expect(r.lines.join('\n')).toContain('SETS NO PEDIDOS: 2 set(s)');
    expect(r.lines.join('\n')).toContain('sv7, sv6');
  });

  // ── El mismo defecto, en la CORRIDA REAL (provider real + fetch delator) ────────────────────────
  it('⛑️ EN LA CORRIDA: set sin `pptSetId` ⇒ cero peticiones y el bloque nombra el set, no el fallo', async () => {
    const logs = capturarLogs();
    const spy = mockPages([pageS1()]);
    const { ingest, create } = wireJob({}, ON, [{ cardId: 'c1' }], null); // set SIN mapear

    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(spy).not.toHaveBeenCalled(); // no hubo petición: cero créditos
    expect(create).not.toHaveBeenCalled();
    expect(res.verdict).toBe('INDETERMINADO');
    expect(bloque).toContain('sv8'); // el set afectado, por nombre
    expect(bloque).toContain('pptSetId');
    // ⛑️ LA REGRESIÓN: aquí se leía «Revisa las líneas “PPT graded: EL REQUEST FALLÓ” del log». Hoy la
    // única mención de esa línea es para decir que NO existe (para que nadie la busque).
    expect(bloque).not.toContain('Revisa las líneas «PPT graded: EL REQUEST FALLÓ»');
    expect(bloque).toContain('«EL REQUEST FALLÓ» NO existe');
  });

  it('⛑️ EN LA CORRIDA: sin `POKEMONPRICETRACKER_API_KEY` ⇒ mismo trato (cero peticiones, causa nombrada)', async () => {
    const logs = capturarLogs();
    const spy = mockPages([pageS1()]);
    const { ingest } = wireJob({ POKEMONPRICETRACKER_API_KEY: undefined });

    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(spy).not.toHaveBeenCalled();
    expect(res.verdict).toBe('INDETERMINADO');
    expect(bloque).toContain('POKEMONPRICETRACKER_API_KEY');
    expect(bloque).not.toContain('Revisa las líneas «PPT graded: EL REQUEST FALLÓ»');
    expect(bloque).toContain('NO existe en esta corrida');
  });
});

// =================================================================================================
/**
 * **v1.51-c (QA-GE2) — una conclusión sobre el modelo de cobro NO se saca de cero observaciones.**
 *
 * Con `creditsSpent: 0` y `cardsReturned: 0` (p. ej. todos los sets sin `pptSetId`) la línea de coste
 * imprimía *«COSTE MEDIDO: 0 crédito(s) por 0 carta(s) DEVUELTAS … Compatible con “se cobra por
 * PETICIÓN”»*. No toca dinero (`perCard` era `null`), pero es una conclusión sacada de la nada — la
 * misma clase de defecto que este bloque existe para erradicar, cometida por el propio bloque.
 */
describe('v1.51-c (QA-GE2) — con CERO cartas devueltas, el coste vuelve a «no se puede medir»', () => {
  const base = {
    probe: false,
    outcome: observado({ shapeCounts: { s1: 0, s2: 0 } }),
    sets: 2,
    cardsInScope: 5,
    cardsReturned: 0,
    written: 0,
    dailyLimited: false,
    escalationReason: null as string | null,
    creditsSpent: 0 as number | null,
  };

  it('⛑️ 0 créditos / 0 cartas ⇒ NO SE PUEDE MEDIR, y NO se afirma el modelo de cobro', () => {
    const texto = gradedPhase2Verdict(base).lines.join('\n');
    expect(texto).toContain('NO SE PUEDE MEDIR');
    // ⛑️ Las dos frases que la regresión imprimía sobre cero observaciones.
    expect(texto).not.toContain('COSTE MEDIDO');
    expect(texto).not.toContain('se cobra por PETICIÓN');
  });

  it('con créditos gastados y CERO cartas tampoco se concluye (se dice el gasto y se para ahí)', () => {
    const texto = gradedPhase2Verdict({ ...base, creditsSpent: 3 }).lines.join('\n');
    expect(texto).toContain('3 crédito(s) atribuible(s)');
    expect(texto).toContain('NO SE PUEDE MEDIR');
    expect(texto).not.toContain('se cobra por PETICIÓN');
  });

  it('el contraste: con cartas devueltas la medición SÍ se hace (no se rompió el caso bueno)', () => {
    const texto = gradedPhase2Verdict({ ...base, cardsReturned: 4, creditsSpent: 1 }).lines.join('\n');
    expect(texto).toContain('COSTE MEDIDO: 1 crédito(s) por 4 carta(s) DEVUELTAS');
    expect(texto).toContain('se cobra por PETICIÓN');
  });
});

// =================================================================================================
/**
 * **v1.51-c (TL-GE6) — el candado de R1 era de ARIDAD; ahora es de FORMA.**
 *
 * `stopReason: GradedStopReason | null` obligaba a pasar *un* argumento, no *el correcto*: un
 * `emitGradedVerdict(…, null)` en una salida temprana futura compilaba y reproducía R1 palabra por
 * palabra. Estos `@ts-expect-error` son la prueba: **si alguien vuelve a aplanar la entrada, este
 * archivo deja de compilar**, que es la única forma de que un candado de tipos se pruebe.
 */
describe('v1.51-c (TL-GE6) — los estados que producían R1 ya no son expresables', () => {
  it('una PARADA no puede fingir conteos del proveedor (no se le habló)', () => {
    // @ts-expect-error — `shapeCounts` no existe en una parada: no hubo nada que contar.
    const mezcla: GradedRunOutcome = { kind: 'stopped', reason: 'dial_off', shapeCounts: { s1: 0, s2: 0 } };
    expect(mezcla).toBeDefined();
  });

  it('`ingest_config_invalid` EXIGE al menos una clave nombrada (adiós a «no identificada(s)»)', () => {
    // @ts-expect-error — lista vacía: el tipo pide `[string, ...string[]]`.
    const sinClave: GradedRunOutcome = { kind: 'stopped', reason: 'ingest_config_invalid', invalidConfigKeys: [] };
    expect(sinClave).toBeDefined();
    // Y sin el campo tampoco compila (era el DEFAULT `[]` que degradaba en silencio).
    // @ts-expect-error — falta `invalidConfigKeys`.
    const sinCampo: GradedRunOutcome = { kind: 'stopped', reason: 'ingest_config_invalid' };
    expect(sinCampo).toBeDefined();
  });

  it('una OBSERVACIÓN no puede omitir el recuento de peticiones (es lo que separa R1-ter)', () => {
    // @ts-expect-error — falta `requests`.
    const sinTally: GradedRunOutcome = { kind: 'observed', requestOk: true, shapeCounts: { s1: 1, s2: 0 }, forcedFormat: 'auto' };
    expect(sinTally).toBeDefined();
  });
});

// =================================================================================================
/**
 * **v1.51-b (TL-GE3) — la bandera de la sonda avisa ante un typo.**
 *
 * `gradedProbeRequested()` aceptaba `on|true|1|yes` y **cualquier otro valor caía en silencio a
 * `false`** — o sea, a «no hay sonda» ⇒ la corrida PIDE y ESCRIBE. Su hermana nueve líneas más abajo
 * (`gradedFormatOverride`) sí avisaba. La asimetría iba en el peor sentido: ésta falla hacia el lado
 * que gasta créditos y escribe dinero que el operador creía haber impedido con la env.
 *
 * La SEMÁNTICA no cambia (eso pasaría por el arquitecto, regla 9): solo se añade el aviso.
 */
describe('v1.51-b (TL-GE3) — `POKEMONPRICETRACKER_GRADED_PROBE` con un valor raro AVISA', () => {
  it('un typo (`onn`) deja de caer en silencio: hay `warn` que dice que la sonda quedó APAGADA', async () => {
    const logs = capturarLogs();
    mockPages([pageS1()]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_PROBE: 'onn' })));
    expect(res.probe).toBe(false); // semántica INTACTA: solo `on|true|1|yes` encienden la sonda
    expect(logs.join('\n')).toContain('POKEMONPRICETRACKER_GRADED_PROBE="onn"');
    expect(logs.join('\n')).toContain('APAGADA');
  });

  it('los valores VÁLIDOS y la ausencia no generan ruido (un aviso que grita siempre no se lee)', async () => {
    for (const valor of [undefined, '', 'on', 'true', '1', 'yes', 'off', 'false', '0', 'no']) {
      const logs = capturarLogs();
      mockPages([pageS1()]);
      await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_PROBE: valor })));
      expect(logs.join('\n')).not.toContain('no es on|true|1|yes');
      jest.restoreAllMocks();
    }
  });

  it('la semántica NO cambió: `on` sigue encendiendo la sonda y `off` sigue dejándola apagada', async () => {
    mockPages([pageS1()]);
    expect((await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_PROBE: 'on' })))).probe).toBe(true);
    mockPages([pageS1()]);
    expect((await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_PROBE: 'off' })))).probe).toBe(false);
  });
});
