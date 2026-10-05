/**
 * redact.ts — 🔒 `redactProviderPayload`: lo que se persiste o se loguea de una respuesta de Skydropx pasa por una
 * LISTA BLANCA de claves conservadas (API_CONTRACT §M4-SHIP.19.4 (5), SEC-SDX-6/7). Todo lo demás ⇒ `«…»`.
 *
 * ⛔ No es una lista negra (`phone,email,…`): la lista negra no cubría `company`/`further_information` ni un renombre
 * del proveedor. Con lista blanca, un campo nuevo sale redactado hasta que alguien decida conservarlo.
 */
export const REDACTED = '«…»';

/** Contenedores que se recorren (su contenido se filtra con la misma lista). */
const CONTAINER_KEYS = new Set([
  'data',
  'attributes',
  'included',
  'rates',
  'packages',
  'parcels',
  'meta',
  'error_detail',
  'error_messages',
  'extra_fees',
  'relationships',
  'quotation_scope',
  'events',
  'tracking_events',
]);

/** Hojas que se conservan: ids, estados, códigos, importes, fechas, transportista, servicio, días, guía, URLs. */
const LEAF_KEYS = new Set([
  'id',
  'type',
  'status',
  'success',
  'is_completed',
  'workflow_status',
  'payment_status',
  'shipment_status',
  'tracking_status',
  'code',
  'error_code',
  'error_type',
  'rate_type',
  'carrier_name',
  'provider_name',
  'provider_display_name',
  'provider_service_name',
  'provider_service_code',
  'service',
  'service_name',
  'service_code',
  'currency',
  'currency_code',
  'amount',
  'value',
  'vat_fee',
  'service_fee',
  'total',
  'external_price',
  'balance',
  'declared_value',
  'package_protected',
  'protection_value',
  'protection_value_total',
  'total_value_with_protection',
  'days',
  'pickup',
  'pickup_via_support',
  'office_delivery_only',
  'shipment_creation_type',
  'plan_type',
  'package_number',
  'weight',
  'length',
  'width',
  'height',
  'tracking_number',
  'master_tracking_number',
  'label_url',
  'tracking_url',
  'tracking_url_provider',
  'created_at',
  'updated_at',
  'current_page',
  'next_page',
  'total_pages',
  'total_count',
  'charge_type',
  'refunded_amount',
]);

function isKept(key: string): boolean {
  return LEAF_KEYS.has(key) || /_id$/.test(key) || /_at$/.test(key);
}

export function redactProviderPayload(value: unknown): unknown {
  return redactNode(value, 0);
}

function redactNode(value: unknown, depth: number): unknown {
  if (depth > 12) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactNode(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CONTAINER_KEYS.has(k)) out[k] = redactNode(v, depth + 1);
      else if (isKept(k) && (v === null || typeof v !== 'object')) out[k] = v;
      else out[k] = REDACTED;
    }
    return out;
  }
  return value;
}
