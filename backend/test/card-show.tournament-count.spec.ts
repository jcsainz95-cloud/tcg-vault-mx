import { CardShowSignupStatus } from '@prisma/client';
import { MemoryCardShowCounterStore } from '../src/modules/card-show/card-show-counter.store';
import { CardShowThrottleService } from '../src/modules/card-show/card-show-throttle.service';
import {
  CardShowTournamentCountService,
  TOURNAMENT_COUNT_CACHE_TTL_MS,
} from '../src/modules/card-show/card-show-tournament-count.service';
import { CardShowController } from '../src/modules/card-show/card-show.controller';
import { TOURNAMENT_OCCUPIED_STATUSES } from '../src/modules/card-show/tournament.util';

/**
 * ⭐M-90 — `GET /card-show/tournament/count` (API_CONTRACT §CARDSHOW.12-bis), criterios §13 [M-90] (3)(4)(5)(7)
 * a nivel unitario (reloj simulado). El recorrido HTTP contra Postgres real vive en
 * `test/integration/card-show-contract.e2e-spec.ts` bloque F.
 */
type Row = { day: 'sat' | 'sun'; _count: { _all: number } };

function makeSvc(opts: { rows?: Row[]; cap?: number | null } = {}) {
  const state = { rows: opts.rows ?? [], cap: opts.cap === undefined ? 64 : opts.cap, fail: false, calls: 0, lastArgs: undefined as unknown };
  const prisma = {
    cardShowPlayerSignup: {
      groupBy: jest.fn(async (args: unknown) => {
        state.calls += 1;
        state.lastArgs = args;
        if (state.fail) throw new Error('db down');
        return state.rows;
      }),
    },
  };
  const cardShow = { tournamentCap: () => state.cap };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new CardShowTournamentCountService(prisma as any, cardShow as any);
  return { svc, state };
}

const T0 = 1_760_000_000_000;

describe('CARDSHOW · M-90 contador público del torneo (§CARDSHOW.12-bis)', () => {
  it('ocupados = confirmed + checked_in (la MISMA lista que la reserva de cupo, D-CS-8)', () => {
    expect([...TOURNAMENT_OCCUPIED_STATUSES].sort()).toEqual([CardShowSignupStatus.checked_in, CardShowSignupStatus.confirmed].sort());
  });

  it('(3) consulta solo pokemon + ocupados; ambos días siempre, en orden sat,sun (0 si no hay filas)', async () => {
    const { svc, state } = makeSvc({ rows: [{ day: 'sun', _count: { _all: 3 } }] });
    const r = await svc.get(T0);
    expect(state.lastArgs).toEqual({
      by: ['day'],
      where: { game: 'pokemon', status: { in: ['confirmed', 'checked_in'] } },
      _count: { _all: true },
    });
    expect(r).toEqual({
      game: 'pokemon',
      days: [
        { day: 'sat', confirmed: 0, cap: 64, full: false },
        { day: 'sun', confirmed: 3, cap: 64, full: false },
      ],
      asOf: new Date(T0).toISOString(),
    });
  });

  it('(4) 0 PII: las únicas claves son game/days/asOf y day/confirmed/cap/full', async () => {
    const { svc } = makeSvc({ rows: [{ day: 'sat', _count: { _all: 2 } }] });
    const r = await svc.get(T0);
    expect(Object.keys(r!).sort()).toEqual(['asOf', 'days', 'game']);
    for (const d of r!.days) expect(Object.keys(d).sort()).toEqual(['cap', 'confirmed', 'day', 'full']);
    expect(JSON.stringify(r)).not.toMatch(/playerName|playerId|email|"id"/);
  });

  it('(5) cap=2 con 2 ocupados ⇒ full=true; cap=null (variable vacía) ⇒ full=false siempre', async () => {
    const full = makeSvc({ rows: [{ day: 'sat', _count: { _all: 2 } }, { day: 'sun', _count: { _all: 1 } }], cap: 2 });
    const r1 = await full.svc.get(T0);
    expect(r1!.days).toEqual([
      { day: 'sat', confirmed: 2, cap: 2, full: true },
      { day: 'sun', confirmed: 1, cap: 2, full: false },
    ]);
    const unknown = makeSvc({ rows: [{ day: 'sat', _count: { _all: 500 } }], cap: null });
    const r2 = await unknown.svc.get(T0);
    expect(r2!.days[0]).toEqual({ day: 'sat', confirmed: 500, cap: null, full: false });
  });

  it('(7) caché 30 s con reloj simulado: el cambio NO aparece antes de expirar y SÍ al expirar', async () => {
    const { svc, state } = makeSvc({ rows: [{ day: 'sat', _count: { _all: 1 } }] });
    expect((await svc.get(T0))!.days[0].confirmed).toBe(1);
    state.rows = [{ day: 'sat', _count: { _all: 2 } }]; // se confirmó una fila
    expect((await svc.get(T0 + TOURNAMENT_COUNT_CACHE_TTL_MS - 1))!.days[0].confirmed).toBe(1);
    expect(state.calls).toBe(1);
    const after = await svc.get(T0 + TOURNAMENT_COUNT_CACHE_TTL_MS);
    expect(after!.days[0].confirmed).toBe(2);
    expect(after!.asOf).toBe(new Date(T0 + TOURNAMENT_COUNT_CACHE_TTL_MS).toISOString());
    expect(TOURNAMENT_COUNT_CACHE_TTL_MS).toBe(30_000);
  });

  it('BD caída SIN caché ⇒ null (503); con caché < 60 s ⇒ el último valor; ≥ 60 s ⇒ null', async () => {
    const cold = makeSvc();
    cold.state.fail = true;
    expect(await cold.svc.get(T0)).toBeNull();

    const warm = makeSvc({ rows: [{ day: 'sat', _count: { _all: 4 } }] });
    await warm.svc.get(T0);
    warm.state.fail = true;
    expect((await warm.svc.get(T0 + 45_000))!.days[0].confirmed).toBe(4);
    expect(await warm.svc.get(T0 + 60_000)).toBeNull();
  });
});

describe('CARDSHOW · M-90 rate limit de /tournament/count (60/min por IP)', () => {
  it('(7) 61 GET/60 s desde 1 IP ⇒ 429 en la 61.ª con Retry-After entero ≥ 1, y 0 efecto en los topes de POST', async () => {
    let now = T0;
    const store = new MemoryCardShowCounterStore(() => now);
    const svc = new CardShowThrottleService(store);
    const results = [];
    for (let i = 0; i < 61; i += 1) results.push(await svc.hitTournamentCount('203.0.113.7'));
    expect(results.slice(0, 60).every((r) => r.allowed)).toBe(true);
    expect(results[60].allowed).toBe(false);
    expect(Number.isInteger(results[60].retryAfterSeconds)).toBe(true);
    expect(results[60].retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // ⛔ no consume los topes de POST ni el global de 60/min de los POST
    expect(await store.count('t:players:m:203.0.113.7')).toBe(0);
    expect(await store.count('t:leads:m:203.0.113.7')).toBe(0);
    expect(await store.count('t:global:m')).toBe(0);
    expect((await svc.hitPost('players', '203.0.113.7')).allowed).toBe(true);
    now += 60_000;
    expect((await svc.hitTournamentCount('203.0.113.7')).allowed).toBe(true);
  });
});

describe('CARDSHOW · M-90 controlador GET /tournament/count', () => {
  const fakeRes = () => {
    const headers: Record<string, string> = {};
    let status = 200;
    return {
      headers,
      get status() {
        return status;
      },
      res: {
        setHeader: (k: string, v: string) => {
          headers[k.toLowerCase()] = v;
        },
        status: (s: number) => {
          status = s;
        },
      },
    };
  };
  const build = (value: unknown, allowed = true) => {
    const throttle = { hitTournamentCount: jest.fn(async () => ({ allowed, retryAfterSeconds: 17 })) };
    const count = { get: jest.fn(async () => value) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new CardShowController({} as any, throttle as any, {} as any, {} as any, count as any);
  };
  const req = { ip: '203.0.113.9' };

  it('(4) 200 con Cache-Control: public, max-age=30 y ⛔ sin Set-Cookie', async () => {
    const body = { game: 'pokemon', days: [], asOf: 'x' };
    const f = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await build(body).tournamentCountGet(req as any, f.res as any);
    expect(out).toBe(body);
    expect(f.status).toBe(200);
    expect(f.headers['cache-control']).toBe('public, max-age=30');
    expect(f.headers['set-cookie']).toBeUndefined();
  });

  it('servicio sin valor ⇒ 503 { ok:false } con no-store (⛔ nunca un número inventado)', async () => {
    const f = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await build(null).tournamentCountGet(req as any, f.res as any);
    expect(out).toEqual({ ok: false });
    expect(f.status).toBe(503);
    expect(f.headers['cache-control']).toBe('no-store');
  });

  it('throttle excedido ⇒ 429 RATE_LIMITED con Retry-After', async () => {
    const f = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(build({}, false).tournamentCountGet(req as any, f.res as any)).rejects.toMatchObject({ status: 429 });
    expect(f.headers['retry-after']).toBe('17');
  });
});
