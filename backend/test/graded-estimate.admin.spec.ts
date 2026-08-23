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
 * (`GET/PUT /admin/pricing/graded-estimates` y `.../preview`; API_CONTRACT §M2, ARCHITECTURE §4.35d).
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
  const configStore = new Map<string, unknown>(Object.entries(config));
  const upsert = jest.fn(async ({ where: { key }, create, update }: any) => {
    configStore.set(key, configStore.has(key) ? update.valueJson : create.valueJson);
    return { key };
  });
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where: { key } }: any) =>
        configStore.has(key) ? { key, valueJson: configStore.get(key) } : null,
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
      grades: ['10', '9'],
      highlightGrades: ['10'],
      freshnessDays: 30,
      minUpsidePct: 30,
      gradingCostTiers: DEFAULT_GRADING_COST_TIERS,
    });
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
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'pricing.graded_estimates.update',
        entityType: 'ConfigSetting',
        before: expect.objectContaining({ minUpsidePct: 30 }),
        after: expect.objectContaining({ minUpsidePct: 60 }),
      }),
    );
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
    // …y la FICHA sigue mostrando sus cifras (partición §4.35-0: el dial de curaduría no la apaga).
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
