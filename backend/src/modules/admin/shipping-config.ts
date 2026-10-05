/**
 * shipping-config.ts — D2f: la validación PURA de los cuerpos de M10 «Envíos» (API_CONTRACT §19.13, §19.19.6, §19.22.3).
 *
 *  - `PUT /admin/shipping/packages`: `{ packages: ShippingPackageDTO[] }`, reemplazo entero. Forma ⇒ `400 VALIDATION_ERROR
 *    {field, index}` (`weightKg` entero ≥ 1, medidas enteras ≥ 1 — las columnas son `Int` —, `code` repetido, `active`
 *    booleano, `sortOrder` entero); sin ningún activo con `providerPackageType` no vacío ⇒ `400 {field:'packages',
 *    reason:'no_active_package'}` (⛔ `422`: es validación del cuerpo). `providerPackageType: null` se admite como «sin código»
 *    (`''`, la columna no es nula) — el tipo del frontend lo permite.
 *  - `GET …/catalogs/consignment-notes?description=`: 3..60 tras trim ⇒ si no, `400 {field:'description'}`.
 */
import { BusinessException } from '../../common/business.exception';

export interface ShippingPackageDTO {
  code: string;
  label: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  providerPackageType: string;
  active: boolean;
  sortOrder: number;
}

export const MAX_PACKAGES = 50;
const CODE_MAX = 40;
const LABEL_MAX = 80;
const PROVIDER_TYPE_MAX = 20;
const DIM_MAX = 1000;

const bad = (field: string, extra: Record<string, unknown> = {}) =>
  BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field}`, { field, ...extra });

const isPosInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;

function text(v: unknown, max: number, allowEmpty: boolean): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if ((!allowEmpty && t.length === 0) || t.length > max) return null;
  return t;
}

export function parsePackagesBody(body: unknown): ShippingPackageDTO[] {
  const list = body !== null && typeof body === 'object' ? (body as { packages?: unknown }).packages : undefined;
  if (!Array.isArray(list) || list.length > MAX_PACKAGES) throw bad('packages');
  const out: ShippingPackageDTO[] = [];
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad('packages', { index });
    const r = raw as Record<string, unknown>;
    const code = text(r.code, CODE_MAX, false);
    if (code === null) throw bad('code', { index });
    if (seen.has(code)) throw bad('code', { index });
    seen.add(code);
    const label = text(r.label, LABEL_MAX, false);
    if (label === null) throw bad('label', { index });
    for (const f of ['lengthCm', 'widthCm', 'heightCm'] as const) if (!isPosInt(r[f], DIM_MAX)) throw bad(f, { index });
    if (!isPosInt(r.weightKg, DIM_MAX)) throw bad('weightKg', { index });
    const providerPackageType = r.providerPackageType === null ? '' : text(r.providerPackageType, PROVIDER_TYPE_MAX, true);
    if (providerPackageType === null) throw bad('providerPackageType', { index });
    if (typeof r.active !== 'boolean') throw bad('active', { index });
    if (typeof r.sortOrder !== 'number' || !Number.isInteger(r.sortOrder) || Math.abs(r.sortOrder) > 1_000_000) throw bad('sortOrder', { index });
    out.push({
      code,
      label,
      lengthCm: r.lengthCm as number,
      widthCm: r.widthCm as number,
      heightCm: r.heightCm as number,
      weightKg: r.weightKg as number,
      providerPackageType,
      active: r.active,
      sortOrder: r.sortOrder,
    });
  });
  if (!out.some((p) => p.active && p.providerPackageType.length > 0)) throw bad('packages', { reason: 'no_active_package' });
  return out;
}

export function parseConsignmentDescription(q: unknown): string {
  const t = typeof q === 'string' ? q.trim() : '';
  if (t.length < 3 || t.length > 60) throw bad('description');
  return t;
}
