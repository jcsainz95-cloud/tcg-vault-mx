/**
 * dyn-graded-turns-lock.e2e-spec.ts — DYN-B27 (API_CONTRACT §DYN.4.3 v1.114.4, I-4): **un solo turno PSA vivo**, contra Postgres
 * REAL (el candado consultivo y la transacción que lo sostiene son del motor; en memoria no hay nada que medir).
 *
 *  1. Dos `ingestGradedEstimates` a la vez (dos transacciones ⇒ dos conexiones del pool), tope que alcanza para 3 sets. El
 *     proveedor de prueba RETIENE la primera petición de A hasta que B termina o pide algo (solapamiento forzado, no por suerte).
 *     ⇒ Σ `creditsCharged` del día ≤ tope, ningún set con dos filas del día, B con `already_running` y sin peticiones. N = 10.
 *  2. Relectura por `lockTx`: mientras A espera su primera respuesta aparece una fila ajena del día (la de una corrida que
 *     perdió el candado y terminó su set) ⇒ A para por presupuesto con la relectura; con el acumulado en memoria se pasaría.
 *  3. `lockTx` caducado a mitad ⇒ `lock_lost`, sin pedir otro set.
 *  4. Plazo del candado menor que el del proveedor + margen ⇒ `lock_deadline`, sin pedir otro set.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { PriceIngestService, FxSnapshot, GradedTurnTiming } from '../../src/modules/pricing/price-ingest.service';
import { PokemonPriceTrackerBulkProvider } from '../../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { PptSetMapper } from '../../src/modules/pricing/ppt-set-mapper.service';
import { SettingKey } from '../../src/modules/settings/settings.constants';
import { businessDateCdmx } from '../../src/common/graded-estimate';

const FX: FxSnapshot = { rate: 19, bufferPct: 5 };
const N = 10;
const CARDS_PER_SET = 5;
/** El proveedor de prueba cobra 2 créditos por carta del set ⇒ 10 por set; el tope alcanza para 3. */
const COST_PER_SET = 2 * CARDS_PER_SET;
const CAP = 3 * COST_PER_SET;

const EMPTY = {
  rows: [],
  fetchedRaw: 0,
  drops: [],
  requestOk: false,
  dailyLimited: false,
  dailyRemaining: null,
  escalate: null,
  sawGradedBlock: false,
  shapeCounts: { s1: 0, s2: 0 },
  probe: false,
  noRequestReason: null,
  gradedApiCallsConsumed: 0,
  forcedFormat: 'auto' as const,
};

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('DYN-B27 — turno PSA con una sola corrida viva (Postgres real)', () => {
  let h: E2EHarness;
  let ingest: PriceIngestService;
  const run = randomUUID().slice(0, 8);
  const mySets: { id: string; externalId: string }[] = [];
  let stragglerSetId: string;
  const saved = new Map<string, Prisma.JsonValue | undefined>();
  const SAVED_KEYS = [SettingKey.GRADING_HOOK_ENABLED, SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP];
  let originalTiming: GradedTurnTiming;

  /** Llamadas al proveedor con `pptSetId` (las únicas que gastan), en orden. */
  let calls: string[] = [];
  /** Retención de la primera petición: `started` cuando llega, se suelta con `release` (o al vencer `holdMs`). */
  let hold: { used: boolean; started: Deferred; release: Deferred; holdMs?: number } | null = null;

  beforeAll(async () => {
    h = await E2EHarness.create();
    ingest = h.app.get(PriceIngestService);
    originalTiming = { ...ingest.gradedTurnTiming };
    for (const key of SAVED_KEYS) saved.set(key, (await h.prisma.configSetting.findUnique({ where: { key } }))?.valueJson);
    for (const [key, value] of [
      [SettingKey.GRADING_HOOK_ENABLED, 'on'],
      [SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, CAP],
    ] as const) {
      await h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: value }, update: { valueJson: value } });
    }
    const shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    for (let s = 0; s < 5; s++) {
      const set = await h.prisma.cardSet.create({ data: { externalId: `gtl-${run}-${s}`, name: `Set Turno ${run} ${s}` } });
      mySets.push({ id: set.id, externalId: set.externalId });
      for (let c = 0; c < CARDS_PER_SET; c++) {
        const card = await h.prisma.card.create({
          data: {
            externalId: `gtl-${run}-${s}-${c}`,
            setId: set.id,
            name: `Carta Turno ${run} ${s}-${c}`,
            number: String(c + 1),
            rarity: 'Common',
            rarityCanonical: 'Common',
            availableFinishes: ['normal'],
          },
        });
        await h.prisma.inventoryItem.create({
          data: {
            folio: `GTL-${run}-${s}-${c}`,
            cardId: card.id,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'normal',
            ownerType: 'platform',
            status: 'listed',
            acquisitionType: 'compra',
            acquisitionCostCents: 1000,
            // Los más viejos del inventario: el turno los pide primero (§DYN.4.2), en este orden.
            firstListedAt: new Date(Date.UTC(2000, 0, 1 + s)),
            locationId: shelf,
          },
        });
      }
    }
    stragglerSetId = (await h.prisma.cardSet.create({ data: { externalId: `gtl-${run}-x`, name: `Set Rezagado ${run}` } })).id;

    const mine = new Map(mySets.map((s) => [s.id, `ppt-${s.externalId}`]));
    jest.spyOn(h.app.get(PptSetMapper), 'resolveForSets').mockImplementation(async (sets) => {
      return new Map(
        sets.map((s) => {
          const ppt = mine.get(s.id);
          return [s.id, ppt ? { pptSetId: ppt } : { pptSetId: null, reason: 'unmatched' as const }];
        }),
      );
    });
    jest.spyOn(h.app.get(PokemonPriceTrackerBulkProvider), 'fetchGradedEstimatesForSet').mockImplementation(async (input) => {
      if (!input.providerSetId) return { ...EMPTY, noRequestReason: 'set_without_ppt_set_id' as const };
      calls.push(input.set.externalId);
      if (hold && !hold.used) {
        hold.used = true;
        hold.started.resolve();
        if (hold.holdMs != null) await new Promise((r) => setTimeout(r, hold!.holdMs));
        else await hold.release.promise;
      } else if (hold) {
        // Otra corrida (B) pidió algo: se suelta a A ya, para que las dos peticiones queden en vuelo a la vez.
        hold.release.resolve();
      }
      return {
        ...EMPTY,
        requestOk: true,
        fetchedRaw: CARDS_PER_SET,
        sawGradedBlock: true,
        gradedApiCallsConsumed: COST_PER_SET,
      };
    });
  });

  afterAll(async () => {
    ingest.gradedTurnTiming = originalTiming;
    await clean();
    for (const key of SAVED_KEYS) {
      const v = saved.get(key);
      if (v === undefined) await h.prisma.configSetting.deleteMany({ where: { key } });
      else await h.prisma.configSetting.update({ where: { key }, data: { valueJson: v as Prisma.InputJsonValue } });
    }
    await h.close();
  });

  async function clean() {
    await h.prisma.gradedEstimateCardScan.deleteMany({});
    await h.prisma.gradedEstimateSetScan.deleteMany({});
    calls = [];
    hold = null;
  }
  const today = () => new Date(`${businessDateCdmx()}T00:00:00.000Z`);
  async function dayRows() {
    return h.prisma.gradedEstimateSetScan.findMany({ where: { businessDate: today() } });
  }
  function repeatedSets(rows: { setId: string }[]): string[] {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.setId, (seen.get(r.setId) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  }

  it(`dos corridas solapadas a la fuerza ⇒ Σ ≤ tope, ningún set dos veces, la segunda sale con already_running (${N}/${N})`, async () => {
    let ok = 0;
    const fails: string[] = [];
    const ag24 = jest.spyOn(ingest as unknown as { evaluatePsaCycleAlert: () => Promise<void> }, 'evaluatePsaCycleAlert');
    for (let i = 0; i < N; i++) {
      await clean();
      ag24.mockClear();
      hold = { used: false, started: deferred(), release: deferred() };
      const a = ingest.ingestGradedEstimates(FX);
      await hold.started.promise; // A tiene el turno y una petición en vuelo
      const b = ingest.ingestGradedEstimates(FX).finally(() => hold!.release.resolve());
      const [ra, rb] = await Promise.all([a, b]);
      const rows = await dayRows();
      const spent = rows.reduce((acc, r) => acc + r.creditsCharged, 0);
      const twice = repeatedSets(rows);
      const good =
        spent <= CAP &&
        twice.length === 0 &&
        rb.stopped === 'already_running' &&
        rb.turns === null &&
        calls.length === 3 &&
        ag24.mock.calls.length === 1 && // solo la que tiene el turno evalúa AG-24
        ra.turns?.stoppedByBudget === true;
      if (good) ok += 1;
      else fails.push(`#${i}: Σ=${spent} repetidos=${twice.length} B=${rb.stopped} peticiones=${calls.length} AG-24=${ag24.mock.calls.length}`);
    }
    ag24.mockRestore();
    // eslint-disable-next-line no-console
    console.log(`DYN-B27 solapamiento: ${ok}/${N} (backend)${fails.length ? ` · rojas: ${fails.join(' | ')}` : ''}`);
    expect(ok).toBe(N);
  });

  it('relectura por lockTx: una fila ajena del día aparecida a mitad ⇒ para por presupuesto sin pedir el siguiente set', async () => {
    await clean();
    hold = { used: false, started: deferred(), release: deferred() };
    const a = ingest.ingestGradedEstimates(FX);
    await hold.started.promise;
    // El último set de una corrida que perdió el candado: cobra 20 hoy mientras A espera su respuesta.
    await h.prisma.gradedEstimateSetScan.create({
      data: {
        setId: stragglerSetId,
        businessDate: today(),
        outcome: 'ok',
        creditsEstimated: 2 * COST_PER_SET,
        creditsMeasured: 2 * COST_PER_SET,
        creditsCharged: 2 * COST_PER_SET,
        cardsInScope: 0,
        cardsReturned: 0,
      },
    });
    hold.release.resolve();
    const ra = await a;
    const spent = (await dayRows()).reduce((acc, r) => acc + r.creditsCharged, 0);
    expect({ spent, calls: calls.length, budget: ra.turns?.stoppedByBudget }).toEqual({ spent: CAP, calls: 1, budget: true });
  });

  it('lockTx caducado a mitad ⇒ lock_lost sin pedir otro set (y sin evaluar AG-24)', async () => {
    await clean();
    ingest.gradedTurnTiming = { lockTimeoutMs: 4_000, providerTimeoutMs: 1_000, deadlineMarginMs: 0 };
    const ag24 = jest.spyOn(ingest as unknown as { evaluatePsaCycleAlert: () => Promise<void> }, 'evaluatePsaCycleAlert');
    try {
      hold = { used: false, started: deferred(), release: deferred(), holdMs: 6_000 };
      const ra = await ingest.ingestGradedEstimates(FX);
      expect(ag24).not.toHaveBeenCalled();
      const rows = await dayRows();
      expect({ lockStop: ra.turns?.lockStop, calls: calls.length, mineRows: rows.filter((r) => r.creditsCharged > 0).length }).toEqual({
        lockStop: 'lock_lost',
        calls: 1,
        mineRows: 1,
      });
    } finally {
      ag24.mockRestore();
      ingest.gradedTurnTiming = originalTiming;
    }
  }, 30_000);

  it('al candado no le alcanza para un set entero ⇒ lock_deadline sin pedir otro set', async () => {
    await clean();
    ingest.gradedTurnTiming = { lockTimeoutMs: 30_000, providerTimeoutMs: 1_000, deadlineMarginMs: 25_000 };
    try {
      hold = { used: false, started: deferred(), release: deferred(), holdMs: 6_000 };
      const ra = await ingest.ingestGradedEstimates(FX);
      expect({ lockStop: ra.turns?.lockStop, calls: calls.length, budget: ra.turns?.stoppedByBudget }).toEqual({
        lockStop: 'lock_deadline',
        calls: 1,
        budget: false,
      });
    } finally {
      ingest.gradedTurnTiming = originalTiming;
    }
  }, 60_000);
});
