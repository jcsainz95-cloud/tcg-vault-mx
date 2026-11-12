/**
 * §PROV F1 — constantes del portal de proveedores (API_CONTRACT_PROVEEDORES.md). Dinero en centavos MXN enteros.
 */
import { SupplyCondition } from '@prisma/client';

export const SUPPLY_CONDITIONS: readonly SupplyCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

/** `a` es igual o mejor que `min` (NM mejor, DMG peor). */
export function conditionAtLeast(a: SupplyCondition, min: SupplyCondition): boolean {
  return SUPPLY_CONDITIONS.indexOf(a) <= SUPPLY_CONDITIONS.indexOf(min);
}

export const REQUEST_TTL_MS = 14 * 24 * 3600 * 1000;
export const OFFER_TTL_MS = 72 * 3600 * 1000;
export const PICKUP_TTL_MS = 7 * 24 * 3600 * 1000;
export const INVITE_TTL_MS = 72 * 3600 * 1000;

export const SUPPLY_SETTINGS_ID = 'singleton';
export const DEFAULT_PCT_BPS = 7000;

/** Redondeo al peso hacia abajo (múltiplo de 100 centavos). */
export function floorToPeso(cents: number): number {
  return Math.floor(cents / 100) * 100;
}

/** Precio por pieza de una solicitud: el fijo del dueño manda; si no, pct × mercado (peso hacia abajo). null = sin precio. */
export function effectiveUnitCents(
  req: { pctBps: number | null; fixedCents: number | null },
  marketCents: number | null,
): number | null {
  if (req.fixedCents != null) return req.fixedCents;
  if (req.pctBps != null && marketCents != null && marketCents > 0) {
    const v = floorToPeso(Math.floor((marketCents * req.pctBps) / 10000));
    return v > 0 ? v : null;
  }
  return null;
}

/** Pago de una pieza ajustada: floor(acordado × bps / 10000). Nunca sube (bps ≤ 9999). */
export function adjustedUnitCents(agreedUnitCents: number, adjustBps: number): number {
  return Math.floor((agreedUnitCents * adjustBps) / 10000);
}
