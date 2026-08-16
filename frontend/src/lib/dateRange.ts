/**
 * Presets de rango de fechas para los selectores de rango (M7 Finanzas, M9 Reportes).
 * Devuelve `from`/`to` como cadenas `YYYY-MM-DD` (mismo formato que `<input type="date">`),
 * calculadas en hora LOCAL para evitar corrimientos de un día por zona horaria.
 *
 * - `week`    → "Esta semana": lunes de la semana actual (ISO) → hoy.
 * - `month`   → "Último mes": mismo día del mes anterior → hoy (ventana rodante ~1 mes).
 * - `quarter` → "Este trimestre": primer día del trimestre actual → hoy.
 * - `year`    → "Este año": 1 de enero del año actual → hoy.
 */
export type DatePreset = 'week' | 'month' | 'quarter' | 'year';

export const DATE_PRESETS: DatePreset[] = ['week', 'month', 'quarter', 'year'];

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function presetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } {
  // Normaliza a medianoche local del día actual.
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from: Date;
  switch (preset) {
    case 'week': {
      // (getDay()+6)%7 → 0 = lunes, 6 = domingo (semana ISO empieza en lunes).
      const dow = (to.getDay() + 6) % 7;
      from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - dow);
      break;
    }
    case 'month':
      from = new Date(to.getFullYear(), to.getMonth() - 1, to.getDate());
      break;
    case 'quarter': {
      const q = Math.floor(to.getMonth() / 3);
      from = new Date(to.getFullYear(), q * 3, 1);
      break;
    }
    case 'year':
      from = new Date(to.getFullYear(), 0, 1);
      break;
  }
  return { from: fmt(from), to: fmt(to) };
}
