/**
 * pricing-curve.ts — v2.0 (P-48, PROJECT §N LOCKED, ARCHITECTURE §4.36) — LA CURVA ÚNICA.
 *
 * El precio de una carta suelta (raw Y gradeada) depende SOLO de su valor de mercado. Una curva por
 * eje de dinero, sin rareza, sin acabado, sin tiers y sin modos `fixed`/`pct` excluyentes:
 *
 *     venta  = redondeo↑( max( piso , mercado × markup(mercado) ) )
 *     compra =            max( bin  , mercado × pct(mercado)    )
 *
 * REEMPLAZA a `common/pricing-tiers.ts` (§4.36.4). Zona compartida `common/`: SIN dependencias de
 * infra (importable desde seeds, migraciones y tests), igual que `rarity-catalog.ts`.
 *
 * UNIDADES (normativas, TODO ENTERO): dinero en CENTAVOS MXN; los dos valores interpolados en PUNTOS
 * BASE (bp) del mercado, donde `10000 bp = 1× = 100 %`. La misma unidad en ambos ejes es deliberada:
 * el invariante «compra siempre por debajo de venta» se vuelve la comparación DIRECTA
 * `pctBp(m) < multiplierBp(m)`, sin conversiones intermedias que puedan mentir, y «venta nunca por
 * debajo del mercado» es el chequeo trivial `multiplierBp >= 10000` por punto.
 *
 * REDONDEO (§4.36.1, NORMATIVO y explícito): `ROUND_HALF_UP` = **medio ALEJANDOSE DE CERO**, y se
 * redondea siempre el **VALOR FINAL**, nunca un delta intermedio. Los dos detalles son deliberados:
 * redondear el delta obligaria a redondear un numero NEGATIVO cuando el markup baja (todo el tramo de
 * $25 a $80), donde `round(-1590.5)` da `-1590` con el redondeo nativo de JS (medio hacia +inf) pero
 * `-1591` con «medio alejandose de cero»; el valor final, en cambio, es SIEMPRE >= 0 en las dos curvas
 * (`multiplierBp >= 10000`, `pctBp >= 0`), asi que el caso negativo desaparece por construccion. Fijar
 * el modo evita que el backend y el previsualizador del editor (§4.36.8a) difieran en un centavo. El
 * desempate hacia arriba tampoco es casual: es el principio de sesgo de error de PROJECT §N.0 (*precio
 * de mas = venta perdida, recuperable; precio de menos = carta perdida, irrecuperable*).
 *
 * CRITERIO 84 HECHO TIPO: ninguna función de este módulo que devuelva un MONTO recibe `rarity`,
 * `rarityCanonical`, `tier` ni `finish`. La rareza solo entra a `premiumFloorGuard`, que devuelve un
 * VEREDICTO booleano de publicación/cotización — nunca un monto (§4.36.4/§4.36.5d).
 */
import { isPremiumCanonicalRarity } from './rarity-catalog';

/**
 * `ROUND_HALF_UP` de §4.36.1: **medio ALEJANDOSE DE CERO**. Sobre valores `>= 0` (el unico caso que
 * produce esta curva, por construccion) coincide con el redondeo nativo de JS; la rama negativa esta
 * para que el modo quede FIJADO en el codigo y no dependa de que el insumo nunca sea negativo. Es el
 * UNICO redondeo-a-entero del modulo: toda la matematica de la curva pasa por aqui.
 */
export function roundHalfUp(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// ============================================================================
// Tipos del setting (§4.36.2). La tabla de puntos es de LONGITUD VARIABLE: el súper-admin AGREGA,
// MUEVE y BORRA renglones (PROJECT §N.3). Por eso `points` es un array, no un objeto de claves fijas.
// ============================================================================

/** Punto de quiebre de la curva de VENTA. `1.60×` = `16000`. */
export interface SaleCurvePoint {
  marketCents: number;
  multiplierBp: number;
}

/** Punto de quiebre de la curva de COMPRA. `30 %` = `3000`. */
export interface BuyCurvePoint {
  marketCents: number;
  pctBp: number;
}

/** Banda de la escalera de redondeo ↑ de VENTA. `uptoCents: null` = banda abierta (la última). */
export interface RoundingBand {
  uptoCents: number | null;
  stepCents: number;
}

export interface PricingCurve {
  /** Versión de FORMA del setting (no del contenido); permite compat on-read. */
  version: 1;
  sale: {
    /** PISO único y global (≥ 0). NO por acabado, NO por rareza, NO por tier (§N.10). */
    floorCents: number;
    points: SaleCurvePoint[];
    rounding: RoundingBand[];
  };
  buy: {
    /** BIN único y global (≥ 0). */
    binCents: number;
    points: BuyCurvePoint[];
  };
}

/**
 * §4.36.7a — QUÉ determinó el precio. Son EXACTAMENTE los cinco valores LOCKED de PROJECT §N.7
 * (mercado / piso / override / bounty / pendiente).
 *
 * `floor` = «la CONSTANTE INFERIOR de ESE eje ganó el `max`»: el PISO en venta y el BIN en compra. Un
 * solo valor para los dos ejes a propósito (no se inventa un sexto `bin`): es el mismo hecho — «el
 * mercado no explica este precio» — y así el guardarraíl, la instrumentación y la regla de
 * visibilidad comparten UN enum.
 */
export type PriceBasis = 'market' | 'floor' | 'override' | 'bounty' | 'pending';

/** Resultado crudo de la curva (sin precedencias ni controles; esos viven en `money.ts`). */
export interface CurveResolution {
  /** `null` ⇔ `basis === 'pending'`. JAMÁS 0 inventado. */
  cents: number | null;
  basis: PriceBasis;
}

// ============================================================================
// Seed inicial (PROJECT §N.2 VERBATIM). Son DIALES, no constantes de código: el súper-admin los edita
// desde M2 (`PUT /admin/pricing/curve`) sin redeploy. Esta constante es solo el punto de partida del
// seed y el default money-safe de `sanitizePricingCurve`.
// ============================================================================

export const DEFAULT_PRICING_CURVE: PricingCurve = {
  version: 1,
  sale: {
    floorCents: 2500, // MX$25 — piso ÚNICO y global
    points: [
      { marketCents: 2500, multiplierBp: 16000 }, // 1.60× hasta $25 (tramo plano inicial)
      { marketCents: 8000, multiplierBp: 11500 }, // baja lineal a 1.15× en $80; plano de ahí en adelante
    ],
    rounding: [
      { uptoCents: 20000, stepCents: 500 }, // < $200 ⇒ múltiplo de $5
      { uptoCents: 50000, stepCents: 1000 }, // < $500 ⇒ múltiplo de $10
      { uptoCents: null, stepCents: 2500 }, // ≥ $500 ⇒ múltiplo de $25
    ],
  },
  buy: {
    binCents: 100, // MX$1 — bin ÚNICO y global
    points: [
      { marketCents: 2500, pctBp: 3000 }, // 30 % hasta $25 (tramo plano inicial)
      { marketCents: 10000, pctBp: 4000 }, // 40 % en $100
      { marketCents: 50000, pctBp: 5000 }, // 50 % en $500; plano de ahí en adelante
    ],
  },
};

/** Cotas de rango de los valores interpolados (§4.36.3 V3/V4). */
export const MULTIPLIER_BP_MIN = 10_000; // 1.00× — venta nunca por debajo del mercado
export const MULTIPLIER_BP_MAX = 1_000_000; // 100× — techo anti-typo
export const PCT_BP_MAX = 10_000; // 100 % — comprar arriba de mercado no tiene sentido

// ============================================================================
// Interpolación (obligatoria, NUNCA escalones — PROJECT §N.1 / criterio 81)
// ============================================================================

/** Punto genérico ya proyectado a `(mercado, valor en bp)` para interpolar. */
export interface CurvePointBp {
  marketCents: number;
  valueBp: number;
}

/**
 * v2.1.2 (E0-bis) — el valor interpolado, EXACTO, como RACIONAL `num/den`. **Está PROHIBIDO
 * cuantizarlo a bp entero**: ése era el hallazgo I1 de QA y la causa raíz del bug de dinero.
 *
 * ### Por qué un racional y no un bp entero
 * Redondear `k(m)` a bp entero convierte el multiplicador en una función ESCALONADA. En cada escalón
 * a la baja, `m × round(k(m))` **cae** aunque `m` suba, y la escalera de redondeo de venta amplifica
 * esa caída de unos centavos a UN PELDAÑO COMPLETO. Con la curva `1.60×@$25 → 1.15×@$80 → 1.05×@$1000`
 * (diales perfectamente plausibles, que el `PUT` aceptaba con `200` y `violations: []`):
 *
 * | mercado | cuantizando a bp (BUG) | racional exacto (norma) |
 * |---|---|---|
 * | `$717.10` | `k→10808` ⇒ raw 77504 ⇒ **$800.00** | `k=10807.5` ⇒ raw 77501 ⇒ **$800.00** |
 * | `$717.11` | `k→10807` ⇒ raw 77498 ⇒ **$775.00** ⛔ | `k=10807.4891…` ⇒ raw 77502 ⇒ **$800.00** ✅ |
 *
 * **$25 menos por un centavo más de mercado** — justo el sesgo que §N.0 prohíbe (precio de menos =
 * carta perdida, irrecuperable). V5 demostraba una propiedad VERDADERA (`f(m)=m·k(m)` continua es
 * monótona) sobre un objeto que NO era el que cobra. Con la forma racional, el ÚNICO redondeo de toda
 * la cadena es el de centavos finales —que es monótono por definición— y V5 vuelve a ser exacto
 * **sobre la función que cobra**, sin barrer el dominio en cada escritura.
 *
 * `den > 0` y `num > 0` siempre (`k(m)` queda entre `v0` y `v1`, ambos ≥ 0). En los tramos planos el
 * racional es `(valor, 1)`, exacto por construcción.
 *
 * PRECONDICIÓN: `points` no vacío y ordenado estrictamente creciente por `marketCents` (lo garantiza
 * el validador V1/V2 al GUARDAR y `sanitizePricingCurve` al LEER).
 */
export function interpExact(
  points: readonly CurvePointBp[],
  marketCents: number,
): { num: number; den: number; segment: CurveSegment | null } {
  if (points.length === 0) {
    // Defensivo: sin puntos no hay curva. El validador V1 lo impide al guardar y `sanitize` al leer;
    // si aun así llegara aquí, 1.00× es el valor money-safe (nunca por debajo del mercado).
    return { num: MULTIPLIER_BP_MIN, den: 1, segment: null };
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (marketCents <= first.marketCents) return { num: first.valueBp, den: 1, segment: null }; // plano inicial
  if (marketCents >= last.marketCents) return { num: last.valueBp, den: 1, segment: null }; // plano final
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (marketCents >= p0.marketCents && marketCents < p1.marketCents) {
      const den = p1.marketCents - p0.marketCents;
      // num = k(m) · den, ENTERO exacto (sin división, sin redondeo).
      const num = p0.valueBp * den + (p1.valueBp - p0.valueBp) * (marketCents - p0.marketCents);
      return { num, den, segment: { fromIndex: i, toIndex: i + 1 } };
    }
  }
  /* istanbul ignore next — inalcanzable con puntos ordenados; red de seguridad. */
  return { num: last.valueBp, den: 1, segment: null };
}

/** Tramo interpolado. `null` en los tramos PLANOS (antes del primer punto / después del último). */
export interface CurveSegment {
  fromIndex: number;
  toIndex: number;
}

/**
 * v2.1.2 (E0-bis) — **el precio crudo, en UNA sola expresión entera exacta**:
 * `rawCents = ROUND_HALF_UP( m · num / (den · 10000) )`. Es el ÚNICO redondeo de la cadena de venta y
 * de compra.
 *
 * Se calcula en `BigInt` a propósito: `m` llega hasta `MAX_CENTS` (~2.1e9) y `num` hasta ~1e15, así
 * que el producto rebasa `Number.MAX_SAFE_INTEGER` (9e15) y en `number` se perdería precisión — que es
 * exactamente lo que esta corrección viene a eliminar. El operando es SIEMPRE ≥ 0 por construcción
 * (§4.36.1), así que «medio alejándose de cero» se reduce a `floor((2n + d) / 2d)`.
 *
 * El resultado se acota a `MAX_CENTS` ANTES de volver a `number`: por encima de eso ya no hay precio
 * representable (BE-27) y el clamp de `money.ts` haría lo mismo; hacerlo aquí evita que un `BigInt`
 * astronómico pase por una conversión con pérdida.
 */
export function rawCentsFromRational(marketCents: number, num: number, den: number): number {
  const n = BigInt(marketCents) * BigInt(num);
  const d = BigInt(den) * 10_000n;
  const q = (2n * n + d) / (2n * d); // ROUND_HALF_UP con operandos >= 0
  const cap = BigInt(MAX_CENTS_CURVE);
  return Number(q > cap ? cap : q);
}

/**
 * Tope de representación de un monto en centavos (espejo de `MAX_CENTS` de `money.ts`, duplicado aquí
 * porque `common/pricing-curve.ts` no depende de nada: es `Int32` de Postgres).
 */
const MAX_CENTS_CURVE = 2_147_483_647;

/**
 * Valor interpolado como número, **SOLO PARA DISPLAY** (memoria de cálculo del previsualizador y del
 * editor, §4.36.8a). ⛔ **JAMÁS como operando de un precio**: para eso está `interpExact` +
 * `rawCentsFromRational`. El contrato lo marca `appliedBp` como solo-display por esta misma razón.
 */
export function interp(points: readonly CurvePointBp[], marketCents: number): number {
  const { num, den } = interpExact(points, marketCents);
  return roundHalfUp(num / den);
}

/** Proyecta los puntos de VENTA a `(marketCents, valueBp)`. */
export function saleBpPoints(points: readonly SaleCurvePoint[]): CurvePointBp[] {
  return points.map((p) => ({ marketCents: p.marketCents, valueBp: p.multiplierBp }));
}

/** Proyecta los puntos de COMPRA a `(marketCents, valueBp)`. */
export function buyBpPoints(points: readonly BuyCurvePoint[]): CurvePointBp[] {
  return points.map((p) => ({ marketCents: p.marketCents, valueBp: p.pctBp }));
}

/** `markup(mercado)` en bp. */
export function saleMultiplierBpAt(curve: PricingCurve, marketCents: number): number {
  return interp(saleBpPoints(curve.sale.points), marketCents);
}

/** `pct(mercado)` de compra en bp. */
export function buyPctBpAt(curve: PricingCurve, marketCents: number): number {
  return interp(buyBpPoints(curve.buy.points), marketCents);
}

// ============================================================================
// Escalera de redondeo ↑ (SOLO VENTA — §N.2 decisión 5; la compra NO se redondea)
// ============================================================================

/**
 * La BANDA la decide el monto ANTES de redondear y se elige UNA SOLA VEZ: si el redondeo cruza el
 * umbral, **no se re-evalúa**. Fronteras SEMIABIERTAS en centavos: `< 20000 ⇒ 500` ·
 * `[20000, 50000) ⇒ 1000` · `≥ 50000 ⇒ 2500` (con el seed de §N.2).
 *
 * PRECONDICIÓN: escalera bien formada (V8). Defensivo si no lo estuviera: se usa la ÚLTIMA banda
 * (paso mayor ⇒ precio mayor ⇒ sesgo N.0), y una escalera vacía no redondea.
 */
export function roundUp(cents: number, ladder: readonly RoundingBand[]): number {
  return roundUpWithStep(cents, ladder).cents;
}

/** Igual que `roundUp` pero devolviendo el PASO usado (memoria de cálculo del dry-run, §4.36.8a). */
export function roundUpWithStep(
  cents: number,
  ladder: readonly RoundingBand[],
): { cents: number; stepCents: number | null } {
  if (ladder.length === 0) return { cents, stepCents: null };
  const band = ladder.find((b) => b.uptoCents == null || cents < b.uptoCents) ?? ladder[ladder.length - 1];
  const step = Number.isInteger(band.stepCents) && band.stepCents >= 1 ? band.stepCents : 1;
  return { cents: Math.ceil(cents / step) * step, stepCents: step };
}

// ============================================================================
// La matemática (§4.36.1). Money-safe: mercado ausente o ≤ 0 ⇒ `pending` (JAMÁS MX$0 ni inventado).
// ============================================================================

/**
 * VENTA: `redondeo↑( max( piso , mercado × markup(mercado) ) )`.
 * EMPATE ⇒ `market` (§N.7, desempate fijado): `basis='floor'` **solo** si el piso es ESTRICTAMENTE
 * mayor que el valor derivado del mercado.
 */
export function resolveSaleFromCurve(marketMxnCents: number | null, curve: PricingCurve): CurveResolution {
  const t = explainSaleFromCurve(marketMxnCents, curve);
  return { cents: t.priceCents, basis: t.basis };
}

/**
 * COMPRA: `max( bin , mercado × pct(mercado) )`. **SIN redondeo** (§N.1).
 * EMPATE ⇒ `market`, igual que en venta.
 */
export function resolveBuyFromCurve(marketMxnCents: number | null, curve: PricingCurve): CurveResolution {
  const t = explainBuyFromCurve(marketMxnCents, curve);
  return { cents: t.priceCents, basis: t.basis };
}

// ----------------------------------------------------------------------------
// Memoria de cálculo (§4.36.8a) — el CUERPO REAL de las dos resoluciones. `resolveSale/BuyFromCurve`
// son envoltorios que se quedan con `{ cents, basis }`. Que el dry-run del editor y el precio que se
// cobra salgan de la MISMA función es todo el punto del endpoint de preview: si el dueño calibrara
// contra un cálculo distinto del que cobra, sería el bug de P-48 en espejo.
// ----------------------------------------------------------------------------

/** Traza completa de UN eje para UN mercado. Espeja `CurvePreviewLegDTO` del contrato. */
export interface CurveLegTrace {
  priceCents: number | null;
  /** Solo `market | floor | pending`: el dry-run opera sobre mercados HIPOTÉTICOS, no sobre variantes. */
  basis: PriceBasis;
  /**
   * El valor interpolado aplicado, en bp del mercado, **redondeado SOLO PARA DISPLAY** (v2.1.2). `null`
   * si no hubo cálculo (pending).
   *
   * ⛔ **NO es el operando del precio.** El precio sale del racional exacto (`interpExact` +
   * `rawCentsFromRational`); este campo existe para la memoria de cálculo del previsualizador, y por
   * eso el contrato lo marca solo-display. Usarlo para recomputar el monto reintroduce el bug I1:
   * `rawCents` puede NO ser `ROUND_HALF_UP(mercado × appliedBp / 10000)` cuando `k(m)` no es entero.
   */
  appliedBp: number | null;
  /** El producto EXACTO `mercado · k(m)`, redondeado a centavos: ANTES de la constante y del redondeo. */
  rawCents: number | null;
  /** El piso (venta) o el bin (compra). */
  constantCents: number;
  /** La constante ganó el `max` ⇒ `basis === 'floor'`. */
  constantWon: boolean;
  /** `max(constantCents, rawCents)` — el monto que elige la banda y se redondea. `null` en compra/pending. */
  baseCents: number | null;
  /** Paso de la escalera usado (solo venta). `null` en compra y en pending. */
  roundingStepCents: number | null;
  segment: CurveSegment | null;
}

export function explainSaleFromCurve(marketMxnCents: number | null, curve: PricingCurve): CurveLegTrace {
  const constantCents = curve.sale.floorCents;
  if (marketMxnCents == null || marketMxnCents <= 0) {
    return {
      priceCents: null,
      basis: 'pending',
      appliedBp: null,
      rawCents: null,
      constantCents,
      constantWon: false,
      baseCents: null,
      roundingStepCents: null,
      segment: null,
    };
  }
  // v2.1.2 (E0-bis): racional EXACTO + una sola expresión entera. `appliedBp` es SOLO-DISPLAY.
  const { num, den, segment } = interpExact(saleBpPoints(curve.sale.points), marketMxnCents);
  const rawCents = rawCentsFromRational(marketMxnCents, num, den);
  const baseCents = Math.max(constantCents, rawCents);
  // EMPATE ⇒ 'market' (§N.7): `floor` solo si la constante es ESTRICTAMENTE mayor.
  const constantWon = constantCents > rawCents;
  // La escalera se aplica IGUAL cuando gana el piso (por eso `baseCents` viaja: con piso $25.30 y
  // paso $5 el precio publicado es $30, y sin este dato eso parecería un descuadre en pantalla).
  const rounded = roundUpWithStep(baseCents, curve.sale.rounding);
  return {
    priceCents: rounded.cents,
    basis: constantWon ? 'floor' : 'market',
    appliedBp: roundHalfUp(num / den),
    rawCents,
    constantCents,
    constantWon,
    baseCents,
    roundingStepCents: rounded.stepCents,
    segment,
  };
}

export function explainBuyFromCurve(marketMxnCents: number | null, curve: PricingCurve): CurveLegTrace {
  const constantCents = curve.buy.binCents;
  if (marketMxnCents == null || marketMxnCents <= 0) {
    return {
      priceCents: null,
      basis: 'pending',
      appliedBp: null,
      rawCents: null,
      constantCents,
      constantWon: false,
      baseCents: null,
      roundingStepCents: null,
      segment: null,
    };
  }
  // v2.1.2 (E0-bis): racional EXACTO + una sola expresión entera. `appliedBp` es SOLO-DISPLAY.
  const { num, den, segment } = interpExact(buyBpPoints(curve.buy.points), marketMxnCents);
  const rawCents = rawCentsFromRational(marketMxnCents, num, den);
  const constantWon = constantCents > rawCents;
  return {
    priceCents: Math.max(constantCents, rawCents),
    basis: constantWon ? 'floor' : 'market',
    appliedBp: roundHalfUp(num / den),
    rawCents,
    constantCents,
    constantWon,
    // La COMPRA no se redondea (§N.1): no hay banda ni base que elegir.
    baseCents: null,
    roundingStepCents: null,
    segment,
  };
}

// ============================================================================
// Guardarraíl (§4.36.5) — la rareza sale del PRICING y entra a la VALIDACIÓN.
// PROHIBIDO duplicar este predicado: es el ÚNICO cuerpo, consumido por los DOS seams de servicio.
// ============================================================================

export type GuardVerdict = 'ok' | 'premium_at_floor';

/**
 * Una carta de rareza canónica `premium` que aterriza en el PISO (venta) o en el BIN (compra) NO se
 * publica ni se cotiza: su dato de mercado está mal (ausente, aplanado o absurdo). Convierte un error
 * de dinero silencioso en una COLA VISIBLE (≈3 de 333 cartas de un master set).
 *
 * NO dispara con `basis ∈ {market, override, bounty}`: un override manual o un bounty son decisiones
 * DELIBERADAS del admin y no se corrigen (§4.36.6). Con `pending` no hace falta (ya no se publica).
 *
 * NO fija ningún monto — solo decide publicar/no publicar y cotizar/no cotizar (§4.36.5d).
 */
export function premiumFloorGuard(rarityCanonical: string | null, basis: PriceBasis): GuardVerdict {
  return basis === 'floor' && isPremiumCanonicalRarity(rarityCanonical) ? 'premium_at_floor' : 'ok';
}

/**
 * §4.36.5c — POR QUÉ una variante entra a la cola de precio pendiente. Espeja el enum de BD
 * `PendingPriceReason` (aquí como unión de literales para que `common/` siga sin depender de infra).
 */
export type PendingReason = 'no_market' | 'premium_at_floor';

/**
 * **VEREDICTO ÚNICO de publicación/cotización** (§4.36.5). Devuelve la razón por la que la variante
 * NO se puede publicar/cotizar, o `null` si sí se puede. Es el ÚNICO punto donde la rareza toca el
 * dinero — y lo hace **bloqueando**, nunca **fijando** un monto: esta función no recibe ni devuelve
 * cantidades (criterio 84).
 *
 * - `basis === 'pending'` ⇒ `no_market`: sin dato de mercado NO se publica ni se cotiza; el piso/bin
 *   **NO** gana (decisión LOCKED §4.36.0 que corrige el supuesto de §N.2). Un guardarraíl por rareza
 *   atraparía una Secret Rare con dato corrupto, pero **no** una Common de $400 sin dato.
 * - guardarraíl ⇒ `premium_at_floor`: una chase que resuelve al piso/bin solo puede significar que su
 *   dato de mercado está mal. Lo cura el dueño o el siguiente barrido.
 * - `override` / `bounty` ⇒ `null` SIEMPRE: son decisiones deliberadas del admin y no se corrigen.
 *
 * Distinguir las dos razones es lo que hace TRIABLE la cola: `no_market` la cura sola el barrido;
 * `premium_at_floor` necesita que el dueño mire.
 */
export function resolvePendingReason(basis: PriceBasis, rarityCanonical: string | null): PendingReason | null {
  if (basis === 'pending') return 'no_market';
  return premiumFloorGuard(rarityCanonical, basis) === 'premium_at_floor' ? 'premium_at_floor' : null;
}

// ============================================================================
// Bounty revalidado contra la curva (§4.36.6 / criterios 90-91).
// PROHIBIDO duplicar: mismo cuerpo en las TRES seams (crear, cotizar, publicar).
// ============================================================================

/**
 * Un bounty por debajo —o IGUAL— de la tarifa vigente de la curva DEJA DE SER BOUNTY: no aplica en la
 * cotización, no se publica en la vitrina y genera alerta en el binder.
 *
 * `> ESTRICTAMENTE mayor` por criterio 91 («todo lo de la vitrina es mejor que la tarifa estándar»).
 * Curva sin resolver (`null`) ⇒ el bounty explícito manda: es justo el caso donde más se necesita.
 */
export function isBountyEffective(bountyPriceCents: number | null, curveQuoteCents: number | null): boolean {
  if (bountyPriceCents == null || bountyPriceCents <= 0) return false;
  if (curveQuoteCents == null) return true;
  return bountyPriceCents > curveQuoteCents;
}

// ============================================================================
// Instrumentación (§4.36.7c / §N.8) — bracket de mercado de ESCALA FIJA.
// ============================================================================

/**
 * CONSTANTE DE CÓDIGO, **NO** un dial. Es independiente de la curva A PROPÓSITO: si el bracket se
 * derivara de los puntos vigentes, la serie histórica dejaría de ser comparable cada vez que el dueño
 * moviera la curva — justo lo que la instrumentación existe para medir. **Cambiarla parte la serie.**
 */
export type MarketBracket = 'lt_3' | 'r3_10' | 'r10_25' | 'r25_80' | 'r80_300' | 'gte_300';

/** Fronteras SEMIABIERTAS `[lo, hi)` en centavos MXN. */
const BRACKET_BOUNDS: { upto: number | null; bracket: MarketBracket }[] = [
  { upto: 300, bracket: 'lt_3' },
  { upto: 1000, bracket: 'r3_10' },
  { upto: 2500, bracket: 'r10_25' },
  { upto: 8000, bracket: 'r25_80' },
  { upto: 30000, bracket: 'r80_300' },
  { upto: null, bracket: 'gte_300' },
];

/** `null` ⇔ la operación no tuvo mercado (override/bounty sin referencia, o pendiente). */
export function marketBracketOf(marketMxnCents: number | null): MarketBracket | null {
  if (marketMxnCents == null || marketMxnCents <= 0) return null;
  for (const b of BRACKET_BOUNDS) {
    if (b.upto == null || marketMxnCents < b.upto) return b.bracket;
  }
  /* istanbul ignore next — la última banda es abierta. */
  return 'gte_300';
}

// ============================================================================
// Invariantes VALIDABLES del setting (§4.36.3, V1–V8). Se imponen al GUARDAR (422), no solo en
// runtime, sobre el OBJETO COMPLETO. Todos son chequeos EXACTOS y FINITOS — no muestreos.
// ============================================================================

export type CurveErrorCode =
  | 'VALIDATION_ERROR'
  | 'CURVE_EMPTY'
  | 'DUPLICATE_BREAKPOINT'
  | 'SALE_BELOW_MARKET'
  | 'SALE_CURVE_NOT_MONOTONIC'
  | 'BUY_ABOVE_SALE'
  | 'BIN_ABOVE_FLOOR'
  | 'ROUNDING_LADDER_INVALID';

/** El error SIEMPRE dice QUÉ PUNTO lo rompe (PROJECT §N.3 / criterio 87). */
export interface CurveValidationError {
  code: CurveErrorCode;
  message: string;
  /**
   * §4.36.8a(c) — el dry-run se parte por COMPUTABILIDAD, no por severidad:
   *  - `true`  ⇒ **impide calcular** (V1/V2/V3 y la escalera ESTRUCTURAL): sin puntos no hay qué
   *    interpolar, con dos puntos en el mismo mercado la interpolación es ambigua y sin banda no se
   *    puede elegir paso. El preview responde `422`: un `200` aquí sería inventar un precio.
   *  - `false` ⇒ **calculable pero prohibido** (V4/V5/V6/V7 y la condición fina de V8): el preview
   *    responde `200` con los precios y la infracción en `violations[]`, para que el previsualizador
   *    enseñe el problema EN PESOS en vez de que el dueño corrija a ciegas.
   * Para el `PUT` la distinción es irrelevante: **cualquier** infracción rechaza el guardado.
   */
  blocking: boolean;
  details: {
    axis?: 'sale' | 'buy';
    /** Índice del punto en el array TAL COMO VINO en el request (no el ordenado). */
    index?: number;
    /** Segundo extremo del tramo infractor (V5), también en índices del request. */
    index2?: number;
    marketCents?: number;
    [k: string]: unknown;
  };
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}

function err(
  code: CurveErrorCode,
  message: string,
  details: CurveValidationError['details'] = {},
  blocking = true,
): CurveValidationError {
  return { code, message, details, blocking };
}

/** Punto ordenado que recuerda su índice ORIGINAL (para que el error señale el renglón del editor). */
interface IndexedPoint {
  marketCents: number;
  valueBp: number;
  index: number;
}

function indexed<T extends { marketCents: number }>(points: readonly T[], value: (p: T) => number): IndexedPoint[] {
  return points
    .map((p, index) => ({ marketCents: p.marketCents, valueBp: value(p), index }))
    .sort((a, b) => a.marketCents - b.marketCents || a.index - b.index);
}

/**
 * Valida el objeto COMPLETO (no un delta). Devuelve el PRIMER error o `null` si todo pasa.
 *
 * Orden de evaluación (determinista, de lo estructural a lo algebraico): forma → V1 → V3 (tipos y
 * rangos) → V4 → V2 → V8 → V7 → V5 → V6.
 *
 * NOTA de precedencia entre V3 y V4 (el contrato lista `multiplierBp ∈ [10000, 1000000]` bajo
 * `VALIDATION_ERROR` y `multiplierBp ≥ 10000` bajo `SALE_BELOW_MARKET`): un `multiplierBp < 10000`
 * emite **`SALE_BELOW_MARKET`** (el código específico y money-safe, criterio 87.c); un
 * `multiplierBp > 1000000` emite `VALIDATION_ERROR` (typo de rango, sin lectura de negocio).
 */
export function validatePricingCurve(value: unknown): CurveValidationError | null {
  return collectCurveViolations(value)[0] ?? null;
}

/**
 * Devuelve **TODAS** las infracciones del objeto (no solo la primera), separadas en dos fases:
 *  - **Fase 1 — BLOQUEANTES** (forma, V1, V3, V2, escalera estructural): si hay una, se devuelve SOLA
 *    y no se sigue. Las fases posteriores asumen una curva evaluable; correrlas sobre puntos
 *    duplicados o no numéricos produciría errores derivados que confundirían al editor.
 *  - **Fase 2 — NO BLOQUEANTES** (V4, V8 fino, V7, V5, V6): se acumulan todas, porque el
 *    previsualizador las pinta juntas mientras el dueño corrige (§4.36.8a(c)).
 *
 * El `PUT` usa `validatePricingCurve` (la primera) — cualquier infracción rechaza el guardado; el
 * dry-run usa esta lista completa. **Un solo validador para las dos superficies**, que es lo que
 * impide que el editor reimplemente V1–V8 para adelantarse al 422.
 */export function collectCurveViolations(value: unknown): CurveValidationError[] {
  // ======================= FASE 1 — BLOQUEANTES (impiden calcular) =======================
  // ---- Forma ----------------------------------------------------------------
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return [err('VALIDATION_ERROR', 'pricing curve must be an object { version, sale, buy }')];
  }
  const c = value as Partial<PricingCurve>;
  if (c.version !== 1) {
    return [err('VALIDATION_ERROR', 'unsupported curve version: must be 1', { version: c.version })];
  }
  const sale = c.sale;
  const buy = c.buy;
  if (sale == null || typeof sale !== 'object' || Array.isArray(sale)) {
    return [err('VALIDATION_ERROR', 'sale must be an object { floorCents, points, rounding }', { axis: 'sale' })];
  }
  if (buy == null || typeof buy !== 'object' || Array.isArray(buy)) {
    return [err('VALIDATION_ERROR', 'buy must be an object { binCents, points }', { axis: 'buy' })];
  }
  if (!Array.isArray(sale.points)) {
    return [err('VALIDATION_ERROR', 'sale.points must be an array', { axis: 'sale' })];
  }
  if (!Array.isArray(buy.points)) {
    return [err('VALIDATION_ERROR', 'buy.points must be an array', { axis: 'buy' })];
  }
  if (!Array.isArray(sale.rounding)) {
    return [err('VALIDATION_ERROR', 'sale.rounding must be an array', { axis: 'sale' })];
  }

  // ---- V1: curva no vacía (sin puntos no hay qué interpolar) ----------------
  if (sale.points.length === 0) {
    return [err('CURVE_EMPTY', 'sale.points must have at least 1 breakpoint', { axis: 'sale' })];
  }
  if (buy.points.length === 0) {
    return [err('CURVE_EMPTY', 'buy.points must have at least 1 breakpoint', { axis: 'buy' })];
  }

  // ---- V3: tipos y rangos ---------------------------------------------------
  if (!isInt(sale.floorCents) || sale.floorCents < 0) {
    return [err('VALIDATION_ERROR', 'sale.floorCents must be an integer >= 0 (cents)', { axis: 'sale' })];
  }
  if (!isInt(buy.binCents) || buy.binCents < 0) {
    return [err('VALIDATION_ERROR', 'buy.binCents must be an integer >= 0 (cents)', { axis: 'buy' })];
  }
  for (let i = 0; i < sale.points.length; i++) {
    const p = sale.points[i] as SaleCurvePoint | undefined;
    if (p == null || typeof p !== 'object') {
      return [err('VALIDATION_ERROR', 'sale point must be an object { marketCents, multiplierBp }', { axis: 'sale', index: i })];
    }
    if (!isInt(p.marketCents) || p.marketCents < 0) {
      return [
        err('VALIDATION_ERROR', 'marketCents must be an integer >= 0 (cents)', {
          axis: 'sale',
          index: i,
          marketCents: p.marketCents,
        }),
      ];
    }
    if (!isInt(p.multiplierBp)) {
      return [
        err('VALIDATION_ERROR', 'multiplierBp must be an integer (bp of market; 10000 = 1x)', {
          axis: 'sale',
          index: i,
          marketCents: p.marketCents,
          multiplierBp: p.multiplierBp,
        }),
      ];
    }
    if (p.multiplierBp > MULTIPLIER_BP_MAX) {
      return [
        err('VALIDATION_ERROR', `multiplierBp must be <= ${MULTIPLIER_BP_MAX} (bp)`, {
          axis: 'sale',
          index: i,
          marketCents: p.marketCents,
          multiplierBp: p.multiplierBp,
        }),
      ];
    }
  }
  for (let i = 0; i < buy.points.length; i++) {
    const p = buy.points[i] as BuyCurvePoint | undefined;
    if (p == null || typeof p !== 'object') {
      return [err('VALIDATION_ERROR', 'buy point must be an object { marketCents, pctBp }', { axis: 'buy', index: i })];
    }
    if (!isInt(p.marketCents) || p.marketCents < 0) {
      return [
        err('VALIDATION_ERROR', 'marketCents must be an integer >= 0 (cents)', {
          axis: 'buy',
          index: i,
          marketCents: p.marketCents,
        }),
      ];
    }
    if (!isInt(p.pctBp) || p.pctBp < 0 || p.pctBp > PCT_BP_MAX) {
      return [
        err('VALIDATION_ERROR', `pctBp must be an integer in [0, ${PCT_BP_MAX}] (bp of market)`, {
          axis: 'buy',
          index: i,
          marketCents: p.marketCents,
          pctBp: p.pctBp,
        }),
      ];
    }
  }

  // ---- V2: puntos ordenables y únicos (un duplicado hace AMBIGUA la interpolación) ----
  const salePts = indexed(sale.points, (p) => p.multiplierBp);
  const buyPts = indexed(buy.points, (p) => p.pctBp);
  for (let i = 1; i < salePts.length; i++) {
    if (salePts[i].marketCents === salePts[i - 1].marketCents) {
      return [
        err('DUPLICATE_BREAKPOINT', 'two sale breakpoints share the same marketCents', {
          axis: 'sale',
          index: salePts[i].index,
          index2: salePts[i - 1].index,
          marketCents: salePts[i].marketCents,
        }),
      ];
    }
  }
  for (let i = 1; i < buyPts.length; i++) {
    if (buyPts[i].marketCents === buyPts[i - 1].marketCents) {
      return [
        err('DUPLICATE_BREAKPOINT', 'two buy breakpoints share the same marketCents', {
          axis: 'buy',
          index: buyPts[i].index,
          index2: buyPts[i - 1].index,
          marketCents: buyPts[i].marketCents,
        }),
      ];
    }
  }

  // ---- V8 ESTRUCTURAL: sin banda bien formada no se puede elegir paso --------
  const ladder = validateRoundingLadder(sale.rounding);
  const ladderBlocking = ladder.filter((e) => e.blocking);
  if (ladderBlocking.length > 0) return [ladderBlocking[0]];

  // ======================= FASE 2 — NO BLOQUEANTES (calculables, prohibidas) =======================
  const out: CurveValidationError[] = [];

  // ---- V4: ningún precio de venta por debajo del mercado --------------------
  for (let i = 0; i < sale.points.length; i++) {
    const p = sale.points[i];
    if (p.multiplierBp < MULTIPLIER_BP_MIN) {
      out.push(
        err(
          'SALE_BELOW_MARKET',
          `multiplierBp must be >= ${MULTIPLIER_BP_MIN} (1.00x): sale price can never fall below market`,
          { axis: 'sale', index: i, marketCents: p.marketCents, multiplierBp: p.multiplierBp },
          false,
        ),
      );
    }
  }

  // ---- V8 FINO: frontera múltiplo del paso (si no, el redondeo rompe V5) ----
  out.push(...ladder.filter((e) => !e.blocking));

  // ---- V7: el bin no rebasa al piso ----------------------------------------
  if (buy.binCents >= sale.floorCents) {
    out.push(
      err(
        'BIN_ABOVE_FLOOR',
        'buy.binCents must be strictly below sale.floorCents',
        { axis: 'buy', binCents: buy.binCents, floorCents: sale.floorCents },
        false,
      ),
    );
  }

  // ---- V5: curva de venta monótona creciente -------------------------------
  // f(m) = m·k(m) es cuadrática por tramo ⇒ f' es LINEAL ⇒ f' >= 0 en TODO el tramo si y solo si lo es
  // en sus dos extremos: f'(m0) = k0 + m0·s y f'(m1) = k1 + m1·s, con s = (k1−k0)/(m1−m0).
  // Se evalúa con aritmética ENTERA (multiplicando por el span > 0) para no depender de floats.
  for (let i = 0; i < salePts.length - 1; i++) {
    const p0 = salePts[i];
    const p1 = salePts[i + 1];
    const span = p1.marketCents - p0.marketCents; // > 0 por V2
    const dk = p1.valueBp - p0.valueBp;
    const dLeft = p0.valueBp * span + p0.marketCents * dk; // = span · f'(m0)
    const dRight = p1.valueBp * span + p1.marketCents * dk; // = span · f'(m1)
    if (dLeft < 0 || dRight < 0) {
      out.push(
        err(
          'SALE_CURVE_NOT_MONOTONIC',
          'sale curve is not monotonically increasing: more market would produce LESS price on this segment',
          {
            axis: 'sale',
            index: p0.index,
            index2: p1.index,
            marketCents: p0.marketCents,
            marketCentsTo: p1.marketCents,
          },
          false,
        ),
      );
    }
  }
  // Los tramos planos (antes del primero, después del último) son crecientes porque k > 0 (V4 ⇒ k ≥ 10000).

  // ---- V6: compra ESTRICTAMENTE por debajo de venta, en TODO el dominio -----
  // Ambas curvas son lineales por tramo sobre la UNIÓN de sus `marketCents` ⇒ la diferencia
  // `multiplierBp(m) − pctBp(m)` es lineal por tramo ⇒ su mínimo cae en un NODO (las colas planas son
  // constantes iguales al valor del nodo extremo). Es exacto, no un muestreo.
  //
  // v2.1.2 — se exige **≥ 1 unidad entera** de separación, no solo `pct < mult`. Sobre los valores
  // CONTINUOS, dos valores distintos dentro del mismo centavo redondean al MISMO entero: ahí
  // `compra == venta`, margen cero, que §N.3 prohíbe. Con `k(m) − p(m) ≥ 1` la desigualdad SOBREVIVE
  // al redondeo. Coste práctico nulo: la separación real del seed es de miles de bp.
  //
  // La comparación se hace sobre los RACIONALES exactos (`interpExact`), no sobre `interp` — que
  // redondea y es SOLO-DISPLAY desde v2.1.2. En un nodo de una curva la OTRA puede valer un racional
  // no entero, y comparar su versión redondeada volvería a demostrar algo sobre el objeto equivocado.
  const saleCurveBp = salePts.map((p) => ({ marketCents: p.marketCents, valueBp: p.valueBp }));
  const buyCurveBp = buyPts.map((p) => ({ marketCents: p.marketCents, valueBp: p.valueBp }));
  const nodes = Array.from(new Set([...saleCurveBp, ...buyCurveBp].map((p) => p.marketCents))).sort((a, b) => a - b);
  for (const m of nodes) {
    const sale = interpExact(saleCurveBp, m);
    const buy = interpExact(buyCurveBp, m);
    // ns/ds − nb/db ≥ 1  ⟺  ns·db − nb·ds ≥ ds·db   (ds, db > 0). Enteros exactos, sin división.
    const lhs = BigInt(sale.num) * BigInt(buy.den) - BigInt(buy.num) * BigInt(sale.den);
    const rhs = BigInt(sale.den) * BigInt(buy.den);
    if (lhs < rhs) {
      const offending = buyPts.find((p) => p.marketCents === m) ?? salePts.find((p) => p.marketCents === m);
      out.push(
        err(
          'BUY_ABOVE_SALE',
          'buy curve must stay at least 1 bp below the sale curve at every market value',
          {
            axis: 'buy',
            index: offending?.index,
            marketCents: m,
            // Valores REDONDEADOS solo para el mensaje del editor; la decisión ya se tomó en exacto.
            pctBp: roundHalfUp(buy.num / buy.den),
            multiplierBp: roundHalfUp(sale.num / sale.den),
          },
          false,
        ),
      );
      break; // una sola señal por curva: el editor resalta el punto, no inunda la lista
    }
  }

  return out;
}

/**
 * V8 — escalera bien formada. Devuelve TODAS sus infracciones, separando las **estructurales**
 * (bloqueantes: sin banda no se puede elegir paso) de la **fina** (no bloqueante).
 *
 * La condición sutil es la última: **cada frontera debe ser múltiplo exacto del paso de la banda
 * inmediatamente inferior**. Sin ella el redondeo ROMPE la monotonía que V5 acaba de garantizar: con
 * bandas `<$200⇒$5` y una frontera en $203, un `baseCents` de $202.99 redondea a $205 mientras que
 * $203.00 cae a la banda siguiente y podría redondear a MENOS.
 */
export function validateRoundingLadder(ladder: readonly RoundingBand[]): CurveValidationError[] {
  if (!Array.isArray(ladder) || ladder.length === 0) {
    return [err('ROUNDING_LADDER_INVALID', 'sale.rounding must have at least 1 band', { axis: 'sale' })];
  }
  const out: CurveValidationError[] = [];
  for (let i = 0; i < ladder.length; i++) {
    const b = ladder[i];
    if (b == null || typeof b !== 'object') {
      return [
        err('ROUNDING_LADDER_INVALID', 'rounding band must be an object { uptoCents, stepCents }', {
          axis: 'sale',
          index: i,
        }),
      ];
    }
    if (!isInt(b.stepCents) || b.stepCents < 1) {
      return [
        err('ROUNDING_LADDER_INVALID', 'stepCents must be an integer >= 1', {
          axis: 'sale',
          index: i,
          stepCents: b.stepCents,
        }),
      ];
    }
    const isLast = i === ladder.length - 1;
    if (isLast) {
      if (b.uptoCents !== null) {
        return [
          err('ROUNDING_LADDER_INVALID', 'the LAST rounding band must be open (uptoCents = null)', {
            axis: 'sale',
            index: i,
            uptoCents: b.uptoCents,
          }),
        ];
      }
    } else {
      if (b.uptoCents === null || !isInt(b.uptoCents) || b.uptoCents <= 0) {
        return [
          err('ROUNDING_LADDER_INVALID', 'only the LAST rounding band may be open; uptoCents must be an integer > 0', {
            axis: 'sale',
            index: i,
            uptoCents: b.uptoCents,
          }),
        ];
      }
      const prev = i > 0 ? ladder[i - 1].uptoCents : null;
      if (prev != null && b.uptoCents <= prev) {
        return [
          err('ROUNDING_LADDER_INVALID', 'uptoCents must be strictly increasing', {
            axis: 'sale',
            index: i,
            uptoCents: b.uptoCents,
          }),
        ];
      }
      // CONDICIÓN FINA (no bloqueante): la frontera debe ser múltiplo EXACTO del paso de su banda.
      if (b.uptoCents % b.stepCents !== 0) {
        out.push(
          err(
            'ROUNDING_LADDER_INVALID',
            'each band boundary must be an exact multiple of the step of the band below it (otherwise rounding breaks monotonicity)',
            { axis: 'sale', index: i, uptoCents: b.uptoCents, stepCents: b.stepCents },
            false,
          ),
        );
      }
    }
  }
  return out;
}

// ============================================================================

/** Ordena los puntos por `marketCents` (el `PUT` acepta la tabla desordenada, §M2). */
export function normalizePricingCurve(curve: PricingCurve): PricingCurve {
  return {
    version: 1,
    sale: {
      floorCents: curve.sale.floorCents,
      points: [...curve.sale.points].sort((a, b) => a.marketCents - b.marketCents),
      rounding: [...curve.sale.rounding],
    },
    buy: {
      binCents: curve.buy.binCents,
      points: [...curve.buy.points].sort((a, b) => a.marketCents - b.marketCents),
    },
  };
}

/**
 * Lectura money-safe del setting: si el valor persistido es válido se usa NORMALIZADO; si no
 * (edición manual en BD, corrupción), se cae al SEED de §N.2. «Siempre hay curva» es invariante del
 * diseño (§4.36.2: «no hay “sin regla”: siempre hay curva»), y un `throw` aquí apagaría a la vez la
 * publicación y la cotización de todo el catálogo. El caller loguea el fallback (aquí no hay infra).
 */
export function sanitizePricingCurve(raw: unknown): { curve: PricingCurve; fellBack: boolean } {
  const problem = validatePricingCurve(raw);
  if (problem != null) return { curve: normalizePricingCurve(DEFAULT_PRICING_CURVE), fellBack: true };
  return { curve: normalizePricingCurve(raw as PricingCurve), fellBack: false };
}
