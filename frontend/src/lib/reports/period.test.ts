import { describe, it, expect } from 'vitest';
import { financeRange, isRealYmd, parsePeriod, parsePeriodNotice, periodFor, periodKind, periodSearch, SALES_MAX_DAYS, todayMx } from './period';
import { salesParamsFor } from './sales-params';

describe('§REPORTES-CEO §2 · periodo único en días de México', () => {
  it('«Este mes» va del 1 a hoy; «7 días» incluye hoy; «Hoy» es un día', () => {
    expect(periodFor('month', '2026-11-22')).toEqual({ preset: 'month', from: '2026-11-01', to: '2026-11-22' });
    expect(periodFor('7d', '2026-11-22')).toEqual({ preset: '7d', from: '2026-11-16', to: '2026-11-22' });
    expect(periodFor('today', '2026-11-22')).toEqual({ preset: 'today', from: '2026-11-22', to: '2026-11-22' });
  });

  it('«Mes pasado» cierra el último día del mes anterior, también en enero y en año bisiesto', () => {
    expect(periodFor('last-month', '2026-11-22')).toEqual({ preset: 'last-month', from: '2026-10-01', to: '2026-10-31' });
    expect(periodFor('last-month', '2027-01-05')).toEqual({ preset: 'last-month', from: '2026-12-01', to: '2026-12-31' });
    expect(periodFor('last-month', '2028-03-10')).toEqual({ preset: 'last-month', from: '2028-02-01', to: '2028-02-29' });
  });

  it('el día de México no es el de UTC: a las 23:59 del 30 sigue siendo 30 (CR-3)', () => {
    // 2026-11-01T05:30Z = 2026-10-31 23:30 en México (UTC−6, sin horario de verano desde 2022).
    expect(todayMx(new Date('2026-11-01T05:30:00Z'))).toBe('2026-10-31');
  });

  it('parsePeriod: fechas explícitas válidas se respetan; basura o rango al revés ⇒ este mes', () => {
    const today = '2026-11-22';
    expect(parsePeriod({ preset: 'custom', from: '2026-10-01', to: '2026-10-15' }, today)).toEqual({ preset: 'custom', from: '2026-10-01', to: '2026-10-15' });
    expect(parsePeriod({ preset: 'custom', from: '2026-10-15', to: '2026-10-01' }, today).preset).toBe('month');
    expect(parsePeriod({ preset: 'x' }, today).preset).toBe('month');
    expect(parsePeriod({}, today)).toEqual(periodFor('month', today));
    expect(parsePeriod({ preset: '7d' }, today).preset).toBe('7d');
  });

  it('periodSearch: un atajo viaja como atajo (se re-resuelve); «fechas» viaja con sus fechas', () => {
    expect(periodSearch({ preset: 'month', from: '2026-11-01', to: '2026-11-22' })).toBe('?preset=month');
    expect(periodSearch({ preset: 'custom', from: '2026-11-01', to: '2026-11-22' })).toBe('?preset=custom&from=2026-11-01&to=2026-11-22');
  });

  it('todos los atajos del contrato (§2) se resuelven en el front: 30d, trimestre, año y todo', () => {
    const t = '2026-11-22';
    expect(periodFor('30d', t)).toEqual({ preset: '30d', from: '2026-10-24', to: t });
    expect(periodFor('quarter', t).from).toBe('2026-10-01');
    expect(periodFor('quarter', '2026-08-05').from).toBe('2026-07-01');
    expect(periodFor('year', t).from).toBe('2026-01-01');
    expect(periodFor('all', t).to).toBe(t);
    // «Todo» = sin from/to hacia Finanzas; los demás mandan fechas.
    expect(financeRange(periodFor('all', t))).toEqual({});
    expect(financeRange(periodFor('7d', t))).toEqual({ from: '2026-11-16', to: t, kind: 'rolling' });
  });

  it('fecha REAL, no solo forma: 2026-02-30 y años fuera de 2020..año+1 no valen (m-6, I-3)', () => {
    const t = '2026-11-22';
    expect(isRealYmd('2026-02-28', t)).toBe(true);
    expect(isRealYmd('2026-02-30', t)).toBe(false);
    expect(isRealYmd('2019-12-31', t)).toBe(false);
    expect(isRealYmd('2028-01-01', t)).toBe(false);
    expect(parsePeriod({ preset: 'custom', from: '2026-02-30', to: '2026-03-05' }, t).preset).toBe('month');
  });

  it('con tope de días (Ventas), «Todo» que viene del menú cae al defecto', () => {
    expect(parsePeriod({ preset: 'all' }, '2026-11-22').preset).toBe('all');
    expect(parsePeriod({ preset: 'all' }, '2026-11-22', { maxDays: SALES_MAX_DAYS }).preset).toBe('month');
  });

  it('el selector NUNCA manda `preset` de servidor a ventas: siempre custom con fechas de México', () => {
    for (const p of ['today', '7d', '30d', 'month', 'last-month', 'quarter', 'year'] as const) {
      const q = salesParamsFor(periodFor(p, '2026-11-22'));
      expect(q.preset).toBe('custom');
      expect(q.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('§2 F2a · cada atajo manda su `kind`: hoy→day; 7d/30d→rolling; mes/mes pasado→month; trimestre→quarter; año→year; fechas→span; Todo→ninguno', () => {
    const t = '2026-11-23';
    expect(periodKind(periodFor('today', t))).toBe('day');
    expect(periodKind(periodFor('7d', t))).toBe('rolling');
    expect(periodKind(periodFor('30d', t))).toBe('rolling');
    expect(periodKind(periodFor('month', t))).toBe('month');
    expect(periodKind(periodFor('last-month', t))).toBe('month');
    expect(periodKind(periodFor('quarter', t))).toBe('quarter');
    expect(periodKind(periodFor('year', t))).toBe('year');
    expect(periodKind({ preset: 'custom' })).toBe('span');
    expect(periodKind(periodFor('all', t))).toBeUndefined();
  });

  it('§2 F2a · `kind` viaja a Ventas (salesParamsFor) y a Finanzas (financeRange); «Todo» a Finanzas va sin from/to/kind', () => {
    const t = '2026-11-23';
    expect(salesParamsFor(periodFor('month', t)).kind).toBe('month');
    expect(salesParamsFor(periodFor('7d', t)).kind).toBe('rolling');
    expect(salesParamsFor({ preset: 'custom', from: '2026-10-01', to: '2026-10-15' }).kind).toBe('span');
    expect(financeRange(periodFor('quarter', t))).toEqual({ from: '2026-10-01', to: t, kind: 'quarter' });
    expect(financeRange(periodFor('last-month', t))).toEqual({ from: '2026-10-01', to: '2026-10-31', kind: 'month' });
    expect(financeRange(periodFor('all', t))).toEqual({});
  });
});

describe('§2 caídas del selector (I-1, M-7): parsePeriodNotice, tabla de URLs', () => {
  const today = '2026-11-23';
  const month = periodFor('month', today);
  const cap = { maxDays: SALES_MAX_DAYS };
  type Row = [string, Record<string, string>, { maxDays?: number }, string, string | null];
  const rows: Row[] = [
    ['sin nada', {}, cap, 'month', null],
    ['atajo válido', { preset: '7d' }, cap, '7d', null],
    ['atajo válido con from/to de sobra', { preset: '7d', from: 'x', to: 'y' }, cap, '7d', null],
    ['preset vacío', { preset: '' }, cap, 'month', null],
    ['preset desconocido', { preset: 'hoy' }, cap, 'month', 'invalid'],
    ['custom sin fechas', { preset: 'custom' }, cap, 'month', 'invalid'],
    ['custom inexistente', { preset: 'custom', from: '2026-02-30', to: '2026-03-01' }, cap, 'month', 'invalid'],
    ['custom al revés', { preset: 'custom', from: '2026-11-10', to: '2026-11-01' }, cap, 'month', 'invalid'],
    ['custom con to > hoy', { preset: 'custom', from: '2026-11-01', to: '2026-11-24' }, cap, 'month', 'invalid'],
    ['from/to sin preset', { from: '2026-11-01', to: '2026-11-10' }, cap, 'month', 'invalid'],
    ['solo from', { from: '2026-11-01' }, cap, 'month', 'invalid'],
    ['ISO parcial', { preset: 'custom', from: '2026-11', to: '2026-11-10' }, cap, 'month', 'invalid'],
    ['all con tope', { preset: 'all' }, cap, 'month', 'allUnavailable'],
    ['all sin tope (Finanzas)', { preset: 'all' }, {}, 'all', null],
    ['custom válido de 367 días con tope', { preset: 'custom', from: '2025-11-22', to: '2026-11-23' }, cap, 'month', 'tooLong'],
    ['custom válido de 366 días con tope', { preset: 'custom', from: '2025-11-23', to: '2026-11-23' }, cap, 'custom', null],
    ['custom largo sin tope (Finanzas)', { preset: 'custom', from: '2021-01-01', to: '2026-11-23' }, {}, 'custom', null],
    ['arreglo en la URL (primer valor)', { preset: ['30d', 'x'] } as unknown as Record<string, string>, cap, '30d', null],
  ];
  it.each(rows)('%s', (_n, sp, opts, preset, notice) => {
    const r = parsePeriodNotice(sp, today, opts);
    expect(r.period.preset).toBe(preset);
    expect(r.notice).toBe(notice);
    if (notice) expect(r.period).toEqual(month);
    expect(parsePeriod(sp, today, opts)).toEqual(r.period); // el envoltorio descarta el aviso, nada más
  });
});
