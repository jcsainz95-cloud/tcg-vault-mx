/**
 * accessory-input.ts — validación PURA de los cuerpos del panel (API_CONTRACT §AC.11). Forma ⇒ `400 VALIDATION_ERROR
 * {field}`. Los rangos son los de los CHECK de M-73 (`BACKEND_NOTES §83.2`): mejor un `400` con el campo que un `23514`.
 *
 *  - Campos ★ (`priceCents`, `unitCostCents`, `suggested`; en el alta también `active`): se devuelven aparte para que el
 *    servicio responda `403 FORBIDDEN_FIELD {fields}` al operador ANTES de escribir nada. «Mandar» = la llave está en el
 *    cuerpo con cualquier valor distinto de `undefined` (también `null`).
 *  - Llaves desconocidas: se ignoran (como `main.ts:54`).
 *  - Existencias: `{kind:'receive', quantity: 1..10000, note?}` o `{kind:'adjust', newStockQty ≥ 0, expectedStockQty ≥ 0,
 *    reason: 3..200 tras trim}`.
 */
import { AccessoryCategory, EnergyType } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { ACCESSORY_CATEGORY_VALUES, ENERGY_TYPE_VALUES } from '../../common/enum-values';
import { parseEnumFilter } from '../../common/enum-filter';

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 500;
export const DIM_MAX_MM = 2000;
export const WEIGHT_MAX_G = 50_000;
export const PRICE_MAX_CENTS = 100_000_000;
export const COST_MAX_CENTS = 100_000_000;
export const RECEIVE_MAX = 10_000;
export const STOCK_MAX = 1_000_000_000;
export const REASON_MIN = 3;
export const REASON_MAX = 200;

export const STAR_FIELDS_CREATE = ['priceCents', 'unitCostCents', 'suggested', 'active'] as const;
export const STAR_FIELDS_PATCH = ['priceCents', 'unitCostCents', 'suggested'] as const;

export const bad = (field: string, extra: Record<string, unknown> = {}) =>
  BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field}`, { field, ...extra });

/** Lo editable de un accesorio (sin `active`, que tiene sus verbos). `undefined` ⇒ no viene en el cuerpo. */
export interface AccessoryFields {
  name?: string;
  description?: string | null;
  category?: AccessoryCategory;
  energyType?: EnergyType | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  weightG?: number | null;
  priceCents?: number | null;
  unitCostCents?: number | null;
  suggested?: boolean;
}

export const FIELD_ORDER: (keyof AccessoryFields)[] = [
  'name',
  'description',
  'category',
  'energyType',
  'lengthMm',
  'widthMm',
  'heightMm',
  'weightG',
  'priceCents',
  'unitCostCents',
  'suggested',
];

function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('body');
  return body as Record<string, unknown>;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function intOrNull(o: Record<string, unknown>, k: string, min: number, max: number): number | null | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!isInt(v) || v < min || v > max) throw bad(k);
  return v;
}

/** Los campos ★ presentes en el cuerpo (orden fijo). */
export function starFieldsIn(body: unknown, which: readonly string[]): string[] {
  const o = body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return which.filter((k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined);
}

export function parseAccessoryFields(body: unknown, mode: 'create' | 'patch'): AccessoryFields {
  const o = asObject(body);
  const out: AccessoryFields = {};
  if (o.name !== undefined || mode === 'create') {
    if (typeof o.name !== 'string') throw bad('name');
    const t = o.name.trim();
    if (t.length < 1 || t.length > NAME_MAX) throw bad('name');
    out.name = t;
  }
  if (o.description !== undefined) {
    if (o.description === null) out.description = null;
    else if (typeof o.description !== 'string') throw bad('description');
    else {
      const t = o.description.trim();
      if (t.length > DESCRIPTION_MAX) throw bad('description');
      out.description = t.length === 0 ? null : t;
    }
  }
  if (o.category !== undefined || mode === 'create') {
    if (typeof o.category !== 'string' || !(ACCESSORY_CATEGORY_VALUES as readonly string[]).includes(o.category)) throw bad('category');
    out.category = o.category as AccessoryCategory;
  }
  if (o.energyType !== undefined) {
    if (o.energyType === null) out.energyType = null;
    else if (typeof o.energyType !== 'string' || !(ENERGY_TYPE_VALUES as readonly string[]).includes(o.energyType)) throw bad('energyType');
    else out.energyType = o.energyType as EnergyType;
  }
  for (const k of ['lengthMm', 'widthMm', 'heightMm'] as const) {
    const v = intOrNull(o, k, 1, DIM_MAX_MM);
    if (v !== undefined) out[k] = v;
  }
  const w = intOrNull(o, 'weightG', 1, WEIGHT_MAX_G);
  if (w !== undefined) out.weightG = w;
  const p = intOrNull(o, 'priceCents', 1, PRICE_MAX_CENTS);
  if (p !== undefined) out.priceCents = p;
  const c = intOrNull(o, 'unitCostCents', 0, COST_MAX_CENTS);
  if (c !== undefined) out.unitCostCents = c;
  if (o.suggested !== undefined) {
    if (typeof o.suggested !== 'boolean') throw bad('suggested');
    out.suggested = o.suggested;
  }
  return out;
}

/** Reglas entre campos sobre la fila YA combinada (los CHECK `accessory_energy_type` y `accessory_energy_not_suggested`). */
export function assertCoherent(r: { category: AccessoryCategory; energyType: EnergyType | null; suggested: boolean }): void {
  if ((r.category === 'energy') !== (r.energyType !== null)) throw bad('energyType');
  if (r.category === 'energy' && r.suggested) throw bad('suggested');
}

export type StockBody =
  | { kind: 'receive'; quantity: number; note: string | null }
  | { kind: 'adjust'; newStockQty: number; expectedStockQty: number; reason: string };

export function parseStockBody(body: unknown): StockBody {
  const o = asObject(body);
  if (o.kind === 'receive') {
    if (!isInt(o.quantity) || o.quantity < 1 || o.quantity > RECEIVE_MAX) throw bad('quantity');
    let note: string | null = null;
    if (o.note !== undefined && o.note !== null) {
      if (typeof o.note !== 'string') throw bad('note');
      const t = o.note.trim();
      if (t.length > REASON_MAX) throw bad('note');
      note = t.length === 0 ? null : t;
    }
    return { kind: 'receive', quantity: o.quantity, note };
  }
  if (o.kind === 'adjust') {
    if (typeof o.reason !== 'string') throw bad('reason');
    const reason = o.reason.trim();
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) throw bad('reason');
    if (!isInt(o.newStockQty) || o.newStockQty < 0 || o.newStockQty > STOCK_MAX) throw bad('newStockQty');
    if (!isInt(o.expectedStockQty) || o.expectedStockQty < 0 || o.expectedStockQty > STOCK_MAX) throw bad('expectedStockQty');
    // «Ajuste sin cambio» ⇒ 400 (el CHECK `accessory_movement_delta` exige delta ≠ 0).
    if (o.newStockQty === o.expectedStockQty) throw bad('newStockQty', { reason: 'no_change' });
    return { kind: 'adjust', newStockQty: o.newStockQty, expectedStockQty: o.expectedStockQty, reason };
  }
  throw bad('kind');
}

// ------------------------------------------------------------------ consultas

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s);

function single(q: Record<string, unknown>, k: string): string | undefined {
  const v = q[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw bad(k);
  return v;
}

function intParam(q: Record<string, unknown>, k: string, def: number, min: number, max: number): number {
  const v = single(q, k);
  if (v === undefined || v === '') return def;
  if (!/^\d+$/.test(v)) throw bad(k);
  const n = Number(v);
  if (n < min || n > max) throw bad(k);
  return n;
}

function boolParam(q: Record<string, unknown>, k: string): boolean | undefined {
  const v = single(q, k);
  if (v === undefined || v === '') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw bad(k);
}

export const Q_MAX = 60;

export interface CatalogQuery {
  category?: AccessoryCategory;
  q?: string;
  page: number;
  pageSize: number;
}

function baseQuery(raw: unknown, pageSizeDefault: number, pageSizeMax: number): CatalogQuery {
  const q = (raw ?? {}) as Record<string, unknown>;
  const out: CatalogQuery = { page: intParam(q, 'page', 1, 1, 100_000), pageSize: intParam(q, 'pageSize', pageSizeDefault, 1, pageSizeMax) };
  // §0-Q (clase E, `AccessoryCategory`): ausente/vacío/solo espacios ⇒ no filtra; fuera del enum ⇒ `400 {field, allowed}`
  // (helper único; ⛔ sin `echoValue`, eje nuevo). Antes: `400 {field}` sin `allowed` y `'  '` ⇒ `400` (BACKEND_NOTES §83.ceq1).
  const cat = parseEnumFilter('category', q.category, ACCESSORY_CATEGORY_VALUES);
  if (cat !== undefined) out.category = cat;
  const text = single(q, 'q');
  if (text !== undefined) {
    const t = text.trim();
    if (t.length > Q_MAX) throw bad('q');
    if (t.length > 0) out.q = t;
  }
  return out;
}

/** `GET /accessories?category=&q=&page=1&pageSize=24` (pageSize ≤ 60). */
export const parsePublicQuery = (raw: unknown): CatalogQuery => baseQuery(raw, 24, 60);

export interface AdminQuery extends CatalogQuery {
  active?: boolean;
  soldOut?: boolean;
}

/** `GET /admin/accessories?category=&q=&active=&soldOut=&page=` (pageSize por defecto 50, ≤ 100). */
export function parseAdminQuery(raw: unknown): AdminQuery {
  const q = (raw ?? {}) as Record<string, unknown>;
  return { ...baseQuery(raw, 50, 100), active: boolParam(q, 'active'), soldOut: boolParam(q, 'soldOut') };
}

export const EXCLUDE_MAX = 50;

/** `exclude=<id>,<id>` ≤ 50 uuid; si no ⇒ 400. */
export function parseExclude(raw: unknown): string[] {
  if (raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') throw bad('exclude');
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length > EXCLUDE_MAX || !ids.every(isUuid)) throw bad('exclude');
  return [...new Set(ids.map((s) => s.toLowerCase()))];
}

/** `ILIKE` con `%` y `_` literales (escape `\`). */
export const ilikeContains = (s: string): string => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
