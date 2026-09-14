/**
 * money.ts — Funciones puras de dinero (centavos MXN). Sin dependencias de infra.
 * Fuente de verdad: ARCHITECTURE.md §5.1 (checkout, IVA, fee gross-up) y §10.1 (markup).
 *
 * Toda cantidad es un entero de centavos MXN. No se usan floats para persistir dinero.
 */
// v2.0 (P-48, §4.36): LA CURVA. La matemática pura (interpolación, redondeo, invariantes, guardarraíl
// y predicado de bounty) vive en `common/pricing-curve.ts`; aquí solo se le aplican las PRECEDENCIAS
// de §4.36.6 y el clamp de persistencia (BE-27). Dirección de dependencia ÚNICA: money.ts →
// pricing-curve.ts (nunca al revés), para que no haya ciclo.
import {
  PricingCurve,
  resolveBuyFromCurve,
  resolveSaleFromCurve,
  isBountyEffective,
} from './pricing-curve';
import type { PriceBasis } from './pricing-curve';
// v1.64-iva-inclusive (§4.44.j): SOLO el tipo del enum de Prisma. `import type` ⇒ no hay import en
// runtime ⇒ `money.ts` sigue siendo funciones puras sin dependencias de infra. Se importa en vez de
// re-declarar la unión de strings A PROPÓSITO: así, el día que el enum del esquema cambie, esto no
// compila en vez de aceptar en silencio un valor que la columna ya no admite.
import type { PriceConvention } from '@prisma/client';

/**
 * §4.36.7a — los CINCO valores LOCKED de PROJECT §N.7. Se DEFINE en `pricing-curve.ts` (que no importa
 * nada de aquí) y se re-exporta desde `money.ts` porque es el tipo de retorno de las dos funciones de
 * dinero. UNA sola definición, dos puertas de importación.
 */
export type { PriceBasis };

/**
 * BE-27 (money-safety): techo Int32 de Postgres. Toda columna `*Cents` persistible es `Int`, cuyo
 * máximo es 2_147_483_647. Un importe calculado por encima (p. ej. `pct × market` con un market/rate
 * enorme, o un `fixed` grande que se coló) desbordaría la columna y lanzaría al persistir (excepción
 * Prisma = DoS). `clampCents` ACOTA el valor FINAL ya calculado a [?, MAX_CENTS] SIN cambiar la
 * matemática ni el redondeo previos; `null` se respeta tal cual (pendiente, no se clava a 0).
 */
export const MAX_CENTS = 2_147_483_647;

/**
 * Acota un importe UNITARIO en centavos al techo Int32 (BE-27). No toca el redondeo; solo la cota
 * superior.
 *
 * MS-3 (decisión, Opción A): esta función se queda PURA a propósito — `money.ts` es "sin dependencias
 * de infra", así que NO lleva logging. La SEÑAL FUERTE de un importe fuera de rango vive en dos lugares
 * visibles y accionables: (1) los validadores de settings rechazan `fixed > FIXED_CENTS_MAX` en la
 * puerta de configuración, y (2) `grossUpTotal` **LANZA** cuando el AGREGADO excede `MAX_CENTS`
 * (mapeado a `AMOUNT_TOO_LARGE`). Con config legítima este clamp unitario NO debería dispararse nunca;
 * es una red de última instancia para que un unitario aberrante no desborde por sí solo antes de que el
 * agregado lo delate. Si en el futuro se quiere telemetría del recorte, la emite el caller que persiste
 * (fuera de este módulo puro), no `clampCents`.
 */
export function clampCents(n: number): number {
  return n > MAX_CENTS ? MAX_CENTS : n;
}

export interface StripeFeeConfig {
  /** Tarifa porcentual de Stripe como fracción (ej. 0.036 = 3.6%). */
  stripePct: number;
  /** Tarifa fija de Stripe en centavos (ej. 300 = MX$3.00). */
  stripeFixedCents: number;
  /**
   * C1: IVA (fracción) que Stripe MX cobra SOBRE su comisión (ej. 0.16 = 16%).
   * En México Stripe factura su comisión con IVA, así que la deducción real es
   * `(1 + stripeFeeIvaPct) × (pct × total + fija)`. El gross-up debe cubrirlo para
   * que la plataforma netee íntegro `base`. Dial `stripe_fee_iva_pct` (default 0.16).
   */
  stripeFeeIvaPct: number;
}

/**
 * @deprecated v1.13-sales-pricing (§4.14d): reemplazada por `computeSalePriceForRarity` (precio de
 * venta por rareza). Se conserva como palanca de ROLLBACK del markup GLOBAL único; el retiro
 * definitivo (junto con el dial SALES_MARKUP_PCT) es follow-up del humano (decisión abierta v1.13-3).
 *
 * Precio de venta = round(referencia × (1 + markup%)). ARCHITECTURE §10.1.
 * El "valor de mercado" mostrado sigue siendo la referencia; esto es el precio cobrado.
 */
export function computeSalePriceCents(referenceMxnCents: number, salesMarkupPct: number): number {
  return clampCents(Math.round(referenceMxnCents * (1 + salesMarkupPct / 100)));
}

/**
 * Costo de aportación en especie = round(referencia × pct/100). PROJECT criterio 28.
 */
export function computeAportacionCostCents(referenceMxnCents: number, aportacionPct: number): number {
  return clampCents(Math.round(referenceMxnCents * (aportacionPct / 100)));
}

/**
 * v2.0 (P-48, §4.36.4) — **BLOQUE DE REGLAS RETIRADO SIN RESIDUOS** (criterio 96).
 *
 * Aquí vivían `quoteAcquisition`, `quoteAcquisitionForFinish`, `computeSalePriceForRarity`,
 * `applyRule`, `resolveRuleForFinish`, `resolveTwoAxisRule`, `ruleKeyCandidates`, `finishRuleFor`,
 * `lookupRarityRule`, `toPriceRuleSet`, `buildEffectiveRuleSet`, `isPriceRuleSet`, `isTieredRuleSet`,
 * `isHoloRarity`, `isPremiumRarity` y los tipos `BuylistRule`/`SalesRule`/`PriceRuleSet`/
 * `TieredRuleSet` con sus modos `fixed`/`pct`.
 *
 * **Se retiran del todo**, no se deprecan: el `mode:'fixed'` documentado como PISO pero implementado
 * como PRECIO ABSOLUTO fue la causa raíz de P-48 (cartas publicadas a MX$1.31 con un piso de MX$15), y
 * el eje de ACABADO que no consultaba la regla de la rareza fue la otra mitad. Dejarlos «por si acaso»
 * sería dejar en pie la complejidad que produjo el error. Los sustituye **UNA curva por eje**
 * (`computeSalePriceFromCurve` / `quoteAcquisitionFromCurve`, abajo), donde no hay reglas que
 * resolver, no hay ejes que se pisen y no hay rarezas sin mapear.
 *
 * `VariantPriceControls` SOBREVIVE (la fila M-30 sigue siendo el peldaño de override/bounty).
 */

/**
 * v1.6-finish — el ACABADO sigue siendo la IDENTIDAD de la variante (§4.36.10): inventario,
 * overrides, bounties, `availableFinishes`, ficha y bóveda siguen siendo por acabado, y sigue
 * eligiendo DE QUÉ VARIANTE se lee el mercado. Lo ÚNICO que perdió en v2.0 es tener regla de precio
 * propia.
 */
export type Finish = 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil';

/**
 * **H-1, EL PREDICADO** (v2.1.4, §4.36.6 / E5-bis) — «presente ⇔ `> 0`», en UN solo cuerpo.
 *
 * La doctrina existía desde v1.24 y estaba bien resuelta para los overrides de **variante** (M-30) y
 * para el **sellado**… pero el **peldaño 1** de la precedencia —el `listPriceCents` POR PIEZA— no la
 * heredó, y el `> 0` se repetía a mano seam por seam. Resultado: `orders` exigía `> 0` y otros cinco
 * sitios solo `!= null`, así que un `listPriceCents = 0` se comportaba **distinto en cada superficie**
 * (el checkout cobraba la curva; storefront, binder y publicación lo daban por presente y resolvían a
 * `0` ⇒ no vendible). **Repetir el `> 0` a mano en seis sitios es literalmente cómo se llegó al
 * hueco**, así que ahora hay un predicado y los seis lo llaman.
 */
export function isPresentAmount(cents: number | null | undefined): cents is number {
  return cents != null && cents > 0;
}

/**
 * H-1 en el **peldaño 1** de la precedencia de venta: ¿esta pieza trae override manual POR PIEZA?
 *
 * `<= 0` ⇒ **AUSENTE** ⇒ cae al siguiente peldaño (variante → curva), que es lo que `orders` ya hacía
 * y lo que H-1 dice para los otros dos niveles. La alternativa («`0` = presente e inválido ⇒
 * `PRICE_PENDING`») se DESCARTA: escondría inventario por un accidente de captura. Con §N.0: que una
 * pieza quede priceada por curva —quizá más cara de lo que alguien tecleó— es el error RECUPERABLE;
 * que quede invisible o se venda en `0` es el irrecuperable.
 */
export function hasManualPrice<T extends { listPriceCents?: number | null }>(
  item: T,
): item is T & { listPriceCents: number } {
  return isPresentAmount(item.listPriceCents);
}

/**
 * Primer monto PRESENTE (H-1) de una cadena de candidatos, o `null` si ninguno lo está. Es el `??` de
 * la precedencia, pero con la semántica correcta: `??` solo salta `null`/`undefined`, así que un `0`
 * lo cortocircuitaba y **enmascaraba el siguiente peldaño** (ese era el bug de `inventory:2211`, donde
 * un `listPriceCents = 0` tapaba el `sellOverrideCents` de la variante).
 */
export function firstPresentAmount(...candidates: (number | null | undefined)[]): number | null {
  for (const c of candidates) if (isPresentAmount(c)) return c;
  return null;
}

/**
 * v1.28 (P-18/P-22, §4.26a/M-30) — CONTROLES por variante para los resolvers de precedencia. Es la
 * proyección relevante de una fila `VariantPriceOverride` (o `null`/omitido = SIN fila).
 *
 * REGLA money-safe de presencia (misma doctrina H-1 del sellado): un override/bounty se considera
 * PRESENTE solo si su monto es `> 0`. Un `<= 0` es input degenerado (las validaciones del write lo
 * rechazan; si se coló, se trata como AUSENTE — jamás se cobra/ofrece $0 por un dato corrupto).
 */
export interface VariantPriceControls {
  sellOverrideCents?: number | null;
  buyOverrideCents?: number | null;
  bountyEnabled?: boolean;
  bountyPriceCents?: number | null;
}


// ============================================================================
// v2.0 (P-48, §4.36.2/§4.36.6) — PRECIO PURO POR VALOR DE MERCADO: las DOS funciones de dinero.
//
// SUSTITUYEN (en E8 se BORRA lo viejo): applyRule, resolveRuleForFinish, resolveTwoAxisRule,
// ruleKeyCandidates, finishRuleFor, lookupRarityRule, toPriceRuleSet, buildEffectiveRuleSet,
// isPriceRuleSet, isTieredRuleSet, quoteAcquisitionForFinish, computeSalePriceForRarity e
// isPremiumRarity/PREMIUM_RARITY_PATTERNS.
//
// NI `rarity` NI `finish` SON PARÁMETROS — es el criterio 84 hecho tipo: *no se puede* consultar la
// rareza desde el pricing porque NO ESTÁ EN LA FIRMA. El acabado sigue determinando DE QUÉ VARIANTE se
// lee el mercado (`getReference(cardId, productType, gradeKey, finish)`), pero eso ocurre ANTES, en la
// capa de servicio.
// ============================================================================

/** Resultado de dinero de la curva, con la señal server-side de QUÉ lo determinó. */
export interface CurvePriceResult {
  /** `null` ⇔ `basis === 'pending'`. JAMÁS MX$0 ni un precio inventado. */
  priceCents: number | null;
  basis: PriceBasis;
  /**
   * El mercado que ENTRÓ al cálculo, CRUDO en centavos (instrumentación §4.36.7c). Es passthrough
   * honesto del insumo: `null` cuando no había referencia (aunque un override/bounty haya fijado el
   * monto). Jamás un 0 inventado.
   */
  marketMxnCents: number | null;
  /**
   * Lo que da LA CURVA hoy para ese mercado, INDEPENDIENTEMENTE de qué peldaño ganó. Dos consumidores
   * lo necesitan y por eso se devuelve en vez de recalcularse: (1) la REVALIDACIÓN DEL BOUNTY
   * (§4.36.6 — un bounty por debajo o igual de esto deja de ser bounty) y (2) el `suggestedCents` de
   * la consola del binder. `null` = la curva no resuelve (sin mercado).
   */
  curveQuoteCents: number | null;
}

/**
 * VENTA (§4.36.6). Precedencia NORMATIVA:
 *   1. `InventoryItem.listPriceCents` (POR PIEZA) → la aplican los CALLERS antes de llamar aquí
 *      (la intención más específica gana); su basis también es `override`.
 *   2. `sellOverrideCents` (variante, M-30) → `override`. **ABSOLUTO**: puede quedar POR DEBAJO de la
 *      curva —decisión deliberada del admin— y NO se convierte en piso. PROHIBIDO envolverlo en un
 *      `max(...)` con la curva: sería reintroducir en espejo el bug que este cambio cierra.
 *   3. CURVA `redondeo↑(max(piso, mercado × markup(mercado)))` → `market` | `floor`.
 *   4. sin resolver → `pending` (no se publica; el guardarraíl y la cola los aplica el servicio).
 */
export function computeSalePriceFromCurve(
  marketMxnCents: number | null,
  curve: PricingCurve,
  controls?: VariantPriceControls | null,
): CurvePriceResult {
  const fromCurve = resolveSaleFromCurve(marketMxnCents, curve);
  const curveQuoteCents = fromCurve.cents == null ? null : clampCents(fromCurve.cents);
  // 2. Override de venta de la variante. Regla de presencia H-1: presente ⇔ > 0 (un <= 0 es input
  //    degenerado y se trata como AUSENTE — jamás se vende gratis por un dato corrupto).
  if (controls?.sellOverrideCents != null && controls.sellOverrideCents > 0) {
    return {
      priceCents: clampCents(controls.sellOverrideCents),
      basis: 'override',
      marketMxnCents,
      curveQuoteCents,
    };
  }
  // 3./4. La curva (o pendiente).
  return { priceCents: curveQuoteCents, basis: fromCurve.basis, marketMxnCents, curveQuoteCents };
}

/**
 * COMPRA (§4.36.6). Precedencia NORMATIVA:
 *   1. **bounty VÁLIDO** → `bounty`. Válido = habilitado, `priceCents > 0` y **ESTRICTAMENTE MAYOR**
 *      que la cotización de la curva vigente (criterio 91). Un bounty rebasado por la curva DEJA DE
 *      SER BOUNTY: se salta este peldaño y se paga la curva. El bounty NUNCA se compara contra el
 *      mercado — solo contra la curva (vive en la escala de compra, 30–50 % del mercado).
 *   2. `buyOverrideCents` (variante, M-30) → `override`. **ABSOLUTO**, igual que en venta.
 *   3. CURVA `max(bin, mercado × pct(mercado))` (SIN redondeo) → `market` | `floor`.
 *   4. sin resolver → `pending`.
 *
 * Este es el ÚNICO cuerpo de la precedencia de compra: quote público, quote batch, createRequest y la
 * vitrina `/buylist/bounties` DEBEN pasar por aquí — prohibido duplicarlo.
 */
export function quoteAcquisitionFromCurve(
  marketMxnCents: number | null,
  curve: PricingCurve,
  controls?: VariantPriceControls | null,
): CurvePriceResult {
  const fromCurve = resolveBuyFromCurve(marketMxnCents, curve);
  const curveQuoteCents = fromCurve.cents == null ? null : clampCents(fromCurve.cents);
  // 1. Bounty, REVALIDADO contra la curva vigente (no solo al crear: también aquí, al cotizar).
  if (controls?.bountyEnabled && isBountyEffective(controls.bountyPriceCents ?? null, curveQuoteCents)) {
    return {
      priceCents: clampCents(controls.bountyPriceCents as number),
      basis: 'bounty',
      marketMxnCents,
      curveQuoteCents,
    };
  }
  // 2. Override manual de compra (ABSOLUTO; puede quedar por debajo de la curva a propósito).
  if (controls?.buyOverrideCents != null && controls.buyOverrideCents > 0) {
    return {
      priceCents: clampCents(controls.buyOverrideCents),
      basis: 'override',
      marketMxnCents,
      curveQuoteCents,
    };
  }
  // 3./4. La curva (o pendiente).
  return { priceCents: curveQuoteCents, basis: fromCurve.basis, marketMxnCents, curveQuoteCents };
}

/**
 * v1.23-sealed-sales (§4.23b) — precio de VENTA del SELLADO por PRESENTACIÓN. Hermana de
 * `computeSalePriceForRarity`, keyeada por `SealedSubtype` en vez de rareza+acabado.
 * `source` = de dónde salió el precio (SealedSpreadSource del contrato).
 */
export type SealedSpreadSource = 'override' | 'subtype_spread' | 'global_spread';
export interface SealedSpreadResult {
  salePriceCents: number | null;
  status: 'priced' | 'pending';
  source: SealedSpreadSource;
  /** null cuando source='override'. */
  appliedSpreadPct: number | null;
}

/**
 * Precedencia money-safe (SEC-A1, todo server-side — ARCHITECTURE §4.23a):
 *   override (InventoryItem.listPriceCents), SI es > 0            ← gana SIEMPRE si presente y positivo
 *     > mercado × (1 + spread_de_su_presentación/100)             ← si hay market y su SealedSubtype tiene spread
 *     > mercado × (1 + spread_global/100)                         ← si hay market pero sin spread de presentación
 *     > (sin precio) ⇒ PRICE_PENDING ⇒ NO se publica              ← sin mercado y sin override, NUNCA se inventa
 *
 * REGLA ÚNICA DE OVERRIDE (H-1, v1.24): un override se considera presente SOLO si `overrideCents > 0`.
 * Un override `<= 0` (0 o negativo) es INPUT DEGENERADO y se trata como AUSENTE — el precio cae a
 * mercado×spread (y a PRICE_PENDING si tampoco hay mercado). Elección money-safe: nunca se cobra un
 * sellado GRATIS ni por DEBAJO de mercado por un override mal capturado; para descontar una caja con
 * detalle el admin fija un override POSITIVO por debajo de mercado (deliberado), no un 0. Esta regla
 * es la MISMA en catálogo, Compra (orders), grid y bulk-publish (todos vía `resolveSealedSalePrice`).
 *
 * La condición NO altera el precio (el spread es por presentación). `pct` = markup ARRIBA de mercado
 * (como ventas §4.14, NO «% de la referencia» del buylist). `subtype`/`market`/`override` salen de BD;
 * los spreads de ConfigSetting. Nada viene del DTO del cliente.
 */
export function computeSealedSalePrice(
  overrideCents: number | null,
  sealedSubtype: string | null,
  marketMxnCents: number | null,
  spreadPctBySubtype: Record<string, number>,
  fallbackPct: number,
): SealedSpreadResult {
  // H-1: override presente ⇔ > 0 (un 0/negativo es degenerado ⇒ se ignora, cae a mercado×spread).
  if (overrideCents != null && overrideCents > 0) {
    // BE-27: clamp final del override (persistible en `*Cents`, Int32).
    return { salePriceCents: clampCents(overrideCents), status: 'priced', source: 'override', appliedSpreadPct: null };
  }
  const hasSubtypeSpread = sealedSubtype != null && spreadPctBySubtype[sealedSubtype] != null;
  const spread = hasSubtypeSpread ? spreadPctBySubtype[sealedSubtype as string] : fallbackPct;
  const source: SealedSpreadSource = hasSubtypeSpread ? 'subtype_spread' : 'global_spread';
  if (marketMxnCents == null) {
    // Sin mercado y sin override → pendiente (no publicable). NUNCA se inventa un precio.
    return { salePriceCents: null, status: 'pending', source, appliedSpreadPct: spread };
  }
  return {
    salePriceCents: clampCents(Math.round(marketMxnCents * (1 + spread / 100))),
    status: 'priced',
    source,
    appliedSpreadPct: spread,
  };
}

/**
 * v2.0 (P-48, §4.36.7a) — `priceBasis` DERIVADO del sellado. **La matemática del sellado NO cambia**
 * (§4.23/§K: `override > mercado × spread por presentación > mercado × spread global > PRICE_PENDING`,
 * con sus semillas box 18 / etb 22 / bundle 25 / tin 30 / blister 35 / global 25). Lo único que gana es
 * esta señal, para que el front tenga UNA SOLA regla de visibilidad del «Valor de mercado» en las dos
 * fichas (carta y sellado), sin ramas por tipo de producto:
 *
 *   `override`                       ⇒ `override` ⇒ NO se muestra
 *   `subtype_spread | global_spread` ⇒ `market`   ⇒ SÍ se muestra
 *   sin precio (PRICE_PENDING)       ⇒ `pending`  ⇒ NO se muestra
 *
 * Verificable: el PRECIO de un sellado antes y después de v2.0 es IDÉNTICO (criterio 85).
 */
export function sealedPriceBasisOf(result: SealedSpreadResult): PriceBasis {
  if (result.status === 'pending' || result.salePriceCents == null) return 'pending';
  return result.source === 'override' ? 'override' : 'market';
}

export interface BreakdownDTO {
  /**
   * ⚠️⚠️ **Bajo `IVA_INCLUSIVE` esto es `Σ displayPriceCents` ⇒ YA LLEVA EL IVA DENTRO**
   * (`API_CONTRACT §M10-IVA.4`). Bajo `IVA_EXCLUSIVE` (filas anteriores al corte D56) es la base
   * limpia de siempre. **La diferencia la dice `priceConvention`, nunca el nombre del campo.**
   */
  subtotalCents: number;
  /**
   * **RESIDUAL** del agregado `G = subtotal + envío`: `G − round(G/(1+r))`. ⛔ **Jamás 0**, ni con
   * el dial de traslación en 0 % (`IVA-8(a)`): mover el dial reduce el NETO, nunca el impuesto.
   */
  ivaCents: number;
  ivaRatePct: number;
  processingFeeCents: number;
  totalCents: number;
  currency: 'MXN';
  /**
   * ⭐⭐ v1.64/D56 (`API_CONTRACT §M10-IVA.4`, ADITIVO y NORMATIVO) — **la convención de ESTE
   * desglose**. Sin ella, `subtotalCents` es un número sin interpretación: el mismo entero significa
   * «base limpia» o «precio con IVA dentro» según con qué regla se cobró, y **ninguna de las dos
   * lecturas revienta**. *Un importe cuya convención no viaja con él se lee mal en silencio.*
   */
  priceConvention: PriceConvention;
  /** `= (priceConvention === 'IVA_INCLUSIVE')`. La señal que el front pinta («IVA 16 % incluido»). */
  ivaIncluded: boolean;
}

/**
 * v1.21-guest-checkout — `BreakdownDTO` + la línea de envío cobrada DENTRO de la misma orden
 * (`direct_ship`). Aditivo: un `DirectShipBreakdownDTO` ES un `BreakdownDTO` válido.
 */
export interface DirectShipBreakdownDTO extends BreakdownDTO {
  /** Tarifa de envío (dial `SHIPPING_FEE_CENTS`) cobrada en el MISMO PaymentIntent. */
  shippingFeeCents: number;
}

/**
 * ⭐⭐ **`P` — EL PRECIO EXHIBIDO, en aritmética ENTERA** (`ARCHITECTURE §4.44.b/.c`, regla **R1**).
 *
 * `P = round(L × (1 + t·r))`, evaluado como **`L + round(L × t × r / 10000)`** con `t` (fracción de
 * traslación) y `r` (TASA) enteros en `[0,100]`.
 *
 * ### Por qué entera y no `L × 1.16`
 * Es **la misma cifra** —`round(L × (1+t·r)) = L + round(L × t·r)` porque sumar un entero conmuta
 * con el redondeo (§4.44.c.1-ter punto 1)— pero evita meter `1.16`, que **no es representable en
 * binario**, en una multiplicación que decide dinero. Cota: `L × t × r ≤ MAX_CENTS × 100 × 100 ≈
 * 2.1e13`, muy por debajo de `Number.MAX_SAFE_INTEGER` ⇒ el producto intermedio es **exacto**.
 *
 * ### La regla madre, dicha en una línea
 * **`L` no cambia nunca. `P` se deriva. El dial mueve `P`, jamás `L`.** Con `t = 100` (el neutro)
 * reproduce **al centavo** el `L × (1+r)` de hoy: es lo que sostiene el criterio **185** y `IVA-1`.
 *
 * ⚠️ **Vive en `common/money.ts` y no en `modules/settings/`** para que el catálogo y el checkout no
 * tengan que importar del módulo del dial para derivar un precio. *La aritmética del dinero es del
 * núcleo; la puerta del dial es de settings.*
 */
export function displayPriceCentsOf(
  listPriceCents: number,
  ivaTransferPct: number,
  ivaRatePct: number,
): number {
  return listPriceCents + Math.round((listPriceCents * ivaTransferPct * ivaRatePct) / 10_000);
}

/**
 * ⭐ **Los DOS diales que derivan `P`, juntos.** (`SettingsService.getIvaDials`.)
 *
 * ⛔ **Son dos filas `ConfigSetting` INDEPENDIENTES y ninguna deriva de la otra** (`IVA-7`).
 * Que viajen en el mismo objeto ⛔ **no las acopla**: es que `P = round(L × (1 + t·r))` necesita las
 * dos **a la vez y del mismo instante**, para que dos líneas del mismo carrito no se deriven con
 * posiciones distintas del dial.
 */
export interface IvaDials {
  /** `t` — **FRACCIÓN DE TRASLACIÓN**, entero `[0,100]`. ⛔ **No son puntos de IVA.** */
  ivaTransferPct: number;
  /** `r` — la **TASA** del impuesto, entero `[0,100]`. ⛔ **No es el dial.** */
  ivaRatePct: number;
}

/**
 * ⭐ **`E` — LA TARIFA DE ENVÍO EXHIBIDA: el envío entra en la regla madre COMO UN `L` MÁS**
 * (`ARCHITECTURE §4.44.f`, criterio **189**, candado **`IVA-6`**).
 *
 * `E = round(F × (1 + t·r))`, con `F` = el dial `shipping_fee_cents`, que **sigue siendo NETO y no
 * cambia de valor**.
 *
 * ⚠️ **Money-neutral por construcción con el dial en 100 %:** `round(17500 × 1.16) = 20300`, que es
 * **exactamente** lo que hoy aportan `17500 + round(17500 × 0.16) = 17500 + 2800`. **Ni un centavo.**
 *
 * **Por qué existe como función propia en vez de llamar a `displayPriceCentsOf` a pelo:** para que
 * el sitio donde se decide *«el envío lleva su IVA dentro»* sea **nombrable y único**. Es la decisión
 * que el criterio 189 obliga (*«ningún importe de IVA sumado después del precio exhibido»*) y la que
 * `IVA-6` pone en rojo si alguien vuelve a apilar `round(E × r)` detrás de la tarifa.
 */
export function shippingFeeDisplayCentsOf(
  shippingFeeNetCents: number,
  dials: IvaDials,
): number {
  return displayPriceCentsOf(shippingFeeNetCents, dials.ivaTransferPct, dials.ivaRatePct);
}

/**
 * ⭐ **La BASE GRAVABLE a partir de un importe que YA lleva el IVA dentro: `round(G / (1 + r))`**,
 * en aritmética entera (`round(G × 100 / (100 + r))`).
 *
 * ⛔ **El IVA se saca por RESTA (`G − taxBase`), nunca por `round(G × r)`**: es la regla **R2** de
 * `ARCHITECTURE §4.44.c`, y es lo que hace de `taxBase + iva ≡ G` una **identidad** en vez de una
 * coincidencia que se descuadra un centavo (`IVA-4(b)`).
 *
 * ⛔ **Y la flecha va en UN SOLO SENTIDO (regla R3): precio → desglose.** Prohibido reconstruir `P`
 * desde `taxBase` (`taxBase × (1+r)` puede diferir un centavo, y esa dirección convierte un desglose
 * en un **recobro**).
 */
export function taxBaseCentsOf(grossAmountCents: number, ivaRatePct: number): number {
  return Math.round((grossAmountCents * 100) / (100 + ivaRatePct));
}

/**
 * ⭐⭐ **EL ÚNICO `switch` SOBRE `PriceConvention` DE TODO `backend/src`** — el **lector** que
 * `IVA-12(b)` nombra en singular y que `IVA-3` exige conservar.
 *
 * ### Por qué UNO y no uno por helper
 * Cada `case 'IVA_EXCLUSIVE'` extra es un sitio donde la decisión puede divergir **y** una fila más
 * en el censo de `IVA-12`. Con un solo switch, `netRevenueCents`, `netShippingRevenueCents` y el
 * desglose comparten literalmente la misma rama: **no pueden interpretarse distinto la misma fila**.
 *
 * ### ⚠️⚠️ EL `default` LANZA, Y ESO ES LA FUNCIONALIDAD, no una paranoia
 * Un `?? false` o un `: 'IVA_EXCLUSIVE'` de cortesía es **exactamente la mutación que `IVA-3` mata**:
 * haría que una fila sin convención —la que un camino de escritura olvidó etiquetar— se interprete en
 * silencio bajo la convención que ese día sea mayoría. La columna es `NOT NULL` **y sin default de
 * BD** justamente para que ese estado no exista; si aun así llega aquí (mock incompleto, fila
 * sembrada a mano, `select` que olvidó la columna) **es un error de programación y tiene que sonar**,
 * no producir una cifra plausible.
 */
export function ivaIsIncluded(priceConvention: PriceConvention): boolean {
  switch (priceConvention) {
    // El IVA se cobró APARTE: el subtotal es base limpia. Es la convención de toda fila cobrada
    // antes de D56, y ⛔ NO se borra — `IVA-3`: una orden ya cobrada no se reinterpreta sola.
    case 'IVA_EXCLUSIVE':
      return false;
    // El IVA viaja DENTRO del precio exhibido (la convención con la que se cobra desde D56).
    case 'IVA_INCLUSIVE':
      return true;
    default:
      throw new Error(
        `ivaIsIncluded: unknown priceConvention ${JSON.stringify(priceConvention)} — ` +
          'a money row without a convention has no interpretation and MUST NOT be guessed ' +
          '(ARCHITECTURE §4.44.e/§4.44.j, candado IVA-3)',
      );
  }
}

/**
 * ⭐⭐ **LA CONVENCIÓN CON LA QUE NACE TODA FILA DE DINERO NUEVA** (D56, criterio **214**).
 *
 * ⛔ **No es un default de cortesía y no sustituye a la columna**: la columna sigue siendo `NOT NULL`
 * **sin `DEFAULT` de BD** (`IVA-3(c)`), así que un camino de escritura que olvide estamparla sigue
 * reventando con violación de `NOT NULL`. Lo que esta constante hace es que los **cinco** escritores
 * digan lo mismo **desde una sola fuente**: antes eran cinco literales, y `ARCHITECTURE §4.35a` ya
 * documenta lo que cuesta que una decisión de dinero viva copiada en cinco sitios.
 */
export const PRICE_CONVENTION_OF_NEW_ROWS: PriceConvention = 'IVA_INCLUSIVE';

/**
 * ⭐⭐ **EL CUERPO ÚNICO DE LOS TRES DESGLOSES** (`ARCHITECTURE §4.44.c`, `API_CONTRACT §M10-IVA.4`).
 *
 * ```
 * G        = S + E                       // (4) BASE DEL GROSS-UP  ⚠️⚠️ NO es `S + E + iva`
 * taxBase  = round( G / (1 + r) )        // (5) base gravable, UNA sola vez, sobre el AGREGADO
 * iva      = G − taxBase                 // (6) RESIDUAL. Jamás se calcula por su cuenta
 * total    = grossUpTotal(G, fee)        // (7) sin cambio
 * fee      = total − G                   // (8) sin cambio
 * ```
 *
 * ⚠️⚠️ **LA LÍNEA DE MAYOR RIESGO DE TODO EL CAMBIO, y por eso vive en UN solo sitio: `G = S + E`.**
 * Bajo `IVA_INCLUSIVE` el IVA **ya está dentro de `S`**; sumarlo otra vez a la base del gross-up lo
 * **cobra dos veces**: con el fixture de `IVA-1` (`S = 11600`) daría `G = 13200` ⇒ `totalCents =
 * 14164` en vez de `12469` — **+13.6 % a TODOS los clientes, en silencio, sin log**. Candado
 * **`IVA-2`**. *Tres copias de esta línea eran tres sitios donde reintroducir el mismo defecto.*
 *
 * ⛔ **Norma de nombres, obligatoria porque el nombre ERA el defecto** (§4.44.d): la base del
 * gross-up se llama **`grossUpBaseCents`** y la gravable **`taxBaseCents`**. **Prohibido que
 * sobreviva un identificador `baseCents` a secas**, que es como se alimentaba `subtotal + iva`.
 */
function inclusiveBreakdown(
  subtotalCents: number,
  shippingFeeCents: number,
  ivaRatePct: number,
  fee: StripeFeeConfig,
): {
  ivaCents: number;
  processingFeeCents: number;
  totalCents: number;
  priceConvention: PriceConvention;
  ivaIncluded: boolean;
} {
  const grossUpBaseCents = subtotalCents + shippingFeeCents;
  const taxBaseCents = taxBaseCentsOf(grossUpBaseCents, ivaRatePct);
  const totalCents = grossUpTotal(grossUpBaseCents, fee);
  return {
    // RESIDUAL (R2/R3): el redondeo lo absorbe el IVA, jamás el precio exhibido.
    ivaCents: grossUpBaseCents - taxBaseCents,
    processingFeeCents: totalCents - grossUpBaseCents,
    totalCents,
    // ⭐⭐ D56 / criterio **214**: toda fila NUEVA nace bajo la convención nueva. Es la MISMA
    // decisión que toman los cinco escritores, tomada una vez y en el sitio donde se hace el dinero.
    priceConvention: PRICE_CONVENTION_OF_NEW_ROWS,
    ivaIncluded: ivaIsIncluded(PRICE_CONVENTION_OF_NEW_ROWS),
  };
}


/**
 * Desglose de compra de cartas (bóveda). `ARCHITECTURE §4.44.c`, `API_CONTRACT §M10-IVA.4`.
 *
 * ⚠️ `subtotalCents` entra **YA DERIVADO**: es `Σ P` (`Σ displayPriceCents`), no `Σ L`. Quien lo
 * suma es el checkout, que congela cada `P` por línea (regla **R1**: se redondea una vez POR UNIDAD,
 * y el subtotal es **suma exacta de enteros** ⇒ el criterio **194** se cumple por construcción).
 */
export function computeCartBreakdown(
  subtotalCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  return {
    subtotalCents,
    ivaRatePct: ivaPct,
    currency: 'MXN',
    ...inclusiveBreakdown(subtotalCents, 0, ivaPct, fee),
  };
}

/**
 * Desglose de retiro/envío de bóveda. En el DTO, `subtotalCents` = **la tarifa de envío exhibida**
 * `E` (ver `API_CONTRACT §5`), que bajo `IVA_INCLUSIVE` **ya lleva su IVA dentro**
 * (`E = round(F × (1+t·r))`, §4.44.f).
 *
 * ⚠️ **Money-neutral con el dial en 100 %**: `round(17500 × 1.16) = 20300`, que es **exactamente** lo
 * que hoy aportan `17500 + 2800`. Candado `IVA-6`.
 */
export function computeShipmentBreakdown(
  shippingFeeCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  return {
    subtotalCents: shippingFeeCents,
    ivaRatePct: ivaPct,
    currency: 'MXN',
    // El «subtotal» de esta fila ES la tarifa ⇒ el agregado `G` es la tarifa sola. Se pasa por el
    // primer parámetro (y `0` de envío) para que `G` sea `E` y no `2E`.
    ...inclusiveBreakdown(shippingFeeCents, 0, ivaPct, fee),
  };
}

/**
 * v1.21-guest-checkout (§4-G.1/§4-G.2) — desglose de una compra con **ENVÍO DIRECTO**
 * (`direct_ship`): el envío se cobra en el MISMO PaymentIntent que las cartas.
 *
 * ⚠️⚠️ **Aquí es donde el criterio 189 se gana o se pierde.** Hasta D56 esta función apilaba
 * `round((S+E) × r)` **después** del precio exhibido. Ahora `S` y `E` llevan su IVA dentro y el total
 * es `grossUpTotal(S + E)` — **ningún importe de IVA sumado después del precio exhibido**, que es
 * literalmente lo que el criterio exige. Candados `IVA-2(b)` y `IVA-6`.
 */
export function computeDirectShipBreakdown(
  subtotalCents: number,
  shippingFeeCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): DirectShipBreakdownDTO {
  return {
    subtotalCents,
    shippingFeeCents,
    ivaRatePct: ivaPct,
    currency: 'MXN',
    ...inclusiveBreakdown(subtotalCents, shippingFeeCents, ivaPct, fee),
  };
}

/**
 * ⭐⭐ **`netRevenueCents` — EL INGRESO PROPIO DE MERCANCÍA DE UNA FILA DE DINERO, y el ÚNICO lugar
 * donde vive esa decisión** (`ARCHITECTURE §4.44.j`, criterio **191**).
 *
 * **El defecto que existe para evitar.** `admin.service.ts` hacía `incomeCents += o.subtotalCents`.
 * Con `subtotalCents` llevando el IVA dentro, ese reporte **no revienta: MIENTE**, contando el
 * impuesto que se le debe al SAT como ingreso propio. *Un reporte que revienta se arregla; uno que
 * miente se cree.*
 *
 * ⭐⭐ **LA FÓRMULA ES `round(S/(1+r))`, ⛔ NO `S − ivaCents`, y la diferencia es de 2 800 por pedido
 * con envío.** Bajo `IVA_INCLUSIVE`, `Order.ivaCents` es el residual del **AGREGADO** `G = S + E`
 * (regla R2) ⇒ **incluye el IVA del envío**; restarlo entero del subtotal **le quita a la mercancía
 * un IVA que no es suyo**. Con el caso real (`S = 11600`, `E = 20300`, `ivaCents = 4400`) daría
 * **`7200`** donde son **`10000`**. Es el defecto que `ARCHITECTURE §9 · D-IVA-10` corrigió y que
 * `IVA-9(b)` pone en rojo.
 *
 * ⛔ **Se deriva SOLO de columnas PERSISTIDAS de ESA fila.** ⛔ Nunca del dial vivo, ⛔ nunca de
 * `ivaTransferPct`, ⛔ nunca recalculando desde el precio de lista. Por eso una orden de hace un año
 * sigue aportando **exactamente** lo que aportaba, y por eso mover el dial **no puede** cambiar ni un
 * centavo de un periodo ya cerrado (criterio **190**, candado `IVA-5` ⭐⭐).
 */
export function netRevenueCents(row: {
  subtotalCents: number;
  ivaRatePct: number;
  priceConvention: PriceConvention;
}): number {
  // El IVA se cobró APARTE ⇒ el subtotal YA es el ingreso propio. Bit a bit lo de antes de D56.
  // El IVA viaja DENTRO ⇒ el ingreso propio es la BASE GRAVABLE de la mercancía, por su propia base.
  return ivaIsIncluded(row.priceConvention)
    ? taxBaseCentsOf(row.subtotalCents, row.ivaRatePct)
    : row.subtotalCents;
}

/**
 * ⭐⭐ **`netShippingRevenueCents` — EL IVA DEL ENVÍO ES «EL RESIDUAL DEL RESIDUAL»**
 * (`ARCHITECTURE §4.44.j.1`, candado **`IVA-9`**).
 *
 * ```
 * ivaMercanciaCents = S − round(S / (1+r))         // el IVA de la mercancía, por su propia base
 * ivaEnvioCents     = ivaCents − ivaMercanciaCents // ⭐ EL ENVÍO ABSORBE EL RESIDUO
 * netShipping       = E − ivaEnvioCents
 * ```
 *
 * ⭐ **La identidad, y es EXACTA — cero centavos de deriva:**
 * `netRevenueCents + netShippingRevenueCents + ivaCents ≡ subtotalCents + shippingFeeCents`
 * (`10000 + 17500 + 4400 = 31900 = 11600 + 20300`). **`IVA-9(a)` la asierta con ±0.**
 *
 * **Por qué el ENVÍO absorbe el centavo y no la mercancía:** (1) la mercancía ya tiene fórmula
 * canónica y publicada (criterio 191) y es la cifra grande y auditada; (2) el envío es, por decisión
 * del dueño (§4.44.f-bis), *«costo operativo trasladado, no una venta»* ⇒ es el sitio correcto para
 * aparcar un centavo de asignación; (3) es **R3** un nivel más abajo: *el residual absorbe el
 * redondeo, jamás la cifra autoritativa*.
 *
 * ⛔⛔ **PROHIBIDO RECALCULAR `Order.ivaCents` A PARTIR DE LAS PARTES.** La flecha va
 * `ivaCents → partes`, **nunca** `partes → ivaCents`: `ivaCents` es **fiscal** y es la única fuente
 * de la factura manual (criterio 192). `IVA-9(d)` lo mide alterando `ivaCents` a pelo en la BD y
 * exigiendo que **esta** cifra se mueva y aquélla no.
 *
 * ⛔ **Y NO es `round(E/(1+r))`**, que es la mutación que `IVA-9` declara roja: repartir el IVA del
 * envío por su cuenta puede diferir del residual agregado en ±1 centavo y rompe la identidad.
 */
export function netShippingRevenueCents(o: {
  subtotalCents: number;
  shippingFeeCents: number;
  ivaCents: number;
  ivaRatePct: number;
  priceConvention: PriceConvention;
}): number {
  // Bajo `IVA_EXCLUSIVE` la tarifa persistida YA es neta (el IVA se apiló aparte, en `ivaCents`).
  if (!ivaIsIncluded(o.priceConvention)) return o.shippingFeeCents;
  const ivaMercanciaCents = o.subtotalCents - taxBaseCentsOf(o.subtotalCents, o.ivaRatePct);
  const ivaEnvioCents = o.ivaCents - ivaMercanciaCents;
  return o.shippingFeeCents - ivaEnvioCents;
}

/**
 * ⭐ **El ingreso neto de una `ShipmentRequest` (retiro de bóveda), y por qué NO puede usar
 * {@link netRevenueCents}.**
 *
 * **`ShipmentRequest` NO TIENE `ivaRatePct`** (medido: `schema.prisma`; solo `Order` lo tiene), así
 * que `round(E/(1+r))` obligaría a leer **el dial VIVO** y entonces **un P&L histórico cambiaría el
 * día que alguien mueva `iva_pct`** — que es exactamente lo que `IVA-5` prohíbe.
 *
 * ⇒ Se netea **por RESTA de columnas persistidas**: en esta fila `subtotalCents ≡ shippingFeeCents`
 * (así lo escribe `computeShipmentBreakdown`) y por tanto `G = E` ⇒ `ivaCents` **es** el IVA del
 * envío, entero, sin reparto que hacer. **`net = E − ivaCents = round(E/(1+r))`, exacto y sin leer
 * ningún dial.** *El dato primario manda; la tasa se queda donde está congelada.*
 *
 * Las filas de **fulfillment** de `direct_ship` llevan `shippingFeeCents = 0` e `ivaCents = 0` a
 * propósito (el ingreso vive en `Order.shippingFeeCents`) ⇒ aportan `0` bajo las dos convenciones.
 */
export function shipmentNetRevenueCents(s: {
  shippingFeeCents: number;
  ivaCents: number;
  priceConvention: PriceConvention;
}): number {
  return ivaIsIncluded(s.priceConvention) ? s.shippingFeeCents - s.ivaCents : s.shippingFeeCents;
}

/**
 * ⭐ **El COSTO NETO del envío: una RESTA, ⛔ jamás una división** (`API_CONTRACT §M10-IVA.8`,
 * `ARCHITECTURE §4.44.f-ter`, candado **`IVA-11(c)`**).
 *
 * `shippingCostCents` es **BRUTO** —el importe TOTAL de la factura de la paquetería, IVA incluido, que
 * es la cifra que trae el papel— y `shippingCostIvaCents` es el **IVA acreditable CONGELADO al
 * capturar**. ⛔ Nunca `costo/(1+r)`: `ShipmentRequest` no tiene `ivaRatePct` y derivarlo haría que un
 * P&L histórico cambiara al mover el dial (incumple `IVA-5`).
 *
 * **Filas históricas:** `shippingCostIvaCents = 0` ⇒ `neto = bruto`. Es la dirección **conservadora**
 * (subestima la ganancia, no la infla) y dice la verdad: *«no consta crédito»*. ⛔ Sin backfill.
 */
export function netShippingCostCents(s: {
  shippingCostCents: number;
  shippingCostIvaCents: number;
}): number {
  return s.shippingCostCents - s.shippingCostIvaCents;
}

/**
 * Gross-up del total para que, tras la comisión Stripe (pct + fija) MÁS el IVA que
 * Stripe MX cobra sobre esa comisión, la plataforma reciba íntegro `grossUpBaseCents`.
 *
 * C1: la deducción real de Stripe es `(1 + ivaFee) × (pct × total + fija)`. Resolviendo
 * `total − (1+ivaFee)(pct·total + fija) = base`:
 *   total = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct)).
 *
 * MS-2 (BE-27): CHOKE POINT del overflow de AGREGADOS. Todo breakdown (cart/shipment/direct-ship)
 * deriva su `totalCents` aquí, y `total >= base >= subtotal` (y `>= iva`, `>= processingFee`), así
 * que un total representable garantiza que TODOS los `*Cents` persistidos en `Order` caben en Int32.
 * Un agregado NO se puede CLAMPAR en silencio (recortar el total = subcobro): si excede `MAX_CENTS`
 * se **LANZA** (mismo patrón de `throw` de las guardias de fee de arriba) en vez de reventar al
 * persistir la Order (excepción Postgres = DoS del checkout). El caller de negocio (orders/checkout)
 * lo traduce a `AMOUNT_TOO_LARGE` (422). El clamp UNITARIO de `clampCents` es red de última instancia
 * aparte; el agregado es la señal fuerte y visible (ver nota MS-3 en `clampCents`).
 */
export function grossUpTotal(grossUpBaseCents: number, fee: StripeFeeConfig): number {
  const ivaMul = 1 + fee.stripeFeeIvaPct;
  if (fee.stripeFeeIvaPct < 0 || !Number.isFinite(fee.stripeFeeIvaPct)) {
    throw new Error('stripeFeeIvaPct must be a finite number >= 0');
  }
  const effectivePct = fee.stripePct * ivaMul;
  if (effectivePct < 0 || effectivePct >= 1) {
    throw new Error('effective stripe pct (stripePct × (1 + stripeFeeIvaPct)) must be in [0, 1)');
  }
  const effectiveFixed = fee.stripeFixedCents * ivaMul;
  const total = Math.ceil((grossUpBaseCents + effectiveFixed) / (1 - effectivePct));
  // MS-2: agregado no representable en Int32 → se RECHAZA (nunca se clampa: recortar = subcobro).
  if (total > MAX_CENTS) {
    throw new Error('total exceeds MAX_CENTS (Int32) — order amount not representable');
  }
  return total;
}

/** Precio MXN desde USD con FX + colchón. ARCHITECTURE §3.2 FxRate. */
export function usdToMxnCents(priceUsdCents: number, rate: number, bufferPct: number): number {
  return clampCents(Math.round(priceUsdCents * rate * (1 + bufferPct / 100)));
}
