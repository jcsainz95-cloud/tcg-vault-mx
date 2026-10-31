/**
 * dyn.graded-budget.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.4.6, criterio 301): `GET /admin/pricing/graded-estimates/budget`
 * — la forma EXACTA de la respuesta y cada cifra, sobre un doble en memoria con reloj inyectado. Oráculo a mano.
 */
import { GradedBudgetService } from '../src/modules/pricing/graded-budget.service';
import { SettingKey } from '../src/modules/settings/settings.constants';

const NOW = new Date('2026-12-10T18:00:00.000Z'); // 12:00 CDMX del 2026-12-10
const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function wire(opts: { env?: Record<string, string>; remaining?: number | null; config?: Record<string, unknown> } = {}) {
  const config = new Map<string, unknown>(Object.entries({ [SettingKey.GRADING_HOOK_ENABLED]: 'on', ...(opts.config ?? {}) }));
  const sets = [
    { id: 'sA', pptSetId: 'pA' },
    { id: 'sB', pptSetId: null }, // sin mapear
    { id: 'sC', pptSetId: 'pC' },
  ];
  const cards = [
    { id: 'a1', setId: 'sA' },
    { id: 'a2', setId: 'sA' },
    { id: 'b1', setId: 'sB' },
    { id: 'c1', setId: 'sC' },
  ];
  const scans = [
    // hoy: una medida (40) y una estimada (sin medición, 30)
    { setId: 'sA', businessDate: D('2026-12-10'), outcome: 'ok', creditsMeasured: 40, creditsCharged: 40, startedAt: new Date('2026-12-10T13:00:00Z') },
    { setId: 'sC', businessDate: D('2026-12-10'), outcome: 'failed', creditsMeasured: null, creditsCharged: 30, startedAt: new Date('2026-12-10T13:01:00Z') },
    // hace 6 días (entra en 7) y hace 7 (no entra)
    { setId: 'sC', businessDate: D('2026-12-04'), outcome: 'ok', creditsMeasured: 100, creditsCharged: 100, startedAt: new Date('2026-12-04T13:00:00Z') },
    { setId: 'sC', businessDate: D('2026-12-03'), outcome: 'ok', creditsMeasured: 999, creditsCharged: 999, startedAt: new Date('2026-12-03T13:00:00Z') },
  ];
  const cardScans = [
    { cardId: 'a1', lastScannedAt: new Date('2026-12-10T13:00:00Z') },
    { cardId: 'c1', lastScannedAt: new Date('2026-12-02T13:00:00Z') }, // > 7 días
  ];
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        config.has(where.key) ? { key: where.key, valueJson: config.get(where.key) } : null,
      ),
      findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((k) => config.has(k)).map((k) => ({ key: k, valueJson: config.get(k) })),
      ),
    },
    inventoryItem: {
      findMany: jest.fn(async () => [
        { cardId: 'a1' }, { cardId: 'a1' }, { cardId: 'a2' }, { cardId: 'b1' }, { cardId: 'c1' },
      ]),
    },
    card: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        cards.filter((c) => where.id.in.includes(c.id)).map((c) => ({ ...c, set: sets.find((s) => s.id === c.setId) })),
      ),
      groupBy: jest.fn(async () => [
        { setId: 'sA', _count: { _all: 100 } },
        { setId: 'sB', _count: { _all: 50 } },
        { setId: 'sC', _count: { _all: 70 } },
      ]),
    },
    gradedEstimateSetScan: {
      findMany: jest.fn(async ({ where }: { where: { outcome?: string; businessDate?: { gte: Date } } }) => {
        if (where.outcome === 'ok') {
          // última ok por set
          const seen = new Set<string>();
          return [...scans]
            .filter((s) => s.outcome === 'ok')
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
            .filter((s) => (seen.has(s.setId) ? false : (seen.add(s.setId), true)));
        }
        return scans.filter((s) => !where.businessDate || s.businessDate >= where.businessDate.gte);
      }),
    },
    gradedEstimateCardScan: {
      count: jest.fn(async ({ where }: { where: { cardId: { in: string[] }; lastScannedAt: { gte: Date } } }) =>
        cardScans.filter((c) => where.cardId.in.includes(c.cardId) && c.lastScannedAt >= where.lastScannedAt.gte).length,
      ),
    },
  };
  const env = new Map(Object.entries(opts.env ?? {}));
  const configService = { get: (k: string) => env.get(k) };
  const ppt = { dailyRemaining: () => (opts.remaining === undefined ? 1234 : opts.remaining) };
  const settings = {
    getNumber: async (k: string) => Number(config.get(k) ?? (k === SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP ? 3000 : 0)),
    getString: async (k: string) => String(config.get(k) ?? 'off'),
  };
  return new GradedBudgetService(prisma as never, settings as never, configService as never, ppt as never);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
});
afterEach(() => jest.useRealTimers());

describe('§DYN.4.6 — presupuesto PSA', () => {
  it('la forma y cada cifra', async () => {
    const svc = wire({ env: { POKEMONPRICETRACKER_DAILY_QUOTA: '20000' }, config: { [SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP]: 100 } });
    expect(await svc.budget()).toEqual({
      hookEnabled: true,
      dailyCreditCap: 100,
      creditsToday: 70,
      creditsLast7Days: 170, // 40 + 30 + 100 (el de hace 7 días no entra)
      creditsTodayAllMeasured: false, // la fila de sC cargó estimado
      providerDailyQuota: 20000,
      providerDailyRemaining: 1234,
      publishedCards: 4, // a1, a2, b1, c1 (distintas)
      cardsScannedLast7Days: 1, // a1
      cardsUnmapped: 1, // b1 (set sin pptSetId)
      weeklyCreditsNeeded: 140, // sA: medido 40 (última ok) + sC: medido 100 (última ok); sB no mapeado no cuenta
      cycleDays: 2, // ⌈140/100⌉
      capToCoverWeek: 100, // ⌈140/7/100⌉×100
    });
  });

  it('sin cuota fijada, sin lectura del proveedor y tope 0 ⇒ null donde el contrato dice null', async () => {
    const r = await wire({ remaining: null, config: { [SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP]: 0, [SettingKey.GRADING_HOOK_ENABLED]: 'off' } }).budget();
    expect(r).toMatchObject({ hookEnabled: false, providerDailyQuota: null, providerDailyRemaining: null, cycleDays: null });
  });

  it('cuota ilegible ⇒ null (no un número inventado)', async () => {
    expect((await wire({ env: { POKEMONPRICETRACKER_DAILY_QUOTA: 'mucho' } }).budget()).providerDailyQuota).toBeNull();
  });
});
