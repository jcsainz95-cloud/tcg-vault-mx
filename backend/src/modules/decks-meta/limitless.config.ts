/**
 * DECKS-META Fase 2 (auto-fetch) — CONSTANTES + configuración pineada del adapter de Limitless.
 * Norma: `docs/specs/DECKS_META_F2_AUTOFETCH.md` §1, §5, §8, §9.
 *
 * Todo lo sensible a seguridad vive aquí y es PURO (sin I/O): host FIJO, construcción de URL SÓLO
 * desde IDs numéricos validados (anti-SSRF, §9), validación del `formatCode`, y los umbrales del
 * canary/parámetros de fetch con sus defaults + overrides por env. Un solo sitio para que SEGURIDAD
 * revise la superficie (§10).
 */
import type { ConfigService } from '@nestjs/config';

/** Host FIJO — allowlist de UN solo host (anti-SSRF, §9). NUNCA se acepta una URL arbitraria. */
export const LIMITLESS_HOST = 'https://limitlesstcg.com';

/** User-Agent identificable (cortesía con un tercero sin API pública, §9). */
export const LIMITLESS_USER_AGENT = 'TCGHuntMetaFetch/1.0 (+https://tcghunt.mx)';

// ── Diales (ConfigSetting, leídos directamente como la ventana de legalidad de Fase 1) ───────────

/** Kill-switch de 3 estados. Seed/ausente ⇒ `off` (fail-closed, §8). */
export const DIAL_AUTOFETCH = 'decks_meta_autofetch';
/** Auto-publicar los decks que pasan canary. Ausente ⇒ `false` (conservador, §6). */
export const DIAL_AUTOPUBLISH = 'decks_meta_autofetch_autopublish';

export type AutofetchDial = 'off' | 'dryrun' | 'on';
export const AUTOFETCH_DIAL_VALUES: readonly AutofetchDial[] = ['off', 'dryrun', 'on'];

/** Normaliza el valor crudo del dial a un estado válido; cualquier basura ⇒ `off` (fail-closed). */
export function normalizeAutofetchDial(raw: unknown): AutofetchDial {
  return raw === 'on' || raw === 'dryrun' ? raw : 'off';
}

/** Normaliza el dial de auto-publicación; sólo el booleano `true` enciende (fail-closed). */
export function normalizeAutopublishDial(raw: unknown): boolean {
  return raw === true;
}

// ── Parámetros de fetch (§1), configurables por env con tope duro ────────────────────────────────

export interface LimitlessFetchConfig {
  /** N arquetipos a traer de la home (default 10, tope duro 12 requests/run, §1). */
  topN: number;
  /** Espaciado entre requests secuenciales (ms). */
  delayMs: number;
  /** Timeout por request (AbortController). */
  timeoutMs: number;
  /** Cap de bytes por respuesta (DoS de memoria). */
  maxBytes: number;
  /** Reintentos por request (además del primer intento). */
  retries: number;
  /** Cota DURA de GETs por corrida (home + N listas ≤ este número). */
  maxRequests: number;
}

/** Defaults pineados (§1). El tope duro de requests es 12 y NUNCA se supera. */
export const FETCH_DEFAULTS: LimitlessFetchConfig = {
  topN: 10,
  delayMs: 1500,
  timeoutMs: 10_000,
  maxBytes: 3 * 1024 * 1024,
  retries: 2,
  maxRequests: 12,
};

function envInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  // `>= 0`: delay y retries pueden ser 0 legítimamente (0 ms de espaciado en test; sin reintentos).
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Resuelve la config de fetch desde env, aplicando el tope DURO de requests. `topN` se recorta para
 * que `1 (home) + topN ≤ maxRequests` — jamás se hacen más de `maxRequests` GETs por corrida.
 */
export function resolveFetchConfig(config: ConfigService): LimitlessFetchConfig {
  const maxRequests = Math.min(envInt(config, 'META_FETCH_MAX_REQUESTS', FETCH_DEFAULTS.maxRequests), FETCH_DEFAULTS.maxRequests);
  const rawTopN = envInt(config, 'META_FETCH_TOP_N', FETCH_DEFAULTS.topN);
  // La home consume 1 request; el resto del presupuesto son listas de arquetipo.
  const topN = Math.max(1, Math.min(rawTopN, maxRequests - 1));
  return {
    topN,
    delayMs: envInt(config, 'META_FETCH_DELAY_MS', FETCH_DEFAULTS.delayMs),
    timeoutMs: envInt(config, 'META_FETCH_TIMEOUT_MS', FETCH_DEFAULTS.timeoutMs),
    maxBytes: envInt(config, 'META_FETCH_MAX_BYTES', FETCH_DEFAULTS.maxBytes),
    retries: envInt(config, 'META_FETCH_RETRIES', FETCH_DEFAULTS.retries),
    maxRequests,
  };
}

// ── Umbrales del canary (§5), configurables por env ──────────────────────────────────────────────

export interface CanaryThresholds {
  /** C1: nº mínimo de arquetipos con lista parseada OK. */
  minDecks: number;
  /** C2: banda de suma-por-cantidad por deck [min, max] (un deck estándar = 60). */
  cardsMin: number;
  cardsMax: number;
  /** C3: piso del ratio global matched/total. */
  matchFloor: number;
  /** C4: tope del ratio de líneas `unmatched_set`. */
  unmatchedSetMaxRatio: number;
}

export const CANARY_DEFAULTS: CanaryThresholds = {
  minDecks: 6,
  cardsMin: 55,
  cardsMax: 61,
  matchFloor: 0.8,
  unmatchedSetMaxRatio: 0.1,
};

function envFloat(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function resolveCanaryThresholds(config: ConfigService): CanaryThresholds {
  return {
    minDecks: envInt(config, 'META_CANARY_MIN_DECKS', CANARY_DEFAULTS.minDecks),
    cardsMin: envInt(config, 'META_CANARY_CARDS_MIN', CANARY_DEFAULTS.cardsMin),
    cardsMax: envInt(config, 'META_CANARY_CARDS_MAX', CANARY_DEFAULTS.cardsMax),
    matchFloor: envFloat(config, 'META_CANARY_MATCH_FLOOR', CANARY_DEFAULTS.matchFloor),
    unmatchedSetMaxRatio: envFloat(config, 'META_CANARY_UNMATCHED_SET_MAX_RATIO', CANARY_DEFAULTS.unmatchedSetMaxRatio),
  };
}

// ── Validación anti-SSRF (§9) ─────────────────────────────────────────────────────────────────────

/** Un ID de Limitless (archetype/list) es SÓLO dígitos. Todo lo demás se descarta (no se hace fetch). */
export function isValidLimitlessId(id: unknown): id is string {
  return typeof id === 'string' && /^\d+$/.test(id);
}

/** El código de formato («TEF-PBL»): 2–4 letras, con un tramo opcional. Se valida antes de usarse. */
export function isValidFormatCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{2,4}(-[A-Z]{2,4})?$/.test(code);
}

/**
 * Construye la URL de una lista completa. ⛔ Sólo se llama con un `listId` YA validado por
 * `isValidLimitlessId`; se re-valida aquí como defensa en profundidad (lanza si no lo es).
 */
export function buildDeckListUrl(listId: string): string {
  if (!isValidLimitlessId(listId)) {
    throw new Error(`listId inválido (anti-SSRF): ${String(listId)}`);
  }
  return `${LIMITLESS_HOST}/decks/list/${listId}`;
}

/** URL de la página de arquetipo (metadata opcional; NUNCA para las 60 cartas). */
export function buildArchetypeUrl(archetypeId: string): string {
  if (!isValidLimitlessId(archetypeId)) {
    throw new Error(`archetypeId inválido (anti-SSRF): ${String(archetypeId)}`);
  }
  return `${LIMITLESS_HOST}/decks/${archetypeId}`;
}

/** URL de la home «Top Decks». Sin parte controlable por el usuario. */
export function buildHomeUrl(): string {
  return `${LIMITLESS_HOST}/`;
}

/** `formatLabel` legible = «Standard <code>» (procedencia; no gobierna legalidad, §3). */
export function buildFormatLabel(formatCode: string | null): string {
  return formatCode ? `Standard ${formatCode}` : 'Standard';
}

/** Slug determinista desde el nombre del arquetipo (kebab-case ASCII). */
export function slugifyDeckName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
