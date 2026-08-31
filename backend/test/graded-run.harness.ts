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
  citaCoincideConLinea,
  extraerCitasAusentes,
  extraerCitasVivas,
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

/** Captura TODO lo que el código loguea, en el orden en que lo loguea. */
export function capturarLogs(): string[] {
  const out: string[] = [];
  const push = (m: unknown) => {
    out.push(String(m));
  };
  for (const nivel of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, nivel).mockImplementation(push as never);
  }
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
        resolveForSets: jest.fn(async (sets: { id: string }[]) =>
          new Map(sets.map((s) => [s.id, mapeos[s.id] ?? { pptSetId: null, reason: 'unmatched' as const }])),
        ),
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
  return r;
}
