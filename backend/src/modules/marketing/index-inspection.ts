/**
 * index-inspection.ts — §GSHOP.A (docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md): piezas PURAS de la revisión de indexación
 * (Search Console URL Inspection). Sin red, sin BD, sin Nest. Lo dudoso se SUPRIME y se mide; nunca entra a una lista de pendientes.
 */

export const GSC_INSPECT_FLAG = 'gsc_index_inspect';
/** Estado del job (ConfigSetting, JSON): día CDMX del último 403 sin resolver y tope del día fijado por un 429. */
export const GSC_INSPECT_STATE_KEY = 'gsc_index_inspect_state';
/** Presupuesto propio por día (≈ 12 % del tope documentado de 2,000/día por propiedad; ver spec §A «Cuota»). */
export const GSC_INSPECT_DAILY_BUDGET = 250;
export const GSC_INSPECT_BATCH = 40;
export const GSC_INSPECT_CONCURRENCY = 2;
/** Backoff 2-4-8 s ×3 por URL ante 429/5xx/red. */
export const GSC_INSPECT_BACKOFF_MS = [2000, 4000, 8000] as const;
export const DAY_MS = 24 * 3600 * 1000;
/** Dos revisiones cuentan como racha solo si están separadas ≥ 5 días (no dos ticks seguidos). */
export const STREAK_MIN_GAP_MS = 5 * DAY_MS;
/** Una ficha rastreada-sin-indexar solo avisa si lleva ≥ 21 días en el sitemap (Google tarda en indexar lo nuevo). */
export const CRAWLED_MIN_AGE_MS = 21 * DAY_MS;
/** Una URL ya avisada no se repite en correos hasta pasados 28 días (si su flag no cambia). */
export const RENOTIFY_AFTER_MS = 28 * DAY_MS;
/** Reintentos del MISMO envío (el correo reintenta cada hora el lunes): lo avisado hace < 12 h sigue saliendo en ese día. */
export const RESEND_GRACE_MS = 12 * 3600 * 1000;
/** Con menos de esta fracción del universo revisada en 7 días, «no se evaluó». */
export const MIN_COVERAGE = 0.5;
export const COVERAGE_WINDOW_MS = 7 * DAY_MS;

export const INDEX_FLAGS = ['NOT_FOUND', 'BLOCKED', 'FETCH_ERROR', 'DUP_NO_CANON', 'CRAWLED_NOT_INDEXED'] as const;
export type IndexFlag = (typeof INDEX_FLAGS)[number];

/** Campos de `inspectionResult.indexStatusResult` que se usan (cadenas tal cual de la API). */
export interface InspectionFields {
  verdict: string | null;
  coverageState: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
}

const up = (s: string | null | undefined): string => (s ?? '').trim().toUpperCase();
const low = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Clasificación (spec §A, tabla). Comparación sin mayúsculas. PASS o «Submitted and indexed» ⇒ `null`. Una cadena desconocida con
 * `verdict=FAIL` ⇒ `FETCH_ERROR` (nunca se descarta en silencio). Precedencia: 404 > bloqueo > error de rastreo > duplicada > sin indexar.
 */
export function classifyInspection(f: InspectionFields): IndexFlag | null {
  const cov = low(f.coverageState);
  if (up(f.verdict) === 'PASS' || cov.startsWith('submitted and indexed')) return null;
  const fetch = up(f.pageFetchState);
  if (fetch === 'NOT_FOUND' || fetch === 'SOFT_404') return 'NOT_FOUND';
  if (
    up(f.robotsTxtState) === 'DISALLOWED' ||
    up(f.indexingState).startsWith('BLOCKED_') ||
    fetch === 'BLOCKED_ROBOTS_TXT' ||
    fetch === 'ACCESS_DENIED' ||
    fetch === 'ACCESS_FORBIDDEN'
  ) {
    return 'BLOCKED';
  }
  if (fetch === 'SERVER_ERROR' || fetch === 'REDIRECT_ERROR' || fetch === 'INTERNAL_CRAWL_ERROR' || fetch === 'INVALID_URL') return 'FETCH_ERROR';
  const g = (f.googleCanonical ?? '').trim();
  const u = (f.userCanonical ?? '').trim();
  if (cov.includes('duplicate') || (g !== '' && u !== '' && g !== u)) return 'DUP_NO_CANON';
  if (cov.startsWith('crawled - currently not indexed') || cov.startsWith('discovered - currently not indexed')) return 'CRAWLED_NOT_INDEXED';
  if (up(f.verdict) === 'FAIL') return 'FETCH_ERROR';
  return null;
}

export interface FlagState {
  flag: IndexFlag | null;
  flagSince: Date | null;
  flagStreak: number;
}

/**
 * Siguiente estado de la racha tras una revisión. Sin flag ⇒ se limpia. Mismo flag ⇒ la racha sube SOLO si pasó ≥ 5 días × racha desde
 * `flagSince` (la revisión n+1 se cuenta a ≥ 5·n días del inicio: dos ticks seguidos o una página clave revisada a diario NO inflan la
 * racha). Flag distinto ⇒ racha nueva de 1. `resetNotified` ⇒ el aviso previo ya no aplica (se limpió o cambió).
 */
export function nextFlagState(prev: FlagState | null, flag: IndexFlag | null, now: Date): FlagState & { resetNotified: boolean } {
  if (flag === null) return { flag: null, flagSince: null, flagStreak: 0, resetNotified: true };
  if (prev && prev.flag === flag && prev.flagSince) {
    const streak = Math.max(1, prev.flagStreak);
    const counts = now.getTime() - prev.flagSince.getTime() >= STREAK_MIN_GAP_MS * streak;
    return { flag, flagSince: prev.flagSince, flagStreak: counts ? streak + 1 : streak, resetNotified: false };
  }
  return { flag, flagSince: now, flagStreak: 1, resetNotified: true };
}

export interface NoticeRow {
  url: string;
  kind: string;
  flag: string | null;
  flagStreak: number;
  firstSeenAt: Date;
  notifiedAt: Date | null;
}

/** ¿Esta fila entra al aviso AV7 ahora? (spec §A «Se avisa» + supresión de ruido 1 y 3). */
export function isNoticeable(r: NoticeRow, now: Date): boolean {
  const flag = r.flag as IndexFlag | null;
  if (!flag || !(INDEX_FLAGS as readonly string[]).includes(flag)) return false;
  if (flag === 'NOT_FOUND' || flag === 'BLOCKED') {
    if (r.flagStreak < 1) return false;
  } else {
    if (r.flagStreak < 2) return false;
    if (flag === 'CRAWLED_NOT_INDEXED' && now.getTime() - r.firstSeenAt.getTime() < CRAWLED_MIN_AGE_MS) return false;
  }
  if (r.notifiedAt) {
    const age = now.getTime() - r.notifiedAt.getTime();
    if (age > RESEND_GRACE_MS && age < RENOTIFY_AFTER_MS) return false;
  }
  return true;
}

export interface Av7Group {
  flag: IndexFlag;
  count: number;
  /** ≤ 3 rutas de ejemplo (orden alfabético estable). */
  examples: string[];
}
export interface Av7Summary {
  total: number;
  groups: Av7Group[];
}

export const AV7_EXAMPLES_PER_FLAG = 3;

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** Agrupa las filas avisables por flag (orden fijo de `INDEX_FLAGS`); `null` si no hay ninguna (⇒ sin aviso). */
export function summarizeAv7(rows: readonly NoticeRow[], now: Date): Av7Summary | null {
  const groups: Av7Group[] = [];
  for (const flag of INDEX_FLAGS) {
    const urls = rows.filter((r) => r.flag === flag && isNoticeable(r, now)).map((r) => r.url).sort();
    if (urls.length > 0) groups.push({ flag, count: urls.length, examples: urls.slice(0, AV7_EXAMPLES_PER_FLAG).map(pathOf) });
  }
  const total = groups.reduce((n, g) => n + g.count, 0);
  return total === 0 ? null : { total, groups };
}

/** Las URLs que `summarizeAv7` contaría (para marcarlas como avisadas). */
export function noticeableUrls(rows: readonly NoticeRow[], now: Date): string[] {
  return rows.filter((r) => isNoticeable(r, now)).map((r) => r.url);
}
