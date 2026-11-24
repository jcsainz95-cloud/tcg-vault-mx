import { describe, it, expect } from 'vitest';
import { bpsOf, compareInfo, fmtCompact, fmtPct } from './comparison';

const prev = { from: '2026-10-01', to: '2026-10-23', clamped: false };
const cur = (kind: 'month' | 'quarter' | 'semester' | 'year' | 'span' | 'day', toDate?: boolean) => ({ kind, toDate });

describe('§2 F2a/F2b · qué se rotula de la comparación (compareInfo)', () => {
  it('«a la fecha» SOLO con period.toDate:true y kind de calendario (m-7); el periodo anterior tal cual del servidor', () => {
    expect(compareInfo(prev, { basis: 'complete', dataSince: null }, cur('month', true))).toEqual({
      mode: 'complete', toDate: 'month', previous: { from: '2026-10-01', to: '2026-10-23' }, clamped: false, dataSince: null,
    });
    expect(compareInfo(prev, { basis: 'complete' }, cur('quarter', true)).toDate).toBe('quarter');
    expect(compareInfo(prev, { basis: 'complete' }, cur('semester', true)).toDate).toBe('semester');
    expect(compareInfo(prev, { basis: 'complete' }, cur('year', true)).toDate).toBe('year');
  });
  it('periodo cerrado (toDate:false), servidor viejo (sin toDate) y span/day NO son «a la fecha»', () => {
    expect(compareInfo(prev, { basis: 'complete' }, cur('month', false)).toDate).toBeNull();
    expect(compareInfo(prev, { basis: 'complete' }, cur('month')).toDate).toBeNull();
    expect(compareInfo(prev, { basis: 'complete' }, { kind: 'month' }).toDate).toBeNull();
    expect(compareInfo(prev, { basis: 'complete' }, cur('span', true)).toDate).toBeNull();
    expect(compareInfo(prev, { basis: 'complete' }, cur('day', true)).toDate).toBeNull();
    expect(compareInfo(prev, { basis: 'complete' }, undefined).toDate).toBeNull();
  });
  it('basis partial ⇒ «contra lo que hay» con `dataSince` del servidor', () => {
    const i = compareInfo(prev, { basis: 'partial', dataSince: '2026-10-12' });
    expect(i.mode).toBe('partial');
    expect(i.dataSince).toBe('2026-10-12');
  });
  it('basis none, sin periodo anterior o `comparison: null` (P&L sin from/to) ⇒ none', () => {
    expect(compareInfo(prev, { basis: 'none', dataSince: null }).mode).toBe('none');
    expect(compareInfo(null, { basis: 'complete' }).mode).toBe('none');
    expect(compareInfo(undefined, undefined).mode).toBe('none');
    expect(compareInfo(prev, null).mode).toBe('none');
  });
  it('clamped solo se avisa cuando hay comparación; un servidor anterior (sin basis) se trata como completo', () => {
    expect(compareInfo({ ...prev, clamped: true }, { basis: 'complete' }).clamped).toBe(true);
    expect(compareInfo({ ...prev, clamped: true }, { basis: 'none' }).clamped).toBe(false);
    expect(compareInfo(prev, {}).mode).toBe('complete');
    expect(compareInfo(prev, undefined).mode).toBe('complete');
  });
  it('basis none CON previous conserva el periodo anterior (rótulo «sin ventas en el periodo anterior»); sin previous no', () => {
    expect(compareInfo(prev, { basis: 'none' }).previous).toEqual({ from: '2026-10-01', to: '2026-10-23' });
    expect(compareInfo(null, null).previous).toBeNull();
  });
});

describe('§2 F2a · formato de rango y de variación', () => {
  it('«1–23 nov» / «Nov 1–23», otro mes con ambos meses y un día con día de la semana', () => {
    const today = '2026-11-23';
    expect(fmtCompact('2026-11-01', '2026-11-23', 'es', today)).toBe('1–23 nov');
    expect(fmtCompact('2026-10-01', '2026-10-23', 'en', today)).toBe('Oct 1–23');
    expect(fmtCompact('2026-10-28', '2026-11-03', 'es', today)).toBe('28 oct – 3 nov');
    expect(fmtCompact('2026-11-23', '2026-11-23', 'es', today)).toMatch(/^lun 23 nov$/);
    expect(fmtCompact('2025-12-01', '2025-12-31', 'es', today)).toBe('1–31 dic 2025');
  });
  it('fmtPct: SIEMPRE un decimal fijo, mitad hacia afuera de cero (puntos base enteros); null ⇒ null', () => {
    expect(fmtPct(1520, 'es')).toBe('+15.2 %');
    expect(fmtPct(-5000, 'en')).toBe('−50.0 %');
    expect(fmtPct(1200, 'es', false)).toBe('12.0 %');
    expect(fmtPct(-350, 'en')).toBe('−3.5 %');
    expect(fmtPct(0, 'es')).toBe('0.0 %');
    expect(fmtPct(5, 'es')).toBe('+0.1 %'); // +0.05 ⇒ 0.1 (mitad hacia afuera)
    expect(fmtPct(-5, 'es')).toBe('−0.1 %');
    expect(fmtPct(50, 'es')).toBe('+0.5 %');
    expect(fmtPct(4, 'es')).toBe('0.0 %');
    expect(fmtPct(2 ** 31, 'en', false)).toBe('21,474,836.5 %');
    expect(fmtPct(null, 'es')).toBeNull();
  });
  it('bpsOf: round_half_away(n·10000/d) con BigInt; d ≤ 0 ⇒ 0', () => {
    expect(bpsOf(1, 3)).toBe(3333);
    expect(bpsOf(2, 3)).toBe(6667);
    expect(bpsOf(1, 8)).toBe(1250);
    expect(bpsOf(1, 16)).toBe(625); // 625.0
    expect(bpsOf(1, 32)).toBe(313); // 312.5 ⇒ 313 (mitad hacia afuera)
    expect(bpsOf(-1, 32)).toBe(-313);
    expect(bpsOf(5, 0)).toBe(0);
    expect(bpsOf(2 ** 31, 2 ** 31)).toBe(10_000);
  });
});
