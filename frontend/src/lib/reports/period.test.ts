import { describe, it, expect } from 'vitest';
import { parsePeriod, periodFor, periodSearch, todayMx } from './period';

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

  it('periodSearch lleva siempre fechas explícitas', () => {
    expect(periodSearch({ preset: 'month', from: '2026-11-01', to: '2026-11-22' })).toBe('?preset=custom&from=2026-11-01&to=2026-11-22');
  });
});
