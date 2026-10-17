/**
 * 🔒 CANDADO — granularidad fuera de pantalla (Brief 2 §5.2, PM-A1; API_CONTRACT §MKT.E).
 * El endpoint/export aceptan SOLO semana o mes CERRADO; rango libre, día o periodo abierto ⇒ 400.
 */
import { BusinessException } from '../src/common/business.exception';
import { addDays, isoWeekday } from '../src/modules/sales-analytics/sales-period';
import { parseScreen, resolveMarketingPeriod } from '../src/modules/marketing/marketing-period';

// 2026-10-16 (viernes) 12:00 CDMX.
const NOW = new Date('2026-10-16T18:00:00.000Z');

const status = (fn: () => unknown): number => {
  try {
    fn();
    return 200;
  } catch (e) {
    if (e instanceof BusinessException) return e.getStatus();
    throw e;
  }
};

describe('resolveMarketingPeriod', () => {
  it('acepta una semana cerrada por weekStart (lunes) y calcula domingo + semana previa', () => {
    const p = resolveMarketingPeriod({ weekStart: '2026-10-05' }, NOW);
    expect(p.kind).toBe('week');
    expect(p.from).toBe('2026-10-05');
    expect(p.to).toBe('2026-10-11');
    expect(p.prev).toEqual({ from: '2026-09-28', to: '2026-10-04' });
  });

  it('acepta una semana cerrada por week=YYYY-Www (lunes ISO)', () => {
    const p = resolveMarketingPeriod({ week: '2026-W40' }, NOW);
    expect(p.kind).toBe('week');
    expect(isoWeekday(p.from)).toBe(1);
    expect(p.to).toBe(addDays(p.from, 6));
  });

  it('acepta un mes cerrado y calcula el mes previo', () => {
    const p = resolveMarketingPeriod({ month: '2026-09' }, NOW);
    expect(p).toMatchObject({ kind: 'month', from: '2026-09-01', to: '2026-09-30' });
    expect(p.prev).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('400 — semana aún ABIERTA (domingo no ha pasado)', () => {
    // Lunes de la semana en curso de NOW ⇒ su domingo (2026-10-18) ≥ hoy.
    expect(status(() => resolveMarketingPeriod({ weekStart: '2026-10-12' }, NOW))).toBe(400);
  });

  it('400 — mes aún ABIERTO', () => {
    expect(status(() => resolveMarketingPeriod({ month: '2026-10' }, NOW))).toBe(400);
  });

  it('400 — weekStart que no es lunes', () => {
    expect(status(() => resolveMarketingPeriod({ weekStart: '2026-10-06' }, NOW))).toBe(400);
  });

  it('400 — rango libre (from/to) o día prohibidos', () => {
    expect(status(() => resolveMarketingPeriod({ from: '2026-10-01', to: '2026-10-07' }, NOW))).toBe(400);
    expect(status(() => resolveMarketingPeriod({ day: '2026-10-05' }, NOW))).toBe(400);
    expect(status(() => resolveMarketingPeriod({ preset: 'last7' }, NOW))).toBe(400);
  });

  it('400 — más de un periodo a la vez, o ninguno', () => {
    expect(status(() => resolveMarketingPeriod({ week: '2026-W40', month: '2026-09' }, NOW))).toBe(400);
    expect(status(() => resolveMarketingPeriod({}, NOW))).toBe(400);
  });
});

describe('parseScreen (lista blanca a-h)', () => {
  it('acepta a-h', () => {
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) expect(parseScreen(s)).toBe(s);
  });
  it('400 fuera de la lista', () => {
    expect(status(() => parseScreen('z'))).toBe(400);
    expect(status(() => parseScreen('codigos'))).toBe(400);
    expect(status(() => parseScreen(undefined))).toBe(400);
  });
});
