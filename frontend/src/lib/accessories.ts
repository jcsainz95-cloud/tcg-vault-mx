import { ENERGY_TYPES, type EnergyType } from '@/types/contract';

/**
 * Helpers de presentación de §AC (FRONTEND_NOTES §107). ⛔ Ninguno toca dinero: ordenan y cuentan.
 */

/** Ordena por el enum `EnergyType` (el orden de los desgloses «Fuego ×8 · Agua ×4», §AC-UX.5). */
export function sortByEnergyType<T extends { energyType: EnergyType }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => ENERGY_TYPES.indexOf(a.energyType) - ENERGY_TYPES.indexOf(b.energyType));
}

/** «Fuego ×8 · Agua ×4» con el traductor de `accessories`. */
export function energyBreakdown(
  rows: readonly { energyType: EnergyType; quantity: number }[],
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  return sortByEnergyType(rows)
    .map((r) => t('energyQty', { type: t(`energyType.${r.energyType}`), qty: r.quantity }))
    .join(' · ');
}

/** Σ de cantidades (cuenta de cartas, no dinero). */
export const totalQuantity = (rows: readonly { quantity: number }[]) => rows.reduce((s, r) => s + r.quantity, 0);

/**
 * Ancla una ruta de la API (`/api/v1/accessories/:id/photo/:v/:variant`, como la sirve el backend) al ORIGEN de
 * la API. La tienda corre en otro origen y no hay `rewrites`, así que sin esto la foto pediría al frontend (404).
 * Una URL completa pasa tal cual. `//host/…` NO se trata como URL de otro host: se ancla al origen de la API.
 */
export function resolveApiAssetUrl(src: string | null | undefined, apiBaseUrl: string): string | null {
  if (!src) return null;
  if (!src.startsWith('/')) return src;
  let origin: string;
  try {
    origin = new URL(apiBaseUrl).origin;
  } catch {
    return src;
  }
  return `${origin}${src}`;
}
