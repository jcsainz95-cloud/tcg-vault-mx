import { Logger } from '@nestjs/common';
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
    priceReference: { findMany: jest.fn(async (args: any) => refs.filter((r) => matchWhere(r, args.where))) },
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
      manualFreshnessDays: null,
      maxRawMultiple: 50,
      minSampleCount: 3,
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

  it('criterio 86 — subir `minUpsidePct` VACÍA la vitrina AL VUELO sin tocar el precio de venta', async () => {
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
