/**
 * shipping-rule.ts — 💰 REGLA DE ENVÍO v2 DEL ENVÍO DIRECTO (API_CONTRACT §4-G.12, v1.109). PURO: sin BD, sin reloj.
 *
 * Fuente: `HECHOS.md` 2026-10-24 «Regla de envío nueva + embudo + medición autorizados».
 *
 *  1. Clase del pedido (`shippingRuleKindOf`): carta = `raw | graded` (D-ENV-2); sellado = `sealed`; accesorio = todo
 *     renglón suelto (energía incluida) y todo paquete de energías (D-ENV-3). `sealed` si hay ≥ 1 sellado o accesorio,
 *     `cards_only` si solo hay cartas, `null` si no queda nada cobrable (envío 0).
 *  2. Importe (`directShipFeeOf`): `S` = `breakdown.subtotalCents` (IVA dentro, ANTES del envío y de la comisión;
 *     D-ENV-1). `S ≥ T ⇒ 0` en las DOS clases (v1.109.3, HECHOS 2026-10-25 «Envío gratis desde MX$4,000 para CUALQUIER
 *     pedido»); si no, `cards_only ⇒ E_cartas` · `sealed ⇒ E_sellado`.
 *  3. Caja (§AC.7): `cajaGrande ⇔ choice ≠ null ∧ box.customerFeeCents > E_sellado` ⇒ `E = box.customerFeeCents`; si no,
 *     `E = E_regla`. Bajo el umbral es bit a bit el `max(E_base, customerFeeCents)` de v1.86 con `E_base = E_sellado`.
 *  ⛔ El umbral se mide sobre `S`, NUNCA sobre el total: el total lleva la comisión, la comisión depende de `E` y `E` del
 *     umbral (circular). Canario de ENV-1.
 *
 * v1.109.1 (P-ENV-1 cerrada, dueño 2026-10-24: «es ya con iva el precio»): los TRES diales `direct_ship_*` son EXHIBIDOS
 * (IVA dentro). `E_x = G_x` — el dial ES el envío que paga el cliente. Base e IVA solo para el desglose:
 * `base = taxBaseCentsOf(G, r)` (R2) e `IVA = G − base` (`directShipFeeTaxSplitOf`). ⛔ No pasan por
 * `shippingFeeDisplayCentsOf` (daría 11600 con t=100: IVA apilado, IVA-6) y ⛔ `E` nunca se reconstruye desde la base (R3).
 * Mover `t` o `r` no mueve `E`; solo su base.
 * Pedidos ya cobrados: NADA aquí se relee para una orden existente (`Order.shippingFeeCents` congelado en `session`).
 */
import { ProductType } from '@prisma/client';
import { taxBaseCentsOf } from '../../common/money';
import type { BoxChoice } from './box-fit';

export type ShippingRuleKind = 'cards_only' | 'sealed';

/** Lo que la clase mira del carrito YA podado (lo cobrable). */
export interface ShippingRuleCart {
  /** `productType` de cada pieza cobrable. */
  productTypes: readonly ProductType[];
  /** Renglones de accesorio sueltos cobrables (energías incluidas). */
  accessoryLineCount: number;
  /** Paquetes de energías cobrables (`deckPulls` con paquete aceptado). */
  energyBundleCount: number;
}

/**
 * Los tres diales tal como se leen de `ConfigSetting` (centavos, los TRES exhibidos: IVA dentro; v1.109.1). Lo que paga el
 * cliente es el dial tal cual (`E = G`). ⛔ Sin `IvaDials`: mover `t` o `r` no mueve lo que paga el cliente.
 */
export interface DirectShipDials {
  /** `direct_ship_cards_fee_cents` — `G` exhibido. */
  cardsFeeCents: number;
  /** `direct_ship_sealed_fee_cents` — `G` exhibido. */
  sealedFeeCents: number;
  /** `direct_ship_free_from_cents` — exhibido, se compara con `S`. */
  freeFromCents: number;
}

export interface DirectShipFee {
  /** `E`: lo que entra a `breakdown.shippingFeeCents`. */
  feeCents: number;
  /** `E_sellado` — el `baseFeeCents` de `shippingBoxSnapshot` (§4-G.12 paso 3). */
  baseFeeCents: number;
  freeShippingApplied: boolean;
  boxFeeApplies: boolean;
}

/** `GuestShippingRuleDTO` (§4-G.12 punto 4). */
export interface GuestShippingRuleDTO {
  kind: ShippingRuleKind | null;
  freeFromCents: number | null;
  freeShippingRemainingCents: number | null;
  freeShippingApplied: boolean;
  boxFeeApplies: boolean;
}

/** `GET /checkout/shipping-rule` (§4-G.12 punto 5). */
export interface PublicShippingRuleDTO {
  cardsOnlyFeeCents: number;
  sealedFeeCents: number;
  freeFromCents: number;
  currency: 'MXN';
  ivaIncluded: true;
}

/** D-ENV-2: la gradeada es una carta y viaja igual. Del enum generado (⛔ lista a mano: candado de `enum-values-parity`). */
const CARD_TYPES: ReadonlySet<ProductType> = new Set<ProductType>([ProductType.raw, ProductType.graded]);

/** Paso 1 — la clase del pedido. Un `productType` desconocido cuenta como sellado (dirección conservadora: cobra). */
export function shippingRuleKindOf(cart: ShippingRuleCart): ShippingRuleKind | null {
  const accessories = cart.accessoryLineCount + cart.energyBundleCount;
  if (cart.productTypes.length === 0 && accessories === 0) return null;
  if (accessories > 0) return 'sealed';
  return cart.productTypes.every((t) => CARD_TYPES.has(t)) ? 'cards_only' : 'sealed';
}

/** Base gravable e IVA de un envío exhibido `G` (R2: base por `taxBaseCentsOf`, IVA por RESTA). 10000 ⇒ 8621 + 1379 con r=16. */
export function directShipFeeTaxSplitOf(feeCents: number, ivaRatePct: number): { baseCents: number; ivaCents: number } {
  const baseCents = taxBaseCentsOf(feeCents, ivaRatePct);
  return { baseCents, ivaCents: feeCents - baseCents };
}

/** Pasos 2 y 3 — `E` del pedido. `kind = null` ⇒ 0 (nada que enviar). */
export function directShipFeeOf(
  kind: ShippingRuleKind | null,
  subtotalCents: number,
  dials: DirectShipDials,
  choice: BoxChoice | null,
): DirectShipFee {
  const base = dials.sealedFeeCents;
  if (kind === null) return { feeCents: 0, baseFeeCents: base, freeShippingApplied: false, boxFeeApplies: false };
  // v1.109.3 (dueño 2026-10-25): el umbral vale para CUALQUIER pedido, sin mirar la clase.
  const free = subtotalCents >= dials.freeFromCents;
  const ruleFee = free ? 0 : kind === 'cards_only' ? dials.cardsFeeCents : dials.sealedFeeCents;
  const bigBox = choice !== null && choice.box.customerFeeCents > dials.sealedFeeCents;
  return {
    feeCents: bigBox ? (choice as BoxChoice).box.customerFeeCents : ruleFee,
    baseFeeCents: base,
    // v1.109.2 (§4-G.12): «envío gratis» ⇔ `E = 0`. La caja grande sobre el umbral conserva su tarifa ⇒ no es gratis.
    freeShippingApplied: free && !bigBox,
    boxFeeApplies: bigBox,
  };
}

/** Punto 4 — el DTO del quote. `subtotalCents` = el `breakdown.subtotalCents` que viaja en la MISMA respuesta. */
export function shippingRuleDtoOf(kind: ShippingRuleKind | null, subtotalCents: number, dials: DirectShipDials, fee: DirectShipFee): GuestShippingRuleDTO {
  // v1.109.3: el umbral aplica a las dos clases; solo el carrito vacío (`kind = null`) va en null/false.
  const any = kind !== null;
  return {
    kind,
    freeFromCents: any ? dials.freeFromCents : null,
    // v1.109.5: «te faltan MX$N» es una promesa; con caja grande cruzar T no quita el envío ⇒ `null` (bajo y sobre T).
    freeShippingRemainingCents: any && !fee.boxFeeApplies ? Math.max(0, dials.freeFromCents - subtotalCents) : null,
    freeShippingApplied: any && fee.freeShippingApplied,
    boxFeeApplies: fee.boxFeeApplies,
  };
}

/** Punto 5 — lo que pinta la ficha sin cotizar (informativo: lo cobrado lo decide `session`). */
export function publicShippingRuleOf(dials: DirectShipDials): PublicShippingRuleDTO {
  return {
    cardsOnlyFeeCents: dials.cardsFeeCents,
    sealedFeeCents: dials.sealedFeeCents,
    freeFromCents: dials.freeFromCents,
    currency: 'MXN',
    ivaIncluded: true,
  };
}
