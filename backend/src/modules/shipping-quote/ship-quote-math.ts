/**
 * ship-quote-math.ts — 💰 §ENV3 (DECISIONES puntos 1, 5, 6). PURO, centavos enteros.
 *
 *   costoGuía(por caja) = `total` de Skydropx + seguro
 *   cobro               = ceilPeso( Σ cajas costoGuía + ship_margin_cents )
 *
 * 🔬 MEDIDO 2026-11-19 (cotizaciones de producción, solo lectura): el `total` YA incluye el IVA (`vat_fee` es un sumando:
 * amount + Σextra_fees + vat_fee + service_fee = total) y YA incluye `extended_area_fee` (viene dentro de `extra_fees`). ⛔ Sumarla otra
 * vez cobraría doble: aquí NO se suma, solo se informa. El seguro (`protection_value_total`) NO va en el `total`: se suma.
 */
import { ProviderRate } from '../shipping-provider/shipping-provider.port';

export interface PickedRate {
  serviceCode: string;
  serviceName: string;
  carrier: string;
  etaDays: number;
  /** `total` por caja (con IVA y zona extendida). */
  transportCents: number;
  insuranceCents: number;
  extendedAreaCents: number;
}

/** Redondeo hacia arriba al peso (HECHOS D9): 15001 → 15100. */
export function ceilPesoCents(cents: number): number {
  return Math.ceil(cents / 100) * 100;
}

/**
 * El primer servicio de `order` que cotiza (solo FedEx, entrega a domicilio). `tierInsuranceCents` = el seguro de la tabla del
 * escalón, solo si el cotizador no lo separa o su eco no coincide.
 */
export function pickRate(rates: readonly ProviderRate[], order: readonly string[], tierInsuranceCents: number): PickedRate | null {
  const fedex = rates.filter((r) => r.carrierName === 'fedex' && r.deliveryKind !== 'branch' && r.serviceCode !== null && r.totalCents > 0);
  for (const code of order) {
    const r = fedex.filter((x) => x.serviceCode === code).sort((a, b) => a.totalCents - b.totalCents)[0];
    if (r) {
      return {
        serviceCode: code,
        serviceName: `FedEx ${r.serviceName}`.trim(),
        carrier: 'fedex',
        etaDays: r.days ?? 0,
        transportCents: r.totalCents,
        insuranceCents: r.insuranceCents ?? tierInsuranceCents,
        extendedAreaCents: r.extendedAreaFeeCents ?? 0,
      };
    }
  }
  return null;
}

export function guideCostPerBoxCents(r: Pick<PickedRate, 'transportCents' | 'insuranceCents'>): number {
  return r.transportCents + r.insuranceCents;
}

/** Cobro al cliente: costo de TODAS las cajas + margen, redondeado hacia arriba al peso. */
export function customerFeeCents(boxes: number, perBoxCostCents: number, marginCents: number): number {
  return ceilPesoCents(boxes * perBoxCostCents + marginCents);
}

// ── Respaldo por tabla (punto 6) ──────────────────────────────────────────────────────────────────────────────────

export interface ZoneRow {
  prefix2: string;
  profileKey: string;
  serviceCode: string;
  costCents: number;
  samples: number;
}

/** p75 por rango ascendente («nearest-rank»): con n=1 es la muestra; con n=4 la 3ª. */
export function p75(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.75 * s.length) - 1)];
}

/**
 * Qué fila usa el respaldo para un CP: el primer servicio de `order` con fila (1) en su prefijo, (2) en su región (el MÁXIMO de las
 * filas con el mismo primer dígito) o (3) el MÁXIMO nacional. Sin ninguna fila ⇒ `null` (el servicio responde 503, nunca inventa).
 */
export function pickZoneRow(
  rows: readonly ZoneRow[],
  prefix2: string,
  profileKey: string,
  order: readonly string[],
): { row: ZoneRow; scope: 'prefix' | 'region' | 'national' } | null {
  const ofProfile = rows.filter((r) => r.profileKey === profileKey);
  // (1) el prefijo exacto, con el primer servicio del orden que tenga fila AHÍ (sin Overnight en el prefijo ⇒ Express Saver de ESE prefijo).
  for (const code of order) {
    const exact = ofProfile.find((r) => r.serviceCode === code && r.prefix2 === prefix2);
    if (exact) return { row: exact, scope: 'prefix' };
  }
  // (2) la región (mismo primer dígito): el MÁXIMO; (3) el máximo nacional. Siempre del primer servicio del orden que tenga alguna fila.
  const max = (list: ZoneRow[]) => list.reduce((m, r) => (r.costCents > m.costCents ? r : m));
  for (const code of order) {
    const region = ofProfile.filter((r) => r.serviceCode === code && r.prefix2[0] === prefix2[0]);
    if (region.length > 0) return { row: max(region), scope: 'region' };
  }
  return ofProfile.length > 0 ? { row: max(ofProfile), scope: 'national' } : null;
}

export interface LogRow {
  prefix2: string;
  profileKey: string;
  serviceCode: string;
  costCents: number;
}

/**
 * Recalibración (punto 6a): p75 por (prefijo, perfil, servicio) con ≥ `minSamples` muestras; con menos se CONSERVA la fila previa
 * (no aparece en el resultado). Devuelve solo las filas a escribir.
 */
export function recalibrate(log: readonly LogRow[], minSamples: number): Array<Omit<ZoneRow, never>> {
  const groups = new Map<string, LogRow[]>();
  for (const l of log) {
    const k = `${l.prefix2}|${l.profileKey}|${l.serviceCode}`;
    const g = groups.get(k);
    if (g) g.push(l);
    else groups.set(k, [l]);
  }
  const out: ZoneRow[] = [];
  for (const g of groups.values()) {
    if (g.length < minSamples) continue;
    out.push({ prefix2: g[0].prefix2, profileKey: g[0].profileKey, serviceCode: g[0].serviceCode, costCents: p75(g.map((x) => x.costCents)) as number, samples: g.length });
  }
  return out;
}
