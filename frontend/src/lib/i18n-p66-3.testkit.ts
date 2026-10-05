/**
 * P66-3 (`DESIGN_SYSTEM §37.2`): ningún texto visible cita un código de módulo («M-n» / «Mn»), de aviso de gasto
 * («AG-n») ni de correo («AV-n»). Única definición del patrón para las pruebas que barren `messages/*.json`
 * (NT2-a del techlead, 2026-10-05: había cuatro copias que divergían y tres no cazaban «M-1»).
 *
 * Solo para pruebas: ningún módulo de la app lo importa.
 */

/**
 * Caza «M1»…«M19» y «M-1»…«M-19» (guion opcional), «AG-n» y «AV-n». SIN bandera `g`: `.test()` con `g` guarda
 * `lastIndex` entre llamadas y salta aciertos.
 */
export const P66_3_CODE_RE = /\b(M-?1?[0-9]|AG-[0-9]+|AV-[0-9]+)\b/;

/**
 * Aciertos CONOCIDOS del patrón en `messages/*.json` (clave aplanada → por qué sigue ahí). No es una lista blanca
 * libre: `p66_3Offenders` falla también si una entrada deja de acertar (entrada caduca ⇒ se borra).
 *
 * - `admin.m10.shipping.lowBalanceHint`: «… (aviso AG-7) …» / «… (alert AG-7) …» es el texto literal de
 *   `DESIGN_SYSTEM §43.19` (`docs/DESIGN_SYSTEM.md:25349` y `:25795`) y lo afirma
 *   `m10/sections/SpendControlSection.test.tsx:141`. Choca con P66-3; aflorado al unificar el patrón (2026-10-05)
 *   y enrutado al orquestador → ux-ui. Se quita de aquí el día que cambie el texto.
 */
export const P66_3_KNOWN_HITS: Readonly<Record<string, string>> = {
  'admin.m10.shipping.lowBalanceHint': 'DESIGN_SYSTEM §43.19 cita «aviso AG-7»; pendiente de ux-ui',
};

/** Lee `a.b.c` de un catálogo anidado. */
export function get(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Aplana un catálogo anidado a `{ 'a.b.c': texto }` (solo hojas string). */
export function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj };
  if (typeof obj !== 'object' || obj === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

/**
 * Devuelve `locale:clave → texto` de cada texto que cita un código, más `stale:clave` por cada acierto conocido que
 * ya no acierta (dentro del alcance barrido). Vacío ⇒ P66-3 en verde.
 */
export function p66_3Offenders(locale: string, entries: Record<string, string>): string[] {
  const hits = Object.entries(entries)
    .filter(([k, v]) => P66_3_CODE_RE.test(v) && !(k in P66_3_KNOWN_HITS))
    .map(([k, v]) => `${locale}:${k} → ${v}`);
  const stale = Object.keys(P66_3_KNOWN_HITS)
    .filter((k) => k in entries && !P66_3_CODE_RE.test(entries[k]))
    .map((k) => `stale:${locale}:${k}`);
  return [...hits, ...stale];
}
