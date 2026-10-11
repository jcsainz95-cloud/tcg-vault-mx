/**
 * mx-day.ts — la frontera de DÍA de México para los avisos de gasto (API_CONTRACT §19.29.6 «Días: `America/Mexico_City`»,
 * §19.29.7 «El resumen cuadra con el panel»). ⭐ UN cuerpo para el panel (`?from=&to=`), el resumen (`summary`) y el correo de
 * las 08:00 (`spend-digest`): un aviso a las 23:30 MX entra en ESE día, no en el siguiente por UTC (PS-154).
 *
 * El día es la fecha civil `YYYY-MM-DD` en `America/Mexico_City` (la misma de `dayMx`, `spend-alerts.service.ts`). El rango
 * de un día es `[00:00 MX, 00:00 MX del día siguiente)`, en instantes UTC calculados con `Intl` (sin suponer el desfase).
 */
import { BusinessException } from '../../common/business.exception';
import { dayMx } from './spend-alerts.service';

const MX_TZ = 'America/Mexico_City';
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minutos que `America/Mexico_City` está DELANTE de UTC en el instante `t` (México: −360). */
function offsetMinutesAt(t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MX_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000);
}

/** ¿`ymd` es una fecha civil real (`YYYY-MM-DD`)? */
export function isYmd(ymd: unknown): ymd is string {
  if (typeof ymd !== 'string') return false;
  const m = YMD_RE.exec(ymd);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** El instante UTC de las 00:00 en México del día civil `ymd`. */
export function mxDayStart(ymd: string): Date {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new Error(`mxDayStart: '${ymd}' no es YYYY-MM-DD`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let t = guess - offsetMinutesAt(guess) * 60000;
  // Si el desfase cambió entre la suposición y el resultado (un cambio de horario histórico), se recalcula una vez.
  t = guess - offsetMinutesAt(t) * 60000;
  return new Date(t);
}

/** El día civil siguiente (`2026-10-31` ⇒ `2026-11-01`). */
export function nextYmd(ymd: string): string {
  const m = YMD_RE.exec(ymd)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return d.toISOString().slice(0, 10);
}

/** El día civil anterior. */
export function prevYmd(ymd: string): string {
  const m = YMD_RE.exec(ymd)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return d.toISOString().slice(0, 10);
}

/** `[00:00 MX de from, 00:00 MX del día siguiente a to)`. */
export function mxDaysRange(from: string, to: string): { gte: Date; lt: Date } {
  return { gte: mxDayStart(from), lt: mxDayStart(nextYmd(to)) };
}

/** Ayer en México respecto de `now` (el día que resume el correo de las 08:00). */
export function yesterdayMx(now: Date): string {
  return prevYmd(dayMx(now));
}

/**
 * `?from=&to=` del panel y de `summary` (días MX sobre `firstOccurredAt`). Ausente o en blanco ⇒ sin cota de ese lado;
 * fuera de `YYYY-MM-DD` (o fecha imposible) ⇒ `400 VALIDATION_ERROR {field}`; `from > to` ⇒ `400 {field:'from'}`.
 * ⛔ No son ejes de §0-Q (lista de no-enums de `C-EQ-1`, §19.32.1).
 */
export function parseMxDayFilter(raw: { from?: unknown; to?: unknown }): { from?: string; to?: string; range?: { gte?: Date; lt?: Date } } {
  const read = (field: 'from' | 'to'): string | undefined => {
    const v = raw[field];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') throw BusinessException.badRequest('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`, { field });
    if (v.trim() === '') return undefined;
    if (!isYmd(v)) throw BusinessException.badRequest('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`, { field });
    return v;
  };
  const from = read('from');
  const to = read('to');
  if (from && to && from > to) throw BusinessException.badRequest('VALIDATION_ERROR', 'from must be <= to', { field: 'from' });
  if (!from && !to) return {};
  return {
    from,
    to,
    range: { ...(from ? { gte: mxDayStart(from) } : {}), ...(to ? { lt: mxDayStart(nextYmd(to)) } : {}) },
  };
}
