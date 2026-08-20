import { BusinessException } from './business.exception';

/**
 * v1.25-buylist-orders-pagination (§Convenciones «Filtros de lista admin») — parseo + validación
 * TRANSVERSAL de los filtros de las colas admin que crecen (`GET /admin/buylist` §M5 y
 * `GET /admin/orders` §M3). Mismos nombres y semántica en ambos endpoints: `q`, `from`, `to`,
 * `minCents`, `maxCents`, `page`, `pageSize`. TODOS opcionales; omitirlos = listado como antes de
 * v1.25. Cualquier entrada inválida → **400 VALIDATION_ERROR** (patrón del contrato para paginación),
 * NUNCA se silencia con un clamp: paginación no numérica / `pageSize>100`, fecha no parseable, monto
 * no entero o negativo, `maxCents<minCents`, o `q>200` chars.
 *
 * SEGURIDAD: sólo produce fragmentos de `where` que REDUCEN el conjunto ya autorizado por rol; no
 * cambia shape ni proyección. La construcción concreta del `where` (columnas de monto/fecha, campos
 * del OR de `q`, CSV de `status`) vive en cada endpoint porque difieren; este helper sólo entrega
 * valores ya validados (rango de fecha, rango de centavos, `q` normalizada, page/pageSize).
 */

export const ADMIN_LIST_MAX_Q_LENGTH = 200;
export const ADMIN_LIST_MAX_PAGE_SIZE = 100;
export const ADMIN_LIST_DEFAULT_PAGE_SIZE = 20;

export interface ParsedDateRange {
  gte?: Date;
  lte?: Date;
}

export interface ParsedCentsRange {
  gte?: number;
  lte?: number;
}

export interface ParsedAdminListFilters {
  page: number;
  pageSize: number;
  /** `q` normalizada (trim); `undefined` si venía ausente/vacía/whitespace. */
  q?: string;
  /** Rango sobre `createdAt` (gte/lte); `undefined` si no se envió ni `from` ni `to`. */
  dateRange?: ParsedDateRange;
  /** Rango sobre el campo de monto del endpoint (gte/lte); `undefined` si no se envió. */
  centsRange?: ParsedCentsRange;
}

export interface RawAdminListFilters {
  page?: string;
  pageSize?: string;
  q?: string;
  from?: string;
  to?: string;
  minCents?: string;
  maxCents?: string;
}

function fail(message: string, details?: Record<string, unknown>): never {
  // 400 VALIDATION_ERROR (mismo patrón de paginación del contrato), NO 422 (regla de negocio).
  throw BusinessException.badRequest('VALIDATION_ERROR', message, details);
}

function parsePositiveInt(raw: string | undefined, def: number, field: string): number {
  if (raw === undefined || raw === '') return def;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${field} must be a positive integer`, { [field]: raw });
  }
  const n = parseInt(trimmed, 10);
  if (n < 1) fail(`${field} must be >= 1`, { [field]: n });
  return n;
}

function parseNonNegativeInt(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const trimmed = raw.trim();
  // Sólo enteros ≥ 0: '-5' y '1.5' fallan aquí → 400.
  if (!/^\d+$/.test(trimmed)) {
    fail(`${field} must be a non-negative integer`, { [field]: raw });
  }
  return parseInt(trimmed, 10);
}

// v1.25.1 (§Convenciones «Borde de día») — un valor **date-only** (`YYYY-MM-DD`, SIN componente
// horario, lo que emite un `<input type=date>`) se materializa en el borde del día en **UTC**:
// `from` = inicio de día (`00:00:00.000Z`), `to` = fin de día INCLUSIVO (`23:59:59.999Z`). Un
// datetime ISO completo (con hora/offset) se usa **tal cual** (`gte`/`lte` exactos, sin ajuste).
// Punto ÚNICO que ambos endpoints comparten → arregla M5, M3 y el caso latente de orders a la vez.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(
  raw: string | undefined,
  field: string,
  boundary: 'start' | 'end',
): Date | undefined {
  if (raw === undefined || raw === '') return undefined;
  const trimmed = raw.trim();
  if (DATE_ONLY_RE.test(trimmed)) {
    // Ancla estricta en UTC: inicio o fin de día INCLUSIVO. `new Date('YYYY-MM-DD')` ya se
    // interpreta como medianoche UTC; para `to` sumamos el resto del día (23:59:59.999).
    const iso = boundary === 'start' ? `${trimmed}T00:00:00.000Z` : `${trimmed}T23:59:59.999Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      fail(`${field} is not a valid ISO-8601 date`, { [field]: raw });
    }
    return d;
  }
  // Con componente horario (o cualquier otro formato ISO) → tal cual, sin ajuste de borde.
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    fail(`${field} is not a valid ISO-8601 date`, { [field]: raw });
  }
  return d;
}

function parseQ(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // Vacío/whitespace = ausente (sin filtro), coherente en ambos endpoints.
  if (trimmed === '') return undefined;
  if (trimmed.length > ADMIN_LIST_MAX_Q_LENGTH) {
    fail(`q must be at most ${ADMIN_LIST_MAX_Q_LENGTH} characters`, { length: trimmed.length });
  }
  return trimmed;
}

export function parseAdminListFilters(raw: RawAdminListFilters): ParsedAdminListFilters {
  const page = parsePositiveInt(raw.page, 1, 'page');
  const pageSize = parsePositiveInt(raw.pageSize, ADMIN_LIST_DEFAULT_PAGE_SIZE, 'pageSize');
  if (pageSize > ADMIN_LIST_MAX_PAGE_SIZE) {
    fail(`pageSize must be at most ${ADMIN_LIST_MAX_PAGE_SIZE}`, { pageSize });
  }

  const q = parseQ(raw.q);

  const gteDate = parseDate(raw.from, 'from', 'start');
  const lteDate = parseDate(raw.to, 'to', 'end');
  const dateRange: ParsedDateRange | undefined =
    gteDate || lteDate
      ? { ...(gteDate ? { gte: gteDate } : {}), ...(lteDate ? { lte: lteDate } : {}) }
      : undefined;

  const min = parseNonNegativeInt(raw.minCents, 'minCents');
  const max = parseNonNegativeInt(raw.maxCents, 'maxCents');
  if (min !== undefined && max !== undefined && max < min) {
    fail('maxCents must be >= minCents', { minCents: min, maxCents: max });
  }
  const centsRange: ParsedCentsRange | undefined =
    min !== undefined || max !== undefined
      ? { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) }
      : undefined;

  return { page, pageSize, q, dateRange, centsRange };
}
