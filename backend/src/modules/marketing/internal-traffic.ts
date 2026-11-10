/**
 * internal-traffic.ts — tráfico PROPIO (diag, qa, e2e…) que no cuenta en el Panel (MKT_PANEL_V2 §4). PURO.
 * Fuente única del patrón: SOLO `utm_source` (nunca `utm_medium`) que cumple `^(diag|qa|e2e|smoke|test|probe|internal)-.+$`
 * (insensible a mayúsculas; el guion es obligatorio: `qa` o `test` sin guion NO cuentan, así una campaña real conserva su
 * atribución). La lista crece sola: una herramienta nueva se nombra `diag-*`, `qa-*`… y no se edita nada.
 * La copia del navegador vive en `frontend/src/lib/measurement/internal.ts` (prueba de paridad en el frontend).
 */
export const INTERNAL_UTM_PREFIXES = ['diag', 'qa', 'e2e', 'smoke', 'test', 'probe', 'internal'] as const;
const ALT = INTERNAL_UTM_PREFIXES.join('|');
export const INTERNAL_UTM_RE = new RegExp(`^(${ALT})-.+$`, 'i');
/** Misma expresión para el motor RE2 de GA4 (`FULL_REGEXP`: ancla implícita; `(?i)` = insensible a mayúsculas). */
export const INTERNAL_UTM_GA4_REGEX = `(?i)(${ALT})-.+`;

export function isInternalUtmValue(v: string | null | undefined): boolean {
  return typeof v === 'string' && INTERNAL_UTM_RE.test(v.trim());
}

/** ¿Este origen es tráfico propio? Solo cuenta `utm_source`; el segundo argumento (`utm_medium`) se IGNORA a propósito. */
export function isInternalUtm(source: string | null | undefined, _medium?: string | null): boolean {
  return isInternalUtmValue(source);
}

/** `dimensionFilter` de GA4: NOT (sessionSource con el patrón). Sin `sessionMedium`. */
export function ga4InternalExclusion(): Record<string, unknown> {
  return { notExpression: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'FULL_REGEXP', value: INTERNAL_UTM_GA4_REGEX } } } };
}

/** Combina el filtro de la consulta (si lo trae) con la exclusión del tráfico propio. */
export function withInternalExclusion(existing?: Record<string, unknown>): Record<string, unknown> {
  const nx = ga4InternalExclusion();
  return existing ? { andGroup: { expressions: [existing, nx] } } : nx;
}

/** Nota fija de toda tabla servida SIN el filtro (GA4 lo rechazó por incompatibilidad de la consulta). */
export const GA4_UNFILTERED_NOTE = 'Puede incluir tráfico propio de antes de que se excluyera';
