/**
 * iva-display.ts — ⭐ **`P` para las suites E2E: el precio EXHIBIDO a partir del de LISTA.**
 * (`ARCHITECTURE §4.44.b`, `API_CONTRACT §M10-IVA.3`, D56.)
 *
 * ### Por qué existe
 * Desde D56, **toda superficie de cliente publica `P = round(L × (1 + t·r))`** y el ADMIN sigue
 * publicando `L` (`PROJECT §Q.5`: *«el admin NO se convierte en superficie solo-con-IVA»*). Las
 * suites E2E conocen los `L` del seed sintético (`E2E_LIST_OVERRIDE_CENTS`, la curva sobre la
 * referencia…), así que necesitan traducirlos para asertar contra el storefront.
 *
 * ⚠️ **Se escribe aquí, y no copiado en cinco ficheros, por la misma razón que la aritmética vive en
 * `common/money.ts`:** cinco copias de la conversión son cinco sitios donde una se queda con la
 * tasa vieja el día que cambie.
 *
 * ⛔ **NO importa de `src/`** a propósito: si el test usara la MISMA función que el código, una
 * mutación de esa función dejaría los dos lados de acuerdo y el candado en verde. *Un oráculo que
 * comparte implementación con lo que mide no es un oráculo.* Aquí se escribe la fórmula del contrato,
 * a mano, con los diales del seed.
 */

/** Los diales del seed sintético: dial de traslación al **100 %** (el neutro) y tasa **16 %**. */
export const E2E_IVA_TRANSFER_PCT = 100;
export const E2E_IVA_RATE_PCT = 16;

/**
 * `M = round(L × (1 + t·r))` con los diales del seed (el precio con IVA de antes de D9). Con `t = 100` y `r = 16` es `round(L × 1.16)`.
 */
export function M(listPriceCents: number): number {
  return listPriceCents + Math.round((listPriceCents * E2E_IVA_TRANSFER_PCT * E2E_IVA_RATE_PCT) / 10_000);
}

/** `stripe_fee_pct` del seed sintético (3.6 %), en millonésimas. */
const E2E_STRIPE_FEE_PCT_MICRO = 36_000;

/**
 * ⭐ D9 (docs/specs/D9_COMISION.md §2.1–2.2) — `P = ceilPeso( M / (1 − pct × (1 + r)) )`: el precio EXHIBIDO lleva la comisión de
 * plataforma DENTRO, redondeado al peso hacia arriba, por unidad. Escrito a mano y en enteros (⛔ no importa de `src/`):
 * divisor `10⁸ − pctμ·(100 + r) = 95 824 000` ⇒ `P = ceil(M·10⁶ / 95 824 000) × 100`. `10000 → 10500`.
 */
export function P(listPriceCents: number): number {
  const m = M(listPriceCents);
  const divisor = 100_000_000 - E2E_STRIPE_FEE_PCT_MICRO * (100 + E2E_IVA_RATE_PCT);
  return Math.floor((m * 1_000_000 + divisor - 1) / divisor) * 100;
}

/**
 * El camino inverso, **solo para tests y solo con el dial en el NEUTRO**: `L = round(P / (1+r))`.
 *
 * ⚠️ **MEDIDO:** con `t = 100` y `r = 16` recupera el `L` exacto — cero contraejemplos en
 * `L = 1..2 000 000`. ⛔ **Con el dial movido NO es exacto**, y por eso no se usa fuera de los casos
 * en que el seed está en el neutro. ⛔ Y ⛔ **jamás en código de producción**: la regla `R3` prohíbe
 * reconstruir un precio desde su base (*«esa dirección convierte un desglose en un recobro»*).
 */
export function L(displayPriceCents: number): number {
  // ⚠️ D9: ya NO invierte `P` (la comisión y el techo al peso no se deshacen); solo invierte `M`, el precio con IVA SIN comisión.
  return Math.round((displayPriceCents * 100) / (100 + E2E_IVA_RATE_PCT));
}
