/**
 * rate-normalization.ts — 💰 de la cotización de Skydropx a `ProviderRate[]` (API_CONTRACT §M4-SHIP.19.19.4, PS-94).
 * Funciones PURAS: el adaptador real y el `FakeShippingProvider` pasan por aquí, así que el doble no puede divergir
 * del real en el filtro ni en el redondeo.
 *
 * Filtro (cada descarte suma a `excluded`, una sola vez por tarifa):
 *   1. `status === 'no_coverage'` ⇒ `noCoverage`; `status === 'not_applicable'` ⇒ `notApplicable`.
 *   2. `success !== true` ⇒ `unavailable` (J&T: llega con precio y `success:false`, M-11 — 45 de 45).
 *   3. `status ∉ {price_found_internal, price_found_external}` ⇒ `unavailable` (p. ej. `pending` de una cotización
 *      que no completó).
 *   4. `shipment_creation_type !== 'single'` ⇒ `multipackage`.
 *   5. `total`/`amount`/`service_fee` ilegibles o el desglose no cuadra
 *      (`|amount + Σextra + vat_fee + service_fee − total| > 1 centavo`) ⇒ `breakdownMismatch` + log `warn`.
 *
 * ⚠️ Orden distinto del literal del contrato (que pone `success` primero): en la API MEDIDA las tarifas
 * `no_coverage` llegan con `success:false` (PROD §4.6), así que con `success` primero `noCoverage` y
 * `notApplicable` serían SIEMPRE 0. Ver `BACKEND_NOTES §57` (reportado al arquitecto).
 *
 * Con `vat_fee: null` el desglose no se puede comprobar (falta un sumando): la tarifa se ofrece y el IVA lo calcula
 * el dominio con 16/116 (`ivaSource:'computed'`, PS-70 corregida).
 */
import { decimalToCents, sumDecimalsToCents } from './decimal-cents';
import { ExcludedRateCounts, InsuranceEcho, ProviderRate } from './shipping-provider.port';

const PRICED_STATUSES = new Set(['price_found_internal', 'price_found_external']);

export function emptyExcluded(): ExcludedRateCounts {
  return { unavailable: 0, noCoverage: 0, notApplicable: 0, multipackage: 0, breakdownMismatch: 0 };
}

export interface NormalizeOptions {
  /** `true` ⇒ `insuranceCents = protection_value_total`; `false` ⇒ `null` (el dominio usa la tabla). */
  insuranceEchoOk: boolean;
  onBreakdownMismatch?: (rateId: string) => void;
}

export interface NormalizedRates {
  rates: ProviderRate[];
  excluded: ExcludedRateCounts;
}

export function normalizeRates(rawRates: unknown, options: NormalizeOptions): NormalizedRates {
  const excluded = emptyExcluded();
  const rates: ProviderRate[] = [];
  if (!Array.isArray(rawRates)) return { rates, excluded };
  for (const raw of rawRates) {
    if (!raw || typeof raw !== 'object') {
      excluded.unavailable += 1;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const status = typeof r.status === 'string' ? r.status : null;
    if (status === 'no_coverage') {
      excluded.noCoverage += 1;
      continue;
    }
    if (status === 'not_applicable') {
      excluded.notApplicable += 1;
      continue;
    }
    if (r.success !== true || status === null || !PRICED_STATUSES.has(status)) {
      excluded.unavailable += 1;
      continue;
    }
    if (r.shipment_creation_type !== 'single') {
      excluded.multipackage += 1;
      continue;
    }
    const rateId = typeof r.id === 'string' && r.id ? r.id : null;
    const amountCents = decimalToCents(r.amount);
    const totalCents = decimalToCents(r.total);
    const serviceFeeCents = r.service_fee === null || r.service_fee === undefined ? 0 : decimalToCents(r.service_fee);
    const vatCents = r.vat_fee === null || r.vat_fee === undefined ? null : decimalToCents(r.vat_fee);
    const vatUnreadable = r.vat_fee !== null && r.vat_fee !== undefined && vatCents === null;
    const extraFeesCents = extraFeesToCents(r.extra_fees);
    if (
      rateId === null ||
      amountCents === null ||
      totalCents === null ||
      serviceFeeCents === null ||
      extraFeesCents === null ||
      vatUnreadable ||
      (vatCents !== null && Math.abs(amountCents + extraFeesCents + vatCents + serviceFeeCents - totalCents) > 1)
    ) {
      excluded.breakdownMismatch += 1;
      options.onBreakdownMismatch?.(rateId ?? '(sin id)');
      continue;
    }
    const insuranceCents = options.insuranceEchoOk ? decimalToCents(r.protection_value_total) : null;
    rates.push({
      rateId,
      carrierName: str(r.provider_name) ?? '',
      carrierLabel: str(r.provider_display_name) ?? str(r.provider_name) ?? '',
      serviceName: str(r.provider_service_name) ?? '',
      serviceCode: str(r.provider_service_code),
      amountCents,
      extraFeesCents,
      vatCents,
      serviceFeeCents,
      totalCents,
      insuranceCents,
      days: typeof r.days === 'number' && Number.isInteger(r.days) ? r.days : null,
      deliveryKind: r.office_delivery_only === true ? 'branch' : r.office_delivery_only === false ? 'home' : 'unknown',
      pickup: typeof r.pickup === 'boolean' ? r.pickup : null,
      pickupViaSupport: typeof r.pickup_via_support === 'boolean' ? r.pickup_via_support : null,
      creationType: 'single',
      planType: str(r.plan_type),
    });
  }
  return { rates, excluded };
}

/** `extra_fees[].value` (número de 4–5 decimales) se SUMAN en decimal y se redondea una vez (PS-94: 0.7315 ⇒ 73). */
function extraFeesToCents(fees: unknown): number | null {
  if (fees === null || fees === undefined) return 0;
  if (!Array.isArray(fees)) return null;
  const values = fees.map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>).value : undefined));
  return sumDecimalsToCents(values);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Eco del seguro (M-5): `packages[0]` debe decir protegido y `declared_value == coverage`. Ausente ⇒ no coincide. */
export function insuranceEchoOf(packages: unknown, coverageCents: number): InsuranceEcho {
  const first = Array.isArray(packages) && packages.length > 0 ? packages[0] : null;
  if (!first || typeof first !== 'object') {
    return { ok: false, echoedProtected: null, echoedDeclaredValueCents: null };
  }
  const p = first as Record<string, unknown>;
  const echoedProtected = typeof p.package_protected === 'boolean' ? p.package_protected : null;
  const echoedDeclaredValueCents = decimalToCents(p.declared_value);
  return {
    ok: echoedProtected === true && echoedDeclaredValueCents === coverageCents,
    echoedProtected,
    echoedDeclaredValueCents,
  };
}

/**
 * La recomendada (§19.19.4): la primera de `preferredCarriers` (códigos `provider_name`) con una tarifa ofrecida y
 * `deliveryKind ≠ 'branch'` — si tiene varios servicios, el más barato; si ninguna, la más barata con
 * `deliveryKind ≠ 'branch'`; si ninguna, `null`. «Precio» = `priceCents` (total + seguro) que da el llamador.
 * Con el seed, 99minutos es la recomendada AUNQUE cueste más (decisión 2, `HECHOS.md:35`).
 */
export function pickRecommendedRateId(
  rates: readonly { rateId: string; carrierName: string; deliveryKind: ProviderRate['deliveryKind']; priceCents: number }[],
  preferredCarriers: readonly string[],
): string | null {
  const eligible = rates.filter((r) => r.deliveryKind !== 'branch');
  const cheapest = (list: typeof eligible) =>
    list.reduce<(typeof eligible)[number] | null>((best, r) => (best === null || r.priceCents < best.priceCents ? r : best), null);
  for (const carrier of preferredCarriers) {
    const pick = cheapest(eligible.filter((r) => r.carrierName === carrier));
    if (pick) return pick.rateId;
  }
  return cheapest(eligible)?.rateId ?? null;
}
