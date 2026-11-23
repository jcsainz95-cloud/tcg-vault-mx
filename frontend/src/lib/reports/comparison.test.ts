import { describe, it, expect } from 'vitest';
import { compareInfo, fmtBps, fmtCompact } from './comparison';

const prev = { from: '2026-10-01', to: '2026-10-23', clamped: false };

describe('§2 F2a · qué se rotula de la comparación (compareInfo)', () => {
  it('basis complete en periodo en curso ⇒ «a la fecha» y el periodo anterior tal cual del servidor', () => {
    expect(compareInfo('month', prev, { basis: 'complete', dataSince: null })).toEqual({
      mode: 'complete', toDate: 'month', previous: { from: '2026-10-01', to: '2026-10-23' }, clamped: false, dataSince: null,
    });
    expect(compareInfo('quarter', prev, { basis: 'complete' }).toDate).toBe('quarter');
    expect(compareInfo('year', prev, { basis: 'complete' }).toDate).toBe('year');
  });
  it('periodos cerrados o móviles NO son «a la fecha»', () => {
    for (const p of ['today', '7d', '30d', 'last-month', 'custom'] as const) expect(compareInfo(p, prev, { basis: 'complete' }).toDate).toBeNull();
  });
  it('basis partial ⇒ «contra lo que hay» con `dataSince` del servidor', () => {
    const i = compareInfo('month', prev, { basis: 'partial', dataSince: '2026-10-12' });
    expect(i.mode).toBe('partial');
    expect(i.dataSince).toBe('2026-10-12');
  });
  it('basis none, «Todo», sin periodo anterior o `comparison: null` (P&L sin from/to) ⇒ none', () => {
    expect(compareInfo('month', prev, { basis: 'none', dataSince: null }).mode).toBe('none');
    expect(compareInfo('all', prev, { basis: 'complete' }).mode).toBe('none');
    expect(compareInfo('month', null, { basis: 'complete' }).mode).toBe('none');
    expect(compareInfo('month', undefined, undefined).mode).toBe('none');
    expect(compareInfo('month', prev, null).mode).toBe('none');
  });
  it('clamped solo se avisa cuando hay comparación; un servidor anterior (sin basis) se trata como completo', () => {
    expect(compareInfo('month', { ...prev, clamped: true }, { basis: 'complete' }).clamped).toBe(true);
    expect(compareInfo('month', { ...prev, clamped: true }, { basis: 'none' }).clamped).toBe(false);
    expect(compareInfo('month', prev, {}).mode).toBe('complete');
    expect(compareInfo('month', prev, undefined).mode).toBe('complete');
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
  it('deltaBps en %: entero de puntos base, null ⇒ null (nunca 0 %)', () => {
    expect(fmtBps(1520, 'es')).toBe('+15.2 %');
    expect(fmtBps(-5000, 'en')).toBe('−50 %');
    expect(fmtBps(0, 'es')).toBe('0 %');
    expect(fmtBps(null, 'es')).toBeNull();
  });
});
