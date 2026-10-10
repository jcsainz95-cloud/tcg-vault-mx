/**
 * activation.ts — qué le falta a un accesorio para activarse (API_CONTRACT §AC.11 `activate`, v1.86.1). PURA.
 *
 * Es la misma condición que el CHECK `accessory_active_ready` de M-73, dicha en palabras para `422
 * ACCESSORY_NOT_ACTIVATABLE {missing}`. Orden fijo: `price`, `photo`, `dimensions`, `weight`, `energy_type`.
 * ⛔ La energía nunca pide `dimensions` ni `weight` (no entra a la caja, §AC.7).
 */
import { AccessoryCategory, EnergyType } from '@prisma/client';

export type ActivationMissing = 'price' | 'photo' | 'dimensions' | 'weight' | 'energy_type';

export interface ActivationFacts {
  category: AccessoryCategory;
  energyType: EnergyType | null;
  priceCents: number | null;
  photoVersion: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightG: number | null;
}

export function activationMissing(a: ActivationFacts): ActivationMissing[] {
  const out: ActivationMissing[] = [];
  const energy = a.category === 'energy';
  if (a.priceCents === null) out.push('price');
  if (a.photoVersion === null) out.push('photo');
  if (!energy && (a.lengthMm === null || a.widthMm === null || a.heightMm === null)) out.push('dimensions');
  if (!energy && a.weightG === null) out.push('weight');
  if (energy && a.energyType === null) out.push('energy_type');
  return out;
}
