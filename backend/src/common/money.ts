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
  subtotalCents: number;
  ivaCents: number;
  ivaRatePct: number;
  processingFeeCents: number;
  totalCents: number;
  currency: 'MXN';
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
 * Desglose de compra de cartas. ARCHITECTURE §5.1.
 *   subtotal = Σ salePrice
 *   iva      = round(subtotal × ivaPct/100)                (IVA grava el subtotal)
 *   base     = subtotal + iva                              (lo que la plataforma recibe íntegro)
 *   total    = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct))   (gross-up con IVA de Stripe)
 *   fee      = total − base                                (línea visible; incluye el IVA de la comisión Stripe)
 */
export function computeCartBreakdown(
  subtotalCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  const ivaCents = Math.round((subtotalCents * ivaPct) / 100);
  const baseCents = subtotalCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * Desglose de retiro/envío. ARCHITECTURE §5.1.
 * El IVA grava la tarifa de envío; el fee es gross-up (sin IVA).
 * En el DTO, subtotalCents = tarifa de envío (ver API_CONTRACT §5).
 */
export function computeShipmentBreakdown(
  shippingFeeCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  const ivaCents = Math.round((shippingFeeCents * ivaPct) / 100);
  const baseCents = shippingFeeCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents: shippingFeeCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * v1.21-guest-checkout (§4-G.1/§4-G.2) — desglose de una compra con ENVÍO DIRECTO (`direct_ship`).
 * ADITIVA: `computeCartBreakdown` y `computeShipmentBreakdown` NO se tocan.
 *
 * Diferencia estructural con el flujo de bóveda: el envío se cobra en el MISMO PaymentIntent que
 * las cartas (el invitado no tiene bóveda desde donde pedir un segundo retiro), así que:
 *   subtotal = Σ salePrice                      (solo cartas; es lo que el DTO llama subtotalCents)
 *   iva      = round((subtotal + envío) × ivaPct/100)   (el IVA grava cartas Y tarifa de envío)
 *   base     = subtotal + envío + iva           (lo que la plataforma debe recibir íntegro)
 *   total    = grossUp(base)                    (misma fórmula de gross-up, incl. IVA de la comisión)
 *   fee      = total − base
 *
 * `shippingFeeCents` viaja aparte del `subtotalCents` para que la UI lo muestre como línea propia
 * y para que el P&L (M7) lo lea de `Order.shippingFeeCents` sin doble conteo (ARCHITECTURE §4.21b).
 */
export function computeDirectShipBreakdown(
  subtotalCents: number,
  shippingFeeCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): DirectShipBreakdownDTO {
  const taxableCents = subtotalCents + shippingFeeCents;
  const ivaCents = Math.round((taxableCents * ivaPct) / 100);
  const baseCents = taxableCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents,
    shippingFeeCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * Gross-up del total para que, tras la comisión Stripe (pct + fija) MÁS el IVA que
 * Stripe MX cobra sobre esa comisión, la plataforma reciba íntegro `baseCents`.
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
export function grossUpTotal(baseCents: number, fee: StripeFeeConfig): number {
  const ivaMul = 1 + fee.stripeFeeIvaPct;
  if (fee.stripeFeeIvaPct < 0 || !Number.isFinite(fee.stripeFeeIvaPct)) {
    throw new Error('stripeFeeIvaPct must be a finite number >= 0');
  }
  const effectivePct = fee.stripePct * ivaMul;
  if (effectivePct < 0 || effectivePct >= 1) {
    throw new Error('effective stripe pct (stripePct × (1 + stripeFeeIvaPct)) must be in [0, 1)');
  }
  const effectiveFixed = fee.stripeFixedCents * ivaMul;
  const total = Math.ceil((baseCents + effectiveFixed) / (1 - effectivePct));
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
