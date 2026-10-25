/**
 * discount-admin-input.ts — 💰 la CONFIGURACIÓN de un código de descuento tal como la captura el dueño (API_CONTRACT §DSC.1,
 * §DSC.7). PURO: sin BD ni reloj (el `now` llega como argumento).
 *
 *  - `parseCodeCreate` / `parseBatchCreate` / `parseConfigPatch` / `parsePreview`: el cuerpo del request ⇒ valores tipados, o
 *    `422 VALIDATION_ERROR { field }` (§DSC.7: «campos por `kind`»). Un campo que la ruta no conoce ⇒ `422 { field }`: ⛔ nada
 *    se ignora en silencio (un `code` en el PATCH, un `maxTotalUses` en el lote).
 *  - `validateConfig`: la forma completa ya fusionada (los CHECK de M-92 en la aplicación, para que el dueño vea un `422` con
 *    su campo y no un `500` de Postgres). `free_shipping` con `destinations = [vault]` nunca aplicaría ⇒ `422`.
 *  - `changedFields` / `diffSnapshots`: qué cambia un PATCH (lo que decide `409 DISCOUNT_CODE_LOCKED`) y el antes → después
 *    de la bitácora (`GET …/:id/audit`).
 */
import { DiscountCodeStatus, DiscountKind, DiscountProductScope, FulfillmentMode } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { DISCOUNT_CODE_STATUS_VALUES, DISCOUNT_KIND_VALUES, DISCOUNT_PRODUCT_SCOPE_VALUES } from '../../common/enum-values';
import { MAX_CENTS } from '../../common/money';

/** §DSC.1: el texto del código, ya normalizado (trim + MAYÚSCULAS). */
export const DISCOUNT_CODE_RE = /^[A-Z0-9-]{4,20}$/;
/** §DSC.7: prefijo del lote. */
export const BATCH_PREFIX_RE = /^[A-Z0-9]{2,8}$/;
export const BATCH_MAX_QUANTITY = 500;
/** §DSC.7 preview: 1..5 líneas de muestra. */
export const PREVIEW_MAX_LINES = 5;
const PREVIEW_MAX_QUANTITY = 999;

/** El destino de un pedido (el retiro cuenta como `direct_ship`, §DSC.1). Clase E: el enum entero. */
const FULFILLMENT_MODE_VALUES = Object.values(FulfillmentMode);

/** La configuración de un código (lo que el dueño fija; ⛔ sin `code`, `status` ni sellos). */
export interface DiscountConfig {
  kind: DiscountKind;
  percentPct: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minSubtotalCents: number | null;
  productScopes: DiscountProductScope[];
  destinations: FulfillmentMode[];
  startsAt: Date;
  endsAt: Date | null;
  maxTotalUses: number | null;
  maxUsesPerCustomer: number | null;
}

export type ConfigField = keyof DiscountConfig;
export const CONFIG_FIELDS: readonly ConfigField[] = [
  'kind',
  'percentPct',
  'amountCents',
  'maxDiscountCents',
  'minSubtotalCents',
  'productScopes',
  'destinations',
  'startsAt',
  'endsAt',
  'maxTotalUses',
  'maxUsesPerCustomer',
];

/** §DSC.7 (912): lo único que se edita con `firstReservedAt ≠ null`. */
export const EDITABLE_WHEN_LOCKED: readonly string[] = ['status', 'endsAt', 'maxTotalUses'];
/** §DSC.7: en un código de lote, los límites de uso están fijos en 1 (siempre bloqueados). */
export const BATCH_FIXED_FIELDS: readonly ConfigField[] = ['maxTotalUses', 'maxUsesPerCustomer'];

function fail(field: string, message: string): never {
  throw BusinessException.validation('VALIDATION_ERROR', message, { field });
}

function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) fail('body', 'body must be a JSON object');
  return body as Record<string, unknown>;
}

function rejectUnknown(o: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(k, `${k} is not accepted here`);
}

function intOrNull(o: Record<string, unknown>, field: string, min: number, max = MAX_CENTS): number | null {
  const v = o[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(field, `${field} must be an integer in ${min}..${max}`);
  return v;
}

function dateOrNull(o: Record<string, unknown>, field: string): Date | null {
  const v = o[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.trim() === '') fail(field, `${field} must be an ISO-8601 instant`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(field, `${field} must be an ISO-8601 instant`);
  return d;
}

function enumList<T extends string>(o: Record<string, unknown>, field: string, allowed: readonly T[]): T[] {
  const v = o[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !(allowed as readonly string[]).includes(x))) {
    throw BusinessException.validation('VALIDATION_ERROR', `${field} must be a list of ${allowed.join(', ')}`, { field, allowed: [...allowed] });
  }
  if (new Set(v).size !== v.length) fail(field, `${field} must not repeat values`);
  return v as T[];
}

function kindOf(o: Record<string, unknown>): DiscountKind {
  const v = o.kind;
  if (typeof v !== 'string' || !(DISCOUNT_KIND_VALUES as readonly string[]).includes(v)) {
    throw BusinessException.validation('VALIDATION_ERROR', 'kind is required', { field: 'kind', allowed: [...DISCOUNT_KIND_VALUES] });
  }
  return v as DiscountKind;
}

/** Los campos de configuración presentes en `o` (los ausentes no se tocan; `null` limpia). */
function readConfigFields(o: Record<string, unknown>, fields: readonly ConfigField[]): Partial<DiscountConfig> {
  const out: Partial<DiscountConfig> = {};
  for (const f of fields) {
    if (!(f in o)) continue;
    switch (f) {
      case 'kind':
        out.kind = kindOf(o);
        break;
      case 'percentPct':
        out.percentPct = intOrNull(o, f, 1, 100);
        break;
      case 'amountCents':
      case 'maxDiscountCents':
      case 'minSubtotalCents':
        out[f] = intOrNull(o, f, 1);
        break;
      case 'maxTotalUses':
      case 'maxUsesPerCustomer':
        out[f] = intOrNull(o, f, 1);
        break;
      case 'productScopes':
        out.productScopes = enumList(o, f, DISCOUNT_PRODUCT_SCOPE_VALUES);
        break;
      case 'destinations':
        out.destinations = enumList(o, f, FULFILLMENT_MODE_VALUES);
        break;
      case 'startsAt': {
        const d = dateOrNull(o, f);
        if (d === null) fail(f, 'startsAt cannot be null');
        out.startsAt = d;
        break;
      }
      case 'endsAt':
        out.endsAt = dateOrNull(o, f);
        break;
    }
  }
  return out;
}

/** Los CHECK de M-92 + las reglas de §DSC.7, sobre la configuración COMPLETA (ya fusionada). */
export function validateConfig(c: DiscountConfig): void {
  if (c.kind === 'percent') {
    if (c.percentPct === null) fail('percentPct', 'percentPct is required for kind percent');
  } else if (c.percentPct !== null) fail('percentPct', 'percentPct only applies to kind percent');
  if (c.kind === 'fixed_amount') {
    if (c.amountCents === null) fail('amountCents', 'amountCents is required for kind fixed_amount');
  } else if (c.amountCents !== null) fail('amountCents', 'amountCents only applies to kind fixed_amount');
  if (c.maxDiscountCents !== null && c.kind !== 'percent') fail('maxDiscountCents', 'maxDiscountCents only applies to kind percent');
  if (c.kind === 'free_shipping' && c.destinations.length > 0 && !c.destinations.includes('direct_ship')) {
    fail('destinations', 'a free_shipping code limited to vault would never apply');
  }
  if (c.endsAt !== null && c.endsAt.getTime() <= c.startsAt.getTime()) fail('endsAt', 'endsAt must be after startsAt');
}

/** `POST /admin/discount-codes`. Ausentes ⇒ sin límite / todos; `startsAt` ⇒ ahora; `maxUsesPerCustomer` ⇒ 1 (§DSC.1). */
export function parseCodeCreate(body: unknown, now: Date): { code: string; config: DiscountConfig } {
  const o = asObject(body);
  rejectUnknown(o, ['code', ...CONFIG_FIELDS]);
  const raw = o.code;
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!DISCOUNT_CODE_RE.test(code)) fail('code', 'code must be 4..20 of A-Z, 0-9 or -');
  const p = readConfigFields(o, CONFIG_FIELDS);
  const config: DiscountConfig = {
    kind: kindOf(o),
    percentPct: p.percentPct ?? null,
    amountCents: p.amountCents ?? null,
    maxDiscountCents: p.maxDiscountCents ?? null,
    minSubtotalCents: p.minSubtotalCents ?? null,
    productScopes: p.productScopes ?? [],
    destinations: p.destinations ?? [],
    startsAt: p.startsAt ?? now,
    endsAt: p.endsAt ?? null,
    maxTotalUses: p.maxTotalUses ?? null,
    maxUsesPerCustomer: 'maxUsesPerCustomer' in o ? (p.maxUsesPerCustomer ?? null) : 1,
  };
  validateConfig(config);
  return { code, config };
}

/** `POST /admin/discount-code-batches`: config sin `code`/`maxTotalUses`/`maxUsesPerCustomer` (fijos en 1). */
export function parseBatchCreate(body: unknown, now: Date): { prefix: string; quantity: number; config: DiscountConfig } {
  const o = asObject(body);
  const fields = CONFIG_FIELDS.filter((f) => !BATCH_FIXED_FIELDS.includes(f));
  rejectUnknown(o, ['prefix', 'quantity', ...fields]);
  const prefix = typeof o.prefix === 'string' ? o.prefix.trim().toUpperCase() : '';
  if (!BATCH_PREFIX_RE.test(prefix)) fail('prefix', 'prefix must be 2..8 of A-Z or 0-9');
  const quantity = intOrNull(o, 'quantity', 1, BATCH_MAX_QUANTITY);
  if (quantity === null) fail('quantity', `quantity must be an integer in 1..${BATCH_MAX_QUANTITY}`);
  const p = readConfigFields(o, fields);
  const config: DiscountConfig = {
    kind: kindOf(o),
    percentPct: p.percentPct ?? null,
    amountCents: p.amountCents ?? null,
    maxDiscountCents: p.maxDiscountCents ?? null,
    minSubtotalCents: p.minSubtotalCents ?? null,
    productScopes: p.productScopes ?? [],
    destinations: p.destinations ?? [],
    startsAt: p.startsAt ?? now,
    endsAt: p.endsAt ?? null,
    maxTotalUses: 1,
    maxUsesPerCustomer: 1,
  };
  validateConfig(config);
  return { prefix, quantity, config };
}

/**
 * PATCH (código o lote): solo los campos PRESENTES. `allowStatus` ⇒ también `status` (el del código; el lote se pausa por su
 * verbo). Devuelve el parcial; la fusión y `validateConfig` las hace el servicio con la fila bajo candado.
 */
export function parseConfigPatch(
  body: unknown,
  opts: { allowStatus: boolean; fields?: readonly ConfigField[] },
): { config: Partial<DiscountConfig>; status?: DiscountCodeStatus } {
  const o = asObject(body);
  const fields = opts.fields ?? CONFIG_FIELDS;
  rejectUnknown(o, [...fields, ...(opts.allowStatus ? ['status'] : [])]);
  const out: { config: Partial<DiscountConfig>; status?: DiscountCodeStatus } = { config: readConfigFields(o, fields) };
  if ('status' in o) {
    if (typeof o.status !== 'string' || !(DISCOUNT_CODE_STATUS_VALUES as readonly string[]).includes(o.status)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'invalid status', { field: 'status', allowed: [...DISCOUNT_CODE_STATUS_VALUES] });
    }
    out.status = o.status as DiscountCodeStatus;
  }
  return out;
}

/** `POST /admin/discount-codes/preview`: la config del `POST` sin `code` + `sampleLines` (1..5). */
export function parsePreview(
  body: unknown,
  now: Date,
): { config: DiscountConfig; lines: { scope: DiscountProductScope; priceCents: number; quantity: number }[] } {
  const o = asObject(body);
  rejectUnknown(o, [...CONFIG_FIELDS, 'sampleLines']);
  const raw = o.sampleLines;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > PREVIEW_MAX_LINES) fail('sampleLines', `sampleLines must have 1..${PREVIEW_MAX_LINES} lines`);
  const lines = raw.map((l: unknown, i: number) => {
    const x = l !== null && typeof l === 'object' && !Array.isArray(l) ? (l as Record<string, unknown>) : null;
    const field = `sampleLines[${i}]`;
    if (!x) fail(field, `${field} must be an object`);
    const scope = x.scope;
    if (typeof scope !== 'string' || !(DISCOUNT_PRODUCT_SCOPE_VALUES as readonly string[]).includes(scope)) fail(`${field}.scope`, 'invalid scope');
    const priceCents = intOrNull(x, 'priceCents', 1);
    const quantity = intOrNull(x, 'quantity', 1, PREVIEW_MAX_QUANTITY);
    if (priceCents === null) fail(`${field}.priceCents`, 'priceCents is required');
    if (quantity === null) fail(`${field}.quantity`, 'quantity is required');
    return { scope: scope as DiscountProductScope, priceCents, quantity };
  });
  const { config } = parseCodeCreate({ ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'sampleLines')), code: 'PREVIEW' }, now);
  return { config, lines };
}

/** Fusiona el parcial sobre la configuración vigente (⛔ sin validar: lo hace `validateConfig`). */
export function mergeConfig(current: DiscountConfig, patch: Partial<DiscountConfig>): DiscountConfig {
  return { ...current, ...patch };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return [...v].map(normalize).sort();
  return v ?? null;
}

/** Los campos del parcial cuyo valor CAMBIA respecto a la fila (reenviar el mismo valor no es editar). */
export function changedFields(current: Record<string, unknown>, patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter((k) => !sameValue(current[k], patch[k]));
}

/** La foto de la configuración que guarda la bitácora (fechas ISO; ⛔ sin PII: la config no lo es, §DSC.7). */
export function configSnapshot(row: DiscountConfig & { status: DiscountCodeStatus; archivedAt?: Date | null }): Record<string, unknown> {
  return {
    kind: row.kind,
    percentPct: row.percentPct,
    amountCents: row.amountCents,
    maxDiscountCents: row.maxDiscountCents,
    minSubtotalCents: row.minSubtotalCents,
    productScopes: [...row.productScopes],
    destinations: [...row.destinations],
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    maxTotalUses: row.maxTotalUses,
    maxUsesPerCustomer: row.maxUsesPerCustomer,
    status: row.status,
    ...(row.archivedAt !== undefined ? { archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null } : {}),
  };
}

/** `changes[]` de `GET …/:id/audit`: los campos cuyo valor difiere entre `before` y `after` (alta ⇒ todos con `before: null`). */
export function diffSnapshots(before: unknown, after: unknown): { field: string; before: unknown; after: unknown }[] {
  const b = before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  return keys.filter((k) => !sameValue(b[k], a[k])).map((k) => ({ field: k, before: b[k] ?? null, after: a[k] ?? null }));
}
