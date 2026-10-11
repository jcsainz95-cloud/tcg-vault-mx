/**
 * 💰 §AN (API_CONTRACT §15) — las piezas PURAS de la analítica de ventas: periodo y cubos (`sales-period.ts`), cifras,
 * `Delta`, reparto por peso y pesos del CSV (`sales-figures.ts`). Deterministas (N=1, dicho así).
 * Las pruebas contra Postgres (cuadres con M7, R-2/R-3, lo más vendido, clientes, 403, CSV, 08:00) viven en
 * `test/integration/sales-analytics.e2e-spec.ts`.
 */
import { BusinessException } from '../src/common/business.exception';
import {
  bucketsOf,
  isoWeekday,
  mxHour,
  resolvePeriod,
  SALES_GROUP_BY_VALUES,
  SALES_PRESET_VALUES,
  SALES_TOP_SORT_VALUES,
} from '../src/modules/sales-analytics/sales-period';
import {
  addOrder,
  allocateByWeight,
  centsToPesosCell,
  delta,
  emptyAcc,
  finish,
  OrderLite,
} from '../src/modules/sales-analytics/sales-figures';
import { taxBaseCentsOf } from '../src/common/money';

// 2026-10-06 12:00 en CDMX (UTC−6 todo el año desde 2023).
const NOW = new Date('2026-10-06T18:00:00.000Z');

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BusinessException) {
      const r = e.getResponse() as { error?: { code: string; details?: Record<string, unknown> } } & Record<string, unknown>;
      return { status: e.getStatus(), body: r };
    }
    throw e;
  }
  throw new Error('no lanzó');
};
const detailsOf = (x: { body: Record<string, unknown> }) =>
  ((x.body as { error?: { details?: Record<string, unknown> } }).error?.details ?? (x.body as { details?: Record<string, unknown> }).details) as Record<string, unknown>;

describe('§15.2 resolvePeriod — presets en días de México', () => {
  it('default = last7 (hoy y los 6 anteriores), groupBy day, topSort net', () => {
    const p = resolvePeriod({}, NOW);
    expect(p).toMatchObject({ preset: 'last7', from: '2026-09-30', to: '2026-10-06', days: 7, groupBy: 'day', topSort: 'net' });
    expect(p.prev).toEqual({ from: '2026-09-23', to: '2026-09-29' });
  });
  it('hoy es el día de MÉXICO: 2026-10-07 03:00 UTC sigue siendo el 6 en CDMX', () => {
    expect(resolvePeriod({ preset: 'today' }, new Date('2026-10-07T03:00:00.000Z'))).toMatchObject({ from: '2026-10-06', to: '2026-10-06', days: 1 });
  });
  it.each([
    ['today', '2026-10-06', '2026-10-06', '2026-10-05', '2026-10-05'],
    ['yesterday', '2026-10-05', '2026-10-05', '2026-10-04', '2026-10-04'],
    ['last30', '2026-09-07', '2026-10-06', '2026-08-08', '2026-09-06'],
    ['this_month', '2026-10-01', '2026-10-06', '2026-09-25', '2026-09-30'],
    // P-AN-3 (default): el mes pasado contra los MISMOS N días inmediatamente anteriores, ⛔ no el mes calendario.
    ['last_month', '2026-09-01', '2026-09-30', '2026-08-02', '2026-08-31'],
  ])('%s ⇒ %s…%s, anterior %s…%s', (preset, from, to, pf, pt) => {
    const p = resolvePeriod({ preset }, NOW);
    expect([p.from, p.to, p.prev.from, p.prev.to]).toEqual([from, to, pf, pt]);
  });
  it('custom con from/to (con o sin preset=custom); vacío o espacios = ausente', () => {
    expect(resolvePeriod({ from: '2026-01-01', to: '2026-01-03' }, NOW)).toMatchObject({ preset: 'custom', days: 3, prev: { from: '2025-12-29', to: '2025-12-31' } });
    expect(resolvePeriod({ preset: 'custom', from: '2026-01-01', to: '2026-01-03' }, NOW).preset).toBe('custom');
    expect(resolvePeriod({ preset: ' ', groupBy: '', topSort: '  ' }, NOW)).toMatchObject({ preset: 'last7', groupBy: 'day', topSort: 'net' });
    // 366 días exactos es válido.
    expect(resolvePeriod({ from: '2025-10-06', to: '2026-10-06' }, NOW).days).toBe(366);
  });
});

describe('AN-B-14 — los 400 de §15.2, uno por fila, con field/allowed y SIN value', () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ['preset fuera de dominio', { preset: 'last90' }, { field: 'preset', allowed: [...SALES_PRESET_VALUES] }],
    ['groupBy fuera de dominio', { groupBy: 'year' }, { field: 'groupBy', allowed: [...SALES_GROUP_BY_VALUES] }],
    ['topSort fuera de dominio', { topSort: 'gross' }, { field: 'topSort', allowed: [...SALES_TOP_SORT_VALUES] }],
    ['from mal formado', { from: '2026-1-01', to: '2026-01-03' }, { field: 'from' }],
    ['to día imposible', { from: '2026-02-01', to: '2026-02-30' }, { field: 'to' }],
    ['solo from', { from: '2026-01-01' }, { field: 'to' }],
    ['solo to', { to: '2026-01-01' }, { field: 'from' }],
    ['from > to', { from: '2026-01-05', to: '2026-01-03' }, { field: 'from' }],
    ['to posterior a hoy MX', { from: '2026-10-01', to: '2026-10-07' }, { field: 'to' }],
    ['más de 366 días', { from: '2025-10-05', to: '2026-10-06' }, { field: 'from' }],
    ['preset ≠ custom con from/to', { preset: 'last7', from: '2026-01-01', to: '2026-01-03' }, { field: 'preset', allowed: [...SALES_PRESET_VALUES] }],
  ];
  it.each(cases)('%s ⇒ 400 VALIDATION_ERROR', (_n, q, details) => {
    const e = err(() => resolvePeriod(q, NOW));
    expect(e.status).toBe(400);
    const d = detailsOf(e);
    expect(d).toEqual(details);
    expect(d).not.toHaveProperty('value');
    expect(JSON.stringify(e.body)).toContain('VALIDATION_ERROR');
  });
});

describe('AN-B-6 (puro) — cubos recortados: lunes a domingo y mes calendario', () => {
  it('7 días ⇒ 7 cubos de día; la semana se recorta en los dos bordes', () => {
    expect(bucketsOf('2021-03-03', '2021-03-09', 'day')).toHaveLength(7);
    // 2021-03-03 es miércoles: primera semana mié–dom recortada, segunda lun–mar recortada.
    expect(bucketsOf('2021-03-03', '2021-03-09', 'week')).toEqual([
      { from: '2021-03-03', to: '2021-03-07' },
      { from: '2021-03-08', to: '2021-03-09' },
    ]);
    expect(bucketsOf('2021-02-20', '2021-04-02', 'month')).toEqual([
      { from: '2021-02-20', to: '2021-02-28' },
      { from: '2021-03-01', to: '2021-03-31' },
      { from: '2021-04-01', to: '2021-04-02' },
    ]);
  });
  it('los cubos cubren el periodo sin huecos ni solapes (366 días, los tres groupBy)', () => {
    for (const g of SALES_GROUP_BY_VALUES) {
      const b = bucketsOf('2025-10-06', '2026-10-06', g);
      expect(b[0].from).toBe('2025-10-06');
      expect(b[b.length - 1].to).toBe('2026-10-06');
      for (let i = 1; i < b.length; i++) expect(new Date(`${b[i].from}T00:00:00Z`).getTime() - new Date(`${b[i - 1].to}T00:00:00Z`).getTime()).toBe(86400000);
    }
  });
  it('isoWeekday y mxHour', () => {
    expect(isoWeekday('2021-03-01')).toBe(1);
    expect(isoWeekday('2021-03-07')).toBe(7);
    expect(mxHour(new Date('2021-03-02T05:30:00.000Z'))).toBe(23);
    expect(mxHour(new Date('2021-03-02T06:10:00.000Z'))).toBe(0);
  });
});

const order = (totalCents: number, pieces: number): OrderLite => ({
  id: `o${totalCents}`,
  settledAt: NOW,
  status: 'settled',
  totalCents,
  subtotalCents: totalCents,
  ivaRatePct: 16,
  priceConvention: 'IVA_EXCLUSIVE',
  fulfillmentMode: 'vault',
  guestEmail: null,
  pieces,
});

describe('AN-B-5 — ticket promedio y piezas por pedido', () => {
  it('100/200/300 y 1/2/3 piezas ⇒ 20000 y 2', () => {
    const acc = emptyAcc();
    addOrder(acc, order(10000, 1));
    addOrder(acc, order(20000, 2));
    addOrder(acc, order(30000, 3));
    const f = finish(acc);
    expect(f.avgTicketCents).toBe(20000);
    expect(f.piecesPerOrder).toBe(2);
  });
  it('0 pedidos ⇒ los dos null, y el JSON no lleva NaN/Infinity', () => {
    const f = finish(emptyAcc());
    expect(f.avgTicketCents).toBeNull();
    expect(f.piecesPerOrder).toBeNull();
    expect(JSON.stringify(f)).not.toMatch(/NaN|Infinity/);
    expect(JSON.parse(JSON.stringify(f)).avgTicketCents).toBeNull();
  });
  it('redondeo: mitad hacia arriba en el ticket, un decimal en piezas', () => {
    const acc = emptyAcc();
    addOrder(acc, order(101, 1));
    addOrder(acc, order(100, 1));
    addOrder(acc, order(100, 2));
    const f = finish(acc);
    expect(f.avgTicketCents).toBe(100); // 301/3 = 100.33
    expect(f.piecesPerOrder).toBe(1.3); // 4/3
    const a2 = emptyAcc();
    addOrder(a2, order(101, 1));
    addOrder(a2, order(100, 1));
    expect(finish(a2).avgTicketCents).toBe(101); // 100.5 ⇒ 101
  });
});

describe('AN-B-7 — Delta', () => {
  it('3 vs 1 ⇒ diff 2, pct 200; anterior 0 ⇒ pct null; null ⇒ ambos null', () => {
    expect(delta(3, 1)).toEqual({ diff: 2, pct: 200 });
    expect(delta(3, 0)).toEqual({ diff: 3, pct: null });
    expect(delta(null, 5)).toEqual({ diff: null, pct: null });
    expect(delta(5, null)).toEqual({ diff: null, pct: null });
  });
  it('pct: mitad LEJOS de cero', () => {
    expect(delta(9, 8)).toEqual({ diff: 1, pct: 13 }); // 12.5 ⇒ 13
    expect(delta(7, 8)).toEqual({ diff: -1, pct: -13 }); // −12.5 ⇒ −13
    expect(delta(8, 8)).toEqual({ diff: 0, pct: 0 });
  });
});

describe('AN-B-21 (puro) — allocateByWeight: resto mayor, desempate por id', () => {
  it('25862 entre tres pesos iguales ⇒ 8621 + 8621 + 8620 (los dos centavos a los ids menores)', () => {
    const net = taxBaseCentsOf(30000, 16);
    expect(net).toBe(25862);
    const m = allocateByWeight(net, [
      { id: 'c', w: 10000 },
      { id: 'a', w: 10000 },
      { id: 'b', w: 10000 },
    ]);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual([8621, 8621, 8620]);
    // CONTROL: el neteo por renglón suelto NO cuadra (es la mutación m8).
    expect(3 * taxBaseCentsOf(10000, 16)).toBe(25863);
  });
  it('Σ = total exacto; pesos 0 ⇒ partes iguales; resto mayor manda', () => {
    const m = allocateByWeight(1000, [
      { id: 'x', w: 1 },
      { id: 'y', w: 2 },
    ]);
    expect([m.get('x'), m.get('y')]).toEqual([333, 667]);
    const z = allocateByWeight(5, [
      { id: 'p', w: 0 },
      { id: 'q', w: 0 },
    ]);
    expect([z.get('p'), z.get('q')]).toEqual([3, 2]);
    for (const total of [0, 1, 7, 25862, 999999]) {
      const r = allocateByWeight(total, [
        { id: '1', w: 3 },
        { id: '2', w: 7 },
        { id: '3', w: 11 },
      ]);
      expect([...r.values()].reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('AN-B-23 — centsToPesosCell en aritmética entera', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [34800, '348.00'],
    [-1230, '-12.30'],
    [-5, '-0.05'],
    [123456789, '1234567.89'],
    [-100, '-1.00'],
  ])('%d ⇒ %s', (c, s) => {
    expect(centsToPesosCell(c)).toBe(s);
    expect(s).toMatch(/^-?\d+\.\d{2}$/);
  });
  it('⛔ no acepta fracciones de centavo', () => {
    expect(() => centsToPesosCell(1.5)).toThrow();
  });
});
