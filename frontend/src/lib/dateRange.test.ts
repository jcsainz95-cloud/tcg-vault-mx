import { describe, it, expect } from 'vitest';
import { presetRange } from './dateRange';

// Fecha fija (jueves 2026-08-13) para presets deterministas.
const NOW = new Date(2026, 7, 13); // meses 0-based → 7 = agosto

describe('presetRange', () => {
  it('week → lunes de la semana actual (ISO) hasta hoy', () => {
    // 2026-08-13 es jueves; el lunes de esa semana es 2026-08-10.
    expect(presetRange('week', NOW)).toEqual({ from: '2026-08-10', to: '2026-08-13' });
  });

  it('month → mismo día del mes anterior hasta hoy', () => {
    expect(presetRange('month', NOW)).toEqual({ from: '2026-07-13', to: '2026-08-13' });
  });

  it('quarter → primer día del trimestre actual hasta hoy', () => {
    // Agosto cae en Q3 (jul-sep) → inicia 2026-07-01.
    expect(presetRange('quarter', NOW)).toEqual({ from: '2026-07-01', to: '2026-08-13' });
  });

  it('year → 1 de enero del año actual hasta hoy', () => {
    expect(presetRange('year', NOW)).toEqual({ from: '2026-01-01', to: '2026-08-13' });
  });

  it('week con domingo toma el lunes previo (semana ISO)', () => {
    const sunday = new Date(2026, 7, 16); // 2026-08-16 es domingo
    expect(presetRange('week', sunday)).toEqual({ from: '2026-08-10', to: '2026-08-16' });
  });
});
