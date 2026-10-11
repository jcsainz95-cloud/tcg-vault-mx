/**
 * robust-market.ts — v1.91⟨precios⟩ (M-75) — EL ÁRBITRO DE MEDIANA + EL CANDADO ANTI-INFLADO ×5.
 *
 * Norma: `API_CONTRACT §PRE` (B, C, G) y `ARCHITECTURE §4.PRE` (b) árbitro, (c) candado, (f) obsolescencia.
 * 💰 DINERO en los dos ejes (venta y compra). Módulo PURO (sin infra, como `pricing-curve.ts`): lo
 * comparten el resolvedor de lectura (`PricingService`), el barrido (`price-ingest`) y la cola de revisión.
 *
 * ⛔ TODO en centavos enteros, sin float (convención §3). El factor de salto se guarda ×1000 entero.
 *
 * El bug que mata (§PRE.0): Prismatic sale ×55 porque una fila residual que APLANA (PPT/pokemontcg.io da
 * UN `market` por carta) corona como «la verdad» cuando la primaria por variante tiene hueco. Aquí:
 *   1. esas fuentes NUNCA entran al conjunto de entrada (no votan, criterio 883);
 *   2. el valor de mercado es la MEDIANA por familia (robusta a UN outlier), no la fila top-ranked;
 *   3. un salto ≥N× sin consenso de ≥2 familias NO publica: abre caso de revisión.
 */
import { PriceSource } from '@prisma/client';

// ─────────────────────────────── DIALES (§PRE.G, criterio 882) ───────────────────────────────
// Seeds. Viven en `ConfigSetting` (editables sin redeploy); aquí el DEFAULT y el validador de puerta.
export const DEFAULT_PRICE_JUMP_FACTOR = 5;
export const DEFAULT_PRICE_JUMP_FACTOR_BUY = 5;
export const DEFAULT_PRICE_ARBITER_FRESHNESS_DAYS = 7;
export const DEFAULT_PRICE_CONSENSUS_TOLERANCE_PCT = 25;
export const DEFAULT_PRICE_ARBITER_SOURCES: readonly string[] = ['tcgcsv_singles', 'tcgdex', 'cardmarket'];

/**
 * Fuentes que NUNCA votan el árbitro ni el buylist (§PRE.A / criterio 883): las que APLANAN
 * (`pokemontcg_io`, `pokemonpricetracker`) y el override `manual` (es tier 0, gana absoluto antes del
 * árbitro). Se excluyen SIEMPRE, aunque alguien las ponga en el dial — defensa en profundidad.
 */
const NON_VOTING_SOURCES: ReadonlySet<string> = new Set(['pokemontcg_io', 'pokemonpricetracker', 'manual']);

/** Las `PriceSource` arbitro-ELEGIBLES = toda la enum menos las que no votan. Derivada (no literal). */
export const ARBITER_ELIGIBLE_SOURCES: readonly string[] = Object.values(PriceSource).filter(
  (s) => !NON_VOTING_SOURCES.has(s),
);

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `priceJumpFactor` / `priceJumpFactorBuy`: número ≥ 1 (§PRE.G). */
export function validatePriceJumpFactor(v: unknown): string | null {
  return isNum(v) && v >= 1 ? null : 'must be a number >= 1';
}
/** `priceArbiterFreshnessDays`: entero ≥ 1 (§PRE.G, criterio 881). */
export function validatePriceArbiterFreshnessDays(v: unknown): string | null {
  return isInt(v) && v >= 1 ? null : 'must be an integer >= 1 (days)';
}
/** `priceConsensusTolerancePct`: entero [0,100] (§PRE.G). */
export function validatePriceConsensusTolerancePct(v: unknown): string | null {
  return isInt(v) && v >= 0 && v <= 100 ? null : 'must be an integer in [0, 100]';
}
/**
 * `priceArbiterSources`: lista NO vacía de `PriceSource` arbitro-elegibles, sin duplicados (§PRE.G).
 * ⛔ `pokemontcg_io`/`pokemonpricetracker`/`manual` rechazadas (criterio 883).
 */
export function validatePriceArbiterSources(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) {
    return `must be a non-empty array of admitted sources (${ARBITER_ELIGIBLE_SOURCES.join('|')})`;
  }
  for (const s of v) {
    if (typeof s !== 'string' || !ARBITER_ELIGIBLE_SOURCES.includes(s)) {
      return `each source must be one of ${ARBITER_ELIGIBLE_SOURCES.join('|')}`;
    }
  }
  if (new Set(v as string[]).size !== v.length) return 'must not contain duplicate sources';
  return null;
}

// ─────────────────────────────── FAMILIAS (§PRE (b) paso 3 / (e)) ───────────────────────────────
/**
 * `tcgplayer` = {`tcgcsv_singles`, `tcgdex`} — SON ECO (ambos origen TCGplayer): cuentan como UNA
 * familia, no como redundancia (riesgo de redundancia correlacionada, §PRE (e)). `cardmarket` =
 * {`cardmarket`} — el voto INDEPENDIENTE (mercado europeo) que da consenso al candado. Cualquier otra
 * fuente admitida (una en vivo) es su propia familia.
 */
export function familyOf(source: string): string {
  if (source === 'tcgcsv_singles' || source === 'tcgdex') return 'tcgplayer';
  if (source === 'cardmarket') return 'cardmarket';
  return `live:${source}`;
}

// ─────────────────────────────── EL ÁRBITRO ───────────────────────────────
export interface ArbiterCandidate {
  source: string; // una `PriceSource`
  priceMxnCents: number; // entero, FX-horneado
  capturedDate: string; // 'YYYY-MM-DD'
}

export interface QuoteSnapshot {
  source: string;
  family: string;
  priceMxnCents: number;
  capturedDate: string;
  stale: boolean;
}

export interface RobustResult {
  /** Mediana por familia de las frescas admitidas; `null` ⇒ 0 frescas ⇒ `PRICE_PENDING`. */
  robustMarketMxnCents: number | null;
  /** Nº de COTIZACIONES frescas que votaron (filas, no familias). */
  sourceCount: number;
  /** Nº de FAMILIAS distintas entre las frescas (lo que cuenta para consenso / fuente única). */
  familyCount: number;
  /** ≥2 familias frescas Y todas dentro de ±tolerancia de la mediana. */
  consensus: boolean;
  /** Fuente representativa (la de la cotización central; desempate por prioridad del dial). */
  medianSource: string | null;
  /** La captura MÁS fresca entre las que votaron (la «edad» mostrada, §4.PRE (a)). */
  freshestCapturedDate: string | null;
  /** Todas las cotizaciones ADMITIDAS (frescas y rancias) para la foto del caso (criterio 876). */
  quotes: QuoteSnapshot[];
}

export interface ArbiterDials {
  freshnessDays: number;
  admittedSources: readonly string[];
  consensusTolerancePct: number;
}

/** Edad en días enteros entre dos fechas 'YYYY-MM-DD' (UTC, truncado). */
function ageDays(nowIso: string, capturedIso: string): number {
  const now = Date.parse(`${nowIso}T00:00:00Z`);
  const cap = Date.parse(`${capturedIso}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(cap)) return Number.POSITIVE_INFINITY;
  return Math.floor((now - cap) / 86_400_000);
}

/**
 * Prioridad (rank) de una fuente según el ORDEN del dial `priceArbiterSources`. Menor = más prioritaria.
 * Desempate determinista cuando dos cotizaciones tienen el mismo valor (elegir la central de un conteo
 * par, elegir la representativa). Fuentes fuera del dial van al final.
 */
function sourceRankOf(source: string, admittedSources: readonly string[]): number {
  const i = admittedSources.indexOf(source);
  return i < 0 ? admittedSources.length : i;
}

/**
 * EL RESOLVEDOR ROBUSTO (§PRE.B / ARCHITECTURE §4.PRE (b)). Reúne candidatas admitidas, filtra por
 * frescura, agrupa por familia y arbitra: 3+ frescas ⇒ mediana · 2 ⇒ promedio entero `round((a+b)/2)` ·
 * 1 ⇒ esa · 0 ⇒ `null` (`PRICE_PENDING`). ⛔ Fuentes que aplanan nunca entran. Todo entero.
 */
export function resolveRobustMarket(
  candidates: ArbiterCandidate[],
  dials: ArbiterDials,
  nowIso: string,
): RobustResult {
  // Solo candidatas de fuentes ADMITIDAS por el dial Y arbitro-elegibles (defensa en profundidad:
  // `pokemontcg_io`/PPT/`manual` NUNCA, aunque el dial las trajera — criterio 883).
  const admitted = candidates.filter(
    (c) => dials.admittedSources.includes(c.source) && !NON_VOTING_SOURCES.has(c.source),
  );

  const quotes: QuoteSnapshot[] = admitted.map((c) => ({
    source: c.source,
    family: familyOf(c.source),
    priceMxnCents: c.priceMxnCents,
    capturedDate: c.capturedDate,
    stale: ageDays(nowIso, c.capturedDate) > dials.freshnessDays,
  }));

  const fresh = quotes.filter((q) => !q.stale && q.priceMxnCents > 0);

  if (fresh.length === 0) {
    return {
      robustMarketMxnCents: null,
      sourceCount: 0,
      familyCount: 0,
      consensus: false,
      medianSource: null,
      freshestCapturedDate: null,
      quotes,
    };
  }

  // Orden determinista por (precio, prioridad del dial, fuente) para elegir la(s) central(es).
  const sorted = [...fresh].sort((a, b) => {
    if (a.priceMxnCents !== b.priceMxnCents) return a.priceMxnCents - b.priceMxnCents;
    const ra = sourceRankOf(a.source, dials.admittedSources);
    const rb = sourceRankOf(b.source, dials.admittedSources);
    if (ra !== rb) return ra - rb;
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  });

  const n = sorted.length;
  let robust: number;
  let medianSource: string;
  if (n === 1) {
    robust = sorted[0].priceMxnCents;
    medianSource = sorted[0].source;
  } else if (n % 2 === 1) {
    const mid = sorted[(n - 1) / 2];
    robust = mid.priceMxnCents;
    medianSource = mid.source;
  } else {
    const loMid = sorted[n / 2 - 1];
    const hiMid = sorted[n / 2];
    robust = Math.round((loMid.priceMxnCents + hiMid.priceMxnCents) / 2);
    medianSource = loMid.source; // la de mayor prioridad entre las dos centrales (ya ordenadas)
  }

  const families = new Set(fresh.map((q) => q.family));
  const familyCount = families.size;

  // Consenso = ≥2 FAMILIAS frescas Y toda cotización fresca dentro de ±tol de la mediana (entero-exacto:
  // |q - robust|*100 <= tol*robust).
  let withinBand = true;
  for (const q of fresh) {
    const diff = Math.abs(q.priceMxnCents - robust);
    if (diff * 100 > dials.consensusTolerancePct * robust) {
      withinBand = false;
      break;
    }
  }
  const consensus = familyCount >= 2 && withinBand;

  const freshestCapturedDate = fresh.reduce(
    (max, q) => (q.capturedDate > max ? q.capturedDate : max),
    fresh[0].capturedDate,
  );

  return {
    robustMarketMxnCents: robust,
    sourceCount: fresh.length,
    familyCount,
    consensus,
    medianSource,
    freshestCapturedDate,
    quotes,
  };
}

// ─────────────────────────────── EL CANDADO ×5 (§PRE.C / ARCHITECTURE §4.PRE (c)) ───────────────────────────────
export type LockOutcome = 'publish' | 'review' | 'pending';

export interface LockDecision {
  outcome: LockOutcome;
  /** Qué publicar como valor SANO (el robusto) si `publish`; `null` si `pending`/`review`. */
  publishMxnCents: number | null;
  /** Último valor sano a CONSERVAR cuando `review`/`pending`; `null` ⇒ `PRICE_PENDING`. */
  conservedMxnCents: number | null;
  /** Factor de salto ×1000 entero (×55 = 55000); 0 si no hubo base o candidato contra qué medir. */
  jumpFactorMilli: number;
  /** ¿Abrir un `PriceReviewCase open`? */
  openCase: boolean;
}

/** `jumpFactor = max/min` ×1000 entero. 0 si falta algún lado. */
export function jumpFactorMilli(candidateMxnCents: number, baselineMxnCents: number | null): number {
  if (baselineMxnCents == null || baselineMxnCents <= 0 || candidateMxnCents <= 0) return 0;
  const hi = Math.max(candidateMxnCents, baselineMxnCents);
  const lo = Math.min(candidateMxnCents, baselineMxnCents);
  return Math.round((hi * 1000) / lo);
}

/** `jumpFactor ≥ dial` entero-exacto (⛔ sin float en la decisión): `hi*1000 >= round(dial*1000)*lo`. */
function isBigJump(candidateMxnCents: number, baselineMxnCents: number, jumpDial: number): boolean {
  const hi = Math.max(candidateMxnCents, baselineMxnCents);
  const lo = Math.min(candidateMxnCents, baselineMxnCents);
  if (lo <= 0) return true;
  return hi * 1000 >= Math.round(jumpDial * 1000) * lo;
}

/**
 * EL ÁRBOL DEL CANDADO (ARCHITECTURE §4.PRE (c)). Decide, dado el robusto y la base sana, si se publica
 * auto o va a revisión. 💰 money-safe: NUNCA publica el disparado sin consenso; conserva el último sano.
 */
export function decideLock(
  robust: RobustResult,
  baselineMxnCents: number | null,
  jumpDial: number,
): LockDecision {
  const cand = robust.robustMarketMxnCents;

  // 0 frescas admitidas ⇒ PRICE_PENDING; si había precio vivo (base), abrir caso (kept = último sano).
  if (cand == null) {
    return {
      outcome: 'pending',
      publishMxnCents: null,
      conservedMxnCents: baselineMxnCents,
      jumpFactorMilli: 0,
      openCase: baselineMxnCents != null,
    };
  }

  const hasConsensus = robust.familyCount >= 2 && robust.consensus;

  // Sin base (nunca tuvo valor sano): nace con consenso ⇒ publica; fuente única ⇒ revisión.
  if (baselineMxnCents == null) {
    if (hasConsensus) {
      return { outcome: 'publish', publishMxnCents: cand, conservedMxnCents: null, jumpFactorMilli: 0, openCase: false };
    }
    return { outcome: 'review', publishMxnCents: null, conservedMxnCents: null, jumpFactorMilli: 0, openCase: true };
  }

  const milli = jumpFactorMilli(cand, baselineMxnCents);

  // Salto normal ⇒ publica.
  if (!isBigJump(cand, baselineMxnCents, jumpDial)) {
    return { outcome: 'publish', publishMxnCents: cand, conservedMxnCents: null, jumpFactorMilli: milli, openCase: false };
  }

  // Salto GRANDE + ≥2 familias que concuerdan ⇒ el mercado de verdad se movió ⇒ publica.
  if (hasConsensus) {
    return { outcome: 'publish', publishMxnCents: cand, conservedMxnCents: null, jumpFactorMilli: milli, openCase: false };
  }

  // Salto GRANDE + fuente única / no-consenso ⇒ REVISIÓN: conserva el último sano, NUNCA publica el disparado.
  return {
    outcome: 'review',
    publishMxnCents: null,
    conservedMxnCents: baselineMxnCents,
    jumpFactorMilli: milli,
    openCase: true,
  };
}
