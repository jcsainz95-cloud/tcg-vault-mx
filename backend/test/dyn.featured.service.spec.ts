/**
 * dyn.featured.service.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.2): `FeaturedService` (tic diario, lectura, disparo manual
 * y salud) sobre un doble EN MEMORIA de `FeaturedSelection` y un catálogo falso, con RELOJ INYECTADO (fake timers).
 *
 *   DYN-B2 (921)  N = 10 inventarios × 10 días: ningún par de días seguidos con las mismas 8; ≥ 30 distintas en `pool`.
 *   DYN-B3 (922)  todas las lecturas entre effectiveFrom y +23:59 ⇒ cuerpo idéntico; al effectiveFrom siguiente, otro.
 *   DYN-B5 (924)  vender una destacada de 1 unidad ⇒ sale, las demás en su orden, sin relleno.
 *   DYN-B6 (925)  0 elegibles ⇒ `data: []` (selección vacía escrita, no fallo).
 *   DYN-B7 (926)  cambiar un dial NO cambia la selección vigente; la siguiente cumple.
 *   DYN-B8 (927)  cálculo forzado a fallar ⇒ se sirve la anterior menos lo vendido, salud `stale`, y ≠ las N más caras.
 * Las piezas de catálogo (qué es candidato, P, render del grupo) las prueba la integración contra Postgres.
 */
import { Logger } from '@nestjs/common';
import { FeaturedService, FEATURED_ROTATION_LOCK_KEY } from '../src/modules/catalog/featured.service';
import { FeaturedCandidate, featuredKeyOf } from '../src/modules/catalog/featured-selection';
import { SettingKey } from '../src/modules/settings/settings.constants';

type Sel = {
  businessDate: Date;
  effectiveFrom: Date;
  computedAt: Date;
  seed: string;
  dials: unknown;
  poolCount: number;
  newArrivalCandidates: number;
  forcedByUserId: string | null;
  items: { businessDate: Date; position: number; slotKind: 'pool' | 'new_arrival'; cardId: string; productType: string; gradeKey: string; finish: string }[];
};

interface World {
  sels: Map<string, Sel>;
  cands: FeaturedCandidate[];
  /** stock vivo por llave K (0 ⇒ vendido/apartado). */
  stock: Map<string, number>;
  config: Map<string, number>;
  failCompute: boolean;
}

function cand(i: number, price: number, first: Date | null = new Date('2026-01-01T00:00:00Z')): FeaturedCandidate {
  return { cardId: `c${String(i).padStart(3, '0')}`, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceCents: price, firstListedAt: first };
}

function newWorld(n = 100, seedPrice = 0): World {
  const cands = Array.from({ length: n }, (_, i) => cand(i, 1000 + ((i * 7919 + seedPrice) % 5000)));
  return { sels: new Map(), cands, stock: new Map(cands.map((c) => [featuredKeyOf(c), 1])), config: new Map(), failCompute: false };
}

function wire(w: World) {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const fs = {
    findFirst: jest.fn(async ({ where }: { where?: { effectiveFrom?: { lte: Date } } } = {}) => {
      const all = [...w.sels.values()]
        .filter((s) => !where?.effectiveFrom || s.effectiveFrom <= where.effectiveFrom.lte)
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
      return all[0] ? { ...all[0], items: [...all[0].items].sort((a, b) => a.position - b.position) } : null;
    }),
    findUnique: jest.fn(async ({ where }: { where: { businessDate: Date } }) => {
      const s = w.sels.get(ymd(where.businessDate));
      return s ? { ...s, items: [...s.items] } : null;
    }),
    create: jest.fn(async ({ data }: { data: Omit<Sel, 'items' | 'computedAt'> & { items: { create: Omit<Sel['items'][number], 'businessDate'>[] } } }) => {
      const key = ymd(data.businessDate);
      if (w.sels.has(key)) throw Object.assign(new Error('P2002'), { code: 'P2002' });
      const { items, ...rest } = data;
      w.sels.set(key, {
        ...rest,
        forcedByUserId: rest.forcedByUserId ?? null,
        computedAt: new Date(),
        items: items.create.map((i) => ({ ...i, businessDate: data.businessDate })),
      });
      return { businessDate: data.businessDate };
    }),
    delete: jest.fn(async ({ where }: { where: { businessDate: Date } }) => {
      w.sels.delete(ymd(where.businessDate));
    }),
  };
  const prisma: Record<string, unknown> = {
    featuredSelection: fs,
    configSetting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        w.config.has(where.key) ? { key: where.key, valueJson: w.config.get(where.key) } : null,
      ),
    },
  };
  const lockCalls: unknown[] = [];
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) =>
    fn({
      ...prisma,
      $queryRaw: jest.fn(async (...args: unknown[]) => {
        lockCalls.push(args);
        return [{ locked: true }];
      }),
    }),
  );
  const catalog = {
    featuredCandidates: jest.fn(async () => {
      if (w.failCompute) throw new Error('cálculo forzado a fallar');
      return w.cands.filter((c) => (w.stock.get(featuredKeyOf(c)) ?? 0) > 0);
    }),
    featuredGroups: jest.fn(async (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
      const m = new Map<string, unknown>();
      for (const k of keys) {
        const key = featuredKeyOf(k as never);
        const stock = w.stock.get(key) ?? 0;
        if (stock > 0) m.set(key, { representativeInventoryItemId: key, card: { id: k.cardId }, stockCount: stock });
      }
      return m;
    }),
  };
  const settingsDouble = {
    getNumber: jest.fn(async (k: string) => {
      const defaults: Record<string, number> = {
        [SettingKey.FEATURED_POOL_SIZE]: 60,
        [SettingKey.FEATURED_RANDOM_SLOTS]: 8,
        [SettingKey.FEATURED_NEW_ARRIVAL_SLOTS]: 2,
        [SettingKey.FEATURED_NEW_ARRIVAL_WINDOW_DAYS]: 7,
        [SettingKey.FEATURED_ROTATION_HOUR]: 6,
      };
      return w.config.get(k) ?? defaults[k];
    }),
  };
  const svc = new FeaturedService(prisma as never, catalog as never, settingsDouble as never);
  return { svc, catalog, lockCalls };
}

const at = (iso: string) => jest.setSystemTime(new Date(iso));
/** 06:00 CDMX (UTC-6) del día `d` de diciembre 2026. */
const six = (d: number) => `2026-12-${String(d).padStart(2, '0')}T12:00:00.000Z`;
/** el tic de las 05:45 CDMX (H − 15 min): el primero que puede escribir el día. */
const tickBefore = (d: number) => new Date(new Date(six(d)).getTime() - 15 * 60_000).toISOString();

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout'] });
  for (const lvl of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, lvl).mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function dayCycle(w: World, d: number) {
  const { svc } = wire(w);
  at(tickBefore(d));
  await svc.tick();
  at(six(d));
  return (await svc.read()).data;
}

describe('§DYN.2.3 — el tic', () => {
  it('antes de H − 15 min no escribe (espera al precio del día); a H − 15 escribe la de D; repetirlo no reescribe', async () => {
    const w = newWorld();
    const { svc, lockCalls } = wire(w);
    at(new Date(new Date(six(2)).getTime() - 20 * 60_000).toISOString());
    expect((await svc.tick()).status).toBe('waiting');
    expect(w.sels.size).toBe(0);
    at(tickBefore(2));
    expect((await svc.tick()).status).toBe('written');
    expect([...w.sels.keys()]).toEqual(['2026-12-02']);
    const first = w.sels.get('2026-12-02')!.seed;
    expect((await svc.tick()).status).toBe('exists');
    expect(w.sels.get('2026-12-02')!.seed).toBe(first);
    expect(w.sels.get('2026-12-02')!.effectiveFrom.toISOString()).toBe(six(2));
    expect(w.sels.get('2026-12-02')!.dials).toEqual({ poolSize: 60, randomSlots: 8, newArrivalSlots: 2, windowDays: 7, rotationHour: 6 });
    expect(JSON.stringify(lockCalls)).toContain(String(FEATURED_ROTATION_LOCK_KEY));
  });
});

describe('DYN-B2 (921) — de verdad cambia (N = 10 inventarios)', () => {
  it('10 días por inventario: ningún par de días seguidos con las mismas 8 y ≥ 30 distintas en `pool`', async () => {
    const results: boolean[] = [];
    for (let inv = 0; inv < 10; inv++) {
      const w = newWorld(100, inv * 131);
      const days: string[][] = [];
      for (let d = 1; d <= 10; d++) {
        await dayCycle(w, d);
        days.push(w.sels.get(`2026-12-${String(d).padStart(2, '0')}`)!.items.filter((i) => i.slotKind === 'pool').map((i) => i.cardId).sort());
      }
      const consecutiveSame = days.slice(1).some((d, i) => d.join() === days[i].join());
      const distinct = new Set(days.flat()).size;
      results.push(!consecutiveSame && distinct >= 30);
    }
    // Proporción reportada (O-3): se espera 10/10.
    expect(`${results.filter(Boolean).length}/${results.length}`).toBe('10/10');
  });
});

describe('DYN-B3 (922, I-2) — igual para todos todo el día', () => {
  it('lecturas de 06:00 a 05:59 del día siguiente ⇒ cuerpo idéntico; a las 06:00 siguientes, otro', async () => {
    const w = newWorld();
    const { svc } = wire(w);
    at(tickBefore(5));
    await svc.tick();
    const bodies: string[] = [];
    for (let m = 0; m < 24 * 60; m += 72) {
      at(new Date(new Date(six(5)).getTime() + m * 60_000).toISOString());
      bodies.push(JSON.stringify(await svc.read()));
    }
    at(new Date(new Date(six(6)).getTime() - 60_000).toISOString());
    bodies.push(JSON.stringify(await svc.read()));
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]).businessDate).toBe('2026-12-05');
    // la lectura no recibe NADA del visitante: no hay parámetro por el que pudiera variar
    expect(svc.read.length).toBe(0);
    at(tickBefore(6));
    await svc.tick();
    at(six(6));
    const next = await svc.read();
    expect(next.businessDate).toBe('2026-12-06');
    expect(JSON.stringify(next)).not.toBe(bodies[0]);
  });
});

describe('DYN-B5 (924) — venta durante el día', () => {
  it('vender una de 1 unidad ⇒ sale; las otras en su orden; no se rellena. De 2 unidades, vender 1 no la quita', async () => {
    const w = newWorld();
    const before = await dayCycle(w, 3);
    expect(before).toHaveLength(10);
    const keys = before.map((x) => (x as { representativeInventoryItemId: string }).representativeInventoryItemId);
    w.stock.set(keys[3], 0); // vendida
    w.stock.set(keys[6], 2); // dos unidades…
    w.stock.set(keys[6], 1); // …vende una
    const { svc } = wire(w);
    const after = (await svc.read()).data.map((x) => (x as { representativeInventoryItemId: string }).representativeInventoryItemId);
    expect(after).toEqual(keys.filter((_, i) => i !== 3));
    // al día siguiente hay 10 otra vez
    expect(await dayCycle(w, 4)).toHaveLength(10);
  });
});

describe('DYN-B6 (925) — inventario chico', () => {
  it('5 elegibles ⇒ 5 sin repetir; 0 ⇒ `data: []` con la selección vacía escrita', async () => {
    const w5 = newWorld(5);
    const d5 = await dayCycle(w5, 2);
    expect(d5).toHaveLength(5);
    const w0 = newWorld(0);
    const { svc } = wire(w0);
    at(tickBefore(2));
    expect((await svc.tick()).status).toBe('written');
    at(six(2));
    expect(await svc.read()).toEqual({ businessDate: '2026-12-02', data: [] });
  });
});

describe('DYN-B7 (926) — los diales rigen la SIGUIENTE selección', () => {
  it('azar 8 → 6 y recién llegadas 2 → 0 a media mañana: hoy sigue con 10; mañana con 6', async () => {
    const w = newWorld();
    expect(await dayCycle(w, 7)).toHaveLength(10);
    w.config.set(SettingKey.FEATURED_RANDOM_SLOTS, 6);
    w.config.set(SettingKey.FEATURED_NEW_ARRIVAL_SLOTS, 0);
    const { svc } = wire(w);
    at(new Date(new Date(six(7)).getTime() + 3 * 3600_000).toISOString());
    expect((await svc.read()).data).toHaveLength(10);
    expect(await dayCycle(w, 8)).toHaveLength(6);
  });

  it('la hora 06:00 → 07:00: el día siguiente cambia a las 07:00 CDMX, no antes', async () => {
    const w = newWorld();
    await dayCycle(w, 10);
    w.config.set(SettingKey.FEATURED_ROTATION_HOUR, 7);
    const { svc } = wire(w);
    at(new Date(new Date(six(11)).getTime() - 15 * 60_000).toISOString()); // 05:45 del 11: con H=7 el día de portada aún es el 10
    expect(await svc.tick()).toEqual({ status: 'exists', businessDate: '2026-12-10' });
    expect(w.sels.has('2026-12-11')).toBe(false);
    at(new Date(new Date(six(11)).getTime() + 45 * 60_000).toISOString()); // 06:45 = H−15 con H=7
    expect((await svc.tick()).status).toBe('written');
    at(new Date(new Date(six(11)).getTime() + 30 * 60_000).toISOString()); // 06:30 del 11: aún sirve el 10
    expect((await svc.read()).businessDate).toBe('2026-12-10');
    at(new Date(new Date(six(11)).getTime() + 60 * 60_000).toISOString()); // 07:00
    expect((await svc.read()).businessDate).toBe('2026-12-11');
  });
});

describe('DYN-B8 (927, I-1) — si el cambio diario falla', () => {
  it('se sirve la anterior menos lo vendido, la salud dice `stale`, y NO son las N más caras', async () => {
    const w = newWorld();
    const ayer = await dayCycle(w, 12);
    expect(ayer).toHaveLength(10);
    const ayerKeys = ayer.map((x) => (x as { representativeInventoryItemId: string }).representativeInventoryItemId);
    w.stock.set(ayerKeys[0], 0);
    w.failCompute = true;
    const { svc } = wire(w);
    at(tickBefore(13));
    expect((await svc.tick()).status).toBe('failed');
    at(new Date(new Date(six(13)).getTime() + 20 * 60_000).toISOString());
    const hoy = await svc.read();
    expect(hoy.businessDate).toBe('2026-12-12');
    const hoyKeys = hoy.data.map((x) => (x as { representativeInventoryItemId: string }).representativeInventoryItemId);
    expect(hoyKeys).toEqual(ayerKeys.slice(1));
    const topN = [...w.cands]
      .filter((c) => (w.stock.get(featuredKeyOf(c)) ?? 0) > 0)
      .sort((a, b) => b.priceCents - a.priceCents)
      .slice(0, hoyKeys.length)
      .map(featuredKeyOf);
    expect(hoyKeys).not.toEqual(topN);
    expect(await svc.health()).toEqual({ status: 'stale', servingBusinessDate: '2026-12-12', expectedBusinessDate: '2026-12-13' });
  });

  it('sin ninguna selección escrita ⇒ `data: []` y salud `never` (nunca «las más caras»)', async () => {
    const w = newWorld();
    w.failCompute = true;
    const { svc } = wire(w);
    at(tickBefore(14));
    await svc.tick();
    at(six(14));
    expect(await svc.read()).toEqual({ businessDate: null, data: [] });
    expect((await svc.health()).status).toBe('never');
  });

  it('salud `ok` cuando se sirve el día esperado, y dentro de los 15 min de gracia tras H', async () => {
    const w = newWorld();
    await dayCycle(w, 15);
    const { svc } = wire(w);
    expect((await svc.health()).status).toBe('ok');
    w.failCompute = true;
    at(new Date(new Date(six(16)).getTime() + 10 * 60_000).toISOString());
    expect((await svc.health()).status).toBe('ok');
  });
});

describe('§DYN.2.4 — disparo manual', () => {
  it('`force` rehace la selección del día que se SIRVE (semilla nueva, diales vigentes, forcedByUserId)', async () => {
    const w = newWorld();
    await dayCycle(w, 20);
    const old = w.sels.get('2026-12-20')!;
    w.config.set(SettingKey.FEATURED_RANDOM_SLOTS, 6);
    const { svc } = wire(w);
    at(new Date(new Date(six(20)).getTime() + 3600_000).toISOString());
    const r = await svc.force('admin-1');
    const now = w.sels.get('2026-12-20')!;
    expect(now.seed).not.toBe(old.seed);
    expect(now.forcedByUserId).toBe('admin-1');
    expect(now.effectiveFrom.toISOString()).toBe(old.effectiveFrom.toISOString());
    expect(now.items).toHaveLength(8);
    expect(r.before?.seed).toBe(old.seed);
    expect(r.after.seed).toBe(now.seed);
  });
});
