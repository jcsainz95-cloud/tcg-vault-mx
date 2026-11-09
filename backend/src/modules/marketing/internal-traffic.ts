/**
 * internal-traffic.ts — tráfico PROPIO (diag, qa, e2e…) que no cuenta en el Panel (MKT_PANEL_V2 §4). PURO.
 * Fuente única del patrón: `utm_source` o `utm_medium` que empieza por un prefijo de nuestras herramientas, seguido de fin
 * o de `-`/`_`/`.`. La lista crece sola: una herramienta nueva se nombra `diag-*`, `qa-*`… y no se edita nada.
 * La copia del navegador vive en `frontend/src/lib/measurement/internal.ts` (prueba de paridad en el frontend).
 */
export const INTERNAL_UTM_PREFIXES = ['diag', 'qa', 'e2e', 'smoke', 'test', 'probe', 'internal'] as const;
const ALT = INTERNAL_UTM_PREFIXES.join('|');
export const INTERNAL_UTM_RE = new RegExp(`^(${ALT})([-_.].*)?$`, 'i');
/** Misma expresión para el motor RE2 de GA4 (`PARTIAL_REGEXP`; `(?i)` = insensible a mayúsculas). */
export const INTERNAL_UTM_GA4_REGEX = `(?i)^(${ALT})([-_.].*)?$`;

export function isInternalUtmValue(v: string | null | undefined): boolean {
  return typeof v === 'string' && INTERNAL_UTM_RE.test(v.trim());
}

/** ¿Este origen (`utm_source`, `utm_medium`) es tráfico propio? Basta uno de los dos. */
export function isInternalUtm(source: string | null | undefined, medium?: string | null): boolean {
  return isInternalUtmValue(source) || isInternalUtmValue(medium);
}

/** `dimensionFilter` de GA4: NOT (sessionSource OR sessionMedium con el patrón). */
export function ga4InternalExclusion(): Record<string, unknown> {
  const m = (fieldName: string) => ({ filter: { fieldName, stringFilter: { matchType: 'PARTIAL_REGEXP', value: INTERNAL_UTM_GA4_REGEX } } });
  return { notExpression: { orGroup: { expressions: [m('sessionSource'), m('sessionMedium')] } } };
}

/** Combina el filtro de la consulta (si lo trae) con la exclusión del tráfico propio. */
export function withInternalExclusion(existing?: Record<string, unknown>): Record<string, unknown> {
  const nx = ga4InternalExclusion();
  return existing ? { andGroup: { expressions: [existing, nx] } } : nx;
}
