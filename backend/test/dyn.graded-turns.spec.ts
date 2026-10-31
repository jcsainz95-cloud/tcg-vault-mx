/**
 * dyn.graded-turns.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.4, §DYN.7): el ingest graded por TURNOS DE SET con tope de
 * créditos por día CDMX, corrido de punta a punta sobre un mundo en memoria con RELOJ INYECTADO (fake timers).
 *
 *   DYN-B9  (929)  orden del turno: 5 nunca + 5 más viejas; ninguna consultada hace < 7 días.
 *   DYN-B10 (930)  14 días, 2 corridas/día, créditos de sobra: cada set EXACTAMENTE 2 veces, separadas ≥ 7 días CDMX.
 *   DYN-B11 (931)  retirada ⇒ no se consulta; republicada a los 3 días ⇒ espera a 7; sellado y gradeadas nunca.
 *   DYN-B12 (932)  sin respuesta ⇒ `failed`, relojes intactos, reintento; sin dato ⇒ `no_data` y vuelve a 7 días.
 *   DYN-B13 (933)  tope bajo ⇒ Σ cargado del día ≤ tope; UNA fila AG-24 tras 3 corridas; subir el tope ⇒ se cierra.
 *   DYN-B14 (934)  1 200 sueltas, tope 3 000, sin tocar nada ⇒ en 7 días todas consultadas; sin corte por nº de cartas.
 * Deterministas (N=1): no hay azar ni carrera; el reloj es el del test.
 */
import { Logger } from '@nestjs/common';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PriceIngestService, FxSnapshot } from '../src/modules/pricing/price-ingest.service';
import { PokemonPriceTrackerBulkProvider } from '../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { PptSetMapper } from '../src/modules/pricing/ppt-set-mapper.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SpendAlertsService } from '../src/modules/spend-alerts/spend-alerts.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { withGradedTurns, GradedTurnsWorld } from './helpers/graded-turns-double';

const FX: FxSnapshot = { rate: 19, bufferPct: 5 };

interface Item {
  cardId: string;
  productType: 'raw' | 'graded' | 'sealed';
  status: 'listed' | 'withdrawn' | 'sold';
  firstListedAt: Date;
}

interface World {
  sets: Map<string, { id: string; externalId: string; pptSetId: string | null; catalogCards: number }>;
  cards: Map<string, { id: string; setId: string; externalId: string; number: string }>;
  items: Item[];
  config: Map<string, unknown>;
  /** sets cuyo request falla (sin respuesta). */
  failing: Set<string>;
  /** sets que responden SIN dato. */
  noData: Set<string>;
  turns: GradedTurnsWorld;
  /** llamadas al proveedor: [externalId del set, instante]. */
  calls: { set: string; at: Date }[];
  alerts: Map<string, { kind: string; facts: unknown; occurrences: number; resolvedAt: Date | null }>;
}

function newWorld(): World {
  return {
    sets: new Map(),
    cards: new Map(),
    items: [],
    config: new Map<string, unknown>([[SettingKey.GRADING_HOOK_ENABLED, 'on']]),
    failing: new Set(),
    noData: new Set(),
    turns: { setScans: [], cardScans: new Map(), catalogCards: new Map() },
    calls: [],
    alerts: new Map(),
  };
}

/** Un set con `own` cartas publicadas (raw) de `catalog` en catálogo. */
function addSet(w: World, id: string, own: number, catalog = own, firstListedAt = new Date('2026-01-01T00:00:00Z'), mapped = true) {
  w.sets.set(id, { id, externalId: `ext-${id}`, pptSetId: mapped ? `ppt-${id}` : null, catalogCards: catalog });
  w.turns.catalogCards.set(id, catalog);
  for (let i = 0; i < own; i++) {
    const cardId = `${id}-c${i}`;
    w.cards.set(cardId, { id: cardId, setId: id, externalId: `${id}-${i}`, number: String(i + 1) });
    w.items.push({ cardId, productType: 'raw', status: 'listed', firstListedAt });
  }
}

function wire(w: World) {
  const prisma = {
    configSetting: {
      findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((k) => w.config.has(k)).map((k) => ({ key: k, valueJson: w.config.get(k) })),
      ),
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        w.config.has(where.key) ? { key: where.key, valueJson: w.config.get(where.key) } : null,
      ),
    },
    inventoryItem: {
      findMany: jest.fn(async ({ where }: { where: { ownerType: string; status: string; productType: string } }) =>
        w.items
          .filter((i) => i.status === where.status && i.productType === where.productType && where.ownerType === 'platform')
          .map((i) => ({ cardId: i.cardId, firstListedAt: i.firstListedAt })),
      ),
    },
    card: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .map((id) => w.cards.get(id))
          .filter((c): c is NonNullable<typeof c> => Boolean(c))
          .map((c) => ({ ...c, set: w.sets.get(c.setId) })),
      ),
    },
  } as unknown as PrismaService;
  withGradedTurns(prisma, { world: w.turns });
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as unknown as FxService, {} as never, {} as never, {} as never);
  jest.spyOn(pricing, 'getPublishedSlabGradesBatch').mockResolvedValue(new Map());
  jest.spyOn(pricing, 'persistGradedEstimateReference').mockResolvedValue(true);
  const byPpt = () => new Map([...w.sets.values()].map((s) => [s.externalId, s]));
  const fetchGraded = jest.fn(async ({ set }: { set: { externalId: string } }) => {
    const s = byPpt().get(set.externalId)!;
    if (s.pptSetId == null) {
      return { ...EMPTY, noRequestReason: 'set_without_ppt_set_id' };
    }
    w.calls.push({ set: s.id, at: new Date() });
    if (w.failing.has(s.id)) return { ...EMPTY, requestOk: false, gradedApiCallsConsumed: null };
    const cost = 2 * s.catalogCards;
    if (w.noData.has(s.id)) return { ...EMPTY, requestOk: true, fetchedRaw: s.catalogCards, gradedApiCallsConsumed: cost };
    const rows = [...w.cards.values()]
      .filter((c) => c.setId === s.id)
      .map((c) => ({ externalId: c.externalId, number: c.number, gradeValue: '10', amountCents: 6000, currency: 'USD', count: 7 }));
    return {
      ...EMPTY,
      rows,
      requestOk: true,
      fetchedRaw: s.catalogCards,
      sawGradedBlock: true,
      shapeCounts: { s1: rows.length, s2: 0 },
      gradedApiCallsConsumed: cost,
    };
  });
  const pptBulk = { fetchGradedEstimatesForSet: fetchGraded } as unknown as PokemonPriceTrackerBulkProvider;
  const pptSetMapper = {
    resolveForSets: jest.fn(async (sets: { id: string }[]) => {
      return new Map(
        sets.map((s) => {
          const ppt = w.sets.get(s.id)?.pptSetId ?? null;
          return [s.id, ppt == null ? { pptSetId: null, reason: 'unmatched' as const } : { pptSetId: ppt }];
        }),
      );
    }),
  } as unknown as PptSetMapper;
  const spendAlerts = {
    raise: jest.fn(async (_db: unknown, input: { kind: string; dedupKey: string; facts: unknown }) => {
      const cur = w.alerts.get(input.dedupKey);
      if (cur && !cur.resolvedAt) {
        cur.occurrences += 1;
        cur.facts = input.facts;
      } else w.alerts.set(input.dedupKey, { kind: input.kind, facts: input.facts, occurrences: 1, resolvedAt: null });
      return { id: input.dedupKey, created: !cur };
    }),
    resolve: jest.fn(async (_db: unknown, key: string, now: Date) => {
      const cur = w.alerts.get(key);
      if (!cur || cur.resolvedAt) return false;
      cur.resolvedAt = now;
      w.alerts.delete(key);
      w.alerts.set(`${key}:closed:${now.getTime()}`, cur);
      return true;
    }),
  } as unknown as SpendAlertsService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const ingest = new PriceIngestService(
    prisma, settings, pricing, pptBulk, {} as never, {} as never, pptSetMapper, {} as never, undefined, audit,
    undefined, undefined, undefined, spendAlerts,
  );
  return { ingest, fetchGraded };
}

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

/** Corre el ingest a la hora `iso` (UTC). 06:00 CDMX = 12:00Z, 18:00 CDMX = 00:00Z del día siguiente. */
async function runAt(w: World, iso: string) {
  jest.setSystemTime(new Date(iso));
  const { ingest } = wire(w);
  return ingest.ingestGradedEstimates(FX);
}

/** Σ creditsCharged por día CDMX. */
function chargedByDay(w: World): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of w.turns.setScans) {
    const d = r.businessDate.toISOString().slice(0, 10);
    m.set(d, (m.get(d) ?? 0) + r.creditsCharged);
  }
  return m;
}

const dayMs = 86_400_000;
const isoPlusDays = (base: string, d: number) => new Date(new Date(base).getTime() + d * dayMs).toISOString();

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout'] });
  for (const lvl of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, lvl).mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('DYN-B9 (929) — orden del turno por colección', () => {
  it('30 colecciones de 1 carta (5 nunca, 25 con fechas distintas), créditos para 10 ⇒ 5 nunca + las 5 más viejas', async () => {
    const w = newWorld();
    const T0 = '2026-12-01T12:00:00.000Z'; // 06:00 CDMX del 2026-12-01
    for (let i = 0; i < 5; i++) addSet(w, `n${i}`, 1, 1, new Date(Date.UTC(2026, 5, 10 - i))); // n4 la más antigua
    for (let i = 0; i < 25; i++) {
      const id = `s${String(i).padStart(2, '0')}`;
      addSet(w, id, 1, 1);
      // s00 consultada hace 25 días, s24 hace 1 día
      const d = new Date(new Date(T0).getTime() - (25 - i) * dayMs);
      w.turns.setScans.push({
        id: `prev-${id}`, setId: id, businessDate: new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`), startedAt: d,
        outcome: 'ok', creditsEstimated: 2, creditsMeasured: 2, creditsCharged: 2, cardsInScope: 1, cardsReturned: 1,
      });
    }
    w.config.set(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, 20); // 10 colecciones × 2 créditos
    const res = await runAt(w, T0);
    expect(w.calls.map((c) => c.set)).toEqual(['n4', 'n3', 'n2', 'n1', 'n0', 's00', 's01', 's02', 's03', 's04']);
    expect(res.turns).toMatchObject({ stoppedByBudget: true, creditsChargedThisRun: 20 });
  });
});

describe('DYN-B10 (930) — una vez por semana, no más', () => {
  it('14 días × 2 corridas, sets de 1 y 5 cartas (+1 carta nueva el día 3): cada set 2 veces, ≥ 7 días CDMX', async () => {
    const w = newWorld();
    addSet(w, 'one', 1, 10);
    addSet(w, 'five', 5, 30);
    const START = '2026-12-01T12:00:00.000Z';
    for (let d = 0; d < 14; d++) {
      if (d === 3) {
        // una carta NUEVA del set ya consultado: espera el reloj de su set (no lo re-pide).
        w.cards.set('five-new', { id: 'five-new', setId: 'five', externalId: 'five-new', number: '99' });
        w.items.push({ cardId: 'five-new', productType: 'raw', status: 'listed', firstListedAt: new Date(isoPlusDays(START, 3)) });
      }
      await runAt(w, isoPlusDays(START, d)); // 06:00 CDMX
      await runAt(w, isoPlusDays(START, d + 0.5)); // 18:00 CDMX
    }
    for (const set of ['one', 'five']) {
      const at = w.calls.filter((c) => c.set === set).map((c) => c.at);
      expect({ set, veces: at.length }).toEqual({ set, veces: 2 });
      const days = (at[1].getTime() - at[0].getTime()) / dayMs;
      expect(days).toBeGreaterThanOrEqual(7);
    }
    // ⇒ cada suelta publicada (incluida la nueva) quedó consultada.
    for (const id of ['one-c0', 'five-c0', 'five-c4', 'five-new']) expect(w.turns.cardScans.has(id)).toBe(true);
  });
});

describe('DYN-B11 (931) — altas, bajas y lo que no entra', () => {
  it('retirada ⇒ no se consulta; republicada a los 3 días ⇒ espera a 7; sellado y gradeadas nunca', async () => {
    const w = newWorld();
    addSet(w, 'a', 1, 1);
    // colección con solo sellado y gradeada publicadas: nunca entra al alcance
    w.sets.set('sx', { id: 'sx', externalId: 'ext-sx', pptSetId: 'ppt-sx', catalogCards: 1 });
    w.cards.set('sx-c0', { id: 'sx-c0', setId: 'sx', externalId: 'sx-0', number: '1' });
    w.items.push({ cardId: 'sx-c0', productType: 'sealed', status: 'listed', firstListedAt: new Date('2026-01-01') });
    w.items.push({ cardId: 'sx-c0', productType: 'graded', status: 'listed', firstListedAt: new Date('2026-01-01') });
    const START = '2026-12-01T12:00:00.000Z';
    await runAt(w, START);
    expect(w.calls.map((c) => c.set)).toEqual(['a']);
    w.items[0].status = 'withdrawn';
    await runAt(w, isoPlusDays(START, 1));
    await runAt(w, isoPlusDays(START, 8)); // retirada: aunque esté vencida, no se pide
    expect(w.calls.map((c) => c.set)).toEqual(['a']);
    // Vuelve a estar publicada a los 3 días de su ÚLTIMA consulta: un set nuevo con la misma situación
    const w2 = newWorld();
    addSet(w2, 'b', 1, 1);
    await runAt(w2, START);
    w2.items[0].status = 'withdrawn';
    await runAt(w2, isoPlusDays(START, 1));
    w2.items[0].status = 'listed';
    await runAt(w2, isoPlusDays(START, 3));
    await runAt(w2, isoPlusDays(START, 6));
    expect(w2.calls).toHaveLength(1);
    await runAt(w2, isoPlusDays(START, 7));
    expect(w2.calls).toHaveLength(2);
    expect(w.calls.some((c) => c.set === 'sx')).toBe(false);
  });
});

describe('DYN-B12 (932) — fallos del proveedor', () => {
  it('sin respuesta ⇒ `failed`, relojes intactos, se reintenta en la siguiente corrida', async () => {
    const w = newWorld();
    addSet(w, 'f', 1, 1);
    w.failing.add('f');
    const START = '2026-12-01T12:00:00.000Z';
    await runAt(w, START);
    expect(w.turns.setScans.map((r) => r.outcome)).toEqual(['failed']);
    expect(w.turns.cardScans.size).toBe(0);
    w.failing.delete('f');
    await runAt(w, isoPlusDays(START, 0.5));
    expect(w.calls).toHaveLength(2);
    expect(w.turns.setScans.map((r) => r.outcome)).toEqual(['failed', 'ok']);
    expect(w.turns.cardScans.get('f-c0')?.lastOutcome).toBe('written');
  });

  it('el reporte dice si la fallida gastó: sin cifra del proveedor ⇒ `creditsMeasured` null y se carga el estimado', async () => {
    const w = newWorld();
    addSet(w, 'f', 1, 4);
    w.failing.add('f');
    await runAt(w, '2026-12-01T12:00:00.000Z');
    expect(w.turns.setScans[0]).toMatchObject({ outcome: 'failed', creditsMeasured: null, creditsEstimated: 8, creditsCharged: 8 });
  });

  it('sin dato ⇒ `ok` con cartas `no_data`, y la colección vuelve a los 7 días (no antes)', async () => {
    const w = newWorld();
    addSet(w, 'n', 2, 2);
    w.noData.add('n');
    const START = '2026-12-01T12:00:00.000Z';
    await runAt(w, START);
    expect(w.turns.setScans[0].outcome).toBe('ok');
    expect(w.turns.cardScans.get('n-c0')?.lastOutcome).toBe('no_data');
    await runAt(w, isoPlusDays(START, 6.5));
    expect(w.calls).toHaveLength(1);
    await runAt(w, isoPlusDays(START, 7));
    expect(w.calls).toHaveLength(2);
  });
});

describe('DYN-B13 (933, 301) — aviso cuando no alcanza', () => {
  it('tope bajo ⇒ Σ cargado del día ≤ tope; UNA fila AG-24 tras 3 corridas; subir el tope ⇒ se cierra', async () => {
    const w = newWorld();
    for (let i = 0; i < 20; i++) addSet(w, `s${String(i).padStart(2, '0')}`, 3, 50); // est 100 c/u ⇒ W = 2000/semana
    w.config.set(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, 250); // ⌈2000/250⌉ = 8 días > 7
    const START = '2026-12-01T12:00:00.000Z';
    await runAt(w, START);
    await runAt(w, isoPlusDays(START, 0.5));
    await runAt(w, isoPlusDays(START, 1));
    for (const [, total] of chargedByDay(w)) expect(total).toBeLessThanOrEqual(250);
    const open = [...w.alerts.entries()].filter(([, a]) => a.kind === 'psa_cycle_short' && !a.resolvedAt);
    expect(open).toHaveLength(1);
    expect(open[0][0]).toBe('ag24:open');
    expect(open[0][1].facts).toEqual({
      reason: 'projected', publishedCards: 60, cycleDays: 8, dailyCreditCap: 250, capToCoverWeek: 300, setsOverCap: 0,
    });
    expect(w.alerts.size).toBe(1); // ⛔ nunca una fila por corrida
    w.config.set(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, 3000);
    await runAt(w, isoPlusDays(START, 1.5));
    expect([...w.alerts.values()].every((a) => a.resolvedAt)).toBe(true);
  });
});

describe('DYN-B14 (934, 300) — un solo dial, sin captura manual', () => {
  it('1 200 sueltas en 60 colecciones, tope 3 000, 2 corridas/día: en 7 días TODAS consultadas', async () => {
    const w = newWorld();
    for (let i = 0; i < 60; i++) addSet(w, `k${String(i).padStart(2, '0')}`, 20, 150); // est 300 ⇒ W = 18 000/semana
    w.config.set(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, 3000);
    const START = '2026-12-01T12:00:00.000Z';
    for (let d = 0; d < 7; d++) {
      await runAt(w, isoPlusDays(START, d));
      await runAt(w, isoPlusDays(START, d + 0.5));
    }
    expect(w.turns.cardScans.size).toBe(1200);
    for (const [, total] of chargedByDay(w)) expect(total).toBeLessThanOrEqual(3000);
  });
});

describe('DYN-B21 (§DYN.4.5, errata v1.113.2) — «vencido > 8 días» cuenta desde que hay turnos, no desde la llegada', () => {
  const START = '2026-12-01T12:00:00.000Z'; // 06:00 CDMX
  const openAg24 = (w: World) => [...w.alerts.entries()].filter(([, a]) => a.kind === 'psa_cycle_short' && !a.resolvedAt);
  const sixtyDaysAgo = new Date(new Date(START).getTime() - 60 * dayMs);

  it('día del despliegue: 20 sets nunca consultados con `firstListedAt` de hace 60 días y tope que alcanza ⇒ SIN AG-24', async () => {
    const w = newWorld();
    for (let i = 0; i < 20; i++) addSet(w, `d${String(i).padStart(2, '0')}`, 1, 1, sixtyDaysAgo);
    w.config.set(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, 3000);
    w.failing.add('d00'); // ni uno que falla abre el día 0: su edad cuenta desde el inicio de los turnos (hoy)
    await runAt(w, START);
    expect(openAg24(w)).toHaveLength(0);
  });

  it('día 9 con un set aún sin `ok` ⇒ `overdue` (el día 8 todavía no)', async () => {
    const w = newWorld();
    for (let i = 0; i < 20; i++) addSet(w, `d${String(i).padStart(2, '0')}`, 1, 1, sixtyDaysAgo);
    w.config.set(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, 3000);
    w.failing.add('d00'); // pide y falla cada corrida: nunca tiene `ok`
    await runAt(w, START);
    await runAt(w, isoPlusDays(START, 8));
    expect(openAg24(w)).toHaveLength(0); // edad 8: todavía no (> 8)
    await runAt(w, isoPlusDays(START, 9));
    const open = openAg24(w);
    expect(open).toHaveLength(1);
    expect((open[0][1].facts as { reason: string }).reason).toBe('overdue');
  });

  it('set con su última `ok` de hace 9 días (y la de hoy falla) ⇒ `overdue`', async () => {
    const w = newWorld();
    addSet(w, 'v', 1, 1, sixtyDaysAgo);
    const nineAgo = new Date(new Date(START).getTime() - 9 * dayMs);
    w.turns.setScans.push({
      id: 'prev-v', setId: 'v', businessDate: new Date(`${nineAgo.toISOString().slice(0, 10)}T00:00:00.000Z`), startedAt: nineAgo,
      outcome: 'ok', creditsEstimated: 2, creditsMeasured: 2, creditsCharged: 2, cardsInScope: 1, cardsReturned: 1,
    });
    w.config.set(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP, 3000);
    w.failing.add('v');
    await runAt(w, START);
    const open = openAg24(w);
    expect(open).toHaveLength(1);
    expect((open[0][1].facts as { reason: string }).reason).toBe('overdue');
  });
});
