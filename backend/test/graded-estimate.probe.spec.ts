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
import { gradedPhase2Verdict, GRADED_VERDICT_TAG } from '../src/modules/pricing/graded-phase2-verdict';

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

  it('MIDE el coste con el crédito del proveedor: `dailyRemainingBefore` − `dailyRemaining`', async () => {
    // Es la única forma honesta de contestar la duda abierta: la petición manda `fetchAllInSet=true`
    // (el SET entero) mientras el diseño afirma que el coste es «proporcional al inventario real».
    const p = provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined }));
    mockPages([pageS1()], [900]);
    await call(p); // 1ª llamada: fija el contador en 900
    mockPages([pageS1()], [898]);
    const res = await call(p);
    expect(res.dailyRemainingBefore).toBe(900);
    expect(res.dailyRemaining).toBe(898);
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
const ON = {
  [SettingKey.GRADED_ESTIMATE_INGEST_ENABLED]: 'on',
  [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on',
};

function wireJob(env: Record<string, string | undefined>, config: Record<string, unknown> = ON) {
  const store = new Map<string, unknown>(Object.entries(config));
  const create = jest.fn(async ({ data }: any) => ({ id: 'pr-new', ...data }));
  const update = jest.fn(async ({ data }: any) => ({ id: 'pr-1', ...data }));
  const prisma = {
    configSetting: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[]).filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) })),
      ),
    },
    inventoryItem: { findMany: jest.fn(async () => [{ cardId: 'c1' }]) },
    card: { findMany: jest.fn(async () => [CARD]) },
    priceReference: { findFirst: jest.fn(async () => null), create, update },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as unknown as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'getPublishedSlabGradesBatch').mockResolvedValue(new Map());
  const c = cfg(env);
  const pptBulk = provider(c);
  const pptSetMapper = { resolveForSets: jest.fn(async () => new Map([['s1', 'sv8']])) } as unknown as PptSetMapper;
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
    expect(logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n')).toContain('graded_estimate_ingest_enabled');
  });
});

// =================================================================================================
describe('§4.38h.1-quater — el veredicto como función PURA (misma entrada, misma conclusión)', () => {
  const base = {
    probe: true,
    enabled: true,
    requestOk: true,
    sets: 1,
    cardsInScope: 1,
    cardsReturned: 10,
    shapeCounts: { s1: 0, s2: 0 },
    written: 0,
    dailyLimited: false,
    escalationReason: null as string | null,
    forcedFormat: 'auto' as const,
    creditsBefore: null as number | null,
    creditsAfter: null as number | null,
  };

  it('S1 observado ⇒ VIABLE («la fase 2 funciona»)', () => {
    const r = gradedPhase2Verdict({ ...base, shapeCounts: { s1: 4, s2: 0 } });
    expect(r.verdict).toBe('VIABLE');
    expect(r.headline).toContain('FUNCIONA');
  });

  it('mezcla S1 + S2 ⇒ VIABLE parcial: las S2 se saltan, no hay nada que arreglar', () => {
    expect(gradedPhase2Verdict({ ...base, shapeCounts: { s1: 2, s2: 9 } }).verdict).toBe('VIABLE');
  });

  it('SOLO S2 ⇒ NO_VIABLE, y la frase dice por qué (ni `count` ni fecha ⇒ ninguna config lo arregla)', () => {
    const r = gradedPhase2Verdict({ ...base, shapeCounts: { s1: 0, s2: 6 } });
    expect(r.verdict).toBe('NO_VIABLE');
    expect(r.nextStep).toContain('ESCALA AL ARQUITECTO');
  });

  it('SOLO S2 pero con `GRADED_FORMAT` forzado en un INGEST ⇒ INDETERMINADO (conteo inducido por nosotros)', () => {
    const r = gradedPhase2Verdict({
      ...base,
      probe: false,
      forcedFormat: 'graded_prices',
      shapeCounts: { s1: 0, s2: 6 },
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
    expect(gradedPhase2Verdict({ ...base, requestOk: false }).verdict).toBe('INDETERMINADO');
    expect(gradedPhase2Verdict({ ...base, requestOk: false, dailyLimited: true }).headline).toContain('cuota diaria');
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
      shapeCounts: { s1: 1, s2: 0 },
      cardsReturned: 200,
      creditsBefore: 1_000,
      creditsAfter: 600, // 400 créditos por 200 cartas = 2 por carta DEVUELTA
    });
    const texto = caro.lines.join('\n');
    expect(texto).toContain('COSTE MEDIDO: 400 crédito(s) por 200 carta(s) DEVUELTAS');
    expect(texto).toContain('NO se sostiene');
  });

  it('COSTE: 1 crédito por petición ⇒ se dice que el barrido por set NO escala con el tamaño del set', () => {
    const barato = gradedPhase2Verdict({
      ...base,
      shapeCounts: { s1: 1, s2: 0 },
      cardsReturned: 200,
      creditsBefore: 1_000,
      creditsAfter: 999,
    });
    expect(barato.lines.join('\n')).toContain('se cobra por PETICIÓN');
  });

  it('COSTE: sin contador del proveedor NO se estima a ojo, se dice que no se pudo medir', () => {
    expect(gradedPhase2Verdict({ ...base, shapeCounts: { s1: 1, s2: 0 } }).lines.join('\n')).toContain(
      'NO se puede medir',
    );
  });

  it('todas las líneas llevan la marca: un solo `grep` devuelve el bloque completo', () => {
    const r = gradedPhase2Verdict({ ...base, shapeCounts: { s1: 1, s2: 0 } });
    expect(r.lines.every((l) => l.startsWith(`[${GRADED_VERDICT_TAG}]`))).toBe(true);
  });
});
