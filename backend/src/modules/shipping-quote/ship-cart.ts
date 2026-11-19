/**
 * ship-cart.ts — 💰 §ENV3: de lo YA cobrable del carrito (piezas + unidades de accesorio) al `ShipCartInput`. PURO.
 * La clase de pieza (`raw | graded` = carta, el resto = sellado) es la MISMA de `orders/shipping-rule.ts` (D-ENV-2).
 */
import { ProductType } from '@prisma/client';
import { ShipCartInput } from './ship-profile';

export function shipCartOf(
  pieces: ReadonlyArray<{ productType: ProductType; sealedSubtype: string | null }>,
  accessoryUnits: ReadonlyArray<{ weightG: number }>,
  valueCents: number,
): ShipCartInput {
  const cards = pieces.filter((p) => p.productType === ProductType.raw || p.productType === ProductType.graded).length;
  return {
    cards,
    sealedSubtypes: pieces.filter((p) => p.productType !== ProductType.raw && p.productType !== ProductType.graded).map((p) => p.sealedSubtype),
    accessoryGrams: accessoryUnits.map((u) => u.weightG),
    valueCents,
  };
}
