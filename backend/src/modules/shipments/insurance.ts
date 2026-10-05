/**
 * insurance.ts — 💰 el seguro por escalones (API_CONTRACT §M4-SHIP.19.19.5; `HECHOS.md:48`, 2026-10-04: «para el seguro
 * haz una regla de pagar el que aplique… si es un pedido de menos de 2500 el 25 y así»). UN cuerpo, puro.
 *
 * `coverageCents = min{ t.coverageCents : t.coverageCents ≥ insuredValueCents }` — con `≥`: un pedido de exactamente
 * $2,500 va en el escalón de $2,500. Sin escalón que cubra ⇒ `null` (el llamador responde `409 …NOT_CONFIGURED
 * {missing:['insurance_tier'], insuredValueCents, maxCoverageCents}` con CERO llamadas al proveedor). ⛔ Nunca se recorta a
 * un escalón menor: «siempre asegurado» con el escalón que CUBRA.
 */
import { InsuranceTier } from '../settings/shipping-dials';

export interface InsuranceCoverage {
  coverageCents: number;
  /** El costo del escalón (la tabla). La cotización manda si su eco coincide (§19.19.4). */
  costCents: number;
}

export function insuranceCoverageFor(insuredValueCents: number, tiers: readonly InsuranceTier[]): InsuranceCoverage | null {
  let best: InsuranceTier | null = null;
  for (const t of tiers) {
    if (t.coverageCents >= insuredValueCents && (best === null || t.coverageCents < best.coverageCents)) best = t;
  }
  return best ? { coverageCents: best.coverageCents, costCents: best.costCents } : null;
}

/** El mayor escalón configurado (para `maxCoverageCents` del `409`); `0` con la tabla vacía. */
export function maxCoverageCentsOf(tiers: readonly InsuranceTier[]): number {
  return tiers.reduce((m, t) => Math.max(m, t.coverageCents), 0);
}
