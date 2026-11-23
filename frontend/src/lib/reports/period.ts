/**
 * §REPORTES-CEO §2 — periodo único de los reportes, en días civiles de México (`YYYY-MM-DD`, ambos incluidos).
 * El servidor es la regla (huso, tope de 366 días, periodo anterior); aquí solo se arman las fechas del selector.
 */
export const REPORT_PRESETS = ['today', '7d', 'month', 'last-month', 'custom'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export interface ReportPeriod {
  preset: ReportPreset;
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Hoy en México, `YYYY-MM-DD`. */
export function todayMx(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now);
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Fechas de un atajo. `custom` no se arma aquí (las eligen en el calendario). */
export function periodFor(preset: Exclude<ReportPreset, 'custom'>, today: string = todayMx()): ReportPeriod {
  const [y, m] = today.split('-').map(Number);
  if (preset === 'today') return { preset, from: today, to: today };
  if (preset === '7d') return { preset, from: addDays(today, -6), to: today };
  if (preset === 'month') return { preset, from: ymd(y, m, 1), to: today };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { preset, from: ymd(py, pm, 1), to: addDays(ymd(y, m, 1), -1) };
}

const isYmd = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Lee `?preset=&from=&to=` (rutas de los reportes). Basura ⇒ «este mes». */
export function parsePeriod(sp: Record<string, string | string[] | undefined>, today: string = todayMx()): ReportPeriod {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const preset = one(sp.preset);
  const from = one(sp.from);
  const to = one(sp.to);
  if (preset === 'custom' && isYmd(from) && isYmd(to) && from <= to) return { preset: 'custom', from, to };
  if (preset === 'today' || preset === '7d' || preset === 'last-month') return periodFor(preset, today);
  return periodFor('month', today);
}

/** Query-string que lleva el periodo a Finanzas y a Ventas (siempre fechas explícitas: ambas pantallas las entienden). */
export function periodSearch(p: ReportPeriod): string {
  return `?preset=custom&from=${p.from}&to=${p.to}`;
}
