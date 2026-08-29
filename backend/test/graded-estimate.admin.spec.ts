import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { GradedEstimatesController } from '../src/modules/catalog/graded-estimates.controller';
import { FxService } from '../src/modules/pricing/fx.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { DEFAULT_GRADING_COST_TIERS } from '../src/common/graded-estimate';

/**
 * v1.44-graded-estimate — DIALES M2 del gancho + diagnóstico de curaduría
 * (`GET/PUT /admin/pricing/graded-estimates` y `.../preview`; API_CONTRACT §M2, ARCHITECTURE §4.38d).
 *
 * Estos endpoints NO capturan estimados (eso es `POST /admin/pricing/override`, fase 1 manual-first) y
 * NADA de lo que gobiernan viaja al cliente. Lo que se prueba aquí es que los invariantes I1–I7 se
 * validan en CADA write (fail-closed, con código propio), que el write es todo-o-nada, que queda
 * auditado, y que el diagnóstico explica POR QUÉ una carta no está destacada.
 */

const RECENT = new Date(Date.now() - 2 * 86_400_000);

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === 'OR') {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(v as any[]).every((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === 'cardProduct') {
      if (row.cardProductId == null) return false;
      continue;
    }
    const rv = (row as Record<string, unknown>)[k];
    if (v === null) {
      if (rv != null) return false;
      continue;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('in' in o) {
        if (!(o.in as unknown[]).includes(rv)) return false;
        continue;
      }
      if ('gt' in o) {
        if (!(typeof rv === 'number' && rv > (o.gt as number))) return false;
        continue;
      }
      if ('not' in o) {
        if (rv === o.not) return false;
        continue;
      }
      return false;
    }
    if (rv !== v) return false;
  }
  return true;
}

const CARD = {
  id: 'ca',
  externalId: 'sv8-1',
  name: 'Pikachu',
  number: '1',
  numberSort: 1,
  numberPrefix: '',
  rarity: 'Illustration Rare',
  rarityCanonical: 'Illustration Rare',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's1',
  imageSmallUrl: null,
  imageLargeUrl: null,
  availableFinishes: ['normal'],
  set: { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08' },
};

const rawItem = (over: Partial<any> = {}) => ({
  id: 'i1',
  cardId: 'ca',
  productType: 'raw',
  rawCondition: 'NM',
  sealedSubtype: null,
  sealedCondition: null,
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  status: 'listed',
  ownerType: 'platform',
  finish: 'normal',
  tcgplayerProductId: null,
  listPriceCents: 100_000,
  createdAt: new Date('2026-08-01'),
  card: CARD,
  ...over,
});

const psaRef = (gradeValue: '10' | '9', mxnCents: number, capturedDate = RECENT) => ({
  cardId: 'ca',
  productType: 'graded',
  gradeKey: `graded:PSA:${gradeValue}`,
  finish: 'normal',
  priceMxnCents: mxnCents,
  priceUsdCents: null,
  isManualOverride: true,
  source: 'manual',
  capturedDate,
  cardProductId: null,
});

function wire(items: any[] = [], refs: any[] = [], config: Record<string, unknown> = {}) {
  // Estado SEMBRADO por defecto: `prisma/seed.ts` escribe una fila por cada `SETTING_DEFAULTS`. La
  // clave del COSTO no tiene default de CÓDIGO (R1, §4.38d): si la fila no existe la tabla es `[]`.
  const configStore = new Map<string, unknown>(
    Object.entries({ [SettingKey.GRADING_COST_TIERS]: DEFAULT_GRADING_COST_TIERS, ...config }),
  );
  const upsert = jest.fn(async ({ where: { key }, create, update }: any) => {
    configStore.set(key, configStore.has(key) ? update.valueJson : create.valueJson);
    return { key };
  });
  // `prisma` se referencia DENTRO de su propia definición (el mock de `$transaction` interactiva le pasa
  // este mismo cliente como `tx`). Con `const` + inicializador la referencia se resuelve en tiempo de
  // llamada, que es cuando ya existe.
  const prisma: any = {
    // D4 + v1.50.2 (BE-GE2): el `PUT` escribe dentro de `$transaction` **y ahora audita ahí dentro**,
    // así que la transacción pasó de la forma «array de operaciones» a la INTERACTIVA (callback con
    // `tx`). El mock soporta las dos: con callback le pasa un cliente transaccional que es el mismo
    // prisma (los upserts y el `auditLog.create` observables siguen siéndolo).
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
    configSetting: {
      findUnique: jest.fn(async ({ where: { key } }: any) =>
        configStore.has(key) ? { key, valueJson: configStore.get(key) } : null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[])
          .filter((k) => configStore.has(k))
          .map((k) => ({ key: k, valueJson: configStore.get(k) })),
      ),
      upsert,
    },
    priceReference: {
      // v1.50.3: la LISTA DE REVISIÓN pide `distinct: ['cardId']` + `take`, así que el mock los honra.
      // Sin `distinct`, una carta con PSA 10 **y** PSA 9 entraría dos veces al conjunto motor y el
      // `scannedCards` mentiría — que es justo el número que el operador usa para confiar en la lista.
      findMany: jest.fn(async (args: any) => {
        let out = refs.filter((r) => matchWhere(r, args.where));
        if (Array.isArray(args.distinct)) {
          const seen = new Set<string>();
          out = out.filter((r: any) => {
            const k = (args.distinct as string[]).map((f) => String(r[f])).join('|');
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        }
        if (typeof args.take === 'number') out = out.slice(0, args.take);
        return out;
      }),
      // v1.50.3-d — el BORRADO del estimado (§4.38q). Muta el mismo array `refs` que lee `findMany`,
      // así que las pruebas pueden comprobar el efecto observable (la fila deja de existir) y no solo
      // que se llamó al mock: «borró» tiene que significar «ya no está».
      deleteMany: jest.fn(async (args: any) => {
        const doomed = refs.filter((r) => matchWhere(r, args.where));
        for (const r of doomed) refs.splice(refs.indexOf(r), 1);
        return { count: doomed.length };
      }),
    },
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    inventoryItem: { findMany: jest.fn(async (args: any) => items.filter((i) => matchWhere(i, args.where))) },
    card: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === 'ca' ? CARD : null)),
    },
    cardSet: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const fx = { getCurrent: jest.fn(async () => null) } as unknown as FxService;
  const pricing = new PricingService(prisma, settings, fx, {} as any, {} as any, {} as any);
  const catalog = new CatalogService(prisma, pricing);
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const ctrl = new GradedEstimatesController(pricing, catalog, prisma, audit);
  return { ctrl, catalog, pricing, prisma, audit, upsert, configStore };
}

const ON = { [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on' };
const tier = (min: number, max: number | null, cost: number) => ({
  minValueMxnCents: min,
  maxValueMxnCents: max,
  costMxnCents: cost,
});

describe('GET /admin/pricing/graded-estimates', () => {
  it('devuelve la config EFECTIVA con el seed y `enabled` como espejo del dial M10', async () => {
    const { ctrl } = wire();
    expect(await ctrl.get()).toEqual({
      enabled: false, // seed `off`, fail-closed
      ingestEnabled: false, // v1.50.2: 2º dial M10 (la OBTENCIÓN), también fail-closed
      grades: ['10', '9'],
      highlightGrades: ['10'],
      freshnessDays: 30,
      minUpsidePct: 30,
      gradingCostTiers: DEFAULT_GRADING_COST_TIERS,
      // v1.50.3 (GU-A17): seeds ALINEADOS a `PROJECT.md` §O.7 — 30 / 100 / 5, no `null` / 50 / 3.
      manualFreshnessDays: 30,
      maxRawMultiple: 100,
      minSampleCount: 5,
      sourceStat: 'median',
      ingestMaxCardsPerRun: 250,
    });
  });

  it('R1 — con la fila `grading_cost_tiers` AUSENTE el editor ve `[]` (la config EFECTIVA, no una fantasma)', async () => {
    const { ctrl, configStore } = wire();
    configStore.delete(SettingKey.GRADING_COST_TIERS);
    expect(await ctrl.get()).toMatchObject({ gradingCostTiers: [], grades: ['10', '9'] });
  });
});

describe('PUT /admin/pricing/graded-estimates — invariantes I1–I7 (fail-closed, en CADA write)', () => {
  it('I1 — `gradingCostTiers: []` ⇒ 422 GRADING_TIERS_EMPTY', async () => {
    const { ctrl } = wire();
    await expect(ctrl.put({ gradingCostTiers: [] }, 'admin')).rejects.toMatchObject({
      code: 'GRADING_TIERS_EMPTY',
    });
  });

  it('I2 — `costMxnCents: 0` ⇒ 422 VALIDATION_ERROR (JAMÁS 0: es lo que haría perder dinero)', async () => {
    const { ctrl } = wire();
    await expect(ctrl.put({ gradingCostTiers: [tier(0, null, 0)] }, 'admin')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      ctrl.put({ gradingCostTiers: [tier(0, null, 10_000_001)] }, 'admin'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' }); // anti-typo
  });

  it('I4 — hueco entre escalones ⇒ 422 GRADING_TIERS_NOT_CONTIGUOUS con los pares infractores', async () => {
    const { ctrl } = wire();
    await expect(
      ctrl.put({ gradingCostTiers: [tier(0, 200_000, 70_000), tier(300_000, null, 110_000)] }, 'admin'),
    ).rejects.toMatchObject({
      code: 'GRADING_TIERS_NOT_CONTIGUOUS',
      details: { offending: [{ i: 0, next: 1 }] },
    });
  });

  it('I5 — el último escalón no es abierto ⇒ 422 GRADING_TIERS_NOT_OPEN_ENDED', async () => {
    const { ctrl } = wire();
    await expect(
      ctrl.put({ gradingCostTiers: [tier(0, 200_000, 70_000)] }, 'admin'),
    ).rejects.toMatchObject({ code: 'GRADING_TIERS_NOT_OPEN_ENDED' });
  });

  it('I6 — `minUpsidePct` fuera de [0,1000] y `freshnessDays` fuera de [1,365] ⇒ 422', async () => {
    const { ctrl } = wire();
    await expect(ctrl.put({ minUpsidePct: 1001 }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ctrl.put({ minUpsidePct: -1 }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ctrl.put({ freshnessDays: 0 }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ctrl.put({ freshnessDays: 366 }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  /**
   * v1.50.2 (techlead) — **I6 usa los validadores COMPARTIDOS, no una copia local.**
   *
   * `freshnessDays`/`minUpsidePct` se revalidaban aquí a mano (`typeof v !== 'number' || …`) con el
   * rango reescrito en el mensaje, mientras `validateGradedEstimateFreshnessDays` /
   * `validateGradingMinUpsidePct` ya gobernaban las otras dos puertas a la MISMA clave
   * (`PUT /admin/settings` y la lectura fail-closed). Tres copias del mismo invariante que nadie obliga
   * a coincidir: relajar el rango compartido dejaba esta puerta estricta **sin que nada fallara**.
   *
   * Esta prueba fija lo observable —el MENSAJE y el `details.field`— que es lo que se prometió no
   * cambiar al unificarlos, y comprueba el tipo (no solo el rango), que es lo que el validador
   * compartido aporta.
   */
  it('I6 — el 422 sale del validador COMPARTIDO: mismo mensaje, mismo `field`, y también caza el TIPO', async () => {
    const { ctrl } = wire();
    const err = async (body: Record<string, unknown>) => ctrl.put(body as never, 'admin').catch((e) => e);

    expect(await err({ freshnessDays: 366 })).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'freshnessDays must be an integer in [1, 365] (days)',
      details: { field: 'freshnessDays' },
    });
    expect(await err({ minUpsidePct: 1001 })).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'minUpsidePct must be a number in [0, 1000]',
      details: { field: 'minUpsidePct' },
    });
    // Tipos: un string o un no-entero no pasan por «venir dentro del rango».
    for (const body of [{ freshnessDays: '30' }, { freshnessDays: 1.5 }, { minUpsidePct: '30' }, { minUpsidePct: NaN }]) {
      expect(await err(body)).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('I7 — grados fuera de {"10","9"}, duplicados o `highlightGrades` huérfano ⇒ 422', async () => {
    const { ctrl } = wire();
    await expect(ctrl.put({ grades: ['8'] }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ctrl.put({ grades: [] }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ctrl.put({ grades: ['10', '10'] }, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // El subconjunto se valida contra el ESTADO RESULTANTE: dejar `grades:['10']` con el
    // `highlightGrades:['10']` vigente es válido, pero un badge de PSA 9 sin PSA 9 en la ficha, no.
    await expect(ctrl.put({ grades: ['10'], highlightGrades: ['9'] }, 'admin')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { orphan: ['9'] },
    });
  });

  it('un body inválido NO escribe NADA (todo-o-nada)', async () => {
    const { ctrl, upsert } = wire();
    await expect(
      ctrl.put({ minUpsidePct: 50, gradingCostTiers: [tier(0, 200_000, 70_000)] }, 'admin'),
    ).rejects.toMatchObject({ code: 'GRADING_TIERS_NOT_OPEN_ENDED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('body vacío ⇒ 422 (no es un no-op silencioso)', async () => {
    const { ctrl } = wire();
    await expect(ctrl.put({}, 'admin')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('actualización PARCIAL válida: persiste, audita before/after y devuelve la config nueva', async () => {
    const { ctrl, audit, configStore } = wire();
    const after = await ctrl.put({ minUpsidePct: 60, freshnessDays: 15 }, 'admin-1');
    expect(after.minUpsidePct).toBe(60);
    expect(after.freshnessDays).toBe(15);
    expect(after.gradingCostTiers).toEqual(DEFAULT_GRADING_COST_TIERS); // no se tocó lo no enviado
    expect(configStore.get(SettingKey.GRADING_MIN_UPSIDE_PCT)).toBe(60);
    // v1.50.2 (BE-GE2): `audit.log` recibe ahora un SEGUNDO argumento —el cliente transaccional—,
    // porque la bitácora se escribe DENTRO de la misma transacción que los upserts.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'pricing.graded_estimates.update',
        entityType: 'ConfigSetting',
        before: expect.objectContaining({ minUpsidePct: 30 }),
        after: expect.objectContaining({ minUpsidePct: 60 }),
      }),
      expect.anything(),
    );
  });

  it('D4 — los upserts van en UNA transacción (todo-o-nada de verdad, no un bucle suelto)', async () => {
    const { ctrl, prisma, upsert } = wire();
    await ctrl.put({ minUpsidePct: 60, freshnessDays: 15, grades: ['10', '9'] }, 'admin');
    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    // v1.50.2: la transacción pasó a INTERACTIVA (callback), porque además de los upserts tiene que
    // contener la BITÁCORA. Lo que se afirma sigue siendo lo mismo: UNA transacción y TRES upserts.
    expect(typeof (prisma as any).$transaction.mock.calls[0][0]).toBe('function');
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  /**
   * v1.50.2 — deuda BE-GE2 saldada (PARIDAD con v2.1.6/P48-B1): efecto y bitácora **commitean o
   * revierten juntos**. Antes el `audit.log` corría DESPUÉS del commit, así que una excepción entre
   * ambos dejaba la config de dinero cambiada y **sin registro**. Aquí se prueba lo observable: la
   * bitácora se escribe con el cliente TRANSACCIONAL y **dentro** del callback de `$transaction`.
   */
  it('BE-GE2 — la bitácora se escribe DENTRO de la transacción, no después del commit', async () => {
    const { ctrl, prisma, audit } = wire();
    let auditDuranteTx = false;
    (prisma as any).$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const antes = (audit.log as jest.Mock).mock.calls.length;
      await fn(prisma);
      auditDuranteTx = (audit.log as jest.Mock).mock.calls.length > antes;
    });
    await ctrl.put({ minUpsidePct: 60 }, 'admin');
    expect(auditDuranteTx).toBe(true);
    // Y con el `tx` como segundo argumento: si se pasara `this.prisma`, la fila se auto-commitearía
    // fuera del alcance del rollback y el todo-o-nada sería mentira.
    expect((audit.log as jest.Mock).mock.calls[0][1]).toBeDefined();
  });

  /**
   * El `after` se COMPUTA (no se re-lee) para poder auditar dentro de la transacción. Este test es el
   * candado de esa decisión: lo devuelto por el `PUT` tiene que coincidir EXACTAMENTE con lo que un
   * `GET` posterior lee de la BD. Si algún día divergen, el operador vería una cosa y el resolver
   * usaría otra.
   */
  it('BE-GE2 — el `after` computado coincide con lo que un `GET` posterior devuelve', async () => {
    const { ctrl } = wire();
    const after = await ctrl.put(
      { minUpsidePct: 60, freshnessDays: 15, maxRawMultiple: 10, sourceStat: 'average' },
      'admin',
    );
    expect(await ctrl.get()).toEqual(after);
  });

  it('D4 — la bitácora conserva el FORENSE: `storedRaw` con el valor CORRUPTO tal cual estaba', async () => {
    const corrupta = [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 0 }]; // I2: costo 0
    const { ctrl, audit } = wire([], [], { [SettingKey.GRADING_COST_TIERS]: corrupta });
    await ctrl.put({ minUpsidePct: 60 }, 'admin');
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    // La config EFECTIVA saneada dice `[]`…
    expect(entry.before.gradingCostTiers).toEqual([]);
    // …pero el forense conserva lo que había realmente (sin él, la evidencia se perdía).
    expect(entry.before.storedRaw[SettingKey.GRADING_COST_TIERS]).toEqual(corrupta);
  });

  it('`enabled` en el body se IGNORA (el interruptor maestro se edita en M10)', async () => {
    const { ctrl, configStore } = wire();
    const after = await ctrl.put({ enabled: true, minUpsidePct: 40 }, 'admin');
    expect(after.enabled).toBe(false);
    expect(configStore.has(SettingKey.GRADED_ESTIMATES_ENABLED)).toBe(false);
  });

  it('el `PUT` de escalones es TOTAL: reemplaza el array completo', async () => {
    const { ctrl } = wire();
    const after = await ctrl.put({ gradingCostTiers: [tier(0, null, 90_000)] }, 'admin');
    expect(after.gradingCostTiers).toEqual([tier(0, null, 90_000)]);
  });

  it('criterio 104 — subir `minUpsidePct` VACÍA la vitrina AL VUELO sin tocar el precio de venta', async () => {
    const { ctrl, catalog } = wire([rawItem()], [psaRef('10', 900_000), psaRef('9', 500_000)], ON);
    const antes: any = await catalog.listCards({ page: 1, pageSize: 20, gradingHighlight: 'true' });
    expect(antes.total).toBe(1);

    await ctrl.put({ minUpsidePct: 500 }, 'admin');

    const despues: any = await catalog.listCards({ page: 1, pageSize: 20, gradingHighlight: 'true' });
    expect(despues).toMatchObject({ data: [], total: 0 }); // sin job, sin materialización
    const listado: any = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(listado.data[0].salePriceCents).toBe(100_000); // ningún precio de venta cambió
    // …y la FICHA sigue mostrando sus cifras (partición §4.38-0: el dial de curaduría no la apaga).
    const ficha: any = await catalog.getCard('ca');
    expect(ficha.gradedEstimates).toHaveLength(2);
  });
});

describe('GET /admin/pricing/graded-estimates/preview — «¿por qué no está destacada?»', () => {
  it('expone los insumos del gate por grupo raw publicado (escalón, umbral, ganancia neta)', async () => {
    const { ctrl } = wire([rawItem()], [psaRef('10', 900_000), psaRef('9', 500_000)], ON);
    const res: any = await ctrl.preview('ca');
    expect(res.cardId).toBe('ca');
    expect(res.enabled).toBe(true);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({
      representativeInventoryItemId: 'i1',
      finish: 'normal',
      salePriceCents: 100_000,
      psa10MxnCents: 900_000,
      psa9MxnCents: 500_000,
      stale: false,
      gradingCostMxnCents: 180_000,
      thresholdMxnCents: 364_000,
      netUpsidePsa9MxnCents: 220_000,
      eligible: true,
    });
    expect(res.groups[0].reason).toBeUndefined();
    expect(res.groups[0].gradingCostTier).toEqual(tier(500_000, 1_000_000, 180_000));
  });

  it('`eligible:false` viene con un `reason` accionable', async () => {
    const below = wire([rawItem()], [psaRef('10', 900_000), psaRef('9', 300_000)], ON);
    expect((await below.ctrl.preview('ca')).groups[0]).toMatchObject({
      eligible: false,
      reason: 'BELOW_MIN_UPSIDE',
    });
    const sinPsa9 = wire([rawItem()], [psaRef('10', 900_000)], ON);
    expect((await sinPsa9.ctrl.preview('ca')).groups[0]).toMatchObject({
      eligible: false,
      reason: 'NO_PSA9',
      psa9MxnCents: null, // money-safe: no resoluble = null, NUNCA 0
    });
  });

  it('MONEY-SAFE: montos no resolubles son `null`, jamás `0`', async () => {
    const { ctrl } = wire([rawItem()], [], ON);
    const g = (await ctrl.preview('ca')).groups[0];
    expect(g).toMatchObject({ reason: 'NO_PSA10', eligible: false });
    for (const k of [
      'psa10MxnCents',
      'psa9MxnCents',
      'capturedDate',
      'gradingCostTier',
      'gradingCostMxnCents',
      'thresholdMxnCents',
      'netUpsidePsa9MxnCents',
    ] as const) {
      expect(g[k]).toBeNull();
    }
  });

  it('GU-A8 — una clave PRESENTE-e-INVÁLIDA se refleja como `reason: FEATURE_OFF` (no como default silencioso)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { ctrl } = wire([rawItem()], [psaRef('10', 900_000), psaRef('9', 500_000)], {
      ...ON,
      [SettingKey.GRADING_MIN_UPSIDE_PCT]: 'mucho', // edición fuera de banda
    });
    const res: any = await ctrl.preview('ca');
    // El dial sigue `on` (el DTO no miente sobre el espejo de M10)…
    expect(res.enabled).toBe(true);
    // …y aun así NADA se destaca, con la razón accionable que exige §4.38d › Observabilidad.
    expect(res.groups[0]).toMatchObject({ eligible: false, reason: 'FEATURE_OFF' });
    // El `warn` del servidor es el que dice CUÁL clave y QUÉ invariante (el DTO no lo transporta).
    expect(warn.mock.calls.some((c) => String(c[0]).includes(SettingKey.GRADING_MIN_UPSIDE_PCT))).toBe(true);
    jest.restoreAllMocks();
  });

  it('GU-A8 — el `config` del preview conserva EXACTAMENTE la forma del contrato (sin flags internos)', async () => {
    const { ctrl } = wire([rawItem()], [], ON);
    const res: any = await ctrl.preview('ca');
    expect(Object.keys(res.config).sort()).toEqual([
      'enabled',
      'freshnessDays',
      'grades',
      'gradingCostTiers',
      'highlightGrades',
      'ingestEnabled',
      'ingestMaxCardsPerRun',
      'manualFreshnessDays',
      'maxRawMultiple',
      'minSampleCount',
      'minUpsidePct',
      'sourceStat',
    ]);
    // Lo que NO puede filtrarse: los flags INTERNOS del resolver (GU-A8 + el del ingest de v1.50.2).
    for (const interno of ['estimatesEnabled', 'highlightEnabled', 'ingestConfigInvalid']) {
      expect(res.config).not.toHaveProperty(interno);
    }
  });

  it('con el dial `off` el diagnóstico SIGUE respondiendo (reason FEATURE_OFF) y muestra la tabla vigente', async () => {
    const { ctrl } = wire([rawItem()], [psaRef('10', 900_000), psaRef('9', 500_000)]);
    const res: any = await ctrl.preview('ca');
    expect(res.enabled).toBe(false);
    expect(res.config.gradingCostTiers).toEqual(DEFAULT_GRADING_COST_TIERS);
    expect(res.groups[0]).toMatchObject({ eligible: false, reason: 'FEATURE_OFF' });
  });

  it('sin grupos raw publicados ⇒ `groups: []` (no es un error)', async () => {
    const { ctrl } = wire([], [psaRef('10', 900_000)], ON);
    expect((await ctrl.preview('ca')).groups).toEqual([]);
  });

  it('sin `cardId` ⇒ 400 VALIDATION_ERROR; carta inexistente ⇒ 404 NOT_FOUND', async () => {
    const { ctrl } = wire([rawItem()], [], ON);
    await expect(ctrl.preview(undefined)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ctrl.preview('  ')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(ctrl.preview('no-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * v1.50.3 (§4.38n, API_CONTRACT §M2) — **LISTA DE REVISIÓN** del back-office
 * (`GET /admin/pricing/graded-estimates/review`). Es el **criterio 111(e)**, que hasta este pase no
 * tenía implementación **ni estaba declarado fuera de alcance**.
 *
 * ### La deuda que cierra, y por qué no se podía declarar fuera de alcance
 * §4.38(k.3) decidió **no ocultar** en la ficha la cifra que falla la coherencia de magnitud, y esa
 * decisión se justificó **precisamente** por esta contrapartida: *«si decidimos seguir mostrándola,
 * alguien tiene que enterarse»* (§O.7, con esas palabras). Sin lista, (k.3) dejaba de ser
 * «visible-y-corregible» y pasaba a ser «visible-y-nadie-la-corrige» — **peor que ocultarla**:
 * publicamos el número malo **y** perdemos la señal. Las dos mitades se sostienen juntas o se caen
 * juntas.
 *
 * El `preview` exige `cardId`: solo contesta si **ya sospechabas**. Esto responde **«¿de qué cartas
 * debo sospechar?»**, que es la pregunta que nadie podía hacer.
 */
describe('GET /admin/pricing/graded-estimates/review — la lista de revisión (criterio 111e)', () => {
  /** Raw a MX$1,000. PSA 10 por DEBAJO del raw ⇒ `NOT_ABOVE_RAW` (el error de unidades USD/MXN). */
  const incoherente = () => wire([rawItem()], [psaRef('10', 60_000), psaRef('9', 50_000)], ON);
  /** Cifras sanas: pasa los dos gates ⇒ NO entra a la lista. */
  const sana = () => wire([rawItem()], [psaRef('10', 900_000), psaRef('9', 500_000)], ON);

  it('enumera la carta incoherente con su `reason` y la identidad legible (sin fetch por fila)', async () => {
    const { ctrl } = incoherente();
    const res = await ctrl.review();
    expect(res.total).toBe(1);
    expect(res.data[0]).toMatchObject({
      cardId: 'ca',
      cardName: 'Pikachu',
      setName: 'Surging Sparks',
      number: '1',
      reason: 'NOT_ABOVE_RAW',
      eligible: false,
      psa10MxnCents: 60_000,
      psa9MxnCents: 50_000,
    });
    expect(res.scannedCards).toBe(1);
    expect(res.truncated).toBe(false);
  });

  it('una carta SANA no entra: la lista es de incoherencias, no un volcado', async () => {
    const { ctrl } = sana();
    const res = await ctrl.review();
    expect(res.data).toEqual([]);
    expect(res.total).toBe(0);
    // `data: []` NO es un error y NO es un estado a celebrar: es «no hay nada que revisar».
    expect(res.scannedCards).toBe(1);
  });

  /**
   * §4.38n.3 — **divergencia deliberada con el `preview`, y es la decisión más importante del endpoint.**
   * El dial arranca en `off` precisamente para poder **limpiar los datos antes** de encender la
   * afirmación comercial. Una lista que solo funcionara con la feature encendida obligaría a **publicar
   * las cifras malas para poder descubrirlas** — el orden correcto de las operaciones, al revés.
   */
  it('FUNCIONA con la feature APAGADA, y `FEATURE_OFF` nunca se emite', async () => {
    const { ctrl } = wire([rawItem()], [psaRef('10', 60_000), psaRef('9', 50_000)]); // sin ON
    const res = await ctrl.review();
    expect(res.enabled).toBe(false); // el front avisa «hay cifras marcadas, pero no se publica nada»
    expect(res.total).toBe(1);
    expect(res.data[0].reason).toBe('NOT_ABOVE_RAW');
    expect(res.data.some((d) => d.reason === 'FEATURE_OFF')).toBe(false);
  });

  it('el DEFAULT son los TRES `reason` de coherencia; `SLAB_PUBLISHED` es opt-in', async () => {
    // Carta con slab PSA 10 publicado ⇒ `SLAB_PUBLISHED`. Con el default NO aparece: es la guarda
    // FUNCIONANDO, no un dato erróneo, y meterla al default ahogaría la señal que la lista existe para
    // mostrar.
    const slab = {
      ...rawItem({ id: 'i2', productType: 'graded', gradingCompany: 'PSA', gradeValue: '10', listPriceCents: 900_000 }),
    };
    const { ctrl } = wire([rawItem(), slab], [psaRef('10', 900_000), psaRef('9', 500_000)], ON);

    expect((await ctrl.review()).data).toEqual([]);
    const optIn = await ctrl.review('SLAB_PUBLISHED');
    expect(optIn.data.map((d) => d.reason)).toEqual(['SLAB_PUBLISHED']);
  });

  it.each(['NO_PSA10', 'NO_PSA9', 'NO_COST_TIER', 'BELOW_MIN_UPSIDE', 'NOT_RAW', 'NOT_PUBLISHED', 'FEATURE_OFF'])(
    '`reason=%s` ⇒ 400: es AUSENCIA de dato o el gate comercial, no una incoherencia',
    async (reason) => {
      const { ctrl } = incoherente();
      // Devolver `[]` en silencio sería peor: el operador leería «no hay nada que revisar» de una
      // consulta que nunca podía encontrar nada.
      await expect(ctrl.review(reason)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { field: 'reason' },
      });
    },
  );

  /**
   * v1.50.3-c (§4.38n.2-bis, GU-A24) — **`STALE` SALIÓ de esa lista de rechazados.**
   *
   * El arquitecto lo había agrupado con la «ausencia de dato» y **no pertenecía ahí**: `NO_PSA10`
   * significa *nunca hubo dato* (el estado normal de miles de cartas); `STALE` significa **hubo un dato,
   * alguien lo puso o lo ingestó, y expiró** — una cifra que **existe en la BD ahora mismo**, que
   * desapareció de las tres superficies **en silencio**, y que el dueño no tenía forma de encontrar para
   * refrescarla o retirarla. Agravante: la categoría la creó esta misma revisión al sembrar
   * `manualFreshnessDays = 30` (antes un manual no caducaba nunca ⇒ el conjunto era vacío).
   */
  describe('`?reason=STALE` — la cifra que EXISTE y CADUCÓ (v1.50.3-c)', () => {
    const HACE_40_DIAS = new Date(Date.now() - 40 * 86_400_000);
    /** Las dos cifras sanas del criterio 111, pero capturadas hace 40 días (seed: caducan a los 30). */
    const caducada = (over: Record<string, unknown> = {}) =>
      wire(
        [rawItem()],
        [
          { ...psaRef('10', 900_000, HACE_40_DIAS), ...over },
          { ...psaRef('9', 500_000, HACE_40_DIAS), ...over },
        ],
        ON,
      );

    it('deja de ser `400` y ENUMERA la carta caducada (era una consulta imposible)', async () => {
      const { ctrl } = caducada();
      const res = await ctrl.review('STALE');
      expect(res.total).toBe(1);
      expect(res.data[0]).toMatchObject({
        cardId: 'ca',
        cardName: 'Pikachu', // se lee sin un fetch por fila, igual que el resto de la lista
        reason: 'STALE',
        eligible: false,
        stale: true,
        // La cifra caducada se VE: es lo que el dueño necesita para decidir si la sostiene o la retira.
        psa10MxnCents: 900_000,
        psa9MxnCents: 500_000,
      });
      expect(res.data[0].capturedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('sigue FUERA del default: en el default ahogaría la señal de coherencia', async () => {
      // Mismo motivo que `SLAB_PUBLISHED`: accionable, pero no es un dato erróneo. La lista existe para
      // que la señal de incoherencia se vea, y una tienda con muchas cifras viejas la taparía.
      expect((await caducada().ctrl.review()).total).toBe(0);
    });

    it('`isManual: true` en la fila MANUAL — el remedio es RECAPTURAR (o borrar)', async () => {
      const { ctrl } = caducada();
      expect((await ctrl.review('STALE')).data[0].isManual).toBe(true);
    });

    it('`isManual: false` en la AUTOMÁTICA — el remedio es MIRAR EL INGEST, no la carta', async () => {
      // Los dos sabores de `STALE` exigen remedios OPUESTOS y `reason: STALE` a secas no los distingue;
      // sin este campo, cada fila obligaría a una segunda llamada — la fricción que la lista elimina.
      const { ctrl } = caducada({ isManualOverride: false, source: 'pokemonpricetracker' });
      const [fila] = (await ctrl.review('STALE')).data;
      expect(fila.reason).toBe('STALE');
      expect(fila.isManual).toBe(false);
    });

    it('NO publica `source`: contesta «¿la puse yo?» sin revelar la identidad del proveedor', async () => {
      const { ctrl } = caducada({ isManualOverride: false, source: 'pokemonpricetracker' });
      const [fila] = (await ctrl.review('STALE')).data;
      expect(fila).not.toHaveProperty('source');
      expect(fila).not.toHaveProperty('isManualOverride');
      expect(JSON.stringify(fila)).not.toContain('pokemonpricetracker');
    });

    it('`SLAB_PUBLISHED` y `STALE` se pueden pedir juntos (los dos opt-in conviven)', async () => {
      const { ctrl } = caducada();
      expect((await ctrl.review('SLAB_PUBLISHED,STALE')).total).toBe(1);
    });
  });

  /**
   * v1.50.3-c (§M2) — **`capturedDate` asc se INTERCALA en el orden determinista**, entre `reason` y
   * `cardId`. Con `?reason=STALE`, **lo más vencido va primero**: es el orden en que el dueño quiere
   * atacarlo (la cifra de hace 200 días miente más que la de hace 31). El orden sigue siendo TOTAL y
   * estable — los dos últimos criterios (`cardId`, representante) son únicos por construcción.
   */
  describe('orden determinista con `capturedDate` asc (v1.50.3-c)', () => {
    const CARD_B = { ...CARD, id: 'cb', name: 'Charizard' };
    const dias = (n: number) => new Date(Date.now() - n * 86_400_000);

    it('entre dos cifras caducadas, la MÁS VIEJA va primero', async () => {
      const { ctrl } = wire(
        [rawItem(), rawItem({ id: 'i2', cardId: 'cb', card: CARD_B })],
        [
          // `ca` caducó hace 40 días; `cb` hace 200. El `cardId` los ordenaría al revés (ca < cb), así
          // que este test SOLO pasa si `capturedDate` manda sobre `cardId`.
          { ...psaRef('10', 900_000, dias(40)) },
          { ...psaRef('9', 500_000, dias(40)) },
          { ...psaRef('10', 900_000, dias(200)), cardId: 'cb' },
          { ...psaRef('9', 500_000, dias(200)), cardId: 'cb' },
        ],
        ON,
      );
      const res = await ctrl.review('STALE');
      expect(res.data.map((d) => d.cardId)).toEqual(['cb', 'ca']);
    });

    it('`capturedDate: null` va al FINAL, no al principio', async () => {
      // Una fila sin fecha no es «la más vieja»: es una de la que no sabemos nada. Encabezar con ella
      // empujaría lo accionable fuera de la primera página.
      const { ctrl } = wire(
        [rawItem(), rawItem({ id: 'i2', cardId: 'cb', card: CARD_B })],
        [
          // `ca`: incoherente por unidades y SIN fecha resoluble (no hay filas ⇒ capturedDate null).
          { ...psaRef('10', 60_000, dias(1)) },
          { ...psaRef('9', 50_000, dias(1)) },
          { ...psaRef('10', 60_000, dias(1)), cardId: 'cb' },
          { ...psaRef('9', 50_000, dias(1)), cardId: 'cb' },
        ],
        ON,
      );
      const res = await ctrl.review('NOT_ABOVE_RAW');
      // Mismo `reason` y misma fecha ⇒ desempata `cardId`: el orden sigue siendo TOTAL.
      expect(res.data.map((d) => d.cardId)).toEqual(['ca', 'cb']);
    });
  });

  it('`?reason=` acepta CSV y repetido, y deduplica', async () => {
    const { ctrl } = incoherente();
    expect((await ctrl.review('NOT_ABOVE_RAW,ABOVE_MAX_MULTIPLE')).total).toBe(1);
    expect((await ctrl.review(['NOT_ABOVE_RAW', 'NOT_ABOVE_RAW'])).total).toBe(1);
    // Un `reason` válido que NO es el de esta carta ⇒ lista vacía (filtro, no error).
    expect((await ctrl.review('GRADE_ORDER_INVERTED')).total).toBe(0);
  });

  it('paginación: defaults del contrato y `400` fuera de rango (jamás un clamp silencioso)', async () => {
    const { ctrl } = incoherente();
    const res = await ctrl.review();
    expect(res).toMatchObject({ page: 1, pageSize: 25 });
    for (const bad of [['page', '0'], ['page', '1.5'], ['pageSize', '0'], ['pageSize', '101'], ['pageSize', 'x']] as const) {
      const call = bad[0] === 'page' ? ctrl.review(undefined, bad[1]) : ctrl.review(undefined, undefined, bad[1]);
      // Un `pageSize=1000` recortado a 100 sin avisar hace creer que se vio todo.
      await expect(call).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: bad[0] } });
    }
  });

  /**
   * §4.38n.3 — **«apagada» ≠ «corrupta».** El dial `off` es una DECISIÓN (se tolera); una clave
   * presente-pero-inválida es **intención perdida**. Una lista de revisión calculada contra un umbral
   * basura marcaría —o dejaría de marcar— cartas por una razón que no es la que el operador cree, justo
   * en la superficie que existe para que el operador CONFÍE en lo que ve.
   */
  it('config CORRUPTA ⇒ 409 GRADED_CONFIG_INVALID nombrando la clave, no un resultado dudoso', async () => {
    const { ctrl } = wire([rawItem()], [psaRef('10', 60_000), psaRef('9', 50_000)], {
      ...ON,
      [SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE]: 'muchísimo',
    });
    await expect(ctrl.review()).rejects.toMatchObject({
      code: 'GRADED_CONFIG_INVALID',
      status: 409,
      details: { key: SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE },
    });
  });

  /**
   * §4.38n.1 — **el coste se mide como INVARIANZA, no como un número mágico.** Un tope absoluto («≤ 4
   * queries») envejece con cualquier refactor de `fetchSellable` y acaba relajándose sin que nadie
   * piense. Lo que de verdad importa es que el conteo **NO crezca con el nº de cartas**: ésa es la
   * diferencia entre O(1) y el N+1 que §4.38(c) declara bloqueante.
   */
  it('COSTE: el nº de queries NO crece con el nº de cartas (O(1), no N+1)', async () => {
    const cardsN = (n: number) => {
      const items = Array.from({ length: n }, (_, i) => rawItem({ id: `i${i}`, cardId: `c${i}` }));
      const refs = Array.from({ length: n }, (_, i) => [
        { ...psaRef('10', 60_000), cardId: `c${i}` },
        { ...psaRef('9', 50_000), cardId: `c${i}` },
        // Referencia de mercado RAW: sin ella `fetchSellable` cae a su ruta por-pieza (el `reference`
        // del lote sale `undefined` y `toListingDTO` lo resuelve solo), que es una N+1 PREEXISTENTE de
        // esa función y no de este endpoint. Con el dato presente se mide lo que se quiere medir.
        { ...psaRef('10', 100_000), cardId: `c${i}`, productType: 'raw', gradeKey: 'raw:NM' },
      ]).flat();
      return wire(items, refs, ON);
    };
    const count = async (n: number) => {
      const { ctrl, prisma } = cardsN(n);
      await ctrl.review();
      return {
        refs: (prisma as any).priceReference.findMany.mock.calls.length,
        items: (prisma as any).inventoryItem.findMany.mock.calls.length,
      };
    };
    expect(await count(1)).toEqual(await count(25));
  });

  it('el conjunto motor son las cartas CON fila de estimado, no el catálogo', async () => {
    const { ctrl, prisma } = incoherente();
    await ctrl.review();
    const where = (prisma as any).priceReference.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ productType: 'graded', finish: 'normal', cardProductId: null });
    // Sin este recorte el endpoint sería un barrido de catálogo y no debería existir (§4.38n.1).
    expect((prisma as any).priceReference.findMany.mock.calls[0][0].distinct).toEqual(['cardId']);
  });

  it('NO escribe nada: es read-only y no toca dinero', async () => {
    const { ctrl, prisma, upsert, audit } = incoherente();
    await ctrl.review();
    expect(upsert).not.toHaveBeenCalled();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

/**
 * v1.50.3-d (§4.38q, API_CONTRACT §M2) — **BORRADO del estimado**
 * (`DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue`).
 *
 * ### El hueco que cierra
 * `PROJECT.md` §O.7 pide que el dueño pueda «corregirla con override **o descartarla**», y **descartar
 * no es pisar**: sustituir la cifra por otra deja **otra** afirmación comercial en su lugar. El
 * contrato afirmaba desde v1.46 que un override manual «solo lo revoca otro override o la
 * limpieza/borrado explícito por `super_admin`» — y ese borrado **no existía**. Con la caducidad de
 * §4.38(m) el hueco se volvió agudo: una cifra manual errónea desaparece de las tres superficies,
 * **sigue en la tabla**, es enumerable por `?reason=STALE`… y el único gesto disponible del operador
 * era **capturar otra cifra igual de indeseada**. Se construyó el detector y se dejó al operador sin
 * la herramienta.
 *
 * Cada `it` de aquí abajo es UNA de las decisiones no obvias de §4.38(q), a propósito: relajar una
 * tiene que romper su propia prueba.
 */
describe('DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue — descartar, no pisar (§4.38q)', () => {
  /** Fila de estimado con `id` (el `before` de la bitácora los registra: es el material para deshacer). */
  const ref = (gradeValue: '10' | '9', mxnCents: number, capturedDate: Date, id: string) => ({
    id,
    ...psaRef(gradeValue, mxnCents, capturedDate),
  });
  const AYER = new Date(Date.now() - 86_400_000);
  const ANTIER = new Date(Date.now() - 2 * 86_400_000);

  /** Slab PSA `grade` PUBLICADO (plataforma, `listed`) de la misma carta — el insumo de INV-D. */
  const slabItem = (grade: '10' | '9', id = 'slab1') =>
    rawItem({
      id,
      productType: 'graded',
      rawCondition: null,
      gradingCompany: 'PSA',
      gradeValue: grade,
      listPriceCents: null,
    });

  it('borra TODAS las filas de la clave, no solo la vigente (o la cifra REAPARECERÍA sola)', async () => {
    // Dos filas del MISMO grado con `capturedDate` distinta: la `@@unique` incluye la fecha, así que
    // esto es un estado NORMAL de la tabla, no un caso raro. Borrar solo la de hoy haría aflorar la de
    // ayer y el estimado volvería a la ficha — una resurrección silenciosa en superficie comercial.
    const refs = [ref('10', 900_000, new Date(), 'r-hoy'), ref('10', 800_000, AYER, 'r-ayer')];
    const { ctrl } = wire([rawItem()], refs, ON);
    expect(await ctrl.remove('ca', '10', 'admin')).toEqual({
      cardId: 'ca',
      gradeValue: '10',
      // `deletedCount` va en la respuesta para que el operador vea CUÁNTO historial se llevó y no lo
      // descubra después.
      deletedCount: 2,
    });
    expect(refs).toHaveLength(0);
  });

  it('el borrado es QUIRÚRGICO: no toca el otro grado, ni otra carta, ni las filas raw', async () => {
    const otroGrado = ref('9', 500_000, new Date(), 'r-9');
    const otraCarta = { ...ref('10', 900_000, new Date(), 'r-otra'), cardId: 'cb' };
    const rawRow = {
      ...ref('10', 100_000, new Date(), 'r-raw'),
      productType: 'raw',
      gradeKey: 'raw:NM',
    };
    const refs = [ref('10', 900_000, new Date(), 'r-10'), otroGrado, otraCarta, rawRow];
    const { ctrl } = wire([rawItem()], refs, ON);
    expect((await ctrl.remove('ca', '10', 'admin')).deletedCount).toBe(1);
    // §4.38(q.3): este endpoint NO borra `raw` ni `sealed` — ahí un borrado movería precios de venta
    // publicados y necesita su propio diseño (hueco declarado en §9, no capacidad prometida).
    expect(refs).toEqual([otroGrado, otraCarta, rawRow]);
  });

  it('nada que borrar ⇒ 404, JAMÁS un `200` con `deletedCount: 0`', async () => {
    // Mismo precedente que el `PUT` con body vacío ⇒ 422 (GU-A10b): responder éxito cuando no pasó
    // nada le haría creer al operador que limpió algo que no limpió.
    const { ctrl, audit } = wire([rawItem()], [ref('9', 500_000, new Date(), 'r-9')], ON);
    await expect(ctrl.remove('ca', '10', 'admin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Un borrado que no borró nada tampoco deja bitácora de borrado (no hubo `before` que registrar).
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('`:gradeValue` fuera de `grades` ⇒ 400, y NO se toca la tabla (ruta destructiva, clave cerrada)', async () => {
    const refs = [ref('10', 900_000, new Date(), 'r-10')];
    const { ctrl, prisma } = wire([rawItem()], refs, ON);
    for (const malo of ['8', 'graded:PSA:10', '', ' ', '10.0']) {
      await expect(ctrl.remove('ca', malo, 'admin')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { field: 'gradeValue' },
      });
    }
    expect(refs).toHaveLength(1);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('el grado se deriva a la clave CANÓNICA (`graded:PSA:N`, `normal`, `cardProductId: null`)', async () => {
    const { ctrl, prisma } = wire([rawItem()], [ref('10', 900_000, new Date(), 'r-10')], ON);
    await ctrl.remove('ca', '10', 'admin');
    // La MISMA clave con la que se leyó: borrar por una clave más ancha que la leída sería un borrado
    // a ciegas (y el `before` de la bitácora no describiría lo que se fue).
    expect((prisma as any).priceReference.deleteMany.mock.calls[0][0].where).toEqual({
      cardId: 'ca',
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      finish: 'normal',
      cardProductId: null,
    });
  });

  it('AUDITADO con `before` = las filas borradas (la ÚNICA forma de deshacer) y `after` nulo', async () => {
    const { ctrl, audit } = wire(
      [rawItem()],
      [ref('10', 900_000, new Date(), 'r-hoy'), ref('10', 800_000, ANTIER, 'r-antier')],
      ON,
    );
    await ctrl.remove('ca', '10', 'admin');
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry).toMatchObject({
      actorUserId: 'admin',
      action: 'pricing.graded_estimate.delete',
      entityType: 'PriceReference',
      entityId: 'ca',
    });
    expect(entry.before).toMatchObject({ cardId: 'ca', gradeValue: '10', deletedCount: 2 });
    // Valores Y fechas: un borrado en una tabla de dinero sin registro de qué había es inaceptable, y
    // recapturar el número que estaba es la única marcha atrás que existe.
    expect(entry.before.rows.map((r: any) => [r.id, r.priceMxnCents])).toEqual([
      ['r-hoy', 900_000],
      ['r-antier', 800_000],
    ]);
    expect(entry.before.rows.every((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(r.capturedDate))).toBe(true);
    expect(entry.before.rows.every((r: any) => r.isManualOverride === true)).toBe(true);
    // `after: null` del contrato = la columna en NULL. `Prisma.DbNull` es cómo se pide eso; el `null`
    // literal de Prisma significa «JSON null», que es otra cosa (un valor, no la ausencia de valor).
    expect(entry.after).toBe(Prisma.DbNull);
  });

  it('efecto y bitácora en la MISMA transacción (commitean o revierten juntos)', async () => {
    const { ctrl, prisma, audit } = wire([rawItem()], [ref('10', 900_000, new Date(), 'r-10')], ON);
    let auditDuranteTx = false;
    (prisma as any).$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const antes = (audit.log as jest.Mock).mock.calls.length;
      const out = await fn(prisma);
      auditDuranteTx = (audit.log as jest.Mock).mock.calls.length > antes;
      return out;
    });
    await ctrl.remove('ca', '10', 'admin');
    expect(auditDuranteTx).toBe(true);
    // Con el `tx` como 2º argumento: con `this.prisma` la fila se auto-commitearía fuera del rollback
    // y el todo-o-nada sería mentira.
    expect((audit.log as jest.Mock).mock.calls[0][1]).toBeDefined();
  });

  it('funciona con la feature APAGADA (hay que poder limpiar ANTES de encender)', async () => {
    const refs = [ref('10', 900_000, new Date(), 'r-10')];
    const { ctrl } = wire([rawItem()], refs, {}); // dial `off` (el seed fail-closed)
    expect((await ctrl.remove('ca', '10', 'admin')).deletedCount).toBe(1);
    expect(refs).toHaveLength(0);
  });

  /**
   * INV-D sobre el verbo destructivo (§4.38q.2). Con un slab PUBLICADO de ese grado la fila **ya no es
   * un estimado: es la referencia de mercado real de una pieza física**, y borrarla le quitaría el
   * sustento de precio a un slab que se está vendiendo (⇒ `PRICE_PENDING` ⇒ despublicado).
   */
  describe('guarda INV-D — `409` y DEBE dispararse', () => {
    it('con slab publicado del grado ⇒ 409 y la fila SIGUE AHÍ (no se borró «casi»)', async () => {
      const refs = [ref('10', 900_000, new Date(), 'r-10')];
      const { ctrl, prisma } = wire([rawItem(), slabItem('10')], refs, ON);
      await expect(ctrl.remove('ca', '10', 'admin')).rejects.toMatchObject({
        code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
        details: { publishedSlabCount: 1, inventoryItemIds: ['slab1'] },
      });
      expect(refs).toHaveLength(1);
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });

    /**
     * MEN-C (QA) — la guarda se REPITE dentro de la transacción. El pre-vuelo de arriba resuelve el
     * caso normal sin abrir transacción, pero por sí solo deja una ventana TOCTOU: entre esa lectura y
     * el `deleteMany` alguien puede publicar un slab de ese grado, y el borrado dejaría a una pieza
     * REAL vendiéndose sin referencia (⇒ PRICE_PENDING ⇒ despublicada). La ventana es estrecha y la
     * ruta es manual de `super_admin`, pero el precio de perderla se paga en dinero publicado.
     */
    it('MEN-C: si el slab se publica ENTRE el pre-vuelo y la transacción ⇒ 409, y la fila SIGUE AHÍ', async () => {
      const refs = [ref('10', 900_000, new Date(), 'r-10')];
      const items: any[] = [rawItem()]; // el pre-vuelo NO ve ningún slab publicado
      const { ctrl, prisma, audit } = wire(items, refs, ON);
      // La carrera, exacta: el slab aparece justo al entrar en la transacción.
      (prisma as any).$transaction.mockImplementationOnce(async (cb: any) => {
        items.push(slabItem('10'));
        return cb(prisma);
      });
      await expect(ctrl.remove('ca', '10', 'admin')).rejects.toMatchObject({
        code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
        details: { publishedSlabCount: 1, inventoryItemIds: ['slab1'] },
      });
      // El borrado se revirtió con la transacción: «casi borrado» no existe.
      expect(refs).toHaveLength(1);
      // …y el bloqueo por carrera deja el MISMO rastro que el del pre-vuelo (se escribe FUERA de la
      // transacción a propósito: dentro se habría revertido con ella y la guarda quedaría muda).
      const entry = (audit.log as jest.Mock).mock.calls.map((c) => c[0]).pop();
      expect(entry.action).toBe('pricing.graded_estimate.delete.blocked');
      expect(entry.after).toMatchObject({ code: 'GRADED_ESTIMATE_SLAB_PUBLISHED', publishedSlabCount: 1 });
    });

    /**
     * ⛔ El corolario que NO hay que deducir al revés (§4.38q.2): este `DELETE` **no** es un remedio
     * para INV-D inverso (§4.38l.3). «Busco las expuestas con `?reason=SLAB_PUBLISHED` y borro la
     * fila» es tentador y **falso**: ahí el slab ya está publicado, así que la guarda dispara — y debe
     * disparar. El remedio correcto sigue siendo **repreciar con `intent:"market"`**.
     */
    it('el intento BLOQUEADO deja rastro propio (si no, la guarda es muda por esta vía)', async () => {
      const { ctrl, audit } = wire([rawItem(), slabItem('10')], [ref('10', 900_000, new Date(), 'r')], ON);
      await expect(ctrl.remove('ca', '10', 'admin')).rejects.toMatchObject({
        code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
      });
      const entry = (audit.log as jest.Mock).mock.calls[0][0];
      // `action` PROPIA: un borrado bloqueado no es un override bloqueado, y fundirlos rompería el
      // conteo de aquél (§O.8 / criterio 112b).
      expect(entry.action).toBe('pricing.graded_estimate.delete.blocked');
      expect(entry.after).toMatchObject({
        code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
        cardId: 'ca',
        gradeValue: '10',
        publishedSlabCount: 1,
      });
    });

    it('la guarda es POR GRADO: con slab PSA 10 publicado, el PSA 9 SÍ se puede borrar', async () => {
      // El PSA 9 de esa carta sigue siendo un estimado (no hay pieza PSA 9 publicada que dependa de
      // él), así que bloquearlo sería extender la guarda a dinero que no existe.
      const refs = [ref('10', 900_000, new Date(), 'r-10'), ref('9', 500_000, new Date(), 'r-9')];
      const { ctrl } = wire([rawItem(), slabItem('10')], refs, ON);
      expect((await ctrl.remove('ca', '9', 'admin')).deletedCount).toBe(1);
      expect(refs.map((r) => r.id)).toEqual(['r-10']);
    });

    it('la guarda corre ANTES de mirar la tabla: sin fila y con slab publicado ⇒ 409, no 404', async () => {
      // Es una precondición sobre el ESTADO DEL MUNDO, no sobre el contenido de la tabla: un `404` ahí
      // invitaría a reintentar el borrado después de capturar la fila.
      const { ctrl } = wire([rawItem(), slabItem('10')], [], ON);
      await expect(ctrl.remove('ca', '10', 'admin')).rejects.toMatchObject({
        code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
      });
    });

    it('un slab NO publicado (en bóveda de cliente / retirado) no bloquea: no es dinero vivo', async () => {
      const refs = [ref('10', 900_000, new Date(), 'r-10')];
      const enCustodia = { ...slabItem('10'), ownerType: 'customer', status: 'in_custody' };
      const { ctrl } = wire([rawItem(), enCustodia], refs, ON);
      expect((await ctrl.remove('ca', '10', 'admin')).deletedCount).toBe(1);
    });
  });
});
