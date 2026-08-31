import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PokemonPriceTrackerBulkProvider } from '../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { PptApiClient } from '../src/modules/pricing/providers/ppt-api.client';
import { PriceIngestService, FxSnapshot } from '../src/modules/pricing/price-ingest.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PptSetMapper } from '../src/modules/pricing/ppt-set-mapper.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { BusinessException } from '../src/common/business.exception';
import {
  RETIRED_SETTING_KEYS,
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
} from '../src/modules/settings/settings.constants';

/**
 * v1.51 — **M-46: el gancho de grading pasa de DOS interruptores a UNO** (ARCHITECTURE §4.38r,
 * API_CONTRACT rev v1.51-one-dial). Decisión del DUEÑO, tomada y reafirmada.
 *
 * ### Qué prueba este archivo, y por qué no bastaba con lo que ya había
 * El colapso mueve una palanca que **gasta dinero de verdad**: con un solo dial, un `PUT` publica las
 * cifras **y** arranca el consumo de créditos de un proveedor de paga **y** empieza a escribir precios.
 * Las dos afirmaciones que sostienen el pase son, por tanto, afirmaciones sobre **ausencia de gasto**:
 *
 *  1. **Con el dial apagado, una corrida COMPLETA del job no emite NI UNA petición** y escribe cero
 *     filas. Se comprueba con el **provider REAL**, `fetch` sustituido por un **delator**, y la **API
 *     key PRESENTE** — sin la llave el provider sale con `warn` antes de la primera llamada y el test
 *     estaría midiendo otra cosa (§4.38r.3.1.2). Va con **contraste en el mismo test**: el mismo
 *     fixture con el dial `on` sí pide y sí escribe. «Cero peticiones» sin contraste puede ser
 *     simplemente un fixture flojo.
 *  2. **Ningún valor ya almacenado puede armar el dial nuevo** (§4.38r.1). El escenario no es
 *     sintético: es el **estado REAL de producción** —`graded_estimates_enabled = "on"` y
 *     `graded_estimate_ingest_enabled = "on"` presentes en la tabla— sin `grading_hook_enabled`. Es LA
 *     razón por la que la clave es nueva en vez de reusada: reusarla habría ensanchado el significado
 *     de un valor guardado y el siguiente tick del cron (2×/día, ≤12 h, **sin humano**) habría sido la
 *     primera factura del dueño.
 *
 * El resto del archivo cierra los bordes del colapso: que el gate lea el **dial crudo** y no las
 * derivadas de curaduría (§4.38h.3), que las claves retiradas den **422**, que sigan **inertes pero
 * ROTULADAS** en el inventario de arranque, y que un dial encienda las **dos** superficies a la vez.
 */

const CARD = {
  id: 'c1',
  setId: 's1',
  externalId: 'sv8-104',
  number: '104',
  set: { id: 's1', externalId: 'sv8', name: 'Surging Sparks' },
};
const FX: FxSnapshot = { rate: 19, bufferPct: 5 };
const HOY = new Date().toISOString().slice(0, 10);
/** S1 impecable: con el dial `on` esta entrada SÍ se persiste (lo comprueba el contraste). */
const PAGINA_S1 = {
  data: [{ id: 'sv8-104', cardNumber: '104', ebay: { salesByGrade: { psa10: { count: 7, medianPrice: 60, lastSaleDate: HOY } } } }],
  total: 1,
  count: 1,
  hasMore: false,
};

/**
 * ⚠️ El entorno del provider está montado para que **sí se pida**: llave presente y formato de moneda
 * fijado. Lo ÚNICO que puede impedir la petición en estos tests es el dial.
 */
function envQuePide(): ConfigService {
  const env: Record<string, string | undefined> = {
    POKEMONPRICETRACKER_API_KEY: 'k',
    POKEMONPRICETRACKER_MARKET_FORMAT: 'usd_dollars',
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

/** EL DELATOR: cualquier salida a red pasa por aquí y queda registrada. */
function delatorDeFetch() {
  const spy = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => PAGINA_S1,
    text: async () => JSON.stringify(PAGINA_S1),
  }));
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

/** Job completo con provider REAL y un `prisma` que delata cualquier escritura en `PriceReference`. */
function wireJob(config: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(config));
  const create = jest.fn(async ({ data }: { data: unknown }) => ({ id: 'pr-new', ...(data as object) }));
  const update = jest.fn(async ({ data }: { data: unknown }) => ({ id: 'pr-1', ...(data as object) }));
  const prisma = {
    configSetting: {
      findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((k) => store.has(k)).map((k) => ({ key: k, valueJson: store.get(k) })),
      ),
    },
    inventoryItem: { findMany: jest.fn(async () => [{ cardId: 'c1' }]) },
    card: { findMany: jest.fn(async () => [CARD]) },
    priceReference: { findFirst: jest.fn(async () => null), create, update },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as unknown as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'getPublishedSlabGradesBatch').mockResolvedValue(new Map());
  const pptBulk = new PokemonPriceTrackerBulkProvider(envQuePide(), new PptApiClient(envQuePide()));
  const pptSetMapper = { resolveForSets: jest.fn(async () => new Map([['s1', { pptSetId: 'sv8' }]])) } as unknown as PptSetMapper;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const ingest = new PriceIngestService(
    prisma, settings, pricing, pptBulk, {} as never, {} as never, pptSetMapper, {} as never, undefined, audit,
  );
  return { ingest, pricing, create, update };
}

const ON = { [SettingKey.GRADING_HOOK_ENABLED]: 'on' };
/** El estado REAL de producción antes del pase: las dos claves viejas, y `on` la de exhibición. */
const PRODUCCION_HOY = {
  graded_estimates_enabled: 'on',
  graded_estimate_ingest_enabled: 'on',
};

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// =================================================================================================
describe('M-46 — con el dial APAGADO no se gasta: cero peticiones y cero escrituras (§4.38r.4 paso 3)', () => {
  it('corrida COMPLETA con `grading_hook_enabled` off ⇒ `fetch` NUNCA se llama, `written=0`, cero writes', async () => {
    const fetchSpy = delatorDeFetch();
    const { ingest, create, update } = wireJob({}); // dial ausente ⇒ SETTING_DEFAULTS ⇒ 'off'

    const res = await ingest.ingestGradedEstimates(FX);

    // La aserción del dinero: no se preguntó al proveedor. Ni una vez.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.written).toBe(0);
    expect(res.enabled).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('CONTRASTE — el MISMO fixture con el dial `on` SÍ pide y SÍ escribe (si no, la prueba de arriba no probaría nada)', async () => {
    const fetchSpy = delatorDeFetch();
    const { ingest, create } = wireJob(ON);

    const res = await ingest.ingestGradedEstimates(FX);

    expect(fetchSpy).toHaveBeenCalled();
    expect(res.enabled).toBe(true);
    expect(res.written).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('el dial apagado gana también sobre la config del ingest VÁLIDA y el inventario publicado (no es un no-op accidental)', async () => {
    // Todo lo demás está en su sitio —hay carta publicada, hay mapeo de set, la config es válida— así
    // que la ÚNICA razón por la que no se pide es el dial. Sin esto, un fixture vacío podría estar
    // dando el verde por el camino equivocado (`cardIds.length === 0` sale antes y también sin pedir).
    const fetchSpy = delatorDeFetch();
    const { ingest } = wireJob({
      [SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT]: 5,
      [SettingKey.GRADED_ESTIMATE_SOURCE_STAT]: 'median',
      [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 250,
    });

    const res = await ingest.ingestGradedEstimates(FX);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.cardsInScope).toBe(0); // ni siquiera se llegó a resolver el alcance
    expect(res.written).toBe(0);
  });
});

// =================================================================================================
describe('M-46 — NINGÚN valor almacenado puede armar el dial nuevo (§4.38r.1, la decisión de seguridad)', () => {
  it('con el estado REAL de producción (las dos retiradas en `on`) el ingest NO pide ni escribe nada', async () => {
    const fetchSpy = delatorDeFetch();
    const { ingest, create, update } = wireJob(PRODUCCION_HOY);

    const res = await ingest.ingestGradedEstimates(FX);

    // Si esto se pone en rojo, el deploy del colapso empieza a gastar SOLO en el siguiente tick del
    // cron (≤12 h, sin intervención humana). Es la factura que M-46 existe para no emitir.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.written).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('y el STOREFRONT tampoco publica nada con esas mismas filas (el dial viejo no exhibe)', async () => {
    const { pricing } = wireJob(PRODUCCION_HOY);
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.estimatesEnabled).toBe(false);
    expect(cfg.highlightEnabled).toBe(false);
  });

  it('el dial nuevo NO cae al valor de la clave vieja ni por ausencia ni por basura', async () => {
    for (const guardado of [undefined, null, true, 'ON', 'On', 1, 'sí', '']) {
      const cfg = { ...PRODUCCION_HOY } as Record<string, unknown>;
      if (guardado !== undefined) cfg[SettingKey.GRADING_HOOK_ENABLED] = guardado;
      const { pricing } = wireJob(cfg);
      expect((await pricing.loadGradedEstimateConfig()).enabled).toBe(false);
    }
    // …y solo el string exacto `'on'` enciende.
    const { pricing } = wireJob({ [SettingKey.GRADING_HOOK_ENABLED]: 'on' });
    expect((await pricing.loadGradedEstimateConfig()).enabled).toBe(true);
  });
});

// =================================================================================================
describe('M-46 — el gate del INGEST lee el DIAL CRUDO, no el `enabled` derivado (§4.38h.3)', () => {
  it('con claves de CURADURÍA corruptas el ingest SIGUE pidiendo y escribiendo (un dedazo no congela el feed)', async () => {
    const fetchSpy = delatorDeFetch();
    const { ingest, create, pricing } = wireJob({
      ...ON,
      [SettingKey.GRADING_MIN_UPSIDE_PCT]: 'no-es-un-numero',
      [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: 'tampoco',
      [SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE]: -3,
    });

    // La vitrina SÍ se apaga por esas claves — eso es correcto y no se toca.
    const cfg = await pricing.loadGradedEstimateConfigForAdmin();
    expect(cfg.highlightEnabled).toBe(false);
    expect(cfg.enabled).toBe(true);

    // Lo que NO puede pasar: que apagar la vitrina apague la obtención de datos.
    const res = await ingest.ingestGradedEstimates(FX);
    expect(fetchSpy).toHaveBeenCalled();
    expect(res.written).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

// =================================================================================================
/**
 * **v1.51-a — I8 estrechado (`ingestMaxCardsPerRun`: `[1, 5000]` → `[1, 1000]`, §4.38r.3.4).**
 *
 * ### Qué protege este bloque, y por qué vive AQUÍ
 * El estrechamiento se decidió «seguro de hacer ahora» por UNA razón concreta y verificable: un valor
 * ya almacenado que se sale del rango nuevo —un `2000` puesto ayer, perfectamente legal entonces— **no
 * se queda gastando**: el lector lo marca presente-e-INVÁLIDA ⇒ `ingestConfigInvalid` ⇒
 * `ingestGradedEstimates` sale **antes de pedir nada**. Es la dirección correcta del fallo (§4.38r.3.4
 * › «Compatibilidad y dirección del fallo»), y sin ella el cambio habría que hacerlo con una migración
 * de datos por delante. Este archivo es el que ya tiene el **delator de `fetch` + provider REAL + llave
 * presente**, o sea el único sitio donde «cero peticiones» significa de verdad cero peticiones.
 *
 * ### El candado que se pide explícitamente
 * `ingestConfigInvalid` se compone hoy en `pricing.service.ts` como
 * `minSampleRes.invalid || sourceStatRes.invalid || ingestMaxRes.invalid`. **Si mañana alguien la
 * recompone y deja de incluir `ingestMaxRes.invalid`**, el `2000` dejaría de apagar el ingest y el job
 * seguiría gastando con un tope que el propio validador acaba de declarar inválido: estos tests se
 * ponen ROJOS ahí, y esa es su única razón de existir.
 *
 * ### ⛔ Lo que NO se está probando
 * Que el gasto esté acotado. Este dial acota las cartas **en alcance**, no las que el proveedor
 * devuelve; la amplificación `A` (nº de sets) no la acota ningún dial. Aquí solo se fija que un valor
 * fuera de rango **apaga**, no que 1 000 sea barato.
 */
describe('v1.51-a (I8) — un `ingestMaxCardsPerRun` almacenado FUERA de rango APAGA el ingest, no lo deja gastando', () => {
  /** Legal bajo el rango VIEJO `[1, 5000]`, inválido bajo el nuevo `[1, 1000]`. El caso real. */
  const ALMACENADO_VIEJO = { ...ON, [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 2000 };

  it('con `2000` almacenado y el dial `on`: `fetch` NUNCA se llama, `written=0` y cero escrituras', async () => {
    const fetchSpy = delatorDeFetch();
    const { ingest, create, update } = wireJob(ALMACENADO_VIEJO);

    const res = await ingest.ingestGradedEstimates(FX);

    // La aserción del dinero. Si esto se pone en rojo, el estrechamiento pasó a fallar ABRIENDO.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.written).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(res.cardsInScope).toBe(0); // ni se llegó a resolver el alcance
  });

  it('y la RAZÓN es la clave, nombrada: `ingestConfigInvalid` con el dial `on` y un `warn` que la identifica', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const { pricing } = wireJob(ALMACENADO_VIEJO);

    const cfg = await pricing.loadGradedEstimateConfigForAdmin();

    expect(cfg.enabled).toBe(true); // el dial NO es el que apaga: está encendido
    expect(cfg.ingestConfigInvalid).toBe(true); // lo apaga ESTA clave
    // v1.51-b (R1): y la clave viaja NOMBRADA, para que el veredicto del ingest pueda decir QUÉ
    // corregir. «La config del ingest es inválida» no es accionable; el nombre de la clave sí.
    expect(cfg.ingestInvalidKeys).toEqual([SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]);
    expect(
      warn.mock.calls.some(
        (c) =>
          String(c[0]).includes(SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN) &&
          String(c[0]).includes('[1, 1000]'),
      ),
    ).toBe(true);
  });

  it('CONTRASTE — el MISMO fixture con `1000` (el máximo nuevo) SÍ pide y SÍ escribe', async () => {
    // Sin este contraste, «cero peticiones» podría venir de un fixture flojo y no del estrechamiento.
    const fetchSpy = delatorDeFetch();
    const { ingest, create, pricing } = wireJob({
      ...ON,
      [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 1000,
    });

    expect((await pricing.loadGradedEstimateConfigForAdmin()).ingestConfigInvalid).toBe(false);
    const res = await ingest.ingestGradedEstimates(FX);
    expect(fetchSpy).toHaveBeenCalled();
    expect(res.written).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('el seed `250` no se ve afectado por el estrechamiento (ningún entorno sembrado cambia de conducta)', async () => {
    const fetchSpy = delatorDeFetch();
    const { ingest } = wireJob({ ...ON, [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 250 });
    expect((await ingest.ingestGradedEstimates(FX)).written).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// =================================================================================================
describe('M-46 — UN dial, DOS superficies: encienden y se apagan juntas (§4.38r.1)', () => {
  it('`on` enciende storefront e ingest a la vez; `off` los calla a la vez', async () => {
    const encendido = wireJob(ON);
    expect((await encendido.pricing.loadGradedEstimateConfig()).estimatesEnabled).toBe(true);
    delatorDeFetch();
    expect((await encendido.ingest.ingestGradedEstimates(FX)).enabled).toBe(true);

    const apagado = wireJob({});
    expect((await apagado.pricing.loadGradedEstimateConfig()).estimatesEnabled).toBe(false);
    delatorDeFetch();
    expect((await apagado.ingest.ingestGradedEstimates(FX)).enabled).toBe(false);
  });

  it('la config APAGADA ya no lleva `ingestEnabled` (el DTO del contrato lo perdió)', async () => {
    const { pricing } = wireJob({});
    const cfg = await pricing.loadGradedEstimateConfig();
    expect('ingestEnabled' in cfg).toBe(false);
  });
});

// =================================================================================================
describe('M-46 — `PUT /admin/settings`: las retiradas dan 422 y nace `gradingHookEnabled` (§M10)', () => {
  let prisma: { configSetting: { upsert: jest.Mock }; $transaction: jest.Mock };
  let service: SettingsService;

  beforeEach(() => {
    prisma = {
      configSetting: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new SettingsService(prisma as unknown as PrismaService);
  });

  it.each(['gradedEstimatesEnabled', 'gradedEstimateIngestEnabled'])(
    '`%s` ⇒ 422 VALIDATION_ERROR (clave desconocida) y CERO escrituras',
    async (dtoKey) => {
      // No hay código de rechazo: hay AUSENCIA de la clave en `SETTING_DTO_MAP`, y la lista blanca de
      // `update()` hace el resto. Mismo precedente que `stripeFeeIvaPct` (v1.40).
      await expect(service.update({ [dtoKey]: 'on' })).rejects.toBeInstanceOf(BusinessException);
      await expect(service.update({ [dtoKey]: 'on' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { errors: { [dtoKey]: 'unknown setting key' } },
      });
      expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
    },
  );

  it('las dos juntas ⇒ 422 con AMBAS enumeradas, y ni el dial válido del mismo body se escribe (todo o nada)', async () => {
    await expect(
      service.update({ gradedEstimatesEnabled: 'on', gradedEstimateIngestEnabled: 'on', gradingHookEnabled: 'on' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        errors: {
          gradedEstimatesEnabled: 'unknown setting key',
          gradedEstimateIngestEnabled: 'unknown setting key',
        },
      },
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
  });

  it('`gradingHookEnabled` se acepta con `on`/`off` y se persiste en `grading_hook_enabled`', async () => {
    expect(await service.update({ gradingHookEnabled: 'on' })).toEqual({ gradingHookEnabled: 'on' });
    expect(prisma.configSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'grading_hook_enabled' } }),
    );
    expect(await service.update({ gradingHookEnabled: 'off' })).toEqual({ gradingHookEnabled: 'off' });
  });

  it.each([['ON'], [true], ['encendido'], [1], [null]])(
    '`gradingHookEnabled: %p` ⇒ 422 (no se guarda algo que PAREZCA encendido sin serlo)',
    async (v) => {
      await expect(service.update({ gradingHookEnabled: v })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
    },
  );

  it('`GET /admin/settings` expone `gradingHookEnabled` con su seed `off` y NO las retiradas', async () => {
    const p = {
      configSetting: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;
    const dto = await new SettingsService(p).getAllDto();
    expect(dto).toHaveProperty('gradingHookEnabled', 'off');
    expect(dto).not.toHaveProperty('gradedEstimatesEnabled');
    expect(dto).not.toHaveProperty('gradedEstimateIngestEnabled');
  });
});

// =================================================================================================
describe('M-46 — las dos claves quedan RETIRADAS del código (patrón §4.36.9b)', () => {
  it.each(RETIRED_SETTING_KEYS)('%s no tiene SettingKey, ni default, ni validador, ni entrada en el DTO', (key) => {
    expect(Object.values(SettingKey)).not.toContain(key);
    expect(Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(SETTING_VALIDATORS, key)).toBe(false);
    expect(Object.values(SETTING_DTO_MAP)).not.toContain(key);
  });

  it('el seed NO las siembra, y sí siembra `grading_hook_enabled` en `off` (fail-closed)', () => {
    for (const key of RETIRED_SETTING_KEYS) expect(Object.keys(SETTING_DEFAULTS)).not.toContain(key);
    expect(SETTING_DEFAULTS[SettingKey.GRADING_HOOK_ENABLED]).toBe('off');
    expect(SETTING_VALIDATORS[SettingKey.GRADING_HOOK_ENABLED]('on')).toBeNull();
    expect(SETTING_DTO_MAP.gradingHookEnabled).toBe(SettingKey.GRADING_HOOK_ENABLED);
  });
});

// =================================================================================================
describe('M-46 — el inventario de arranque ROTULA las claves retiradas presentes (§4.38r.1, §11.0)', () => {
  function wireInventario(rows: { key: string; valueJson: unknown }[]) {
    const prisma = { configSetting: { findMany: jest.fn(async () => rows) } } as unknown as PrismaService;
    return new SettingsService(prisma);
  }

  it('con las dos filas viejas en la base, la línea las nombra, las marca INERTES y desmiente la lectura ingenua', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    await wireInventario([
      { key: 'graded_estimates_enabled', valueJson: 'on' },
      { key: 'graded_estimate_ingest_enabled', valueJson: 'off' },
    ]).logConfigInventory();

    const linea = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('RETIRADAS')) ?? '';
    expect(linea).toContain('graded_estimates_enabled="on"');
    expect(linea).toContain('graded_estimate_ingest_enabled="off"');
    expect(linea).toContain('INERTES');
    expect(linea).toContain('grading_hook_enabled');
    // Lo que evita el incidente: que nadie lea `..._ingest_enabled = off` y concluya que no se gasta.
    expect(linea).toContain('NO concluyas');
  });

  it('se emite AUNQUE no haya ninguna divergencia — que es justo el caso de producción tras el pase', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    await wireInventario([{ key: 'graded_estimate_ingest_enabled', valueJson: 'off' }]).logConfigInventory();

    const lineas = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lineas.some((l) => l.includes('RETIRADAS'))).toBe(true);
    expect(lineas.some((l) => l.includes('SIN DIVERGENCIAS'))).toBe(true); // el `return` temprano no la come
  });

  it('sin filas retiradas no se emite el rótulo (cero ruido en un entorno nuevo)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    await wireInventario([{ key: 'grading_hook_enabled', valueJson: 'off' }]).logConfigInventory();
    expect(logSpy.mock.calls.map((c) => String(c[0])).some((l) => l.includes('RETIRADAS'))).toBe(false);
  });
});
