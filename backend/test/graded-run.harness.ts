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
import { PptSetMapper, PptSetMapping } from '../src/modules/pricing/ppt-set-mapper.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { GRADED_VERDICT_TAG } from '../src/modules/pricing/graded-phase2-verdict';
import {
  GRADED_LOG_LINES,
  citaCoincideConLinea,
  emitirLineaGraded,
  extraerCitasAusentes,
  extraerCitasVivas,
  mencionesSinMarcar,
} from '../src/modules/pricing/graded-log-lines';

/**
 * v1.51-d — **EL BANCO DE PRUEBAS DE UNA CORRIDA GRADED REAL, Y SU GUARDIÁN.**
 *
 * Aquí vive (1) el cableado del job completo con el provider REAL y `fetch` mockeado —lo que hace que
 * un test hable de la CORRIDA y no solo de una función pura— y (2) **el guardián de TL-GE7**.
 *
 * ### Por qué el guardián está aquí y no en un `.spec` cualquiera
 * El defecto que se repite tres pases seguidos no es «el tipo permite un estado imposible»: es **«el
 * mensaje cita una evidencia que en ese estado no existe»**. Verificar eso a mano, rama por rama, es
 * lo que ha fallado cada vez. `verificarCitasDelVeredicto` lo verifica MECÁNICAMENTE: toma los logs
 * REALES de una corrida, saca del bloque `VEREDICTO-PSA` toda línea citada entre `«…»` y exige que
 * aparezca en esos mismos logs (y que las citadas como ausentes, no). Es el único cambio del pase que
 * rompe el ciclo, porque no cierra una instancia: cierra la clase.
 */

export const SET = { id: 'local-sv8', externalId: 'sv8', name: 'Surging Sparks' } as unknown as CardSet;
/** Evidencia FRESCA sea cual sea el día del CI. */
export const HOY = new Date().toISOString().slice(0, 10);

export function cfg(over: Record<string, string | undefined> = {}): ConfigService {
  const env: Record<string, string | undefined> = {
    POKEMONPRICETRACKER_API_KEY: 'k',
    POKEMONPRICETRACKER_MARKET_FORMAT: 'usd_dollars',
    ...over,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

export function provider(c: ConfigService): PokemonPriceTrackerBulkProvider {
  return new PokemonPriceTrackerBulkProvider(c, new PptApiClient(c));
}

/**
 * Una respuesta falsa del proveedor. Un objeto pelón es un `200 OK` con ese cuerpo; `{ __http }`
 * permite montar los caminos de error (el 429 `daily`, un 401…) que son justo donde el veredicto
 * cambia de titular y por tanto de cita.
 */
export type RespuestaFalsa = unknown | { __http: { status: number; body?: unknown } };

/** 429 con `limitType: "daily"` ⇒ `PptDailyLimitError` ⇒ la línea `429 DAILY … → PARADA`. */
export const resp429Daily = (): RespuestaFalsa => ({
  __http: { status: 429, body: { limitType: 'daily', resetsAt: '2026-09-01T00:00:00Z' } },
});
/** 401 ⇒ `PptHttpError` ⇒ la línea `EL REQUEST FALLÓ`. */
export const resp401 = (): RespuestaFalsa => ({ __http: { status: 401, body: { error: 'unauthorized' } } });

function construirRespuesta(p: RespuestaFalsa, remaining: number | null) {
  const http = (p as { __http?: { status: number; body?: unknown } })?.__http;
  const status = http?.status ?? 200;
  const body = http ? (http.body ?? {}) : p;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === 'x-ratelimit-daily-remaining' && remaining != null ? String(remaining) : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * `fetch` mockeado y **enrutado por URL**: `/api/v2/sets` va al catálogo del mapper y todo lo demás a
 * las páginas de cartas. Enrutarlo es lo que permite probar el camino del mapper REAL (R1-quater) sin
 * mockear el propio servicio que se está poniendo a prueba.
 *
 * `daily` = valores del header de cuota, para medir el COSTE de la corrida.
 */
export function mockPages(pages: RespuestaFalsa[], daily: (number | null)[] = [], sets: RespuestaFalsa[] = []) {
  const cards = [...pages];
  const catalogo = [...sets];
  let call = 0;
  const spy = jest.fn(async (url: string) => {
    const remaining = daily[call++] ?? null;
    if (String(url).includes('/api/v2/sets')) {
      return construirRespuesta(catalogo.shift() ?? { data: [] }, remaining);
    }
    const p = cards.shift() ?? { data: [], total: 0, count: 0, limit: 200, offset: 0, hasMore: false };
    return construirRespuesta(p, remaining);
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

/** S1 impecable: en modo NORMAL esta misma entrada SÍ se persiste. */
export const S1_BUENO = { count: 7, medianPrice: 60, lastSaleDate: HOY };
export const pageS1 = (over: Record<string, unknown> = {}) => ({
  data: [{ id: 'sv8-104', cardNumber: '104', ebay: { salesByGrade: { psa10: S1_BUENO } }, ...over }],
  total: 1,
  count: 1,
  hasMore: false,
});
export const pageS2 = () => ({
  data: [{ id: 'sv8-104', cardNumber: '104', gradedPrices: { psa10: 60 } }],
  total: 1,
  count: 1,
  hasMore: false,
});

export const call = (p: PokemonPriceTrackerBulkProvider) =>
  p.fetchGradedEstimatesForSet({
    set: SET,
    providerSetId: 'sv8',
    grades: ['10', '9'],
    minSampleCount: 3,
    sourceStat: 'median',
    freshnessDays: 30,
    today: HOY,
  });

// =================================================================================================
// ⛑️ R-1 — EL REGISTRO DEL GUARDIÁN AUTOMÁTICO
// =================================================================================================
/**
 * **Por qué el guardián dejó de ser una llamada.**
 * `esperarVeredictoCitable` era OPT-IN: cada test decidía llamarlo. Eso es exactamente lo que ha
 * fallado cuatro veces — un mecanismo que existe para no depender de la disciplina humana no puede
 * depender de que alguien se acuerde de invocarlo en cada test nuevo. De hecho, dentro del propio
 * `graded-verdict-guard.spec.ts` había dos casos que montaban corrida real y NO lo llamaban, y
 * `graded-estimate.probe.spec.ts` capturaba logs sin pasar por él ni una vez.
 *
 * Ahora **capturar logs es suscribirse**: `capturarLogs()` apunta su buffer aquí y el `afterEach` del
 * final del archivo corre el invariante sobre TODO buffer capturado en el test que acaba de terminar.
 * Escribir un test de corrida sin guardián ya no es una opción por omisión: **hay que pedirlo por su
 * nombre** con `sinGuardianPorque(motivo)`, que se ve en el diff.
 */
const buffersDelTest: { logs: string[]; contexto: string }[] = [];

/** La exención declarada por el test en curso, si la hay. Se limpia en cada `afterEach`. */
let exencionDelTest: string | null = null;

/** Nombre del test en curso, para que el fallo del guardián diga QUIÉN lo disparó. */
function nombreDelTestEnCurso(): string {
  return expect.getState().currentTestName ?? '(test sin nombre)';
}

/**
 * ⛑️ **LA ÚNICA PUERTA DE SALIDA DEL GUARDIÁN, y hay que escribirla por su nombre.**
 *
 * Para los pocos casos que capturan logs de algo que **no emite bloque `VEREDICTO-PSA`** (tests del
 * provider o del mapper por separado, que no corren el job). Exige un motivo NO VACÍO: la exención es
 * una afirmación («aquí no hay veredicto que verificar»), no un interruptor.
 *
 * ⚠️ Y es una afirmación **verificada**: si el test SÍ emitió bloque, el `afterEach` falla por exención
 * SOBRANTE. Así una exención no puede quedarse puesta tapando una corrida real.
 */
export function sinGuardianPorque(motivo: string): void {
  if (!motivo.trim()) {
    throw new Error('sinGuardianPorque: el motivo es obligatorio (una exención sin motivo es un agujero).');
  }
  exencionDelTest = motivo;
}

/**
 * Captura TODO lo que el código loguea, en el orden en que lo loguea — **y apunta el buffer en el
 * registro del guardián AUTOMÁTICO** (ver el `afterEach` del final de este archivo). Llamar a esto es
 * lo único que hace falta: no hay que acordarse de verificar nada.
 */
export function capturarLogs(contexto?: string): string[] {
  const out: string[] = [];
  const push = (m: unknown) => {
    out.push(String(m));
  };
  for (const nivel of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, nivel).mockImplementation(push as never);
  }
  buffersDelTest.push({ logs: out, contexto: contexto ?? nombreDelTestEnCurso() });
  return out;
}

// =================================================================================================
// El job completo: provider REAL, `fetch` mockeado y un `prisma` que delata cualquier `create`/`update`.
// =================================================================================================
export const CARD = {
  id: 'c1',
  setId: 's1',
  externalId: 'sv8-104',
  number: '104',
  set: { id: 's1', externalId: 'sv8', name: 'Surging Sparks' },
};
export const FX: FxSnapshot = { rate: 19, bufferPct: 5 };
/** v1.51 (M-46, §4.38r): EL dial del gancho — uno solo, exhibición Y obtención. */
export const ON = { [SettingKey.GRADING_HOOK_ENABLED]: 'on' };

export interface ExtrasDeCorrida {
  /** Cartas del alcance (una por set si se quiere el caso MIXTO de producción). */
  cartas?: (typeof CARD)[];
  /** `localSetId → PptSetMapping`. Gana sobre el `pptSetId` posicional. */
  mapeos?: Record<string, PptSetMapping>;
  /**
   * Usa el `PptSetMapper` REAL (con su `PptApiClient` y el `fetch` enrutado). Es la única forma de
   * comprobar que las líneas que el veredicto cita del mapper existen de verdad.
   */
  mapperReal?: boolean;
  /** Filas de `CardSet` que ve el mapper real (`pptSetId` ya cacheado o no). */
  cardSets?: Partial<CardSet>[];
}

/**
 * ⛑️ **R-1 — el mapper FALSO tiene que LOGUEAR lo mismo que el REAL.**
 *
 * El guardián automático cazó esto en cuanto dejó de ser opt-in: un test que cableaba el mapper
 * STUB con `reason:'unmatched'` producía un veredicto que citaba `«PptSetMapper: … sets SIN mapeo»`
 * —correcto en producción, donde el mapper real emite esa línea en la MISMA llamada que devuelve
 * `unmatched`— sobre unos logs donde esa línea no existía, **porque el doble no la emitía**. O sea:
 * el doble mentía sobre el estado del mundo y convertía el guardián en un falso positivo.
 *
 * Se arregla en el DOBLE, no en el guardián ni en el veredicto: el stub emite exactamente las dos
 * marcas que emite `PptSetMapper` (y por la MISMA constante), en los mismos estados. Los casos con
 * `mapperReal: true` siguen ejercitando al emisor de verdad.
 */
function emitirComoElMapperReal(mapeos: PptSetMapping[]): void {
  const log = new Logger(PptSetMapper.name);
  const sinComprobar = mapeos.filter((m) => m.pptSetId === null && m.reason === 'mapper_unavailable');
  const sinMapeo = mapeos.filter((m) => m.pptSetId === null && m.reason === 'unmatched');
  if (sinComprobar.length > 0) {
    log.warn(
      `${emitirLineaGraded(GRADED_LOG_LINES.mapperUnavailable)} — doble de prueba: ` +
        `${sinComprobar.length} set(s) sin comprobar esta corrida.`,
    );
  }
  if (sinMapeo.length > 0) {
    log.warn(
      `${emitirLineaGraded(GRADED_LOG_LINES.mapperUnmatched, `${sinMapeo.length}/${mapeos.length}`)} ` +
        '(no se pedirán precios de ellos) — doble de prueba.',
    );
  }
}

export function wireJob(
  env: Record<string, string | undefined>,
  config: Record<string, unknown> = ON,
  /** Alcance del ingest: `[]` reproduce «ninguna carta con inventario RAW publicado» (R1, `no_scope`). */
  inventario: { cardId: string }[] = [{ cardId: 'c1' }],
  /** `null` reproduce el set SIN `pptSetId` mapeado (causa #5 del mapa; R1-ter). */
  pptSetId: string | null = 'sv8',
  extra: ExtrasDeCorrida = {},
) {
  const cartas = extra.cartas ?? [CARD];
  const store = new Map<string, unknown>(Object.entries(config));
  const create = jest.fn(async ({ data }: any) => ({ id: 'pr-new', ...data }));
  const update = jest.fn(async ({ data }: any) => ({ id: 'pr-1', ...data }));
  const cardSetUpdate = jest.fn(async () => ({}));
  const prisma = {
    configSetting: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[]).filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) })),
      ),
    },
    inventoryItem: { findMany: jest.fn(async () => inventario) },
    card: { findMany: jest.fn(async () => cartas) },
    priceReference: { findFirst: jest.fn(async () => null), create, update },
    cardSet: { update: cardSetUpdate },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as unknown as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'getPublishedSlabGradesBatch').mockResolvedValue(new Map());
  const c = cfg(env);
  const pptBulk = provider(c);

  // Mapeo por defecto: el `pptSetId` posicional aplicado al set de `CARD`. Un `null` significa
  // «se consultó el catálogo y NO empató» — el otro motivo (`mapper_unavailable`) se pide explícito
  // por `mapeos`, o se obtiene de verdad con `mapperReal`.
  const mapeos: Record<string, PptSetMapping> = extra.mapeos ?? {
    s1: pptSetId == null ? { pptSetId: null, reason: 'unmatched' } : { pptSetId },
  };
  const pptSetMapper = extra.mapperReal
    ? new PptSetMapper(prisma, new PptApiClient(c))
    : ({
        resolveForSets: jest.fn(async (sets: { id: string }[]) => {
          const resuelto = new Map<string, PptSetMapping>(
            sets.map((s) => [s.id, mapeos[s.id] ?? ({ pptSetId: null, reason: 'unmatched' } as const)]),
          );
          emitirComoElMapperReal([...resuelto.values()]);
          return resuelto;
        }),
      } as unknown as PptSetMapper);

  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const ingest = new PriceIngestService(
    prisma, settings, pricing, pptBulk, {} as never, {} as never, pptSetMapper, {} as never, undefined, audit,
  );
  return { ingest, create, update, cardSetUpdate, pptSetMapper };
}

// =================================================================================================
// ⛑️ EL GUARDIÁN (TL-GE7)
// =================================================================================================

export interface CitasDelVeredicto {
  /** Líneas del bloque `VEREDICTO-PSA` emitidas en esta corrida. */
  bloque: string[];
  /** Citas `«…»` (afirman EXISTIR) que no aparecen en ningún log de la corrida. **Deben ser cero.** */
  vivasHuerfanas: string[];
  /** Citas «NO existe en esta corrida» que sí aparecen. **Deben ser cero.** */
  ausentesQueSiExisten: string[];
  /**
   * R-2 — **el complemento**: marcas (o sus prefijos `PPT graded:` / `PptSetMapper:`) nombradas en el
   * bloque **fuera** de todo marcador de cita. Una mención sin marcador es invisible para las dos
   * comprobaciones de arriba, y es exactamente la redacción con la que el defecto R1 entró la primera
   * vez. **Deben ser cero.**
   */
  mencionesSinCitar: string[];
}

/**
 * **El invariante, mecanizado.** Para el bloque `VEREDICTO-PSA` de ESTA corrida:
 *  · toda línea citada entre `«…»` tiene que aparecer en los logs capturados de ESTA corrida;
 *  · toda línea citada como ausente NO tiene que aparecer.
 *
 * El pajar excluye a propósito las líneas del propio bloque: si no, una cita se «encontraría» a sí
 * misma y el guardián sería un espejo. Los `…` de las marcas se tratan como comodín (los rellena
 * `emitirLineaGraded` al emitir, con los mismos trozos fijos).
 */
export function verificarCitasDelVeredicto(logs: string[]): CitasDelVeredicto {
  const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG));
  const pajar = logs.filter((l) => !l.includes(GRADED_VERDICT_TAG));
  const texto = bloque.join('\n');
  const aparece = (cita: string) => pajar.some((l) => citaCoincideConLinea(cita, l));
  return {
    bloque,
    vivasHuerfanas: [...new Set(extraerCitasVivas(texto))].filter((c) => !aparece(c)),
    ausentesQueSiExisten: [...new Set(extraerCitasAusentes(texto))].filter((c) => aparece(c)),
    mencionesSinCitar: mencionesSinMarcar(texto),
  };
}

/**
 * El `expect` del guardián. Exige además que el bloque EXISTA: un veredicto que no se emitió pasaría
 * el invariante por vacuidad, y eso convertiría al guardián en decoración.
 */
export function esperarVeredictoCitable(logs: string[], contexto: string): CitasDelVeredicto {
  const r = verificarCitasDelVeredicto(logs);
  expect({ contexto, bloque: r.bloque.length > 0 }).toEqual({ contexto, bloque: true });
  expect({ contexto, huerfanas: r.vivasHuerfanas }).toEqual({ contexto, huerfanas: [] });
  expect({ contexto, ausentesPresentes: r.ausentesQueSiExisten }).toEqual({ contexto, ausentesPresentes: [] });
  // R-2 — el complemento: nombrar una línea sin marcador la deja fuera de las dos comprobaciones de
  // arriba. O se cita (y se verifica), o no se nombra.
  expect({ contexto, sinCitar: r.mencionesSinCitar }).toEqual({ contexto, sinCitar: [] });
  return r;
}

// =================================================================================================
// ⛑️ R-1 — EL GUARDIÁN, AUTOMÁTICO
// =================================================================================================
/**
 * Se registra al IMPORTAR el harness, así que corre en **todo** archivo que lo use, sobre **todos** los
 * buffers que ese test capturó. Va declarado en el cuerpo del módulo a propósito: el `import` se evalúa
 * antes que cualquier `afterEach` del propio `.spec`, así que este hook corre PRIMERO (antes de un
 * `jest.restoreAllMocks()`, que además no vacía el buffer).
 *
 * El `splice` deja el registro limpio pase lo que pase: un test que falle no puede contaminar al
 * siguiente con sus logs.
 */
afterEach(() => {
  const capturados = buffersDelTest.splice(0, buffersDelTest.length);
  const exencion = exencionDelTest;
  exencionDelTest = null;
  if (exencion != null) {
    // La exención afirma «aquí no hay bloque». Si lo hay, la afirmación es falsa y el guardián se
    // estaba saltando una corrida REAL: eso es justo lo que R-1 viene a impedir.
    const conBloque = capturados.filter((c) => c.logs.some((l) => l.includes(GRADED_VERDICT_TAG)));
    expect({
      exencion,
      contextosConBloqueDeVeredicto: conBloque.map((c) => c.contexto),
    }).toEqual({ exencion, contextosConBloqueDeVeredicto: [] });
    return;
  }
  for (const { logs, contexto } of capturados) esperarVeredictoCitable(logs, contexto);
});
