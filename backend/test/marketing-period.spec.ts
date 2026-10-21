/**
 * 🔒 CANDADO — granularidad fuera de pantalla (Brief 2 §5.2, PM-A1; API_CONTRACT §MKT.E).
 * El endpoint/export aceptan SOLO semana o mes CERRADO; rango libre, día o periodo abierto ⇒ 400.
 */
import { BusinessException } from '../src/common/business.exception';
import { addDays, isoWeekday } from '../src/modules/sales-analytics/sales-period';
import {
  MARKETING_EXPORT_FORMATS,
  MARKETING_SCREENS,
  parseExportFormat,
  parseScreen,
  resolveMarketingPeriod,
} from '../src/modules/marketing/marketing-period';

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

  it('400 — semana ISO 53 que NO existe en ese año (2025 tiene 52); 2026-W53 sí existe', () => {
    // 2025 empieza en miércoles y no es bisiesto ⇒ 52 semanas ISO. Sin el rechazo, «2025-W53» resolvía al
    // lunes 2025-12-29, que es 2026-W01: una etiqueta falsa para otra semana (marketing-period.ts mondayOfIsoWeek).
    expect(status(() => resolveMarketingPeriod({ week: '2025-W53' }, NOW))).toBe(400);
    expect(status(() => resolveMarketingPeriod({ week: '2025-W00' }, NOW))).toBe(400);
    // 2026 empieza en jueves ⇒ 53 semanas; su W53 (28-dic-2026 → 3-ene-2027) es válida una vez cerrada.
    const p = resolveMarketingPeriod({ week: '2026-W53' }, new Date('2027-01-06T18:00:00.000Z'));
    expect(p).toMatchObject({ kind: 'week', from: '2026-12-28', to: '2027-01-03', label: '2026-W53' });
    expect(resolveMarketingPeriod({ week: '2025-W52' }, NOW)).toMatchObject({ from: '2025-12-22', to: '2025-12-28' });
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

/** El cuerpo del 400 (lo que el filtro global serializa en `error.details`). */
const details = (fn: () => unknown): Record<string, unknown> | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BusinessException) return (e.getResponse() as { details?: Record<string, unknown> }).details;
    throw e;
  }
  return undefined;
};

describe('v1.104 — `pantalla` y `format` son SELECTOR (§0-Q punto 6-bis): 400 {field, allowed}, sin value', () => {
  it.each([
    ['pantalla', parseScreen, MARKETING_SCREENS, 'a'],
    ['format', parseExportFormat, MARKETING_EXPORT_FORMATS, 'csv'],
  ] as const)('%s: ausente, vacío, espacios, basura y token sin normalizar ⇒ 400 con field+allowed', (field, parse, allowed, valid) => {
    expect(parse(valid)).toBe(valid);
    for (const raw of [undefined, '', ' ', '\t', 'zzz', ` ${valid}`, `${valid},${valid}`, 'A'.repeat(5000)]) {
      expect([field, raw === undefined ? 'undef' : raw.slice(0, 8), status(() => parse(raw))]).toEqual([field, raw === undefined ? 'undef' : raw.slice(0, 8), 400]);
      const d = details(() => parse(raw));
      expect(d).toEqual({ field, allowed: [...allowed] });
    }
  });

  it('`format` = el literal exportado `[xlsx, csv]` (dominio del contrato §MKT.E)', () => {
    expect([...MARKETING_EXPORT_FORMATS]).toEqual(['xlsx', 'csv']);
    expect(parseExportFormat('xlsx')).toBe('xlsx');
  });
});
