/**
 * MOCK · réplica de la regla de envío v2 del envío directo (API_CONTRACT §4-G.12, v1.109; convención de los
 * diales según la decisión del dueño del 2026-10-24, `HECHOS.md` «envío v2 con IVA incluido»).
 *
 * ⚠️ **SIMULADOR, no la fuente.** En producción la tarifa la decide el servidor
 * (`backend/src/modules/orders/shipping-rule.ts`) y el front pinta lo que llega en
 * `breakdown.shippingFeeCents` y `shippingRule`. Esto existe para que el modo mock no muestre una
 * cifra que el sistema real no produciría (criterio 196). Paridad: `shipping-rule.parity.test.ts`.
 *
 * ⭐ **Los tres diales son CON IVA INCLUIDO** (lo que ve el cliente): `E_cartas = directShipCardsFeeCents` y
 * `E_sellado = directShipSealedFeeCents`, EXACTOS, sin derivar del dial del IVA. ⚠️ El texto de v1.109 los
 * describía como `F` neto (P-ENV-1); el dueño contestó «IVA incluido» y la corrección del contrato está pedida
 * al arquitecto (v1.110). `shipping_fee_cents` (retiro de bóveda) sigue neto y no pasa por aquí.
 *
 * Pasos de §4-G.12 punto 2:
 *  1. clase: `sealed` si hay ≥ 1 sellado o accesorio (energía y paquetes incluidos), `cards_only` si solo
 *     hay cartas (raw y graded, D-ENV-2), `null` si no queda nada (envío 0);
 *  2. `E_regla`: `cards_only ⇒ E_cartas` (nunca gratis) · `sealed ⇒ (S ≥ T ? 0 : E_sellado)`;
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
  /** Renglones de accesorio (energía incluida), paquetes de energía o `deckPulls` (D-ENV-3). */
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
  const free = kind === 'sealed' && subtotalCents >= dials.freeFromCents;
  const eRule = kind === 'cards_only' ? eCards : free ? 0 : eSealed;
  const bigBox = box !== null && box.customerFeeCents > eSealed;
  return {
    feeCents: bigBox ? box!.customerFeeCents : eRule,
    rule: {
      kind,
      freeFromCents: kind === 'sealed' ? dials.freeFromCents : null,
      freeShippingRemainingCents: kind === 'sealed' ? Math.max(0, dials.freeFromCents - subtotalCents) : null,
      freeShippingApplied: free,
      boxFeeApplies: bigBox,
    },
  };
}
