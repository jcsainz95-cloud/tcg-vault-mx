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
 * REDONDEO: se usa `Math.round` (ROUND_HALF_UP hacia +∞). El desempate hacia arriba NO es casual —
 * es el principio de sesgo de error de PROJECT §N.0 (*precio de más = venta perdida, recuperable;
 * precio de menos = carta perdida, irrecuperable*): ante empate gana el monto más alto, en los dos ejes.
 *
 * CRITERIO 84 HECHO TIPO: ninguna función de este módulo que devuelva un MONTO recibe `rarity`,
 * `rarityCanonical`, `tier` ni `finish`. La rareza solo entra a `premiumFloorGuard`, que devuelve un
 * VEREDICTO booleano de publicación/cotización — nunca un monto (§4.36.4/§4.36.5d).
 */
import { isPremiumCanonicalRarity } from './rarity-catalog';

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
 * Interpolación LINEAL entre puntos consecutivos; tramos PLANOS **solo** antes del primero y después
 * del último (se extiende el valor del extremo). Un tramo escalonado DENTRO del rango está prohibido
 * por diseño: produce saltos de precio entre dos mercados casi iguales y, arriba de ~$25 de mercado,
 * es imposible sin vender por debajo del mercado.
 *
 * PRECONDICIÓN: `points` no vacío y ordenado estrictamente creciente por `marketCents` (lo garantiza
 * el validador V1/V2 al GUARDAR y `sanitizePricingCurve` al LEER).
 */
export function interp(points: readonly CurvePointBp[], marketCents: number): number {
  if (points.length === 0) {
    // Defensivo: sin puntos no hay curva. El validador V1 lo impide al guardar y `sanitize` al leer;
    // si aun así llegara aquí, 1.00× es el valor money-safe (nunca por debajo del mercado).
    return MULTIPLIER_BP_MIN;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (marketCents <= first.marketCents) return first.valueBp; // tramo plano inicial
  if (marketCents >= last.marketCents) return last.valueBp; // tramo plano final
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (marketCents >= p0.marketCents && marketCents < p1.marketCents) {
      const span = p1.marketCents - p0.marketCents;
      // ROUND_HALF_UP hacia +∞ (sesgo N.0). El resultado es bp ENTERO.
      return p0.valueBp + Math.round(((p1.valueBp - p0.valueBp) * (marketCents - p0.marketCents)) / span);
    }
  }
  /* istanbul ignore next — inalcanzable con puntos ordenados; red de seguridad. */
  return last.valueBp;
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
  if (ladder.length === 0) return cents;
  const band = ladder.find((b) => b.uptoCents == null || cents < b.uptoCents) ?? ladder[ladder.length - 1];
  const step = Number.isInteger(band.stepCents) && band.stepCents >= 1 ? band.stepCents : 1;
  return Math.ceil(cents / step) * step;
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
  if (marketMxnCents == null || marketMxnCents <= 0) return { cents: null, basis: 'pending' };
  const rawCents = Math.round((marketMxnCents * saleMultiplierBpAt(curve, marketMxnCents)) / 10_000);
  const floorCents = curve.sale.floorCents;
  const baseCents = Math.max(floorCents, rawCents);
  const basis: PriceBasis = floorCents > rawCents ? 'floor' : 'market';
  return { cents: roundUp(baseCents, curve.sale.rounding), basis };
}

/**
 * COMPRA: `max( bin , mercado × pct(mercado) )`. **SIN redondeo** (§N.1).
 * EMPATE ⇒ `market`, igual que en venta.
 */
export function resolveBuyFromCurve(marketMxnCents: number | null, curve: PricingCurve): CurveResolution {
  if (marketMxnCents == null || marketMxnCents <= 0) return { cents: null, basis: 'pending' };
  const rawCents = Math.round((marketMxnCents * buyPctBpAt(curve, marketMxnCents)) / 10_000);
  const binCents = curve.buy.binCents;
  const basis: PriceBasis = binCents > rawCents ? 'floor' : 'market';
  return { cents: Math.max(binCents, rawCents), basis };
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

function err(code: CurveErrorCode, message: string, details: CurveValidationError['details'] = {}): CurveValidationError {
  return { code, message, details };
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
  // ---- Forma ----------------------------------------------------------------
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return err('VALIDATION_ERROR', 'pricing curve must be an object { version, sale, buy }');
  }
  const c = value as Partial<PricingCurve>;
  if (c.version !== 1) {
    return err('VALIDATION_ERROR', 'unsupported curve version: must be 1', { version: c.version });
  }
  const sale = c.sale;
  const buy = c.buy;
  if (sale == null || typeof sale !== 'object' || Array.isArray(sale)) {
    return err('VALIDATION_ERROR', 'sale must be an object { floorCents, points, rounding }', { axis: 'sale' });
  }
  if (buy == null || typeof buy !== 'object' || Array.isArray(buy)) {
    return err('VALIDATION_ERROR', 'buy must be an object { binCents, points }', { axis: 'buy' });
  }
  if (!Array.isArray(sale.points)) {
    return err('VALIDATION_ERROR', 'sale.points must be an array', { axis: 'sale' });
  }
  if (!Array.isArray(buy.points)) {
    return err('VALIDATION_ERROR', 'buy.points must be an array', { axis: 'buy' });
  }
  if (!Array.isArray(sale.rounding)) {
    return err('VALIDATION_ERROR', 'sale.rounding must be an array', { axis: 'sale' });
  }

  // ---- V1: curva no vacía ---------------------------------------------------
  if (sale.points.length === 0) {
    return err('CURVE_EMPTY', 'sale.points must have at least 1 breakpoint', { axis: 'sale' });
  }
  if (buy.points.length === 0) {
    return err('CURVE_EMPTY', 'buy.points must have at least 1 breakpoint', { axis: 'buy' });
  }

  // ---- V3: tipos y rangos ---------------------------------------------------
  if (!isInt(sale.floorCents) || sale.floorCents < 0) {
    return err('VALIDATION_ERROR', 'sale.floorCents must be an integer >= 0 (cents)', { axis: 'sale' });
  }
  if (!isInt(buy.binCents) || buy.binCents < 0) {
    return err('VALIDATION_ERROR', 'buy.binCents must be an integer >= 0 (cents)', { axis: 'buy' });
  }
  for (let i = 0; i < sale.points.length; i++) {
    const p = sale.points[i] as SaleCurvePoint | undefined;
    if (p == null || typeof p !== 'object') {
      return err('VALIDATION_ERROR', 'sale point must be an object { marketCents, multiplierBp }', { axis: 'sale', index: i });
    }
    if (!isInt(p.marketCents) || p.marketCents < 0) {
      return err('VALIDATION_ERROR', 'marketCents must be an integer >= 0 (cents)', {
        axis: 'sale',
        index: i,
        marketCents: p.marketCents,
      });
    }
    if (!isInt(p.multiplierBp)) {
      return err('VALIDATION_ERROR', 'multiplierBp must be an integer (bp of market; 10000 = 1x)', {
        axis: 'sale',
        index: i,
        marketCents: p.marketCents,
        multiplierBp: p.multiplierBp,
      });
    }
    if (p.multiplierBp > MULTIPLIER_BP_MAX) {
      return err('VALIDATION_ERROR', `multiplierBp must be <= ${MULTIPLIER_BP_MAX} (bp)`, {
        axis: 'sale',
        index: i,
        marketCents: p.marketCents,
        multiplierBp: p.multiplierBp,
      });
    }
  }
  for (let i = 0; i < buy.points.length; i++) {
    const p = buy.points[i] as BuyCurvePoint | undefined;
    if (p == null || typeof p !== 'object') {
      return err('VALIDATION_ERROR', 'buy point must be an object { marketCents, pctBp }', { axis: 'buy', index: i });
    }
    if (!isInt(p.marketCents) || p.marketCents < 0) {
      return err('VALIDATION_ERROR', 'marketCents must be an integer >= 0 (cents)', {
        axis: 'buy',
        index: i,
        marketCents: p.marketCents,
      });
    }
    if (!isInt(p.pctBp) || p.pctBp < 0 || p.pctBp > PCT_BP_MAX) {
      return err('VALIDATION_ERROR', `pctBp must be an integer in [0, ${PCT_BP_MAX}] (bp of market)`, {
        axis: 'buy',
        index: i,
        marketCents: p.marketCents,
        pctBp: p.pctBp,
      });
    }
  }

  // ---- V4: ningún precio de venta por debajo del mercado --------------------
  for (let i = 0; i < sale.points.length; i++) {
    const p = sale.points[i];
    if (p.multiplierBp < MULTIPLIER_BP_MIN) {
      return err('SALE_BELOW_MARKET', `multiplierBp must be >= ${MULTIPLIER_BP_MIN} (1.00x): sale price can never fall below market`, {
        axis: 'sale',
        index: i,
        marketCents: p.marketCents,
        multiplierBp: p.multiplierBp,
      });
    }
  }

  // ---- V2: puntos ordenables y únicos --------------------------------------
  const salePts = indexed(sale.points, (p) => p.multiplierBp);
  const buyPts = indexed(buy.points, (p) => p.pctBp);
  for (let i = 1; i < salePts.length; i++) {
    if (salePts[i].marketCents === salePts[i - 1].marketCents) {
      return err('DUPLICATE_BREAKPOINT', 'two sale breakpoints share the same marketCents', {
        axis: 'sale',
        index: salePts[i].index,
        index2: salePts[i - 1].index,
        marketCents: salePts[i].marketCents,
      });
    }
  }
  for (let i = 1; i < buyPts.length; i++) {
    if (buyPts[i].marketCents === buyPts[i - 1].marketCents) {
      return err('DUPLICATE_BREAKPOINT', 'two buy breakpoints share the same marketCents', {
        axis: 'buy',
        index: buyPts[i].index,
        index2: buyPts[i - 1].index,
        marketCents: buyPts[i].marketCents,
      });
    }
  }

  // ---- V8: escalera bien formada -------------------------------------------
  const ladderErr = validateRoundingLadder(sale.rounding);
  if (ladderErr != null) return ladderErr;

  // ---- V7: el bin no rebasa al piso ----------------------------------------
  if (buy.binCents >= sale.floorCents) {
    return err('BIN_ABOVE_FLOOR', 'buy.binCents must be strictly below sale.floorCents', {
      axis: 'buy',
      binCents: buy.binCents,
      floorCents: sale.floorCents,
    });
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
      return err(
        'SALE_CURVE_NOT_MONOTONIC',
        'sale curve is not monotonically increasing: more market would produce LESS price on this segment',
        {
          axis: 'sale',
          index: p0.index,
          index2: p1.index,
          marketCents: p0.marketCents,
          marketCentsTo: p1.marketCents,
        },
      );
    }
  }
  // Los tramos planos (antes del primero, después del último) son crecientes porque k > 0 (V4 ⇒ k ≥ 10000).

  // ---- V6: compra siempre por debajo de venta, en TODO el dominio -----------
  // Ambas curvas son lineales por tramo sobre la UNIÓN de sus `marketCents` ⇒ la diferencia
  // `multiplierBp(m) − pctBp(m)` es lineal por tramo ⇒ basta comprobar los NODOS (y las colas planas,
  // que son constantes iguales al valor del nodo extremo). Es exacto, no un muestreo.
  const saleCurveBp = salePts.map((p) => ({ marketCents: p.marketCents, valueBp: p.valueBp }));
  const buyCurveBp = buyPts.map((p) => ({ marketCents: p.marketCents, valueBp: p.valueBp }));
  const nodes = Array.from(new Set([...saleCurveBp, ...buyCurveBp].map((p) => p.marketCents))).sort((a, b) => a - b);
  for (const m of nodes) {
    const mult = interp(saleCurveBp, m);
    const pct = interp(buyCurveBp, m);
    if (pct >= mult) {
      const offending = buyPts.find((p) => p.marketCents === m) ?? salePts.find((p) => p.marketCents === m);
      return err('BUY_ABOVE_SALE', 'buy curve reaches or exceeds the sale curve at this market value', {
        axis: 'buy',
        index: offending?.index,
        marketCents: m,
        pctBp: pct,
        multiplierBp: mult,
      });
    }
  }

  return null;
}

/**
 * V8 — escalera bien formada. La condición SUTIL es la última: **cada frontera debe ser múltiplo
 * exacto del paso de la banda inmediatamente inferior**. Sin ella el redondeo ROMPE la monotonía que
 * V5 acaba de garantizar: con bandas `<$200⇒$5` y una frontera en $203, un `baseCents` de $202.99
 * redondea a $205 mientras que $203.00 cae a la banda siguiente y podría redondear a MENOS.
 */
export function validateRoundingLadder(ladder: readonly RoundingBand[]): CurveValidationError | null {
  if (!Array.isArray(ladder) || ladder.length === 0) {
    return err('ROUNDING_LADDER_INVALID', 'sale.rounding must have at least 1 band', { axis: 'sale' });
  }
  for (let i = 0; i < ladder.length; i++) {
    const b = ladder[i];
    if (b == null || typeof b !== 'object') {
      return err('ROUNDING_LADDER_INVALID', 'rounding band must be an object { uptoCents, stepCents }', {
        axis: 'sale',
        index: i,
      });
    }
    if (!isInt(b.stepCents) || b.stepCents < 1) {
      return err('ROUNDING_LADDER_INVALID', 'stepCents must be an integer >= 1', {
        axis: 'sale',
        index: i,
        stepCents: b.stepCents,
      });
    }
    const isLast = i === ladder.length - 1;
    if (isLast) {
      if (b.uptoCents !== null) {
        return err('ROUNDING_LADDER_INVALID', 'the LAST rounding band must be open (uptoCents = null)', {
          axis: 'sale',
          index: i,
          uptoCents: b.uptoCents,
        });
      }
    } else {
      if (b.uptoCents === null || !isInt(b.uptoCents) || b.uptoCents <= 0) {
        return err('ROUNDING_LADDER_INVALID', 'only the LAST rounding band may be open; uptoCents must be an integer > 0', {
          axis: 'sale',
          index: i,
          uptoCents: b.uptoCents,
        });
      }
      const prev = i > 0 ? ladder[i - 1].uptoCents : null;
      if (prev != null && b.uptoCents <= prev) {
        return err('ROUNDING_LADDER_INVALID', 'uptoCents must be strictly increasing', {
          axis: 'sale',
          index: i,
          uptoCents: b.uptoCents,
        });
      }
      // Frontera múltiplo EXACTO del paso de su propia banda (la inmediatamente inferior a la frontera).
      if (b.uptoCents % b.stepCents !== 0) {
        return err(
          'ROUNDING_LADDER_INVALID',
          'each band boundary must be an exact multiple of the step of the band below it (otherwise rounding breaks monotonicity)',
          { axis: 'sale', index: i, uptoCents: b.uptoCents, stepCents: b.stepCents },
        );
      }
    }
  }
  return null;
}

// ============================================================================
// Normalización / lectura money-safe
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
