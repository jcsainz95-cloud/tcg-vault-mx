import type {
  BuyCurvePointDTO,
  CurveErrorDetails,
  PricingCurveDTO,
  RoundingBandDTO,
  SaleCurvePointDTO,
} from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';

/**
 * Borrador del editor de la CURVA (DESIGN_SYSTEM §21.1–§21.6). Este módulo NO contiene la
 * matemática de la curva: la interpolación, el `max` con la constante y la escalera viven en el
 * backend y llegan por `POST /admin/pricing/curve/preview` (ARCHITECTURE §4.36.8a). Aquí solo hay
 * **texto crudo ↔ unidades del contrato** y el estado del borrador.
 *
 * ⚠️ UNIDADES (§21.1c): el contrato habla en **centavos** y **puntos base**; la pantalla, en
 * **pesos**, **`×`** y **`%`**. La conversión vive AQUÍ y en ningún otro sitio — nunca se muestran
 * `marketCents`, `multiplierBp` ni `pctBp` crudos, ni en `title` ni en `aria-label`.
 */

export type CurveAxis = 'sale' | 'buy';

/** Fila de punto en edición. `valueRaw` = multiplicador (venta, `×`) o pago (compra, `%`). */
export interface PointRow {
  /** Id estable de fila: sobrevive al reordenamiento (React key y foco). */
  key: string;
  marketRaw: string;
  valueRaw: string;
  /** Agregada en este borrador y aún sin guardar (versalita `NUEVO`). */
  isNew?: boolean;
  /** Se prerrellenó con la interpolación vigente ⇒ es neutra por construcción (§21.2b). */
  prefilledNeutral?: boolean;
}

/** Banda de la escalera de redondeo ↑. `uptoRaw === null` = banda abierta (`EN ADELANTE`). */
export interface BandRow {
  key: string;
  uptoRaw: string | null;
  stepRaw: string;
}

export interface CurveDraft {
  floorRaw: string;
  binRaw: string;
  sale: PointRow[];
  buy: PointRow[];
  rounding: BandRow[];
}

let seq = 0;
export function nextKey(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

// ---------------------------------------------------------------------------
// Texto crudo ↔ unidades del contrato
// ---------------------------------------------------------------------------

/**
 * Sanea entrada monetaria/decimal a dígitos + UN SOLO punto (money-safe): un
 * `replace(/[^0-9.]/g,'')` deja pasar «1.2.3», que castea a NaN → 0 y publicaría a MX$0.
 */
export function sanitizeDecimal(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

/** `''`/mal formado ⇒ `null` (NUNCA 0: un vacío no es un precio). */
export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (s === '' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function pesosToCents(raw: string): number | null {
  const n = parseNumber(raw);
  return n == null ? null : Math.round(n * 100);
}

export function centsToPesos(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** `1.60` → `16000` bp. */
export function multiplierToBp(raw: string): number | null {
  const n = parseNumber(raw);
  return n == null ? null : Math.round(n * 10000);
}

export function bpToMultiplier(bp: number): string {
  return (bp / 10000).toFixed(2);
}

/** `30` → `3000` bp. */
export function pctToBp(raw: string): number | null {
  const n = parseNumber(raw);
  return n == null ? null : Math.round(n * 100);
}

export function bpToPct(bp: number): string {
  const v = bp / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ---------------------------------------------------------------------------
// Semilla del borrador desde el objeto guardado
// ---------------------------------------------------------------------------

export function draftFromCurve(curve: PricingCurveDTO): CurveDraft {
  return {
    floorRaw: centsToPesos(curve.sale.floorCents),
    binRaw: centsToPesos(curve.buy.binCents),
    sale: curve.sale.points.map((p) => ({
      key: nextKey('sale'),
      marketRaw: centsToPesos(p.marketCents),
      valueRaw: bpToMultiplier(p.multiplierBp),
    })),
    buy: curve.buy.points.map((p) => ({
      key: nextKey('buy'),
      marketRaw: centsToPesos(p.marketCents),
      valueRaw: bpToPct(p.pctBp),
    })),
    rounding: curve.sale.rounding.map((b) => ({
      key: nextKey('band'),
      uptoRaw: b.uptoCents == null ? null : centsToPesos(b.uptoCents),
      stepRaw: centsToPesos(b.stepCents),
    })),
  };
}

// ---------------------------------------------------------------------------
// Borrador → DTO
// ---------------------------------------------------------------------------

function salePoint(row: PointRow): SaleCurvePointDTO | null {
  const marketCents = pesosToCents(row.marketRaw);
  const multiplierBp = multiplierToBp(row.valueRaw);
  if (marketCents == null || multiplierBp == null) return null;
  return { marketCents, multiplierBp };
}

function buyPoint(row: PointRow): BuyCurvePointDTO | null {
  const marketCents = pesosToCents(row.marketRaw);
  const pctBp = pctToBp(row.valueRaw);
  if (marketCents == null || pctBp == null) return null;
  return { marketCents, pctBp };
}

function band(row: BandRow): RoundingBandDTO | null {
  const stepCents = pesosToCents(row.stepRaw);
  if (stepCents == null) return null;
  if (row.uptoRaw === null) return { uptoCents: null, stepCents };
  const uptoCents = pesosToCents(row.uptoRaw);
  if (uptoCents == null) return null;
  return { uptoCents, stepCents };
}

/**
 * DTO para el **dry-run**: tolerante — descarta las filas INCOMPLETAS (mercado o valor vacío) en
 * vez de rendirse. Así el previsualizador sigue enseñando pesos mientras se teclea una fila nueva,
 * y así el prerrelleno de §21.2b puede preguntar «¿cuánto vale la curva ACTUAL en este mercado?».
 */
export function toPreviewCurve(draft: CurveDraft): PricingCurveDTO | null {
  const floorCents = pesosToCents(draft.floorRaw);
  const binCents = pesosToCents(draft.binRaw);
  if (floorCents == null || binCents == null) return null;
  const sale = draft.sale.map(salePoint).filter((p): p is SaleCurvePointDTO => p != null);
  const buy = draft.buy.map(buyPoint).filter((p): p is BuyCurvePointDTO => p != null);
  const rounding = draft.rounding.map(band).filter((b): b is RoundingBandDTO => b != null);
  if (sale.length === 0 || buy.length === 0 || rounding.length === 0) return null;
  return {
    version: 1,
    sale: { floorCents, points: sale, rounding },
    buy: { binCents, points: buy },
  };
}

/**
 * DTO para el **PUT**: estricto — si algo no parsea, devuelve `null` y no se envía nada
 * (money-safe: un vacío jamás viaja como 0). El orden lo impone el servidor, pero se manda ya
 * ordenado por `marketCents` para que el `before/after` de la bitácora sea legible.
 */
export function toSaveCurve(draft: CurveDraft): PricingCurveDTO | null {
  const floorCents = pesosToCents(draft.floorRaw);
  const binCents = pesosToCents(draft.binRaw);
  if (floorCents == null || binCents == null) return null;
  const sale: SaleCurvePointDTO[] = [];
  for (const row of draft.sale) {
    const p = salePoint(row);
    if (!p) return null;
    sale.push(p);
  }
  const buy: BuyCurvePointDTO[] = [];
  for (const row of draft.buy) {
    const p = buyPoint(row);
    if (!p) return null;
    buy.push(p);
  }
  const rounding: RoundingBandDTO[] = [];
  for (const row of draft.rounding) {
    const b = band(row);
    if (!b) return null;
    rounding.push(b);
  }
  sale.sort((a, b) => a.marketCents - b.marketCents);
  buy.sort((a, b) => a.marketCents - b.marketCents);
  return {
    version: 1,
    sale: { floorCents, points: sale, rounding },
    buy: { binCents, points: buy },
  };
}

// ---------------------------------------------------------------------------
// Validación de UN control sobre sí mismo (§21.4a: al `blur`, nunca al teclear)
// ---------------------------------------------------------------------------

export type FieldErrorCode =
  | 'required'
  | 'negative'
  | 'multiplierTooLow'
  | 'multiplierTooHigh'
  | 'pctRange'
  | 'stepTooLow'
  | 'uptoNotIncreasing'
  | 'duplicateMarket'
  | 'constantTooHigh';

/**
 * Techo de cordura de `floorCents` / `binCents` (contrato v2.1.9 §M2, `MAX_CURVE_CONSTANT_CENTS`):
 * **MX$2,000**, cerrado por el dueño en Q-D1. NO es `MAX_CENTS`: son las dos únicas entradas que
 * por sí solas fijan el precio de TODO el catálogo (un piso disparado no produce «un precio alto»,
 * produce la VITRINA ENTERA republicada), así que piden cordura y no solo representabilidad.
 *
 * El anclaje es **qué es el número acotado**: `floorCents` ES el precio de la carta más barata de
 * la tienda, así que un piso arriba de MX$2,000 significaría que NADA en la vitrina baja de esa
 * cifra — implausible para un marketplace de singles cuya semilla es MX$25 y cuyo bulk vale
 * centavos. Deja 80× sobre la semilla del piso y queda 10,737× por debajo de Int32.
 *
 * ⛔ NO se deriva de los topes de §E (MX$3,000/solicitud, MX$10,000/mes): esos son límites **AML
 * por usuario sobre dinero que SALE** y no dicen nada sobre cuánto puede costar la carta más
 * barata. Queda escrito para que nadie lo «restaure» viendo que las cifras se parecían.
 *
 * ⚠️ **Este valor tiene que ser EL MISMO que el del backend.** Si el cliente aceptara en el campo
 * lo que el `PUT` rechaza con 422, cliente y servidor estarían discrepando sobre la misma regla —
 * §21.4 con el signo invertido: el editor promete que se puede guardar y el guardado dice que no.
 */
export const MAX_CURVE_CONSTANT_CENTS = 200_000;

/**
 * Validación de una CONSTANTE del eje (piso de venta / bin de compra). Es `marketError` más el
 * techo: un punto de la tabla describe el valor de UNA carta; el piso y el bin fijan el de todas.
 */
export function constantError(raw: string): FieldErrorCode | null {
  const cents = pesosToCents(raw);
  if (cents == null) return 'required';
  if (cents < 0) return 'negative';
  if (cents > MAX_CURVE_CONSTANT_CENTS) return 'constantTooHigh';
  return null;
}

export function marketError(raw: string): FieldErrorCode | null {
  const cents = pesosToCents(raw);
  if (cents == null) return 'required';
  if (cents < 0) return 'negative';
  return null;
}

/** V4 hecho control: el multiplicador de venta nunca puede bajar de 1.00×. */
export function multiplierError(raw: string): FieldErrorCode | null {
  const bp = multiplierToBp(raw);
  if (bp == null) return 'required';
  if (bp < 10000) return 'multiplierTooLow';
  if (bp > 1000000) return 'multiplierTooHigh';
  return null;
}

export function pctError(raw: string): FieldErrorCode | null {
  const bp = pctToBp(raw);
  if (bp == null) return 'required';
  if (bp < 0 || bp > 10000) return 'pctRange';
  return null;
}

export function stepError(raw: string): FieldErrorCode | null {
  const cents = pesosToCents(raw);
  if (cents == null) return 'required';
  if (cents < 1) return 'stepTooLow';
  return null;
}

/** Las fronteras de la escalera son estrictamente crecientes (mitad barata de V8). */
export function uptoError(rows: BandRow[], index: number): FieldErrorCode | null {
  const row = rows[index];
  if (!row || row.uptoRaw === null) return null;
  const cents = pesosToCents(row.uptoRaw);
  if (cents == null) return 'required';
  if (cents < 0) return 'negative';
  const prev = index > 0 ? rows[index - 1] : null;
  const prevCents = prev && prev.uptoRaw !== null ? pesosToCents(prev.uptoRaw) : null;
  if (prevCents != null && cents <= prevCents) return 'uptoNotIncreasing';
  return null;
}

/**
 * V2 a nivel de tabla: dos puntos en el MISMO mercado. Tras reordenar quedan adyacentes, así que
 * el marcado por-fila es suficiente. Se evalúa al `blur`, no al teclear.
 */
export function duplicateMarketKeys(rows: PointRow[]): Set<string> {
  const seen = new Map<number, string[]>();
  for (const row of rows) {
    const cents = pesosToCents(row.marketRaw);
    if (cents == null) continue;
    const list = seen.get(cents) ?? [];
    list.push(row.key);
    seen.set(cents, list);
  }
  const dupes = new Set<string>();
  for (const list of seen.values()) if (list.length > 1) for (const k of list) dupes.add(k);
  return dupes;
}

// ---------------------------------------------------------------------------
// Reordenamiento por `marketCents` al `blur` (§21.2a — sin arrastrar y soltar)
// ---------------------------------------------------------------------------

/**
 * El orden NO es un dato que el dueño edite: se DERIVA de `marketCents`. Las filas sin mercado
 * legible se quedan al final (no se ordenan; quedan marcadas). Estable: a igual mercado se
 * conserva el orden previo, para que un duplicado no salte de sitio antes de corregirse.
 */
export function sortByMarket(rows: PointRow[]): PointRow[] {
  return rows
    .map((row, i) => ({ row, i, cents: pesosToCents(row.marketRaw) }))
    .sort((a, b) => {
      if (a.cents == null && b.cents == null) return a.i - b.i;
      if (a.cents == null) return 1;
      if (b.cents == null) return -1;
      return a.cents - b.cents || a.i - b.i;
    })
    .map((x) => x.row);
}

// ---------------------------------------------------------------------------
// Diff legible (§21.2d marca de campo, §21.6b diálogo)
// ---------------------------------------------------------------------------

export type DiffKind = 'changed' | 'added' | 'removed';

export interface CurveDiffEntry {
  axis: 'sale' | 'buy' | 'floor' | 'bin' | 'rounding';
  kind: DiffKind;
  /** Mercado del punto (centavos) o frontera de la banda; `null` en piso/bin/banda abierta. */
  marketCents: number | null;
  before?: string;
  after?: string;
}

function saleValueText(bp: number): string {
  return `${bpToMultiplier(bp)}×`;
}
function buyValueText(bp: number): string {
  return `${bpToPct(bp)}%`;
}

/**
 * Diff del borrador contra la curva guardada, en las unidades de PANTALLA. Se compara por
 * `marketCents` (el índice del array es un detalle del contrato, no un dato del dueño, §21.2e).
 */
export function diffCurve(saved: PricingCurveDTO, next: PricingCurveDTO): CurveDiffEntry[] {
  const out: CurveDiffEntry[] = [];
  if (saved.sale.floorCents !== next.sale.floorCents) {
    out.push({
      axis: 'floor',
      kind: 'changed',
      marketCents: null,
      before: centsToPesos(saved.sale.floorCents),
      after: centsToPesos(next.sale.floorCents),
    });
  }
  if (saved.buy.binCents !== next.buy.binCents) {
    out.push({
      axis: 'bin',
      kind: 'changed',
      marketCents: null,
      before: centsToPesos(saved.buy.binCents),
      after: centsToPesos(next.buy.binCents),
    });
  }
  const savedSale = new Map(saved.sale.points.map((p) => [p.marketCents, p.multiplierBp]));
  const nextSale = new Map(next.sale.points.map((p) => [p.marketCents, p.multiplierBp]));
  for (const [market, bp] of nextSale) {
    const before = savedSale.get(market);
    if (before == null) {
      out.push({ axis: 'sale', kind: 'added', marketCents: market, after: saleValueText(bp) });
    } else if (before !== bp) {
      out.push({
        axis: 'sale',
        kind: 'changed',
        marketCents: market,
        before: saleValueText(before),
        after: saleValueText(bp),
      });
    }
  }
  for (const [market, bp] of savedSale) {
    if (!nextSale.has(market)) {
      out.push({ axis: 'sale', kind: 'removed', marketCents: market, before: saleValueText(bp) });
    }
  }
  const savedBuy = new Map(saved.buy.points.map((p) => [p.marketCents, p.pctBp]));
  const nextBuy = new Map(next.buy.points.map((p) => [p.marketCents, p.pctBp]));
  for (const [market, bp] of nextBuy) {
    const before = savedBuy.get(market);
    if (before == null) {
      out.push({ axis: 'buy', kind: 'added', marketCents: market, after: buyValueText(bp) });
    } else if (before !== bp) {
      out.push({
        axis: 'buy',
        kind: 'changed',
        marketCents: market,
        before: buyValueText(before),
        after: buyValueText(bp),
      });
    }
  }
  for (const [market, bp] of savedBuy) {
    if (!nextBuy.has(market)) {
      out.push({ axis: 'buy', kind: 'removed', marketCents: market, before: buyValueText(bp) });
    }
  }
  const bandText = (b: RoundingBandDTO) => centsToPesos(b.stepCents);
  const sameLadder =
    saved.sale.rounding.length === next.sale.rounding.length &&
    saved.sale.rounding.every(
      (b, i) =>
        b.uptoCents === next.sale.rounding[i].uptoCents &&
        b.stepCents === next.sale.rounding[i].stepCents,
    );
  if (!sameLadder) {
    for (const b of next.sale.rounding) {
      const before = saved.sale.rounding.find((x) => x.uptoCents === b.uptoCents);
      if (!before) {
        out.push({ axis: 'rounding', kind: 'added', marketCents: b.uptoCents, after: bandText(b) });
      } else if (before.stepCents !== b.stepCents) {
        out.push({
          axis: 'rounding',
          kind: 'changed',
          marketCents: b.uptoCents,
          before: bandText(before),
          after: bandText(b),
        });
      }
    }
    for (const b of saved.sale.rounding) {
      if (!next.sale.rounding.some((x) => x.uptoCents === b.uptoCents)) {
        out.push({
          axis: 'rounding',
          kind: 'removed',
          marketCents: b.uptoCents,
          before: bandText(b),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 422 del servidor (§21.4b) — el contrato dice QUÉ PUNTO lo rompe
// ---------------------------------------------------------------------------

export interface CurveViolation {
  code: string;
  details: CurveErrorDetails;
}

const CURVE_ERROR_CODES = new Set([
  'CURVE_EMPTY',
  'DUPLICATE_BREAKPOINT',
  'SALE_BELOW_MARKET',
  'SALE_CURVE_NOT_MONOTONIC',
  // V9 (v2.1.4): código PROPIO, no una generalización del de venta. Son gemelos —mismo esqueleto
  // de copy y misma marca de tramo— pero el daño es distinto: en venta el precio BAJA; en compra
  // PAGARÍAS MENOS. Unificarlos obligaría a un mensaje que no dice ninguna de las dos cosas.
  'BUY_CURVE_NOT_MONOTONIC',
  'BUY_ABOVE_SALE',
  'BIN_ABOVE_FLOOR',
  'ROUNDING_LADDER_INVALID',
]);

export function isCurveErrorCode(code: string | undefined): boolean {
  return code != null && CURVE_ERROR_CODES.has(code);
}

/**
 * Extrae la infracción de un `422` de la curva. Devuelve `null` para cualquier otro fallo
 * (`403`, `5xx`, red) — esos usan el patrón genérico de §8.1 con «Reintentar», y **nunca** se
 * deja la pantalla insinuando que algo se guardó a medias.
 */
export function curveViolationFromError(error: unknown): CurveViolation | null {
  if (!(error instanceof ApiClientError)) return null;
  if (!isCurveErrorCode(error.code)) return null;
  return { code: error.code, details: (error.details as CurveErrorDetails) ?? {} };
}

/**
 * Mercados (centavos) implicados por una infracción: para marcar filas y resaltar el
 * previsualizador. Los errores de TRAMO (V5 venta, V9 compra, V6) devuelven **los dos extremos** —
 * marcar uno solo mandaría al dueño a buscar el problema donde no está.
 */
export function violationMarkets(v: CurveViolation): number[] {
  const out: number[] = [];
  if (v.details.marketCents != null) out.push(v.details.marketCents);
  // El segundo extremo: `marketCentsTo` es lo que emite el backend; `toMarketCents` se tolera
  // porque el contrato deja el nombre dentro de un «…» (ver `CurveErrorDetails`).
  const to = v.details.marketCentsTo ?? v.details.toMarketCents;
  if (to != null && to !== v.details.marketCents) out.push(to);
  return out;
}
