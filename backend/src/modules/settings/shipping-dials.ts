/**
 * shipping-dials.ts — ⭐💰 los 12 diales de Skydropx (API_CONTRACT §M4-SHIP.19.19.12, que sustituye la tabla de §19.2;
 * §19.19.5 seguro, §19.19.6 Carta Porte, §19.19.7 puerta de compra). Pieza D2a, M-66 = `M-SDX-D`. Propiedad: backend.
 *
 * PURO, sin infra: seeds y validadores. Los cablea `settings.constants.ts` en las cuatro tablas (`SettingKey`,
 * `SETTING_DEFAULTS`, `SETTING_VALIDATORS`, `SETTING_DTO_MAP`). Todos son `super_admin` y auditados como todo dial
 * (el `PUT /admin/settings` ya es `@Roles(super_admin)` y audita dentro de su transacción).
 *
 * Valores del dueño, con su fila de `HECHOS.md`:
 *   · Carta Porte `49101600` «Coleccionables» — `HECHOS.md:48` («son coleccionables», 2026-10-04).
 *   · Seguro: «siempre se asegura, y se paga el escalón que cubra» — `HECHOS.md:48` («si es un pedido de menos de
 *     2500 el 25 y así»). Cifras medidas: cobertura $2,500 ⇒ $25; $10,000 ⇒ $170 (PROD §4.4, 2026-10-04).
 *   · Dial `shipping_label_purchase`, seed `disabled`: «arranca apagado y lo enciende el dueño» — `HECHOS.md:58`
 *     (que sustituye la nota de `:49`; «también el personal» compra y cancela). Los tres modos de
 *     `SHIPPING_LABEL_PURCHASE_VALUES`, `operators` incluido, por la errata v1.80.12.6 (§19.26.6).
 * El resto de seeds son del contrato (§19.19.12), no decisiones del dueño.
 */

export const SHIPPING_PROVIDER_VALUES = ['off', 'skydropx'] as const;
export type ShippingProviderDial = (typeof SHIPPING_PROVIDER_VALUES)[number];

/** §19.19.7 — la primera llave de la puerta de compra. Seed `disabled` (FAIL-CLOSED). */
export const SHIPPING_LABEL_PURCHASE_VALUES = ['disabled', 'super_admin_only', 'operators'] as const;
export type ShippingLabelPurchaseDial = (typeof SHIPPING_LABEL_PURCHASE_VALUES)[number];

export const SHIPPING_LABEL_FORMAT_VALUES = ['standard', 'thermal'] as const;

/** §19.2 — la forma del snapshot de origen (lo que el dueño capturó). ⛔ Ninguna otra clave. */
export const ORIGIN_SNAPSHOT_KEYS = [
  'name',
  'company',
  'street1',
  'postalCode',
  'areaLevel1',
  'areaLevel2',
  'areaLevel3',
  'phone',
  'email',
  'reference',
] as const;

/** §19.19.5 — un escalón de seguro. */
export interface InsuranceTier {
  coverageCents: number;
  costCents: number;
  /** ISO (fecha o fecha-hora): de cuándo es la cifra. */
  measuredAt: string;
}

/** Seed medido (PROD §4.4, 2026-10-04; regla `HECHOS.md:48`). Los intermedios los añade el súper-admin con `M-PRD-1`. */
export const DEFAULT_SHIPPING_INSURANCE_TIERS: readonly InsuranceTier[] = [
  { coverageCents: 250000, costCents: 2500, measuredAt: '2026-10-04' },
  { coverageCents: 1000000, costCents: 17000, measuredAt: '2026-10-04' },
];

/** §19.19.12 — seed de las sucursales de entrega (llave = `provider_name`, M-10). **Sin confirmar** (T3). */
export const DEFAULT_SHIPPING_DROPOFF_POINTS: Readonly<Record<string, { name: string; address: string }>> = {
  ninetynineminutes: {
    name: 'Punto99 · Periférico Sur 4249',
    address: 'Av. Periférico Sur 4249, Jardines de la Montaña, 14210 CDMX',
  },
};

/** Cotas que el contrato no fija (BACKEND_NOTES §61.5): textos cortos de configuración, no PII del cliente. */
const CARRIER_NAME_MAX = 64;
const SNAPSHOT_FIELD_MAX = 200;
const DROPOFF_FIELD_MAX = 200;
const DROPOFF_MAX_ENTRIES = 20;

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function nonBlankString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
const oneOf =
  (values: readonly string[]) =>
  (v: unknown): string | null =>
    typeof v === 'string' && values.includes(v) ? null : `must be one of ${values.join('|')}`;

export const validateShippingProvider = oneOf(SHIPPING_PROVIDER_VALUES);
export const validateShippingLabelPurchase = oneOf(SHIPPING_LABEL_PURCHASE_VALUES);
export const validateShippingLabelFormat = oneOf(SHIPPING_LABEL_FORMAT_VALUES);

/** `skydropx_origin_address_template_id`: string ≤ 64 o `null` (no vacía: `null` es «sin configurar»). */
export function validateOriginTemplateId(v: unknown): string | null {
  if (v === null) return null;
  return nonBlankString(v, 64) ? null : 'must be a non-empty string of at most 64 characters, or null';
}

/** `skydropx_origin_snapshot`: objeto con claves ⊆ las diez de §19.2 (cada una string ≤ 200 o null), o `null`. */
export function validateOriginSnapshot(v: unknown): string | null {
  if (v === null) return null;
  if (!isPlainObject(v)) return 'must be an object or null';
  for (const [k, val] of Object.entries(v)) {
    if (!(ORIGIN_SNAPSHOT_KEYS as readonly string[]).includes(k)) return `unknown key '${k}' (allowed: ${ORIGIN_SNAPSHOT_KEYS.join(', ')})`;
    if (val !== null && !(typeof val === 'string' && val.length <= SNAPSHOT_FIELD_MAX)) {
      return `'${k}' must be a string of at most ${SNAPSHOT_FIELD_MAX} characters, or null`;
    }
  }
  return null;
}

/** `shipping_preferred_carriers`: `string[]` de `provider_name`, 0..10, sin repetidos. */
export function validatePreferredCarriers(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > 10) return 'must be an array of 0..10 carrier names';
  if (!v.every((x) => nonBlankString(x, CARRIER_NAME_MAX))) return `each carrier must be a non-empty string of at most ${CARRIER_NAME_MAX} characters`;
  if (new Set(v).size !== v.length) return 'carrier names must not repeat';
  return null;
}

/** `shipping_dropoff_points`: `Record<provider_name, { name, address }>` (las dos claves, no vacías). */
export function validateDropoffPoints(v: unknown): string | null {
  if (!isPlainObject(v)) return 'must be an object keyed by carrier name';
  const entries = Object.entries(v);
  if (entries.length > DROPOFF_MAX_ENTRIES) return `at most ${DROPOFF_MAX_ENTRIES} carriers`;
  for (const [carrier, point] of entries) {
    if (!nonBlankString(carrier, CARRIER_NAME_MAX)) return 'carrier keys must be non-empty names';
    if (!isPlainObject(point)) return `'${carrier}' must be { name, address }`;
    const keys = Object.keys(point).sort();
    if (keys.length !== 2 || keys[0] !== 'address' || keys[1] !== 'name') return `'${carrier}' must have exactly { name, address }`;
    if (!nonBlankString(point.name, DROPOFF_FIELD_MAX) || !nonBlankString(point.address, DROPOFF_FIELD_MAX)) {
      return `'${carrier}' name and address must be non-empty strings of at most ${DROPOFF_FIELD_MAX} characters`;
    }
  }
  return null;
}

/** `shipping_consignment_note`: `^\d{8}$` (§19.19.6; ⛔ ya no admite `null`). PS-97: `'4910160'` ⇒ 422. */
export function validateConsignmentNote(v: unknown): string | null {
  return typeof v === 'string' && /^\d{8}$/.test(v) ? null : 'must be an 8-digit SAT code (^\\d{8}$)';
}

export const validateIntRange =
  (min: number, max: number) =>
  (v: unknown): string | null =>
    isInt(v) && v >= min && v <= max ? null : `must be an integer in [${min}, ${max}]`;

/** ISO 8601: `YYYY-MM-DD` o fecha-hora completa, y que sea una fecha real. */
function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.test(v)) return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  // `Date.parse('2026-02-30')` no falla en todos los motores: se comprueba que el día existe.
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  const back = new Date(Date.UTC(y, m - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

/**
 * `shipping_insurance_tiers` (§19.19.5): 1..20 filas `{ coverageCents, costCents, measuredAt }`; `coverageCents` entero
 * ESTRICTAMENTE creciente y ≥ 100; `costCents` entero ≥ 0; `measuredAt` ISO; ninguna otra clave. PS-96: escalones no
 * crecientes ⇒ `422`.
 */
export function validateInsuranceTiers(v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 20) return 'must be an array of 1..20 tiers';
  let prev = -Infinity;
  for (let i = 0; i < v.length; i++) {
    const t = v[i];
    if (!isPlainObject(t)) return `tier ${i} must be { coverageCents, costCents, measuredAt }`;
    const keys = Object.keys(t).sort();
    if (keys.join(',') !== 'costCents,coverageCents,measuredAt') return `tier ${i} must have exactly { coverageCents, costCents, measuredAt }`;
    if (!isInt(t.coverageCents) || t.coverageCents < 100) return `tier ${i}: coverageCents must be an integer >= 100`;
    if (!isInt(t.costCents) || t.costCents < 0) return `tier ${i}: costCents must be an integer >= 0`;
    if (!isIsoDate(t.measuredAt)) return `tier ${i}: measuredAt must be an ISO date`;
    if (!(t.coverageCents > prev)) return `tier ${i}: coverageCents must be strictly increasing`;
    prev = t.coverageCents;
  }
  return null;
}

/**
 * §19.19.6 — seeds de `ShippingPackage` (no son diales: filas de su tabla; viven aquí para que la migración M-66, `seed.ts`
 * y su candado lean UNA lista). Medidas «ESTIMADO» del plan del panel (el dueño las corrige en M10); códigos medidos
 * (PROD §5.2). ⚠️ Que ampm acepte `5H4` al COMPRAR es NO MEDIDO (PROD §4.5).
 */
/** §19.29.8 — los códigos de aviso de gasto que `spend_alerts_disabled` puede apagar (`'AG-1'…'AG-13'` en D2). */
export const SPEND_ALERT_CODES = Array.from({ length: 13 }, (_, i) => `AG-${i + 1}`);

/** `spend_alerts_disabled`: `string[]` sin repetidos ⊆ `SPEND_ALERT_CODES`. Seed `[]` (todos encendidos, `PROJECT §Z.0.1`). */
export function validateSpendAlertsDisabled(v: unknown): string | null {
  if (!Array.isArray(v)) return 'must be an array of alert codes';
  if (!v.every((x) => typeof x === 'string' && SPEND_ALERT_CODES.includes(x))) return `each code must be one of ${SPEND_ALERT_CODES.join('|')}`;
  if (new Set(v).size !== v.length) return 'codes must not repeat';
  return null;
}

/** Entero ≥ 0 (montos de aviso en centavos). */
export function validateNonNegIntCents(v: unknown): string | null {
  return isInt(v) && v >= 0 ? null : 'must be an integer >= 0 (cents)';
}

export const DEFAULT_SHIPPING_PACKAGES = [
  { code: 'envelope', label: 'Sobre', lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1, providerPackageType: '5H4', active: true, sortOrder: 0 },
  { code: 'box', label: 'Caja', lengthCm: 49, widthCm: 23, heightCm: 21, weightKg: 5, providerPackageType: '4G', active: true, sortOrder: 1 },
] as const;
