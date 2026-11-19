/**
 * ship-profile.ts — 💰 §ENV3 (DECISIONES punto 2). PURO: el perfil de paquete se DERIVA del carrito en servidor; el cliente
 * nunca manda peso, medidas ni costo.
 *
 *  - Solo cartas sueltas (`raw | graded`): SOBRE 25x18x3, 1 kg declarado, hasta `envelopeMaxCards`; más ⇒ caja.
 *  - Sellado, accesorio o mixto: CAJA 49x23x21, 5 kg declarado por caja (medido 2026-11-19: el precio es IDÉNTICO de 1 a 5 kg —el
 *    volumétrico es 4.734 kg— y salta ~×3 con 6 kg; por eso la caja se llena hasta 5 kg y no más).
 *  - Peso real = Σ gramos por unidad (+ 200 g si lleva cartas). `ceil(peso / 5 kg)` cajas; el costo es Σ por caja (N cotizaciones de UNA
 *    caja: medido que `multipackage` cuesta ~8 % más con Overnight y ~130 % más con Express Saver que 2 cotizaciones sueltas).
 *  - Valor declarado/seguro por caja = lo pagado por la mercancía repartido entre las cajas, llevado al escalón de seguro que lo cubre
 *    (el MISMO que usará la compra de guía: `shipping_insurance_tiers`); sin escalón que cubra, banda de MX$500 hacia arriba.
 */
import { createHash } from 'crypto';

export type ShipPackage = 'envelope' | 'box';

export const ENVELOPE = { lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1 } as const;
export const BOX = { lengthCm: 49, widthCm: 23, heightCm: 21, weightKg: 5 } as const;
/** Tope real por caja (g): igual al peso declarado de la caja. */
export const BOX_MAX_G = BOX.weightKg * 1000;
/** Cartas en una caja mixta (fundas, separadores): 200 g fijos. */
export const CARDS_PADDING_G = 200;
/** Gramos de una carta suelta cuando son TANTAS que rebasan el sobre (con funda). */
export const CARD_G = 3;
/** Banda del valor declarado. */
export const VALUE_BAND_CENTS = 50_000;

export interface ShipCartInput {
  /** Cartas sueltas (`raw | graded`), una por inventario. */
  cards: number;
  /** Una entrada por unidad de sellado (`SealedSubtype` o `null` ⇒ el mayor de los diales). */
  sealedSubtypes: readonly (string | null)[];
  /** Gramos por unidad de accesorio (energías incluidas), una entrada por unidad. */
  accessoryGrams: readonly number[];
  /** Lo pagado por la mercancía, ANTES de código (centavos enteros). */
  valueCents: number;
}

export interface ShipProfile {
  package: ShipPackage;
  boxes: number;
  /** Peso declarado por bulto (kg). */
  perBoxKg: number;
  /** Peso real total estimado (g), solo informativo. */
  weightG: number;
  /** Valor declarado por bulto (centavos): escalón de seguro que cubre lo pagado. */
  perBoxCoverageCents: number;
}

export interface ShipDials {
  envelopeMaxCards: number;
  sealedWeightsG: Readonly<Record<string, number>>;
  /** Escalones de seguro (`coverageCents`) de `shipping_insurance_tiers`. */
  insuranceCoverages: readonly number[];
}

export function bandUp(valueCents: number): number {
  const v = Math.max(1, Math.trunc(valueCents));
  return Math.ceil(v / VALUE_BAND_CENTS) * VALUE_BAND_CENTS;
}

/** El escalón de seguro más chico que cubre `valueCents`; sin escalón, la banda de MX$500 hacia arriba. */
export function coverageOf(valueCents: number, tiers: readonly number[]): number {
  const v = Math.max(1, Math.trunc(valueCents));
  const fit = tiers.filter((t) => t >= v).sort((a, b) => a - b)[0];
  return fit ?? bandUp(v);
}

export function shipProfileOf(cart: ShipCartInput, dials: ShipDials): ShipProfile {
  const sealed = cart.sealedSubtypes.length;
  const accessories = cart.accessoryGrams.length;
  if (sealed === 0 && accessories === 0 && cart.cards <= dials.envelopeMaxCards) {
    return { package: 'envelope', boxes: 1, perBoxKg: ENVELOPE.weightKg, weightG: cart.cards * CARD_G, perBoxCoverageCents: coverageOf(cart.valueCents, dials.insuranceCoverages) };
  }
  const heaviest = Math.max(...Object.values(dials.sealedWeightsG));
  let grams = 0;
  for (const s of cart.sealedSubtypes) grams += s !== null && dials.sealedWeightsG[s] !== undefined ? dials.sealedWeightsG[s] : heaviest;
  for (const g of cart.accessoryGrams) grams += Math.max(0, Math.trunc(g));
  if (cart.cards > 0) grams += sealed === 0 && accessories === 0 ? cart.cards * CARD_G + CARDS_PADDING_G : CARDS_PADDING_G;
  const boxes = Math.max(1, Math.ceil(grams / BOX_MAX_G));
  return { package: 'box', boxes, perBoxKg: BOX.weightKg, weightG: grams, perBoxCoverageCents: coverageOf(Math.ceil(cart.valueCents / boxes), dials.insuranceCoverages) };
}

/** `profileKey` de la tabla de respaldo: UNA caja o sobre. */
export function tableProfileKey(p: Pick<ShipProfile, 'package' | 'perBoxKg'>): string {
  return `${p.package}:${p.perBoxKg}`;
}

/** Clave de caché por bulto (el costo de N cajas iguales es N × una). */
export function cacheKeyOf(cp: string, p: ShipProfile): string {
  return `shipq:v1:${cp}:${p.package}:${p.perBoxKg}:${p.perBoxCoverageCents / 100}`;
}

/** `hashPerfil` del `quoteId`: cambia si cambia paquete, nº de cajas, peso declarado o banda de valor. */
export function profileHashOf(p: ShipProfile): string {
  const canon = JSON.stringify([p.package, p.boxes, p.perBoxKg, p.perBoxCoverageCents]);
  return createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

export function dimsOf(p: Pick<ShipProfile, 'package'>): { lengthCm: number; widthCm: number; heightCm: number; weightKg: number } {
  return p.package === 'envelope' ? ENVELOPE : BOX;
}

export const ENVELOPE_PROFILE_KEY = tableProfileKey({ package: 'envelope', perBoxKg: ENVELOPE.weightKg });
export const BOX_PROFILE_KEY = tableProfileKey({ package: 'box', perBoxKg: BOX.weightKg });
