/**
 * MOCK · réplica de la regla de envío v2 del envío directo (API_CONTRACT §4-G.12, v1.109.3; convención de los
 * diales según la decisión del dueño del 2026-10-24, `HECHOS.md` «envío v2 con IVA incluido»).
 *
 * ⚠️ **SIMULADOR, no la fuente.** En producción la tarifa la decide el servidor
 * (`backend/src/modules/orders/shipping-rule.ts`) y el front pinta lo que llega en
 * `breakdown.shippingFeeCents` y `shippingRule`. Esto existe para que el modo mock no muestre una
 * cifra que el sistema real no produciría (criterio 196). Paridad: `shipping-rule.parity.test.ts`.
 *
 * ⭐ **Los tres diales son CON IVA INCLUIDO** (lo que ve el cliente): `E_cartas = directShipCardsFeeCents` y
 * `E_sellado = directShipSealedFeeCents`, EXACTOS, sin derivar del dial del IVA (contrato v1.109.1, P-ENV-1
 * cerrada). `shipping_fee_cents` (retiro de bóveda) sigue neto y no pasa por aquí.
 *
 * Pasos de §4-G.12 punto 2:
 *  1. clase: `sealed` si hay ≥ 1 sellado o accesorio (energía y paquetes incluidos), `cards_only` si solo
 *     hay cartas (raw y graded, D-ENV-2), `null` si no queda nada (envío 0);
 *  2. `E_regla`: `S ≥ T ⇒ 0` para CUALQUIER clase; si no, `cards_only ⇒ E_cartas` · `sealed ⇒ E_sellado`
 *     (dueño 2026-10-25, `HECHOS.md` «Envío gratis desde MX$4,000 para CUALQUIER pedido (opción A)»; contrato v1.109.3).
 *  3. caja: `cajaGrande ⇔ box ≠ null ∧ box.customerFeeCents > E_sellado` ⇒ `E = box.customerFeeCents`;
 *  4. el desglose (comisión sobre `S + E`) lo hace `computeBreakdown` de `lib/api.ts`, sin cambio.
 *
 * `S` = subtotal exhibido (IVA dentro, antes del envío y de la comisión). ⛔ El umbral NUNCA se compara
 * con el total: el total lleva la comisión y la comisión depende de `E` (circular, §4-G.12 punto 2).
 */

import type { GuestShippingRuleDTO, ShippingRuleKind } from '@/types/contract';

/** Diales de §4-G.12 punto 3, los tres con IVA incluido. */
export interface DirectShipDials {
  cardsFeeCents: number;
  sealedFeeCents: number;
  freeFromCents: number;
}

/** Defaults de §4-G.12 punto 3 (los mismos números; convención del dueño: importe final). */
export const DIRECT_SHIP_DEFAULT_DIALS: DirectShipDials = {
  cardsFeeCents: 10000,
  sealedFeeCents: 17500,
  freeFromCents: 400000,
};

/** Lo que el paso 1 necesita del carrito: tipos de las piezas y si hay accesorios/paquetes/decks. */
export interface ShippingRuleCart {
  productTypes: ReadonlyArray<'raw' | 'graded' | 'sealed'>;
  /** Renglones de accesorio (energía incluida) + paquetes de energía ACEPTADOS (D-ENV-3). Un `deckPull` sin paquete no cuenta. */
  accessoryCount: number;
}

/** Paso 1 — `shippingRuleKindOf(cart)`. */
export function shippingRuleKindOf(cart: ShippingRuleCart): ShippingRuleKind | null {
  if (cart.accessoryCount > 0 || cart.productTypes.some((p) => p === 'sealed')) return 'sealed';
  if (cart.productTypes.length > 0) return 'cards_only';
  return null;
}

export interface DirectShipFee {
  /** `E` — va a `breakdown.shippingFeeCents`. */
  feeCents: number;
  /** `shippingRule` del quote de invitado (§4-G.12 punto 4). */
  rule: GuestShippingRuleDTO;
}

/**
 * Pasos 2 y 3 — `directShipFeeOf(kind, S, dials, choice)`. `box` = la caja elegida por §AC.7 (`null` si
 * ninguna; el mock hoy siempre pasa `null`, `shippingBox: null`).
 */
export function directShipFeeOf(
  kind: ShippingRuleKind | null,
  subtotalCents: number,
  dials: DirectShipDials,
  box: { customerFeeCents: number } | null = null,
): DirectShipFee {
  if (kind === null) {
    return {
      feeCents: 0,
      rule: { kind: null, freeFromCents: null, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: false },
    };
  }
  const eCards = dials.cardsFeeCents;
  const eSealed = dials.sealedFeeCents;
  // §4-G.12 v1.109.3: el umbral vale para cualquier clase; la caja grande conserva su tarifa.
  const free = subtotalCents >= dials.freeFromCents;
  const eRule = free ? 0 : kind === 'cards_only' ? eCards : eSealed;
  const bigBox = box !== null && box.customerFeeCents > eSealed;
  return {
    feeCents: bigBox ? box!.customerFeeCents : eRule,
    rule: {
      kind,
      freeFromCents: dials.freeFromCents,
      freeShippingRemainingCents: Math.max(0, dials.freeFromCents - subtotalCents),
      // §4-G.12 punto 4 (v1.109.2): `S ≥ T ∧ ¬boxFeeApplies` (⇔ E = 0); caja grande sobre T ⇒ false.
      freeShippingApplied: free && !bigBox,
      boxFeeApplies: bigBox,
    },
  };
}
